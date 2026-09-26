/**
 * What a member reads after a World ID round-trip — one table for the room's
 * treasury panel and the /treasury/<room> page, so the same code says the same
 * thing wherever the member lands.
 *
 * The codes ride back on ?treasury= (an approval: callback/route.ts,
 * connect/route.ts, and recordIdpApproval's refusal reasons) and ?world= (a
 * plain verification or a vote claim). Each line says what happened and, when
 * something can be done about it, what to do next.
 *
 * Only codes listed here are ever shown: the query string is anyone's to
 * write, and text echoed from it would read as the treasury speaking.
 */

export type ResultTone = "ok" | "bad" | "info";
export type ResultCopy = { tone: ResultTone; text: string };

export const TREASURY_RESULT: Record<string, ResultCopy> = {
  // the approval counted
  approved: { tone: "ok", text: "✅ Approved — World ID confirmed a unique human, just now." },
  executing: {
    tone: "ok",
    text: "✅ That was the last approval needed — the agent is paying now on Sepolia, usually in about 40 seconds.",
  },
  executed: { tone: "ok", text: "✅ That was the last approval needed — the agent paid." },
  // a plain verification (?world=, but the callback also answers these on ?treasury=)
  verified: { tone: "ok", text: "World ID is now linked to your account." },
  mismatch: { tone: "bad", text: "This account is already linked to a different World ID — nothing was changed." },

  // it reached World ID but was not counted
  "same-human": {
    tone: "bad",
    text: "⛔ Not counted — this human already approved from another account. One human, one vote.",
  },
  "stale-proof": {
    tone: "bad",
    text: "⛔ Not counted — World ID's check was made before this request. Every approval needs a check made after it. Approve again to check now.",
  },
  "not-seated": {
    tone: "bad",
    text: "⛔ Not counted — this account has no vote. Claim your vote with World ID first, then approve.",
  },
  "world-id-mismatch": {
    tone: "bad",
    text: "Not counted — this account is linked to a different World ID. Approve with that one. Nothing was approved.",
  },
  "account-switched": {
    tone: "bad",
    text: "Not counted — World ID came back for a different account than the one that started. Nothing was approved; approve again from this account.",
  },
  "not-electorate": {
    tone: "bad",
    text: "You joined after our rules were adopted — the relation has to adopt its new membership before your approval counts.",
  },

  // the request itself can't take this approval
  "already-approved": { tone: "info", text: "You already approved this request — it counts once." },
  "not-pending": { tone: "info", text: "This request is no longer waiting for approvals." },
  expired: { tone: "bad", text: "This request expired before enough verified members approved it — nothing was approved." },
  "not-allowed": {
    tone: "bad",
    text: "You can't approve this request — it isn't waiting for approvals, or you're not in this room. Nothing was approved.",
  },
  "not-member": { tone: "bad", text: "Only members of this relation can approve its treasury requests." },
  "not-found": { tone: "bad", text: "That treasury request no longer exists." },

  // the round-trip didn't finish
  cancelled: { tone: "bad", text: "You cancelled the World ID check — nothing was approved. Approve again whenever you're ready." },
  unavailable: { tone: "bad", text: "World ID didn't answer — nothing was approved. Try again in a moment." },
  "idp-error": { tone: "bad", text: "World ID returned an error — nothing was approved. Try again." },
  "verify-failed": { tone: "bad", text: "World ID's answer didn't check out — nothing was approved. Try again." },
  "bad-state": {
    tone: "bad",
    text: "That approval page expired or was already used — nothing was approved. Open the request again and approve.",
  },
  error: { tone: "bad", text: "Something went wrong recording the approval — nothing was approved. Try again." },
};

/** ?world= codes that mean something else than the ?treasury= code of the same name. */
export const WORLD_RESULT: Record<string, ResultCopy> = {
  "same-human": {
    tone: "bad",
    text: "⛔ This World ID already vouches for another account — one human, one vote. Nothing was changed.",
  },
};

/** The last approval of something that pays nobody: an adoption of the rules, a recurring buy. */
export const ADOPTED_RESULT = {
  ratify: {
    executing: "✅ That was the last approval needed — the agent is adopting the rules now.",
    executed: "✅ That was the last approval needed — the rules are adopted.",
  },
  "recurring-buy": {
    executing: "✅ Last approval in — adopting the recurring buy.",
    executed: "✅ Recurring buy adopted.",
  },
} as const;

export function isResultCode(key: "treasury" | "world", code: string): boolean {
  return Object.prototype.hasOwnProperty.call(TREASURY_RESULT, code) || (key === "world" && Object.prototype.hasOwnProperty.call(WORLD_RESULT, code));
}

/** The line for a code, or null for one this table doesn't know. */
export function resultCopy(key: "treasury" | "world", code: string): ResultCopy | null {
  if (key === "world" && Object.prototype.hasOwnProperty.call(WORLD_RESULT, code)) return WORLD_RESULT[code];
  return Object.prototype.hasOwnProperty.call(TREASURY_RESULT, code) ? TREASURY_RESULT[code] : null;
}

/** After an approval that counted but didn't finish the quorum: "1 of 2 counted · 1 more verified human needed." */
export const COUNTED = {
  one: "{got} of {need} counted · 1 more verified human needed.",
  many: "{got} of {need} counted · {left} more verified humans needed.",
} as const;
type Tr = (key: string, vars: Record<string, number>) => string;
const fill: Tr = (key, vars) => key.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
export function countedLine(got: number, need: number, tr: Tr = fill): string {
  const left = Math.max(0, need - got);
  return tr(left === 1 ? COUNTED.one : COUNTED.many, { got, need, left });
}

/** Every code the callback and connect routes can send back — the selftest walks it. */
export const RESULT_CODES = [
  "approved", "executed", "executing", "cancelled", "idp-error", "bad-state", "account-switched",
  "verify-failed", "error", "verified", "mismatch", "same-human", "unavailable",
  "stale-proof", "not-seated", "not-member", "not-electorate", "not-pending", "already-approved",
  "expired", "not-found", "not-allowed", "world-id-mismatch",
] as const;


/** Shown under the claim button when proofs come from World's staging (simulator.worldcoin.org). */
export const STAGING_HINT =
  "Staging: answer with the World ID Simulator — “Use the simulator” under the QR, or open simulator.worldcoin.org on a phone and scan the QR. World App can't answer a staging request.";
