// Prompt export — LIVE, against the dev database: the Kim family agent's prompt skill
// driven through respondToMessage (what the chat route's dispatch calls for an in-app
// agent), the library path of GET/POST /api/pages/<id>/prompt, and the MCP page-to-prompt
// tool through its own route handler with the family agents' tokens.
//
//   cd app && npx tsx --tsconfig scripts/tsconfig.json scripts/prompt-export.live.mts
//
// Needs app/.env.local (POSTGRES_URL on this machine) and the Kim family demo
// (pnpm demo:family): the family room, and the private teamspace grandma is not in, with
// its room. Exit 0 = every case passed and the database is as it was.
//
// Leaves the database as it found it. Every row it adds — the chat messages it sends, the
// agent's replies, the prompt pages (with their blocks and grants), a restricted probe page,
// a temporary aindrive link — is recorded and deleted at the end; then the row count of
// every table and a fingerprint of the family's rows are compared with the ones taken
// before. It refuses to start where it would have to change something that was already
// there (a prompt page of the same asker it would rewrite, an aindrive link it would replace).
//
// Held off while it runs, so that only the prompt skill writes:
//  - the relationship-doc pipeline respondToMessage starts for a room (runPipeline): it
//    would record the family's pending messages into their doc (OKF files, processed_at,
//    agent_room_states). Only respond.ts's import of it is replaced (Module._load); the
//    calls are counted, and nothing runs until the replacement is known to be in place.
//  - the model: AGENT_FAKE_LLM=1, the project's own offline switch. The prompt skill is
//    code end to end and runs with it (respond.ts); a message the skill hands back gets the
//    fake agent's echo — which is how "did not trigger" is told apart here. Its one model
//    call (a title guess, asked back as "Did you mean …?") is not exercised.
// The messages it sends are stored already processed, so a pipeline run elsewhere (the dev
// server) never records them either.
//
// Korean sentences and titles live in @/i18n/content/scripts (PROMPT_EXPORT_LIVE).
import Module from "node:module";
import path from "node:path";

process.loadEnvFile?.(new URL("../.env.local", import.meta.url).pathname);
process.env.AGENT_FAKE_LLM = "1";

// ── the doc pipeline, held (see above) ──────────────────────────────────────
const pipelineCalls: string[] = [];
let pipelineHeld = false;
const RESPOND_TS = path.join("src", "lib", "agent", "respond.ts");
type Load = (request: string, parent: { filename?: string } | null | undefined, isMain: boolean) => unknown;
const cjs = Module as unknown as { _load: Load };
const realLoad = cjs._load;
cjs._load = function (this: unknown, request, parent, isMain) {
  const exported = realLoad.call(this, request, parent, isMain);
  if (request !== "./pipeline" || !parent?.filename?.endsWith(RESPOND_TS)) return exported;
  pipelineHeld = true;
  return {
    ...(exported as Record<string, unknown>),
    runPipeline: async (roomId: string) => {
      pipelineCalls.push(roomId);
      return { processed: 0, edits: 0, rootPageId: null, skipped: "held by prompt-export.live" };
    },
  };
};

const dbUrl = new URL(process.env.POSTGRES_URL ?? "postgres://unset");
if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(dbUrl.hostname)) {
  console.error(`refusing to run: POSTGRES_URL is not a database on this machine (${dbUrl.hostname})`);
  process.exit(2);
}

const { and, eq, inArray, isNull, sql } = await import("drizzle-orm");
const { db } = await import("@/lib/db");
const S = await import("@/lib/db/schema");
const { respondToMessage } = await import("@/lib/agent/respond");
if (!pipelineHeld) {
  console.error("refusing to run: respond.ts did not load the doc pipeline through CommonJS, so it could not be held");
  process.exit(2);
}
const PE = await import("@/lib/prompt-export");
const { isPromptPageTitle, pendingPrompt } = await import("@/lib/prompt-export/input");
const { promptBlockLanguage, savePromptToDrive } = await import("@/lib/prompt-export/deliver");
const { RESTRICTED_PAGE } = await import("@/lib/prompt-export/collect");
const { getPagePermission } = await import("@/lib/auth/share-token");
const { publicOrigin } = await import("@/lib/app-origin");
const { answerViewers } = await import("@/lib/agent/shared-drives");
const { userLink } = await import("@/lib/aindrive-user");
const { deletePath, parseLink } = await import("@/lib/aindrive");
const { runAs } = await import("@/lib/aindrive-account");
const { makeT } = await import("@/i18n/translate");
const { FAMILY_DEMO_ACCOUNTS, PROMPT_EXPORT_LIVE: K } = await import("@/i18n/content/scripts");
const mcpRoute = await import("@/app/api/mcp/route");
type PromptContent = import("@/lib/prompt-export").PromptContent;
type FetchOptions = import("@/lib/prompt-export").FetchOptions;
type RenderOptions = import("@/lib/prompt-export").RenderOptions;
type BlockContent = import("@/lib/db/schema").BlockContent;

const ko = makeT("ko");
const en = makeT("en");

// ── results ─────────────────────────────────────────────────────────────────
interface Row {
  case: string;
  pass: boolean;
  detail: string;
}
const rows: Row[] = [];
const check = (name: string, pass: boolean, detail = "") => {
  rows.push({ case: name, pass, detail: detail.replace(/\s+/g, " ").trim().slice(0, 170) });
};
function abort(why: string): never {
  console.error(`refusing to run: ${why}`);
  process.exit(2);
}
const first = (s: string) => s.split("\n")[0] ?? "";

// ── the family, as the dev database holds it ────────────────────────────────
const FAMILY_ROOM = "20d8e7e4-d017-4c6b-b350-a714f707f21e";
const [familyRoom] = await db.select().from(S.chatRooms).where(eq(S.chatRooms.id, FAMILY_ROOM));
if (!familyRoom?.workspaceId || familyRoom.dissolvedAt) abort("the family room is not there (pnpm demo:family)");
const WS = familyRoom.workspaceId;

const members = await db
  .select({ id: S.users.id, name: S.users.displayName, role: S.workspaceMembers.role })
  .from(S.workspaceMembers)
  .innerJoin(S.users, eq(S.users.id, S.workspaceMembers.userId))
  .where(eq(S.workspaceMembers.workspaceId, WS));
