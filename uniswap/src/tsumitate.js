import { checkMandate } from "./mandate/index.js";

const same = (a, b) => a.toLowerCase() === b.toLowerCase();

/**
 * One run of the family's tsumitate. Idempotent: the mandate's period key decides whether this
 * run may buy, so a scheduler can wake it as often as it likes. Every outcome is written to the
 * passbook — a refusal is a line the family reads, not a silent no-op.
 */
export async function runOnce({ ledger, swap, account, chain, now = new Date(), mandateId }) {
  const view = await ledger.view();
  const m = mandateId
    ? view.mandates.find((x) => x.id === mandateId)
    : view.mandates.find((x) => same(x.agent, account.address) && x.kind === "standing");
  if (!m) return { outcome: "no-mandate" };

  const intent = { chainId: chain.chainId, tokenIn: m.tokenIn, tokenOut: m.tokenOut,
    amountIn: m.perRunCap, recipient: account.address, slippageBps: 50 };
  const verdict = checkMandate(m, view, intent, now);
  if (!verdict.ok) {
    await ledger.record({ at: now.toISOString(), kind: "skip", who: account.address, mandateId: m.id,
      periodKey: verdict.periodKey, reason: verdict.reason });
    return { outcome: "skipped", reason: verdict.reason, periodKey: verdict.periodKey };
  }

  const quote = await swap.quote(intent);
  if (quote.amountOutExpected === 0n) {
    await ledger.record({ at: now.toISOString(), kind: "skip", who: account.address, mandateId: m.id,
      periodKey: verdict.periodKey, reason: "no-liquidity" });
    return { outcome: "skipped", reason: "no-liquidity", periodKey: verdict.periodKey };
  }
  const receipt = await swap.execute(quote, account);
  await ledger.record({ at: now.toISOString(), kind: "buy", who: account.address, mandateId: m.id,
    periodKey: verdict.periodKey, amountIn: receipt.amountIn, amountOut: receipt.amountOut,
    price: receipt.price, txHash: receipt.txHash, decisionOrigin: verdict.decisionOrigin });
  return { outcome: "bought", receipt, periodKey: verdict.periodKey };
}
