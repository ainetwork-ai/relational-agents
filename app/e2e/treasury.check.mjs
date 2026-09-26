// Relation Treasury — the Tokyo Trip demo, played end to end over HTTP.
//
// Six accounts in the seeded "Tokyo Trip" room talk to the agent; approvals go
// through the real step-up (connect's confirmation page → its form → IdP
// authorize → callback) against the local mock of the World ID for Agents IdP
// (WORLD_IDP=mock), and one payment
// moves real Sepolia ETH. The approval that completes a quorum lands on
// ?treasury=executing without waiting for the chain; the payment, the relayer's
// gas refund and the agent's chat line are then polled for (≤180s), and the
// treasury must have moved by exactly the payment. Each scene prints PASS/FAIL;
// exit 1 on any FAIL.
//
//   cd app && npx tsx --tsconfig scripts/tsconfig.json scripts/seed-tokyo-trip.mts   # once (--reset for a clean room)
//   node e2e/treasury.check.mjs            [BASE_URL=http://localhost:36625]
//
// Needs POSTGRES_URL (env or app/.env.local) for the scenes that have no HTTP
// lever: clearing the demo accounts' World ID bindings at the start, lifting a
// seat for the not-seated scene, and backdating a proof (by moving the
// request's createdAt forward) for the stale-proof scene. Every row it touches
// is put back. When the treasury holds less than $950 the seed is re-run first
// (no --reset: it only tops the wallet up to $1,000); TOPUP=0 turns that off.
//
// Browser must not be needed: fetch with a cookie jar per account, redirects
// followed by hand so every hop can be asserted.

import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import pg from "pg";

const BASE = process.env.BASE_URL ?? "http://localhost:36625";
const APP_DIR = fileURLToPath(new URL("..", import.meta.url));
const RPC = process.env.SEPOLIA_RPC ?? "https://ethereum-sepolia-rpc.publicnode.com";
const REPLY_TIMEOUT_MS = 90_000;
/** quorum → payment confirmed → gas refund confirmed, a few Sepolia blocks */
const EXECUTION_TIMEOUT_MS = 180_000;
/** the callback only records the approval; the chain is not on its path */
const CALLBACK_BUDGET_MS = 8_000;

const RULE_MID = "Shared expenses from $50 to $200: 2 verified members approve.";
const RULE_PERSONAL = "Sending treasury money to a member's personal wallet: not allowed.";
const HOTEL = "Hotel Gracery Shinjuku";