const personId = (key: string): string => {
  const name = FAMILY_DEMO_ACCOUNTS.find((a) => a.key === key)?.name;
  const hit = members.find((m) => m.name === name);
  if (!hit) abort(`no "${key}" in the family workspace`);
  return hit.id;
};
const mom = personId("mom");
const dad = personId("dad");
const grandma = personId("grandma");
const seoyeon = personId("seoyeon");
const grandpa = personId("grandpa");
const nameOf = new Map(members.map((m) => [m.id, FAMILY_DEMO_ACCOUNTS.find((a) => a.name === m.name)?.key ?? m.id.slice(0, 8)]));

const [privateTs] = await db
  .select()
  .from(S.teamspaces)
  .where(and(eq(S.teamspaces.workspaceId, WS), eq(S.teamspaces.name, K.privateTeamspace)));
if (!privateTs || privateTs.visibility !== "private") abort("the private teamspace is not there");
const [privateRoom] = await db
  .select()
  .from(S.chatRooms)
  .where(and(eq(S.chatRooms.workspaceId, WS), eq(S.chatRooms.name, K.privateTeamspace), isNull(S.chatRooms.dissolvedAt)));
if (!privateRoom) abort("the private teamspace's room is not there");
const agentOf = async (roomId: string) => {
  const [b] = await db.select({ id: S.chatRoomBots.agentUserId }).from(S.chatRoomBots).where(eq(S.chatRoomBots.roomId, roomId));
  if (!b) abort(`room ${roomId} has no agent`);
  return b.id;
};
const familyAgent = await agentOf(FAMILY_ROOM);
const privateAgent = await agentOf(privateRoom.id);

const wsPages = await db.select().from(S.pages).where(eq(S.pages.workspaceId, WS));
const live = wsPages.filter((p) => !p.isArchived);
const byTitle = (title: string) => {
  const p = live.find((x) => x.title === title);
  if (!p) abort(`no page 「${title}」`);
  return p;
};
const hub = byTitle(K.hubTitle);
const contextPage = byTitle(K.contextPageTitle);
const familyTsId = hub.teamspaceId;
if (!familyTsId) abort("the Chuseok page is in no teamspace");
const privatePages = wsPages.filter((p) => p.teamspaceId === privateTs.id);
const privatePage = byTitle(K.privateTeamspace);
if (privatePage.teamspaceId !== privateTs.id) abort("the private page is not in the private teamspace");
const privateDbIds = (
  await db
    .select({ content: S.blocks.content })
    .from(S.blocks)
    .where(and(inArray(S.blocks.pageId, privatePages.map((p) => p.id)), eq(S.blocks.type, "database")))
)
  .map((b) => b.content?.databaseId)
  .filter((x): x is string => !!x);
if (!privateDbIds.length) abort("the private teamspace holds no database");

// who reads an answer in each room: everyone in it (answerViewers), the asker first
const readersOf = async (roomId: string, asker: string) => [...new Set([asker, ...(await answerViewers(roomId, asker, null))])];
const familyReaders = await readersOf(FAMILY_ROOM, mom);
const privateReaders = await readersOf(privateRoom.id, mom);
if (!familyReaders.includes(grandma) || privateReaders.includes(grandma)) abort("grandma is not where this test expects her");

// ── what may never show in the family room: the private teamspace's words ───
// Every title and text of the private teamspace (its pages, databases, rows) that the rest
// of the workspace does not also say — "grandma's birthday" is on the open family
// calendar, so it is not a secret; the teamspace's name and its pages' text are.
const leaves = (v: unknown, out: string[] = []): string[] => {
  if (typeof v === "string") {
    const s = v.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
    if ([...s].length >= 6 && !/^(?:https?:|\/)/.test(s) && !/^[0-9a-f-]{36}$/i.test(s) && !/^\d{4}-\d\d-\d\d/.test(s)) out.push(s);
  } else if (Array.isArray(v)) for (const x of v) leaves(x, out);
  else if (v && typeof v === "object") for (const x of Object.values(v)) leaves(x, out);
  return out;
};
const wsBlocks = await db
  .select({ pageId: S.blocks.pageId, content: S.blocks.content })
  .from(S.blocks)
  .innerJoin(S.pages, eq(S.pages.id, S.blocks.pageId))
  .where(eq(S.pages.workspaceId, WS));
const wsDbs = await db.select({ id: S.databases.id, title: S.databases.title }).from(S.databases).where(eq(S.databases.workspaceId, WS));
const wsRows = wsDbs.length
  ? await db.select({ databaseId: S.dbRows.databaseId, values: S.dbRows.values }).from(S.dbRows).where(inArray(S.dbRows.databaseId, wsDbs.map((d) => d.id)))
  : [];
const privatePageIds = new Set(privatePages.map((p) => p.id));
const privateDbSet = new Set(privateDbIds);
const secretCorpus = [
  privateTs.name,
  ...privatePages.map((p) => p.title),
  ...wsDbs.filter((d) => privateDbSet.has(d.id)).map((d) => d.title),
  ...leaves(wsBlocks.filter((b) => privatePageIds.has(b.pageId)).map((b) => b.content)),
  ...leaves(wsRows.filter((r) => privateDbSet.has(r.databaseId)).map((r) => r.values)),
];
const openCorpus = [
  ...wsPages.filter((p) => !privatePageIds.has(p.id)).map((p) => p.title),
  ...wsDbs.filter((d) => !privateDbSet.has(d.id)).map((d) => d.title),
  ...leaves(wsBlocks.filter((b) => !privatePageIds.has(b.pageId)).map((b) => b.content)),
  ...leaves(wsRows.filter((r) => !privateDbSet.has(r.databaseId)).map((r) => r.values)),
  ...members.map((m) => m.name),
].join("\n");
const secrets = [...new Set(secretCorpus)].filter((s) => !openCorpus.includes(s));
if (!secrets.includes(privateTs.name)) abort("the private teamspace's name is said in the open teamspace too — nothing to test");
const leaked = (text: string) => secrets.filter((s) => text.includes(s));

