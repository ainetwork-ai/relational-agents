import { periodKey } from "./period.js";
import { sameAddress } from "../address.js";

/**
 * Why `m` is not in force at `now` ("revoked" | "expired"), or null while it is. Exported because
 * the executor has to pick between several mandates before it has an intent to check, and a
 * selector with its own copy of this rule could choose a mandate `check` then refuses — or skip
 * one it would have allowed. One rule, two readers.
 */
export function inactiveReason(m, now) {
  if (m.revokedAt) return "revoked";
  if (Math.floor(now.getTime() / 1000) >= m.expiresAt) return "expired";
  return null;
}

/**
 * May the agent do `intent` under mandate `m` right now? Pure; the ledger supplies `view`.
 * Refusal order is part of the contract (the passbook shows the first reason that applies).
 */
export function checkMandate(m, view, intent, now) {
  // An unrecognised kind must not fall through to the permissive branch: "one-off" with a hyphen
  // would skip period-already-bought and be filed as human_mediated, so a typo in the mandate
  // would silently buy every run and blame a human for it.
  if (m.kind !== "standing" && m.kind !== "oneoff")
    throw new TypeError(`checkMandate: unknown mandate kind "${m.kind}"`);

  const key = periodKey(m.period, now);
  const no = (reason) => ({ ok: false, reason, periodKey: key });

  const inactive = inactiveReason(m, now);       // revoked before expired: a revoke is the newer fact
  if (inactive) return no(inactive);
  // Presence only. Whether the approval is genuine is `verifyApproval`'s question, and it needs a
  // chainId and an await — neither of which belongs in a pure synchronous check.
  if (!m.approval) return no("unapproved");
  if (!sameAddress(intent.tokenIn, m.tokenIn) || !sameAddress(intent.tokenOut, m.tokenOut)) return no("pair-not-allowed");
  if (intent.amountIn > m.perRunCap) return no("over-per-run-cap");
  const spent = view.spentByPeriod?.[m.id]?.[key] ?? 0n;
  if (spent + intent.amountIn > m.perPeriodCap) return no("over-per-period-cap");
  if (m.kind === "standing" && (view.boughtPeriods?.[m.id] ?? []).includes(key)) return no("period-already-bought");

  return { ok: true, decisionOrigin: m.kind === "standing" ? "autonomous" : "human_mediated", periodKey: key };
}
