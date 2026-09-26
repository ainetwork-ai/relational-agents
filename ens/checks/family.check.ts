// ens/checks/family.check.ts
// Checks for the pure modules in ens/src and for prepareSend (with a fake chain).
//
//   cd ens && npm run check
import { checkAmount, formatUsdc, isSendRequest, isSendWithoutAmount, kinshipOf, parseSendRequest } from "../src/send-request";
import { descendants, displayName, findNodeByAddress, matchesKinship, pickAnswer, pickRecipients, type FamilyNode } from "../src/family-tree";
import { CONFIRM_GRACE_MS, markConfirmed, markSent, releaseSent, signSendIntent, verifySendIntent, verifySendIntentForConfirm, wasConfirmed, wasSent } from "../src/send-token";
import { decodeFunctionData, encodeAbiParameters, encodeEventTopics, erc20Abi, getAddress, type Log } from "viem";
import { receiptOutcome } from "../src/chain";
import { prepareSend } from "../src/prepare";
import { SEPOLIA_USDC } from "../src/config";
import { checkLabel, suggestLabels } from "../src/labels";

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
ok("no amount: send … some money", isSendWithoutAmount("send Minjun some money"));
ok("no amount: transfer usdc", isSendWithoutAmount("transfer USDC to Seoyeon"));
ok("no amount: with an amount it is a send request", !isSendWithoutAmount("send Minjun 20 USDC"));
ok("no amount: no money word", !isSendWithoutAmount("send me the photos"));
ok("no amount: no send verb", !isSendWithoutAmount("how much money does Minjun have"));
ok("kinship: said", kinshipOf("send my grandson some money") === "grandson");
ok("kinship: not said", kinshipOf("send Minjun some money") === null);

ok("amount: zero too small", checkAmount(0n) === "too-small");
ok("amount: 0.009999 too small", checkAmount(9_999n) === "too-small");
ok("amount: 0.01 ok", checkAmount(10_000n) === "ok");
ok("amount: 100 ok", checkAmount(100_000_000n) === "ok");
ok("amount: 100.000001 too large", checkAmount(100_000_001n) === "too-large");
ok("format: 20", formatUsdc(20_000_000n) === "20");
ok("format: 0.25", formatUsdc(250_000n) === "0.25");

// ── family-tree ─────────────────────────────────────────────────────────────
const node = (label: string, parent: string, relation: FamilyNode["relation"], alias: string | null, address: string | null, children: FamilyNode[] = []): FamilyNode => ({
  name: `${label}.${parent}`,
  label,
  alias,
  relation,
  avatar: null,
  address: address as FamilyNode["address"],
  children,
});
const ROOT = "kim.ainmem.eth";
const minjun = node("minjun", `dad.grandma.${ROOT}`, "son", "Minjun", "0x00000000000000000000000000000000000000a1");
const seoyeon = node("seoyeon", `dad.grandma.${ROOT}`, "daughter", "Seoyeon", "0x00000000000000000000000000000000000000a2");
const mom = node("mom", `dad.grandma.${ROOT}`, "spouse", "Mom", "0x00000000000000000000000000000000000000a3");
const min = node("min", `aunt.grandma.${ROOT}`, "son", "Min", "0x00000000000000000000000000000000000000a4");
const uncle = node("uncle", `aunt.grandma.${ROOT}`, "spouse", "Uncle", "0x00000000000000000000000000000000000000a5");
const dad = node("dad", `grandma.${ROOT}`, "son", "Dad", "0x00000000000000000000000000000000000000b1", [mom, minjun, seoyeon]);
const aunt = node("aunt", `grandma.${ROOT}`, "daughter", "Aunt", "0x00000000000000000000000000000000000000b2", [uncle, min]);
const grandma = node("grandma", ROOT, null, "Grandma", "0x00000000000000000000000000000000000000c1", [dad, aunt]);
const greatAunt = node("greataunt", ROOT, null, "Great-aunt", "0x00000000000000000000000000000000000000c2");
const tree: FamilyNode = { name: ROOT, label: "kim", alias: "Kim family", relation: null, avatar: null, address: null, children: [grandma, greatAunt] };
const names = (xs: FamilyNode[]) => xs.map((x) => x.label).sort().join(",");

