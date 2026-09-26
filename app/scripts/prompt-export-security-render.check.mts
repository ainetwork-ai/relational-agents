// Prompt export — security and render-parity checks for the fixes in
// rich-text / collect (inline mentions), render (anchors, properties default,
// instructions, notion2prompt's linked pages), map (relation ids), deliver (aindrive
// save, the prompt page's placement and code language), source-db (a trashed database)
// and app-origin.
//
//   npx tsx --tsconfig scripts/tsconfig.json scripts/prompt-export-security-render.check.mts
//
// Pure: no database, no network. deliver.ts and app-origin.ts are imported for their
// pure parts only (the pg pool behind @/lib/db connects on first query, never here).
import { collect, type PromptSource, type SourceDatabase, type SourcePage } from "@/lib/prompt-export/collect";
import { mapBlock, mapValue, rowPageId } from "@/lib/prompt-export/map";
import type { PBlock, PPage, PromptContent, RichText } from "@/lib/prompt-export/model";
import { anchorOf, defaultIncludeProperties, instructionOf, renderBlocks, renderPrompt } from "@/lib/prompt-export/render";
import { htmlToRichText, text } from "@/lib/prompt-export/rich-text";
import { driveSaveAllowed, promptBlockLanguage, savePromptPage, settlePlacement, shareCovers, type DriveShare } from "@/lib/prompt-export/deliver";
import { databaseRule } from "@/lib/prompt-export/source-db";
import { CODE_LANGUAGES } from "@/lib/editor/block-defs";
import { publicOrigin, rememberOrigin } from "@/lib/app-origin";
import type { DbProperty, DbRow } from "@/lib/db/schema";

let fails = 0;
let passes = 0;
const show = (s: string) => JSON.stringify(s);
function eq(name: string, got: string, want: string) {
  if (got === want) {
    passes++;
    return;
  }
  fails++;
  console.log(`✗ ${name}\n    want ${show(want)}\n    got  ${show(got)}`);
}
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) passes++;
  else {
    fails++;
    console.log(`✗ ${name}${detail ? `  (${detail})` : ""}`);
  }
}

let n = 0;
const nid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
const para = (r: RichText[]): PBlock => ({ id: nid(), type: "paragraph", richText: r });

// ── an in-memory source: `only` = who may see it (undefined = everyone) ──────
interface MemPage {
  title: string;
  blocks: PBlock[];
  only?: string[];
}
function memSource(pages: Record<string, MemPage>, viewers: string[]): PromptSource {
  const sees = (only?: string[]) => viewers.length > 0 && viewers.every((v) => !only || only.includes(v));
  return {
    async page(id) {
      const p = pages[id];
      return p ? ({ id, title: p.title, url: `/p/${id}`, properties: [], blocks: structuredClone(p.blocks), childPageIds: [] } satisfies SourcePage) : null;
    },
    async database() {
      return null as SourceDatabase | null;
    },
    async block() {
      return null;
    },
    async canSee(kind, id) {
      return kind === "page" && !!pages[id] && sees(pages[id].only);
    },
    async title(kind, id) {
      return kind === "page" ? (pages[id]?.title ?? null) : null;
    },
    async location() {
      return ["Kim family", "Our family"];
    },
  };
}

const ALL = ["mom", "dad", "grandma"];
const SECRET_ID = "00000000-0000-4000-8000-00000000beef";
const PLAN_ID = "00000000-0000-4000-8000-00000000cafe";
const SECRET = "Grandma's birthday surprise";
const STALE = "Old name of the plan";
const pageUrl = (id: string) => `/p/${id}`;
const chip = (id: string, label: string) => `<a href="/p/${id}" class="mention" data-mention-type="page" data-mention-id="${id}">@${label}</a>`;

