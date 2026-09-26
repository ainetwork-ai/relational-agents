import { PROMPT_WORDS } from "@/i18n/content/agent";
import { LOCALES } from "@/i18n/locales";
import { translate } from "@/i18n/translate";
import type { FetchOptions, RenderOptions, TemplateName } from "./model";

/**
 * Reading what to export and how — pure, so the check scripts cover it.
 *
 *  - parseRef / findRefInText / idOf: notion2prompt's NotionId::parse (uuid in any
 *    spelling, 32 hex, an id in a notion.so / notion.site URL — the object, never the
 *    ?v= view), plus ainmem's own `/p/<id>` links, whose id may be a uuid or an OKF id
 *    (base64url of a path), and teamspace ids — in running text too, as the prompt
 *    prints them (`teamspace:<uuid>`, a bare OKF id).
 *  - promptAsk / asksForPrompt: whether a chat sentence asks to TURN a page into a prompt
 *    (chat about prompts is left to the model; a polite opening — "is it possible to …",
 *    "do you mind …" — is not a question about one).
 *  - parsePromptRequest: the options said in a sentence ("depth 2", "with child pages",
 *    "separately", "xml template", `instruction: "…"`, and their Korean) — the keyword
 *    lists live in @/i18n/content/agent.
 *  - scoreTitle / coversAsked: how well a page title matches what was asked for (an
 *    English word as a word, a Korean one inside others).
 *  - isPromptPageTitle: a prompt page the skill saved, never a title candidate.
 *  - the pending "which one?" of the family agent's prompt skill, per room and asker,
 *    and reading the answer to it (a number or number word, an ordinal, "the last one",
 *    yes, a title, or a link), and whether it was said as a pick.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX32 = /^[0-9a-f]{32}$/i;

export const isUuid = (s: string) => UUID.test(s);

/** A teamspace, exported as a page: `teamspace:<uuid>`. */
export const TEAMSPACE_PREFIX = "teamspace:";

