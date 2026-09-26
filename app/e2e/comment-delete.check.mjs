// Comment deletion — compared against measurements of the original (Notion). docs/notion-comment-delete.md
//
// Measured on 2026-09-10 by posting comments directly in Hyeonjeong's test teamspace:
//   · hovering a comment shows a `Comment actions` toolbar on the right, and ⋯ (more actions) opens
//   · the menu is 180 wide / 28 rows / radius 10, text color rgb(44,44,43) — not red
//   · only your own comments get Edit·Delete. Someone else's only get Mark as unread·Copy link
//   · Delete → 324×145 / radius 12 confirm "Delete this comment?",
//     red Delete rgb(229,100,88) with Cancel below
//   · deleting a thread head keeps its replies (no cascade)
//
// A1–A7 are not measurements but regression checks for two holes reproduced in the 2026-09-10 review
// (docs/notion-comment-delete.md §6.1): a guest with no page shared could
// read comments and even resolve them, and someone removed from the workspace could keep
// editing and deleting their old comments. All seven fail on the code before the fix.
//
//   [BASE_URL=…] [PAGE_ID=…] node e2e/comment-delete.check.mjs
//
// Only writes and deletes its own comments — no matter how often it runs, dev data does not grow.
import fs from "node:fs";
import { ko, content } from "./i18n.mjs";
import { sealData } from "iron-session";
import { chromium } from "@playwright/test";
import { Client } from "pg";

const C = content.COMMENT_DELETE;

const BASE = process.env.BASE_URL ?? "http://localhost:3110";
const AUTHOR = process.env.USER_ID ?? "8ccf17a7-24fb-4ae9-974c-94bf5db0cf85"; // hyeonjj@comcom.ai
const OTHER = process.env.OTHER_USER_ID ?? "30790fd0-9bdb-4c6c-abb8-3903fff5fd6d"; // amy@comcom.ai, same workspace
const PAGE_ID = process.env.PAGE_ID ?? "46802c30-928f-4df6-a032-c53e478e7f73"; // a row page that already has comments
const MENU_W = 180, ROW_H = 28, MENU_RADIUS = "10px";
const DIALOG_W = 324, DIALOG_RADIUS = "12px";
const RED = "rgb(229, 100, 88)";

const env = fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const secret = env.match(/^SESSION_SECRET=(.*)$/m)?.[1].trim() || "dev-secret-change-in-production-32ch";
const pgUrl = env.match(/^POSTGRES_URL=(.*)$/m)[1].trim();
const seal = (userId) => sealData({ userId }, { password: secret, ttl: 0 });
const authorCookie = await seal(AUTHOR);
const otherCookie = await seal(OTHER);

let fails = 0;
const check = (name, ok, detail = "") => { console.log(`${ok ? "✓" : "✗"} ${name}${detail ? `  (${detail})` : ""}`); if (!ok) fails++; };
const api = async (path, init, cookie = authorCookie) =>
  fetch(`${BASE}${path}`, { ...init, headers: { "content-type": "application/json", cookie: `rm-session=${cookie}`, ...(init?.headers ?? {}) } });
const post = async (body, parentId = null, cookie = authorCookie) => {
  const r = await api(`/api/pages/${PAGE_ID}/comments`, { method: "POST", body: JSON.stringify({ body, blockId: null, parentId }) }, cookie);
  if (!r.ok) throw new Error(`POST comment failed: ${r.status}`);
  return (await r.json()).comment;
};
const list = async (cookie = authorCookie) => (await (await api(`/api/pages/${PAGE_ID}/comments`, {}, cookie)).json()).comments;
const del = (id, cookie = authorCookie) => api(`/api/comments/${id}`, { method: "DELETE" }, cookie);
const made = [];
const track = (c) => { made.push(c.id); return c; };
const temps = [];            // users created for the check — removed at the end
const stamp = Date.now();

const pg = new Client({ connectionString: pgUrl });
await pg.connect();

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1500, height: 940 } });
await ctx.addCookies([{ name: "rm-session", value: authorCookie, domain: new URL(BASE).hostname, path: "/" }]);
const page = await ctx.newPage();
const errors = []; page.on("pageerror", (e) => errors.push(String(e)));

