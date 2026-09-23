/** The emoji set behind every picker, the `:shortcode:` shorthand and the `:`
 * autocomplete — the whole RGI catalogue (~1.9k emoji), not a hand-picked few.
 *
 * The rows are generated into ./emoji-data.generated.ts by
 * scripts/gen-emoji-data.mts; this module owns the behaviour layered on top:
 * ranked search, skin tones, and skipping emoji the platform font cannot draw.
 *
 * The catalogue is ~60 KB gzipped, which is no use to someone reading a page, so
 * it is imported on demand: the picker asks for it when it opens and the editor
 * when a ":" is typed. Everything here works before it arrives — pickers show a
 * spinner for a frame, and the shortcodes people actually type by hand are in
 * LEGACY_SHORTCODES, which is always resident. Fetching it is a same-origin
 * chunk load, so the CSP that blocks CDNs is not in the way. */

import type * as EmojiTables from "./emoji-data.generated";

export interface EmojiEntry {
  emoji: string;
  /** CLDR name — the tooltip and the accessible name */
  label: string;
  /** lowercased label words + keywords, space separated */
  terms: string;
}

export interface EmojiCategory {
  name: string;
  icon: string;
  emojis: EmojiEntry[];
}

/** Spellings this app shipped before the generated set arrived. They stay as
 * overrides because a few of them disagree with GitHub — `:calendar:` was 📅
 * here and 📆 there, `:moon:` was 🌙 and not 🌔 — and silently remapping
 * shorthand people already type would rewrite their muscle memory. Being
 * resident, they also keep `:tada:` working before the catalogue loads. */
const LEGACY_SHORTCODES = new Map<string, string>(Object.entries({
  smile: "😄", grin: "😁", joy: "😂", wink: "😉", blush: "😊", heart: "❤️",
  broken_heart: "💔", thumbsup: "👍", "+1": "👍", thumbsdown: "👎", "-1": "👎",
  clap: "👏", pray: "🙏", muscle: "💪", wave: "👋", eyes: "👀", thinking: "🤔",
  tada: "🎉", fire: "🔥", rocket: "🚀", star: "⭐", sparkles: "✨", zap: "⚡",
  bulb: "💡", check: "✅", white_check_mark: "✅", x: "❌", warning: "⚠️",
  question: "❓", exclamation: "❗", memo: "📝", book: "📖",
  calendar: "📅", clock: "🕐", pin: "📌", pushpin: "📌", link: "🔗",
  lock: "🔒", key: "🔑", gear: "⚙️", bug: "🐛", coffee: "☕", pizza: "🍕",
  dog: "🐶", cat: "🐱", sun: "☀️", moon: "🌙", rain: "🌧️", snow: "❄️",
  smiley: "😃", laughing: "😆", cry: "😢", sob: "😭", angry: "😠",
  sunglasses: "😎", raised_hands: "🙌", ok_hand: "👌", point_right: "👉",
  "100": "💯", boom: "💥", bell: "🔔", gift: "🎁", trophy: "🏆",
}));

/** Longest shortcode the generator is allowed to emit — it fails the build
 * rather than quietly shipping one the autoformat rule would truncate. */
export const MAX_SHORTCODE_LENGTH = 40;

/** The five Fitzpatrick modifiers; index + 1 is the tone number used below. */
export const SKIN_TONES = ["\u{1F3FB}", "\u{1F3FC}", "\u{1F3FD}", "\u{1F3FE}", "\u{1F3FF}"];

const MODIFIER_BASE = /\p{Emoji_Modifier_Base}/u;
const VARIATION_SELECTOR = "\u{FE0F}";

// ── loading ─────────────────────────────────────────────────────────────────

interface IndexEntry extends EmojiEntry {
  /** label words first, then CLDR keywords — position doubles as relevance */
  words: string[];
}

