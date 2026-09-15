// 새 페이지는 **매달린 곳의 워크스페이스**에 저장되는가 — 세션이 고른 워크스페이스가 아니라.
//
// 결함: POST /api/pages 가 늘 "지금 선택된 워크스페이스"(getDefaultWorkspaceId)에 페이지를
// 넣었다. 그래서 개인 워크스페이스를 고른 채 ComCom › Projects 에 행을 만들면, 그 행 페이지가
// 개인 워크스페이스에 저장됐다. 휴지통으로 이동하면 페이지가 **다른 워크스페이스의 휴지통**에
// 들어가, 지운 곳에서는 복원할 수 없었다(docs/notion-page-delete.md 후속).
//
// 이 검사는 일부러 세션의 활성 워크스페이스를 **다른 곳**으로 고정해 두고 만든다.
//
//   [BASE_URL=…] [USER_ID=…] node e2e/page-workspace.check.mjs
//
// 자기가 만든 페이지·사용자만 쓰고 끝나면 지운다.
import fs from "node:fs";
import { sealData } from "iron-session";
import { Client } from "pg";

const BASE = process.env.BASE_URL ?? "http://localhost:3110";
const ME = process.env.USER_ID ?? "8ccf17a7-24fb-4ae9-974c-94bf5db0cf85";

const env = fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const secret = env.match(/^SESSION_SECRET=(.*)$/m)?.[1].trim() || "dev-secret-change-in-production-32ch";
const pg = new Client({ connectionString: env.match(/^POSTGRES_URL=(.*)$/m)[1].trim() });
await pg.connect();

let fails = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) fails++;
};
const madePages = [];
const madeUsers = [];

const seal = (userId, activeWorkspaceId) =>
  sealData({ userId, ...(activeWorkspaceId ? { activeWorkspaceId } : {}) }, { password: secret, ttl: 0 });
const headers = (cookie) => ({ cookie: `rm-session=${cookie}`, "content-type": "application/json" });
const wsOf = async (pageId) =>
  (await pg.query("select workspace_id, is_archived from pages where id=$1", [pageId])).rows[0] ?? null;

