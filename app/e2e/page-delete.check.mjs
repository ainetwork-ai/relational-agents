// Page delete — `Move to Trash` in the top-right ⋯. docs/notion-page-delete.md
//
// comcom report: opening a row from the Projects table as a document, the top-right ⋯ has no delete.
// Original (Notion, measured 2026-09-10):
//   · menu card 256 wide / radius 10
//   · `Move to Trash` comes right after `Move to` — same ink as the other items, not red
//   · a row is a page: putting the row page in the Trash drops it from the table, restoring brings it back
//
// Three screens share the same menu — all three are measured:
//   A. side peek of a row opened from the table   B. the same kind of row as a full /p/<id> page   C. a plain page
// and
//   D. refusal: a guest shared with "edit" only cannot delete (server 403, UI shows a failure toast + stays put)
//   E. ?permanent=1 deletes the row record too
//
//   [BASE_URL=…] [USER_ID=…] node e2e/page-delete.check.mjs
//
// Uses only the databases, pages, rows, and users it creates, and deletes them all in finally.
import fs from "node:fs";
import { sealData } from "iron-session";
import { chromium } from "@playwright/test";
import { Client } from "pg";
import { ko, content } from "./i18n.mjs";

const C = content.PAGE_DELETE;

const BASE = process.env.BASE_URL ?? "http://localhost:3110";
const OWNER = process.env.USER_ID ?? "8ccf17a7-24fb-4ae9-974c-94bf5db0cf85"; // hyeonjj@comcom.ai
const MENU_W = 256, MENU_RADIUS = "10px";
const LABEL = ko("Move to Trash");
const OK_TOAST = ko("Moved to Trash");
const FAIL_TOAST = ko("Couldn't move to Trash");
// Chromium reports Tailwind v4 colours as lab(L a b), not rgb() — read both,
// and treat an unreadable colour as a failure rather than "not red".
const isRed = (css) => {
  const s = String(css);
  const lab = s.match(/^lab\(\s*([\d.]+)%?\s+(-?[\d.]+)\s+(-?[\d.]+)/);
  if (lab) return Number(lab[2]) > 30; // strong +a = red axis
  const m = s.match(/(\d+),\s*(\d+),\s*(\d+)/);
  if (!m) return true;
  const [r, g, b] = m.slice(1).map(Number);
  return r > 180 && r - g > 60 && r - b > 60;
};

const env = fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const secret = env.match(/^SESSION_SECRET=(.*)$/m)?.[1].trim() || "dev-secret-change-in-production-32ch";
const pgUrl = env.match(/^POSTGRES_URL=(.*)$/m)[1].trim();
const seal = (userId) => sealData({ userId }, { password: secret, ttl: 0 });
const ownerCookie = await seal(OWNER);

let fails = 0;
const check = (name, ok, detail = "") => { console.log(`${ok ? "✓" : "✗"} ${name}${detail ? `  (${detail})` : ""}`); if (!ok) fails++; };
const api = (path, init, cookie = ownerCookie) =>
  fetch(`${BASE}${path}`, { ...init, headers: { "content-type": "application/json", cookie: `rm-session=${cookie}`, ...(init?.headers ?? {}) } });
const json = async (res, what) => { if (!res.ok) throw new Error(`${what}: ${res.status} ${await res.text().catch(() => "")}`.slice(0, 300)); return res.json(); };

const stamp = Date.now();
const madePages = [];   // ids of pages we made — permanently deleted at the end
const madeDbs = [];     // ids of databases we made — deleted at the end (properties, rows, views cascade)
const temps = [];       // users we made

const pg = new Client({ connectionString: pgUrl });
await pg.connect();

const browser = await chromium.launch();
const errors = [];
const newPage = async (cookie) => {
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 940 } });
  await ctx.addCookies([{ name: "rm-session", value: cookie, domain: new URL(BASE).hostname, path: "/" }]);
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errors.push(String(e)));
  return p;
};

