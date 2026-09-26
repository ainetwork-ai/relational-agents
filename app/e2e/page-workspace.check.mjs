// Is a new page saved in **the workspace of the place it hangs from** — not the one the session picked.
//
// Defect: POST /api/pages always put the page in "the currently selected workspace" (getDefaultWorkspaceId).
// So creating a row in ComCom › Projects with the personal workspace selected saved that row page in
// the personal workspace. Moving it to the Trash put the page in **another workspace's Trash**, and it
// could not be restored from where it was deleted (follow-up to docs/notion-page-delete.md).
//
// This check deliberately pins the session's active workspace to **somewhere else** before creating.
//
//   [BASE_URL=…] [USER_ID=…] node e2e/page-workspace.check.mjs
//
// Uses only the pages and users it creates, and deletes them at the end.
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
  // it can only be measured with a user in two workspaces
  const { rows: memberships } = await pg.query(
    "select workspace_id, role from workspace_members where user_id=$1 and role <> 'guest'",
    [ME]
  );
  check("0. the user has two or more workspaces", memberships.length >= 2, String(memberships.length));
  if (memberships.length < 2) throw new Error("need a user with two workspaces");

  // B = the side with the database, A = a different one (the session is pinned here)
  const { rows: dbs } = await pg.query(
    `select d.id, d.workspace_id from databases d
       join blocks b on b.type='database' and b.alive and b.content->>'databaseId' = d.id::text
       join pages p on p.id = b.page_id and p.workspace_id = d.workspace_id and not p.is_archived
      where d.workspace_id = any($1::uuid[]) limit 1`,
    [memberships.map((m) => m.workspace_id)]
  );
  check("0. found a database with a host page", dbs.length === 1);
  const dbB = dbs[0];
  const wsB = dbB.workspace_id;
  const wsA = memberships.find((m) => m.workspace_id !== wsB).workspace_id;
  const cookieA = await seal(ME, wsA);
  const H = headers(cookieA);

  // ── R. row page ───────────────────────────────────────────────────────────
  {
    const r = await fetch(`${BASE}/api/pages`, {
      method: "POST",
      headers: H,
      body: JSON.stringify({ title: "ZZ ws-check row", rowForDatabaseId: dbB.id }),
    });
    const page = (await r.json()).page;
    if (page?.id) madePages.push(page.id);
    check("R1. can create a row page with another workspace selected", r.status === 201, `status=${r.status}`);
    const at = page?.id ? await wsOf(page.id) : null;
    check("R2. the row page is saved in the database's workspace", at?.workspace_id === wsB,
      JSON.stringify({ saved: at?.workspace_id, database: wsB, session: wsA }));

    // after sending it to the Trash, it must show in that workspace's Trash to be restorable
    const del = await fetch(`${BASE}/api/pages/${page.id}`, { method: "DELETE", headers: H });
    check("R3. move to Trash", del.ok, `status=${del.status}`);
    const trashB = await (await fetch(`${BASE}/api/pages?archived=1&workspaceId=${wsB}`, { headers: H })).json();
    check("R4. shows in the Trash of the database's workspace",
      (trashB.pages ?? []).some((p) => p.id === page.id));
    const trashA = await (await fetch(`${BASE}/api/pages?archived=1&workspaceId=${wsA}`, { headers: H })).json();
    check("R5. not in the wrong workspace's Trash", !(trashA.pages ?? []).some((p) => p.id === page.id));
    const res = await fetch(`${BASE}/api/pages/${page.id}`, {
      method: "PATCH",
      headers: H,
      body: JSON.stringify({ isArchived: false }),
    });
    check("R6. it restores", res.ok && (await wsOf(page.id))?.is_archived === false, `status=${res.status}`);
  }

  // ── S. subpage ────────────────────────────────────────────────────────────
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
    check("S1. can create a subpage", r.status === 201, `status=${r.status}`);
    check("S2. the subpage is saved in the parent's workspace", (await wsOf(page?.id))?.workspace_id === wsB,
      JSON.stringify({ saved: (await wsOf(page?.id))?.workspace_id, parent: wsB }));
  }

  // a page created without a parent still goes to the workspace the session picked
  {
    const r = await fetch(`${BASE}/api/pages`, { method: "POST", headers: H, body: JSON.stringify({ title: "ZZ ws-check root" }) });
    const page = (await r.json()).page;
    if (page?.id) madePages.push(page.id);
    check("S3. without a parent, the workspace the session picked", (await wsOf(page?.id))?.workspace_id === wsA);
  }

  // ── X. cannot create under someone else's page or database ────────────────
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
    check("X1. someone outside the workspace cannot create under another's page", r1.status === 404 && after === before,
      JSON.stringify({ status: r1.status, before, after }));
    const r2 = await fetch(`${BASE}/api/pages`, {
      method: "POST",
      headers: HX,
      body: JSON.stringify({ title: "ZZ intruder row", rowForDatabaseId: dbB.id }),
    });
    check("X2. nor a row page in another's database", r2.status === 404, `status=${r2.status}`);
  }
} catch (e) {
  check("run", false
, String(e).slice(0, 300));
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
