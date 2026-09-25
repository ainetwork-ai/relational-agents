import { checkMandate } from "./mandate/index.js";

const same = (a, b) => a.toLowerCase() === b.toLowerCase();

/**
 * One run of the family's tsumitate. Idempotent: the mandate's period key decides whether this
 * run may buy, so a scheduler can wake it as often as it likes. Every outcome the run decides is
 * written to the passbook — a refusal is a line the family reads, not a silent no-op; a malformed
 * mandate or clock is an error, not an outcome, and propagates instead of being filed as a skip.
 */
export async function runOnce({ ledger, swap, account, chain, now = new Date(), mandateId }) {
  const view = await ledger.view();
  // A mandate id names a mandate, it does not confer one. Without the owner check, a caller who
  // knows an id could spend under another family's mandate and have it filed under this agent.
  const m = mandateId
    ? view.mandates.find((x) => x.id === mandateId && same(x.agent, account.address))
    : view.mandates.find((x) => same(x.agent, account.address) && x.kind === "standing");
  if (!m) return { outcome: "no-mandate" };

  const intent = { chainId: chain.chainId, tokenIn: m.tokenIn, tokenOut: m.tokenOut,
    amountIn: m.perRunCap, recipient: account.address, slippageBps: 50 };
  const verdict = checkMandate(m, view, intent, now);
  // Both verdict shapes carry periodKey, so a refusal is filed under the period it was refused for.
  const skip = (reason) => ledger.record({ at: now.toISOString(), kind: "skip", who: account.address,
    mandateId: m.id, periodKey: verdict.periodKey, reason });

  if (!verdict.ok) {
    await skip(verdict.reason);
    return { outcome: "skipped", reason: verdict.reason, periodKey: verdict.periodKey };
  }

  // A swap that throws is this run's outcome, not a crash: the passbook says the week was missed
  // and why. Recording a skip rather than a buy also leaves the period open, so the next run retries.
  const failed = async (err) => {
    await skip(`swap-failed: ${err.message}`);
    return { outcome: "skipped", reason: "swap-failed", periodKey: verdict.periodKey, error: err.message };
  };

  let quote;
  try { quote = await swap.quote(intent); } catch (err) { return failed(err); }
  if (quote.amountOutExpected === 0n) {
    await skip("no-liquidity");
    return { outcome: "skipped", reason: "no-liquidity", periodKey: verdict.periodKey };
  }
  let receipt;
  try { receipt = await swap.execute(quote, account); } catch (err) { return failed(err); }

  await ledger.record({ at: now.toISOString(), kind: "buy", who: account.address, mandateId: m.id,
    periodKey: verdict.periodKey, amountIn: receipt.amountIn, amountOut: receipt.amountOut,
    price: receipt.price, txHash: receipt.txHash, decisionOrigin: verdict.decisionOrigin });
  return { outcome: "bought", receipt, periodKey: verdict.periodKey };
}
