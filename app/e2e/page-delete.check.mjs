// 페이지 삭제 — 우측 상단 ⋯ 의 `휴지통으로 이동`. docs/notion-page-delete.md
//
// comcom 보고: Projects 표에서 행을 문서로 열었을 때 우측 상단 ⋯ 에 삭제가 없다.
// 원본(노션, 2026-09-10 실측):
//   · 메뉴 카드 256 폭 / radius 10
//   · `옮기기` 바로 다음이 `휴지통으로 이동` — 다른 항목과 같은 잉크, 빨강이 아니다
//   · 행은 곧 페이지다: 행 페이지를 휴지통에 넣으면 표에서도 빠지고, 복원하면 돌아온다
//
// 세 화면이 같은 메뉴를 쓴다 — 셋 다 잰다:
//   A. 표에서 연 행의 사이드 피크   B. 같은 종류의 행을 /p/<id> 전체 페이지로   C. 일반 페이지
// 그리고
//   D. 거절: "edit" 로만 공유받은 게스트는 지우지 못한다(서버 403, UI 는 실패 토스트 + 그대로)
//   E. ?permanent=1 은 행 레코드까지 지운다
//
//   [BASE_URL=…] [USER_ID=…] node e2e/page-delete.check.mjs
//
// 자기가 만든 데이터베이스·페이지·행·사용자만 쓰고, finally 에서 전부 지운다.
import fs from "node:fs";
import { sealData } from "iron-session";
import { chromium } from "@playwright/test";
import { Client } from "pg";

const BASE = process.env.BASE_URL ?? "http://localhost:3110";
const OWNER = process.env.USER_ID ?? "8ccf17a7-24fb-4ae9-974c-94bf5db0cf85"; // hyeonjj@comcom.ai
const MENU_W = 256, MENU_RADIUS = "10px";
const LABEL = "휴지통으로 이동";
const OK_TOAST = "휴지통으로 이동했습니다";
const FAIL_TOAST = "휴지통으로 이동하지 못했습니다";
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
const madePages = [];   // 만든 페이지 id — 끝나면 영구 삭제
const madeDbs = [];     // 만든 데이터베이스 id — 끝나면 지운다(속성·행·뷰는 cascade)
const temps = [];       // 만든 사용자

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

// ── fixtures: UI 와 같은 API 로 ─────────────────────────────────────────────
const mkPage = async (title, cookie = ownerCookie) => {
  const { page } = await json(await api("/api/pages", { method: "POST", body: JSON.stringify({ title }) }, cookie), "POST /api/pages");
  madePages.push(page.id);
  return page.id;
};
/** database-block.tsx addRow + ensureRowPage 와 같은 두 걸음 */
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

/** ⋯ 를 눌러 메뉴를 연다. page-root 는 서버 렌더라 하이드레이션 전에 보이고, 그때의
 *  클릭은 아무 일도 하지 않는다 — 메뉴 카드(page-opt-moveto, 모든 페이지에 있다)가 뜰
 *  때까지 다시 누른다. 삭제 항목의 유무는 이 뒤에 따로 잰다. */
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

