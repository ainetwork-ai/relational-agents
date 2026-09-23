// 댓글의 멘션(@) — 원본(노션) 측정치와 대조. docs/notion-comment-mention.md
//
// 2026-09-10 에 노션 댓글 입력줄에 실제로 @ 를 쳐 가며 잰 것을
// e2e/fixtures/notion-comment-mention.json 에 넣어 두었고, 이 스크립트가 우리 쪽을
// 같은 방식으로 재서 대조한다.
//
//   [BASE_URL=…] [PAGE_ID=…] node e2e/mention.check.mjs
//
// 순서 규칙을 결정적으로 재려고 dev DB 에 검사용 멤버를 만들었다 지운다
// (comment-delete.check.mjs 와 같은 방식). 몇 번을 돌려도 dev 데이터가 늘지 않는다.
import fs from "node:fs";
import { sealData } from "iron-session";
import { chromium } from "@playwright/test";
import { Client } from "pg";

const BASE = process.env.BASE_URL ?? "http://localhost:3110";
const ME = process.env.USER_ID ?? "8ccf17a7-24fb-4ae9-974c-94bf5db0cf85"; // hyeonjj@comcom.ai
const PAGE_ID = process.env.PAGE_ID ?? "46802c30-928f-4df6-a032-c53e478e7f73";

const F = JSON.parse(fs.readFileSync(new URL("./fixtures/notion-comment-mention.json", import.meta.url), "utf8"));
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

