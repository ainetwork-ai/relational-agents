import { PROMPT_WORDS } from "@/i18n/content/agent";
import type { FetchOptions, RenderOptions, TemplateName } from "./model";

/**
 * Reading what to export and how — pure, so the check script covers it.
 *
 *  - parseRef: notion2prompt's NotionId::parse (uuid in any spelling, 32 hex, an id in a
 *    notion.so / notion.site URL — the object, never the ?v= view), plus ainmem's own
 *    `/p/<id>` links, whose id may be a uuid or an OKF id (base64url of a path).
 *  - parsePromptRequest: the options said in a sentence ("depth 2", "with child pages",
 *    "separately", "xml template", `instruction: "…"`, and their Korean) — the keyword
 *    lists live in @/i18n/content/agent.
 *  - scoreTitle: how well a page title matches what was asked for.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX32 = /^[0-9a-f]{32}$/i;

export const isUuid = (s: string) => UUID.test(s);

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

/** The first page link or id anywhere in a sentence. */
export function findRefInText(text: string): string | null {
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
  return null;
}

const re = (words: readonly string[]) => new RegExp(`(${words.join("|")})`, "i");

const ASK = new RegExp(`(${PROMPT_WORDS.ask.join("|")})`, "i");

/** Is the sentence asking for a prompt to be made (the prompt skill's trigger)? */
export function asksForPrompt(sentence: string): boolean {
  return ASK.test(sentence.replace(/\s+/g, " "));
}

export interface PromptRequest {
  fetch: Partial<FetchOptions>;
  render: Partial<RenderOptions>;
  /** "this page" (or its Korean) was said */
  thisPage: boolean;
  /** the sentence with the option phrases and skill words taken out — what names the page */
  rest: string;
}

/** The options a chat sentence asks for. Only what is said is set; the rest stay defaults. */
export function parsePromptRequest(sentence: string): PromptRequest {
  let s = ` ${sentence.replace(/\s+/g, " ")} `;
  const fetch: Partial<FetchOptions> = {};
  const render: Partial<RenderOptions> = {};
  const W = PROMPT_WORDS;
  const cut = (m: RegExpMatchArray | null) => {
    if (m) s = s.replace(m[0], " ");
  };

  // instruction first: its quoted text may contain any of the words below
  const instr = s.match(new RegExp(`(?:${W.instruction.join("|")})\\s*[:：]?\\s*["“”'「『]([^"“”'」』]+)["“”'」』]`, "i")) ??
    s.match(new RegExp(`(?:${W.instruction.join("|")})\\s*[:：]\\s*(.+?)\\s*$`, "i"));
  if (instr) {
    render.instruction = instr[1].trim();
    cut(instr);
  }
  const depth = s.match(new RegExp(`(?:${W.depth.join("|")})\\s*[:=]?\\s*(\\d+)|(\\d+)\\s*(?:${W.depthAfter.join("|")})`, "i"));
  if (depth) {
    fetch.depth = Number(depth[1] ?? depth[2]);
    cut(depth);
  }
  const limit = s.match(new RegExp(`(?:${W.limit.join("|")})\\s*[:=]?\\s*(\\d+)`, "i"));
  if (limit) {
    fetch.limit = Number(limit[1]);
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
  const merged = s.match(re(W.merged));
  if (merged) {
    render.separateChildPages = false;
    cut(merged);
  } else {
    const separate = s.match(re(W.separate));
    if (separate) {
      render.separateChildPages = true;
      cut(separate);
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
  const thisPage = re(W.thisPage).test(s);
  let rest = s.replace(/@\S+/g, " ");
  for (const w of [...W.thisPage, ...W.noise]) rest = rest.replace(new RegExp(w, "gi"), " ");
  return { fetch, render, thisPage, rest: rest.replace(/[,.;:!?，。]+/g, " ").replace(/\s+/g, " ").trim() };
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

/** Did the title answer every word the request used to name it? A word counts when
 *  the title holds it, the word with its Korean particle dropped, or (for an English
 *  word) the Korean word it stands for. */
export function coversAsked(title: string, asked: string): boolean {
  const t = norm(title);
  for (const w of tokens(asked)) {
    const alts = [w];
    for (const p of PROMPT_WORDS.particles) if (w.endsWith(p) && [...w].length > [...p].length + 1) alts.push(w.slice(0, -p.length));
    for (const [word, aliases] of Object.entries(PROMPT_WORDS.titleAliases))
      if (new RegExp(`^(?:${aliases.join("|")})$`, "i").test(w)) alts.push(word);
    if (!alts.some((a) => norm(a) && t.includes(norm(a)))) return false;
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
  if (a.includes(t)) return 1000 + t.length;
  if (t === a) return 1000 + t.length;
  const words = askedTokens(asked);
  let hits = 0;
  for (const w of tokens(title)) {
    const nw = norm(w);
    if (!nw) continue;
    if (a.includes(nw) || words.some((x) => nw.includes(norm(x)) && [...norm(x)].length >= 2)) hits++;
  }
  return hits * 10;
}