// ── the database before ─────────────────────────────────────────────────────
const tableNames = (
  await db.execute(sql`select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by 1`)
).rows.map((r) => String((r as { table_name: string }).table_name));
async function counts(): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const t of tableNames) out[t] = Number((await db.execute(sql.raw(`select count(*)::int as n from "${t}"`))).rows[0]?.n ?? -1);
  return out;
}
// the family's rows, byte for byte (WS is a uuid read from the database)
const ROOMS = `select id from chat_rooms where workspace_id = '${WS}'`;
const PAGES = `select id from pages where workspace_id = '${WS}'`;
const FINGERPRINTS: Record<string, string> = {
  pages: `select * from pages where workspace_id = '${WS}'`,
  blocks: `select * from blocks where page_id in (${PAGES})`,
  page_members: `select * from page_members where page_id in (${PAGES})`,
  databases: `select * from databases where workspace_id = '${WS}'`,
  db_rows: `select * from db_rows where database_id in (select id from databases where workspace_id = '${WS}')`,
  chat_rooms: `select * from chat_rooms where workspace_id = '${WS}'`,
  chat_messages: `select * from chat_messages where room_id in (${ROOMS})`,
  chat_room_members: `select * from chat_room_members where room_id in (${ROOMS})`,
  agent_room_states: `select * from agent_room_states where room_id in (${ROOMS})`,
  teamspaces: `select * from teamspaces where workspace_id = '${WS}'`,
  teamspace_members: `select * from teamspace_members where teamspace_id in (select id from teamspaces where workspace_id = '${WS}')`,
  teamspace_drives: `select * from teamspace_drives where teamspace_id in (select id from teamspaces where workspace_id = '${WS}')`,
  workspace_members: `select * from workspace_members where workspace_id = '${WS}'`,
  okf_acl: `select * from okf_acl`,
  aindrive_links: `select * from aindrive_links`,
  aindrive_accounts: `select * from aindrive_accounts`,
  agent_access_tokens: `select * from agent_access_tokens`,
  users: `select * from users where id in (select user_id from workspace_members where workspace_id = '${WS}') or id in (select agent_user_id from chat_room_bots where room_id in (${ROOMS}))`,
};
async function fingerprints(): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const [k, q] of Object.entries(FINGERPRINTS))
    out[k] = String((await db.execute(sql.raw(`select md5(coalesce(string_agg(x::text, '|' order by x::text), '')) as h from (${q}) x`))).rows[0]?.h);
  return out;
}

// preconditions: nothing already there that a run would have to change
const askers = [mom, seoyeon];
const oldPromptPages = live.filter((p) => isPromptPageTitle(p.title) && p.createdBy && askers.includes(p.createdBy));
if (oldPromptPages.length) abort(`prompt pages by the askers already exist (a run would rewrite them): ${oldPromptPages.map((p) => p.id).join(", ")}`);
const seoyeonHadLink = !!(await userLink(seoyeon));
const momLink = await userLink(mom);

const beforeCounts = await counts();
const beforePrints = await fingerprints();
const beforePageIds = new Set(wsPages.map((p) => p.id));

// ── what this run adds, to take out again ───────────────────────────────────
const created = {
  messages: [] as string[],
  pages: new Set<string>(),
  links: [] as string[],
  files: [] as { userId: string; rel: string }[],
};
const familyOutputs: string[] = []; // every reply and prompt page made in the family room

/** "💾 Also saved to your aindrive: {path}" in either language → the path */
const savedPathIn = (text: string): string | null => {
  for (const t of [ko, en]) {
    const [pre, post] = t("💾 Also saved to your aindrive: {path}", { path: "\u0000" }).split("\u0000");
    for (const line of text.split("\n")) if (line.startsWith(pre) && line.endsWith(post)) return line.slice(pre.length, line.length - post.length);
  }
  return null;
};

interface Said {
  action: "reply" | "silent";
  text: string;
  /** the agent's reply row (null when it said nothing) */
  replyId: string | null;
  /** the prompt page the reply links (made by this run) */
  pageId: string | null;
  /** the skill handed it back: the fake model answered */
  fake: boolean;
}

/** A member says `text` in a room (`quiet`: to the agent alone, as the composer's lock
 *  sends it); the room's agent answers through respondToMessage. */
async function say(roomId: string, agentId: string, authorId: string, text: string, extra: { contextPageId?: string } = {}, quiet = false): Promise<Said> {
  const [msg] = await db
    .insert(S.chatMessages)
    .values({ roomId, authorId, text, attachments: [], privateToUserId: quiet ? authorId : null, processedAt: new Date() })
    .returning();
  created.messages.push(msg.id);
  const d = await respondToMessage(agentId, roomId, msg, extra);
  if (d.messageId) {
    created.messages.push(d.messageId);
    await db.update(S.chatMessages).set({ processedAt: new Date() }).where(eq(S.chatMessages.id, d.messageId));
  }
  const reply = d.text ?? "";
  let pageId: string | null = null;
  for (const m of reply.matchAll(/\/p\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/g)) {
    if (beforePageIds.has(m[1])) continue;
    const [p] = await db.select().from(S.pages).where(eq(S.pages.id, m[1]));
    if (p && p.workspaceId === WS && isPromptPageTitle(p.title) && p.createdBy === authorId) {
      created.pages.add(p.id);
      pageId ??= p.id;
    }
  }
  const saved = savedPathIn(reply);
  if (saved) created.files.push({ userId: authorId, rel: saved });
  // what everyone in the family room reads (a quiet answer is the asker's alone)
  if (roomId === FAMILY_ROOM && !quiet && reply && !reply.startsWith("[fake-agent]")) familyOutputs.push(reply);
  return { action: d.action, text: reply, replyId: d.messageId ?? null, pageId, fake: reply.startsWith("[fake-agent]") };
}

const canOpen = async (pageId: string, userId: string) => (await getPagePermission(pageId, userId)) !== null;

/** The prompt the skill should have built: fetched for these readers, rendered with these options. */
async function expectedPrompt(targetId: string, readers: string[], fetch: Partial<FetchOptions>, render: Partial<RenderOptions>) {
  const base = { viewerIds: readers, baseUrl: publicOrigin() };
  const target = await PE.locateVisible(targetId, base);
  if (!target) return { prompt: "", content: null };
  const content = await PE.fetchPromptContent(target, fetch, base);
  return { prompt: PE.renderPrompt(content, render).prompt, content };
}