// ── fixtures: through the same API as the UI ───────────────────────────────
const mkPage = async (title, cookie = ownerCookie) => {
  const { page } = await json(await api("/api/pages", { method: "POST", body: JSON.stringify({ title }) }, cookie), "POST /api/pages");
  madePages.push(page.id);
  return page.id;
};
/** The same two steps as database-block.tsx addRow + ensureRowPage */
const mkRowWithPage = async (dbId, titlePropId, title) => {
  const { row } = await json(await api(`/api/databases/${dbId}/rows`, { method: "POST", body: JSON.stringify({ values: { [titlePropId]: title } }) }), "POST rows");
  const { page } = await json(await api("/api/pages", { method: "POST", body: JSON.stringify({ title, rowForDatabaseId: dbId }) }), "POST /api/pages rowFor");
  madePages.push(page.id);
  await json(await api(`/api/databases/${dbId}/rows/${row.id}`, { method: "PATCH", body: JSON.stringify({ values: { __page: page.id } }) }), "PATCH row __page");
  return { rowId: row.id, pageId: page.id };
};
const rowState = async (rowId, pageId) => {
  const { rows: [r] } = await pg.query("select values ? '__archived' as marked, values->>'__page' as page from db_rows where id=$1", [rowId]);
  const { rows: [p] } = await pg.query("select is_archived from pages where id=$1", [pageId]);
  return { rowExists: !!r, marked: r?.marked ?? null, pageArchived: p?.is_archived ?? null };
};

/** Clicks ⋯ to open the menu. page-root is server-rendered, so it shows before hydration, and a
 *  click at that point does nothing — keep clicking until the menu card (page-opt-moveto, present
 *  on every page) appears. Whether the delete item is there is measured separately afterwards. */
const openMenu = async (page, scope = "") => {
  const opts = page.locator(`${scope} [data-testid="page-options"]`.trim()).first();
  await opts.waitFor({ timeout: 60_000 });
  const card = page.locator(`${scope} [data-testid="page-opt-moveto"]`.trim()).first();
  for (let i = 0; i < 8; i++) {
    await opts.click();
    if (await card.waitFor({ timeout: 1500 }).then(() => true, () => false)) return true;
  }
  return false;
};

/** 1·2: opens the menu and measures the item and geometry. scope tells apart screens with two ⋯, like the peek. */
const inspectMenu = async (page, tag, scope = "") => {
  const opened = await openMenu(page, scope);
  const del = page.locator(`${scope} [data-testid="page-opt-delete"]`.trim()).first();
  const present = opened && (await del.waitFor({ timeout: 5000 }).then(() => true, () => false));
  check(`${tag}1. the ⋯ menu has Move to Trash`, present && (await del.innerText()).trim() === LABEL, present ? (await del.innerText()).trim() : "missing");
  if (!present) return false;
  const g = await del.evaluate((el) => {
    const card = el.closest(".popover-anim") ?? el.parentElement;
    const cs = getComputedStyle(card);
    const move = card.querySelector('[data-testid="page-opt-moveto"]');
    return {
      w: card.offsetWidth,
      radius: cs.borderRadius,
      color: getComputedStyle(el).color,
      moveColor: move ? getComputedStyle(move).color : null,
      prev: el.previousElementSibling?.getAttribute("data-testid") ?? null,
    };
  });
  check(`${tag}2. card width 256 · radius 10`, g.w === MENU_W && g.radius === MENU_RADIUS, JSON.stringify({ w: g.w, radius: g.radius }));
  check(`${tag}2. same ink as Move to, not red`, g.moveColor !== null && g.color === g.moveColor && !isRed(g.color), JSON.stringify({ color: g.color, moveto: g.moveColor }));
  check(`${tag}2. right after Move to`, g.prev === "page-opt-moveto", `prev=${g.prev}`);
  return true;
};
const toastText = async (page, want, timeout = 8000) => {
  const t = page.locator('[data-testid="toast-message"]', { hasText: want });
  return t.first().waitFor({ timeout }).then(() => true, () => false);
};
const gotoDb = async (page, hostPageId) => {
  await page.goto(`${BASE}/p/${hostPageId}`, { waitUntil: "domcontentloaded", timeout: 180_000 });
  await page.waitForSelector('[data-testid^="db-row-"]', { timeout: 120_000 }).catch(() => {});
  await page.waitForTimeout(800);
};
/** 5: restore from the Trash modal → the row comes back to the table and the mark is cleared */
const restoreViaTrash = async (page, tag, hostPageId, rowId, pageId) => {
  await gotoDb(page, hostPageId);
  await page.locator('[data-testid="trash-button"]').click();
  await page.locator('[data-testid="trash-modal"]').waitFor({ timeout: 10_000 });
  const btn = page.locator(`[data-testid="trash-restore-${pageId}"]`);
  const listed = await btn.waitFor({ timeout: 10_000 }).then(() => true, () => false);
  check(`${tag}5. the page is in the Trash modal`, listed);
  if (!listed) return;
  await btn.hover();
  await btn.click();
  await page.waitForTimeout(1500);
  const s = await rowState(rowId, pageId);
  check(`${tag}5. restoring clears the DB mark`, s.rowExists && s.marked === false && s.pageArchived === false, JSON.stringify(s));
  await page.keyboard.press("Escape");
  await gotoDb(page, hostPageId);
  check(`${tag}5. the row is back in the reloaded table`, (await page.locator(`[data-testid="db-row-${rowId}"]`).count()) === 1);
};
/** 4: did it leave the table — no row testid after reload, and the DB has it archived + marked */
const assertRowGone = async (page, tag, hostPageId, rowId, pageId) => {
  const s = await rowState(rowId, pageId);
  check(`${tag}4. DB: pages.is_archived=true and the row has the __archived mark`, s.pageArchived === true && s.rowExists && s.marked === true, JSON.stringify(s));
  await gotoDb(page, hostPageId);
  check(`${tag}4. the row is gone from the reloaded table`, (await page.locator(`[data-testid="db-row-${rowId}"]`).count()) === 0);
};

