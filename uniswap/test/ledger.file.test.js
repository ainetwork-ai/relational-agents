import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileLedger } from "../src/ledger/file.js";
import { defaultPath, ledgerByName } from "../src/ledger/index.js";

const fresh = () => fileLedger(join(mkdtempSync(join(tmpdir(), "passbook-")), "passbook.json"));
const m = { id: "m-1", roomId: "r", agent: "0xagent", kind: "standing", tokenIn: "0xa", tokenOut: "0xb",
  perRunCap: 20_000_000n, perPeriodCap: 100_000_000n, period: "week", expiresAt: 1798761600, nonce: 1 };
const buy = (over = {}) => ({ at: "2026-09-25T09:00:00Z", kind: "buy", who: "0xagent", mandateId: "m-1",
  periodKey: "2026-W39", amountIn: 20_000_000n, amountOut: 7_300_000_000_000_000n, price: 2739.7, txHash: "0x1", ...over });

test("empty ledger has an empty view", async () => {
  const l = fresh();
  assert.deepEqual(await l.view(), { mandates: [], spentByPeriod: {}, boughtPeriods: {} });
});

test("buys accumulate per mandate and period; skips and deposits do not", async () => {
  const l = fresh();
  await l.addMandate(m);
  await l.record({ at: "2026-09-25T09:00:00Z", kind: "buy", who: "0xagent", mandateId: "m-1",
    periodKey: "2026-W39", amountIn: 20_000_000n, amountOut: 7_300_000_000_000_000n, price: 2739.7, txHash: "0x1" });
  await l.record({ at: "2026-09-26T09:00:00Z", kind: "skip", who: "0xagent", mandateId: "m-1",
    periodKey: "2026-W39", reason: "period-already-bought" });
  await l.record({ at: "2026-09-26T10:00:00Z", kind: "deposit", who: "0xkenji", amountIn: 50_000_000n });
  const v = await l.view();
  assert.equal(v.mandates.length, 1);
  assert.equal(v.mandates[0].perRunCap, 20_000_000n, "bigint restored from disk");
  assert.deepEqual(v.spentByPeriod, { "m-1": { "2026-W39": 20_000_000n } });
  assert.deepEqual(v.boughtPeriods, { "m-1": ["2026-W39"] });
});

test("revoke stamps revokedAt; the file is plain JSON with string amounts", async () => {
  const l = fresh();
  await l.addMandate(m);
  await l.revoke("m-1", 1758800000);
  assert.equal((await l.view()).mandates[0].revokedAt, 1758800000);
  const raw = JSON.parse(readFileSync(l.path, "utf8"));
  assert.equal(raw.mandates[0].perRunCap, "20000000");
});

// A buy the cap check cannot see is worse than a refused buy: `view()` matches the exact string
// "buy" and keys by `periodKey`, so a typo files real money where no cap will ever count it.
test("record refuses an unknown kind — `Buy` must not slip past the cap check", async () => {
  const l = fresh();
  await assert.rejects(() => l.record(buy({ kind: "Buy" })), /unknown entry kind/);
  await assert.rejects(() => l.record(buy({ kind: "Buy" })), TypeError);
  await assert.rejects(() => l.record(buy({ kind: "purchase" })), /unknown entry kind/);
  assert.deepEqual((await l.view()).spentByPeriod, {}, "nothing was written");
});

test("record refuses a buy missing any field the cap check reads", async () => {
  const l = fresh();
  for (const field of ["mandateId", "periodKey", "amountIn", "amountOut"])
    await assert.rejects(() => l.record(buy({ [field]: undefined })),
      (e) => e instanceof TypeError && /buy entry requires/.test(e.message) && e.message.includes(field));
  // present but the wrong type is the same hazard: a Number amountIn makes checkMandate throw
  await assert.rejects(() => l.record(buy({ amountIn: 20_000_000 })), /buy entry requires amountIn \(bigint\)/);
  assert.deepEqual((await l.view()).spentByPeriod, {}, "nothing was written");
});