// ── 1. inline page mentions (finding: hidden titles leaked through chips) ─────
{
  // a paragraph chip, a table cell chip (html) and a table cell link in its stored
  // source form, each to the hidden page; plus a chip to a visible page with a stale label
  const cellRaw = { id: nid(), type: "table", content: { table: { cells: [["Who", "What"], ["mom", `see [${SECRET}](/p/${SECRET_ID})`]], html: [[null, null], [null, null]], headerRow: true } } };
  const cellHtml = { id: nid(), type: "table", content: { table: { cells: [["x"]], html: [[`note ${chip(SECRET_ID, SECRET)}`]] } } };
  const blocks: PBlock[] = [
    para(htmlToRichText(`See ${chip(SECRET_ID, SECRET)} too`, { pageUrl })),
    para(htmlToRichText(`Plan: ${chip(PLAN_ID, STALE)}`, { pageUrl })),
    mapBlock(cellRaw as never, [], { pageUrl })!,
    mapBlock(cellHtml as never, [], { pageUrl })!,
  ];
  const pages: Record<string, MemPage> = {
    hub: { title: "Chuseok hub", blocks },
    [SECRET_ID]: { title: SECRET, blocks: [], only: ["mom", "dad"] },
    [PLAN_ID]: { title: "Trip plan", blocks: [] },
  };
  const c = await collect({ kind: "page", id: "hub" }, {}, memSource(pages, ALL));
  const out = renderPrompt(c).prompt;
  const everything = out + JSON.stringify(c);
  ok("mention: a hidden page's title is nowhere — prompt or content tree", !everything.includes(SECRET) && !everything.includes("birthday"), everything.slice(0, 400));
  ok("mention: hidden page printed as Restricted page", out.includes(`See [Restricted page](/p/${SECRET_ID}) too`), out);
  ok("mention: hidden page reported by id", c.skipped.some((s) => s.reason === "permission" && s.kind === "page" && s.id === SECRET_ID));
  ok("mention: a visible page prints its current title, not the stale chip label", out.includes(`Plan: [Trip plan](/p/${PLAN_ID})`) && !everything.includes(STALE), out);
  ok("mention: a table cell's stored [label](/p/id) link is checked too", out.includes(`| mom | see [Restricted page](/p/${SECRET_ID}) |`), out);
  ok("mention: a table cell's chip is checked too", out.includes(`| note [Restricted page](/p/${SECRET_ID}) |`), out);

  // readers who may all see it get the real title
  const c2 = await collect({ kind: "page", id: "hub" }, {}, memSource(pages, ["mom", "dad"]));
  ok("mention: readers who may see it get its title", renderPrompt(c2).prompt.includes(`See [${SECRET}](/p/${SECRET_ID}) too`));

  // a content tree that never went through the fetch stage (an MCP client's own `content`)
  // prints no chip label at all
  const raw: PromptContent = {
    version: 1,
    root: { kind: "page", id: "hub" },
    pages: { hub: { id: "hub", title: "Chuseok hub", url: "/p/hub", properties: [], blocks: [para(htmlToRichText(`See ${chip(SECRET_ID, SECRET)}`, { pageUrl }))] } },
    databases: {},
    tree: { kind: "page", id: "hub", title: "Chuseok hub", children: [] },
    location: { segments: ["Kim family"] },
    stats: { pages: 1, databases: 0, rows: 0, blocks: 1, items: 2, maxDepthReached: 0, depthLimited: false, limitReached: false },
    skipped: [],
    options: { depth: 5, limit: 1000, childPages: true, alwaysFetchDatabases: false },
  };
  const rawOut = renderPrompt(raw).prompt;
  ok("mention: unchecked content prints a neutral Page, never the stored label", rawOut.includes(`See [Page](/p/${SECRET_ID})`) && !rawOut.includes(SECRET), rawOut);
  // renderBlocks alone (the notion2prompt snapshots) still prints the mention's own text
  eq("mention: renderBlocks without a checked title keeps upstream's plain_text", renderBlocks([para([{ type: "mention", mention: { type: "page", id: "p1", url: "/p/p1" }, plainText: "Title" }])]), "[Title](/p/p1)\n");
}

