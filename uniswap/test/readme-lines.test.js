// uniswap/README.md points into the app by line number — the prize asks the README to point at the
// lines of code — and code moves. Each link names the line it must land on; this fails with where
// that line is now.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const here = path.dirname(new URL(import.meta.url).pathname);
const PKG = path.join(here, "..");

/** the README's line links in order, and what each linked line holds */
const EXPECT = [
  ["invest.ts", "export const INVEST_CHAIN = {"],
  ["invest.ts", "async function quote("],
  ["invest.ts", "if ((await allowanceNow()) < amountIn) {"],
  ["invest.ts", "const amountOutMinimum ="],
  ["invest.ts", 'functionName: "exactInputSingle",'],
  ["invest.ts", "const receipt = await client.waitForTransactionReceipt({ hash: txHash })"],
  ["uniswap-api.ts", "export function wethReceived("],
  ["invest.ts", "export async function investedPosition("],
  ["recurring-record.ts", "export function decideRun("],
  ["recurring.ts", "async function runLocked("],
  ["recurring.ts", "bought = await investViaUniswap("],
  ["approvals.ts", "if (claimed.kind === RECURRING_BUY_KIND) return adoptRecurringBuy("],
  // Through the Uniswap Trading API
  ["uniswap-api.ts", "export async function buyWethWithUsdc("],
  ["invest.ts", "const fill = await buyWethWithUsdc({"],
  ["uniswap-api.ts", "export const TRADING_API = {"],
  ["uniswap-api.ts", "function exactApproval("],
  ["uniswap-api.ts", 'const answer = await call(deps, "/quote", {'],
  ["invest.ts", "const minOut = apiKey"],
  ["uniswap-api.ts", "if (min < req.minOut)"],
  ["uniswap-api.ts", "if (floor < req.minOut)"],
  ["uniswap-api.ts", "function typedData("],
  ["uniswap-api.ts", 'const swap = await call(deps, "/swap",'],
  ["uniswap-api.ts", "p.committed = true;"],
  ["uniswap-api.ts", 'await call(deps, "/order", { signature, quote, routing });'],
  ["uniswap-api.ts", "async function orderFill("],
  ["recurring-record.ts", "r.orderHash !== undefined"],
  ["recurring.ts", "route: bought.route,"],
];

test("uniswap/README.md line links land on the code they describe", () => {
  const md = fs.readFileSync(path.join(PKG, "README.md"), "utf8");
  const links = [...md.matchAll(/\]\((\.\.\/app\/[^#)]+)#L(\d+)\)/g)].map((m) => ({ rel: m[1], line: Number(m[2]) }));
  assert.equal(links.length, EXPECT.length, `the README has ${links.length} line links and EXPECT ${EXPECT.length} — keep them in step`);
  const wrong = [];
  links.forEach(({ rel, line }, i) => {
    const [file, holds] = EXPECT[i];
    assert.ok(rel.endsWith(`/${file}`), `link ${i + 1} is ${rel}; EXPECT has …/${file} there`);
    const src = fs.readFileSync(path.join(PKG, rel), "utf8").split("\n");
    if (src[line - 1]?.includes(holds)) return;
    const now = src.findIndex((l) => l.includes(holds)) + 1;
    wrong.push(`${file}#L${line} should land on \`${holds}\` — ${now ? `that line is L${now} now` : "no line holds it any more"}`);
  });
  assert.deepEqual(wrong, [], `\n${wrong.join("\n")}`);
});
