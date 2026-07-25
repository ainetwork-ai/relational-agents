/**
 * Message construction for wallet signatures. Shared by client and server:
 * the server builds the message to hand out, the client signs that exact
 * string, and the server rebuilds it from stored state to verify.
 *
 * Why a builder instead of free-form strings: a signature only proves "this key
 * signed these bytes". Without a server-issued nonce and a stated purpose, a
 * signature captured in one flow can be replayed in another. Bind both into the
 * text and both problems go away.
 */

export interface SigningRequest {
  /** What the user is approving, in plain language ("Sign in to ",
 * "Approve page publish"). Shown in the wallet popup. */
  purpose: string;
  /** Server-issued, single-use random value. Store it and delete on use. */
  nonce: string;
  /** ISO timestamp; lets the verifier reject stale signatures. */
  issuedAt?: string;
  /** Address the request was issued for, if the flow knows it up front. */
  address?: string;
  /** Extra key/value lines the user should see (page title, amount, …). */
  details?: Record<string, string>;
}

/**
 * Renders a `SigningRequest` to the exact string that gets signed.
 * Deterministic — key order is fixed and `details` is sorted — so the server
 * can rebuild it byte-for-byte at verification time.
 */
export function buildSigningMessage(req: SigningRequest): string {
  const lines = [req.purpose, ""];
  if (req.address) lines.push(`Address: ${req.address}`);
  for (const key of Object.keys(req.details ?? {}).sort()) {
    lines.push(`${key}: ${req.details![key]}`);
  }
  if (req.issuedAt) lines.push(`Issued At: ${req.issuedAt}`);
  lines.push(`Nonce: ${req.nonce}`);
  return lines.join("\n");
}

/** True if `issuedAt` is missing, unparseable, or older than `maxAgeMs`. */
export function isSigningMessageStale(
  issuedAt: string | undefined,
  maxAgeMs = 5 * 60_000
): boolean {
  if (!issuedAt) return true;
  const t = Date.parse(issuedAt);
  if (Number.isNaN(t)) return true;
  return Date.now() - t > maxAgeMs;
}