// ── 2. render parity: properties default, instructions, anchors ───────────────
{
  const pg: PPage = { id: "row1", title: "Row", url: "/p/row1", properties: [{ name: "Name", value: { type: "title", richText: [text("Row")] } }, { name: "Status", value: { type: "select", name: "Done" } }], blocks: [] };
  const c: PromptContent = {
    version: 1,
    root: { kind: "page", id: "row1" },
    pages: { row1: pg },
    databases: {},
    tree: { kind: "page", id: "row1", title: "Row", children: [] },
    location: { segments: ["Kim family"] },
    stats: { pages: 1, databases: 0, rows: 0, blocks: 0, items: 1, maxDepthReached: 0, depthLimited: false, limitReached: false },
    skipped: [],
    options: { depth: 5, limit: 1000, childPages: true, alwaysFetchDatabases: false },
  };
  const has = (o: Parameters<typeof renderPrompt>[1]) => renderPrompt(c, o).files[0].code.includes("## Properties");
  ok("properties: notion2prompt layout defaults to upstream's false", !has({ layout: "notion2prompt" }));
  ok("properties: ainmem layout defaults to auto (a Status shows)", has({}) && has({ layout: "ainmem" }));
  ok("properties: an explicit choice wins in either layout", has({ layout: "notion2prompt", includeProperties: true }) && !has({ layout: "ainmem", includeProperties: false }));
  ok("properties: explicit undefined falls back to the layout default", !has({ layout: "notion2prompt", includeProperties: undefined }));
  eq("properties: default helper", `${defaultIncludeProperties("notion2prompt")}/${defaultIncludeProperties("ainmem")}`, "false/auto");

  eq("instruction: notion2prompt keeps a blank one, as handlebars does", String(instructionOf("   ", "notion2prompt")), "   ");
  eq("instruction: ainmem drops a blank one", String(instructionOf("   ", "ainmem")), "null");
  eq("instruction: empty drops it in both", `${instructionOf("", "notion2prompt")}/${instructionOf("", "ainmem")}/${instructionOf(null, "ainmem")}`, "null/null/null");
  ok("instruction: ainmem prompt has no <instructions> for a blank one", !renderPrompt(c, { instruction: "  " }).prompt.includes("<instructions>"));
  ok("instruction: notion2prompt prompt keeps <instructions> for a blank one", renderPrompt(c, { layout: "notion2prompt", instruction: "  " }).prompt.includes("<instructions>\n  \n</instructions>"));

  // Rust's is_alphanumeric is Alphabetic || Numeric: vowel signs (Other_Alphabetic) stay,
  // the virama (U+094D, a Diacritic but not Alphabetic) goes — as upstream prints it
  eq("anchor: combining vowel signs kept (Rust is_alphanumeric = Alphabetic)", anchorOf("नमस्ते दुनिया"), "नमसते-दुनिया");
  eq("anchor: Thai vowel marks kept", anchorOf("สวัสดี ครับ"), "สวัสดี-ครับ");
  eq("anchor: Latin unchanged", anchorOf("  Hello, World! 2 "), "hello-world-2");
  eq("anchor: NEL is White_Space, BOM is not", anchorOf("a\u0085b﻿c"), "a-bc");
  const toc = renderBlocks([{ id: nid(), type: "table_of_contents" }, { id: nid(), type: "heading_1", richText: [text("नमस्ते दुनिया")] }]);
  ok("anchor: table of contents uses it", toc.includes("* [नमस्ते दुनिया](#नमसते-दुनिया)"), toc);
}

// ── 3. relation ids are the ids their rows print as Page ID ──────────────────
{
  const target = "00000000-0000-4000-8000-0000000000d1";
  const withPage = "00000000-0000-4000-8000-0000000000a1";
  const pageOfIt = "00000000-0000-4000-8000-0000000000b1";
  const plain = "00000000-0000-4000-8000-0000000000a2";
  const rel: DbProperty = { id: "rel", databaseId: "src", name: "Tasks", type: "relation", config: { relationDatabaseId: target }, position: 1, createdAt: new Date(0) } as DbProperty;
  const row = { id: "r0", databaseId: "src", values: { rel: [withPage, plain, "gone"] }, position: 1, parentRowId: null, createdBy: null, updatedBy: null, createdAt: new Date(0), updatedAt: new Date(0) } as unknown as DbRow;
  const tRows = [
    { id: withPage, databaseId: target, values: { __page: pageOfIt } },
    { id: plain, databaseId: target, values: {} },
  ] as unknown as DbRow[];
  const v = mapValue(rel, row, { users: new Map(), props: [rel], related: { [target]: { properties: [], rows: tRows } } });
  eq("relation: a row with its own page is named by that page's id", v.type === "relation" ? v.ids.join(",") : "", `${pageOfIt},${plain},gone`);
  const hidden = mapValue(rel, row, { users: new Map(), props: [rel] });
  eq("relation: a target the readers may not see keeps the stored ids", hidden.type === "relation" ? hidden.ids.join(",") : "", `${withPage},${plain},gone`);
  eq("rowPageId: only a uuid __page counts", `${rowPageId(tRows[0])}|${rowPageId({ id: "x", values: { __page: "not-a-uuid" } })}`, `${pageOfIt}|x`);
  // mirror side: the reverse links are rows of the mirrored database
  const mirror: DbProperty = { id: "back", databaseId: target, name: "From", type: "relation", config: { mirrorOf: { databaseId: "src", propId: "rel" } }, position: 1, createdAt: new Date(0) } as DbProperty;
  const srcRows = [{ id: "s1", databaseId: "src", values: { rel: [withPage], __page: "00000000-0000-4000-8000-0000000000c1" } }] as unknown as DbRow[];
  const mv = mapValue(mirror, tRows[0], { users: new Map(), props: [mirror], related: { src: { properties: [], rows: srcRows } } });
  eq("relation: mirror ids too", mv.type === "relation" ? mv.ids.join(",") : "", "00000000-0000-4000-8000-0000000000c1");
}