function envLocal(key) {
  if (process.env[key]) return process.env[key];
  try {
    const line = readFileSync(new URL("../.env.local", import.meta.url), "utf8")
      .split("\n")
      .find((l) => l.startsWith(`${key}=`));
    return line ? line.slice(key.length + 1).trim().replace(/^["']|["']$/g, "") : undefined;
  } catch {
    return undefined;
  }
}

const POSTGRES_URL = envLocal("POSTGRES_URL");
const sql = POSTGRES_URL ? new pg.Pool({ connectionString: POSTGRES_URL, max: 2 }) : null;

// ── accounts ────────────────────────────────────────────────────────────────

class Account {
  constructor(slug, name) {
    this.slug = slug;
    this.name = name;
    this.cookies = new Map();
    this.id = null;
  }
  absorb(res) {
    for (const line of res.headers.getSetCookie()) {
      const [pair, ...attrs] = line.split(";");
      const eq = pair.indexOf("=");
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      const gone = !value || attrs.some((a) => /^\s*max-age=0\s*$/i.test(a));
      if (gone) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }
  async fetch(path, init = {}) {
    const url = new URL(path, BASE);
    const res = await fetch(url, {
      ...init,
      redirect: "manual",
      headers: { ...(init.headers ?? {}), cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ") },
    });
    this.absorb(res);
    return res;
  }
  async json(path, init) {
    const res = await this.fetch(path, init);
    const body = await res.json().catch(() => ({}));
    return { status: res.status, body };
  }
  async login() {
    const r = await this.json("/api/auth/demo-login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ as: this.slug }),
    });
    if (r.status !== 200 || !r.body.user) throw new Error(`login ${this.slug}: ${r.status}`);
    if (r.body.user.displayName !== this.name)
      throw new Error(`login ${this.slug}: got "${r.body.user.displayName}" — has the seed run?`);
    this.id = r.body.user.id;
    return this;
  }
}

const alex = new Account("tokyo-alex", "Alex");
const bea = new Account("tokyo-bea", "Bea");
const chris = new Account("tokyo-chris", "Chris");
const dana = new Account("tokyo-dana", "Dana");
const eli = new Account("tokyo-eli", "Eli");
const alex2 = new Account("tokyo-alex2", "Alex (2nd account)");
const outsider = new Account("tokyo-outsider", "tokyo-outsider");

// ── helpers ─────────────────────────────────────────────────────────────────

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Polls `probe` until it returns something truthy; throws `what` after `timeoutMs`. */
async function until(probe, timeoutMs, what, everyMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const got = await probe();
    if (got) return got;
    if (Date.now() >= deadline) throw new Error(`${what} (after ${timeoutMs / 1000}s)`);
    await sleep(everyMs);
  }
}

let roomId = null;
/** how long the last approval's callback hop took */
let lastCallbackMs = null;
let agentId = null;

async function status(who = alex) {
  const r = await who.json(`/api/dm/rooms/${roomId}/treasury`);
  assert(r.status === 200, `treasury status ${r.status}`);
  return r.body;
}

/** Posts as `who`, then waits for the agent's first message after it. */
async function ask(who, text) {
  const sent = await who.json(`/api/dm/rooms/${roomId}/messages`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text }),
  });
  assert(sent.status === 201, `send "${text}": ${sent.status} ${JSON.stringify(sent.body)}`);
  const mine = sent.body.message.id;
  const deadline = Date.now() + REPLY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await sleep(1_000);
    const { body } = await who.json(`/api/dm/rooms/${roomId}/messages`);
    const list = body.messages ?? [];
    const at = list.findIndex((m) => m.id === mine);
    const reply = at >= 0 ? list.slice(at + 1).find((m) => m.authorId === agentId) : null;
    if (reply) return reply.text;
  }
  throw new Error(`no agent reply to "${text}" within ${REPLY_TIMEOUT_MS / 1000}s`);
}

/** Agent messages posted after a given message id (approval notices, voided notices, payouts). */
async function agentLinesSince(who, afterCount) {
  const { body } = await who.json(`/api/dm/rooms/${roomId}/messages`);
  return (body.messages ?? []).slice(afterCount).filter((m) => m.authorId === agentId).map((m) => m.text);
}

async function messageCount(who = alex) {
  const { body } = await who.json(`/api/dm/rooms/${roomId}/messages`);
  return (body.messages ?? []).length;
}

/**
 * The approval step-up, hop by hop: connect (GET: the confirmation page that
 * shows what is being approved; POST: its form) → IdP authorize (the mock
 * picks `human` or cancels) → callback. Returns the ?treasury= code the member
 * lands on — from connect itself when the approval could not count anyway.
 */