/** A prompt page: the summary callout and the prompt itself in a code block; open to every
 *  reader; open to nobody the page it was made from is closed to (and to `closedTo`). */
async function checkPage(label: string, pageId: string | null, o: { readers: string[]; rootId: string; expected: string; template: "claude-xml" | "default" | "markdown"; title: string; closedTo?: string[] }) {
  if (!pageId) {
    check(`${label}: prompt page made`, false, "no prompt page linked in the reply");
    return null;
  }
  const [p] = await db.select().from(S.pages).where(eq(S.pages.id, pageId));
  const bs = await db
    .select()
    .from(S.blocks)
    .where(and(eq(S.blocks.pageId, pageId), eq(S.blocks.alive, true)))
    .orderBy(S.blocks.position);
  const code = bs.find((b) => b.type === "code")?.content as BlockContent | undefined;
  const text = typeof code?.text === "string" ? code.text : "";
  const shape = bs.length === 2 && bs[0].type === "callout" && bs[1].type === "code";
  const same = text === o.expected && o.expected.length > 0;
  check(
    `${label}: page = the prompt`,
    shape && same && code?.language === promptBlockLanguage(o.template) && p?.title === o.title,
    `「${p?.title}」 callout+code=${shape} code==render:${same} (${[...text].length} chars, ${code?.language})`
  );
  const missing: string[] = [];
  for (const r of o.readers) if (!(await canOpen(pageId, r))) missing.push(nameOf.get(r) ?? r);
  const wider: string[] = [];
  for (const m of members) if ((await canOpen(pageId, m.id)) && !(await canOpen(o.rootId, m.id))) wider.push(nameOf.get(m.id) ?? m.id);
  const intruders: string[] = [];
  for (const u of o.closedTo ?? []) if (await canOpen(pageId, u)) intruders.push(nameOf.get(u) ?? u);
  const grants = (await db.select({ u: S.pageMembers.userId }).from(S.pageMembers).where(eq(S.pageMembers.pageId, pageId))).map((g) => nameOf.get(g.u) ?? g.u);
  const ts = p?.teamspaceId === familyTsId ? "family" : p?.teamspaceId === privateTs.id ? "private" : String(p?.teamspaceId);
  check(
    `${label}: page only where its readers are`,
    !missing.length && !wider.length && !intruders.length,
    `teamspace=${ts} restricted=${p?.restricted}${grants.length ? ` grants=[${grants.join(",")}]` : ""} readers-missing=[${missing}] wider-than-source=[${wider}] closed-to-open=[${intruders}]`
  );
  return text;
}

/** "Which one? 1. 「…」 2. 「…」" → the titles, in order */
const listed = (text: string) => [...text.matchAll(/^\d+\. 「(.+)」$/gm)].map((m) => m[1]);
const koTitle = (t: string) => ko("AI prompt — {title}", { title: t });
/** the reply's first line when a prompt page was made, in Korean */
const koMade = (title: string, pageId: string | null) => ko("Made an AI prompt from 「{title}」 → /p/{pageId}", { title, pageId: pageId ?? "" });
const notFoundShared = ko("I couldn't open that page for everyone who will read this. Check the name or link — or ask me quietly for a copy only you can see.");
const drivePrefixes = (() => {
  const out: string[] = [];
  for (const t of [ko, en]) {
    out.push(t("💾 Also saved to your aindrive: {path}", { path: "\u0000" }).split("\u0000")[0]);
    out.push(t("Not saved to your aindrive: that folder is shared with more people than this prompt is for."));
    out.push(t("Couldn't save to your aindrive: {error}", { error: "\u0000" }).split("\u0000")[0]);
  }
  return out;
})();
const saysDrive = (text: string) => drivePrefixes.some((p) => text.includes(p));

// the probe: a restricted page for exactly the family room's people, pointing at the private
// teamspace (a mention whose chip label is not the title, and links to two of its pages)
let probeId: string | null = null;
const PROBE_LABEL = "probe-chip-label";
const RUN = Math.random().toString(36).slice(2, 8);