// ── 4. the aindrive save goes nowhere wider than the readers ─────────────────
{
  const file = "prompts/AI prompt — Birthday.md";
  const family: DriveShare = { root: "", audience: ["mom", "dad", "seoyeon", "grandma", "grandpa"] };
  const privateTs: DriveShare = { root: "", audience: ["mom", "dad", "seoyeon"] };
  const readers = ["mom", "dad", "seoyeon"];
  ok("drive: unlinked drive — saved", driveSaveAllowed(file, [], ["mom"]));
  ok("drive: whole drive linked into the open family teamspace — refused for a private prompt", !driveSaveAllowed(file, [family], readers));
  ok("drive: …whatever the page placement (no placement input at all)", !driveSaveAllowed(file, [privateTs, family], readers));
  ok("drive: linked only into a teamspace of exactly the readers — saved", driveSaveAllowed(file, [privateTs], readers));
  ok("drive: a quiet prompt (asker alone) and any link covering it — refused", !driveSaveAllowed(file, [privateTs], ["mom"]));
  ok("drive: a link to another folder does not cover prompts/", driveSaveAllowed(file, [{ root: "photos", audience: family.audience }], ["mom"]));
  ok("drive: a link to prompts/ itself covers it", !driveSaveAllowed(file, [{ root: "prompts", audience: family.audience }], ["mom"]));
  ok("drive: a room agent's folder around it counts like a teamspace", !driveSaveAllowed(file, [{ root: "prompts/", audience: ["mom", "grandma"] }], ["mom"]));
  ok("drive: a link whose path could not be read covers everything", shareCovers(null, "a/b.md") && !driveSaveAllowed(file, [{ root: null, audience: ["grandma"] }], ["mom"]));
  ok("drive: prefix is by folder, not by string", !shareCovers("prompt", "prompts/x.md") && shareCovers("/prompts/", "prompts/x.md"));
}

// ── 5. links in shared text come from configuration, never a request ────────
{
  const saved = { app: process.env.APP_ORIGIN, google: process.env.GOOGLE_REDIRECT_URI };
  delete process.env.APP_ORIGIN;
  delete process.env.GOOGLE_REDIRECT_URI;
  rememberOrigin("http://192.168.1.194:3110");
  eq("origin: a request's origin is never used", publicOrigin(), "");
  process.env.GOOGLE_REDIRECT_URI = "https://ainmem.example/api/auth/google/callback";
  eq("origin: GOOGLE_REDIRECT_URI's origin next", publicOrigin(), "https://ainmem.example");
  process.env.APP_ORIGIN = "https://app.example/";
  eq("origin: APP_ORIGIN first, trailing slash dropped", publicOrigin(), "https://app.example");
  process.env.APP_ORIGIN = "javascript:alert(1)";
  eq("origin: a non-http APP_ORIGIN is ignored", publicOrigin(), "https://ainmem.example");
  if (saved.app === undefined) delete process.env.APP_ORIGIN;
  else process.env.APP_ORIGIN = saved.app;
  if (saved.google === undefined) delete process.env.GOOGLE_REDIRECT_URI;
  else process.env.GOOGLE_REDIRECT_URI = saved.google;
}

