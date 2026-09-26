/**
 * The one address comparison in this package. EVM addresses arrive in three spellings of the same
 * value — a chain hands back lowercase, a user pastes EIP-55 checksummed, a config file is typed by
 * hand — so every comparison here is case-insensitive.
 *
 * A non-string is not an address and answers false rather than throwing: the callers are refusal
 * paths (is this my mandate, did this log credit my recipient), and a malformed field there must
 * produce a refusal the passbook can show, not a stack trace from inside a comparison.
 */
export const sameAddress = (a, b) =>
  typeof a === "string" && typeof b === "string" && a.toLowerCase() === b.toLowerCase();