try {
  // 두 워크스페이스에 속한 사용자여야 잴 수 있다
  const { rows: memberships } = await pg.query(
    "select workspace_id, role from workspace_members where user_id=$1 and role <> 'guest'",
    [ME]
  );
  check("0. 워크스페이스가 둘 이상인 사용자다", memberships.length >= 2, String(memberships.length));
  if (memberships.length < 2) throw new Error("need a user with two workspaces");

  // B = 데이터베이스가 있는 쪽, A = 그와 다른 쪽(세션을 여기 고정한다)
  const { rows: dbs } = await pg.query(
    `select d.id, d.workspace_id from databases d
       join blocks b on b.type='database' and b.alive and b.content->>'databaseId' = d.id::text
       join pages p on p.id = b.page_id and p.workspace_id = d.workspace_id and not p.is_archived
      where d.workspace_id = any($1::uuid[]) limit 1`,
    [memberships.map((m) => m.workspace_id)]
  );
  check("0. 호스트 페이지가 있는 데이터베이스를 찾았다", dbs.length === 1);
  const dbB = dbs[0];
  const wsB = dbB.workspace_id;
  const wsA = memberships.find((m) => m.workspace_id !== wsB).workspace_id;
  const cookieA = await seal(ME, wsA);
  const H = headers(cookieA);

  // ── R. 행 페이지 ──────────────────────────────────────────────────────────
  {
    const r = await fetch(`${BASE}/api/pages`, {
      method: "POST",
      headers: H,
      body: JSON.stringify({ title: "ZZ ws-check row", rowForDatabaseId: dbB.id }),
    });
    const page = (await r.json()).page;
    if (page?.id) madePages.push(page.id);
    check("R1. 다른 워크스페이스를 고른 채 행 페이지를 만들 수 있다", r.status === 201, `status=${r.status}`);
    const at = page?.id ? await wsOf(page.id) : null;
    check("R2. 행 페이지는 데이터베이스의 워크스페이스에 저장된다", at?.workspace_id === wsB,
      JSON.stringify({ saved: at?.workspace_id, database: wsB, session: wsA }));

    // 휴지통으로 보낸 뒤, 그 워크스페이스의 휴지통에서 보여야 복원할 수 있다
    const del = await fetch(`${BASE}/api/pages/${page.id}`, { method: "DELETE", headers: H });
    check("R3. 휴지통으로 이동", del.ok, `status=${del.status}`);
    const trashB = await (await fetch(`${BASE}/api/pages?archived=1&workspaceId=${wsB}`, { headers: H })).json();
    check("R4. 데이터베이스가 있는 워크스페이스의 휴지통에 보인다",
      (trashB.pages ?? []).some((p) => p.id === page.id));
    const trashA = await (await fetch(`${BASE}/api/pages?archived=1&workspaceId=${wsA}`, { headers: H })).json();
    check("R5. 엉뚱한 워크스페이스의 휴지통에는 없다", !(trashA.pages ?? []).some((p) => p.id === page.id));
    const res = await fetch(`${BASE}/api/pages/${page.id}`, {
      method: "PATCH",
      headers: H,
      body: JSON.stringify({ isArchived: false }),
    });
    check("R6. 복원된다", res.ok && (await wsOf(page.id))?.is_archived === false, `status=${res.status}`);
  }

  // ── S. 하위 페이지 ────────────────────────────────────────────────────────
  const { rows: [parentB] } = await pg.query(
    "select id from pages where workspace_id=$1 and not is_archived and not restricted limit 1",
    [wsB]
  );
  {
    const r = await fetch(`${BASE}/api/pages`, {
      method: "POST",
      headers: H,
      body: JSON.stringify({ title: "ZZ ws-check child", parentPageId: parentB.id }),
    });
    const page = (await r.json()).page;
    if (page?.id) madePages.push(page.id);
    check("S1. 하위 페이지를 만들 수 있다", r.status === 201, `status=${r.status}`);
    check("S2. 하위 페이지는 부모의 워크스페이스에 저장된다", (await wsOf(page?.id))?.workspace_id === wsB,
      JSON.stringify({ saved: (await wsOf(page?.id))?.workspace_id, parent: wsB }));
  }

  // 부모 없이 만든 페이지는 여전히 세션이 고른 워크스페이스로 간다
  {
    const r = await fetch(`${BASE}/api/pages`, { method: "POST", headers: H, body: JSON.stringify({ title: "ZZ ws-check root" }) });
    const page = (await r.json()).page;
    if (page?.id) madePages.push(page.id);
    check("S3. 부모가 없으면 세션이 고른 워크스페이스", (await wsOf(page?.id))?.workspace_id === wsA);
  }

  // ── X. 남의 페이지·데이터베이스 아래에는 못 만든다 ────────────────────────
  {
    const { rows: [u] } = await pg.query(
      "insert into users (display_name, email) values ($1,$2) returning id",
      ["ZZ ws outsider", `e2e-ws-outsider-${Date.now()}@example.invalid`]
    );
    madeUsers.push(u.id);
    const HX = headers(await seal(u.id));
    const before = (await pg.query("select count(*)::int n from pages where parent_page_id=$1", [parentB.id])).rows[0].n;
    const r1 = await fetch(`${BASE}/api/pages`, {
      method: "POST",
      headers: HX,
      body: JSON.stringify({ title: "ZZ intruder", parentPageId: parentB.id }),
    });
    const after = (await pg.query("select count(*)::int n from pages where parent_page_id=$1", [parentB.id])).rows[0].n;
    check("X1. 워크스페이스 밖의 사람은 남의 페이지 아래에 못 만든다", r1.status === 404 && after === before,
      JSON.stringify({ status: r1.status, before, after }));
    const r2 = await fetch(`${BASE}/api/pages`, {
      method: "POST",
      headers: HX,
      body: JSON.stringify({ title: "ZZ intruder row", rowForDatabaseId: dbB.id }),
    });
    check("X2. 남의 데이터베이스에 행 페이지도 못 만든다", r2.status === 404, `status=${r2.status}`);
  }
} catch (e) {
  check("실행", false, String(e).slice(0, 300));
} finally {
  for (const id of madePages) await pg.query("delete from pages where id=$1", [id]).catch(() => {});
  await pg.query("delete from pages where title like 'ZZ intruder%'").catch(() => {});
  for (const id of madeUsers) {
    await pg.query("delete from notifications where actor_id=$1 or user_id=$1", [id]).catch(() => {});
    await pg.query("delete from workspace_members where user_id=$1", [id]).catch(() => {});
    await pg.query("delete from users where id=$1", [id]).catch(() => {});
  }
  await pg.end();
}
console.log(fails ? `\n${fails} FAILED` : "\nall checks passed");
process.exit(fails ? 1 : 0);
