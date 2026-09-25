import { periodKey } from "./period.js";

const same = (a, b) => a.toLowerCase() === b.toLowerCase();

/**
 * May the agent do `intent` under mandate `m` right now? Pure; the ledger supplies `view`.
 * Refusal order is part of the contract (the passbook shows the first reason that applies).
 */
export function checkMandate(m, view, intent, now) {
  const key = periodKey(m.period, now);
  const no = (reason) => ({ ok: false, reason, periodKey: key });
  const nowSec = Math.floor(now.getTime() / 1000);

  if (m.revokedAt) return no("revoked");
  if (nowSec >= m.expiresAt) return no("expired");
  if (!m.approval) return no("unapproved");
  if (!same(intent.tokenIn, m.tokenIn) || !same(intent.tokenOut, m.tokenOut)) return no("pair-not-allowed");
  if (intent.amountIn > m.perRunCap) return no("over-per-run-cap");
  const spent = view.spentByPeriod?.[m.id]?.[key] ?? 0n;
  if (spent + intent.amountIn > m.perPeriodCap) return no("over-per-period-cap");
  if (m.kind === "standing" && (view.boughtPeriods?.[m.id] ?? []).includes(key)) return no("period-already-bought");

  return { ok: true, decisionOrigin: m.kind === "standing" ? "autonomous" : "human_mediated", periodKey: key };
}
