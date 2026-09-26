// Prompt export — reading chat: when the family agent's prompt skill fires, what a
// sentence names and asks for, the pending "Which one?", ids in every spelling, and the
// pages a saved prompt must not be placed wider than.
//
//   npx tsx --tsconfig scripts/tsconfig.json scripts/prompt-export-chat.check.mts
//
// No database, no network: locateVisible gets an in-memory source, and the family-skill
// matcher is pure (the pg pool behind @/lib/db connects on first query, never here).
// Korean sentences live in @/i18n/content/scripts (PROMPT_EXPORT_CHAT_CHECK).
import {
  answerPending,
  answersPendingPrompt,
  asksAboutPrompt,
  asksForPrompt,
  coversAsked,
  findRefInText,
  idOf,
  isCanonicalOkfId,
  isPromptPageTitle,
  parsePromptRequest,
  pendingPrompt,
  promptAsk,
  rememberPendingPrompt,
  sameReaders,
  type Choice,
  type PendingPrompt,
} from "@/lib/prompt-export/input";
import { locateVisible } from "@/lib/prompt-export";
import { visibleRefs } from "@/lib/prompt-export/collect";
import type { DbSource } from "@/lib/prompt-export/source-db";
import type { PromptContent } from "@/lib/prompt-export/model";
import { matchFamilySkill } from "@/lib/agent/family-skills";
import { makeT } from "@/i18n/translate";
import { PROMPT_EXPORT_CHAT_CHECK as K } from "@/i18n/content/scripts";

let fails = 0;
let passes = 0;
const show = (s: unknown) => JSON.stringify(s);
function eq(name: string, got: unknown, want: unknown) {
  if (show(got) === show(want)) {
    passes++;
    return;
  }
  fails++;
  console.log(`✗ ${name}\n    want ${show(want)}\n    got  ${show(got)}`);
}
function ok(name: string, cond: boolean, detail?: unknown) {
  if (cond) passes++;
  else {
    fails++;
    console.log(`✗ ${name}${detail === undefined ? "" : `  (${show(detail)})`}`);
  }
}

// ── 1. the trigger: turning a page into a prompt, not chat about prompts ────
{
  for (const s of [
    "@agent make a prompt from the Chuseok page",
    "@agent convert the Chuseok page to a prompt",
    "@agent export the Chuseok page to an AI prompt",
    "@agent can you make a prompt from the Chuseok page?",
    "@agent make an AI prompt out of the Chuseok page",
    "@agent turn the Food database into a prompt",
    "make a prompt of /p/aabbccdd-aabb-ccdd-aabb-ccddaabbccdd",
    "@agent notion2prompt the Chuseok hub",
  ])
    ok(`asks (en): ${s}`, asksForPrompt(s), promptAsk(s));
  for (const [s] of K.requests) ok(`asks (ko): ${s}`, asksForPrompt(s), promptAsk(s));

  // never the skill: questions about a prompt, and a prompt to be WRITTEN about something
  for (const s of [
    "what prompt did you use to make this album?",
    "@agent which prompt made this picture?",
    "@agent did you use a prompt for the Chuseok album?",
    "@agent write me a prompt for a birthday card",
    "@agent give me a good prompt for drawing grandma",
  ])
    eq(`not a request (en): ${s}`, promptAsk(s), null);
  for (const s of K.notRequests) eq(`not a request (ko): ${s}`, promptAsk(s), null);
  // "make the prompt shorter", "make me a prompt for …": a making verb, no page — the skill
  // hands these back unless a page is open and nothing else is said
  for (const s of ["@agent make the prompt shorter", "@agent make me a prompt for a birthday card", "@agent can you make a prompt?"])
    eq(`only a maybe (make, nothing named): ${s}`, promptAsk(s), { sure: false, turn: false });
  // a turn with a bare title: taken only when it names a page the readers see
  eq("maybe (turn, a title): en", promptAsk("@agent turn the Chuseok album into a prompt"), { sure: false, turn: true });
  eq("maybe (turn, a title): ko", promptAsk(K.maybeTitle[0]), { sure: false, turn: true });
  eq("maybe: what is left names the title", parsePromptRequest(K.maybeTitle[0]).rest.startsWith(K.maybeTitle[1]), true);

  // the family-skill matcher: questions about a prompt go to the model — not to the prompt
  // skill, and not to the album skill for the "make … album" inside them
  for (const s of ["what prompt did you use to make this album?", ...K.notRequests.slice(0, 2)]) eq(`matcher leaves it to the model: ${s}`, matchFamilySkill(s), null);
  eq("matcher: a real album request is still the album", matchFamilySkill("@agent make a Jeju album"), "album");
  eq("matcher: a prompt request about the album page is the prompt", matchFamilySkill("@agent make a prompt from the Jeju album page"), "prompt");
  eq("matcher: write me a prompt → model", matchFamilySkill("@agent write me a prompt for a birthday card"), null);
  eq("matcher: a maybe goes to the skill, which may hand it back", matchFamilySkill("@agent turn the Chuseok album into a prompt"), "prompt");
}