ok("find: by address, any case", findNodeByAddress(tree, "0x00000000000000000000000000000000000000C1")?.label === "grandma");
ok("find: unknown address", findNodeByAddress(tree, "0x00000000000000000000000000000000000000ff") === null);
ok("descendants: all 7 below grandma", descendants(grandma).length === 7);
ok("descendants: path to minjun", descendants(grandma).find((d) => d.node === minjun)?.path.map((p) => p.label).join("/") === "dad/minjun");

ok("kinship: grandson via son", matchesKinship([dad, minjun], "grandson"));
ok("kinship: grandson via daughter", matchesKinship([aunt, min], "grandson"));
ok("kinship: granddaughter", matchesKinship([dad, seoyeon], "granddaughter"));
ok("kinship: spouse is not a grandchild", !matchesKinship([dad, mom], "grandchild"));
ok("kinship: daughter-in-law", matchesKinship([dad, mom], "daughter-in-law"));
ok("kinship: son-in-law", matchesKinship([aunt, uncle], "son-in-law"));
ok("kinship: son", matchesKinship([dad], "son"));
ok("kinship: son is not grandson", !matchesKinship([dad], "grandson"));

ok("pick: by name", names(pickRecipients(grandma, { kinship: null, text: "send Minjun 20 USDC" })) === "minjun");
ok("pick: name is case-insensitive", names(pickRecipients(grandma, { kinship: null, text: "send minjun 20 USDC" })) === "minjun");
ok("pick: 'Min' is not 'Minjun'", names(pickRecipients(grandma, { kinship: null, text: "send Min 20 USDC" })) === "min");
ok("pick: grandson → two candidates", names(pickRecipients(grandma, { kinship: "grandson", text: "send my grandson 5 USDC" })) === "min,minjun");
ok("pick: grandson + name narrows", names(pickRecipients(grandma, { kinship: "grandson", text: "send my grandson Minjun 5 USDC" })) === "minjun");
ok("pick: grandchild", names(pickRecipients(grandma, { kinship: "grandchild", text: "send my grandchild 5 USDC" })) === "min,minjun,seoyeon");
ok("pick: outside the subtree", pickRecipients(grandma, { kinship: null, text: "send Great-aunt 5 USDC" }).length === 0);
ok("pick: nobody named", pickRecipients(grandma, { kinship: null, text: "send 5 USDC" }).length === 0);
ok("pick: never the asker", pickRecipients(grandma, { kinship: null, text: "send Grandma 5 USDC" }).length === 0);
const nick = new Map([[minjun.name, ["Junie"]], [seoyeon.name, ["baby"]], [min.name, ["baby"]]]);
ok("pick: nickname", names(pickRecipients(grandma, { kinship: null, text: "send Junie 5 USDC", nicknames: nick })) === "minjun");
ok("pick: shared nickname → ask", names(pickRecipients(grandma, { kinship: null, text: "send baby 5 USDC", nicknames: nick })) === "min,seoyeon");
ok("answer: one candidate named", pickAnswer("Minjun", [minjun, seoyeon])?.label === "minjun");
ok("answer: by alias, any case, in a sentence", pickAnswer("seoyeon please", [minjun, seoyeon])?.label === "seoyeon");
ok("answer: nickname", pickAnswer("Junie", [minjun, seoyeon], nick)?.label === "minjun");
ok("answer: both named → not an answer", pickAnswer("Minjun and Seoyeon", [minjun, seoyeon]) === null);
ok("answer: 'Min' is not 'Minjun'", pickAnswer("Min", [minjun, seoyeon]) === null);
ok("answer: not a candidate", pickAnswer("Mom", [minjun, seoyeon]) === null);
ok("answer: 'to Minjun'", pickAnswer("to Minjun.", [minjun, seoyeon])?.label === "minjun");
ok("answer: with the agent mentioned", pickAnswer("@agent Minjun", [minjun, seoyeon])?.label === "minjun");
ok("answer: a no is not an answer", pickAnswer("No, not Minjun", [minjun, seoyeon]) === null);
ok("answer: another request is not an answer", pickAnswer("show me Minjun's album", [minjun, seoyeon]) === null);
ok("answer: a new amount is not an answer", pickAnswer("Minjun, 10 USDC", [minjun, seoyeon]) === null);
ok("displayName: alias", displayName(minjun) === "Minjun");
ok("displayName: label fallback", displayName({ ...minjun, alias: null }) === "minjun");