interface EmojiSet {
  categories: EmojiCategory[];
  all: string[];
  index: IndexEntry[];
  labels: Map<string, string>;
  shortcodes: Map<string, string>;
  /** every shortcode, shortest first — the order suggestions are offered in */
  byLength: [string, string][];
  toneCapable: Set<string>;
  /** tone-capable bases keyed by their selector-free spelling, so a toned emoji
   * can be traced back to its base (🖐🏻 → 🖐️, whose U+FE0F the tone displaced) */
  toneBases: Map<string, string>;
  toneOverrides: Map<string, string>;
  recent: Set<string>;
  drawable: Map<string, EmojiEntry[]>;
  undrawable: Set<string> | null;
}

let set: EmojiSet | null = null;
let loading: Promise<EmojiSet> | null = null;

/** Packed blocks are newline-separated and start with the template literal's
 * own newline, so drop the blank edges. */
function rows(packed: string): string[] {
  return packed ? packed.trim().split("\n") : [];
}

function build(tables: typeof EmojiTables): EmojiSet {
  const categories: EmojiCategory[] = tables.PACKED_CATEGORIES.map((cat) => ({
    name: cat.name,
    icon: cat.icon,
    emojis: rows(cat.packed).map((line) => {
      const [emoji, label, terms] = line.split("\t");
      return { emoji, label, terms };
    }),
  }));
  const index = categories.flatMap((c) =>
    c.emojis.map((e) => ({ ...e, words: e.terms.split(" ") }))
  );

  const shortcodes = new Map<string, string>();
  for (const line of rows(tables.PACKED_SHORTCODES)) {
    const tab = line.indexOf("\t");
    shortcodes.set(line.slice(0, tab), line.slice(tab + 1));
  }
  for (const [code, emoji] of LEGACY_SHORTCODES) shortcodes.set(code, emoji);

  const toneCapable = new Set(rows(tables.PACKED_TONE_CAPABLE));
  const built: EmojiSet = {
    categories,
    all: index.map((e) => e.emoji),
    index,
    labels: new Map(),
    shortcodes,
    byLength: [...shortcodes].sort(([a], [b]) => a.length - b.length || (a < b ? -1 : 1)),
    toneCapable,
    toneBases: new Map(
      [...toneCapable].map((base) => [base.replaceAll(VARIATION_SELECTOR, ""), base])
    ),
    toneOverrides: new Map(
      rows(tables.PACKED_TONE_OVERRIDES).map((line) => {
        const [emoji, tone, variant] = line.split("\t");
        return [`${emoji}\t${tone}`, variant];
      })
    ),
    recent: new Set(rows(tables.PACKED_RECENT)),
    drawable: new Map(),
    undrawable: null,
  };

  // names for every emoji and every one of its toned variants, so a picked 👋🏽
  // still reads as "waving hand"
  set = built; // applySkinTone below needs the tables in place
  for (const entry of index) {
    built.labels.set(entry.emoji, entry.label);
    if (!toneCapable.has(entry.emoji)) continue;
    for (let tone = 1; tone <= SKIN_TONES.length; tone++) {
      built.labels.set(applySkinTone(entry.emoji, tone), entry.label);
    }
  }
  return built;
}

/** Pull in the catalogue. Safe to call repeatedly — one fetch, one parse.
 * Resolves false if the chunk could not be fetched, and lets the next call try
 * again rather than leaving a picker spinning forever. */
export function loadEmojiSet(): Promise<boolean> {
  loading ??= import("./emoji-data.generated")
    .then(build)
    .catch((err) => {
      loading = null;
      throw err;
    });
  return loading.then(
    () => true,
    () => false
  );
}

/** True once the catalogue is in memory. Before that, search comes up empty and
 * only the legacy shortcodes resolve. */
export function emojiSetReady(): boolean {
  return set !== null;
}

// ── categories ──────────────────────────────────────────────────────────────

/** The picker's tabs, or [] until the catalogue lands. */
export function emojiCategories(): EmojiCategory[] {
  return set?.categories ?? [];
}

/** CLDR name for an emoji, tone variants included. Undefined for image icons
 * and anything off the set. */
export function emojiLabel(emoji: string): string | undefined {
  return set?.labels.get(emoji);
}