// ── 2. options said in a sentence ────────────────────────────────────────────
{
  const r = (s: string) => parsePromptRequest(s);
  // an apostrophe inside the quotes stays in the instruction, and out of the title lookup
  eq("instruction: apostrophe (grandma's)", r(`@agent make a prompt from the Chuseok page, instruction: "Summarize grandma's recipes"`).render.instruction, "Summarize grandma's recipes");
  eq("instruction: apostrophe leaves the title words alone", r(`@agent make a prompt from the Chuseok page, instruction: "Summarize grandma's recipes"`).rest, "Chuseok");
  eq("instruction: what's", r(`make a prompt from the Chuseok page instruction: "Summarize what's due this week"`).render.instruction, "Summarize what's due this week");
  eq("instruction: don't", r(`make a prompt from the Chuseok page, instructions: "don't skip the menu"`).render.instruction, "don't skip the menu");
  eq("instruction: curly quotes", r("make a prompt from the Chuseok page, instruction: “Plan the menu, don't forget dessert”").render.instruction, "Plan the menu, don't forget dessert");
  eq("instruction: single quotes", r("make a prompt from the Chuseok page, instruction: 'Plan the menu'").render.instruction, "Plan the menu");
  eq("instruction: corner brackets", r("make a prompt from the Chuseok page, instruction: 「Plan the menu」").render.instruction, "Plan the menu");
  // quoted words are the instruction, never a page word that makes a request sure
  eq("instruction: quoted words are not the source", promptAsk(`@agent make a prompt, instruction: "summarize this page"`), { sure: false, turn: false });

  // "one file per page" is the separate layout; "one file" the merged one
  const per = r("@agent make a prompt from the Chuseok page, one file per page");
  eq("one file per page → separate", [per.render.separateChildPages, per.rest], [true, "Chuseok"]);
  eq("one file per child page → separate", r("@agent make a prompt from the Chuseok page, one file per child page").render.separateChildPages, true);
  eq("each page in its own file → separate", r("@agent make a prompt from the Chuseok page, each page in its own file").render.separateChildPages, true);
  const one = r("@agent make a prompt from the Chuseok page, one file");
  eq("one file → merged", [one.render.separateChildPages, one.rest], [false, "Chuseok"]);
  eq("single file → merged", r("@agent make a prompt from the Chuseok page as a single file").render.separateChildPages, false);
  // the skill's own reply names the default "one file per page" — said back, it means that
  eq("the reply's own words, said back", r(`@agent make a prompt from the Chuseok page, ${makeT("en")("one file per page")}`).render.separateChildPages, true);
  eq("ko: a file per page → separate", [r(K.oneFilePerPage).render.separateChildPages, r(K.oneFilePerPage).rest], [true, K.chuseokWord]);
  eq("ko: one file → merged", [r(K.oneFile).render.separateChildPages, r(K.oneFile).rest], [false, K.chuseokWord]);
  eq("ko: the reply's own words, said back", r(`@agent ${K.chuseokWord} ${makeT("ko")("one file per page")}`).render.separateChildPages, true);

  // depth and limit, said naturally
  eq("depth of 2", [r("@agent make a prompt from the Chuseok page with a depth of 2").fetch, r("@agent make a prompt from the Chuseok page with a depth of 2").rest], [{ depth: 2 }, "Chuseok"]);
  eq("depth: 3", r("@agent make a prompt from the Chuseok page, depth: 3").fetch, { depth: 3 });
  eq("up to 3 levels (a depth, not a limit)", r("@agent make a prompt from the Chuseok page up to 3 levels deep").fetch, { depth: 3 });
  eq("limit to 200", [r("@agent make a prompt from the Chuseok page, limit to 200").fetch, r("@agent make a prompt from the Chuseok page, limit to 200").rest], [{ limit: 200 }, "Chuseok"]);
  eq("depth and limit together", r("@agent make a prompt from the Chuseok page, depth 2, limit 300").fetch, { depth: 2, limit: 300 });
  eq("ko: depth, at most 3 (a depth, not a limit)", [r(K.depthMax).fetch, r(K.depthMax).rest], [{ depth: 3 }, K.chuseokWord]);
  eq("ko: depth with a particle", [r(K.depthParticle).fetch, r(K.depthParticle).rest], [{ depth: 2 }, K.chuseokWord]);
  eq("ko: at most 3 levels", r(K.depthLevels).fetch, { depth: 3 });
  eq("ko: at most 200 items (a limit)", r(K.limitCount).fetch, { limit: 200 });
}

