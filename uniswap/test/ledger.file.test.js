import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileLedger } from "../src/ledger/file.js";
import { ledgerByName } from "../src/ledger/index.js";

const fresh = () => fileLedger(join(mkdtempSync(join(tmpdir(), "passbook-")), "passbook.json"));
const m = { id: "m-1", roomId: "r", agent: "0xagent", kind: "standing", tokenIn: "0xa", tokenOut: "0xb",
  perRunCap: 20_000_000n, perPeriodCap: 100_000_000n, period: "week", expiresAt: 1798761600, nonce: 1 };

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

test("the default passbook path is a real path, not a percent-encoded URL", async () => {
  delete process.env.PASSBOOK_PATH;   // the default is what is under test
  const { path } = ledgerByName("file");
  assert.ok(path.endsWith("/uniswap/.state/passbook.json"), path);
  assert.ok(!path.includes("%"), `a checkout under "/Users/a b/" would percent-encode: ${path}`);
});

// The assertion above cannot fail in an all-ASCII checkout: there `.pathname` and `fileURLToPath`
// return the same string. This one pins the API choice itself, which is what a checkout under
// "/Users/a b/" or a Korean path actually depends on.
test("the default path is built with fileURLToPath, not the percent-encoding .pathname", async () => {
  const src = readFileSync(new URL("../src/ledger/index.js", import.meta.url), "utf8");
  assert.match(src, /fileURLToPath\(new URL\(/);
  assert.doesNotMatch(src, /\)\.pathname/, "new URL(...).pathname percent-encodes; use fileURLToPath");
});