/** A random emoji the platform can draw — the picker's shuffle button. */
export function randomEmoji(): string {
  const all = set?.all;
  if (!all?.length) return "😀";
  for (let i = 0; i < 20; i++) {
    const emoji = all[Math.floor(Math.random() * all.length)];
    if (isRenderable(emoji)) return emoji;
  }
  return "😀";
}

// ── search ──────────────────────────────────────────────────────────────────

/** Rank of `token` within one emoji's words, lower being better; `null` when it
 * does not match at all. A whole-word hit beats a prefix, and an earlier word
 * beats a later one — which puts label matches ahead of keyword matches without
 * having to carry the label separately. */
function tokenRank(words: string[], token: string): number | null {
  let best: number | null = null;
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    if (word === token) return i;
    if (best === null && word.startsWith(token)) best = 1000 + i;
  }
  return best;
}

function tokenize(query: string): string[] {
  return query.toLowerCase().trim().split(/\s+/).filter(Boolean);
}

/** Emoji matching every whitespace-separated token in `query`, best first.
 * Matching is per word rather than raw substring, so "cat" no longer drags in
 * "escalator". Results are capped: a bare "a" otherwise renders 1.9k buttons. */
export function searchEmoji(query: string, limit = 240): EmojiEntry[] {
  const tokens = tokenize(query);
  if (!set || !tokens.length) return [];
  const hits: { entry: IndexEntry; score: number }[] = [];
  for (const entry of set.index) {
    let score = 0;
    for (const token of tokens) {
      const rank = tokenRank(entry.words, token);
      if (rank === null) {
        score = -1;
        break;
      }
      score += rank;
    }
    if (score >= 0 && isRenderable(entry.emoji)) hits.push({ entry, score });
  }
  // on a tie the shorter name wins — "cat" should reach 🐱 "cat face" before
  // 😹 "cat with tears of joy" — and equal names stay in Unicode order
  hits.sort((a, b) => a.score - b.score || a.entry.label.length - b.entry.label.length);
  const ranked: EmojiEntry[] = hits.map(({ entry }) => entry);
  // typing an emoji's own shorthand should land on it: "cat" means 🐱 (`:cat:`),
  // whatever the name-based ranking makes of the rest
  const exact = tokens.length === 1 ? shortcodeFor(tokens[0]) : undefined;
  const at = exact ? ranked.findIndex((e) => e.emoji === exact) : -1;
  if (at > 0) ranked.unshift(...ranked.splice(at, 1));
  return ranked.slice(0, limit);
}

/** How many emoji `query` matches in total, so the UI can say a cap was hit. */
export function countEmojiMatches(query: string): number {
  const tokens = tokenize(query);
  if (!set || !tokens.length) return 0;
  let n = 0;
  for (const entry of set.index) {
    if (tokens.every((t) => tokenRank(entry.words, t) !== null) && isRenderable(entry.emoji)) n++;
  }
  return n;
}

// ── shortcodes ──────────────────────────────────────────────────────────────

/** Emoji for a `:code:`, or undefined. Falls back to the resident legacy list
 * while the catalogue is still loading. Lookups go through a Map, never an
 * object: `:constructor:` is a legal-looking shortcode and has to miss. */
export function shortcodeFor(code: string): string | undefined {
  return set?.shortcodes.get(code) ?? LEGACY_SHORTCODES.get(code);
}

/** Shortcodes starting with `prefix`, shortest first — the shortest spelling is
 * almost always the one being typed. One entry per emoji. */
export function searchShortcodes(prefix: string, limit = 12): [string, string][] {
  if (!prefix) return [];
  const all =
    set?.byLength ??
    [...LEGACY_SHORTCODES].sort(([a], [b]) => a.length - b.length || (a < b ? -1 : 1));
  const out: [string, string][] = [];
  const seen = new Set<string>();
  for (const [code, emoji] of all) {
    if (out.length >= limit) break;
    if (!code.startsWith(prefix) || seen.has(emoji) || !isRenderable(emoji)) continue;
    seen.add(emoji);
    out.push([code, emoji]);
  }
  return out;
}

// ── skin tones ──────────────────────────────────────────────────────────────