// ── 3. what names the page ──────────────────────────────────────────────────
{
  // helper words never stay in the title query (coversAsked then holds for the hub)
  for (const s of [
    "convert the Chuseok page to a prompt",
    "export the Chuseok page to an AI prompt",
    "can you make a prompt from the Chuseok page?",
    "make an AI prompt out of the Chuseok page",
    "could you please turn our Chuseok page into a prompt for me?",
    "I want a prompt made from the Chuseok page",
  ]) {
    const rest = parsePromptRequest(s).rest;
    eq(`rest (en): ${s}`, rest, "Chuseok");
    ok(`covers the hub (en): ${s}`, coversAsked(K.hubTitle, rest));
  }
  for (const [s, want] of K.requests) {
    const q = parsePromptRequest(s);
    eq(`rest (ko): ${s}`, [q.rest, q.thisPage], [want, false]);
  }
  ok("ko: covers the hub", coversAsked(K.hubTitle, parsePromptRequest(K.requests[0][0]).rest));

  // "this" / "it" / "here" and their Korean: the page open behind the assistant panel
  for (const s of [
    "turn this into an AI prompt",
    "make this a prompt",
    "turn it into a prompt please",
    "can you make a prompt?",
    "make a prompt from this doc",
    "make a prompt from the page I'm on",
    "turn this one into a prompt",
    ...K.openPage,
  ]) {
    // the skill's rule (prompt-skill.ts): "this page", or nothing left that names one
    const q = parsePromptRequest(s);
    ok(`the open page: ${s}`, (q.thisPage || !q.rest) && q.rest === "", q);
  }
  // …but a named page wins over "this"
  const named = parsePromptRequest("turn this Chuseok page into a prompt");
  eq("this + a name: the name", [named.thisPage, named.rest], [false, "Chuseok"]);
  const idea = parsePromptRequest("turn this idea into a prompt");
  eq("this + another noun: not the open page", [idea.thisPage, idea.rest], [false, "idea"]);
}

// ── 4. ids in every spelling ────────────────────────────────────────────────
{
  const hex = "aabbccddaabbccddaabbccddaabbccdd";
  const uuid = "aabbccdd-aabb-ccdd-aabb-ccddaabbccdd";
  eq("32 hex in a sentence (upstream's spelling, and the prompt's Page ID)", findRefInText(`@agent make a prompt of ${hex}`), uuid);
  eq("32 hex in upper case", findRefInText(`@agent make a prompt of ${hex.toUpperCase()} please`), uuid);
  ok("32 hex makes the request sure", asksForPrompt(`@agent make a prompt of ${hex}`));
  eq("no id in a plain sentence", findRefInText("@agent make a prompt from the Chuseok page"), null);

  const okf = Buffer.from("rooms/family/relationship.md", "utf8").toString("base64url");
  eq("idOf: a bare OKF id", idOf(okf), okf);
  eq("idOf: an OKF link", idOf(`https://app.example/p/${okf}`), okf);
  eq("idOf: 32 hex", idOf(hex), uuid);
  eq("idOf: a teamspace", idOf(`teamspace:${uuid}`), `teamspace:${uuid}`);
  eq("idOf: a teamspace with no uuid", idOf("teamspace:family"), null);
  eq("idOf: a title word is not an id", [idOf("Birthday"), idOf("Chuseok"), idOf("Chuseok hub")], [null, null, null]);
  ok("OKF: canonical only", isCanonicalOkfId(okf) && !isCanonicalOkfId("Birthday") && !isCanonicalOkfId(`${okf}=`) && !isCanonicalOkfId(uuid));

  // locateVisible: ids only, and only what the readers may all see
  const pages: Record<string, { title: string; hidden?: boolean }> = { [okf]: { title: "Family relationship" }, [uuid]: { title: "Chuseok hub" }, "bbbbbbbb-aabb-ccdd-aabb-ccddaabbccdd": { title: "Secret", hidden: true } };
  const asked: string[] = [];
  const src = {
    async locate(id: string) {
      asked.push(id);
      return pages[id] ? { kind: "page" as const, id } : null;
    },
    async canSee(_k: "page" | "database", id: string) {
      return !!pages[id] && !pages[id].hidden;
    },
    async title(_k: "page" | "database", id: string) {
      return pages[id]?.title ?? null;
    },
    async block() {
      return null;
    },
  } as unknown as DbSource;
  const readers = { viewerIds: ["mom"] };
  eq("locateVisible: a bare OKF id", await locateVisible(okf, readers, src), { kind: "page", id: okf, title: "Family relationship" });
  eq("locateVisible: an OKF link", await locateVisible(`/p/${okf}`, readers, src), { kind: "page", id: okf, title: "Family relationship" });
  eq("locateVisible: 32 hex", await locateVisible(hex, readers, src), { kind: "page", id: uuid, title: "Chuseok hub" });
  eq("locateVisible: hidden → not found", await locateVisible("bbbbbbbb-aabb-ccdd-aabb-ccddaabbccdd", readers, src), null);
  asked.length = 0;
  eq("locateVisible: a title is never looked up", await locateVisible("Chuseok hub", readers, src), null);
  eq("locateVisible: …nor located", asked, []);
}

