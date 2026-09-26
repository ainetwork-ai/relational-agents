// Every code the World ID callback / connect routes can send back has one line
// in world-result-copy.ts, read the same by the room panel and the /treasury page.
//
//   ./node_modules/.bin/tsx --tsconfig scripts/tsconfig.json scripts/world-result-copy.check.mts

import { readFileSync } from "node:fs";
import { RESULT_CODES, TREASURY_RESULT, WORLD_RESULT, resultCopy } from "../src/components/treasury/world-result-copy";

let fail = 0;
const check = (ok: boolean, what: string) => {
  if (!ok) fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${what}`);
};

for (const code of RESULT_CODES) {
  const c = resultCopy("treasury", code);
  check(!!c && c.text.length > 0, `?treasury=${code} → ${c ? c.text : "(nothing)"}`);
}
for (const code of Object.keys(TREASURY_RESULT))
  check((RESULT_CODES as readonly string[]).includes(code), `${code} is a code a route sends`);
for (const code of Object.keys(WORLD_RESULT))
  check(resultCopy("world", code) !== resultCopy("treasury", code), `?world=${code} keeps its own meaning`);
check(resultCopy("treasury", "<script>") === null && resultCopy("treasury", "toString") === null, "an unknown code shows nothing");

// the codes the routes actually write, read from their source
const routes = ["src/app/api/auth/world/callback/route.ts", "src/app/api/auth/world/connect/route.ts", "src/lib/agent/treasury/approvals.ts"];
const sent = new Set<string>();
for (const f of routes)
  for (const m of readFileSync(new URL(`../${f}`, import.meta.url), "utf8").matchAll(/(?:back|done)\("([a-z-]+)"\)|reason: "([a-z-]+)"/g))
    sent.add(m[1] ?? m[2]);
for (const code of sent) check(resultCopy("treasury", code) !== null, `${code} (sent by a route) has a line`);

console.log(fail ? `\n${fail} failed` : "\nall passed");
process.exit(fail ? 1 : 0);