try {
  const ws = (await pg.query("select workspace_id from workspace_members where user_id=$1 order by case role when 'owner' then 0 when 'admin' then 1 when 'member' then 2 else 3 end, joined_at limit 1", [OWNER])).rows[0]?.workspace_id;

  // database (full page · one table view · one name property)
  const snap = await json(await api("/api/databases", { method: "POST", body: JSON.stringify({ shape: "minimal", title: `${C.dbTitle} ${stamp}` }) }), "POST /api/databases");
  const dbId = snap.database.id;
  madeDbs.push(dbId);
  const titleProp = snap.properties.find((p) => p.type === "title").id;
  const { pageId: hostPageId } = await json(await api(`/api/databases/${dbId}/fullpage`, { method: "POST" }), "POST fullpage");
  madePages.push(hostPageId);
  check("0. fixture: database and host page", !!dbId && !!hostPageId && snap.database.workspaceId === ws, `db=${dbId} host=${hostPageId}`);

  const rowA = await mkRowWithPage(dbId, titleProp, `${C.rowA} ${stamp}`);
  const rowB = await mkRowWithPage(dbId, titleProp, `${C.rowB} ${stamp}`);
  const rowE = await mkRowWithPage(dbId, titleProp, `${C.rowE} ${stamp}`);
  const plainC = await mkPage(`${C.pageC} ${stamp}`);

  const page = await newPage(ownerCookie);

  // ── A. side peek of a row opened from the table ──────────────────────────
  {
    await gotoDb(page, hostPageId);
    const tr = page.locator(`[data-testid="db-row-${rowA.rowId}"]`);
    check("A0. the row shows in the table", (await tr.count()) === 1);
    await tr.hover();
    await page.locator(`[data-testid="db-title-open-${rowA.rowId}"]`).click();
    const peek = page.locator('[data-testid="db-row-peek"]');
    await peek.waitFor({ timeout: 30_000 });
    if (await inspectMenu(page, "A", '[data-testid="db-row-peek"]')) {
      await peek.locator('[data-testid="page-opt-delete"]').click();
      check("A3. success toast", await toastText(page, OK_TOAST));
      const closed = await peek.waitFor({ state: "detached", timeout: 8000 }).then(() => true, () => false);
      check("A3. the peek closes", closed);
      await page.waitForTimeout(1500);
      check("A4. leaves the open table even without a reload", (await page.locator(`[data-testid="db-row-${rowA.rowId}"]`).count()) === 0);
      await assertRowGone(page, "A", hostPageId, rowA.rowId, rowA.pageId);
      await restoreViaTrash(page, "A", hostPageId, rowA.rowId, rowA.pageId);
    }
  }

  // ── B. the row as a full /p/<id> page ────────────────────────────────────
  {
    await page.goto(`${BASE}/p/${rowB.pageId}`, { waitUntil: "domcontentloaded", timeout: 180_000 });
    await page.waitForSelector('[data-testid="page-root"]', { timeout: 120_000 });
    if (await inspectMenu(page, "B")) {
      await page.locator('[data-testid="page-opt-delete"]').first().click();
      check("B3. success toast", await toastText(page, OK_TOAST));
      const left = await page.waitForURL((u) => !u.pathname.includes(rowB.pageId), { timeout: 15_000 }).then(() => true, () => false);
      check("B3. leaves /p/<row page>", left, page.url());
      await page.waitForTimeout(800);
      await assertRowGone(page, "B", hostPageId, rowB.rowId, rowB.pageId);
      await restoreViaTrash(page, "B", hostPageId, rowB.rowId, rowB.pageId);
    }
  }

  // ── C. plain page ────────────────────────────────────────────────────────
  {
    await page.goto(`${BASE}/p/${plainC}`, { waitUntil: "domcontentloaded", timeout: 180_000 });
    await page.waitForSelector('[data-testid="page-root"]', { timeout: 120_000 });
    if (await inspectMenu(page, "C")) {
      await page.locator('[data-testid="page-opt-delete"]').first().click();
      check("C3. success toast", await toastText(page, OK_TOAST));
      const left = await page.waitForURL((u) => !u.pathname.includes(plainC), { timeout: 15_000 }).then(() => true, () => false);
      check("C3. leaves /p/<id>", left, page.url());
      await page.waitForTimeout(800);
      const { rows: [p] } = await pg.query("select is_archived from pages where id=$1", [plainC]);
      check("C4. DB: pages.is_archived=true", p?.is_archived === true, JSON.stringify(p));
      await page.locator('[data-testid="trash-button"]').click();
      const btn = page.locator(`[data-testid="trash-restore-${plainC}"]`);
      const listed = await btn.waitFor({ timeout: 10_000 }).then(() => true, () => false);
      check("C5. it is in the Trash modal", listed);
      if (listed) {
        await btn.hover();
        await btn.click();
        await page.waitForTimeout(1500);
        const { rows: [q] } = await pg.query("select is_archived from pages where id=$1", [plainC]);
        check("C5. restoring unarchives it", q?.is_archived === false, JSON.stringify(q));
        await page.keyboard.press("Escape");
        await page.reload({ waitUntil: "domcontentloaded" });
        const back = await page.locator(`[data-testid="page-tree-item-${plainC}"]`).waitFor({ timeout: 60_000 }).then(() => true, () => false);
        check("C5. it is back in the reloaded sidebar", back);
      }
    }
  }

  // ── D. refusal: a guest shared with edit only ────────────────────────────
  {
    const pageD = await mkPage(`${C.pageD} ${stamp}`);
    const { rows: [u] } = await pg.query("insert into users (display_name, email) values ($1,$2) returning id", ["e2e-guest", `e2e-page-delete-guest-${stamp}@example.invalid`]);
    temps.push(u.id);
    await pg.query("insert into workspace_members (workspace_id, user_id, role) values ($1,$2,'guest')", [ws, u.id]);
    await pg.query("insert into page_members (page_id, user_id, permission) values ($1,$2,'edit')", [pageD, u.id]);
    const guest = await seal(u.id);

    const del = await api(`/api/pages/${pageD}`, { method: "DELETE" }, guest);
    check("D1. guest DELETE is 403", del.status === 403, `status=${del.status}`);
    const patch = await api(`/api/pages/${pageD}`, { method: "PATCH", body: JSON.stringify({ isArchived: true }) }, guest);
    check("D1. PATCH {isArchived} is 403 too", patch.status === 403, `status=${patch.status}`);
    const { rows: [d0] } = await pg.query("select is_archived from pages where id=$1", [pageD]);
    check("D2. the page is untouched", d0?.is_archived === false, JSON.stringify(d0));

    const gp = await newPage(guest);
    await gp.goto(`${BASE}/p/${pageD}`, { waitUntil: "domcontentloaded", timeout: 180_000 });
    const opened = await gp.waitForSelector('[data-testid="page-root"]', { timeout: 120_000 }).then(() => true, () => false);
    check("D3. the guest opens the shared page", opened, gp.url());
    if (opened) {
      const menuOpen = await openMenu(gp);
      const item = gp.locator('[data-testid="page-opt-delete"]').first();
      const present = menuOpen && (await item.waitFor({ timeout: 5000 }).then(() => true, () => false));
      check("D3. the guest menu has the item too (clicking it is refused)", present);
      if (present) {
        await item.click();
        check("D4. failure toast Couldn't move to Trash", await toastText(gp, FAIL_TOAST));
        check("D4. no success toast", (await gp.locator('[data-testid="toast-message"]', { hasText: new RegExp(`^${OK_TOAST}$`) }).count()) === 0);
        await gp.waitForTimeout(1500);
        check("D4. stays on the page", gp.url().includes(pageD) && (await gp.locator('[data-testid="page-root"]').count()) > 0, gp.url());
        const { rows: [d1] } = await pg.query("select is_archived from pages where id=$1", [pageD]);
        check("D4. the DB is untouched too", d1?.is_archived === false, JSON.stringify(d1));
        await gp.reload({ waitUntil: "domcontentloaded" });
        const inTree = await gp.locator(`[data-testid="page-tree-item-${pageD}"]`).waitFor({ timeout: 60_000 }).then(() => true, () => false);
        check("D5. still in the sidebar tree after reload", inTree);
      }
    }
    await gp.context().close();
  }

  // ── E. permanent delete takes the row record too ─────────────────────────
  {
    const soft = await api(`/api/pages/${rowE.pageId}`, { method: "DELETE" });
    const s0 = await rowState(rowE.rowId, rowE.pageId);
    check("E1. soft delete: the row stays, only marked", soft.ok && s0.rowExists && s0.marked === true && s0.pageArchived === true, JSON.stringify({ status: soft.status, ...s0 }));
    const hard = await api(`/api/pages/${rowE.pageId}?permanent=1`, { method: "DELETE" });
    const s1 = await rowState(rowE.rowId, rowE.pageId);
    check("E2. ?permanent=1: both the page and the db_rows record are gone", hard.ok && !s1.rowExists && s1.pageArchived === null, JSON.stringify({ status: hard.status, ...s1 }));
  }

  check("Z. no page errors", errors.length === 0, errors.join(" | ").slice(0, 400));
} catch (e) {
  check("run", false, String(e?.stack ?? e).slice(0, 400));
} finally {
  // row pages sit under the host, but deleting the host does not cascade (parent is not an FK) — one by one
  for (const id of madePages) await pg.query("delete from pages where id=$1", [id]).catch((e) => console.log(`  · cleanup of page ${id} failed: ${e.message}`));
  for (const id of madeDbs) await pg.query("delete from databases where id=$1", [id]).catch((e) => console.log(`  · cleanup of DB ${id} failed: ${e.message}`));
  for (const id of temps) {
    await pg.query("delete from page_members where user_id=$1", [id]).catch(() => {});
    await pg.query("delete from workspace_members where user_id=$1", [id]).catch(() => {});
    await pg.query("delete from notifications where actor_id=$1 or user_id=$1", [id]).catch(() => {});
    const drop = await pg.query("delete from users where id=$1", [id]).catch((e) => e);
    if (drop instanceof Error) console.log(`  · could not delete test user ${id}: ${drop.message}`);

  }
  await pg.end().catch(() => {});
  await browser.close();
}
console.log(fails ? `\n${fails} FAILED` : "\nall checks passed");
process.exit(fails ? 1 : 0);
