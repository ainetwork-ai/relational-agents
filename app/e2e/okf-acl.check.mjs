// Relationship docs are participant-only, and the OKF file tree has no
// permissions of its own — okf_acl plus a gate on every route IS the
// guarantee. A page id is base64url of the path, so anyone who can guess a
// room name can address the doc: each route has to ask, not assume.
//
// Sweeps every OKF-facing route with a participant and with an unrelated
// logged-in account. Participant must get through; the stranger must not,
// and must not learn the doc exists (404, never 403).
//
//   OKF_DOC="Relationship doc — vc-alice ❤️ vc-bob-81b609" \
//   [BASE_URL=http://localhost:36625] [MEMBER=vc-alice] node e2e/okf-acl.check.mjs
//
// Writes are non-destructive: PUT sends the doc's current blocks back, PATCH
// sends the current title, DELETE is archive-only (no ?permanent=1).

const BASE = process.env.BASE_URL ?? "http://localhost:36625";
const DOC = process.env.OKF_DOC ?? "Relationship doc — vc-alice ❤️ vc-bob-81b609";
const MEMBER = process.env.MEMBER ?? "vc-alice";
const STRANGER = process.env.STRANGER ?? "acl-stranger";

const SECRET = /ferry|sunset|Saturday|tteokbokki|nata/i;
const relPage = `${DOC}/Timeline.md`;
const id = (p) => Buffer.from(p, "utf8").toString("base64url");

async function login(as) {
  const r = await fetch(`${BASE}/api/auth/demo-login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ as }),
  });
  if (!r.ok) throw new Error(`login ${as}: ${r.status}`);
  return r.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
}

const member = await login(MEMBER);
const stranger = await login(STRANGER);

// current blocks — the payload for the non-destructive write probes
const cur = await (
  await fetch(`${BASE}/api/pages/${id(relPage)}/blocks`, { headers: { cookie: member } })
).json();
if (!Array.isArray(cur.blocks) || !cur.blocks.length) {
  console.error(`FAIL  setup — ${MEMBER} cannot read ${relPage}; is OKF_DOC right?`);
  process.exit(2);
}
// title + frontmatter as the file holds them now, so the write probes below
// can hand them straight back
const node = await (
  await fetch(`${BASE}/api/okf/node?path=${encodeURIComponent(relPage)}`, {
    headers: { cookie: member },
  })
).json().then((j) => j.node ?? j);
// timestamp is restamped on every write by design — compare the rest
const stable = (m) => {
  const { timestamp, ...rest } = m ?? {};
  return JSON.stringify(rest);
};
const metaBefore = stable(node.meta);

const probes = [
  ["GET  /api/pages/{id}", (c) => fetch(`${BASE}/api/pages/${id(relPage)}`, { headers: { cookie: c } })],
  ["GET  /api/pages/{id}/blocks", (c) => fetch(`${BASE}/api/pages/${id(relPage)}/blocks`, { headers: { cookie: c } })],
  ["GET  /api/okf/node", (c) => fetch(`${BASE}/api/okf/node?path=${encodeURIComponent(relPage)}`, { headers: { cookie: c } })],
  ["GET  /api/okf/pages", (c) => fetch(`${BASE}/api/okf/pages`, { headers: { cookie: c } })],
  ["GET  /api/okf/tree", (c) => fetch(`${BASE}/api/okf/tree`, { headers: { cookie: c } })],
  ["GET  /api/search", (c) => fetch(`${BASE}/api/search?q=ferry`, { headers: { cookie: c } })],
  ["GET  /p/{id}", (c) => fetch(`${BASE}/p/${id(relPage)}`, { headers: { cookie: c } })],
  [
    "PUT  /api/pages/{id}/blocks",
    (c) =>
      fetch(`${BASE}/api/pages/${id(relPage)}/blocks`, {
        method: "PUT",
        headers: { "content-type": "application/json", cookie: c },
        body: JSON.stringify({ blocks: cur.blocks }),
      }),
  ],
  [
    // meta is echoed back deliberately: this route merges over the file's
    // frontmatter, and a probe that dropped it would strip the contract
    // fields (type/relationId/roomId) the reading side requires
    "PUT  /api/okf/page",
    (c) =>
      fetch(`${BASE}/api/okf/page`, {
        method: "PUT",
        headers: { "content-type": "application/json", cookie: c },
        body: JSON.stringify({ path: relPage, title: node.title, meta: node.meta, blocks: cur.blocks }),
      }),
  ],
  [
    "PATCH /api/pages/{id}",
    (c) =>
      fetch(`${BASE}/api/pages/${id(relPage)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", cookie: c },
        body: JSON.stringify({ title: "Timeline" }),
      }),
  ],
  // archive-only: the OKF branch treats a non-permanent delete as a no-op,
  // so this probes the permission path without risking the file
  ["DEL  /api/pages/{id}", (c) => fetch(`${BASE}/api/pages/${id(relPage)}`, { method: "DELETE", headers: { cookie: c } })],
];

let failed = 0;
const row = (name, mStatus, sStatus, sLeak, ok) => {
  if (!ok) failed++;
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${name.padEnd(28)} ${MEMBER}=${String(mStatus).padEnd(4)} ${STRANGER}=${String(sStatus).padEnd(4)}${sLeak ? "  ← 내용 노출!" : ""}`
  );
};

for (const [name, run] of probes) {
  const mRes = await run(member);
  const sRes = await run(stranger);
  const sBody = await sRes.text();
  const leak = SECRET.test(sBody);
  // Some endpoints answer 200 for everyone and the test is what came back, not
  // the status: list/search return a filtered payload, and the rendered page
  // route serves its not-found UI (a body, hence 200). For those the assertion
  // is that the stranger's response carries none of the doc's content.
  const byBody =
    name.includes("okf/pages") ||
    name.includes("okf/tree") ||
    name.includes("search") ||
    name.includes("/p/{id}");
  const strangerBlocked = byBody ? !leak : sRes.status === 404 && !leak;
  const memberAllowed = mRes.status < 400;
  row(name, mRes.status, sRes.status, leak, memberAllowed && strangerBlocked);
}

// the doc must be exactly as it was — every write probe sent current content
const after = await (
  await fetch(`${BASE}/api/pages/${id(relPage)}/blocks`, { headers: { cookie: member } })
).json();
const same =
  JSON.stringify((after.blocks ?? []).map((b) => b.content)) ===
  JSON.stringify(cur.blocks.map((b) => b.content));
row("문서 무손상 확인", cur.blocks.length, (after.blocks ?? []).length, false, same);

// A write path that keeps the blocks but drops the frontmatter still destroys
// the document: relation-agent refuses one with no `type`.
const nodeAfter = await (
  await fetch(`${BASE}/api/okf/node?path=${encodeURIComponent(relPage)}`, {
    headers: { cookie: member },
  })
).json().then((j) => j.node ?? j);
const meta = nodeAfter.meta ?? {};
const contractKept =
  stable(meta) === metaBefore && meta.type === "Memory" && Boolean(meta.relationId);
row("계약 프론트매터 보존", meta.type ?? "없음", meta.relationId ? "relationId ✓" : "없음", false, contractKept);

console.log(failed ? `\n${failed} FAILED` : "\n전부 통과");
process.exit(failed ? 1 : 0);
