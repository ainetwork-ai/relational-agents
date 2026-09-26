import { erc20Abi, formatEther, formatUnits, parseUnits } from "viem";
import { sameAddress } from "../address.js";
import { inactiveReason, periodKey, signStandingMandate } from "../mandate/index.js";
import { runOnce } from "../tsumitate.js";

/**
 * The page's back end: the same runOnce, ledger and signer the CLIs use, behind five calls.
 * Every call takes an optional `now` (ISO string) — the demo's clock, exactly like the CLI's NOW.
 * `member` is optional: without a member key the page shows and runs, but cannot sign.
 */
export function webApi({ ledger, swap, chain, account, member }) {
  const clock = (now) => {
    const at = now ? new Date(now) : new Date();
    if (Number.isNaN(at.getTime())) throw new Error(`invalid now "${now}"`);
    return at;
  };
  // Judged here for the same reason the CLI judges its arguments: a cap read as a float would sign
  // a number the family never typed, and "abc" would sign NaN.
  const cap = (value, what) => {
    let amount;
    try { amount = parseUnits(String(value), chain.tokens.USDC.decimals); } catch { throw new Error(`${what} "${value}" is not a decimal amount`); }
    if (amount <= 0n) throw new Error(`${what} must be positive`);
    return amount;
  };
  const balances = async () => {
    if (!swap.pub) return undefined; // a provider without a client (tests) has no balances to show
    const of = (token) => swap.pub.readContract({ address: token.address, abi: erc20Abi, functionName: "balanceOf", args: [account.address] });
    const [eth, usdc, weth] = await Promise.all([swap.pub.getBalance({ address: account.address }), of(chain.tokens.USDC), of(chain.tokens.WETH)]);
    return { eth: formatEther(eth), usdc: formatUnits(usdc, chain.tokens.USDC.decimals), weth: formatEther(weth) };
  };

  return {
    async state(now) {
      const at = clock(now);
      const [mandates, entries, bal] = await Promise.all([ledger.mandates(), ledger.entries(), balances()]);
      return {
        chain: { name: chain.name, chainId: chain.chainId, explorerTx: chain.explorerTx("") },
        agent: account.address, member: member?.address, now: at.toISOString(), periodKey: periodKey("week", at),
        balances: bal,
        mandates: mandates.filter((m) => sameAddress(m.agent, account.address))
          .map((m) => ({ ...m, status: inactiveReason(m, at) ?? "live" })),
        entries,
      };
    },
    dryRun: (now) => runOnce({ ledger, swap, account, chain, now: clock(now), dryRun: true }),
    run: (now) => runOnce({ ledger, swap, account, chain, now: clock(now) }),
    async sign({ perRun, perPeriod, days, now }) {
      if (!member) throw new Error("no member key: MEMBER_PK is not set, so nobody here can sign");
      const n = Number(days);
      if (!Number.isInteger(n) || n <= 0) throw new Error(`days "${days}" must be a positive whole number`);
      const m = await signStandingMandate({ member, agent: account.address, chain, now: clock(now),
        perRunCap: cap(perRun, "perRun"), perPeriodCap: cap(perPeriod, "perPeriod"), days: n });
      await ledger.addMandate(m);
      return m;
    },
    async revoke({ id, now }) {
      await ledger.revoke(id, Math.floor(clock(now).getTime() / 1000));
      return { revoked: id };
    },
  };
}
