/**
 * Pure email helpers — no SDK imports, so these are safe to use from queries
 * and mutations in Convex's default runtime.
 */

/** Unguessable per-case code, e.g. BCN-7F3K. Used to route replies. */
export function newCaseCode(prefix: string): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no I/O/0/1
  let s = "";
  for (let i = 0; i < 4; i++) {
    s += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return `${prefix}-${s}`;
}

const CODE_RE = /\[([A-Z]{2,5}-[A-Z0-9]{4})\]/;

/** Pull a caseCode out of a subject line, if present. */
export function caseCodeFromSubject(subject: string | undefined): string | null {
  const m = subject?.match(CODE_RE);
  return m ? m[1] : null;
}

/** Never log or display a full address. */
export function redactEmail(address: string | undefined): string {
  if (!address) return "unknown";
  const at = address.lastIndexOf("@");
  return at > 0 ? `***${address.slice(at)}` : "***";
}

/** Bare address out of "Name <a@b.c>". */
export function bareAddress(from: string): string {
  const m = from.match(/<([^>]+)>/);
  return (m ? m[1] : from).toLowerCase().trim();
}
