// Signed edits in a teamspace linked to aindrive (docs/willow-ainmem-plan.md Tasks 6–7).
//
//   ainmem server started with AINDRIVE_SERVER=http://localhost:$FAKE_PORT, then:
//   [BASE_URL=…] [USER_ID=…] [FAKE_PORT=3172] ./node_modules/.bin/tsx --tsconfig scripts/tsconfig.json e2e/willow-signed.check.mts
//
// A fake aindrive stands in for the drive (it certifies device keys, records ingested
// entries and answers as told). Guarantees:
//   1. An edit in a linked teamspace reaches the drive as a Willow entry that verifies,
//      signed by the device aindrive certified, whose payload is the transaction; the
//      server applies it.
//   2. aindrive refusing the device (revoked): the edit is still applied — unsigned, never
//      lost (review C1) — and nothing is recorded in the drive.
//   3. aindrive down: the edit is applied, the save answers 200 (no error badge, review
//      I4), and the entry reaches the drive once it is back.
//   4. The block menu names the signer: "Signed" — with one authors request per page.
//   5. A signed transaction whose body differs from its signed payload: the payload applies.
//   6. A binding made for another user: applied unsigned, not recorded.
//   7. Transactions signed at different speeds are stored in the order they were made.
// dev only. Removes the page, the link and the account row it made.
import fs from "node:fs";
import http from "node:http";
import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { sealData } from "iron-session";
import { chromium } from "@playwright/test";
import pg from "pg";
import { createHmac } from "node:crypto";
import { importDeviceSeed, signEntry, signTransaction, toHex, utf8, verifyEntry, type WireJson } from "../src/lib/willow/entry";

const BASE = process.env.BASE_URL ?? "http://localhost:3110";
const USER_ID = process.env.USER_ID ?? "8ccf17a7-24fb-4ae9-974c-94bf5db0cf85";
const FAKE_PORT = Number(process.env.FAKE_PORT ?? 3172);
const FAKE = `http://localhost:${FAKE_PORT}`;
const DRIVE = "fakeDrive01";
const env = fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const secret = env.match(/^SESSION_SECRET=(.*)$/m)?.[1].trim() || "dev-secret-change-in-production-32ch";
const cookie = await sealData({ userId: USER_ID }, { password: secret, ttl: 0 });

const fails: string[] = [];
const check = (name: string, ok: boolean, detail?: string) => {
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) fails.push(name);
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── the fake aindrive ────────────────────────────────────────────────────────
let mode: "ok" | "revoked" | "down" = "ok";
const received: { entry: WireJson; path: string[]; payload: string; deviceKey: string }[] = [];
let certified: string | null = null;
const fake = http.createServer(async (req, res) => {
  let body = "";
  for await (const c of req) body += c;
  const json = (status: number, o: unknown) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(o));
  };
  if (req.url === "/api/willow/cert" && req.method === "POST") {
    const { deviceKey } = JSON.parse(body);
    certified = deviceKey;
    return json(200, { cert: { v: 1, deviceKey, userId: "aindrive-user-1", label: "ainmem browser", issuer: { type: "attestation", key: "00" }, issuedAt: "1", sig: "00" } });
  }
  if (req.url === "/api/willow/ingest" && req.method === "POST") {
    if (mode === "down") return json(503, { error: "down" });
    const { drive, entries } = JSON.parse(body) as { drive: string; entries: WireJson[] };
    const results: (string | null)[] = [];
    for (const e of entries) {
      const v = await verifyEntry(e, drive);
      if (!v.ok) { results.push("bad"); continue; }
      if (v.path[0] === "ainmem" && mode === "revoked") { results.push("revoked"); continue; }
      if (v.path[0] === "ainmem") received.push({ entry: e, path: v.path, payload: new TextDecoder().decode(v.payload), deviceKey: v.deviceKey });
      results.push(null);
    }
    return json(200, { results });
  }
  if (req.url?.startsWith("/api/willow/ainmem-authors")) {
    const q = new URL(req.url, FAKE).searchParams;
    const authors = received
      .filter((r) => r.path[1] === q.get("teamspace") && r.path[2] === q.get("page"))
      .map((r) => ({ tx: r.path[3], userId: "aindrive-user-1", name: "Mom", strength: "attested", device: r.deviceKey, at: Date.now() }));
    return json(200, { authors });
  }
  json(404, { error: "not in the fake" });
});
await new Promise<void>((r) => fake.listen(FAKE_PORT, r));

