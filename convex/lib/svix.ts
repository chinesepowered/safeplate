/**
 * Svix webhook signature verification using Web Crypto, so it runs in Convex's
 * default runtime (the svix npm package needs Node APIs and cannot be bundled
 * into an httpAction).
 *
 * Scheme: HMAC-SHA256 over `${id}.${timestamp}.${body}` with the raw bytes of
 * the base64 secret that follows the `whsec_` prefix. The svix-signature header
 * is a space-delimited list of `v1,<base64>` entries; any match is valid.
 */

const TOLERANCE_SECONDS = 5 * 60;

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToBase64(bytes: ArrayBuffer): string {
  const view = new Uint8Array(bytes);
  let bin = "";
  for (let i = 0; i < view.length; i++) bin += String.fromCharCode(view[i]);
  return btoa(bin);
}

/** Length-independent comparison, to avoid leaking timing information. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export type SvixHeaders = {
  id: string | null;
  timestamp: string | null;
  signature: string | null;
};

export async function verifySvix(
  secret: string,
  body: string,
  headers: SvixHeaders,
): Promise<boolean> {
  const { id, timestamp, signature } = headers;
  if (!id || !timestamp || !signature) return false;

  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return false;
  if (Math.abs(Date.now() / 1000 - ts) > TOLERANCE_SECONDS) return false;

  const raw = secret.startsWith("whsec_") ? secret.slice("whsec_".length) : secret;
  let keyBytes: Uint8Array;
  try {
    keyBytes = base64ToBytes(raw);
  } catch {
    return false;
  }

  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes as unknown as ArrayBuffer,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signed = new TextEncoder().encode(`${id}.${timestamp}.${body}`);
  const mac = await crypto.subtle.sign("HMAC", key, signed as unknown as ArrayBuffer);
  const expected = bytesToBase64(mac);

  for (const part of signature.split(" ")) {
    const [version, value] = part.split(",");
    if (version === "v1" && value && timingSafeEqual(value, expected)) return true;
  }
  return false;
}