test("record refuses a skip that does not say which mandate, period or reason", async () => {
  const l = fresh();
  const skip = { at: "2026-09-26T09:00:00Z", kind: "skip", who: "0xagent", mandateId: "m-1",
    periodKey: "2026-W39", reason: "period-already-bought" };
  for (const field of ["mandateId", "periodKey", "reason"])
    await assert.rejects(() => l.record({ ...skip, [field]: undefined }),
      (e) => e instanceof TypeError && /skip entry requires/.test(e.message) && e.message.includes(field));
  await l.record(skip);   // the complete one is accepted
});

test("a deposit needs no mandate", async () => {
  const l = fresh();
  await l.record({ at: "2026-09-26T10:00:00Z", kind: "deposit", who: "0xkenji", amountIn: 50_000_000n });
  assert.deepEqual((await l.view()).spentByPeriod, {});
});

test("addMandate refuses a duplicate id; revoke keeps the first revokedAt", async () => {
  const l = fresh();
  await l.addMandate(m);
  await assert.rejects(() => l.addMandate({ ...m, perRunCap: 1n }), /already exists/);
  assert.equal((await l.mandates()).length, 1);
  await l.revoke("m-1", 1758800000);
  await l.revoke("m-1", 1758900000);
  assert.equal((await l.view()).mandates[0].revokedAt, 1758800000, "a later revoke must not move the first");
  await assert.rejects(() => l.revoke("m-2", 1), /no mandate m-2/);
});

test("two buys in one period sum; mandates and periods stay apart", async () => {
  const l = fresh();
  await l.addMandate(m);
  await l.addMandate({ ...m, id: "m-2" });
  await l.record(buy({ amountIn: 10_000_000n }));
  await l.record(buy({ amountIn: 5_000_000n }));
  await l.record(buy({ periodKey: "2026-W40", amountIn: 7_000_000n }));
  await l.record(buy({ mandateId: "m-2", amountIn: 3_000_000n }));
  const v = await l.view();
  assert.deepEqual(v.spentByPeriod, {
    "m-1": { "2026-W39": 15_000_000n, "2026-W40": 7_000_000n },
    "m-2": { "2026-W39": 3_000_000n },
  });
  assert.deepEqual(v.boughtPeriods, { "m-1": ["2026-W39", "2026-W40"], "m-2": ["2026-W39"] });
});

test("only the four amount fields become strings on disk", async () => {
  const l = fresh();
  await l.addMandate(m);
  await l.record(buy());
  const raw = JSON.parse(readFileSync(l.path, "utf8"));
  assert.equal(typeof raw.entries[0].amountIn, "string");
  assert.equal(typeof raw.entries[0].amountOut, "string");
  assert.equal(typeof raw.entries[0].price, "number", "price is a rate, not an amount");
  assert.equal(raw.entries[0].price, 2739.7);
  assert.equal(typeof raw.mandates[0].expiresAt, "number");
  assert.equal(typeof raw.mandates[0].nonce, "number");
});

test("the default passbook path is a real path, not a percent-encoded URL", async () => {
  const saved = process.env.PASSBOOK_PATH;
  delete process.env.PASSBOOK_PATH;   // the default is what is under test
  try {
    const { path } = ledgerByName("file");
    assert.ok(path.endsWith("/uniswap/.state/passbook.json"), path);
    assert.ok(!path.includes("%"), path);
  } finally {
    if (saved === undefined) delete process.env.PASSBOOK_PATH; else process.env.PASSBOOK_PATH = saved;
  }
});

test("defaultPath decodes a checkout under a path with spaces or Korean characters", async () => {
  const p = defaultPath("file:///Users/a%20b/%ED%94%84%EB%A1%9C%EC%A0%9D%ED%8A%B8/uniswap/src/ledger/index.js");
  assert.ok(p.includes("/a b/프로젝트/"), p);
  assert.ok(!p.includes("%"), p);
  assert.equal(p, "/Users/a b/프로젝트/uniswap/.state/passbook.json");
});
