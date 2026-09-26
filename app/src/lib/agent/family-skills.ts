import "server-only";
import { createHash } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { giftPrice } from "@/lib/gift-price";
import { blocks, pages, teamspaces, users } from "@/lib/db/schema";
import { aiChat } from "@/lib/ai";
import { runAsOrService } from "@/lib/aindrive-account";
import { aindrivePublicBase, listTree, notUserFolder, readFile, readFileBytes } from "@/lib/aindrive";
import { aindriveFileUrl } from "@/lib/aindrive-url";
import { readExif, type PhotoExif } from "@/lib/exif";
import { formatUsdc, giftValid, ledgerBalance, ledgerDriveOf, unlocked, type GiftContent } from "@/lib/gift";
import { payGift } from "@/lib/x402/pay";
import { b, createAgentDatabase, writeAgentPage, type NewBlock } from "./agent-pages";
import { answersPendingPrompt, asksAboutPrompt, forgetPendingPrompt, promptAsk, saidAsPick } from "@/lib/prompt-export/input";
import { promptSkill } from "./prompt-skill";
import type { DriveSource } from "./shared-drives";
import { makeT, type T } from "@/i18n/translate";
import { demoLang, familyDemo } from "@/i18n/content/demo-lang";
import {
  ALBUM_REGIONS,
  FAMILY_ALIASES,
  FAMILY_FILES,
  FAMILY_SKILL_WORDS as W,
  HANDFUL,
  NAME_SUFFIX,
  SERVINGS_UNITS,
  TODO_BOARD_KO,
  WEEKDAY_KO,
  anyOf,
} from "@/i18n/content/agent";

/**
 * What a family room's agent can DO, beyond answering — each reads the folders
 * the family shared (as whoever shared them), writes a page into the teamspace
 * those files came from, and says in the chat where it is:
 *
 *   cooking     "shopping list for nokdujeon for 4"          → recipe scaled, a checklist
 *   recording   "pull the to-dos out of the recording"       → a to-do board from a recording
 *   album       "make a Jeju album"                          → photos from every phone, by day
 *   allowance   "give Seoyeon her pocket money, open the video" → an x402 payment opens a gift
 *   prompt      "make a prompt from the Chuseok page"          → notion2prompt: the page (and its
 *               child pages and databases) as an AI-ready prompt, in a page and the asker's aindrive
 *
 * (Asked in Korean or English — the keyword lists live in @/i18n/content/agent.)
 *
 * Matched by what the sentence asks for, not left to the model: these write
 * pages and move money, and "maybe" is not a state either may be in.
 */

export type FamilySkill = "shopping" | "todos" | "album" | "allowance" | "prompt";

const SKILL_RE = (["allowance", "todos", "album", "shopping"] as const).map((k) => ({
  skill: k,
  topic: anyOf(W[k].topic),
  act: anyOf(W[k].act),
}));
const SERVINGS_RE = new RegExp(String.raw`\d+\s*(${SERVINGS_UNITS.join("|")})`, "i");
const SERVINGS_NUM_RE = new RegExp(String.raw`(\d+)\s*(${SERVINGS_UNITS.join("|")})`, "i");
const SERVINGS_ACT = anyOf(W.servingsAct);

/**
 * The skill a message asks for. `from` (the room and the person asking) lets it answer a
 * question the prompt skill asked that person there ("Which one? 1. … 2. …" → "2"); that
 * question lasts one turn, so any other message from them takes it off the table.
 *
 * "prompt" is also returned for a sentence that only might be a prompt request ("turn
 * the Chuseok album into a prompt", no page word): the skill takes it when the name is a
 * page title the readers see, and otherwise hands it back (runFamilySkill → null). Any
 * such sentence is the prompt's before another skill's: in "turn the Chuseok album into
 * a prompt" or "make a prompt from the shopping list" the "make" is the prompt's, and
 * building an album or a list instead would do something nobody asked for.
 */