/** 1·2: 메뉴를 열고 항목·기하를 잰다. scope 는 피크처럼 ⋯ 가 둘인 화면을 가른다. */
const inspectMenu = async (page, tag, scope = "") => {
  const opened = await openMenu(page, scope);
  const del = page.locator(`${scope} [data-testid="page-opt-delete"]`.trim()).first();
  const present = opened && (await del.waitFor({ timeout: 5000 }).then(() => true, () => false));
  check(`${tag}1. ⋯ 메뉴에 휴지통으로 이동이 있다`, present && (await del.innerText()).trim() === LABEL, present ? (await del.innerText()).trim() : "없음");
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
  check(`${tag}2. 카드 폭 256 · radius 10`, g.w === MENU_W && g.radius === MENU_RADIUS, JSON.stringify({ w: g.w, radius: g.radius }));
  check(`${tag}2. 옮기기와 같은 잉크, 빨강이 아니다`, g.moveColor !== null && g.color === g.moveColor && !isRed(g.color), JSON.stringify({ color: g.color, moveto: g.moveColor }));
  check(`${tag}2. 옮기기 바로 다음 자리`, g.prev === "page-opt-moveto", `prev=${g.prev}`);
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
/** 5: 휴지통 모달에서 복원 → 표에 행이 돌아오고 표식이 지워진다 */
const restoreViaTrash = async (page, tag, hostPageId, rowId, pageId) => {
  await gotoDb(page, hostPageId);
  await page.locator('[data-testid="trash-button"]').click();
  await page.locator('[data-testid="trash-modal"]').waitFor({ timeout: 10_000 });
  const btn = page.locator(`[data-testid="trash-restore-${pageId}"]`);
  const listed = await btn.waitFor({ timeout: 10_000 }).then(() => true, () => false);
  check(`${tag}5. 휴지통 모달에 그 페이지가 있다`, listed);
  if (!listed) return;
  await btn.hover();
  await btn.click();
  await page.waitForTimeout(1500);
  const s = await rowState(rowId, pageId);
  check(`${tag}5. 복원하면 DB 표식이 사라진다`, s.rowExists && s.marked === false && s.pageArchived === false, JSON.stringify(s));
  await page.keyboard.press("Escape");
  await gotoDb(page, hostPageId);
  check(`${tag}5. 새로고침한 표에 행이 돌아와 있다`, (await page.locator(`[data-testid="db-row-${rowId}"]`).count()) === 1);
};
/** 4: 표에서 빠졌는가 — 새로고침 뒤에 행 testid 가 없고, DB 는 보관 + 표식 */
const assertRowGone = async (page, tag, hostPageId, rowId, pageId) => {
  const s = await rowState(rowId, pageId);
  check(`${tag}4. DB: pages.is_archived=true 이고 행에 __archived 표식`, s.pageArchived === true && s.rowExists && s.marked === true, JSON.stringify(s));
  await gotoDb(page, hostPageId);
  check(`${tag}4. 새로고침한 표에서 행이 사라졌다`, (await page.locator(`[data-testid="db-row-${rowId}"]`).count()) === 0);
};

try {
  const ws = (await pg.query("select workspace_id from workspace_members where user_id=$1 order by case role when 'owner' then 0 when 'admin' then 1 when 'member' then 2 else 3 end, joined_at limit 1", [OWNER])).rows[0]?.workspace_id;

  // 데이터베이스 (전체 페이지 · 표 뷰 하나 · 이름 속성 하나)
  const snap = await json(await api("/api/databases", { method: "POST", body: JSON.stringify({ shape: "minimal", title: `e2e 삭제 검사 ${stamp}` }) }), "POST /api/databases");
  const dbId = snap.database.id;
  madeDbs.push(dbId);
  const titleProp = snap.properties.find((p) => p.type === "title").id;
  const { pageId: hostPageId } = await json(await api(`/api/databases/${dbId}/fullpage`, { method: "POST" }), "POST fullpage");
  madePages.push(hostPageId);
  check("0. 픽스처: 데이터베이스와 호스트 페이지", !!dbId && !!hostPageId && snap.database.workspaceId === ws, `db=${dbId} host=${hostPageId}`);

  const rowA = await mkRowWithPage(dbId, titleProp, `A 피크 ${stamp}`);
  const rowB = await mkRowWithPage(dbId, titleProp, `B 전체 ${stamp}`);
  const rowE = await mkRowWithPage(dbId, titleProp, `E 영구 ${stamp}`);
  const plainC = await mkPage(`C 일반 ${stamp}`);

  const page = await newPage(ownerCookie);

  // ── A. 표에서 연 행의 사이드 피크 ─────────────────────────────────────────
  {
    await gotoDb(page, hostPageId);
    const tr = page.locator(`[data-testid="db-row-${rowA.rowId}"]`);
    check("A0. 표에 행이 보인다", (await tr.count()) === 1);
    await tr.hover();
    await page.locator(`[data-testid="db-title-open-${rowA.rowId}"]`).click();
    const peek = page.locator('[data-testid="db-row-peek"]');
    await peek.waitFor({ timeout: 30_000 });
    if (await inspectMenu(page, "A", '[data-testid="db-row-peek"]')) {
      await peek.locator('[data-testid="page-opt-delete"]').click();
      check("A3. 성공 토스트", await toastText(page, OK_TOAST));
      const closed = await peek.waitFor({ state: "detached", timeout: 8000 }).then(() => true, () => false);
      check("A3. 피크가 닫힌다", closed);
      await page.waitForTimeout(1500);
      check("A4. 새로고침 없이도 열린 표에서 빠진다", (await page.locator(`[data-testid="db-row-${rowA.rowId}"]`).count()) === 0);
      await assertRowGone(page, "A", hostPageId, rowA.rowId, rowA.pageId);
      await restoreViaTrash(page, "A", hostPageId, rowA.rowId, rowA.pageId);
    }
  }

  // ── B. 행을 /p/<id> 전체 페이지로 ─────────────────────────────────────────
  {
    await page.goto(`${BASE}/p/${rowB.pageId}`, { waitUntil: "domcontentloaded", timeout: 180_000 });
    await page.waitForSelector('[data-testid="page-root"]', { timeout: 120_000 });
    if (await inspectMenu(page, "B")) {
      await page.locator('[data-testid="page-opt-delete"]').first().click();
      check("B3. 성공 토스트", await toastText(page, OK_TOAST));
      const left = await page.waitForURL((u) => !u.pathname.includes(rowB.pageId), { timeout: 15_000 }).then(() => true, () => false);
      check("B3. /p/<행 페이지> 를 떠난다", left, page.url());
      await page.waitForTimeout(800);
      await assertRowGone(page, "B", hostPageId, rowB.rowId, rowB.pageId);
      await restoreViaTrash(page, "B", hostPageId, rowB.rowId, rowB.pageId);
    }
  }

  // ── C. 일반 페이지 ───────────────────────────────────────────────────────
  {
    await page.goto(`${BASE}/p/${plainC}`, { waitUntil: "domcontentloaded", timeout: 180_000 });
    await page.waitForSelector('[data-testid="page-root"]', { timeout: 120_000 });
    if (await inspectMenu(page, "C")) {
      await page.locator('[data-testid="page-opt-delete"]').first().click();
      check("C3. 성공 토스트", await toastText(page, OK_TOAST));
      const left = await page.waitForURL((u) => !u.pathname.includes(plainC), { timeout: 15_000 }).then(() => true, () => false);
      check("C3. /p/<id> 를 떠난다", left, page.url());
      await page.waitForTimeout(800);
      const { rows: [p] } = await pg.query("select is_archived from pages where id=$1", [plainC]);
      check("C4. DB: pages.is_archived=true", p?.is_archived === true, JSON.stringify(p));
      await page.locator('[data-testid="trash-button"]').click();
      const btn = page.locator(`[data-testid="trash-restore-${plainC}"]`);
      const listed = await btn.waitFor({ timeout: 10_000 }).then(() => true, () => false);
      check("C5. 휴지통 모달에 있다", listed);
      if (listed) {
        await btn.hover();
        await btn.click();
        await page.waitForTimeout(1500);
        const { rows: [q] } = await pg.query("select is_archived from pages where id=$1", [plainC]);
        check("C5. 복원하면 보관이 풀린다", q?.is_archived === false, JSON.stringify(q));
        await page.keyboard.press("Escape");
        await page.reload({ waitUntil: "domcontentloaded" });
        const back = await page.locator(`[data-testid="page-tree-item-${plainC}"]`).waitFor({ timeout: 60_000 }).then(() => true, () => false);
        check("C5. 새로고침한 사이드바에 돌아와 있다", back);
      }
    }
  }

  // ── D. 거절: edit 공유만 받은 게스트 ──────────────────────────────────────
  {
    const pageD = await mkPage(`D 게스트 거절 ${stamp}`);
    const { rows: [u] } = await pg.query("insert into users (display_name, email) values ($1,$2) returning id", ["e2e-guest", `e2e-page-delete-guest-${stamp}@example.invalid`]);
    temps.push(u.id);
    await pg.query("insert into workspace_members (workspace_id, user_id, role) values ($1,$2,'guest')", [ws, u.id]);
    await pg.query("insert into page_members (page_id, user_id, permission) values ($1,$2,'edit')", [pageD, u.id]);
    const guest = await seal(u.id);

    const del = await api(`/api/pages/${pageD}`, { method: "DELETE" }, guest);
    check("D1. 게스트 DELETE 는 403", del.status === 403, `status=${del.status}`);
    const patch = await api(`/api/pages/${pageD}`, { method: "PATCH", body: JSON.stringify({ isArchived: true }) }, guest);
    check("D1. PATCH {isArchived} 도 403", patch.status === 403, `status=${patch.status}`);
    const { rows: [d0] } = await pg.query("select is_archived from pages where id=$1", [pageD]);
    check("D2. 페이지는 그대로다", d0?.is_archived === false, JSON.stringify(d0));

    const gp = await newPage(guest);
    await gp.goto(`${BASE}/p/${pageD}`, { waitUntil: "domcontentloaded", timeout: 180_000 });
    const opened = await gp.waitForSelector('[data-testid="page-root"]', { timeout: 120_000 }).then(() => true, () => false);
    check("D3. 게스트가 공유받은 페이지를 연다", opened, gp.url());
    if (opened) {
      const menuOpen = await openMenu(gp);
      const item = gp.locator('[data-testid="page-opt-delete"]').first();
      const present = menuOpen && (await item.waitFor({ timeout: 5000 }).then(() => true, () => false));
      check("D3. 게스트 메뉴에도 항목이 있다 (누르면 거절)", present);
      if (present) {
        await item.click();
        check("D4. 실패 토스트 휴지통으로 이동하지 못했습니다", await toastText(gp, FAIL_TOAST));
        check("D4. 성공 토스트는 뜨지 않는다", (await gp.locator('[data-testid="toast-message"]', { hasText: new RegExp(`^${OK_TOAST}$`) }).count()) === 0);
        await gp.waitForTimeout(1500);
        check("D4. 페이지에 그대로 머문다", gp.url().includes(pageD) && (await gp.locator('[data-testid="page-root"]').count()) > 0, gp.url());
        const { rows: [d1] } = await pg.query("select is_archived from pages where id=$1", [pageD]);
        check("D4. DB 도 그대로", d1?.is_archived === false, JSON.stringify(d1));
        await gp.reload({ waitUntil: "domcontentloaded" });
        const inTree = await gp.locator(`[data-testid="page-tree-item-${pageD}"]`).waitFor({ timeout: 60_000 }).then(() => true, () => false);
        check("D5. 새로고침 뒤에도 사이드바 트리에 있다", inTree);
      }
    }
    await gp.context().close();
  }

  // ── E. 영구 삭제는 행 레코드까지 ──────────────────────────────────────────
  {
    const soft = await api(`/api/pages/${rowE.pageId}`, { method: "DELETE" });
    const s0 = await rowState(rowE.rowId, rowE.pageId);
    check("E1. 소프트 삭제: 행은 남고 표식만", soft.ok && s0.rowExists && s0.marked === true && s0.pageArchived === true, JSON.stringify({ status: soft.status, ...s0 }));
    const hard = await api(`/api/pages/${rowE.pageId}?permanent=1`, { method: "DELETE" });
    const s1 = await rowState(rowE.rowId, rowE.pageId);
    check("E2. ?permanent=1: 페이지와 db_rows 레코드 모두 사라진다", hard.ok && !s1.rowExists && s1.pageArchived === null, JSON.stringify({ status: hard.status, ...s1 }));
  }

  check("Z. 페이지 오류 없음", errors.length === 0, errors.join(" | ").slice(0, 400));
} catch (e) {
  check("실행", false, String(e?.stack ?? e).slice(0, 400));
} finally {
  // 행 페이지는 호스트 아래라 호스트를 지우면 cascade 가 아니다(parent 는 FK 아님) — 하나씩
  for (const id of madePages) await pg.query("delete from pages where id=$1", [id]).catch((e) => console.log(`  · 페이지 ${id} 정리 실패: ${e.message}`));
  for (const id of madeDbs) await pg.query("delete from databases where id=$1", [id]).catch((e) => console.log(`  · DB ${id} 정리 실패: ${e.message}`));
  for (const id of temps) {
    await pg.query("delete from page_members where user_id=$1", [id]).catch(() => {});
    await pg.query("delete from workspace_members where user_id=$1", [id]).catch(() => {});
    await pg.query("delete from notifications where actor_id=$1 or user_id=$1", [id]).catch(() => {});
    const drop = await pg.query("delete from users where id=$1", [id]).catch((e) => e);
    if (drop instanceof Error) console.log(`  · 검사용 사용자 ${id} 를 못 지웠습니다: ${drop.message}`);
  }
  await pg.end().catch(() => {});
  await browser.close();
}
console.log(fails ? `\n${fails} FAILED` : "\nall checks passed");
process.exit(fails ? 1 : 0);