// ── send-token ──────────────────────────────────────────────────────────────
const SECRET = "check-secret-check-secret-check-secret";
const intent = {
  userId: "u1",
  roomId: "r1",
  from: "0x00000000000000000000000000000000000000c1" as const,
  name: `minjun.dad.grandma.${ROOT}`,
  to: "0x00000000000000000000000000000000000000a1" as const,
  amountMicro: "20000000",
};
const T0 = 1_800_000_000_000;
const tok = signSendIntent(intent, SECRET, T0);
ok("token: round trip", same(verifySendIntent(tok, SECRET, T0 + 1000), { ...intent, exp: T0 + 600_000 }));
ok("token: expired", verifySendIntent(tok, SECRET, T0 + 600_001) === null);
ok("token: other secret", verifySendIntent(tok, "another-secret", T0) === null);
const [, mac] = tok.split(".");
const forged = Buffer.from(JSON.stringify({ ...intent, to: "0x00000000000000000000000000000000000000ee", exp: T0 + 600_000 })).toString("base64url");
ok("token: tampered body", verifySendIntent(`${forged}.${mac}`, SECRET, T0) === null);
ok("token: garbage", verifySendIntent("nope", SECRET, T0) === null);
ok("sent: unknown", wasSent(tok) === null);
markSent(tok, "0xabc");
ok("sent: remembered", wasSent(tok) === "0xabc");
ok("sent: other token unaffected", wasSent(signSendIntent(intent, SECRET, T0 + 1)) === null);
ok("confirmed: not before markConfirmed", wasConfirmed(tok) === false);
markConfirmed(tok);
ok("confirmed: remembered", wasConfirmed(tok) === true);
ok("confirmed: other token unaffected", wasConfirmed(signSendIntent(intent, SECRET, T0 + 1)) === false);
ok("grace: expired link still confirmable", verifySendIntentForConfirm(tok, SECRET, T0 + 600_001) !== null);
ok("grace: bounded", verifySendIntentForConfirm(tok, SECRET, T0 + 600_001 + CONFIRM_GRACE_MS) === null);
ok("grace: still needs the secret", verifySendIntentForConfirm(tok, "another-secret", T0 + 600_001) === null);

// ── prepareSend (fake chain) ────────────────────────────────────────────────
const fake = (o: { verify?: boolean; to?: `0x${string}` | null } = {}) => ({
  verifyPath: async () => o.verify ?? true,
  resolveAddress: async (name: string) =>
    o.to !== undefined ? o.to : (descendants(tree).find((d) => d.node.name === name)?.node.address ?? null),
});
const G = grandma.address!;
const r1 = await prepareSend({ text: "send Minjun 20 USDC", askerAddress: G, tree }, fake());
ok("prepare: ready", r1.kind === "ready" && r1.recipient.label === "minjun" && r1.amountMicro === 20_000_000n);
if (r1.kind === "ready") {
  ok("prepare: tx targets USDC", r1.tx.to === SEPOLIA_USDC && r1.tx.value === 0n && r1.tx.chainId === 11155111);
  const call = decodeFunctionData({ abi: erc20Abi, data: r1.tx.data });
  ok("prepare: tx is transfer(to, amount)", call.functionName === "transfer" && same(call.args, [getAddress(minjun.address!), 20_000_000n]));
}
ok("prepare: ask", (await prepareSend({ text: "send my grandchild 5 USDC", askerAddress: G, tree }, fake())).kind === "ask");
ok("prepare: nobody", same(await prepareSend({ text: "send Great-aunt 5 USDC", askerAddress: G, tree }, fake()), { kind: "refuse", reason: "nobody" }));
ok("prepare: not in family", same(await prepareSend({ text: "send Minjun 5 USDC", askerAddress: "0x00000000000000000000000000000000000000ff", tree }, fake()), { kind: "refuse", reason: "not-in-family" }));
ok("prepare: too large", same(await prepareSend({ text: "send Minjun 500 USDC", askerAddress: G, tree }, fake()), { kind: "refuse", reason: "too-large" }));
ok("prepare: no request", same(await prepareSend({ text: "send Minjun some money", askerAddress: G, tree }, fake()), { kind: "refuse", reason: "no-request" }));
ok("prepare: path fails", (await prepareSend({ text: "send Minjun 5 USDC", askerAddress: G, tree }, fake({ verify: false }))).kind === "refuse");
ok("prepare: no address", (await prepareSend({ text: "send Minjun 5 USDC", askerAddress: G, tree }, fake({ to: null }))).kind === "refuse");
ok("prepare: nickname", (await prepareSend({ text: "send Junie 5 USDC", askerAddress: G, tree, nicknames: nick }, fake())).kind === "ready");

