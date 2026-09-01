"use node";

import OpenAI from "openai";
import { z } from "zod";

/**
 * The ONLY module that talks to an LLM. Provider-agnostic on purpose: the
 * endpoint is any OpenAI-compatible API, chosen entirely by env vars, so the
 * provider can be swapped without touching product code.
 *
 *   LLM_BASE_URL    e.g. https://integrate.api.nvidia.com/v1
 *   LLM_API_KEY
 *   LLM_MODEL       e.g. deepseek-ai/deepseek-v4-pro-0813
 *   LLM_VISION_MODEL  optional; when unset, vision features degrade to text
 *   LLM_EXTRA_BODY  optional JSON merged into every request body, for
 *                   provider-specific fields, e.g.
 *                   {"chat_template_kwargs":{"thinking":false}}
 */
function cfg() {
  const baseURL = process.env.LLM_BASE_URL;
  const apiKey = process.env.LLM_API_KEY;
  const model = process.env.LLM_MODEL;
  if (!baseURL || !apiKey || !model) {
    throw new Error("LLM_BASE_URL / LLM_API_KEY / LLM_MODEL not set on this deployment");
  }
  let extra: Record<string, unknown> = {};
  if (process.env.LLM_EXTRA_BODY) {
    try {
      extra = JSON.parse(process.env.LLM_EXTRA_BODY);
    } catch {
      throw new Error("LLM_EXTRA_BODY is not valid JSON");
    }
  }
  return { baseURL, apiKey, model, vision: process.env.LLM_VISION_MODEL, extra };
}

const TIMEOUT_MS = 60_000;

function client() {
  const { baseURL, apiKey } = cfg();
  return new OpenAI({ baseURL, apiKey, timeout: TIMEOUT_MS, maxRetries: 1 });
}

/** The model id actually in use, for logging on stored artifacts. */
export function modelId(): string {
  return cfg().model;
}

export function visionAvailable(): boolean {
  return Boolean(cfg().vision);
}

function stripFences(s: string): string {
  const t = s.trim();
  const m = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return (m ? m[1] : t).trim();
}

export type ImagePart = { url: string };

/** Free-text generation (letters, summaries, drafts). */
export async function draft(
  prompt: string,
  opts: { system?: string; maxTokens?: number; temperature?: number } = {},
): Promise<string> {
  const { model, extra } = cfg();
  const res = await client().chat.completions.create({
    model,
    temperature: opts.temperature ?? 0.7,
    max_tokens: opts.maxTokens ?? 4000,
    messages: [
      ...(opts.system ? [{ role: "system" as const, content: opts.system }] : []),
      { role: "user" as const, content: prompt },
    ],
    ...extra,
  });
  return res.choices[0]?.message?.content ?? "";
}

/**
 * Structured output. Everything that becomes a database row goes through here:
 * the zod schema is sent as JSON Schema, the reply is parsed and validated.
 * Tries response_format first, then falls back to plain output for providers
 * that reject it.
 */
export async function extract<T>(
  schema: z.ZodType<T>,
  prompt: string,
  opts: { system?: string; maxTokens?: number; images?: ImagePart[] } = {},
): Promise<T> {
  const { model, vision, extra } = cfg();
  const jsonSchema = z.toJSONSchema(schema as z.ZodType, { io: "output" });
  const useVision = Boolean(opts.images?.length && vision);
  const system =
    `${opts.system ?? ""}\n\nRespond with a single JSON object and nothing else. ` +
    `It must validate against this JSON Schema:\n${JSON.stringify(jsonSchema)}`;

  const userContent = useVision
    ? [
        { type: "text" as const, text: prompt },
        ...opts.images!.map((i) => ({ type: "image_url" as const, image_url: { url: i.url } })),
      ]
    : prompt;

  let lastError: unknown;
  for (const strict of [true, false]) {
    try {
      const res = await client().chat.completions.create({
        model: useVision ? vision! : model,
        temperature: 0,
        max_tokens: opts.maxTokens ?? 2000,
        messages: [
          { role: "system", content: system },
          { role: "user", content: userContent as never },
        ],
        ...(strict ? { response_format: { type: "json_object" as const } } : {}),
        ...extra,
      });
      const raw = stripFences(res.choices[0]?.message?.content ?? "");
      return schema.parse(JSON.parse(raw));
    } catch (e) {
      lastError = e;
    }
  }
  throw new Error(`LLM returned no valid JSON: ${String(lastError)}`);
}
