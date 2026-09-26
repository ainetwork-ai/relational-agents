import { checkMandate } from "./mandate/index.js";
import { sameAddress } from "./address.js";

// The bound handed to every quote. Not a mandate field yet: the family signs caps and a pair, not
// how much slippage their agent may accept.
const SLIPPAGE_BPS = 50;

/**
 * One run of the family's tsumitate. Idempotent: the mandate's period key decides whether this
 * run may buy, so a scheduler can wake it as often as it likes. Every outcome the run decides is
 * written to the passbook — a refusal is a line the family reads, not a silent no-op; a malformed
 * mandate or clock is an error, not an outcome, and propagates instead of being filed as a skip.
 * A swap-failed skip that carries a txHash means money may have moved and the period is NOT marked
 * bought — a follow-up must reconcile it.
 */
export async function runOnce({ ledger, swap, account, chain, now = new Date(), mandateId }) {
  const view = await ledger.view();
  // A mandate id names a mandate, it does not confer one. Without the owner check, a caller who
  // knows an id could spend under another family's mandate and have it filed under this agent.
  const m = mandateId
    ? view.mandates.find((x) => x.id === mandateId && sameAddress(x.agent, account.address))
    : view.mandates.find((x) => sameAddress(x.agent, account.address) && x.kind === "standing");
  if (!m) return { outcome: "no-mandate" };

  const intent = { chainId: chain.chainId, tokenIn: m.tokenIn, tokenOut: m.tokenOut,
    amountIn: m.perRunCap, recipient: account.address, slippageBps: SLIPPAGE_BPS };
  const verdict = checkMandate(m, view, intent, now);
  // Both verdict shapes carry periodKey, so a refusal is filed under the period it was refused for.
  const skip = (reason, extra) => ledger.record({ at: now.toISOString(), kind: "skip", who: account.address,
    mandateId: m.id, periodKey: verdict.periodKey, reason, ...extra });

  if (!verdict.ok) {
    await skip(verdict.reason);
    return { outcome: "skipped", reason: verdict.reason, periodKey: verdict.periodKey };
  }

  // A swap that throws is this run's outcome, not a crash: the passbook says the week was missed
  // and why. Recording a skip rather than a buy also leaves the period open, so the next run retries.
  const failed = async (err) => {
    // Never `err.message`: viem's BaseError puts the RPC URL and the request body in it, so an API
    // key in RPC_URL would be written into the family's passbook. `shortMessage` is the safe half,
    // and String() keeps a non-Error throw from being filed as "undefined".
    const detail = String(err?.shortMessage ?? err?.message ?? err).slice(0, 200);
    // Set by the provider once the swap is broadcast: the transaction may have landed even though
    // this call failed, so the skip names it rather than implying nothing happened.
    const landed = err?.txHash ? { txHash: err.txHash } : undefined;
    await skip(`swap-failed: ${detail}`, landed);
    return { outcome: "skipped", reason: "swap-failed", periodKey: verdict.periodKey, error: detail, ...landed };
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