// ── 5. saved prompt pages are output, never a title candidate ───────────────
{
  const en = makeT("en")("AI prompt — {title}", { title: "2026 Chuseok" });
  ok("prompt page (en)", isPromptPageTitle(en), en);
  ok("prompt page (ko)", isPromptPageTitle(K.promptPage));
  ok("prompt page (ko, made from the t() key)", isPromptPageTitle(makeT("ko")("AI prompt — {title}", { title: K.hubTitle })));
  ok("the source page is not", !isPromptPageTitle(K.hubTitle) && !isPromptPageTitle("AI prompts we like") && !isPromptPageTitle(makeT("en")("AI prompt — {title}", { title: "" })));
}

// ── 6. "Which one?" and its answer ──────────────────────────────────────────
{
  const choices: Choice[] = K.choices.map((title, i) => ({ kind: "page", id: `c${i}`, title }));
  const p: PendingPrompt = { choices, pool: [], fetch: { depth: 2 }, render: {}, readers: ["mom", "dad"], expires: Date.now() + 60_000 };
  const a = (s: string, q: PendingPrompt = p) => answerPending(q, s);
  for (const [s, i] of [["2", 1], ["@agent 2", 1], ["#2", 1], ["no. 3", 2], ["number 1 please", 0], ["the second one", 1], ["second", 1], ["the third", 2], ["the second one, as markdown", 1]] as const)
    eq(`answer: ${s}`, a(s), { index: i });
  for (const [s, i] of K.answers) eq(`answer (ko): ${s}`, a(s), { index: i });
  eq("answer: a title", a(K.choices[0]), { index: 0 });
  eq("answer: the album one (en)", a("the album one"), { index: 0 });
  eq("answer: the album (ko word)", a(K.albumWord), { index: 0 });
  eq("answer: a word all of them hold → asked again with those", a(K.chuseokWord), { narrowed: choices });
  eq("answer: out of range", a("9"), null);
  eq("answer: yes to three is no answer", [a("yes"), a(K.yes[0])], [null, null]);
  eq("answer: something else", [a("@agent thanks!"), a("@agent what's for dinner?")], [null, null]);
  const one: PendingPrompt = { ...p, choices: [choices[0]] };
  for (const s of ["yes", "sure", "yep please", ...K.yes]) eq(`answer to "did you mean…?": ${s}`, a(s, one), { index: 0 });
  // after "which page?": a name that names a title the readers see
  const pool: PendingPrompt = { ...p, choices: [], pool: choices };
  eq("which page? → a name", a("the Chuseok album", pool), { query: "Chuseok album" });
  eq("which page? → chat", [a("never mind", pool), a("thanks", pool), a(K.yes[0], pool)], [null, null, null]);

  // per room and asker, one turn
  const room = "room-1";
  rememberPendingPrompt(room, "mom", { choices, pool: [], fetch: { depth: 2 }, render: {}, readers: ["mom", "dad"] });
  eq("matcher: the answer goes back to the prompt skill", matchFamilySkill("@agent 2", { roomId: room, askerId: "mom" }), "prompt");
  ok("…and the question is still there for the skill to read", !!pendingPrompt(room, "mom"));
  eq("matcher: someone else's answer is not", matchFamilySkill("@agent 2", { roomId: room, askerId: "dad" }), null);
  eq("matcher: another room is not", matchFamilySkill("@agent 2", { roomId: "room-2", askerId: "mom" }), null);
  ok("…and neither took the question off the table", !!pendingPrompt(room, "mom"));
  eq("matcher: anything else ends it", matchFamilySkill("@agent what's for dinner?", { roomId: room, askerId: "mom" }), null);
  ok("…it is gone", !pendingPrompt(room, "mom"));
  eq("matcher: then a bare number is nothing", matchFamilySkill("@agent 2", { roomId: room, askerId: "mom" }), null);
  // another skill's request right after the question is that skill's, and ends it
  rememberPendingPrompt(room, "mom", { choices: [{ kind: "page", id: "j", title: "Jeju album" }], pool: [], fetch: {}, render: {}, readers: ["mom"] });
  eq("matcher: an album request is the album, even when it names an offered title", matchFamilySkill("@agent make a Jeju album", { roomId: room, askerId: "mom" }), "album");
  ok("…and ends the question", !pendingPrompt(room, "mom"));
  rememberPendingPrompt(room, "mom", { choices: [{ kind: "page", id: "j", title: K.choices[0] }], pool: [], fetch: {}, render: {}, readers: ["mom"] });
  eq("matcher (ko): an album request is the album", matchFamilySkill(K.albumRequest, { roomId: room, askerId: "mom" }), "album");
  // expiry
  rememberPendingPrompt(room, "mom", { choices, pool: [], fetch: {}, render: {}, readers: ["mom"] }, Date.now() - 11 * 60_000);
  eq("a question ten minutes old is gone", answersPendingPrompt(room, "mom", "2"), false);
  // an answer read for other people (a quiet question answered out loud) starts afresh
  ok("readers: same set in any order", sameReaders(["mom", "dad"], ["dad", "mom"]) && !sameReaders(["mom"], ["mom", "dad"]) && !sameReaders(["mom", "dad"], ["mom", "grandma"]));
  ok("asks about a prompt", asksAboutPrompt("what prompt did you use to make this album?") && !asksAboutPrompt("@agent make a prompt from the Chuseok page") && !asksAboutPrompt("what's for dinner?"));
}

