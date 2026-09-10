// 댓글 삭제 — 원본(노션) 측정치와 대조. docs/notion-comment-delete.md
//
// 2026-09-10 에 현정 테스트 팀스페이스에서 직접 댓글을 달아 재었다:
//   · 댓글에 마우스를 올리면 오른쪽에 `댓글 작업` 툴바가 뜨고, ⋯(추가 작업) 이 열린다
//   · 메뉴는 180 폭 / 28 행 / radius 10, 글자색 rgb(44,44,43) — 빨강이 아니다
//   · 내 댓글에만 편집하기·삭제하기 가 있다. 남의 댓글은 읽지 않음으로 표시·링크 복사 뿐
//   · 삭제하기 → 324×145 / radius 12 확인창 "이 댓글을 삭제하시겠습니까?",
//     빨강 삭제 rgb(229,100,88) 아래 취소
//   · 스레드 머리를 지워도 답글은 남는다 (캐스케이드 아님)
//
// A1–A7 은 측정이 아니라 2026-09-10 심사에서 재현한 두 구멍의 회귀 검사다
// (docs/notion-comment-delete.md §6.1): 페이지를 하나도 공유받지 않은 게스트가
// 댓글을 읽고 해결까지 할 수 있었고, 워크스페이스에서 빠진 사람이 예전 자기
// 댓글을 계속 고치고 지울 수 있었다. 고치기 전 코드에서는 일곱 개 모두 실패한다.
//
//   [BASE_URL=…] [PAGE_ID=…] node e2e/comment-delete.check.mjs
//
// 자기가 만든 댓글만 쓰고 지운다 — 몇 번을 돌려도 dev 데이터가 늘지 않는다.
import fs from "node:fs";
import { sealData } from "iron-session";
import { chromium } from "@playwright/test";
import { Client } from "pg";

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
const temps = [];            // 검사용으로 만든 사용자 — 끝나면 지운다
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
    const mine = track(await post("삭제 권한 검사용"));
    const asOther = await del(mine.id, otherCookie);
    check("S1. 남이 내 댓글을 지우려 하면 403", asOther.status === 403, `status=${asOther.status}`);
    check("S1. 그리고 댓글은 그대로 남는다", (await list()).some((c) => c.id === mine.id));
    const asMe = await del(mine.id);
    check("S2. 작성자가 지우면 200", asMe.ok, `status=${asMe.status}`);
    check("S2. 목록에서 사라진다", !(await list()).some((c) => c.id === mine.id));
  }
  // ── server: 머리를 지워도 답글은 남는다 (노션과 같게) ────────────────────
  {
    const root = track(await post("루트 — 답글 보존 검사"));
    const reply = track(await post("답글 — 남아 있어야 함", root.id));
    check("S3. 머리 삭제는 200", (await del(root.id)).ok);
    const after = await list();
    check("S3. 답글은 살아남는다", after.some((c) => c.id === reply.id), `n=${after.length}`);
    await del(reply.id);
  }
  // ── 접근 권한: 워크스페이스에 있다는 사실만으로는 댓글에 닿지 못한다 ─────
  //
  // 두 구멍을 재현해 막은 자리다(2026-09-10 심사).
  //  1) 게이트가 workspace_members 만 봤다 → 게스트(= 공유받은 페이지만 보는
  //     사람)도 멤버 행을 갖고 있으므로 워크스페이스의 모든 댓글을 읽고
  //     해결/재개할 수 있었다.
  //  2) 편집·삭제 게이트가 접근 검사를 **대체**했다 → 워크스페이스에서 빠진
  //     사람이 예전 자기 댓글을 계속 고치고 지울 수 있었다.
  {
    const { rows: [pg0] } = await pg.query("select workspace_id from pages where id=$1", [PAGE_ID]);
    const wsId = pg0?.workspace_id;
    check("A0. 검사 페이지의 워크스페이스를 찾았다", !!wsId, String(wsId));

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

    // (1) 페이지를 하나도 공유받지 않은 게스트
    const guestId = await mkUser("guest");
    await join(guestId, "guest");
    const guest = await seal(guestId);
    const bait = track(await post("게스트가 보면 안 되는 댓글"));

    const read = await api(`/api/pages/${PAGE_ID}/comments`, {}, guest);
    check("A1. 게스트는 페이지 댓글을 읽지 못한다", read.status === 404, `status=${read.status}`);
    const resolve = await api(`/api/comments/${bait.id}`, { method: "PATCH", body: JSON.stringify({ resolved: true }) }, guest);
    check("A2. 게스트는 남의 스레드를 해결하지 못한다", resolve.status === 404, `status=${resolve.status}`);
    const gDel = await api(`/api/comments/${bait.id}`, { method: "DELETE" }, guest);
    check("A3. 게스트의 삭제도 막힌다", gDel.status === 404, `status=${gDel.status}`);
    const { rows: [still] } = await pg.query("select resolved from comments where id=$1", [bait.id]);
    check("A4. 그리고 댓글은 손대지 않은 그대로다", !!still && still.resolved === false, JSON.stringify(still));

    // (2) 댓글을 남기고 워크스페이스에서 빠진 사람
    const exId = await mkUser("exmember");
    await join(exId, "member");
    const ex = await seal(exId);
    const theirs = track(await post("나간 사람이 남긴 댓글", null, ex));
    await pg.query("delete from workspace_members where workspace_id=$1 and user_id=$2", [wsId, exId]);

    const edit = await api(`/api/comments/${theirs.id}`, { method: "PATCH", body: JSON.stringify({ body: "고쳐버림" }) }, ex);
    check("A5. 나간 사람은 자기 옛 댓글도 고치지 못한다", edit.status === 404, `status=${edit.status}`);
    const exDel = await api(`/api/comments/${theirs.id}`, { method: "DELETE" }, ex);
    check("A6. 지우지도 못한다", exDel.status === 404, `status=${exDel.status}`);
    const { rows: [kept] } = await pg.query("select body from comments where id=$1", [theirs.id]);
    check("A7. 본문이 그대로 남아 있다", kept?.body === "나간 사람이 남긴 댓글", JSON.stringify(kept));
    await pg.query("delete from comments where id=$1", [theirs.id]);
  }

  // ── UI ───────────────────────────────────────────────────────────────────
  const target = track(await post("UI 삭제 검사용 댓글"));
  await page.goto(`${BASE}/p/${PAGE_ID}`, { waitUntil: "domcontentloaded", timeout: 180_000 });
  await page.waitForSelector("[data-testid='page-comment-section']", { timeout: 120_000 });
  const row = page.locator(`[data-testid="comment-row-${target.id}"]`);
  await row.waitFor({ timeout: 30_000 });

  // 기하가 그대로여야 한다 — 세 골든 검사가 이 행을 픽셀로 잰다
  const geo = await row.evaluate((el) => {
    const spans = el.querySelectorAll("span");
    const first = el.firstElementChild;
    return {
      firstTag: first?.tagName,
      firstIsActions: first?.getAttribute("aria-label") === "댓글 작업",
      spanCount: spans.length,
      span0: (spans[0]?.textContent || "").slice(0, 20),
      span1: (spans[1]?.textContent || "").slice(0, 20),
      pTag: !!el.querySelector("p"),
      actionsIsLast: el.lastElementChild?.getAttribute("aria-label"),
      actionsAbsolute: el.lastElementChild ? getComputedStyle(el.lastElementChild).position : null,
      h: Math.round(el.getBoundingClientRect().height),
    };
  });
  check("G1. 아바타가 여전히 첫 자식 (액션이 아니다)", ["IMG", "DIV", "SPAN"].includes(geo.firstTag) && !geo.firstIsActions, JSON.stringify({ firstTag: geo.firstTag, isActions: geo.firstIsActions }));
  check("G2. 이름·날짜가 여전히 첫 두 span", geo.span0.length > 0 && /\d/.test(geo.span1), `span0="${geo.span0}" span1="${geo.span1}"`);
  check("G3. 본문 <p> 그대로", geo.pTag);
  check("G4. 액션은 마지막 자식이고 absolute — 흐름을 밀지 않는다", geo.actionsIsLast !== null && geo.actionsAbsolute === "absolute", JSON.stringify({ last: geo.actionsIsLast, pos: geo.actionsAbsolute }));

  // 호버 → ⋯
  const more = page.locator(`[data-testid="comment-more-${target.id}"]`);
  check("U1. 호버 전에는 액션이 보이지 않는다", (await row.locator("[aria-label]").first().evaluate((el) => getComputedStyle(el.closest("[aria-label]")).opacity).catch(() => "1")) === "0" || (await more.evaluate((el) => getComputedStyle(el.parentElement).opacity)) === "0");
  await row.hover();
  await page.waitForTimeout(300);
  check("U2. 호버하면 ⋯ 가 나타난다", (await more.evaluate((el) => getComputedStyle(el.parentElement).opacity)) === "1");

  await more.click();
  const menu = page.locator(`[data-testid="comment-menu-${target.id}"]`);
  await menu.waitFor({ timeout: 5000 });
  const m = await menu.evaluate((el) => { const r = { width: el.offsetWidth }; const s = getComputedStyle(el); const b = el.querySelector("button"); const br = { height: b.offsetHeight }; const bs = getComputedStyle(b); return { w: Math.round(r.width), radius: s.borderRadius, itemH: Math.round(br.height), itemText: (b.textContent || "").trim(), itemColor: bs.color }; });
  check("U3. 메뉴 폭 180 · radius 10 · 행 28", m.w === MENU_W && m.radius === MENU_RADIUS && m.itemH === ROW_H, JSON.stringify(m));
  check("U4. 항목은 삭제하기", m.itemText === "삭제하기", m.itemText);
  check("U5. 삭제 항목은 빨강이 아니다 (원본과 같게)", m.itemColor !== RED, m.itemColor);

  await page.locator(`[data-testid="comment-delete-${target.id}"]`).click();
  const dlg = page.locator(`[data-testid="comment-delete-confirm-${target.id}"]`);
  await dlg.waitFor({ timeout: 5000 });
  const d = await dlg.evaluate((el) => { const r = { width: el.offsetWidth }; const s = getComputedStyle(el); const yes = el.querySelector("[data-testid^='comment-delete-yes']"); const no = el.querySelector("[data-testid^='comment-delete-no']"); const ys = getComputedStyle(yes); return { w: Math.round(r.width), radius: s.borderRadius, title: (el.querySelector("p")?.textContent || "").trim(), yesText: (yes.textContent || "").trim(), yesBg: ys.backgroundColor, yesColor: ys.color, noText: (no.textContent || "").trim(), noBelow: no.getBoundingClientRect().top > yes.getBoundingClientRect().top }; });
  check("U6. 확인창 폭 324 · radius 12", d.w === DIALOG_W && d.radius === DIALOG_RADIUS, JSON.stringify({ w: d.w, radius: d.radius }));
  check("U7. 문구가 원본과 같다", d.title === "이 댓글을 삭제하시겠습니까?", d.title);
  check("U8. 삭제 버튼은 빨강 채움, 취소가 그 아래", d.yesText === "삭제" && d.yesBg === RED && d.noText === "취소" && d.noBelow, JSON.stringify(d));

  await page.locator(`[data-testid="comment-delete-no-${target.id}"]`).click();
  await page.waitForTimeout(400);
  check("U9. 취소하면 댓글이 남는다", (await row.count()) === 1 && (await dlg.count()) === 0);

  await row.hover();
  await more.click();
  await page.locator(`[data-testid="comment-delete-${target.id}"]`).click();
  await page.locator(`[data-testid="comment-delete-yes-${target.id}"]`).click();
  await page.waitForTimeout(1200);
  check("U10. 삭제하면 화면에서 사라진다", (await row.count()) === 0);
  check("U10. 서버에서도 사라진다", !(await list()).some((c) => c.id === target.id));

  // ── 남의 댓글에는 액션이 없다 ────────────────────────────────────────────
  {
    const theirs = track(await post("남의 댓글 — 액션 없어야 함", null, otherCookie));
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector(`[data-testid="comment-row-${theirs.id}"]`, { timeout: 30_000 });
    await page.locator(`[data-testid="comment-row-${theirs.id}"]`).hover();
    await page.waitForTimeout(300);
    check("U11. 남이 쓴 댓글에는 ⋯ 가 아예 없다", (await page.locator(`[data-testid="comment-more-${theirs.id}"]`).count()) === 0);
    await del(theirs.id, otherCookie);
  }
  check("Z. 페이지 오류 없음", errors.length === 0, errors.join(" | "));
} catch (e) {
  check("실행", false, String(e).slice(0, 200));
} finally {
  for (const id of made) await del(id).catch(() => {});
  for (const id of made) await del(id, otherCookie).catch(() => {});
  for (const id of temps) {
    await pg.query("delete from comments where author_id=$1", [id]).catch(() => {});
    await pg.query("delete from workspace_members where user_id=$1", [id]).catch(() => {});
 // 댓글을 달면 알림이 남는다. notifications.actor_id 는 cascade 가 아니라서
 // 이걸 먼저 지우지 않으면 users 삭제가 FK 로 막히고, .catch 가 그걸 삼킨다
    await pg.query("delete from notifications where actor_id=$1 or user_id=$1", [id]).catch(() => {});
    const drop = await pg.query("delete from users where id=$1", [id]).catch((e) => e);
    if (drop instanceof Error) console.log(`  · 검사용 사용자 ${id} 를 못 지웠습니다: ${drop.message}`);
  }
  await pg.end().catch(() => {});
  await browser.close();
}
console.log(fails ? `\n${fails} FAILED` : "\nall checks passed");
process.exit(fails ? 1 : 0);