// ── 검사용 멤버: 순서 규칙을 결정적으로 재기 위한 이름들 ────────────────────
const stamp = Date.now();
// 이름은 **실제 워크스페이스와 겹치지 않는 것**이어야 한다. 처음엔 Kim 계열로 썼는데
// dev 워크스페이스에 이미 Minhyun Kim(kimminhyun@comcom.ai)이 있어서, 그 사람이 검사용
// 사용자 사이에 끼어들어 순서 단언이 무의미해졌다. 아무 데도 없는 성을 쓴다.
const Q = "Qwix";
const TEMPS = [
  { key: "qsan", name: "Qwix San", role: "member" },       // 이름 맨 앞      → 0
  { key: "bora", name: "Bora Qwix", role: "member" },      // 단어 맨 앞      → 1
  { key: "minho", name: "Minho Qwix", role: "member" },    // 같은 1, 뒤 순서
  { key: "hong", name: "홍혜령", role: "member" },           // 초성 ㅎ
  { key: "gq", name: "Qwixella", role: "guest" },          // 이름 맨 앞이지만 게스트 → 0+1
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

/** 입력줄을 비우고 주어진 문자열을 친다 (실제 키 입력). */
async function typeIn(s) {
  const el = input();
  await el.click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("Backspace");
  await page.waitForTimeout(120);
  if (s) await el.type(s, { delay: 45 });
  await page.waitForTimeout(500);
}

/** 메뉴에 보이는 사람 이름들, 그려진 순서대로. */
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
  check("0. 검사 페이지의 워크스페이스를 찾았다", !!wsId, String(wsId));

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

  // ── T. 언제 열리고 닫히나 (§1) ────────────────────────────────────────────
  await typeIn("@");
  check("T1. 빈 입력줄의 @ 는 연다", await menuOpen());
  await typeIn("x@");
  check("T2. 글자 바로 뒤의 @ 도 연다 (단어 경계를 안 따진다)", await menuOpen());
  await typeIn("x @");
  check("T3. 공백 뒤의 @ 도 연다", await menuOpen());
  await typeIn("@ ");
  check("T4. @ 바로 뒤가 공백이면 닫는다", !(await menuOpen()));
  await typeIn(`@${Q} `);
  check("T5. 질의 뒤의 공백으로는 닫히지 않는다", await menuOpen());
  await typeIn(`@${Q} s`);
  check("T6. 질의 가운데 공백은 질의의 일부다", await menuOpen());
  await typeIn(`@${Q}`);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  check("T7. Escape 는 메뉴만 닫는다 (글자는 그대로)", !(await menuOpen()) && (await input().inputValue()) === `@${Q}`,
    await input().inputValue());

  // 이메일 주소는 멘션이 아니다 — 원본과 의도적으로 다른 한 가지(§7).
  // 이메일도 검색 대상이라(§2) 이걸 안 막으면 `ping me@comcom.ai` 에서 전 구성원이
  // 걸리고 Enter 가 주소를 이름으로 바꿔 버린다. 보내려던 글이 조용히 망가진다.
  await typeIn("ping someone@example.invalid");
  check("T8. 이메일 주소에서는 열리지 않는다", !(await menuOpen()), await input().inputValue());
  {
    const before = await page.evaluate(() => document.querySelectorAll('[data-testid^="comment-row-"]').length);
    await page.keyboard.press("Enter");
    await page.waitForTimeout(1200);
    const after = await page.evaluate(() => document.querySelectorAll('[data-testid^="comment-row-"]').length);
    check("T8. 그래서 Enter 로 보낼 수 있다", after === before + 1, JSON.stringify({ before, after }));
    const row = page.locator('[data-testid^="comment-row-"]').last();
    const id = (await row.getAttribute("data-testid").catch(() => "") || "").replace("comment-row-", "");
    if (id) sentComments.push(id);
  }

  // ── S. 검색과 순서 (§2) ──────────────────────────────────────────────────
  await typeIn(`@${Q}`);
  const got = await people();
  const idx = (n) => got.findIndex((s) => s.startsWith(n));
  check("S1. 이름 맨 앞 일치가 가장 위", idx("Qwix San") === 0, JSON.stringify(got));
  check("S2. 단어 맨 앞 일치가 그 다음", idx("Bora Qwix") > 0 && idx("Minho Qwix") > idx("Bora Qwix"), JSON.stringify(got));
  check("S3. 게스트는 같은 등급에서 맨 아래", idx("Qwixella") === got.length - 1, JSON.stringify(got));

  await typeIn(`@${Q.toUpperCase()}`);
  check("S4. 대소문자를 가리지 않는다", JSON.stringify(await people()) === JSON.stringify(got));

  await typeIn("@ㅎ");
  const jamo = await people();
  check("S5. 한글 초성으로 찾는다 (ㅎ → 홍혜령)", jamo.some((s) => s.startsWith("홍혜령")), JSON.stringify(jamo));

  await typeIn("@e2e-mention-hong");
  const byMail = await people();
  check("S6. 이메일로도 찾는다", byMail.some((s) => s.startsWith("홍혜령")), JSON.stringify(byMail));

  await typeIn("@example.invalid");
  check("S7. 이메일 도메인으로도 찾는다", (await people()).length >= 5, String((await people()).length));

  await typeIn("@");
  const bare = await people();
  check("S8. 사람은 5개까지 보인다", bare.length <= F.search.peopleShown, String(bare.length));
  const more = page.locator('[data-testid="mention-more"]');
  check("S9. 넘치면 `N개 결과 더 보기` 한 줄", (await more.count()) === 1 && /\d+개 결과 더 보기/.test((await more.innerText().catch(() => "")) || ""),
    (await more.innerText().catch(() => "없음")));

  // ── G. 모달 기하 (§3) ────────────────────────────────────────────────────
  await typeIn(`@${Q}`);
  const g = await menu().evaluate((m) => {
    const s = getComputedStyle(m);
    const row = m.querySelector('[data-testid^="mention-item-"]');
    const rs = row && getComputedStyle(row);
    const rr = row && row.getBoundingClientRect();
    const av = row && row.querySelector("img, svg, [data-avatar]");
    const avr = av && av.getBoundingClientRect();
    const head = [...m.querySelectorAll("*")].find((e) => e.children.length === 0 && ["날짜", "사람", "페이지 링크", "그룹", "Date", "Person", "Page", "Group"].includes((e.innerText || "").trim()));
    const hs = head && getComputedStyle(head);
    const hr = head && head.getBoundingClientRect();
    const mr = m.getBoundingClientRect();
    return {
      w: Math.round(m.offsetWidth), maxH: s.maxHeight, radius: s.borderRadius, ovY: s.overflowY, shadow: s.boxShadow,
      row: rr ? { w: Math.round(row.offsetWidth), h: Math.round(row.offsetHeight), radius: rs.borderRadius, inset: Math.round(rr.left - mr.left) } : null,
      avatar: avr ? { w: Math.round(avr.width), left: Math.round(avr.left - rr.left) } : null,
      head: hr ? { fs: hs.fontSize, fw: hs.fontWeight, color: hs.color, indent: Math.round(hr.left - mr.left) } : null,
    };
  });
  check("G1. 카드 폭 330", g.w === F.menu.card.width, String(g.w));
  check("G2. 카드 최대 높이 325 · radius 10 · 세로 스크롤", g.maxH === `${F.menu.card.maxHeight}px` && g.radius === F.menu.card.radius && /auto|scroll/.test(g.ovY),
    JSON.stringify({ maxH: g.maxH, radius: g.radius, ovY: g.ovY }));
  check("G3. 행 322 × 28 · radius 6 · 좌우 4 안쪽",
    !!g.row && g.row.w === F.menu.row.width && g.row.h === F.menu.row.height && g.row.radius === F.menu.row.radius && near(g.row.inset, F.menu.row.insetFromCard),
    JSON.stringify(g.row));
  check("G4. 아바타 20, 왼쪽 8", !!g.avatar && near(g.avatar.w, F.menu.row.avatar) && near(g.avatar.left, F.menu.row.avatarLeft), JSON.stringify(g.avatar));
  check("G5. 섹션 머리 12px/500 rgb(125,122,117), 12 들여씀",
    !!g.head && g.head.fs === F.menu.header.fontSize && g.head.fw === F.menu.header.fontWeight && g.head.color === F.menu.header.color && near(g.head.indent, F.menu.header.indentFromCard),
    JSON.stringify(g.head));

  // ── E. 결과 없음 (§4) ────────────────────────────────────────────────────
  await typeIn("@zzqqzz");
  const empty = page.locator('[data-testid="mention-empty"]');
  check("E1. 결과가 없으면 `결과 없음` 을 보여준다 (사라지지 않는다)", (await empty.count()) === 1);
  if (await empty.count()) {
    const e = await menu().evaluate((m) => {
      const t = m.querySelector('[data-testid="mention-empty"]');
      const s = getComputedStyle(t); const r = t.getBoundingClientRect(); const mr = m.getBoundingClientRect();
      return { h: Math.round(m.offsetHeight), fs: s.fontSize, fw: s.fontWeight, color: s.color, left: Math.round(r.left - mr.left), top: Math.round(r.top - mr.top), text: (t.innerText || "").trim() };
    });
    check("E2. 카드가 330 × 65 로 줄고 문구·색이 같다",
      near(e.h, F.menu.empty.cardHeight, 2) && e.fs === F.menu.empty.fontSize && e.color === F.menu.empty.color && near(e.left, F.menu.empty.left) && near(e.top, F.menu.empty.top, 2),
      JSON.stringify(e));
  }

  // ── P. 고르면 무엇이 들어가나 (§5) ───────────────────────────────────────
  await typeIn("@Qwix San");
  const target = page.locator(`[data-testid="mention-item-person-${TEMPS[0].id}"]`);
  check("P0. 고를 행이 있다", (await target.count()) === 1);
  if (await target.count()) {
    await target.click();
    await page.waitForTimeout(500);
    const v = await input().inputValue();
    check("P1. `@이름 ` 이 들어가고 뒤에 공백 한 칸", v === "@Qwix San ", JSON.stringify(v));
    check("P1. 그리고 메뉴는 닫힌다", !(await menuOpen()));
    await page.keyboard.press("Backspace");
    await page.waitForTimeout(250);
    check("P2. 첫 Backspace 는 공백만 지운다", (await input().inputValue()) === "@Qwix San", JSON.stringify(await input().inputValue()));
    await page.keyboard.press("Backspace");
    await page.waitForTimeout(250);
    check("P3. 두 번째 Backspace 가 멘션을 통째로 지운다", (await input().inputValue()) === "", JSON.stringify(await input().inputValue()));
  }

  // ── K. 키보드 (§3) ───────────────────────────────────────────────────────
  await typeIn(`@${Q}`);
  const before = await page.evaluate(() => document.querySelectorAll('[data-testid^="comment-row-"]').length);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(900);
  const after = await page.evaluate(() => document.querySelectorAll('[data-testid^="comment-row-"]').length);
  check("K1. 메뉴가 열려 있을 때 Enter 는 고르는 것이지 보내는 것이 아니다",
    after === before && /^@\S/.test(await input().inputValue()), JSON.stringify({ before, after, v: await input().inputValue() }));

  check("Z. 페이지 오류 없음", errors.length === 0, errors.slice(0, 2).join(" | "));
} catch (e) {
  check("실행", false, String(e).slice(0, 300));
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
    if (drop instanceof Error) console.log(`  · 검사용 사용자 ${id} 를 못 지웠습니다: ${drop.message}`);
  }
  await pg.end().catch(() => {});
  await browser.close();
}
console.log(fails ? `\n${fails} FAILED` : "\nall checks passed");
process.exit(fails ? 1 : 0);