// ── 6. a restricted page is open to the workspace's owners and admins too ────
// (getPagePermission lets them into every page; okf_acl has no such override, and another
// workspace's pages are not theirs) — a page is made only when they could open every source
{
  const at = { workspaceId: "ws", teamspaceId: null, restricted: true };
  const key = (p: ReturnType<typeof settlePlacement>) => `${p.restricted}/${p.overseen}/${p.blocked}`;
  eq("placement: restricted, no owner or admin outside the readers — a page", key(settlePlacement(at, [], true)), "true/false/false");
  eq("placement: restricted, admins who may open every source — a page, and the reply says they can", key(settlePlacement(at, ["mom"], true)), "true/true/false");
  eq("placement: restricted, an admin who may not open a source (a participant-only doc) — no page", key(settlePlacement(at, ["mom"], false)), "true/true/true");
  eq("placement: an open page is the teamspace's anyway — never blocked", key(settlePlacement({ ...at, restricted: false }, ["mom"], false)), "false/false/false");
  // savePromptPage refuses a blocked placement before it touches the database
  const refused = await savePromptPage({
    placement: { ...at, overseen: true, blocked: true },
    askerId: "dad",
    viewerIds: ["dad"],
    title: "t",
    summary: "s",
    prompt: "p",
    template: "claude-xml",
  }).then(
    () => false,
    (e: Error) => /refused/.test(e.message)
  );
  ok("placement: savePromptPage refuses a blocked placement", refused);
}

// ── 7. a database lives where its blocks do — in the Trash with them ─────────
{
  const rule = (h: Parameters<typeof databaseRule>[0]) => JSON.stringify(databaseRule(h));
  eq("database: its original's page decides", rule({ originals: ["p1"], linked: ["p2"], embedded: true }), JSON.stringify({ homes: ["p1"] }));
  eq("database: only linked views — they decide", rule({ originals: [], linked: ["p2"], embedded: true }), JSON.stringify({ homes: ["p2"] }));
  eq("database: every block trashed or deleted — trashed (visible to nobody), not the whole workspace", rule({ originals: [], linked: [], embedded: true }), JSON.stringify("trashed"));
  eq("database: never embedded — the workspace's members", rule({ originals: [], linked: [], embedded: false }), JSON.stringify("workspace"));
}

// ── 8. the saved prompt's code block names a language its picker offers ─────
{
  for (const tpl of ["claude-xml", "default", "markdown"] as const)
    ok(`code block language for ${tpl} is in CODE_LANGUAGES`, CODE_LANGUAGES.includes(promptBlockLanguage(tpl)), promptBlockLanguage(tpl));
  eq("claude-xml is tags", promptBlockLanguage("claude-xml"), "html");
}

// ── 9. layout notion2prompt: the root file is upstream's, linked pages by id ─
{
  const HUB = "aaaaaaaa-0000-4000-8000-000000000001";
  const SUB = "aaaaaaaa-0000-4000-8000-000000000002";
  const LNK = "aaaaaaaa-0000-4000-8000-000000000003";
  const pages: Record<string, MemPage> = {
    [HUB]: {
      title: "Hub",
      blocks: [
        para([text("Intro")]),
        { id: nid(), type: "child_page", title: "Sub", pageId: SUB },
        { id: nid(), type: "link_to_page", pageId: LNK },
      ],
    },
    [SUB]: { title: "Sub", blocks: [para([text("Sub body")])] },
    [LNK]: { title: "Linked", blocks: [para([text("Linked body")])] },
  };
  const c = await collect({ kind: "page", id: HUB }, {}, memSource(pages, ALL));
  const up = renderPrompt(c, { layout: "notion2prompt" });
  ok("n2p: a sub-page is its title, a linked page its id (upstream's pure_visitor)", up.files[0].code.includes(`📄 [[Sub]]\n[[${LNK.replace(/-/g, "")}]]\n`), up.files[0].code);
  ok("n2p: the pages it read follow as files of their own", up.files.length === 3, up.files.map((f) => f.path).join(" | "));
  const am = renderPrompt(c, { layout: "ainmem" });
  ok("ainmem: a linked page reads like a sub-page", am.files[0].code.includes("📄 [[Sub]]\n📄 [[Linked]]\n"), am.files[0].code);
  // depth 0: nothing below the root is read — upstream's single file, byte for byte in its shape
  const flat = renderPrompt(await collect({ kind: "page", id: HUB }, { depth: 0 }, memSource(pages, ALL)), { layout: "notion2prompt" });
  eq("n2p: depth 0 is upstream's one file", flat.files.map((f) => f.path).join(" | "), `Hub_${HUB.replace(/-/g, "")}.md`);
  ok("n2p: …with the same root file", flat.files[0].code === up.files[0].code, flat.files[0].code);
}

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
