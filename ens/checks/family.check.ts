// ens/checks/family.check.ts
// Checks for the pure modules in ens/src and for prepareSend (with a fake chain).
//
//   cd ens && npm run check
import { checkAmount, formatUsdc, isSendRequest, parseSendRequest } from "../src/send-request";

let fails = 0;
let passes = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) passes++;
  else {
    fails++;
    console.log(`✗ ${name}${detail ? `  (${detail})` : ""}`);
  }
}
const ser = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? `${x}n` : x));
const same = (a: unknown, b: unknown) => ser(a) === ser(b);

// ── send-request ────────────────────────────────────────────────────────────
ok("send: plain", isSendRequest("send Minjun 20 USDC"));
ok("send: give … to", isSendRequest("give 5 USDC to Seoyeon"));
ok("send: transfer", isSendRequest("transfer 1.5 usdc to my grandson"));
ok("not send: no amount", !isSendRequest("send Seoyeon her pocket money"));
ok("not send: no verb", !isSendRequest("Minjun has 20 USDC"));
ok("not send: other currency", !isSendRequest("send Minjun 20 dollars"));

ok("parse: integer", same(parseSendRequest("send Minjun 20 USDC"), { amountMicro: 20_000_000n, kinship: null }));
ok("parse: glued unit", same(parseSendRequest("send Minjun 20usdc"), { amountMicro: 20_000_000n, kinship: null }));
ok("parse: trailing dot", same(parseSendRequest("send Minjun 20 USDC."), { amountMicro: 20_000_000n, kinship: null }));
ok("parse: dollar sign", same(parseSendRequest("send Minjun $20 USDC"), { amountMicro: 20_000_000n, kinship: null }));
ok("parse: decimals", same(parseSendRequest("send Minjun 0.25 USDC"), { amountMicro: 250_000n, kinship: null }));
ok("parse: 6 decimals", same(parseSendRequest("send Minjun 0.000001 USDC"), { amountMicro: 1n, kinship: null }));
ok("parse: 7 decimals rejected", parseSendRequest("send Minjun 0.1234567 USDC") === null);
ok("parse: thousands separator rejected", parseSendRequest("send Minjun 1,000 USDC") === null);
ok("parse: two amounts rejected", parseSendRequest("send Minjun 20 USDC and Seoyeon 10 USDC") === null);
ok("parse: grandson", parseSendRequest("send my grandson 20 USDC")?.kinship === "grandson");
ok("parse: granddaughter", parseSendRequest("send my granddaughter 20 USDC")?.kinship === "granddaughter");
ok("parse: grandchild", parseSendRequest("send my grandchild 5 USDC")?.kinship === "grandchild");
ok("parse: daughter-in-law", parseSendRequest("send my daughter-in-law 5 USDC")?.kinship === "daughter-in-law");
ok("parse: son-in-law", parseSendRequest("send my son-in-law 5 USDC")?.kinship === "son-in-law");
ok("parse: son", parseSendRequest("send my son 5 USDC")?.kinship === "son");
ok("parse: daughter", parseSendRequest("send my daughter 5 USDC")?.kinship === "daughter");
ok("parse: child", parseSendRequest("send my child 5 USDC")?.kinship === "child");
ok("parse: 'grandson' is not 'son'", parseSendRequest("send my grandson 5 USDC")?.kinship !== "son");
ok("precedence: amount → send", isSendRequest("give Seoyeon her pocket money, 5 USDC"));
ok("precedence: no amount → not send", !isSendRequest("give Seoyeon her pocket money, open the video"));

ok("amount: zero too small", checkAmount(0n) === "too-small");
ok("amount: 0.009999 too small", checkAmount(9_999n) === "too-small");
ok("amount: 0.01 ok", checkAmount(10_000n) === "ok");
ok("amount: 100 ok", checkAmount(100_000_000n) === "ok");
ok("amount: 100.000001 too large", checkAmount(100_000_001n) === "too-large");
ok("format: 20", formatUsdc(20_000_000n) === "20");
ok("format: 0.25", formatUsdc(250_000n) === "0.25");

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
