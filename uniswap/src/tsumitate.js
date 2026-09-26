import { checkMandate, inactiveReason, periodKey, verifyApproval } from "./mandate/index.js";
import { sameAddress } from "./address.js";

// The bound handed to every quote. Not a mandate field yet: the family signs caps and a pair, not
// how much slippage their agent may accept.
const SLIPPAGE_BPS = 50;

/**
 * This agent's standing mandate at `now`: the live one with the highest nonce, or — when none is
 * live — the newest dead one, so the run records "revoked" or "expired" instead of the
 * "no-mandate" a family would read as a lost passbook.
 *
 * Newest, not first in the file. Re-signing after a revoke or an expiry is the ordinary end of a
 * mandate's life and the replacement is appended after the one it replaces, so taking the first
 * match refused every run from the re-signing onwards — and nothing in the CLI undoes that: there
 * is no delete command and `addMandate` refuses a duplicate id.
 */
function chooseStanding(mandates, agentAddress, now) {
  const mine = mandates.filter((x) => sameAddress(x.agent, agentAddress) && x.kind === "standing");
  const live = mine.filter((x) => !inactiveReason(x, now));
  const pool = live.length ? live : mine;
  return pool.reduce((newest, x) => (x.nonce > newest.nonce ? x : newest), pool[0]);
}

/**
 * One run of the family's tsumitate. Idempotent: the mandate's period key decides whether this
 * run may buy, so a scheduler can wake it as often as it likes. Every outcome the run decides is
 * written to the passbook — a refusal is a line the family reads, not a silent no-op; a malformed
 * mandate or clock is an error, not an outcome, and propagates instead of being filed as a skip.
 * A swap-failed skip that carries a txHash means money may have moved, so that period counts as
 * bought and the next run refuses it; reconciling what actually landed is still missing.
 * With `dryRun` the run decides and quotes exactly as it would, returns that, and writes nothing.
 */
export async function runOnce({ ledger, swap, account, chain, now = new Date(), mandateId, dryRun = false }) {
  const view = await ledger.view();
  // A mandate id names a mandate, it does not confer one. Without the owner check, a caller who
  // knows an id could spend under another family's mandate and have it filed under this agent.
  const m = mandateId
    ? view.mandates.find((x) => x.id === mandateId && sameAddress(x.agent, account.address))
    : chooseStanding(view.mandates, account.address, now);
  if (!m) return { outcome: "no-mandate" };

  // The period this run belongs to, named once. `checkMandate` derives the same key from the same
  // mandate and clock; having it here lets the approval refusal below be filed under its period
  // too, before there is a verdict to read it from.
  const key = periodKey(m.period, now);
  // A dry run is the rehearsal before a run against real funds: the real mandate, the real ledger
  // and the real quote, with the passbook left as it was and the swap stopped at the quote.
  const record = dryRun ? async () => {} : (entry) => ledger.record(entry);
  const skip = (reason, extra) => record({ at: now.toISOString(), kind: "skip", who: account.address,
    mandateId: m.id, periodKey: key, reason, ...extra });

  // The signature is recovered again here rather than read as a field. The passbook is a plain
  // JSON file written by this agent's own process, so "the family allowed this" is only as true as
  // the last time someone checked — a mandate whose terms were edited after signing stops here.
  if (!(await verifyApproval(m, chain.chainId))) {
    await skip("approval-invalid");
    return { outcome: "skipped", reason: "approval-invalid", periodKey: key };
  }

  const intent = { chainId: chain.chainId, tokenIn: m.tokenIn, tokenOut: m.tokenOut,
    amountIn: m.perRunCap, recipient: account.address, slippageBps: SLIPPAGE_BPS };
  const verdict = checkMandate(m, view, intent, now);
  if (!verdict.ok) {
    await skip(verdict.reason);
    return { outcome: "skipped", reason: verdict.reason, periodKey: key };
  }

  // A swap that throws is this run's outcome, not a crash: the passbook says the week was missed
  // and why. A skip with no txHash leaves the period open and the next run retries; one that names
  // a broadcast transaction takes the period with it (`view` in ledger/file.js).
  const failed = async (err) => {
    // Never `err.message`: viem's BaseError puts the RPC URL and the request body in it, so an API
    // key in RPC_URL would be written into the family's passbook. `shortMessage` is the safe half,
    // and String() keeps a non-Error throw from being filed as "undefined".
    const detail = String(err?.shortMessage ?? err?.message ?? err).slice(0, 200);
    // Set by the provider once the swap is broadcast: the transaction may have landed even though
    // this call failed, so the skip names it rather than implying nothing happened.
    const landed = err?.txHash ? { txHash: err.txHash } : undefined;
    await skip(`swap-failed: ${detail}`, landed);
    return { outcome: "skipped", reason: "swap-failed", periodKey: key, error: detail, ...landed };
  };

  let quote;
  try { quote = await swap.quote(intent); } catch (err) { return failed(err); }
  if (quote.amountOutExpected === 0n) {
    await skip("no-liquidity");
    return { outcome: "skipped", reason: "no-liquidity", periodKey: key };
  }
  if (dryRun) return { outcome: "dry-run", periodKey: key, mandateId: m.id, decisionOrigin: verdict.decisionOrigin,
    quote: { amountIn: quote.amountIn, amountOutExpected: quote.amountOutExpected, route: quote.route, provider: quote.provider } };
  let receipt;
  try { receipt = await swap.execute(quote, account); } catch (err) { return failed(err); }

  await ledger.record({ at: now.toISOString(), kind: "buy", who: account.address, mandateId: m.id,
    periodKey: key, amountIn: receipt.amountIn, amountOut: receipt.amountOut,
    price: receipt.price, txHash: receipt.txHash, decisionOrigin: verdict.decisionOrigin });
  return { outcome: "bought", receipt, periodKey: key };
}