// ── 7. what a saved prompt names (its placement is no wider than all of it) ──
{
  const P = (id: string) => ({ id, title: id, url: `/p/${id}`, properties: [], blocks: [] });
  const content: PromptContent = {
    version: 1,
    root: { kind: "page", id: "hub" },
    pages: {
      hub: {
        ...P("hub"),
        blocks: [
          { id: "b1", type: "child_page", title: "Deep page", pageId: "deep" },
          { id: "b2", type: "link_to_page", pageId: "hidden-link" },
          { id: "b3", type: "child_database", title: "Menu", content: { state: "not_fetched", databaseId: "menu-db" } },
          { id: "b4", type: "child_database", title: "Restricted database", content: { state: "inaccessible" } },
          { id: "b5", type: "paragraph", richText: [{ type: "mention", mention: { type: "page", id: "mentioned" }, plainText: "Mentioned" }], children: [{ id: "b6", type: "child_page", title: "Nested", pageId: "nested" }] },
        ],
      },
    },
    databases: {},
    mentions: { "page:mentioned": "Mentioned", "page:secret": "Restricted page" },
    tree: { kind: "page", id: "hub", title: "hub", children: [] },
    location: { segments: ["Kim family"] },
    stats: { pages: 1, databases: 0, rows: 0, blocks: 6, items: 7, maxDepthReached: 0, depthLimited: true, limitReached: false },
    skipped: [
      { reason: "permission", kind: "page", id: "hidden-link" },
      { reason: "permission", kind: "page", id: "secret" },
      { reason: "depth", kind: "page", id: "deep" },
    ],
    options: { depth: 0, limit: 1000, childPages: true, alwaysFetchDatabases: false },
  };
  const refs = visibleRefs(content);
  eq("placement sources: read, printed-only (depth), nested, mentioned — never hidden", [refs.pages.sort(), refs.databases], [["deep", "hub", "mentioned", "nested"], ["menu-db"]]);
}

console.log(`\nprompt export chat: ${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