async function approve(who, actionId, idp) {
  const back = `/dm/${roomId}`;
  const page = await who.fetch(`/api/auth/world/connect?action=${encodeURIComponent(actionId)}&returnTo=${encodeURIComponent(back)}`);
  if (page.status >= 300 && page.status < 400) {
    const refused = new URL(page.headers.get("location"), BASE);
    assert(refused.pathname === back, `connect refused to ${refused}`);
    return refused.searchParams.get("treasury");
  }
  assert(page.status === 200, `connect: expected the confirmation page, got ${page.status}`);
  const html = await page.text();
  assert(!page.headers.has("location") && who.cookies.get("world_action") === undefined, "the confirmation page started the IdP flow");
  const form = Object.fromEntries(
    [...html.matchAll(/<input type="hidden" name="([a-zA-Z]+)" value="([^"]*)">/g)].map((m) => [
      m[1],
      m[2].replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&"),
    ])
  );
  assert(form.action === actionId && form.token && form.exp, `confirmation form: ${JSON.stringify(Object.keys(form))}`);
  if (ctx.expectOnCard) for (const s of ctx.expectOnCard) assert(html.includes(s), `confirmation page does not show ${s}`);

  const c = await who.fetch("/api/auth/world/connect", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form).toString(),
  });
  assert(c.status === 303, `connect POST: expected a 303 redirect, got ${c.status}`);
  const toIdp = new URL(c.headers.get("location"), BASE);
  if (toIdp.pathname === back) return toIdp.searchParams.get("treasury");
  assert(toIdp.pathname.endsWith("/authorize"), `connect went to ${toIdp}`);
  assert(toIdp.searchParams.get("max_age") === "0" && toIdp.searchParams.get("prompt") === "login", "step-up must force a fresh login");
  assert(who.cookies.get("world_action") === actionId, "connect did not carry the action");
  if (idp.deny) toIdp.searchParams.set("deny", "1");
  else toIdp.searchParams.set("human", String(idp.human));

  const a = await who.fetch(toIdp.toString());
  assert(a.status >= 300 && a.status < 400, `authorize: expected a redirect, got ${a.status}`);
  const toCallback = new URL(a.headers.get("location"), BASE);
  assert(toCallback.pathname === "/api/auth/world/callback", `authorize went to ${toCallback}`);

  const t0 = Date.now();
  const cb = await who.fetch(toCallback.pathname + toCallback.search);
  lastCallbackMs = Date.now() - t0;
  assert(cb.status >= 300 && cb.status < 400, `callback: expected a redirect, got ${cb.status}`);
  const landed = new URL(cb.headers.get("location"), BASE);
  assert(landed.pathname === back, `callback landed on ${landed.pathname}`);
  assert(![...who.cookies.keys()].some((k) => k.startsWith("world_")), "world_* cookies not cleared");
  return landed.searchParams.get("treasury");
}

function freshActions(before, st) {
  return st.actions.filter((a) => !before.has(a.id));
}

/** The Treasury Activity page's blocks, each as its JSON text. */
async function activityTexts(who = alex) {
  const act = await who.json(`/api/pages/${ctx.activityId}/blocks`);
  assert(act.status === 200, `activity page ${act.status}`);
  return (act.body.blocks ?? []).map((b) => JSON.stringify(b));
}

async function rpc(method, params) {
  const r = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const j = await r.json();
  if (j.error) throw new Error(`${method}: ${j.error.message}`);
  return j.result;
}

/** The first transaction of exactly `value` wei to `to` from block `from` up to the chain head (at most 30 blocks); null if none. */
async function findTransfer(to, value, from) {
  const head = BigInt(await rpc("eth_blockNumber", []));
  for (let n = from; n <= head && n < from + 30n; n++) {
    const block = await rpc("eth_getBlockByNumber", [`0x${n.toString(16)}`, true]);
    const hit = (block?.transactions ?? []).find(
      (tx) => tx.to && tx.to.toLowerCase() === to.toLowerCase() && BigInt(tx.value) === value
    );
    if (hit) return hit.hash;
  }
  return null;
}

const pageId = (path) => Buffer.from(path, "utf8").toString("base64url");
const pagePath = (id) => Buffer.from(id, "base64url").toString("utf8");

async function worldSubOf(userId) {
  const { rows } = await sql.query("select world_sub from users where id = $1", [userId]);
  return rows[0]?.world_sub ?? null;
}

// ── scenes ──────────────────────────────────────────────────────────────────