/** The un-toned base of an emoji, or null when it takes no tone at all. */
function toneBase(emoji: string): string | null {
  if (!set) return null;
  if (set.toneCapable.has(emoji)) return emoji;
  const bare = [...emoji].filter((cp) => !SKIN_TONES.includes(cp)).join("");
  return set.toneCapable.has(bare) ? bare : set.toneBases.get(bare) ?? null;
}

/** Does this emoji have skin-tone variants? Answered from upstream's variant
 * list rather than guessed, so 🧑‍💻 and 🫱‍🫲 count while 🎃 and 👪 do not. */
export function supportsSkinTone(emoji: string): boolean {
  return toneBase(emoji) !== null;
}

/** Re-tone an emoji. `tone` is 0 (default/yellow) through 5 (darkest).
 *
 * The modifier repeats after every code point that accepts one, which is what
 * makes multi-person and profession sequences work (🧑‍💻 → 🧑🏽‍💻, not 🧑‍💻🏽);
 * a tone also implies emoji presentation, so a U+FE0F right after the base drops
 * out (✋️ → ✋🏽). The generator checks this rule against upstream's own variants
 * and emits overrides for the handful it cannot derive. */
export function applySkinTone(emoji: string, tone: number): string {
  // re-tone from the base, so re-applying over an already-toned 👋🏼 lands on
  // 👋🏿 rather than doing nothing, and tone 0 returns the default yellow
  const base = toneBase(emoji);
  if (base === null) return emoji;
  const modifier = tone ? SKIN_TONES[tone - 1] : undefined;
  if (!modifier) return base;
  const override = set?.toneOverrides.get(`${base}\t${tone}`);
  if (override) return override;
  const out: string[] = [];
  let justToned = false;
  for (const cp of base) {
    if (SKIN_TONES.includes(cp)) continue; // drop the tone already applied
    if (cp === VARIATION_SELECTOR && justToned) continue;
    out.push(cp);
    justToned = MODIFIER_BASE.test(cp);
    if (justToned) out.push(modifier);
  }
  return out.join("");
}

// ── font support ────────────────────────────────────────────────────────────

/** Emoji new enough that shipped fonts often lack them get measured against the
 * real font. Anything older is assumed drawable — checking all 1.9k would trade
 * a real cost for a hypothetical one. */
function undrawableRecent(): Set<string> {
  if (!set) return new Set();
  if (set.undrawable) return set.undrawable;
  const missing = new Set<string>();
  set.undrawable = missing;
  if (typeof document === "undefined") return missing; // SSR: offer everything
  try {
    const ctx = document.createElement("canvas").getContext("2d");
    if (!ctx) return missing;
    ctx.font = "32px sans-serif";
    // 😀 has been in every emoji font since 2012; U+10FFFF is permanently
    // unassigned, so it can only ever draw as the notdef box
    const known = ctx.measureText("\u{1F600}").width;
    const notdef = ctx.measureText("\u{10FFFF}").width;
    if (!known || known === notdef) return missing; // can't tell them apart
    for (const emoji of set.recent) {
      const width = ctx.measureText(emoji).width;
      // a font missing the glyph draws either that box, or — for a ZWJ sequence
      // it cannot join — the parts side by side, which is visibly wider
      if (width === notdef || width > known * 1.25) missing.add(emoji);
    }
  } catch {
    // no canvas (or a hardened one): fall through and offer everything
  }
  return missing;
}

/** Can this platform actually draw the emoji? Keeps tofu boxes and half-joined
 * sequences out of the picker instead of letting someone save one as a page
 * icon that nobody else can read. */
export function isRenderable(emoji: string): boolean {
  if (!set?.recent.has(emoji)) return true;
  return !undrawableRecent().has(emoji);
}

/** Category rows with unsupported emoji dropped. Memoised per category, since
 * the picker re-reads this on every keystroke and category switch. */
export function drawableEmojis(category: EmojiCategory): EmojiEntry[] {
  const cached = set?.drawable.get(category.name);
  if (cached) return cached;
  const list = category.emojis.filter((e) => isRenderable(e.emoji));
  set?.drawable.set(category.name, list);
  return list;
}