// ── fixtures: an aindrive account for the user, a teamspace linked to DRIVE ──
const db = new pg.Client({ connectionString: env.match(/^POSTGRES_URL=(.+)$/m)![1].trim() });
await db.connect();
const seal = (plain: string) => {
  const key = createHash("sha256").update(`aindrive-account:${secret}`).digest();
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  const b = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), b].map((x) => x.toString("base64url")).join(".");
};
// a run that crashed before its cleanup left these behind: never treat them as the real ones
await db.query("DELETE FROM teamspace_drives WHERE drive_id = $1", [DRIVE]);
const found = (await db.query("SELECT * FROM aindrive_accounts WHERE user_id = $1", [USER_ID])).rows[0];
const prevAccount = found && found.server !== FAKE ? found : undefined;
await db.query(
  `INSERT INTO aindrive_accounts (user_id, server, token_enc, email, name) VALUES ($1, $2, $3, 'mom@example.com', 'Mom')
   ON CONFLICT (user_id) DO UPDATE SET server = EXCLUDED.server, token_enc = EXCLUDED.token_enc, expires_at = NULL`,
  [USER_ID, FAKE, seal("fake-session-token")]
);
const ts = (
  await db.query(
    `SELECT t.id FROM teamspaces t JOIN workspace_members m ON m.workspace_id = t.workspace_id
     WHERE m.user_id = $1 AND t.visibility = 'open' ORDER BY t.created_at LIMIT 1`,
    [USER_ID]
  )
).rows[0]?.id as string | undefined;
if (!ts) throw new Error("the user has no open teamspace");
const linkId = (
  await db.query("INSERT INTO teamspace_drives (teamspace_id, name, drive_id, root, created_by) VALUES ($1, 'willow check', $2, '', $3) RETURNING id", [ts, DRIVE, USER_ID])
).rows[0].id as string;

const browser = await chromium.launch();
const ctx = await browser.newContext();
await ctx.addCookies([{ name: "rm-session", value: cookie, domain: new URL(BASE).hostname, path: "/" }]);
const api = ctx.request;
const pageId = (await (await api.post(`${BASE}/api/pages`, { data: { title: "willow-signed.check", teamspaceId: ts } })).json()).page.id as string;
const B1 = crypto.randomUUID();
await api.put(`${BASE}/api/pages/${pageId}/blocks`, { data: { blocks: [{ id: B1, type: "paragraph", position: 1, parentBlockId: null, content: { text: "AB", html: "AB" } }], deletedIds: [] } });
const serverText = async () => (await (await api.get(`${BASE}/api/pages/${pageId}/blocks`)).json()).blocks.find((b: { id: string }) => b.id === B1)?.content.text as string;