export function matchFamilySkill(text: string, from?: { roomId: string; askerId: string }): FamilySkill | null {
  const t = text.replace(/\s+/g, " ");
  const ask = promptAsk(t);
  const answers = from ? answersPendingPrompt(from.roomId, from.askerId, t) : false;
  // first: "make a prompt from the album page" is about the prompt, not the album
  if (ask?.sure) return "prompt";
  // "what prompt did you use to make this album?" is a question for the model, not "make an album"
  if (asksAboutPrompt(t)) {
    if (from) forgetPendingPrompt(from.roomId, from.askerId);
    return null;
  }
  // a prompt asked for at all — "turn the Chuseok album into a prompt", "make me a prompt
  // for the album" — is never the album or the shopping list (the skill may hand it back)
  if (ask) return "prompt";
  // the answer to its "which one?", said as a pick ("the album one", "make it from the Chuseok album")
  if (answers && saidAsPick(t)) return "prompt";
  const other = (() => {
    for (const { skill, topic, act } of SKILL_RE) if (topic.test(t) && act.test(t)) return skill;
    if (SERVINGS_RE.test(t) && SERVINGS_ACT.test(t)) return "shopping" as const;
    return null;
  })();
  if (other) {
    // "make a Jeju album" is the album skill, even right after "which one? 「Jeju album」…"
    if (from) forgetPendingPrompt(from.roomId, from.askerId);
    return other;
  }
  return answers || ask ? "prompt" : null;
}

/** The language to answer in: the one the request was written in. */
export function langOf(text: string): "ko" | "en" {
  return /[\uAC00-\uD7A3]/.test(text) ? "ko" : "en";
}

/** Whether the sentence names `word` — a dish, place or person as the family's data
 *  names it ("mung_bean_pancake" is said "mung bean pancake"), or one of its aliases. */
const mentions = (text: string, word: string) => {
  const said = text.toLowerCase();
  return (
    said.includes(word.toLowerCase()) ||
    said.includes(word.toLowerCase().replace(/_/g, " ")) ||
    (FAMILY_ALIASES[word] ?? []).some((a) => said.includes(a))
  );
};

export interface SkillContext {
  workspaceId: string;
  askerId: string;
  sources: DriveSource[];
  text: string;
  /** answer (and write the page) in this language */
  lang: "ko" | "en";
  /** whose phones did not answer while listing (filled by listAll) */
  offline?: string[];
  /** the room asked in */
  roomId?: string;
  /** everyone who will read the answer (answerViewers) — what they cannot all see stays out */
  viewerIds?: string[];
  /** the page open where it was asked ("this page") — the assistant panel sends it */
  contextPageId?: string | null;
}

/** Translator for the language the request was written in. */
const tOf = (ctx: SkillContext): T => makeT(ctx.lang);
/** A family member as named in the answer's language. */
const nm = (ctx: SkillContext, name: string) => (ctx.lang === "en" ? (familyDemo().FAMILY_NAME_EN[name] ?? name) : name);
/** A region as named in the answer's language. */
const regionLabel = (ctx: SkillContext, r: string) => (ctx.lang === "en" ? (ALBUM_REGIONS[r]?.en ?? r) : r);
const numLocale = (ctx: SkillContext) => (ctx.lang === "en" ? "en-US" : "ko-KR");
const outLang = (ctx: SkillContext) => (ctx.lang === "en" ? "English" : "Korean");

export interface SkillResult {
  text: string;
  pageId?: string;
}

// ── shared helpers ──────────────────────────────────────────────────────────

interface Found {
  src: DriveSource;
  /** path inside the shared folder */
  rel: string;
  /** path inside the drive */
  full: string;
}