let exitCode = 0;
try {
  // ═══ 1. requests in the family room, as mom ═══════════════════════════════
  const s1a = await say(FAMILY_ROOM, familyAgent, mom, K.chuseok);
  check("1a ko \"Chuseok page → AI prompt\" reaches respond.ts", pipelineCalls.includes(FAMILY_ROOM) && !s1a.fake, first(s1a.text));
  const e1a = await expectedPrompt(hub.id, familyReaders, {}, {});
  check("1a resolves to the Chuseok hub", s1a.text.includes(`「${K.hubTitle}」`) && !!s1a.pageId, first(s1a.text));
  const p1a = await checkPage("1a", s1a.pageId, { readers: familyReaders, rootId: hub.id, expected: e1a.prompt, template: "claude-xml", title: koTitle(K.hubTitle) });
  if (p1a) familyOutputs.push(p1a);

  const enAsk = "@agent make a prompt from the Chuseok page with depth 2 as markdown, instruction: 'summarize it for grandma'";
  const s1b = await say(FAMILY_ROOM, familyAgent, mom, enAsk);
  const e1b = await expectedPrompt(hub.id, familyReaders, { depth: 2 }, { template: "markdown", instruction: "summarize it for grandma" });
  const opts1b = s1b.text.split("\n")[2] ?? "";
  check("1b en depth 2 · markdown · instruction", /depth 2\b/.test(opts1b) && /markdown/.test(opts1b) && e1b.prompt.includes("summarize it for grandma"), `${first(s1b.text)} | ${opts1b}`);
  const p1b = await checkPage("1b", s1b.pageId, { readers: familyReaders, rootId: hub.id, expected: e1b.prompt, template: "markdown", title: en("AI prompt — {title}", { title: K.hubTitle }) });
  if (p1b) familyOutputs.push(p1b);

  const s1c = await say(FAMILY_ROOM, familyAgent, mom, K.thisPage, { contextPageId: contextPage.id });
  const e1c = await expectedPrompt(contextPage.id, familyReaders, {}, {});
  check("1c \"this page\" + context page", s1c.text.includes(`「${contextPage.title}」`) && !!s1c.pageId, first(s1c.text));
  const p1c = await checkPage("1c", s1c.pageId, { readers: familyReaders, rootId: contextPage.id, expected: e1c.prompt, template: "claude-xml", title: koTitle(contextPage.title) });
  if (p1c) familyOutputs.push(p1c);

  // ambiguous → a title alone answers it
  const s1d = await say(FAMILY_ROOM, familyAgent, mom, K.ambiguous);
  const choices1 = listed(s1d.text);
  check(
    "1d ambiguous → numbered \"which one?\"",
    choices1.length >= 2 && !s1d.pageId && !!pendingPrompt(FAMILY_ROOM, mom) && s1d.text.includes("@agent"),
    `${choices1.length} choices: ${choices1.join(" / ")}`
  );
  const [titleAnswer, answeredTitle] = K.titleAnswer;
  const s1e = await say(FAMILY_ROOM, familyAgent, mom, titleAnswer);
  const albumPage = byTitle(answeredTitle);
  const e1e = await expectedPrompt(albumPage.id, familyReaders, {}, {});
  check("1e follow-up with just a title", choices1.includes(answeredTitle) && s1e.text.includes(`「${answeredTitle}」`) && !pendingPrompt(FAMILY_ROOM, mom), first(s1e.text));
  const p1e = await checkPage("1e", s1e.pageId, { readers: familyReaders, rootId: albumPage.id, expected: e1e.prompt, template: "claude-xml", title: koTitle(answeredTitle) });
  if (p1e) familyOutputs.push(p1e);

  // ambiguous again → a number answers it
  const s1f = await say(FAMILY_ROOM, familyAgent, mom, K.ambiguous);
  const choices2 = listed(s1f.text);
  const s1g = await say(FAMILY_ROOM, familyAgent, mom, "@agent 2");
  const second = choices2[1] ?? "";
  const secondPage = live.find((p) => p.title === second);
  check("1f follow-up with a number (\"@agent 2\"), answered in Korean", !!secondPage && !!s1g.pageId && first(s1g.text) === koMade(second, s1g.pageId), `picked 「${second}」: ${first(s1g.text)}`);
  if (secondPage) {
    const e1g = await expectedPrompt(secondPage.id, familyReaders, {}, {});
    const p1g = await checkPage("1f", s1g.pageId, { readers: familyReaders, rootId: secondPage.id, expected: e1g.prompt, template: "claude-xml", title: koTitle(second) });
    if (p1g) familyOutputs.push(p1g);
  }

  // ambiguous again → a pasted link answers it (and, like a number, is in no language)
  const s1i = await say(FAMILY_ROOM, familyAgent, mom, K.ambiguous);
  const third = listed(s1i.text)[2] ?? "";
  const thirdPage = live.find((p) => p.title === third);
  const s1j = thirdPage ? await say(FAMILY_ROOM, familyAgent, mom, `@agent /p/${thirdPage.id}`) : null;
  check("1i follow-up with a pasted link, answered in Korean", !!thirdPage && !!s1j?.pageId && first(s1j.text) === koMade(third, s1j.pageId), `picked 「${third}」: ${first(s1j?.text ?? "")}`);
  if (thirdPage && s1j) {
    const e1j = await expectedPrompt(thirdPage.id, familyReaders, {}, {});
    const p1j = await checkPage("1i", s1j.pageId, { readers: familyReaders, rootId: thirdPage.id, expected: e1j.prompt, template: "claude-xml", title: koTitle(third) });
    if (p1j) familyOutputs.push(p1j);
  }

  // chat that only talks about prompts: the skill hands it back, the (fake) model answers
  const talk = [
    ...K.notRequests,
    "@agent what's a good prompt for midjourney?",
    "@agent write me a prompt for a birthday card for grandma",
    "@agent can you make a prompt for midjourney from the photos on this page?",
  ];
  const pagesBefore = created.pages.size;
  const triggered: string[] = [];
  for (const text of talk) {
    const r = await say(FAMILY_ROOM, familyAgent, mom, text);
    if (!r.fake || r.pageId || pendingPrompt(FAMILY_ROOM, mom)) triggered.push(`${text} → ${first(r.text)}`);
  }
  // in a room of several people the agent acts only on what is addressed to it
  const unaddressed = await say(FAMILY_ROOM, familyAgent, mom, K.chuseok.replace(/^@\S+\s+/, ""));
  check("1h same request without @agent in the family room: no answer, no page", unaddressed.action === "silent" && !unaddressed.replyId && !unaddressed.pageId, `action=${unaddressed.action}`);
  check(`1g ${talk.length} chat messages about prompts do not trigger`, !triggered.length && created.pages.size === pagesBefore && talk.length === 6, triggered.join(" | ") || "all answered by the model");

  // ═══ 2. permissions ═══════════════════════════════════════════════════════
  const s2a = await say(FAMILY_ROOM, familyAgent, mom, K.privateByTitle);
  check("2a family room: private page by name", !s2a.pageId && !leaked(s2a.text).length, `${first(s2a.text)} ${listed(s2a.text).join(" / ")}`);

  const refs: [string, string][] = [
    ["link", `/p/${privatePage.id}`],
    ["database id", privateDbIds[0]],
    ["teamspace id", `teamspace:${privateTs.id}`],
  ];
  for (const [what, ref] of refs) {
    const r = await say(FAMILY_ROOM, familyAgent, mom, `@agent ${ref} ${K.afterLink}`);
    check(`2b family room: private ${what}`, r.text === notFoundShared && !r.pageId, first(r.text));
  }

  const s2c = await say(FAMILY_ROOM, familyAgent, mom, K.grandmaPage);
  const grandmaChoices = listed(s2c.text);
  const grandmaPicked = live.find((p) => s2c.pageId && first(s2c.text).includes(`「${p.title}」`) && !isPromptPageTitle(p.title));
  check(
    "2c family room: \"grandma's page\" among visible pages only",
    !leaked(s2c.text).length && (grandmaPicked ? !privatePageIds.has(grandmaPicked.id) : grandmaChoices.length > 0),
    grandmaPicked ? `picked 「${grandmaPicked.title}」` : `asked: ${grandmaChoices.join(" / ")}`
  );
  if (grandmaPicked && s2c.pageId) {
    const e = await expectedPrompt(grandmaPicked.id, familyReaders, {}, {});
    const p = await checkPage("2c", s2c.pageId, { readers: familyReaders, rootId: grandmaPicked.id, expected: e.prompt, template: "claude-xml", title: koTitle(grandmaPicked.title) });
    if (p) familyOutputs.push(p);
  }

  // the probe page, for exactly the family room's people
  const [{ top }] = await db
    .select({ top: sql<number>`coalesce(max(${S.pages.position}), 0)` })
    .from(S.pages)
    .where(and(eq(S.pages.workspaceId, WS), eq(S.pages.teamspaceId, familyTsId)));
  const [probe] = await db
    .insert(S.pages)
    .values({ workspaceId: WS, teamspaceId: familyTsId, title: `Prompt live check ${RUN}`, restricted: true, position: Number(top) + 1, createdBy: mom })
    .returning();
  probeId = probe.id;
  created.pages.add(probe.id);
  await db.insert(S.pageMembers).values(familyReaders.map((u) => ({ pageId: probe.id, userId: u, permission: u === mom ? "full" : "view" })));
  const chip = `<a href="/p/${privatePage.id}" class="mention" data-mention-type="page" data-mention-id="${privatePage.id}">@${PROBE_LABEL}</a>`;
  const meeting = privatePages.find((p) => p.id !== privatePage.id && !p.isArchived);
  // as the editor stores a line with a chip: the plain text, and the inline HTML the chip is in
  const probeBlocks: { type: "paragraph" | "link_to_page"; content: BlockContent }[] = [
    { type: "paragraph", content: { text: `Probe line for ${RUN}: see @${PROBE_LABEL} before the party.`, html: `Probe line for ${RUN}: see ${chip} before the party.` } },
    { type: "link_to_page", content: { childPageId: privatePage.id } },
    ...(meeting ? [{ type: "link_to_page" as const, content: { childPageId: meeting.id } }] : []),
  ];
  await db.insert(S.blocks).values(probeBlocks.map((b, i) => ({ pageId: probe.id, type: b.type, content: b.content, position: i + 1 })));

  const s2d = await say(FAMILY_ROOM, familyAgent, mom, `@agent /p/${probe.id} ${K.afterLink}`);
  const e2d = await expectedPrompt(probe.id, familyReaders, {}, {});
  const hidden2d = e2d.content?.skipped.filter((x) => x.reason === "permission").length ?? 0;
  const leftOut = ko("⚠️ Left out {n} linked pages or databases that not everyone here can open.", { n: hidden2d });
  check(
    "2d family room: probe linking the private teamspace",
    hidden2d >= 1 && s2d.text.includes(leftOut) && e2d.prompt.includes(RESTRICTED_PAGE) && !e2d.prompt.includes(PROBE_LABEL) && !leaked(e2d.prompt).length && e2d.prompt.includes(`Probe line for ${RUN}`),
    `${hidden2d} left out; "${RESTRICTED_PAGE}" printed; chip label ${e2d.prompt.includes(PROBE_LABEL) ? "PRINTED" : "not printed"}; hidden page's id ${e2d.prompt.includes(privatePage.id) ? "linked (opaque, as designed)" : "absent"}`
  );
  const p2d = await checkPage("2d", s2d.pageId, { readers: familyReaders, rootId: probe.id, expected: e2d.prompt, template: "claude-xml", title: koTitle(probe.title), closedTo: [grandpa] });
  if (p2d) familyOutputs.push(p2d);

  // the private teamspace's own room: the same member may include it
  const s2e = await say(privateRoom.id, privateAgent, mom, K.privateByTitle);
  const e2e = await expectedPrompt(privatePage.id, privateReaders, {}, {});
  check("2e private room: same request includes it", s2e.text.includes(`「${privatePage.title}」`) && leaked(e2e.prompt).length > 0, first(s2e.text));
  await checkPage("2e", s2e.pageId, { readers: privateReaders, rootId: privatePage.id, expected: e2e.prompt, template: "claude-xml", title: koTitle(privatePage.title), closedTo: [grandma, grandpa] });

  const s2f = await say(privateRoom.id, privateAgent, mom, `@agent /p/${probe.id} ${K.afterLink}`);
  const e2f = await expectedPrompt(probe.id, privateReaders, {}, {});
  check(
    "2f private room: probe includes the private pages",
    (e2f.content?.skipped.filter((x) => x.reason === "permission").length ?? 1) === 0 && e2f.prompt.includes(privatePage.title) && !e2f.prompt.includes(PROBE_LABEL),
    first(s2f.text)
  );
  await checkPage("2f", s2f.pageId, { readers: privateReaders, rootId: probe.id, expected: e2f.prompt, template: "claude-xml", title: koTitle(probe.title), closedTo: [grandma, grandpa] });

  // asked quietly in the family room: read for mom alone, and the answer is hers alone
  const s2h = await say(FAMILY_ROOM, familyAgent, mom, K.privateByTitle, {}, true);
  const [quietReply] = s2h.replyId ? await db.select().from(S.chatMessages).where(eq(S.chatMessages.id, s2h.replyId)) : [];
  const e2h = await expectedPrompt(privatePage.id, [mom], {}, {});
  check("2h family room, asked quietly: for mom alone, answer private to her", quietReply?.privateToUserId === mom && s2h.text.includes(`「${privatePage.title}」`), first(s2h.text));
  await checkPage("2h", s2h.pageId, { readers: [mom], rootId: privatePage.id, expected: e2h.prompt, template: "claude-xml", title: koTitle(privatePage.title), closedTo: [grandma, grandpa] });

  const everything = familyOutputs.join("\n");
  const found = leaked(everything);
  check(`2g family room: nothing of the private teamspace anywhere (${secrets.length} phrases)`, !found.length && familyOutputs.length > 0, found.length ? `LEAKED: ${found.slice(0, 3).join(" / ")}` : `${familyOutputs.length} replies and pages scanned`);

  // ═══ 3. write paths: the drive ════════════════════════════════════════════
  const momReplies = [s1a, s1b, s1c, s1e, s1g, s2d].map((r) => r.text);
  if (!momLink) {
    const r = await savePromptToDrive(mom, "live check", "x", familyReaders);
    check("3a mom has no drive in dev: save skipped, reply silent", !r.saved && r.reason === "no-drive" && !momReplies.some(saysDrive), `savePromptToDrive → ${JSON.stringify(r)}`);
  } else {
    check("3a mom's drive: prompts saved there", momReplies.every((t) => saysDrive(t)), `${created.files.length} files recorded for deletion`);
  }

  // seoyeon links (for this test only) the folder she shares with the whole family teamspace:
  // the prompt is for the family room, which grandpa is not in — it must not be written there
  const [albumShare] = await db
    .select()
    .from(S.teamspaceDrives)
    .where(and(eq(S.teamspaceDrives.teamspaceId, familyTsId), eq(S.teamspaceDrives.createdBy, seoyeon)));
  if (seoyeonHadLink || !albumShare) {
    check("3b shared folder: save refused", false, seoyeonHadLink ? "skipped: seoyeon already has an aindrive link (not replaced)" : "skipped: seoyeon shares no folder into the family teamspace");
  } else {
    await db.insert(S.aindriveLinks).values({ userId: seoyeon, driveId: albumShare.driveId, root: albumShare.root });
    created.links.push(seoyeon);
    try {
      const s3 = await say(FAMILY_ROOM, familyAgent, seoyeon, K.chuseok);
      const refused = ko("Not saved to your aindrive: that folder is shared with more people than this prompt is for.");
      const direct = await savePromptToDrive(seoyeon, "live check", "x", familyReaders);
      if (direct.saved) created.files.push({ userId: seoyeon, rel: direct.path });
      check(
        "3b shared folder (reaches grandpa): save refused, said so",
        s3.text.includes(refused) && !savedPathIn(s3.text) && !direct.saved && direct.reason === "shared-folder" && !!s3.pageId,
        `link root "${albumShare.root}" · reply: ${s3.text.split("\n").find((l) => l.includes(refused.slice(0, 12))) ?? "-"} · direct → ${JSON.stringify(direct)}`
      );
      const e3 = await expectedPrompt(hub.id, await readersOf(FAMILY_ROOM, seoyeon), {}, {});
      await checkPage("3b", s3.pageId, { readers: familyReaders, rootId: hub.id, expected: e3.prompt, template: "claude-xml", title: koTitle(K.hubTitle) });
    } finally {
      await db.delete(S.aindriveLinks).where(eq(S.aindriveLinks.userId, seoyeon));
      created.links.splice(created.links.indexOf(seoyeon), 1);
    }
  }

  // ═══ 4. the HTTP handler's library path, and the MCP tool ═════════════════
  // GET /api/pages/<id>/prompt as mom: read for her alone, links to the request's origin
  const origin = "http://localhost:3110";
  const httpReaders = { viewerIds: [mom], baseUrl: publicOrigin() || origin };
  const target = await PE.locateVisible(hub.id, httpReaders);
  const content = target ? await PE.fetchPromptContent(target, {}, httpReaders) : null;
  const text = content ? PE.renderPrompt(content, {}).prompt : "";
  check("4a HTTP text (format=text)", !!text && text.includes(K.hubTitle) && text.includes(`${httpReaders.baseUrl}/p/`), `${[...text].length} chars, ${content?.stats.pages} pages, links ${httpReaders.baseUrl}/p/…`);
  // stage=fetch → JSON → POST {content} renders it again, with no database read
  const parsed = JSON.parse(JSON.stringify(content)) as PromptContent;
  const isContent = (c: PromptContent) => !!c && c.version === 1 && !!c.root && typeof c.pages === "object" && typeof c.databases === "object" && !!c.tree && !!c.location;
  const variants: Partial<RenderOptions>[] = [{}, { template: "default" }, { template: "markdown" }, { separateChildPages: false }, { instruction: "be brief", layout: "notion2prompt" }, { includeProperties: true }];
  const differ = content ? variants.filter((v) => PE.renderPrompt(parsed, v).prompt !== PE.renderPrompt(content, v).prompt) : variants;
  check("4b HTTP stage=fetch JSON → re-render from content", isContent(parsed) && !differ.length, `${variants.length} option sets identical; JSON ${JSON.stringify(content).length} bytes`);
  const hidden = await PE.locateVisible(privatePage.id, { viewerIds: [grandma] });
  const own = await PE.locateVisible(privatePage.id, { viewerIds: [dad] });
  check("4c HTTP 404 for someone outside the private teamspace", hidden === null && own !== null, `grandma → ${hidden ? "FOUND" : "404"}, dad → ${own ? "found" : "404"}`);

  // MCP page-to-prompt, through the route handler, with the agents' tokens (mom holds both)
  const tokenOf = async (agentUserId: string) => {
    const [t] = await db
      .select({ token: S.agentAccessTokens.token })
      .from(S.agentAccessTokens)
      .where(and(eq(S.agentAccessTokens.agentUserId, agentUserId), eq(S.agentAccessTokens.userId, mom)));
    return t?.token ?? null;
  };
  const famToken = await tokenOf(familyAgent);
  const privToken = await tokenOf(privateAgent);
  let rpc = 0;
  const callMcp = async (token: string, args: Record<string, unknown>) => {
    const res = await mcpRoute.POST(
      new Request(`${origin}/api/mcp`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
        body: JSON.stringify({ jsonrpc: "2.0", id: ++rpc, method: "tools/call", params: { name: "page-to-prompt", arguments: args } }),
      })
    );
    const raw = await res.text();
    const json = raw.startsWith("{") ? raw : (raw.split("\n").find((l) => l.startsWith("data: ")) ?? "data: {}").slice(6);
    const r = JSON.parse(json) as { result?: { content?: { text?: string }[]; isError?: boolean } };
    return { status: res.status, text: r.result?.content?.[0]?.text ?? raw, isError: !!r.result?.isError };
  };
  if (!famToken || !privToken) {
    check("4d MCP", false, "skipped: mom holds no token for the family or the private agent");
  } else {
    const famMcpReaders = { viewerIds: await readersOf(FAMILY_ROOM, mom), baseUrl: publicOrigin(), onlyWorkspaces: [WS] };
    const m1 = await callMcp(famToken, { page: hub.id });
    const libTarget = await PE.locateVisible(hub.id, famMcpReaders);
    const libContent = libTarget ? await PE.fetchPromptContent(libTarget, {}, famMcpReaders) : null;
    const lib = libContent ? PE.renderPrompt(libContent, {}).prompt : "";
    check("4d MCP family token: Chuseok = the library's prompt", m1.status === 200 && !m1.isError && m1.text === lib && !!lib, `${[...m1.text].length} chars`);
    const m2 = await callMcp(famToken, { page: privatePage.id });
    check("4e MCP family token: private page id not found", m2.isError && m2.text === `Entity not found: ${privatePage.id}`, m2.text);
    const m3 = await callMcp(famToken, { page: privatePage.title });
    const m3Leaks = leaked(m3.text.split(privatePage.title).join(" "));
    check("4f MCP family token: private title not found or named", m3.isError && !m3Leaks.length, m3.text);
    const m4 = await callMcp(privToken, { page: privatePage.id });
    check("4g MCP private-room token: private page included", !m4.isError && m4.text.includes(privatePage.title) && leaked(m4.text).length > 0, `${[...m4.text].length} chars`);
    const m5 = await callMcp(famToken, { page: hub.id, stage: "fetch" });
    const fetched = m5.isError ? null : (JSON.parse(m5.text) as PromptContent);
    const m6 = fetched ? await callMcp(famToken, { content: fetched }) : null;
    const m7 = fetched ? await callMcp(famToken, { content: fetched, template: "markdown", instruction: "be brief" }) : null;
    check(
      "4h MCP stage=fetch → content → render again",
      !!fetched && m6?.text === m1.text && m7?.text === PE.renderPrompt(fetched, { template: "markdown", instruction: "be brief" }).prompt,
      `re-render == text: ${m6?.text === m1.text}; markdown+instruction == library: ${m7?.text === (fetched ? PE.renderPrompt(fetched, { template: "markdown", instruction: "be brief" }).prompt : "")}`
    );
    const m8 = await callMcp(famToken, { page: probeId, format: "json" });
    const j8 = m8.isError ? null : (JSON.parse(m8.text) as { prompt: string; skipped: { id: string; reason: string }[] });
    check(
      "4i MCP family token: probe as JSON leaves the private pages out",
      !!j8 && j8.skipped.some((x) => x.id === privatePage.id && x.reason === "permission") && !leaked(j8.prompt).length && !j8.prompt.includes(PROBE_LABEL),
      j8 ? `skipped ${j8.skipped.length}: ${j8.skipped.map((x) => `${x.reason}`).join(",")}` : m8.text
    );
  }
} catch (e) {
  exitCode = 1;
  check("run", false, `threw: ${(e as Error).stack ?? e}`);
} finally {
  // ═══ cleanup: exactly what this run added ═════════════════════════════════
  const pageIds = [...created.pages];
  const nBlocks = pageIds.length ? (await db.select({ id: S.blocks.id }).from(S.blocks).where(inArray(S.blocks.pageId, pageIds))).length : 0;
  const nGrants = pageIds.length ? (await db.select({ u: S.pageMembers.userId }).from(S.pageMembers).where(inArray(S.pageMembers.pageId, pageIds))).length : 0;
  // anything prompt-shaped this run made that a reply did not link (there should be none)
  const strays = (await db.select().from(S.pages).where(eq(S.pages.workspaceId, WS))).filter(
    (p) => !beforePageIds.has(p.id) && !created.pages.has(p.id) && isPromptPageTitle(p.title) && !!p.createdBy && askers.includes(p.createdBy)
  );
  for (const p of strays) created.pages.add(p.id);
  const allPages = [...created.pages];
  const fileErrors: string[] = [];
  for (const f of created.files) {
    try {
      const link = await userLink(f.userId);
      if (link) await runAs(f.userId, () => deletePath(parseLink({ driveId: link.driveId, root: link.root })!, f.rel));
    } catch (e) {
      fileErrors.push(`${f.rel}: ${(e as Error).message}`);
    }
  }
  if (allPages.length) {
    await db.delete(S.blocks).where(inArray(S.blocks.pageId, allPages));
    await db.delete(S.pageMembers).where(inArray(S.pageMembers.pageId, allPages));
    await db.delete(S.pages).where(inArray(S.pages.id, allPages));
  }
  if (created.messages.length) await db.delete(S.chatMessages).where(inArray(S.chatMessages.id, created.messages));
  for (const u of created.links) await db.delete(S.aindriveLinks).where(eq(S.aindriveLinks.userId, u));

  const afterCounts = await counts();
  const afterPrints = await fingerprints();
  const countDiff = tableNames.filter((t) => afterCounts[t] !== beforeCounts[t]).map((t) => `${t} ${beforeCounts[t]}→${afterCounts[t]}`);
  const printDiff = Object.keys(FINGERPRINTS).filter((k) => afterPrints[k] !== beforePrints[k]);
  check(
    "cleanup: recorded rows deleted",
    !strays.length && !fileErrors.length,
    `${created.messages.length} messages, ${allPages.length} pages (${nBlocks} blocks, ${nGrants} grants), ${created.files.length} drive files${strays.length ? `, ${strays.length} UNLINKED prompt pages` : ""}${fileErrors.length ? `; file errors: ${fileErrors.join("; ")}` : ""}`
  );
  check(`cleanup: row counts of all ${tableNames.length} tables as before`, !countDiff.length, countDiff.join(", ") || "identical");
  check(`cleanup: family rows byte-identical (${Object.keys(FINGERPRINTS).length} sets)`, !printDiff.length, printDiff.join(", ") || "identical");
  check("doc pipeline held (never ran)", pipelineCalls.length > 0, `${pipelineCalls.length} runPipeline calls intercepted`);

  // ── the table ──
  const w = Math.max(...rows.map((r) => r.case.length));
  console.log(`\nprompt export — live (${dbUrl.pathname.slice(1)} @ ${dbUrl.host})\n`);
  for (const r of rows) console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.case.padEnd(w)}  ${r.detail}`);
  const failed = rows.filter((r) => !r.pass).length;
  console.log(`\n${rows.length - failed} passed, ${failed} failed`);
  process.exit(failed || exitCode ? 1 : 0);
}
