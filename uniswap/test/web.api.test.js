import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { privateKeyToAccount } from "viem/accounts";
import { fileLedger } from "../src/ledger/file.js";
import { verifyApproval } from "../src/mandate/index.js";
import { webApi } from "../src/web/api.js";

const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", WETH = "0x4200000000000000000000000000000000000006";
const chain = { name: "test", chainId: 8453, tokens: { USDC: { address: USDC, decimals: 6 }, WETH: { address: WETH, decimals: 18 } }, explorerTx: (h) => `https://example.test/tx/${h}` };
const agent = { address: "0x1111111111111111111111111111111111111111" };
const member = privateKeyToAccount("0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a"); // anvil #4
const fakeSwap = () => {
  const calls = { quote: 0, execute: 0 };
  return { calls,
    quote: async (i) => { calls.quote++; return { provider: "fake", amountIn: i.amountIn, amountOutExpected: i.amountIn * 400_000_000n, route: "fake", raw: null, intent: i }; },
    execute: async (q) => { calls.execute++; return { txHash: "0x" + "ab".repeat(32), amountIn: q.amountIn, amountOut: q.amountOutExpected, price: 2500, route: "fake", provider: "fake" }; } };
};
const setup = () => { const swap = fakeSwap(); const ledger = fileLedger(join(mkdtempSync(join(tmpdir(), "web-")), "passbook.json"));
  return { swap, ledger, api: webApi({ ledger, swap, chain, account: agent, member }) }; };
const friday = "2026-09-25T09:00:00Z", nextMonday = "2026-09-28T09:00:00Z";

test("sign → dry run → run → revoke, through the page's calls, is the CLI sequence", async () => {
  const { api, swap, ledger } = setup();
  let s = await api.state(friday);
  assert.equal(s.periodKey, "2026-W39"); assert.equal(s.member, member.address); assert.deepEqual(s.mandates, []); assert.deepEqual(s.entries, []);
  assert.equal(s.balances, undefined, "a provider without a client has no balances");

  const m = await api.sign({ perRun: "1", perPeriod: "2", days: "90", now: friday });
  assert.equal(m.perRunCap, 1_000_000n); assert.equal(m.perPeriodCap, 2_000_000n); assert.equal(m.agent, agent.address);
  assert.equal(await verifyApproval(m, chain.chainId), true, "the page signs what runOnce will re-verify");
  s = await api.state(friday);
  assert.equal(s.mandates.length, 1); assert.equal(s.mandates[0].status, "live");

  const dry = await api.dryRun(friday);
  assert.equal(dry.outcome, "dry-run"); assert.equal(swap.calls.execute, 0);
  assert.deepEqual((await api.state(friday)).entries, [], "a dry run writes nothing");

  const r = await api.run(friday);
  assert.equal(r.outcome, "bought"); assert.equal(r.receipt.amountIn, 1_000_000n);
  s = await api.state(friday);
  assert.equal(s.entries.length, 1); assert.equal(s.entries[0].kind, "buy"); assert.equal(s.entries[0].periodKey, "2026-W39");
  assert.equal((await api.run(friday)).reason, "period-already-bought");
  assert.equal((await api.run(nextMonday)).outcome, "bought", "the page's clock moves the period like NOW does");

  assert.deepEqual(await api.revoke({ id: m.id, now: nextMonday }), { revoked: m.id });
  assert.equal((await api.state(nextMonday)).mandates[0].status, "revoked");
  assert.equal((await api.run(nextMonday)).reason, "revoked");
  assert.equal((await ledger.entries()).length, 4, "two buys and two refusals, all in the passbook");
});

test("the page refuses what the CLI refuses: bad caps, bad days, a bad clock, no member", async () => {
  const { api } = setup();
  await assert.rejects(api.sign({ perRun: "abc", perPeriod: "1", days: "90" }), /perRun "abc" is not a decimal amount/);
  await assert.rejects(api.sign({ perRun: "1", perPeriod: "0", days: "90" }), /perPeriod must be positive/);
  await assert.rejects(api.sign({ perRun: "1", perPeriod: "1", days: "1.5" }), /days "1.5" must be a positive whole number/);
  await assert.rejects(api.state("not a date"), /invalid now "not a date"/);
  await assert.rejects(api.revoke({ id: "m-nope" }), /no mandate/);
  const { api: noMember } = (() => { const s = setup(); return { api: webApi({ ledger: s.ledger, swap: s.swap, chain, account: agent }) }; })();
  await assert.rejects(noMember.sign({ perRun: "1", perPeriod: "1", days: "90" }), /no member key/);
  assert.equal((await noMember.state()).member, undefined);
});
