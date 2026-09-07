import type { ReactNode } from "react";
import { useQuery } from "convex/react";
import { api } from "../convex/_generated/api";

export type Verdict = "safe" | "risky" | "unsafe" | "unclear";

/**
 * One vocabulary for the whole app. The wording matters as much as the colour:
 * a parent should never read "safe" and think we checked it ourselves.
 */
export const VERDICT = {
  safe: {
    label: "Confirmed safe",
    short: "Safe",
    chip: "bg-emerald-50 text-emerald-800 ring-emerald-600/25",
    dot: "bg-emerald-600",
    bar: "bg-emerald-500",
    blurb: "The restaurant confirmed this in writing.",
  },
  risky: {
    label: "Risky",
    short: "Risky",
    chip: "bg-amber-50 text-amber-900 ring-amber-600/25",
    dot: "bg-amber-500",
    bar: "bg-amber-400",
    blurb: "Likely to involve the allergen, or prepared near it.",
  },
  unsafe: {
    label: "Avoid",
    short: "Avoid",
    chip: "bg-rose-50 text-rose-800 ring-rose-600/25",
    dot: "bg-rose-600",
    bar: "bg-rose-500",
    blurb: "Contains the allergen.",
  },
  unclear: {
    label: "Not enough information",
    short: "Unclear",
    chip: "bg-stone-100 text-stone-700 ring-stone-500/20",
    dot: "bg-stone-500",
    bar: "bg-stone-400",
    blurb: "The menu does not say. Ask the kitchen.",
  },
} as const;

export const VERDICT_ORDER: Verdict[] = ["safe", "unclear", "risky", "unsafe"];

export function VerdictChip({
  verdict,
  size = "md",
}: {
  verdict: Verdict;
  size?: "sm" | "md" | "lg";
}) {
  const v = VERDICT[verdict];
  const pad =
    size === "lg"
      ? "px-4 py-2 text-base"
      : size === "sm"
        ? "px-2 py-0.5 text-xs"
        : "px-3 py-1 text-sm";
  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full font-medium ring-1 ${v.chip} ${pad}`}
    >
      <span className={`size-2 rounded-full ${v.dot}`} />
      {v.label}
    </span>
  );
}

/** The safe/risky/unsafe mini-bar on a restaurant card. */
export function CountBar({
  counts,
}: {
  counts: { safe: number; risky: number; unsafe: number; unclear: number };
}) {
  const total = counts.safe + counts.risky + counts.unsafe + counts.unclear;
  if (!total) return null;
  return (
    <div className="flex items-center gap-3">
      <div className="flex h-1.5 w-32 overflow-hidden rounded-full bg-stone-200">
        {VERDICT_ORDER.map((k) =>
          counts[k] ? (
            <div
              key={k}
              className={`${VERDICT[k].bar} transition-all duration-700`}
              style={{ width: `${(counts[k] / total) * 100}%` }}
            />
          ) : null,
        )}
      </div>
      <span className="text-xs text-stone-500">
        {counts.safe > 0 && (
          <span className="font-semibold text-emerald-700">{counts.safe} safe</span>
        )}
        {counts.safe > 0 && " · "}
        {counts.unsafe} avoid · {total} dishes
      </span>
    </div>
  );
}

export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-2xl border border-stone-200/80 bg-white shadow-[0_1px_2px_rgba(28,25,23,0.04)] ${className}`}
    >
      {children}
    </div>
  );
}

/** Said once per screen, never buried in a tooltip. */
export function SafetyNote({ className = "" }: { className?: string }) {
  return (
    <p className={`text-xs leading-relaxed text-stone-500 ${className}`}>
      SafePlate helps you ask better questions. It is not medical advice, and it cannot
      see inside a kitchen. Nothing is marked confirmed safe unless the restaurant said so
      in writing — always tell staff about the allergy when you order.
    </p>
  );
}

/**
 * Firecrawl bills in credits and the pool is shared. When it is close to the
 * floor we stop crawling and serve what we already read, which is a calm fact
 * rather than an error — but it has to be said out loud, because a menu we
 * could not re-read is exactly the kind of thing a parent should know about.
 */
export function CrawlPausedNote({ className = "" }: { className?: string }) {
  const crawl = useQuery(api.crawlCache.status);
  if (!crawl || crawl.live) return null;
  return (
    <p
      className={`rounded-xl bg-stone-100 px-4 py-3 text-sm text-stone-700 ring-1 ring-stone-300/60 ${className}`}
    >
      Showing saved menu data — live menu checks are paused to protect the shared crawl
      budget.
    </p>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-stone-500">
      <span className="size-3.5 animate-spin rounded-full border-2 border-stone-300 border-t-stone-600" />
      {label}
    </span>
  );
}

export function timeAgo(ts?: number): string {
  if (!ts) return "";
  const s = Math.max(1, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}