// ── receiptOutcome (D2: match / mismatch) ───────────────────────────────────
const transferLog = (o: { address?: `0x${string}`; to?: `0x${string}`; value?: bigint } = {}): Log =>
  ({
    address: o.address ?? SEPOLIA_USDC,
    topics: encodeEventTopics({ abi: erc20Abi, eventName: "Transfer", args: { from: grandma.address!, to: o.to ?? minjun.address! } }),
    data: encodeAbiParameters([{ type: "uint256" }], [o.value ?? 20_000_000n]),
    blockHash: "0x" + "11".repeat(32),
    blockNumber: 1n,
    logIndex: 0,
    transactionHash: "0x" + "22".repeat(32),
    transactionIndex: 0,
    removed: false,
  }) as Log;
const expect = { from: grandma.address!, to: minjun.address!, amountMicro: 20_000_000n };
ok("receipt: matching transfer", receiptOutcome({ status: "success", logs: [transferLog()] }, expect) === "match");
ok("receipt: reverted", receiptOutcome({ status: "reverted", logs: [transferLog()] }, expect) === "mismatch");
ok("receipt: no logs", receiptOutcome({ status: "success", logs: [] }, expect) === "mismatch");
ok("receipt: wrong amount → different, not free", receiptOutcome({ status: "success", logs: [transferLog({ value: 2_000_000n })] }, expect) === "different");
ok("receipt: wrong recipient → different, not free", receiptOutcome({ status: "success", logs: [transferLog({ to: seoyeon.address! })] }, expect) === "different");
ok("receipt: someone else's transfer", receiptOutcome({ status: "success", logs: [transferLog()] }, { ...expect, from: dad.address! }) === "mismatch");
ok("receipt: the right one among others", receiptOutcome({ status: "success", logs: [transferLog({ value: 1n }), transferLog()] }, expect) === "match");
ok("receipt: not the USDC contract", receiptOutcome({ status: "success", logs: [transferLog({ address: "0x00000000000000000000000000000000000000dd" })] }, expect) === "mismatch");
markSent("release-me", "0xAbc");
releaseSent("release-me", "0xdef");
ok("sent: another hash does not free the link", wasSent("release-me") === "0xAbc");
releaseSent("release-me", "0xabc");
ok("sent: released link can pay again", wasSent("release-me") === null);

// ── labels ──────────────────────────────────────────────────────────────────
ok("label: plain", same(checkLabel("lee"), { ok: true, label: "lee" }));
ok("label: trimmed + lowercased", same(checkLabel("  Lee "), { ok: true, label: "lee" }));
ok("label: spaces become hyphens", same(checkLabel("Lee family"), { ok: true, label: "lee-family" }));
ok("label: empty", same(checkLabel("   "), { ok: false, reason: "empty" }));
ok("label: .eth minimum", same(checkLabel("li", { min: 3 }), { ok: false, reason: "too-short" }));
ok("label: subname may be short", same(checkLabel("jo"), { ok: true, label: "jo" }));
ok("label: too long", same(checkLabel("a".repeat(33)), { ok: false, reason: "too-long" }));
ok("label: emoji rejected", same(checkLabel("lee🙂"), { ok: false, reason: "invalid" }));
ok("label: dot rejected", same(checkLabel("lee.kim"), { ok: false, reason: "invalid" }));
ok("label: leading hyphen rejected", same(checkLabel("-lee"), { ok: false, reason: "invalid" }));
ok("label: double hyphen rejected", same(checkLabel("ab--c"), { ok: false, reason: "invalid" }));
ok("suggest: a long base only yields valid labels", same(suggestLabels("a".repeat(31), 2), ["a".repeat(31) + "2", "a".repeat(31) + "3"]));
ok("suggest: family-style candidates", same(suggestLabels("lee", 4), ["lee-family", "the-lees", "lee2", "lee3"]));

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