const results = [];
async function scene(name, fn) {
  const t0 = Date.now();
  try {
    const note = await fn();
    results.push(true);
    console.log(`PASS  ${name}${note ? ` — ${note}` : ""} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  } catch (err) {
    results.push(false);
    console.log(`FAIL  ${name} — ${err.message}`);
  }
}

const ctx = {};

await scene("setup: seeded room, five in it plus the 2nd account Alex invites, treasury on", async () => {
  for (const a of [alex, bea, chris, dana, eli, alex2, outsider]) await a.login();
  const { body } = await alex.json("/api/dm/rooms");
  const room = (body.rooms ?? []).find((r) => r.name === "Tokyo Trip");
  assert(room, `Alex has no "Tokyo Trip" room — run scripts/seed-tokyo-trip.mts`);
  roomId = room.id;
  agentId = room.members.find((m) => m.isAgent)?.id;
  assert(agentId, "the room has no agent");

  if (sql) {
    // every run exercises a first-time binding: Human 1 → Alex, Human 3 → Chris
    await sql.query(
      "update users set world_sub = null, world_verified_at = null where ain_address like 'demo:tokyo-%'"
    );
  }

  let st = await status();
  assert(st.enabled, "treasury is not enabled for the room");
  assert(st.idpMode === "mock", `idpMode is ${st.idpMode} — set WORLD_IDP=mock in app/.env.local`);
  if (st.balanceUsd !== null && st.balanceUsd < 950 && process.env.TOPUP !== "0") {
    console.log(`      treasury holds $${st.balanceUsd} — topping up to $1,000 with the seed…`);
    execFileSync("npx", ["tsx", "--tsconfig", "scripts/tsconfig.json", "scripts/seed-tokyo-trip.mts"], {
      cwd: APP_DIR,
      stdio: ["ignore", "ignore", "inherit"],
      timeout: 300_000,
    });
    st = await status();
  }
  assert(st.balanceUsd !== null && st.balanceUsd >= 900, `treasury balance ${st.balanceUsd} (need ≥ $900)`);
  assert(st.rules.includes(RULE_MID) && st.rules.includes(RULE_PERSONAL), "the demo rules are not all parsed");
  assert(st.adoptedAt, "the rules are not adopted — run the seed (--reset)");
  assert(!st.proposal, `the doc differs from the adopted rules: ${JSON.stringify(st.proposal)} — run the seed with --reset`);

  // scene 2: the 2nd account is not one of the five — Alex invites it after
  // the rules were adopted, so it is in the room but not in the electorate
  if (!st.members.find((m) => m.userId === alex2.id)) {
    const inv = await alex.json(`/api/dm/rooms/${roomId}/members`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: alex2.id }),
    });
    assert(inv.status === 201, `inviting the 2nd account: ${inv.status} ${JSON.stringify(inv.body)}`);
    st = await status();
  }
  const second = st.members.find((m) => m.userId === alex2.id);
  assert(second && second.voting === false, `the 2nd account should be in the room without a vote: ${JSON.stringify(second)}`);
  assert(st.proposal && st.proposal.joined.length === 1 && !st.proposal.added.length, `joining should propose the new membership only: ${JSON.stringify(st.proposal)}`);
  ctx.address = st.address;
  ctx.activityId = pageId(pagePath(st.rulesPageId).replace(/Treasury Rules\.md$/, "Treasury Activity.md"));
  return `room ${roomId}, wallet ${st.address}, $${st.balanceUsd}, seat mode ${st.seatMode}`;
});

await scene("a. seats — Alex and Bea claim; Alex's 2nd account per the seat mode", async () => {
  const st0 = await status();
  const claim = (who) =>
    who.json(`/api/dm/rooms/${roomId}/treasury/seat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
  let note;
  if (st0.seatMode === "dev-simulator") {
    for (const who of [alex, bea]) {
      const r = await claim(who);
      assert(r.status === 200 && r.body.ok === true, `${who.name} seat: ${r.status} ${JSON.stringify(r.body)}`);
    }
    // the simulator's nullifier is per account: one human, one seat needs real
    // IDKit nullifiers — same-human is caught at approval time instead (scene d)
    const r2 = await claim(alex2);
    assert(r2.status === 200 && r2.body.ok === true, `2nd account seat (simulator): ${r2.status}`);
    note = "2nd account got a seat too (dev simulator: per-account nullifier — same-human is asserted at approval, scene d)";
  } else {
    // a real IDKit mode: no proof can be made headless, so a claim without one
    // must be refused, and Alex and Bea are seated directly (as scene d seats
    // the 2nd account). One human, one seat is then the verifier's nullifier —
    // not exercised here; same-human is still asserted at approval (scene d).
    for (const who of [alex, bea, alex2]) {
      const r = await claim(who);
      assert(r.status === 400 && r.body.reason === "proof-rejected", `${who.name} seat without a proof (${st0.seatMode}): ${r.status} ${JSON.stringify(r.body)}`);
    }
    assert(sql, `seat mode ${st0.seatMode} needs POSTGRES_URL to seat Alex and Bea`);
    for (const who of [alex, bea])
      await sql.query(
        "insert into treasury_seats (room_id, user_id, nullifier_hash, verification_level) values ($1, $2, $3, 'dev-simulator') on conflict do nothing",
        [roomId, who.id, `e2e:${who.id}`]
      );
    note = `${st0.seatMode}: claims without a proof refused (400); Alex and Bea seated directly`;
  }
  const st = await status();
  const seated = st.members.filter((m) => m.seated).map((m) => m.displayName);
  for (const n of ["Alex", "Bea", "Chris", "Dana", "Eli"]) assert(seated.includes(n), `${n} is not seated`);
  const outsiderSeat = await outsider.json(`/api/dm/rooms/${roomId}/treasury/seat`, { method: "POST", body: "{}" });
  assert(outsiderSeat.status === 403 || outsiderSeat.status === 404, `outsider seat: ${outsiderSeat.status}`);
  return note;
});

await scene("b. $180 hotel deposit — cites the $50–$200 rule, waits for 2 verified humans", async () => {
  const before = new Set((await status()).actions.map((a) => a.id));
  ctx.balanceBefore180 = (await status()).balanceUsd;
  const reply = await ask(alex, "@agent pay the hotel deposit, $180");
  assert(reply.includes(`“${RULE_MID}”`), `reply does not quote the rule: ${reply}`);
  assert(/2 verified humans/.test(reply), `reply does not ask for 2 verified humans: ${reply}`);
  assert(reply.includes(HOTEL), `reply does not name the payee: ${reply}`);
  // what / why / what to do, one line each — and the one-human twist is not given away
  const [what, why, todo] = reply.split("\n");
  assert(what.startsWith(`Queued: $180 to ${HOTEL}`), `first line is not the queued payment: ${what}`);
  assert(why === `Needs 2 verified humans — our rules: “${RULE_MID}”`, `second line is not the rule: ${why}`);
  assert(todo === "Approve with World ID in the treasury panel above.", `third line is not the call to approve: ${todo}`);
  assert(!/counts once/.test(reply), `reply announces the one-human rule up front: ${reply}`);
  const fresh = freshActions(before, await status());
  assert(fresh.length === 1, `expected 1 new action, got ${fresh.length}`);
  const a = fresh[0];
  assert(a.status === "pending" && a.amountUsd === 180 && a.requiredApprovals === 2, `action ${JSON.stringify(a)}`);
  assert(a.ruleText === RULE_MID, `action rule ${a.ruleText}`);
  // approvers see where the money lands: the adopted payee's name and address
  assert(a.recipient?.label === HOTEL && /^0x[0-9a-fA-F]{40}$/.test(a.recipient?.address ?? ""), `recipient ${JSON.stringify(a.recipient)}`);
  ctx.action180 = a.id;
  ctx.payee180 = a.recipient.address;
  // the ledger line is written before the agent answers
  const queued = `Alex asked: $180 · ${a.memo} — needs 2 humans to approve`;
  const texts = await activityTexts();
  assert(texts.some((t) => t.includes(JSON.stringify(queued).slice(1, -1))), `no queued line in Treasury Activity: ${queued}`);
  return `action ${a.id}`;
});

await scene("c. Chris (Human 3) approves 1/2, Alex (Human 1) approves 2/2 → paid on Sepolia", async () => {
  assert(ctx.action180, "no $180 action");
  const count0 = await messageCount();
  // the page before the IdP says what is being approved: amount, payee, address, rule
  ctx.expectOnCard = ["$180.00", HOTEL, ctx.payee180, RULE_MID];
  const first = await approve(chris, ctx.action180, { human: 3 });
  ctx.expectOnCard = null;
  assert(first === "approved", `Chris: ?treasury=${first}`);
  let a = (await status()).actions.find((x) => x.id === ctx.action180);
  assert(a.status === "pending" && a.approvals.length === 1, `after Chris: ${a.status}, ${a.approvals.length} approvals`);

  const second = await approve(alex, ctx.action180, { human: 1 });
  assert(second === "executing", `Alex: ?treasury=${second}`);
  const callbackMs = lastCallbackMs;
  assert(callbackMs < CALLBACK_BUDGET_MS, `the quorum callback took ${callbackMs}ms — execution is on the request path`);

  // the redirect came back before the chain did: watch the panel's status settle
  const t0 = Date.now();
  a = await until(
    async () => {
      const x = (await status()).actions.find((y) => y.id === ctx.action180);
      return x.status === "pending" ? null : x;
    },
    EXECUTION_TIMEOUT_MS,
    "the $180 action never left pending"
  );
  const execS = ((Date.now() - t0) / 1000).toFixed(1);
  assert(a.status === "executed", `action is ${a.status} (${a.error})`);
  assert(/^0x[0-9a-f]{64}$/i.test(a.txHash ?? ""), `tx hash ${a.txHash}`);
  ctx.tx180 = a.txHash;

  const receipt = await rpc("eth_getTransactionReceipt", [a.txHash]);
  assert(receipt && receipt.status === "0x1", `receipt ${JSON.stringify(receipt)}`);
  const tx = await rpc("eth_getTransactionByHash", [a.txHash]);
  assert(tx.from.toLowerCase() === ctx.address.toLowerCase(), `tx from ${tx.from}, treasury is ${ctx.address}`);
  // $180 at the demo scale ($1 = 0.000005 SepETH) = 0.0009 ETH
  assert(BigInt(tx.value) === 900_000_000_000_000n, `tx value ${BigInt(tx.value)} wei`);

  // announcements follow the settle by a moment
  const payout = await until(
    async () =>
      (await agentLinesSince(alex, count0)).find((l) => l.startsWith(`Paid $180 to ${HOTEL}`) && l.includes(a.txHash)),
    15_000,
    "no payout notice in chat"
  );
  // who let it happen, on its own line; gas is the relayer's and stays out of the room
  assert(
    payout.includes(`.\nApproved by 2 verified humans: Chris and Alex · tx ${a.txHash}`),
    `payout notice does not name the two approvers on its second line: ${payout}`
  );
  assert(!/gas|relayer/i.test(payout), `payout notice talks about gas: ${payout}`);
  const lines = await agentLinesSince(alex, count0);
  // the approval shows the step-up was fresh: its sign-in time, after the request
  const approvedLine = /Chris approved with World ID — 1 of 2 · fresh check at \d{2}:\d{2}, after this request/;
  assert(lines.some((l) => approvedLine.test(l)), `no fresh 1-of-2 notice: ${lines.join(" | ")}`);

  const paidLine = await until(
    async () => (await activityTexts()).find((t) => t.includes("Paid $180") && t.includes(a.txHash)),
    15_000,
    "no activity line with the tx in Treasury Activity"
  );
  assert(paidLine.includes("approved by Chris and Alex"), `activity line does not name the approvers: ${paidLine}`);
  assert(paidLine.includes(`https://sepolia.etherscan.io/tx/${a.txHash}`), `activity line does not link the tx: ${paidLine}`);
  assert(!/refund|relayer/i.test(paidLine), `activity line talks about gas: ${paidLine}`);
  const activity = await activityTexts();
  assert(activity.some((t) => approvedLine.test(t)), "the approvals are not in Treasury Activity");

  // the refund is exactly what the payment burned, from the relayer to the
  // treasury, and confirmed before the action was marked executed — found on
  // chain now that the record no longer carries it
  const burned = BigInt(receipt.gasUsed) * BigInt(receipt.effectiveGasPrice);
  // polled: this RPC node can be a block behind the one the server confirmed on
  const refundTx = await until(
    () => findTransfer(ctx.address, burned, BigInt(receipt.blockNumber)),
    30_000,
    `no gas refund of exactly ${burned} wei to the treasury after the payment's block ${BigInt(receipt.blockNumber)}`,
    3_000
  );
  ctx.refund180 = refundTx;
  const refundReceipt = await rpc("eth_getTransactionReceipt", [refundTx]);
  assert(refundReceipt && refundReceipt.status === "0x1", `refund receipt ${JSON.stringify(refundReceipt)}`);
  const refund = await rpc("eth_getTransactionByHash", [refundTx]);
  assert(refund.to.toLowerCase() === ctx.address.toLowerCase(), `refund went to ${refund.to}, treasury is ${ctx.address}`);
  assert(BigInt(refund.value) === burned, `refund ${BigInt(refund.value)} wei, payment burned ${burned} wei`);

  // the refund is confirmed before the action is marked executed; the poll
  // only rides out an RPC node a block behind
  let balanceAfter = null;
  await until(
    async () => {
      balanceAfter = (await status()).balanceUsd;
      return balanceAfter !== null && Math.abs(ctx.balanceBefore180 - balanceAfter - 180) <= 0.01;
    },
    60_000,
    "the balance never settled",
    3_000
  ).catch((err) => {
    throw new Error(`balance $${ctx.balanceBefore180} → $${balanceAfter}, expected a drop of exactly $180 ± $0.01 (gas refunded): ${err.message}`);
  });

  if (sql) {
    assert((await worldSubOf(alex.id)) === "mock-human-1", "Alex is not bound to Human 1");
    assert((await worldSubOf(chris.id)) === "mock-human-3", "Chris is not bound to Human 3");
  }
  return `callback ${callbackMs}ms, executed ${execS}s later · tx ${a.txHash} · gas refund ${refundTx} · balance $${ctx.balanceBefore180} → $${balanceAfter}`;
});

await scene("d. $150 — Alex 1/2; the same human on Dana's account is voided; the 2nd account has no say; Dana cancels", async () => {
  const before = new Set((await status()).actions.map((a) => a.id));
  const reply = await ask(alex, "@agent pay the hotel for $150");
  assert(reply.includes(`“${RULE_MID}”`) && /2 verified humans/.test(reply), `reply: ${reply}`);
  const fresh = freshActions(before, await status());
  assert(fresh.length === 1 && fresh[0].status === "pending" && fresh[0].amountUsd === 150, `new actions ${JSON.stringify(fresh)}`);
  ctx.action150 = fresh[0].id;

  const one = await approve(alex, ctx.action150, { human: 1 });
  assert(one === "approved", `Alex: ?treasury=${one}`);

  // scene 4: Alex's human verifying on Dana's laptop — Dana's seat is real
  // (seeded), her account unbound, and the IdP hands back Alex's sub
  {
    const count0 = await messageCount();
    const dup = await approve(dana, ctx.action150, { human: 1 });
    assert(dup === "same-human", `Dana's account as Human 1: ?treasury=${dup}`);
    const a1 = (await status()).actions.find((x) => x.id === ctx.action150);
    assert(a1.status === "pending" && a1.approvals.length === 1, `after the same human: ${a1.status}, ${a1.approvals.length} approvals`);
    const lines = await agentLinesSince(alex, count0);
    assert(lines.some((l) => l.startsWith("An approval was voided")), `no voided notice: ${lines.join(" | ")}`);
    assert((await activityTexts()).some((t) => t.includes("An approval was voided")), "the voided approval is not in Treasury Activity");
    if (sql) assert((await worldSubOf(dana.id)) === null, "Dana's account got bound to Alex's World ID");
  }
  // the 2nd account joined after the adoption: it is refused before any World
  // ID check, and nothing binds to it
  {
    const out = await approve(alex2, ctx.action150, { human: 1 });
    assert(out === "not-electorate", `2nd account, outside the electorate: ?treasury=${out}`);
    if (sql) assert((await worldSubOf(alex2.id)) === null, "the 2nd account got bound to a World ID");
  }
  let a;

  const cancelled = await approve(dana, ctx.action150, { deny: true });
  assert(cancelled === "cancelled", `Dana cancel: ?treasury=${cancelled}`);
  a = (await status()).actions.find((x) => x.id === ctx.action150);
  assert(a.status === "pending" && a.approvals.length === 1, `after the cancel: ${a.status}, ${a.approvals.length} approvals`);
  return "still pending at 1 of 2";
});

await scene("e. $700 to my wallet — refused on the rule, no approval asked, nothing moved", async () => {
  const st0 = await status();
  const before = new Set(st0.actions.map((a) => a.id));
  const reply = await ask(alex, "@agent send $700 to my wallet");
  assert(reply.includes(`“${RULE_PERSONAL}”`), `reply does not quote the personal-wallet rule: ${reply}`);
  assert(/30%/.test(reply) && /4 verified members/.test(reply), `reply does not mention the 30% / 4-member rule: ${reply}`);
  assert(!/Queued|Approve with World ID/.test(reply), `reply asks for approvals: ${reply}`);
  // one thought per line: the refusal, the rule, the share, the purpose, the link
  const said = reply.split("\n");
  assert(said[0] === "I won't do that." && said[1].includes(`“${RULE_PERSONAL}”`), `refusal lines: ${JSON.stringify(said)}`);
  assert(said.some((l) => /^\$700 is also \d+(\.\d)?% of our \$[\d,.]+ — /.test(l)), `no "$700 is also …%" line: ${JSON.stringify(said)}`);
  assert(said.some((l) => /^Rules: \/p\/[A-Za-z0-9_-]+$/.test(l)), `no rules link line: ${JSON.stringify(said)}`);
  const refused = `Refused: $700 to Alex's own wallet — “${RULE_PERSONAL}”`;
  assert(
    (await activityTexts()).some((t) => t.includes(JSON.stringify(refused).slice(1, -1))),
    `no refusal line in Treasury Activity: ${refused}`
  );
  const st = await status();
  const fresh = freshActions(before, st);
  assert(fresh.length === 1, `expected 1 new action, got ${fresh.length}`);
  const a = fresh[0];
  assert(a.status === "blocked" && a.amountUsd === 700 && a.requiredApprovals === 0, `action ${JSON.stringify(a)}`);
  assert(a.ruleText === RULE_PERSONAL && a.txHash === null, `blocked row ${a.ruleText} / ${a.txHash}`);
  assert(st.balanceUsd === st0.balanceUsd, `balance moved: $${st0.balanceUsd} → $${st.balanceUsd}`);
  const connect = await approve(bea, a.id, { human: 2 });
  assert(connect === "not-allowed", `approving a blocked action: ?treasury=${connect}`);
  return `blocked, balance still $${st.balanceUsd}`;
});

await scene("f. not seated / not a member — no vote", async () => {
  assert(ctx.action150, "no $150 action");
  const nm = await approve(outsider, ctx.action150, { human: 9 });
  assert(nm === "not-allowed", `outsider: ?treasury=${nm}`);
  if (!sql) return "not-seated skipped (no POSTGRES_URL)";
  const { rows } = await sql.query(
    "delete from treasury_seats where room_id = $1 and user_id = $2 returning nullifier_hash, verification_level, created_at",
    [roomId, eli.id]
  );
  try {
    const r = await approve(eli, ctx.action150, { human: 5 });
    assert(r === "not-seated", `Eli without a seat: ?treasury=${r}`);
    assert((await worldSubOf(eli.id)) === null, "an unseated approval bound a World ID");
  } finally {
    for (const s of rows)
      await sql.query(
        "insert into treasury_seats (room_id, user_id, nullifier_hash, verification_level, created_at) values ($1, $2, $3, $4, $5) on conflict do nothing",
        [roomId, eli.id, s.nullifier_hash, s.verification_level, s.created_at]
      );
  }
  const a = (await status()).actions.find((x) => x.id === ctx.action150);
  assert(a.approvals.length === 1, `approvals changed: ${a.approvals.length}`);
  return "outsider not-allowed, unseated Eli not-seated";
});

await scene("g. stale proof — a verification older than the request does not count", async () => {
  assert(ctx.action150, "no $150 action");
  if (!sql) return "skipped (no POSTGRES_URL)";
  // the mock always issues auth_time = now, so the request is moved an hour
  // into the future instead: the proof then predates it
  await sql.query("update treasury_actions set created_at = created_at + interval '1 hour' where id = $1", [ctx.action150]);
  try {
    const r = await approve(bea, ctx.action150, { human: 2 });
    assert(r === "stale-proof", `Bea with an old proof: ?treasury=${r}`);
    assert((await worldSubOf(bea.id)) === null, "a stale approval bound a World ID");
  } finally {
    await sql.query("update treasury_actions set created_at = created_at - interval '1 hour' where id = $1", [ctx.action150]);
  }
  const a = (await status()).actions.find((x) => x.id === ctx.action150);
  assert(a.status === "pending" && a.approvals.length === 1, `after: ${a.status}, ${a.approvals.length} approvals`);
  return "left pending at 1 of 2 for the live demo";
});

await sql?.end();
const failed = results.filter((r) => !r).length;
console.log(
  `\n${results.length - failed}/${results.length} scenes passed${ctx.tx180 ? ` · tx ${ctx.tx180}` : ""}${ctx.refund180 ? ` · gas refund ${ctx.refund180}` : ""}`
);
process.exit(failed ? 1 : 0);
