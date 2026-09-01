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

/**
 * A subject line reduced to the part that identifies the conversation: the
 * demo-override prefix, the [SP-XXXX] routing code and any Re:/Fwd: chain are
 * all noise. Used to tell two enquiries sent under the same code apart, so a
 * restaurant's reply lands on the restaurant it actually came from.
 */
export function normalizeSubject(subject: string | undefined): string {
  return (subject ?? "")
    .replace(/\[to:[^\]]*\]/gi, "")
    .replace(/\[[A-Z]{2,5}-[A-Z0-9]{4}\]/g, "")
    .replace(/^\s*((re|fw|fwd|aw|sv)\s*:\s*)+/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}