try {
  const page = await ctx.newPage();
  const statuses: number[] = [];
  page.on("response", (r) => { if (/saveTransactions/.test(r.url())) statuses.push(r.status()); });
  await page.goto(`${BASE}/p/${pageId}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.waitForFunction((id) => (window as unknown as { __editorReady?: string }).__editorReady === id, pageId, { timeout: 120_000 });
  await page.waitForTimeout(1500);
  const editable = page.locator(`[data-testid="block-editable-${B1}"]`);
  const typeAtEnd = async (s: string) => {
    await editable.click();
    await page.keyboard.press("End");
    await page.keyboard.type(s, { delay: 30 });
  };

  // 1. signed, forwarded, applied
  await typeAtEnd(" signed");
  let srv = "";
  for (let i = 0; i < 20; i++) { srv = await serverText(); if (srv === "AB signed" && received.length) break; await sleep(500); }
  const mine = received.filter((r) => r.path[2] === pageId);
  const tx = mine[0] ? JSON.parse(mine[0].payload) : null;
  check("1. the edit reached the drive as a verified entry", mine.length > 0 && mine.every((r) => r.path[0] === "ainmem" && r.path[1] === ts), `entries=${mine.length}`);
  check("1. signed by the device aindrive certified", !!certified && mine.every((r) => r.deviceKey === certified));
  check("1. its payload is the transaction", !!tx && tx.pageId === pageId && tx.id === mine[0].path[3] && Array.isArray(tx.operations));
  check("1. the server applied it", srv === "AB signed", `server=${JSON.stringify(srv)}`);

  // 2. revoked → applied unsigned, not recorded
  mode = "revoked";
  const recordedBefore = received.length;
  await typeAtEnd(" kept");
  for (let i = 0; i < 20; i++) { srv = await serverText(); if (srv.endsWith(" kept")) break; await sleep(500); }
  check("2. a device aindrive refuses: the edit is still applied (unsigned)", srv === "AB signed kept", `server=${JSON.stringify(srv)}`);
  check("2. …and nothing of it is recorded in the drive", received.length === recordedBefore, `recorded=${received.length - recordedBefore}`);
  mode = "ok";
  await sleep(1000);

  // 3. aindrive down → applied now, forwarded later
  mode = "down";
  const before = received.length;
  statuses.length = 0;
  await typeAtEnd(" later");
  for (let i = 0; i < 20; i++) { srv = await serverText(); if (srv.endsWith(" later")) break; await sleep(500); }
  check("3. aindrive down: the edit is applied anyway", srv === "AB signed kept later", `server=${JSON.stringify(srv)}`);
  check("3. …the saves answer 200, not an error", statuses.length > 0 && statuses.every((x) => x === 200), `statuses=${statuses.join(",")}`);
  await sleep(1000);
  const badge = await page.getByTestId("editor-root").getAttribute("data-save-state");
  check("3. …and the editor says saved", badge === "saved", `state=${badge}`);
  mode = "ok";
  for (let i = 0; i < 60 && received.length === before; i++) await sleep(500);
  check("3. once aindrive is back, the entry reaches it", received.length > before);
  await sleep(1500);
  check("3. applied once, not twice", (await serverText()) === "AB signed kept later");

  // 4. block menu: signed author
  let authorsRequests = 0;
  page.on("request", (r) => { if (/\/authors$/.test(new URL(r.url()).pathname)) authorsRequests++; });
  await editable.hover();
  await page.getByTestId(`block-handle-${B1}`).click().catch(async () => {
    await page.locator(`[data-block-id="${B1}"] [data-testid^="block-grip"]`).first().click();
  });
  const footer = page.getByTestId("block-menu-edited-by");
  const text = await footer.innerText({ timeout: 8000 }).catch(() => "");
  check("4. the block menu names the signer", /Mom/.test(text) && /Signed/i.test(text), JSON.stringify(text));
  await page.keyboard.press("Escape");
  await page.getByTestId(`block-handle-${B1}`).click();
  await page.getByTestId("block-menu-edited-by").innerText({ timeout: 8000 }).catch(() => "");
  check("4. one authors request per page, not per menu open", authorsRequests === 1, `requests=${authorsRequests}`);
  await page.keyboard.press("Escape");

  // 5–6. crafted saves: the payload is what applies; a foreign binding signs nothing
  const key = await importDeviceSeed(crypto.getRandomValues(new Uint8Array(32)));
  const dk = toHex(key.publicKey);
  const bindingFor = (user: string) => createHmac("sha256", `ainmem-device-binding:${secret}`).update(`${user}:${dk}`).digest().toString("base64url");
  const cert = await signEntry(key, DRIVE, ["_id", "cert"], utf8(JSON.stringify({ deviceKey: dk, userId: "aindrive-user-1" })));
  const B2 = crypto.randomUUID();
  await api.put(`${BASE}/api/pages/${pageId}/blocks`, { data: { blocks: [{ id: B2, type: "paragraph", position: 2, parentBlockId: null, content: { text: "second", html: "second" } }], deletedIds: [] } });
  const mkTx = (ops: unknown[]) => ({ id: crypto.randomUUID(), pageId, timestamp: Date.now(), debug: { userAction: "check", clientCommitTimeMs: Date.now() }, operations: ops });
  const keep = mkTx([{ command: "update", pointer: { table: "block", id: B2 }, path: [], args: { position: 3 } }]);
  const signedKeep = await signTransaction(key, { driveId: DRIVE, teamspaceId: ts, t: keep as never });
  const lying = { ...keep, operations: [{ command: "update", pointer: { table: "block", id: B2 }, path: [], args: { alive: false } }], signed: { drive: DRIVE, entry: signedKeep, cert, binding: bindingFor(USER_ID) } };
  const r5 = await api.post(`${BASE}/api/saveTransactions`, { data: { requestId: crypto.randomUUID(), transactions: [lying] } });
  const blocksNow = (await (await api.get(`${BASE}/api/pages/${pageId}/blocks`)).json()).blocks as { id: string; position: number }[];
  check("5. the signed payload applies, not the body around it", r5.status() === 200 && blocksNow.some((b) => b.id === B2 && b.position === 3), `status=${r5.status()}`);

  const foreign = mkTx([{ command: "update", pointer: { table: "block", id: B2 }, path: [], args: { position: 4 } }]);
  const signedForeign = await signTransaction(key, { driveId: DRIVE, teamspaceId: ts, t: foreign as never });
  const r6 = await api.post(`${BASE}/api/saveTransactions`, {
    data: { requestId: crypto.randomUUID(), transactions: [{ ...foreign, signed: { drive: DRIVE, entry: signedForeign, cert, binding: bindingFor("someone-else") } }] },
  });
  await sleep(500);
  const b2 = ((await (await api.get(`${BASE}/api/pages/${pageId}/blocks`)).json()).blocks as { id: string; position: number }[]).find((b) => b.id === B2);
  check("6. another user's binding: applied, unsigned", r6.status() === 200 && b2?.position === 4, `status=${r6.status()} pos=${b2?.position}`);
  check("6. …and not recorded in the drive", !received.some((r) => r.path[3] === foreign.id));

  // 7. signing order = storing order
  await page.route("**/api/saveTransactions", (r) => r.abort("internetdisconnected"));
  const order = await page.evaluate(async (pid) => {
    const q = (globalThis as unknown as Record<symbol, { enqueue(t: unknown): Promise<void> }>)[Symbol.for("app.transaction-queue")];
    const ids: string[] = [];
    const all: Promise<void>[] = [];
    for (let i = 0; i < 30; i++) {
      const id = crypto.randomUUID();
      ids.push(id);
      all.push(q.enqueue({ id, pageId: pid, timestamp: Date.now(), debug: { userAction: "order", clientCommitTimeMs: Date.now() }, operations: [] }));
    }
    await Promise.all(all);
    const stored: { id: string; index: number }[] = await new Promise((res) => {
      const r = indexedDB.open("TransactionStore");
      r.onsuccess = () => {
        const g = r.result.transaction("Transaction").objectStore("Transaction").getAll();
        g.onsuccess = () => res(g.result);
      };
    });
    const got = stored.filter((x) => ids.includes(x.id)).sort((a, b) => a.index - b.index).map((x) => x.id);
    return { same: JSON.stringify(got) === JSON.stringify(ids), n: got.length };
  }, pageId);
  check("7. transactions are stored in the order they were made", order.same && order.n === 30, JSON.stringify(order));
  await page.unroute("**/api/saveTransactions");
} finally {
  await api.delete(`${BASE}/api/pages/${pageId}`).catch(() => {});
  await browser.close();
  await db.query("DELETE FROM teamspace_drives WHERE id = $1", [linkId]);
  if (prevAccount) {
    await db.query("UPDATE aindrive_accounts SET server = $2, token_enc = $3, email = $4, name = $5, expires_at = $6 WHERE user_id = $1", [
      USER_ID, prevAccount.server, prevAccount.token_enc, prevAccount.email, prevAccount.name, prevAccount.expires_at,
    ]);
  } else await db.query("DELETE FROM aindrive_accounts WHERE user_id = $1", [USER_ID]);
  await db.end();
  fake.close();
}
if (fails.length) {
  console.log(`\n${fails.length} failed`);
  process.exit(1);
}
console.log("\nall passed");