async function listAll(ctx: SkillContext): Promise<Found[]> {
  const out: Found[] = [];
  const off = new Set<string>();
  await Promise.all(
    ctx.sources.map(async (src) => {
      const files = await runAsOrService(src.linkedBy, () => listTree(src.link, 400, 80, notUserFolder)).catch(() => {
        // a phone that is off answers nothing — say so rather than quietly leave it out
        off.add(src.ownerName ?? src.label);
        return [] as string[];
      });
      for (const rel of files)
        if (!/(^|\/)ainmem-|(^|\/)\.aindrive\//.test(rel)) out.push({ src, rel, full: [src.link.root, rel].filter(Boolean).join("/") });
    })
  );
  ctx.offline = [...off];
  return out;
}

/** "Dad's phone is off…" — appended to an answer when a phone did not answer. */
function offNote(ctx: SkillContext): string {
  const off = ctx.offline ?? [];
  if (!off.length) return "";
  const t = tOf(ctx);
  const names = off.map((o) => nm(ctx, o)).join(", ");
  return (
    "\n⚠️ " +
    (off.length > 1
      ? t("{names}'s phones are off, so nothing from them is included — ask again once they're on.", { names })
      : t("{names}'s phone is off, so nothing from it is included — ask again once it's on.", { names }))
  );
}

const read = (f: Found) => runAsOrService(f.src.linkedBy, () => readFile(f.src.link, f.rel));
const readBytes = (f: Found) => runAsOrService(f.src.linkedBy, () => readFileBytes(f.src.link, f.rel, 20 * 1024 * 1024));
const base = () => aindrivePublicBase() ?? "";
const urlOf = (f: Found) => aindriveFileUrl(base(), { driveId: f.src.link.driveId, path: f.full });
const nameOf = (p: string) => p.split("/").pop() ?? p;
const who = (f: Found) => f.src.ownerName ?? f.src.label;

async function llmJson<T>(system: string, user: string, maxTokens = 1200): Promise<T | null> {
  const raw = await aiChat(
    [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    { maxTokens, temperature: 0 }
  ).catch(() => "");
  try {
    const fenced = raw.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
    return JSON.parse((fenced ? fenced[1] : raw).trim().replace(/^[^{[]*/, "").replace(/[^}\]]*$/, "")) as T;
  } catch {
    return null;
  }
}

async function teamspaceOf(f: Found | undefined, workspaceId: string): Promise<{ id: string; name: string; private: boolean } | null> {
  const id = f?.src.teamspaceId;
  const rows = id
    ? await db.select().from(teamspaces).where(eq(teamspaces.id, id))
    : await db.select().from(teamspaces).where(eq(teamspaces.workspaceId, workspaceId)).limit(1);
  const t = rows[0];
  return t ? { id: t.id, name: t.name, private: t.visibility === "private" } : null;
}

// ── 1. cooking: recipe → scaled shopping list ──────────────────────────────

const RECIPE_DIR = new RegExp(`(^|/)(${FAMILY_FILES.recipeDir.join("|")})/`, "i");
const MEASURE = anyOf(FAMILY_FILES.measure);
const REVIEW = anyOf(FAMILY_FILES.review);

async function shopping(ctx: SkillContext): Promise<SkillResult> {
  const t = tOf(ctx);
  const files = await listAll(ctx);
  const recipes = files.filter((f) => RECIPE_DIR.test(f.full) && /\.md$/i.test(f.rel) && !MEASURE.test(f.rel));
  const dishOf = (f: Found) => nameOf(f.rel).replace(/\.md$/i, "");
  /** a dish as said, not as filed ("mung_bean_pancake" → "mung bean pancake") */
  const said = (d: string) => d.replace(/_/g, " ");
  const recipe = recipes.find((f) => mentions(ctx.text, dishOf(f)));
  if (!recipe)
    return {
      text: recipes.length
        ? t("Which dish? Recipes the family shared: {list}", { list: recipes.map((r) => said(dishOf(r))).join(", ") })
        : t("I couldn't find a recipe in the folders the family shared."),
    };
  const dish = dishOf(recipe);
  const dishName = said(dish);
  const servings = Number(ctx.text.match(SERVINGS_NUM_RE)?.[1] ?? 4);
  const measure = files.find((f) => f.src === recipe.src && MEASURE.test(f.rel));
  const [recipeText, measureText] = await Promise.all([read(recipe), measure ? read(measure) : Promise.resolve("")]);
  const plan = await llmJson<{ originalServings?: number; items?: { name: string; amount: string; note?: string }[]; steps?: string[] }>(
    "You turn a Korean family recipe into a shopping list for a different number of servings. Use the household measure table when given " +
      `("${demoLang() === "en" ? "a handful" : HANDFUL}" → grams). Output JSON only: {"originalServings":<number the recipe makes>,"items":[{"name":"<ingredient>","amount":"<scaled amount, Korean units or grams>","note":"<short tip or empty>"}],` +
      '"steps":["<short step>", …3 to 6]}. Keep every ingredient; do not invent any. ' +
      `Write names, amounts, notes and steps in ${outLang(ctx)}.`,
    `## Recipe\n${recipeText.slice(0, 5000)}\n\n## Household measures\n${measureText.slice(0, 2000)}\n\n## Servings wanted\n${servings}`
  );
  if (!plan?.items?.length)
    return { text: t("I read the {dish} recipe but couldn't list the ingredients. Ask me once more?", { dish: dishName }) };
  const media = files.filter((f) => f.src === recipe.src && f !== recipe && nameOf(f.rel).includes(dish));
  const review = files.find((f) => REVIEW.test(f.rel) && nameOf(f.rel).includes(dish));
  const ts = await teamspaceOf(recipe, ctx.workspaceId);
  if (!ts) return { text: t("I couldn't find the teamspace the recipe is in.") };
  const title = t("{dish} for {n} — shopping list", { dish: dishName, n: servings });
  const cook = nm(ctx, who(recipe));
  const body: NewBlock[] = [
    b.callout(
      "🛒",
      t("{who}'s {dish} recipe (makes {orig}) scaled to {n} servings.", { who: cook, dish: dishName, orig: plan.originalServings ?? "?", n: servings }) +
        (measure ? " " + t(`Measures like "a handful" are converted with grandma's measure table.`) : "")
    ),
    b.h2(t("To buy")),
    ...plan.items.map((i) => b.todo(`${i.name} ${i.amount}${i.note ? ` — ${i.note}` : ""}`)),
    b.h2(t("How to make it (short)")),
    ...(plan.steps ?? []).map((s) => b.num(s)),
    b.h2(t("From {who}'s phone", { who: cook })),
    b.file(urlOf(recipe), nameOf(recipe.rel)),
    ...media.map((f) => b.file(urlOf(f), nameOf(f.rel))),
    ...(measure ? [b.file(urlOf(measure), nameOf(measure.rel))] : []),
    ...(review ? [b.h2(t("Tried it")), b.file(urlOf(review), `${nameOf(review.rel)} — ${who(review)}`)] : []),
  ];
  const pageId = await writeAgentPage({ workspaceId: ctx.workspaceId, teamspaceId: ts.id, title, icon: "🛒", byUserId: ctx.askerId, blocks: body });
  return {
    pageId,
    text:
      t("Made the {dish} shopping list for {n} → /p/{pageId}", { dish: dishName, n: servings, pageId }) +
      "\n" +
      plan.items.slice(0, 6).map((i) => `- ${i.name} ${i.amount}`).join("\n") +
      (plan.items.length > 6 ? "\n" + t("… and {n} more", { n: plan.items.length - 6 }) : "") +
      "\n" +
      t("From {who}'s phone —", { who: cook }) +
      " " +
      [recipe, ...media].map((m) => nameOf(m.rel)).join(", ") +
      offNote(ctx),
  };
}

// ── 2. recording: a recording's transcript → a to-do board ────────────────

async function todos(ctx: SkillContext): Promise<SkillResult> {
  const t = tOf(ctx);
  const files = await listAll(ctx);
  const audio = files.filter((f) => /\.(m4a|mp3|wav|aac|ogg)$/i.test(f.rel));
  const pairs = audio
    .map((a) => ({ audio: a, text: files.find((t) => t.src === a.src && t.rel === a.rel.replace(/\.[^.]+$/, ".txt")) }))
    .filter((p): p is { audio: Found; text: Found } => !!p.text)
    .sort((x, y) => nameOf(y.audio.rel).localeCompare(nameOf(x.audio.rel)));
  const pick = pairs[0];
  if (!pick)
    return { text: t("I couldn't find a recording with a transcript (.txt) in the shared folders.") };
  const transcript = await read(pick.text);
  const F = familyDemo().FAMILY;
  const out = await llmJson<{ title?: string; date?: string; tasks?: { task: string; owner: string; due?: string | null; note?: string }[] }>(
    `You read a ${demoLang() === "en" ? "" : "Korean "}family meeting transcript and list` +
      " every action item someone took on. Resolve dates against the meeting date " +
      '(the year is in the header). Output JSON only: {"title":"<short meeting title>","date":"YYYY-MM-DD",' +
      `"tasks":[{"task":"<what, short>","owner":"<who: one person's name as spoken, e.g. ${[F.mom, F.dad, F.seoyeon, F.doyun].map((f) => f.name).join("/")}, or ${F.everyone.name}>","due":"YYYY-MM-DD or null","note":"<detail or empty>"}]}. ` +
      `Write title, task and note in ${outLang(ctx)}; keep owner names exactly as spoken.`,
    transcript.slice(0, 6000),
    1500
  );
  if (!out?.tasks?.length) return { text: t("I read the recording but found no to-dos.") };
  const ts = await teamspaceOf(pick.audio, ctx.workspaceId);
  if (!ts) return { text: t("I couldn't find the teamspace the recording is in.") };
  const C = ctx.lang === "en"
    ? { task: "To-do", owner: "Owner", due: "Due", state: "Status", note: "Note", todo: "To do", doing: "Doing", done: "Done", byOwner: "By owner", progress: "Progress", table: "Table", suffix: "to-dos", meeting: "Meeting" }
    : TODO_BOARD_KO;
  const palette = ["blue", "green", "orange", "purple", "pink", "yellow", "red", "brown"];
  const owners = [...new Set(out.tasks.map((t) => t.owner).filter(Boolean))];
  const dbId = await createAgentDatabase({
    workspaceId: ctx.workspaceId,
    byUserId: ctx.askerId,
    title: `${out.title ?? C.meeting} — ${C.suffix}`,
    columns: [
      { name: C.task, type: "title" },
      { name: C.owner, type: "select", options: owners.map((o, i) => ({ name: o, color: palette[i % palette.length] })) },
      { name: C.due, type: "date" },
      { name: C.state, type: "select", options: [{ name: C.todo, color: "gray" }, { name: C.doing, color: "blue" }, { name: C.done, color: "green" }] },
      { name: C.note, type: "text" },
    ],
    rows: out.tasks.map((t) => ({ [C.task]: t.task, [C.owner]: t.owner, [C.due]: t.due ?? null, [C.state]: C.todo, [C.note]: t.note ?? "" })),
    views: [
      { name: C.byOwner, type: "board", groupBy: C.owner, hide: [C.owner] },
      { name: C.progress, type: "board", groupBy: C.state, hide: [C.state] },
      { name: C.due, type: "calendar", date: C.due },
      { name: C.table, type: "table" },
    ],
  });
  const title = `${out.title ?? C.meeting} — ${C.suffix}`;
  const body: NewBlock[] = [
    b.callout(
      "🎙️",
      t("{n} to-dos from the recording on {who}'s phone ({file}).", { n: out.tasks.length, who: nm(ctx, who(pick.audio)), file: nameOf(pick.audio.rel) }) +
        (ts.private ? " " + t("🤫 Only in this teamspace ({ts}) — family members outside it can't see it.", { ts: ts.name }) : "")
    ),
    b.database(dbId),
    b.h2(t("Recording")),
    b.file(urlOf(pick.audio), nameOf(pick.audio.rel)),
    b.file(urlOf(pick.text), nameOf(pick.text.rel)),
  ];
  const pageId = await writeAgentPage({ workspaceId: ctx.workspaceId, teamspaceId: ts.id, title, icon: "✅", byUserId: ctx.askerId, blocks: body });
  return {
    pageId,
    text:
      t("Pulled {n} to-dos from the recording into a board → /p/{pageId}", { n: out.tasks.length, pageId }) +
      "\n" +
      out.tasks.map((t) => `- ${nm(ctx, t.owner)}: ${t.task}${t.due ? ` (~${t.due.slice(5).replace("-", "/")})` : ""}`).join("\n") +
      offNote(ctx),
  };
}

// ── 3. album: photos from every phone, by day, duplicates once ─────────────

const WEEKDAY_EN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const FORWARDED = new RegExp(`(${FAMILY_FILES.forwarded.join("|")})`, "i");
const TRIP_DIR = new RegExp(`(${FAMILY_FILES.tripDir.join("|")})/`, "i");
const TRIP_DOCS = new RegExp(`(${FAMILY_FILES.tripDocs.join("|")})`);

async function album(ctx: SkillContext): Promise<SkillResult> {
  const t = tOf(ctx);
  const files = await listAll(ctx);
  const images = files.filter((f) => /\.(jpe?g)$/i.test(f.rel));
  const shots: { f: Found; ex: PhotoExif; hash: string }[] = [];
  for (let i = 0; i < images.length; i += 4)
    await Promise.all(
      images.slice(i, i + 4).map(async (f) => {
        const bytes = await readBytes(f).catch(() => null);
        if (!bytes) return;
        const ex = readExif(bytes);
        if (ex.takenAt) shots.push({ f, ex, hash: createHash("sha1").update(bytes).digest("hex") });
      })
    );
  const inRegion = (r: string, x: PhotoExif) => {
    const [la0, la1, lo0, lo1] = ALBUM_REGIONS[r].box;
    return x.lat !== undefined && x.lon !== undefined && x.lat >= la0 && x.lat <= la1 && x.lon >= lo0 && x.lon <= lo1;
  };
  const asked = Object.keys(ALBUM_REGIONS).find((r) => mentions(ctx.text, r));
  // "an album of maternal grandpa's photos" — one person's phone; the longest
  // name wins (maternal grandpa over grandpa, which it contains in Korean)
  const owners = [...new Set(shots.map((x) => who(x.f)))].sort((a, b2) => b2.length - a.length);
  const person = owners.find((o) => mentions(ctx.text, o));
  let pick = asked ? shots.filter((s) => inRegion(asked, s.ex)) : shots;
  if (person) pick = pick.filter((s) => who(s.f) === person);
  if (!asked && !person) {
    // "today's trip photos" / "trip photos": the trip — the run of back-to-back days with
    // photos that holds today, or else the latest one
    const days = [...new Set(pick.map((s) => s.ex.takenAt!.slice(0, 10)))].sort();
    const runs: string[][] = [];
    for (const d of days) {
      const prev = runs[runs.length - 1];
      const gap = prev ? (Date.parse(d) - Date.parse(prev[prev.length - 1])) / 86_400_000 : Infinity;
      if (prev && gap <= 1) prev.push(d);
      else runs.push([d]);
    }
    const today = new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10); // KST
    const run = runs.find((r) => r.includes(today)) ?? runs[runs.length - 1] ?? [];
    pick = pick.filter((s) => run.includes(s.ex.takenAt!.slice(0, 10)));
  }
  if (!pick.length)
    return {
      text: asked
        ? t("I couldn't find photos taken in {region} (with date/location info) in the shared folders.", { region: regionLabel(ctx, asked) })
        : t("I couldn't find photos (with date/location info) in the shared folders."),
    };
  // name the album for where the photos were taken, when they all agree
  const region = asked ?? Object.keys(ALBUM_REGIONS).find((r) => pick.every((s) => inRegion(r, s.ex)));
  // the same photo sent around the family is one photo
  const seen = new Set<string>();
  const dupes: typeof pick = [];
  // of two copies, keep the one on the phone that took it, not one passed along
  const forwarded = (f: Found) => (FORWARDED.test(nameOf(f.rel)) ? 1 : 0);
  pick = pick
    .sort((a, b2) => a.ex.takenAt!.localeCompare(b2.ex.takenAt!) || forwarded(a.f) - forwarded(b2.f))
    .filter((s) => (seen.has(s.hash) ? (dupes.push(s), false) : (seen.add(s.hash), true)));
  const days = [...new Set(pick.map((s) => s.ex.takenAt!.slice(0, 10)))];
  const phones = [...new Set(pick.map((s) => who(s.f)))];
  const docs = files.filter((f) => TRIP_DIR.test(f.full) && TRIP_DOCS.test(f.rel));
  const ts = await teamspaceOf(pick[0].f, ctx.workspaceId);
  if (!ts) return { text: t("I couldn't find the teamspace the photos are in.") };
  const regionName = region ? regionLabel(ctx, region) : "";
  const phoneNames = phones.map((x) => nm(ctx, x)).join(" · ");
  const place = (f: Found) => nameOf(f.rel).replace(/\.[^.]+$/, "").replace(/_/g, " ");
  const body: NewBlock[] = [
    b.callout(
      "📸",
      (regionName
        ? t("{n} {region} photos from {phones}'s phones, gathered by when and where they were taken and sorted by day.", {
            n: pick.length,
            region: regionName,
            phones: phoneNames,
          })
        : t("{n} photos from {phones}'s phones, gathered by when and where they were taken and sorted by day.", { n: pick.length, phones: phoneNames })) +
        (dupes.length
          ? " " +
            (dupes.length > 1
              ? t("{n} duplicates (sent between phones) included once.", { n: dupes.length })
              : t("{n} duplicate (sent between phones) included once.", { n: dupes.length }))
          : "") +
        " " +
        t("Grandma, leave a comment!")
    ),
    ...days.flatMap((d, i) => {
      const dt = new Date(`${d}T00:00:00`);
      const daily = pick.filter((s) => s.ex.takenAt!.startsWith(d));
      return [
        b.h2(
          t("Day {n} · {weekday}, {month} {date}", {
            n: i + 1,
            // Korean takes the month number and a one-letter weekday
            weekday: (ctx.lang === "en" ? WEEKDAY_EN : WEEKDAY_KO)[dt.getDay()],
            month: ctx.lang === "en" ? MONTH_EN[dt.getMonth()] : dt.getMonth() + 1,
            date: dt.getDate(),
          })
        ),
        ...daily.map((s) =>
          b.file(
            urlOf(s.f),
            `${s.ex.takenAt!.slice(11, 16)} · ${place(s.f)} — ${t("{who}'s phone", { who: nm(ctx, who(s.f)) })}${s.ex.model ? ` (${s.ex.model})` : ""}`
          )
        ),
      ];
    }),
    ...(docs.length ? [b.h2(t("Trip plan and budget")), ...docs.map((f) => b.file(urlOf(f), `${nameOf(f.rel)} — ${who(f)}`))] : []),
  ];
  const title = person
    ? t("{name}'s photo album", { name: nm(ctx, person) })
    : t("{region} trip album", { region: regionName || t("Family") });
  const pageId = await writeAgentPage({ workspaceId: ctx.workspaceId, teamspaceId: ts.id, title, icon: "📸", byUserId: ctx.askerId, blocks: body, fullWidth: true });
  return {
    pageId,
    text:
      t("Made the {title} → /p/{pageId}", { title, pageId }) +
      "\n" +
      t("{n} photos from {phones}'s phones, over {days} days", { n: pick.length, phones: phoneNames, days: days.length }) +
      (dupes.length ? " " + t("({n} duplicate left out)", { n: dupes.length }) : "") +
      ".\n" +
      days
        .map((d, i) => `- ${t("Day {n}", { n: i + 1 })} ${d.slice(5).replace("-", "/")}: ${pick.filter((s) => s.ex.takenAt!.startsWith(d)).map((s) => place(s.f)).join(", ")}`)
        .join("\n") +
      offNote(ctx),
  };
}

// ── 4. allowance: pay a gift over x402 and open it ─────────────────────────

const NAME_SUFFIX_RE = new RegExp(`${NAME_SUFFIX}$`);

async function allowance(ctx: SkillContext): Promise<SkillResult> {
  const t = tOf(ctx);
  const rows = await db
    .select({ content: blocks.content, pageId: blocks.pageId })
    .from(blocks)
    .innerJoin(pages, eq(pages.id, blocks.pageId))
    .where(sql`${pages.workspaceId} = ${ctx.workspaceId} and ${blocks.content}->'gift' is not null`);
  const gifts = rows
    .map((r) => ({ gift: (r.content as { gift?: unknown }).gift, pageId: r.pageId }))
    .filter((g): g is { gift: GiftContent; pageId: string } => giftValid(g.gift));
  const named = gifts.filter((g) => mentions(ctx.text, g.gift.spec.recipientName.replace(NAME_SUFFIX_RE, "")));
  const target = named[0] ?? (gifts.length === 1 ? gifts[0] : undefined);
  if (!target)
    return {
      text: gifts.length
        ? t("Whose video should I open? {list}", { list: gifts.map((g) => `${g.gift.spec.recipientName} — 「${g.gift.spec.title}」`).join(", ") })
        : t("There's no pocket-money gift video yet."),
    };
  const { spec } = target.gift;
  if (spec.recipientUserId === ctx.askerId) return { text: t("You can watch your own video without paying 🙂") };
  if (unlocked(target.gift))
    return { pageId: target.pageId, text: t("「{title}」 is already open → /p/{pageId}", { title: spec.title, pageId: target.pageId }) };
  if (spec.sale)
    return {
      pageId: target.pageId,
      text: t("「{title}」 opens with {price} from your own wallet — press the button on the page and approve it in MetaMask → /p/{pageId}", {
        title: spec.title,
        price: giftPrice(spec, String),
        pageId: target.pageId,
      }),
    };
  const r = await payGift(ctx.askerId, spec.id);
  if (!r.ok) return { text: t("Couldn't send the pocket money: {error}", { error: r.error }) };
  const payerDrive = await ledgerDriveOf(ctx.askerId);
  const left = payerDrive ? await ledgerBalance(ctx.askerId, payerDrive) : null;
  const [asker] = await db.select({ name: users.displayName }).from(users).where(eq(users.id, ctx.askerId));
  return {
    pageId: target.pageId,
    text:
      t("🎁 Sent {name} ₩{krw} of pocket money ({usdc} USDC).", {
        name: nm(ctx, spec.recipientName),
        krw: spec.amountKrw.toLocaleString(numLocale(ctx)),
        usdc: formatUsdc(spec.amount),
      }) +
      " " +
      t("Paid over x402 — 「{title}」 is open → /p/{pageId}", { title: spec.title, pageId: target.pageId }) +
      "\n" +
      t("Receipt {receipt}", { receipt: r.receipt }) +
      (left !== null
        ? " · " + t("{name}'s pocket-money ledger: ₩{left} left", { name: nm(ctx, asker?.name ?? ""), left: left.toLocaleString(numLocale(ctx)) })
        : "") +
      " " +
      t("(both ledgers are in each person's aindrive 「{folder}」 folder)", { folder: familyDemo().LEDGER.out.slice(0, familyDemo().LEDGER.out.indexOf("/") + 1) }),
  };
}

/** The skill's answer — or null when the prompt skill finds the message was not a request
 *  for it after all (see matchFamilySkill); the agent then answers as it would anyway. */
export async function runFamilySkill(skill: FamilySkill, ctx: SkillContext): Promise<SkillResult | null> {
  switch (skill) {
    case "shopping":
      return shopping(ctx);
    case "todos":
      return todos(ctx);
    case "album":
      return album(ctx);
    case "allowance":
      return allowance(ctx);
    case "prompt":
      return promptSkill(ctx);
  }
}
