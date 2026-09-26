// Mentions (@) in comments — compared against measurements of the original (Notion). docs/notion-comment-mention.md
//
// What was measured on 2026-09-10 by actually typing @ into Notion's comment input row is in
// src/i18n/content/e2e-fixtures/notion-comment-mention.json, and this script measures our side
// the same way and compares.
//
//   [BASE_URL=…] [PAGE_ID=…] node e2e/mention.check.mjs
//
// To measure the ordering rules deterministically it creates check members in the dev DB and removes them
// (same as comment-delete.check.mjs). No matter how often it runs, dev data does not grow.
import fs from "node:fs";
import { sealData } from "iron-session";
import { chromium } from "@playwright/test";
import { Client } from "pg";
import { ko, content } from "./i18n.mjs";

const K = content.MENTION;

const BASE = process.env.BASE_URL ?? "http://localhost:3110";
const ME = process.env.USER_ID ?? "8ccf17a7-24fb-4ae9-974c-94bf5db0cf85"; // hyeonjj@comcom.ai
const PAGE_ID = process.env.PAGE_ID ?? "46802c30-928f-4df6-a032-c53e478e7f73";

const F = JSON.parse(fs.readFileSync(new URL("../src/i18n/content/e2e-fixtures/notion-comment-mention.json", import.meta.url), "utf8"));
const env = fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const secret = env.match(/^SESSION_SECRET=(.*)$/m)?.[1].trim() || "dev-secret-change-in-production-32ch";
const pgUrl = env.match(/^POSTGRES_URL=(.*)$/m)[1].trim();
const cookie = await sealData({ userId: ME }, { password: secret, ttl: 0 });

let fails = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) fails++;
};
const near = (a, b, tol = 1) => Math.abs(a - b) <= tol;

// ── check members: names for measuring the ordering rules deterministically ──
const stamp = Date.now();
// Names must **not overlap with the real workspace**. At first they were Kim-something, but
// the dev workspace already has Minhyun Kim (kimminhyun@comcom.ai), who slipped in among the check
// users and made the order assertions meaningless. Use a surname that exists nowhere.
const Q = "Qwix";
const TEMPS = [
  { key: "qsan", name: "Qwix San", role: "member" },       // start of name   → 0
  { key: "bora", name: "Bora Qwix", role: "member" },      // start of a word → 1
  { key: "minho", name: "Minho Qwix", role: "member" },    // same 1, later in order
  { key: "hong", name: K.hangulName, role: "member" },       // Hangul initial consonant (K.initial)
  { key: "gq", name: "Qwixella", role: "guest" },          // start of name but a guest → 0+1
];

const pg = new Client({ connectionString: pgUrl });
await pg.connect();
const madeUsers = [];
const sentComments = [];

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1500, height: 960 } });
await ctx.addCookies([{ name: "rm-session", value: cookie, domain: new URL(BASE).hostname, path: "/" }]);
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));

const input = () => page.locator('[data-testid="comment-composer-input"]').first();
const menu = () => page.locator('[data-testid="mention-menu"]');
const menuOpen = async () => (await menu().count()) > 0 && (await menu().isVisible().catch(() => false));

/** Clears the input row and types the given string (real key presses). */
async function typeIn(s) {
  const el = input();
  await el.click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("Backspace");
  await page.waitForTimeout(120);
  if (s) await el.type(s, { delay: 45 });
  await page.waitForTimeout(500);
}

/** Names of the people shown in the menu, in drawn order. */
async function people() {
  if (!(await menuOpen())) return [];
  return menu().evaluate((m) => {
    const rows = [...m.querySelectorAll('[data-testid^="mention-item-person-"]')];
    return rows.map((r) => (r.innerText || "").replace(/\s+/g, " ").trim());
  });
}