function toUuid(hex: string): string {
  const h = hex.replace(/-/g, "").toLowerCase();
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export type Ref = { kind: "id"; id: string } | { kind: "title"; query: string };

/** An id (or a link to one) in the text, or the text as a title to look up. */
export function parseRef(input: string): Ref {
  const raw = input.trim().replace(/\/+$/, "");
  const bare = raw.replace(/^urn:uuid:/i, "").replace(/^\{(.*)\}$/, "$1");
  if (UUID.test(bare) || HEX32.test(bare)) return { kind: "id", id: toUuid(bare) };
  const app = raw.match(/\/p\/([A-Za-z0-9_-]{8,})(?:[/?#]|$)/);
  if (app) return { kind: "id", id: UUID.test(app[1]) || HEX32.test(app[1]) ? toUuid(app[1]) : app[1] };
  if (/notion/i.test(raw)) {
    const m = raw.match(/(?:[/-])([a-fA-F0-9]{32}|[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12})(?:[/?#]|$)/);
    if (m) return { kind: "id", id: toUuid(m[1]) };
  }
  return { kind: "title", query: raw };
}

/** An OKF id as okf-store writes it: base64url, unpadded, of a relative path. It must
 *  decode to text and encode back to itself — a word like "Birthday" does not. */
export function isCanonicalOkfId(s: string): boolean {
  if (!/^[A-Za-z0-9_-]{2,}$/.test(s) || UUID.test(s) || HEX32.test(s)) return false;
  const path = Buffer.from(s, "base64url").toString("utf8");
  return path.length > 0 && !/[�\u0000-\u001F]/.test(path) && Buffer.from(path, "utf8").toString("base64url") === s;
}

/**
 * The id an input names, or null when it can only be a title: a uuid in any spelling (or
 * in an ainmem / Notion link), a `teamspace:<uuid>`, or a bare OKF id — which parseRef
 * alone reads as a title (a relationship doc's id is one base64url word).
 */
export function idOf(input: string): string | null {
  const s = input.trim();
  if (s.startsWith(TEAMSPACE_PREFIX)) return isUuid(s.slice(TEAMSPACE_PREFIX.length)) ? s : null;
  const ref = parseRef(s);
  if (ref.kind === "id") return ref.id;
  return isCanonicalOkfId(s) ? s : null;
}

/** A path an OKF id could stand for, as ids are found in running text: letters of the
 *  family's scripts, digits and path punctuation, with a folder, an extension, a space or
 *  Hangul in it — an English word that happens to be base64url decodes to none of these. */
function plausibleOkfPath(path: string): boolean {
  return /^[\p{Script=Latin}\p{Script=Hangul}\p{N}\s/._\-—–·,()'&#+!:@]+$/u.test(path) && /[/.\s\p{Script=Hangul}]/u.test(path);
}

/** A bare OKF id in running text (the prompt prints one as a page's **Page ID**). */
export function isOkfIdInText(s: string): boolean {
  return s.length >= 8 && isCanonicalOkfId(s) && plausibleOkfPath(Buffer.from(s, "base64url").toString("utf8"));
}

/** The first page link or id anywhere in a sentence. */
export function findRefInText(text: string): string | null {
  // a teamspace, as the prompt prints one (Page ID `teamspace:<uuid>`) — the prefix is the id
  const ts = text.match(/(?<![\w-])teamspace:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?![\w-])/i);
  if (ts) return `${TEAMSPACE_PREFIX}${ts[1].toLowerCase()}`;
  const link = text.match(/(?:https?:\/\/\S+)?\/p\/([A-Za-z0-9_-]{8,})/);
  if (link) {
    const r = parseRef(`/p/${link[1]}`);
    if (r.kind === "id") return r.id;
  }
  const uuid = text.match(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i);
  if (uuid) return uuid[0].toLowerCase();
  const notion = text.match(/https?:\/\/[^\s]*notion\.(?:so|site)\/[^\s]+/i);
  if (notion) {
    const r = parseRef(notion[0]);
    if (r.kind === "id") return r.id;
  }
  // upstream's own spelling, and how the prompt itself prints ids (Page ID, [[hex]])
  const hex = text.match(/\b[0-9a-f]{32}\b/i);
  if (hex) return toUuid(hex[0]);
  // a bare OKF id (base64url of a relative path)
  for (const w of text.match(/(?<![A-Za-z0-9_/-])[A-Za-z0-9_-]{8,}(?![A-Za-z0-9_/-])/g) ?? []) if (isOkfIdInText(w)) return w;
  return null;
}

const W = PROMPT_WORDS;
const re = (words: readonly string[]) => new RegExp(`(${words.join("|")})`, "i");

// ── the instruction said in a sentence ─────────────────────────────────────

/** A quoted instruction: each opening quote closes with its own mark, so an apostrophe
 *  inside double quotes ("Summarize grandma's recipes") stays in the text — and in single
 *  quotes an apostrophe inside a word ('don't skip the menu') does not close them. */
const QUOTE = `"([^"]+)"|“([^”]+)”|‘((?:[^’]|’(?=\\p{L}))+)’|「([^」]+)」|『([^』]+)』|'((?:[^']|'(?=\\p{L}))+)'`;
const INSTRUCTION_KW = `(?:${W.instruction.join("|")})`;
const INSTRUCTION_QUOTED = new RegExp(`${INSTRUCTION_KW}\\s*[:：]?\\s*(?:${QUOTE})`, "iu");
const INSTRUCTION_TO_END = new RegExp(`${INSTRUCTION_KW}\\s*[:：]\\s*(.+?)\\s*$`, "i");
/** quoted text anywhere: the words of a prompt, never what it is made from */
const QUOTED = /"[^"]*"|“[^”]*”|「[^」]*」|『[^』]*』/g;

function instructionIn(s: string): { text: string; match: string } | null {
  const m = s.match(INSTRUCTION_QUOTED) ?? s.match(INSTRUCTION_TO_END);
  return m ? { text: (m.slice(1).find((x) => x) ?? "").trim(), match: m[0] } : null;
}

/** "is it possible to …", "do you mind …", "when you get a chance, …": the request itself follows */
const POLITE = new RegExp(`^(\\s*(?:@\\S+\\s+)*)(?:please\\s*,?\\s*)?(?:${PROMPT_WORDS.ask.polite.join("|")})\\s*,?\\s*`, "i");

/** One line, padded, with a polite opening taken off (it only looks like a question). */
const oneLine = (s: string) => ` ${s.replace(/\s+/g, " ").trim().replace(POLITE, "$1")} `;

// ── is it a request? ────────────────────────────────────────────────────────

const ASK = {
  always: re(W.ask.always),
  convert: re(W.ask.convert),
  from: re(W.ask.from),
  into: re(W.ask.into),
  make: re(W.ask.make),
  madeOf: re(W.ask.madeOf),
  question: re(W.ask.question),
};
const PROMPT_WORD = re(W.promptWord);
const SOURCE = re(W.source);
const THIS_PAGE = re(W.thisPage);
const DEICTIC = re(W.deictic);

/** How a chat sentence asks for a prompt made from a page. */
export interface PromptAsk {
  /**
   * The request is unmistakable: it turns something into a prompt AND says what — a page,
   * database or doc word, a link or id, "this page" — or it makes a prompt OF a page named
   * right at the prompt word ("a prompt for the Chuseok page", a link), or it names the
   * tool itself ("notion2prompt", or a bare "into a prompt, please" in Korean).
   */
  sure: boolean;
  /**
   * It asks to TURN something that exists into a prompt ("turn X into a prompt", "a prompt
   * from X", "convert X to a prompt") rather than only for "a prompt". Without `sure`, such a
   * sentence is taken only when what it names is a page title the readers see, or "this" /
   * "it" with a page open; a bare "make a prompt" only with a page open and nothing else said.
   */
  turn: boolean;
}

/**
 * Whether a chat sentence asks for a page (or database) to be made into a prompt — null
 * for chat about prompts: "what prompt did you use?", "write me a prompt for a birthday
 * card", "make the prompt shorter" (a maybe at most, see PromptAsk), and their Korean.
 */
export function promptAsk(sentence: string): PromptAsk | null {
  let s = oneLine(sentence);
  const instr = instructionIn(s);
  if (instr) s = s.replace(instr.match, " ");
  s = s.replace(QUOTED, " ");
  if (ASK.question.test(s)) return null;
  // the request's shape, as said and with the option phrases out ("…into a prompt, depth 3")
  const bare = ` ${readOptions(s).said.replace(/\s+/g, " ").trim()} `;
  const shaped = (r: RegExp) => r.test(s) || r.test(bare);
  const always = shaped(ASK.always);
  const turn = always || shaped(ASK.convert) || shaped(ASK.from) || shaped(ASK.into);
  const make = shaped(ASK.make);
  // "a prompt for the Chuseok page" said with a making verb ("write a prompt for …" is one to write)
  const madeOf = (turn || make) && shaped(ASK.madeOf);
  if (!turn && !make) return null;
  // a making verb alone is sure only of a page named at the prompt word, or of a link:
  // "make a prompt for midjourney from the photos on this page" is a prompt to WRITE
  const sure = always || findRefInText(s) !== null || madeOf || (turn && (SOURCE.test(s) || THIS_PAGE.test(s)));
  return { sure, turn };
}

/** A question about a prompt ("what prompt did you use to make this album?", and its
 *  Korean) — for the model, never a skill: not the prompt skill, and not the album skill
 *  either for the "make … album" in it. */
export function asksAboutPrompt(sentence: string): boolean {
  let s = oneLine(sentence);
  const instr = instructionIn(s);
  if (instr) s = s.replace(instr.match, " ");
  s = s.replace(QUOTED, " ");
  return ASK.question.test(s) && PROMPT_WORD.test(s);
}

/** Is the sentence unmistakably asking for a page to be made into a prompt? */
export function asksForPrompt(sentence: string): boolean {
  return promptAsk(sentence)?.sure === true;
}

// ── the options said in a sentence ─────────────────────────────────────────

export interface PromptRequest {
  fetch: Partial<FetchOptions>;
  render: Partial<RenderOptions>;
  /** the page open where it was asked: "this page", "this doc" (and their Korean) — or
   *  only "this" / "it" / "here" with nothing else naming a page */
  thisPage: boolean;
  /** the sentence with the option phrases and skill words taken out — what names the page */
  rest: string;
}

const joined = (words: readonly string[]) => `(?:\\s*(?:${words.join("|")}))*`;
const alt = (words: readonly string[]) => `(?:${words.join("|")})`;
const NUMBER_AFTER = `(?:\\s*${alt(W.numberAfter)})?`;
const DEPTH_UNIT = alt(W.depthUnit);
const DEPTH_TAIL = `(?:${alt(W.depthTail)})*`;
/**
 * "depth 2", "max depth 3", "depth of 2", "depth up to 3" — or a number of levels that says
 * it is one: "up to 3 levels", "going 3 levels deep", "…, 3 levels" (and their Korean,
 * @/i18n/content/agent depthLead / depthTail). A bare "Level 1" before a word is a title's
 * ("Level 1 supplies"), not a depth.
 */
const DEPTH = new RegExp(
  `(?:${alt(W.depthKeyLead)}\\s*)?${alt(W.depth)}${joined(W.depthJoin)}\\s*(\\d+)(?:\\s*${DEPTH_UNIT})?${NUMBER_AFTER}` +
    `|(?:${alt(W.depthLead)}\\s*)+(\\d+)\\s*${DEPTH_UNIT}${DEPTH_TAIL}` +
    `|(\\d+)\\s*${DEPTH_UNIT}(?:${alt(W.depthTail)})+` +
    `|(\\d+)\\s*${DEPTH_UNIT}(?=\\s*(?:$|[,.;!?，。]|${PROMPT_WORDS.promptWord.join("|")}))`,
  "i"
);
/** "limit 200", "limit to 200", "at most 200 items", "maximum 100 items" (and their Korean) */
const LIMIT = new RegExp(
  `${alt(W.limit)}${joined(W.limitJoin)}\\s*(\\d+)${NUMBER_AFTER}|${alt(W.limitLead)}\\s*(\\d+)\\s*${alt(W.limitUnit)}`,
  "i"
);

/** The options a chat sentence asks for. Only what is said is set; the rest stay defaults. */
export function parsePromptRequest(sentence: string): PromptRequest {
  const { fetch, render, said, explicitThis } = readOptions(oneLine(sentence));
  let rest = said.replace(/@\S+/g, " ").replace(/[,.;:!?，。？！]+/g, " ");
  for (const w of [...W.thisPage, ...W.noise]) rest = rest.replace(new RegExp(w, "gi"), " ");
  // "turn this into a prompt", "turn it into a prompt": the open page — unless something else is named
  const pointed = DEICTIC.test(rest);
  for (const w of W.deictic) rest = rest.replace(new RegExp(w, "gi"), " ");
  rest = rest.replace(/\s+/g, " ").trim();
  return { fetch, render, thisPage: explicitThis || (pointed && !rest), rest };
}

/** The option phrases of a sentence, and the sentence without them (`said`). */
function readOptions(sentence: string): { fetch: Partial<FetchOptions>; render: Partial<RenderOptions>; said: string; explicitThis: boolean } {
  let s = sentence;
  const fetch: Partial<FetchOptions> = {};
  const render: Partial<RenderOptions> = {};
  const cut = (m: RegExpMatchArray | null) => {
    if (m) s = s.replace(m[0], " ");
  };

  // instruction first: its quoted text may contain any of the words below
  const instr = instructionIn(s);
  if (instr) {
    render.instruction = instr.text;
    s = s.replace(instr.match, " ");
  }
  // before the option phrases are cut: "this page only" is still "this page"
  const explicitThis = THIS_PAGE.test(s);
  // depth before limit: Korean "depth, at most 3" uses the same word as "limit"
  const depth = s.match(DEPTH);
  if (depth) {
    fetch.depth = Number(depth.slice(1).find((x) => x !== undefined));
    cut(depth);
  }
  const limit = s.match(LIMIT);
  if (limit) {
    fetch.limit = Number(limit[1] ?? limit[2]);
    cut(limit);
  }
  const noChild = s.match(re(W.childPagesOff));
  if (noChild) {
    fetch.childPages = false;
    cut(noChild);
  } else {
    const child = s.match(re(W.childPagesOn));
    if (child) {
      fetch.childPages = true;
      cut(child);
    }
  }
  // "one file per page" is the separate layout, not "one file"
  const separate = s.match(re(W.separate));
  if (separate) {
    render.separateChildPages = true;
    cut(separate);
  } else {
    const merged = s.match(re(W.merged));
    if (merged) {
      render.separateChildPages = false;
      cut(merged);
    }
  }
  const alwaysDb = s.match(re(W.alwaysDatabases));
  if (alwaysDb) {
    fetch.alwaysFetchDatabases = true;
    cut(alwaysDb);
  }
  const noProps = s.match(re(W.propertiesOff));
  if (noProps) {
    render.includeProperties = false;
    cut(noProps);
  } else {
    const props = s.match(re(W.propertiesOn));
    if (props) {
      render.includeProperties = true;
      cut(props);
    }
  }
  const tpl: [TemplateName, readonly string[]][] = [
    ["markdown", W.templateMarkdown],
    ["default", W.templateDefault],
    ["claude-xml", W.templateXml],
  ];
  for (const [name, words] of tpl) {
    const m = s.match(re(words));
    if (m) {
      render.template = name;
      cut(m);
      break;
    }
  }
  const layout = s.match(re(W.layoutUpstream));
  if (layout) {
    render.layout = "notion2prompt";
    cut(layout);
  }
  return { fetch, render, said: s, explicitThis };
}

// ── title matching ──────────────────────────────────────────────────────────

/** "Chuseok page" → "Chuseok page" + the Korean word for Chuseok: the Korean title words
 *  an English request names, added so it matches the Korean demo's titles too. */
export function expandAliases(asked: string): string {
  const extra: string[] = [];
  for (const [word, aliases] of Object.entries(PROMPT_WORDS.titleAliases))
    if (new RegExp(`\\b(?:${aliases.join("|")})\\b`, "i").test(asked)) extra.push(word);
  return extra.length ? `${asked} ${extra.join(" ")}` : asked;
}

/** A word in Latin letters and digits only — matched as a whole word, never inside
 *  another ("use" is not in "Chuseok", "who" not in "whole"). Korean glues particles on
 *  and builds compounds, so a Korean word is matched inside others. */
const LATIN_WORD = /^[a-z0-9]+$/;
const isLatin = (w: string) => LATIN_WORD.test(w);

/** The same English word, give or take a plural "s" / "es". */
function sameWord(a: string, b: string): boolean {
  if (a === b) return true;
  const [s, l] = a.length < b.length ? [a, b] : [b, a];
  return s.length >= 3 && (l === `${s}s` || l === `${s}es`);
}

/** Every word, lowercased, punctuation dropped (one-letter words kept). */
const words = (s: string) =>
  s
    .toLowerCase()
    .split(/[\s\p{P}\p{S}]+/u)
    .filter(Boolean);

/** Does the title hold this asked word — as a word when it is English, inside the title when Korean? */
function titleHolds(title: string, word: string): boolean {
  const w = norm(word);
  if (!w) return false;
  if (isLatin(w)) return words(title).some((t) => isLatin(t) ? sameWord(t, w) : t.includes(w));
  return norm(title).includes(w);
}

/** Did the title answer every word the request used to name it? A word counts when
 *  the title holds it, the word with its Korean particle dropped, or (for an English
 *  word) the Korean word it stands for. */
export function coversAsked(title: string, asked: string): boolean {
  for (const w of tokens(asked)) {
    const alts = [w];
    for (const p of PROMPT_WORDS.particles) if (w.endsWith(p) && [...w].length > [...p].length + 1) alts.push(w.slice(0, -p.length));
    for (const [word, aliases] of Object.entries(PROMPT_WORDS.titleAliases))
      if (new RegExp(`^(?:${aliases.join("|")})$`, "i").test(w)) alts.push(word);
    if (!alts.some((a) => titleHolds(title, a))) return false;
  }
  return true;
}

/** Of the title's words, the share the request named — breaks a tie toward the title
 *  that says less beyond what was asked ("Birthday plans" over "Birthday plans meeting — to-dos"). */
export function titleCoverage(title: string, asked: string): number {
  const ws = tokens(title);
  return ws.length ? scoreTitle(title, asked) / 10 / ws.length : 0;
}

/** lowercase, no spaces or punctuation */
export const norm = (s: string) => s.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");

const tokens = (s: string) =>
  s
    .toLowerCase()
    .split(/[\s\p{P}\p{S}]+/u)
    .filter((t) => [...t].length >= 2);

/** Asked-for words, also without the particle Korean glues onto a word ("Chuseok" + object marker → "Chuseok"). */
function askedTokens(asked: string): string[] {
  const out = new Set<string>();
  for (const t of tokens(asked)) {
    out.add(t);
    for (const p of PROMPT_WORDS.particles) if (t.endsWith(p) && [...t].length > [...p].length + 1) out.add(t.slice(0, -p.length));
  }
  return [...out];
}

/**
 * How well `title` matches what was asked: 1000 + length when the whole title was said,
 * otherwise 10 per title word that was said (a word matches when the sentence contains
 * it, or it contains one of the sentence's words). 0 = no match.
 */
export function scoreTitle(title: string, asked: string): number {
  const t = norm(title);
  const a = norm(asked);
  if (!t || !a) return 0;
  if (t === a) return 1000 + t.length;
  // said whole: an English title as its run of words ("Art" is not in "party"), a Korean one anywhere
  const tw = words(title);
  if (tw.every(isLatin) ? hasRun(words(asked), tw) : a.includes(t)) return 1000 + t.length;
  const asks = askedTokens(asked);
  const aw = words(asked);
  let hits = 0;
  for (const w of tokens(title)) {
    const nw = norm(w);
    if (!nw) continue;
    const hit = isLatin(nw)
      ? aw.some((x) => (isLatin(x) ? sameWord(x, nw) : x.includes(nw)))
      : a.includes(nw) || asks.some((x) => !isLatin(norm(x)) && nw.includes(norm(x)) && [...norm(x)].length >= 2);
    if (hit) hits++;
  }
  return hits * 10;
}

/** `run` appears in `seq` as consecutive words (the last one give or take a plural). */
function hasRun(seq: string[], run: string[]): boolean {
  if (!run.length) return false;
  for (let i = 0; i + run.length <= seq.length; i++)
    if (run.every((w, j) => (j === run.length - 1 ? sameWord(seq[i + j], w) : seq[i + j] === w))) return true;
  return false;
}

// ── the prompt pages the skill saves ────────────────────────────────────────

/** "AI prompt — {title}" in every UI language, split around the title. */
const PROMPT_PAGE_TITLES = LOCALES.map((l) => translate(l, "AI prompt — {title}", { title: "\u0000" }).split("\u0000")).filter(
  (parts): parts is [string, string] => parts.length === 2 && Boolean(parts[0] || parts[1])
);

/** A page the prompt skill (or POST /api/pages/<id>/prompt) saved: "AI prompt — Chuseok".
 *  Never a candidate when a page is looked up by name — it would tie with (and, being
 *  newer and wordier, sometimes beat) the page it was made from. */
export function isPromptPageTitle(title: string): boolean {
  return PROMPT_PAGE_TITLES.some(([pre, post]) => title.length > pre.length + post.length && title.startsWith(pre) && title.endsWith(post));
}

// ── "which one?" — the question the prompt skill is waiting on ──────────────

export interface Choice {
  kind: "page" | "database";
  id: string;
  title: string;
}

export interface PendingPrompt {
  /** what the question offered, numbered as it listed them ([] after "which page?") */
  choices: Choice[];
  /** after "which page?": what a bare name may be looking for (titles the readers see) */
  pool: Choice[];
  /** the options the first request said — the answer keeps them */
  fetch: Partial<FetchOptions>;
  render: Partial<RenderOptions>;
  /** who the question was asked for — an answer read for other people starts afresh */
  readers: string[];
  expires: number;
}

/** How long a "which one?" waits for its answer. */
export const PENDING_PROMPT_MS = 10 * 60_000;

// per process, like the rest of the room state held in memory; survives dev reloads
const PENDING_KEY = Symbol.for("app.prompt-export.pending");
function pendingStore(): Map<string, PendingPrompt> {
  const g = globalThis as unknown as Record<symbol, Map<string, PendingPrompt>>;
  return (g[PENDING_KEY] ??= new Map());
}
const pendingKey = (roomId: string, askerId: string) => `${roomId}\u0000${askerId}`;

/** The skill asked this person a question in this room; their next word may answer it. */
export function rememberPendingPrompt(roomId: string, askerId: string, p: Omit<PendingPrompt, "expires">, now = Date.now()): void {
  const store = pendingStore();
  for (const [k, v] of store) if (v.expires <= now) store.delete(k);
  store.set(pendingKey(roomId, askerId), { ...p, expires: now + PENDING_PROMPT_MS });
}

/** The question waiting on this person here, if any (left in place). */
export function pendingPrompt(roomId: string, askerId: string, now = Date.now()): PendingPrompt | null {
  const store = pendingStore();
  const k = pendingKey(roomId, askerId);
  const p = store.get(k);
  if (!p) return null;
  if (p.expires <= now) {
    store.delete(k);
    return null;
  }
  return p;
}

/** Take the question off the table (it was answered, or the person moved on). */
export function forgetPendingPrompt(roomId: string, askerId: string): void {
  pendingStore().delete(pendingKey(roomId, askerId));
}

/** Same people, in any order. */
export const sameReaders = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && [...a].sort().join("\u0000") === [...b].sort().join("\u0000");

/** What a reply to "which one?" picked: one of the offered choices by index, a
 *  narrower set of them, (after "which page?") a name to look up — or a link or id pasted
 *  in, as both questions invite. */
export type PendingAnswer = { index: number } | { narrowed: Choice[] } | { query: string } | { id: string };

const C = PROMPT_WORDS.choice;
const TRAILING = `(?:${C.trailing.join("|")})?`;
const NUMBER = new RegExp(`^(?:(?:${C.numberBefore.join("|")})\\s*)?(\\d{1,2})\\s*(?:${C.numberAfter.join("|")})?${TRAILING}$`, "i");
const ORDINALS = C.ordinals.map((ws) => new RegExp(`^(?:${ws.join("|")})${TRAILING}$`, "i"));
const LAST = new RegExp(`^(?:${C.last.join("|")})${TRAILING}$`, "i");
const YES = new RegExp(`^(?:${C.yes.join("|")})(?:\\s+(?:${C.yes.join("|")}))*$`, "i");
// a word by itself, or with the ending a Korean answer glues on
const CARDINALS = C.cardinals.map((ws) => new RegExp(`(?<![\\p{L}\\p{N}])(?:${ws.join("|")})(?=${TRAILING}(?![\\p{L}\\p{N}]))`, "giu"));
const PICK = new RegExp(`(?:${C.pickMarkers.join("|")})`, "i");

/** The part of a reply that answers: options, skill words and fillers taken out. */
function answerText(reply: string): string {
  let r = parsePromptRequest(reply).rest;
  for (const w of C.filler) r = r.replace(new RegExp(w, "gi"), " ");
  return r.replace(/\s+/g, " ").trim();
}

/** "number three", "three" (and the Korean words) → "number 3", "3" */
const withDigits = (reply: string) => CARDINALS.reduce((s, r, i) => s.replace(r, String(i + 1)), reply);

/** The reply as "yes" is said: lower case, no @mention, punctuation or apostrophes. */
const plainReply = (reply: string) =>
  reply
    .toLowerCase()
    .replace(/@\S+/g, " ")
    .replace(/['’]/g, "")
    .replace(/[,.;:!?~。，！？]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Does `reply` answer the pending question — and with what? null: it is about something else. */
export function answerPending(p: PendingPrompt, reply: string): PendingAnswer | null {
  // "…or paste the page's link": a link or id answers either question
  const ref = findRefInText(reply);
  if (ref) return { id: ref };
  const r = answerText(reply);
  if (!r) return null;
  const { choices } = p;
  if (choices.length) {
    const n = r.match(NUMBER) ?? answerText(withDigits(reply)).match(NUMBER);
    if (n) {
      const i = Number(n[1]) - 1;
      return i >= 0 && i < choices.length ? { index: i } : null;
    }
    const o = ORDINALS.findIndex((x) => x.test(r));
    if (o >= 0) return o < choices.length ? { index: o } : null;
    if (LAST.test(r)) return { index: choices.length - 1 };
    if (choices.length === 1 && YES.test(plainReply(reply))) return { index: 0 };
    const hit = pickByTitle(choices, r);
    if (!hit.length) return null;
    return hit.length === 1 ? { index: choices.indexOf(hit[0]) } : { narrowed: hit };
  }
  // "which page?" — a name, when it names something the readers can see
  if (!tokens(r).length) return null;
  const asked = expandAliases(r);
  return p.pool.some((c) => scoreTitle(c.title, asked) >= 1000 || coversAsked(c.title, r)) ? { query: r } : null;
}

/** Of the offered titles, the ones a reply names: the whole title said (the longest
 *  such), else every title that holds each word of the reply. */
function pickByTitle(choices: Choice[], r: string): Choice[] {
  // a one-syllable "yes" to three choices names none of them (coversAsked holds for no words at all)
  if (!tokens(r).length) return [];
  const asked = expandAliases(r);
  const whole = choices.filter((c) => scoreTitle(c.title, asked) >= 1000);
  if (whole.length) {
    const longest = Math.max(...whole.map((c) => norm(c.title).length));
    const best = whole.filter((c) => norm(c.title).length === longest);
    if (best.length === 1) return best;
  }
  return choices.filter((c) => coversAsked(c.title, r));
}

/** Whether this person's message answers the question the skill asked them here. A
 *  question lasts one turn: anything else they say to the agent takes it off the table. */
export function answersPendingPrompt(roomId: string, askerId: string, text: string): boolean {
  const p = pendingPrompt(roomId, askerId);
  if (!p) return false;
  if (answerPending(p, text)) return true;
  forgetPendingPrompt(roomId, askerId);
  return false;
}

/** Is an answer to "which one?" said as a pick ("the album one", "make it from the Chuseok
 *  album", and the Korean in PROMPT_WORDS.choice.pickMarkers) — the prompt skill's even
 *  with another skill's words in it? */
export function saidAsPick(text: string): boolean {
  return PICK.test(text.replace(/@\S+/g, " "));
}