try {
  // ── server: only the author may delete ───────────────────────────────────
  {
    const mine = track(await post(C.permission));
    const asOther = await del(mine.id, otherCookie);
    check("S1. someone else deleting my comment gets 403", asOther.status === 403, `status=${asOther.status}`);
    check("S1. and the comment stays", (await list()).some((c) => c.id === mine.id));
    const asMe = await del(mine.id);
    check("S2. the author deleting gets 200", asMe.ok, `status=${asMe.status}`);
    check("S2. it disappears from the list", !(await list()).some((c) => c.id === mine.id));
  }
  // ── server: deleting the head keeps the replies (same as Notion) ─────────
  {
    const root = track(await post(C.root));
    const reply = track(await post(C.reply, root.id));
    check("S3. deleting the head is 200", (await del(root.id)).ok);
    const after = await list();
    check("S3. the reply survives", after.some((c) => c.id === reply.id), `n=${after.length}`);
    await del(reply.id);
  }
  // ── access: being in the workspace alone does not reach the comments ─────
  //
  // Where two holes were reproduced and closed (2026-09-10 review).
  //  1) the gate only looked at workspace_members → guests (= people who only see
  //     pages shared with them) also have a member row, so they could read and
  //     resolve/reopen every comment in the workspace.
  //  2) the edit·delete gate **replaced** the access check → someone removed from the
  //     workspace could keep editing and deleting their old comments.
  {
    const { rows: [pg0] } = await pg.query("select workspace_id from pages where id=$1", [PAGE_ID]);
    const wsId = pg0?.workspace_id;
    check("A0. found the workspace of the check page", !!wsId, String(wsId));

    const mkUser = async (label) => {
      const { rows: [u] } = await pg.query(
        "insert into users (display_name, email) values ($1,$2) returning id",
        [label, `e2e-${label}-${stamp}@example.invalid`]
      );
      temps.push(u.id);
      return u.id;
    };
    const join = (uid, role) =>
      pg.query("insert into workspace_members (workspace_id, user_id, role) values ($1,$2,$3)", [wsId, uid, role]);

    // (1) a guest with no page shared
    const guestId = await mkUser("guest");
    await join(guestId, "guest");
    const guest = await seal(guestId);
    const bait = track(await post(C.guestBait));

    const read = await api(`/api/pages/${PAGE_ID}/comments`, {}, guest);
    check("A1. a guest cannot read the page comments", read.status === 404, `status=${read.status}`);
    const resolve = await api(`/api/comments/${bait.id}`, { method: "PATCH", body: JSON.stringify({ resolved: true }) }, guest);
    check("A2. a guest cannot resolve someone else's thread", resolve.status === 404, `status=${resolve.status}`);
    const gDel = await api(`/api/comments/${bait.id}`, { method: "DELETE" }, guest);
    check("A3. a guest's delete is blocked too", gDel.status === 404, `status=${gDel.status}`);
    const { rows: [still] } = await pg.query("select resolved from comments where id=$1", [bait.id]);
    check("A4. and the comment is untouched", !!still && still.resolved === false, JSON.stringify(still));

    // (2) someone who left a comment and then left the workspace
    const exId = await mkUser("exmember");
    await join(exId, "member");
    const ex = await seal(exId);
    const theirs = track(await post(C.exMember, null, ex));
    await pg.query("delete from workspace_members where workspace_id=$1 and user_id=$2", [wsId, exId]);

    const edit = await api(`/api/comments/${theirs.id}`, { method: "PATCH", body: JSON.stringify({ body: C.edited }) }, ex);
    check("A5. someone who left cannot edit even their own old comment", edit.status === 404, `status=${edit.status}`);
    const exDel = await api(`/api/comments/${theirs.id}`, { method: "DELETE" }, ex);
    check("A6. nor delete it", exDel.status === 404, `status=${exDel.status}`);
    const { rows: [kept] } = await pg.query("select body from comments where id=$1", [theirs.id]);
    check("A7. the body is still intact", kept?.body === C.exMember, JSON.stringify(kept));
    await pg.query("delete from comments where id=$1", [theirs.id]);
  }

  // ── UI ───────────────────────────────────────────────────────────────────
  const target = track(await post(C.uiTarget));
  await page.goto(`${BASE}/p/${PAGE_ID}`, { waitUntil: "domcontentloaded", timeout: 180_000 });
  await page.waitForSelector("[data-testid='page-comment-section']", { timeout: 120_000 });
  const row = page.locator(`[data-testid="comment-row-${target.id}"]`);
  await row.waitFor({ timeout: 30_000 });

  // Geometry must stay as is — three golden checks measure this row in pixels
  const geo = await row.evaluate((el, actionsLabel) => {
    const spans = el.querySelectorAll("span");
    const first = el.firstElementChild;
    return {
      firstTag: first?.tagName,
      firstIsActions: first?.getAttribute("aria-label") === actionsLabel,
      spanCount: spans.length,
      span0: (spans[0]?.textContent || "").slice(0, 20),
      span1: (spans[1]?.textContent || "").slice(0, 20),
      pTag: !!el.querySelector("p"),
      actionsIsLast: el.lastElementChild?.getAttribute("aria-label"),
      actionsAbsolute: el.lastElementChild ? getComputedStyle(el.lastElementChild).position : null,
      h: Math.round(el.getBoundingClientRect().height),
    };
  }, ko("Comment actions"));
  check("G1. the avatar is still the first child (not the actions)", ["IMG", "DIV", "SPAN"].includes(geo.firstTag) && !geo.firstIsActions, JSON.stringify({ firstTag: geo.firstTag, isActions: geo.firstIsActions }));
  check("G2. name·date are still the first two spans", geo.span0.length > 0 && /\d/.test(geo.span1), `span0="${geo.span0}" span1="${geo.span1}"`);
  check("G3. body <p> intact", geo.pTag);
  check("G4. actions are the last child and absolute — they do not push the flow", geo.actionsIsLast !== null && geo.actionsAbsolute === "absolute", JSON.stringify({ last: geo.actionsIsLast, pos: geo.actionsAbsolute }));

  // hover → ⋯
  const more = page.locator(`[data-testid="comment-more-${target.id}"]`);
  check("U1. actions are hidden before hover", (await row.locator("[aria-label]").first().evaluate((el) => getComputedStyle(el.closest("[aria-label]")).opacity).catch(() => "1")) === "0" || (await more.evaluate((el) => getComputedStyle(el.parentElement).opacity)) === "0");
  await row.hover();
  await page.waitForTimeout(300);
  check("U2. hovering shows ⋯", (await more.evaluate((el) => getComputedStyle(el.parentElement).opacity)) === "1");

  await more.click();
  const menu = page.locator(`[data-testid="comment-menu-${target.id}"]`);
  await menu.waitFor({ timeout: 5000 });
  const m = await menu.evaluate((el) => { const r = { width: el.offsetWidth }; const s = getComputedStyle(el); const b = el.querySelector("button"); const br = { height: b.offsetHeight }; const bs = getComputedStyle(b); return { w: Math.round(r.width), radius: s.borderRadius, itemH: Math.round(br.height), itemText: (b.textContent || "").trim(), itemColor: bs.color }; });
  check("U3. menu width 180 · radius 10 · row 28", m.w === MENU_W && m.radius === MENU_RADIUS && m.itemH === ROW_H, JSON.stringify(m));
  check("U4. the item is Delete", m.itemText === ko("Delete comment"), m.itemText);
  check("U5. the delete item is not red (same as the original)", m.itemColor !== RED, m.itemColor);

  await page.locator(`[data-testid="comment-delete-${target.id}"]`).click();
  const dlg = page.locator(`[data-testid="comment-delete-confirm-${target.id}"]`);
  await dlg.waitFor({ timeout: 5000 });
  const d = await dlg.evaluate((el) => { const r = { width: el.offsetWidth }; const s = getComputedStyle(el); const yes = el.querySelector("[data-testid^='comment-delete-yes']"); const no = el.querySelector("[data-testid^='comment-delete-no']"); const ys = getComputedStyle(yes); return { w: Math.round(r.width), radius: s.borderRadius, title: (el.querySelector("p")?.textContent || "").trim(), yesText: (yes.textContent || "").trim(), yesBg: ys.backgroundColor, yesColor: ys.color, noText: (no.textContent || "").trim(), noBelow: no.getBoundingClientRect().top > yes.getBoundingClientRect().top }; });
  check("U6. confirm width 324 · radius 12", d.w === DIALOG_W && d.radius === DIALOG_RADIUS, JSON.stringify({ w: d.w, radius: d.radius }));
  check("U7. wording matches the original", d.title === ko("Delete this comment?"), d.title);
  check("U8. delete button is filled red, cancel below it", d.yesText === ko("Delete") && d.yesBg === RED && d.noText === ko("Cancel") && d.noBelow, JSON.stringify(d));

  await page.locator(`[data-testid="comment-delete-no-${target.id}"]`).click();
  await page.waitForTimeout(400);
  check("U9. cancelling keeps the comment", (await row.count()) === 1 && (await dlg.count()) === 0);

  await row.hover();
  await more.click();
  await page.locator(`[data-testid="comment-delete-${target.id}"]`).click();
  await page.locator(`[data-testid="comment-delete-yes-${target.id}"]`).click();
  await page.waitForTimeout(1200);
  check("U10. deleting removes it from the screen", (await row.count()) === 0);
  check("U10. and from the server", !(await list()).some((c) => c.id === target.id));

  // ── someone else's comment has no actions ─────────────────────────────────
  {
    const theirs = track(await post(C.others, null, otherCookie));
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector(`[data-testid="comment-row-${theirs.id}"]`, { timeout: 30_000 });
    await page.locator(`[data-testid="comment-row-${theirs.id}"]`).hover();
    await page.waitForTimeout(300);
    check("U11. a comment by someone else has no ⋯ at all", (await page.locator(`[data-testid="comment-more-${theirs.id}"]`).count()) === 0);
    await del(theirs.id, otherCookie);
  }
  check("Z. no page errors", errors.length === 0, errors.join(" | "));
} catch (e) {
  check("run", false, String(e).slice(0, 200));
} finally {
  for (const id of made) await del(id).catch(() => {});
  for (const id of made) await del(id, otherCookie).catch(() => {});
  for (const id of temps) {
    await pg.query("delete from comments where author_id=$1", [id]).catch(() => {});
    await pg.query("delete from workspace_members where user_id=$1", [id]).catch(() => {});
 // Posting a comment leaves notifications. notifications.actor_id is not cascade, so
 // unless these go first the users delete is blocked by the FK, and .catch swallows it
    await pg.query("delete from notifications where actor_id=$1 or user_id=$1", [id]).catch(() => {});
    const drop = await pg.query("delete from users where id=$1", [id]).catch((e) => e);
    if (drop instanceof Error) console.log(`  · could not delete check user ${id}: ${drop.message}`);
  }
  await pg.end().catch(() => {});
  await browser.close();
}
console.log(fails ? `\n${fails} FAILED` : "\nall checks passed");
process.exit(fails ? 1 : 0);