try {
  const { rows: [pageRow] } = await pg.query("select workspace_id from pages where id=$1", [PAGE_ID]);
  const wsId = pageRow?.workspace_id;
  check("0. found the workspace of the check page", !!wsId, String(wsId));

  for (const t of TEMPS) {
    const { rows: [u] } = await pg.query(
      "insert into users (display_name, email) values ($1,$2) returning id",
      [t.name, `e2e-mention-${t.key}-${stamp}@example.invalid`]
    );
    t.id = u.id;
    madeUsers.push(u.id);
    await pg.query("insert into workspace_members (workspace_id, user_id, role) values ($1,$2,$3)", [wsId, u.id, t.role]);
  }

  await page.goto(`${BASE}/p/${PAGE_ID}`, { waitUntil: "domcontentloaded", timeout: 180_000 });
  await page.waitForSelector('[data-testid="page-comment-section"]', { timeout: 120_000 });
  await input().waitFor({ timeout: 30_000 });

  // ── T. when it opens and closes (§1) ─────────────────────────────────────
  await typeIn("@");
  check("T1. @ in an empty input row opens it", await menuOpen());
  await typeIn("x@");
  check("T2. @ right after a letter opens it too (no word-boundary check)", await menuOpen());
  await typeIn("x @");
  check("T3. @ after a space opens it too", await menuOpen());
  await typeIn("@ ");
  check("T4. a space right after @ closes it", !(await menuOpen()));
  await typeIn(`@${Q} `);
  check("T5. a space after the query does not close it", await menuOpen());
  await typeIn(`@${Q} s`);
  check("T6. a space inside the query is part of the query", await menuOpen());
  await typeIn(`@${Q}`);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  check("T7. Escape closes only the menu (the text stays)", !(await menuOpen()) && (await input().inputValue()) === `@${Q}`,
    await input().inputValue());

  // An email address is not a mention — the one deliberate difference from the original (§7).
  // Email is searchable too (§2), so without blocking this `ping me@comcom.ai` would match every
  // member and Enter would turn the address into a name. The message would be silently broken.
  await typeIn("ping someone@example.invalid");
  check("T8. does not open on an email address", !(await menuOpen()), await input().inputValue());
  {
    const before = await page.evaluate(() => document.querySelectorAll('[data-testid^="comment-row-"]').length);
    await page.keyboard.press("Enter");
    await page.waitForTimeout(1200);
    const after = await page.evaluate(() => document.querySelectorAll('[data-testid^="comment-row-"]').length);
    check("T8. so Enter can send", after === before + 1, JSON.stringify({ before, after }));
    const row = page.locator('[data-testid^="comment-row-"]').last();
    const id = (await row.getAttribute("data-testid").catch(() => "") || "").replace("comment-row-", "");
    if (id) sentComments.push(id);
  }

  // ── S. search and order (§2) ──────────────────────────────────────────────
  await typeIn(`@${Q}`);
  const got = await people();
  const idx = (n) => got.findIndex((s) => s.startsWith(n));
  check("S1. start-of-name match is on top", idx("Qwix San") === 0, JSON.stringify(got));
  check("S2. start-of-word match comes next", idx("Bora Qwix") > 0 && idx("Minho Qwix") > idx("Bora Qwix"), JSON.stringify(got));
  check("S3. guests go last within the same tier", idx("Qwixella") === got.length - 1, JSON.stringify(got));

  await typeIn(`@${Q.toUpperCase()}`);
  check("S4. case-insensitive", JSON.stringify(await people()) === JSON.stringify(got));

  await typeIn(`@${K.initial}`);
  const jamo = await people();
  check(`S5. finds by Hangul initial consonant (${K.initial} → ${K.hangulName})`, jamo.some((s) => s.startsWith(K.hangulName)), JSON.stringify(jamo));

  await typeIn("@e2e-mention-hong");
  const byMail = await people();
  check("S6. finds by email too", byMail.some((s) => s.startsWith(K.hangulName)), JSON.stringify(byMail));

  await typeIn("@example.invalid");
  check("S7. finds by email domain too", (await people()).length >= 5, String((await people()).length));

  await typeIn("@");
  const bare = await people();
  check("S8. up to 5 people shown", bare.length <= F.search.peopleShown, String(bare.length));
  const more = page.locator('[data-testid="mention-more"]');
  check("S9. overflow is one `Show N more results` line", (await more.count()) === 1 && new RegExp(ko("Show {n} more results", { n: "\\d+" })).test((await more.innerText().catch(() => "")) || ""),
    (await more.innerText().catch(() => "(none)")));

  // ── G. modal geometry (§3) ────────────────────────────────────────────────
  await typeIn(`@${Q}`);
  const g = await menu().evaluate((m, heads) => {
    const s = getComputedStyle(m);
    const row = m.querySelector('[data-testid^="mention-item-"]');
    const rs = row && getComputedStyle(row);
    const rr = row && row.getBoundingClientRect();
    const av = row && row.querySelector("img, svg, [data-avatar]");
    const avr = av && av.getBoundingClientRect();
    const head = [...m.querySelectorAll("*")].find((e) => e.children.length === 0 && heads.includes((e.innerText || "").trim()));
    const hs = head && getComputedStyle(head);
    const hr = head && head.getBoundingClientRect();
    const mr = m.getBoundingClientRect();
    return {
      w: Math.round(m.offsetWidth), maxH: s.maxHeight, radius: s.borderRadius, ovY: s.overflowY, shadow: s.boxShadow,
      row: rr ? { w: Math.round(row.offsetWidth), h: Math.round(row.offsetHeight), radius: rs.borderRadius, inset: Math.round(rr.left - mr.left) } : null,
      avatar: avr ? { w: Math.round(avr.width), left: Math.round(avr.left - rr.left) } : null,
      head: hr ? { fs: hs.fontSize, fw: hs.fontWeight, color: hs.color, indent: Math.round(hr.left - mr.left) } : null,
    };
  }, [ko("Date"), ko("Person"), ko("Link to page"), K.groupHead, "Date", "Person", "Page", "Group"]);
  check("G1. card width 330", g.w === F.menu.card.width, String(g.w));
  check("G2. card max height 325 · radius 10 · vertical scroll", g.maxH === `${F.menu.card.maxHeight}px` && g.radius === F.menu.card.radius && /auto|scroll/.test(g.ovY),
    JSON.stringify({ maxH: g.maxH, radius: g.radius, ovY: g.ovY }));
  check("G3. row 322 × 28 · radius 6 · inset 4 left and right",
    !!g.row && g.row.w === F.menu.row.width && g.row.h === F.menu.row.height && g.row.radius === F.menu.row.radius && near(g.row.inset, F.menu.row.insetFromCard),
    JSON.stringify(g.row));
  check("G4. avatar 20, left 8", !!g.avatar && near(g.avatar.w, F.menu.row.avatar) && near(g.avatar.left, F.menu.row.avatarLeft), JSON.stringify(g.avatar));
  check("G5. section head 12px/500 rgb(125,122,117), indented 12",
    !!g.head && g.head.fs === F.menu.header.fontSize && g.head.fw === F.menu.header.fontWeight && g.head.color === F.menu.header.color && near(g.head.indent, F.menu.header.indentFromCard),
    JSON.stringify(g.head));

  // ── E. no results (§4) ────────────────────────────────────────────────────
  await typeIn("@zzqqzz");
  const empty = page.locator('[data-testid="mention-empty"]');
  check("E1. with no results it shows `No results` (does not disappear)", (await empty.count()) === 1);
  if (await empty.count()) {
    const e = await menu().evaluate((m) => {
      const t = m.querySelector('[data-testid="mention-empty"]');
      const s = getComputedStyle(t); const r = t.getBoundingClientRect(); const mr = m.getBoundingClientRect();
      return { h: Math.round(m.offsetHeight), fs: s.fontSize, fw: s.fontWeight, color: s.color, left: Math.round(r.left - mr.left), top: Math.round(r.top - mr.top), text: (t.innerText || "").trim() };
    });
    check("E2. the card shrinks to 330 × 65 with the same wording·color",
      near(e.h, F.menu.empty.cardHeight, 2) && e.fs === F.menu.empty.fontSize && e.color === F.menu.empty.color && near(e.left, F.menu.empty.left) && near(e.top, F.menu.empty.top, 2),
      JSON.stringify(e));
  }

  // ── P. what goes in when picked (§5) ─────────────────────────────────────
  await typeIn("@Qwix San");
  const target = page.locator(`[data-testid="mention-item-person-${TEMPS[0].id}"]`);
  check("P0. the row to pick exists", (await target.count()) === 1);
  if (await target.count()) {
    await target.click();
    await page.waitForTimeout(500);
    const v = await input().inputValue();
    check("P1. `@name ` goes in, followed by one space", v === "@Qwix San ", JSON.stringify(v));
    check("P1. and the menu closes", !(await menuOpen()));
    await page.keyboard.press("Backspace");
    await page.waitForTimeout(250);
    check("P2. the first Backspace deletes only the space", (await input().inputValue()) === "@Qwix San", JSON.stringify(await input().inputValue()));
    await page.keyboard.press("Backspace");
    await page.waitForTimeout(250);
    check("P3. the second Backspace deletes the whole mention", (await input().inputValue()) === "", JSON.stringify(await input().inputValue()));
  }

  // ── K. keyboard (§3) ──────────────────────────────────────────────────────
  await typeIn(`@${Q}`);
  const before = await page.evaluate(() => document.querySelectorAll('[data-testid^="comment-row-"]').length);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(900);
  const after = await page.evaluate(() => document.querySelectorAll('[data-testid^="comment-row-"]').length);
  check("K1. with the menu open, Enter picks rather than sends",
    after === before && /^@\S/.test(await input().inputValue()), JSON.stringify({ before, after, v: await input().inputValue() }));

  check("Z. no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
} catch (e) {
  check("run", false, String(e).slice(0, 300));
} finally {
  try { await input().click(); await page.keyboard.press("ControlOrMeta+a"); await page.keyboard.press("Backspace"); } catch {}
  for (const id of sentComments) {
    await fetch(`${BASE}/api/comments/${id}`, { method: "DELETE", headers: { cookie: `rm-session=${cookie}` } }).catch(() => {});
  }
  for (const id of madeUsers) {
    await pg.query("delete from comments where author_id=$1", [id]).catch(() => {});
    await pg.query("delete from workspace_members where user_id=$1", [id]).catch(() => {});
    await pg.query("delete from notifications where actor_id=$1 or user_id=$1", [id]).catch(() => {});
    const drop = await pg.query("delete from users where id=$1", [id]).catch((e) => e);
    if (drop instanceof Error) console.log(`  · could not delete check user ${id}: ${drop.message}`);
  }
  await pg.end().catch(() => {});
  await browser.close();
}
console.log(fails ? `\n${fails} FAILED` : "\nall checks passed");
process.exit(fails ? 1 : 0);
