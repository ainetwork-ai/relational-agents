// Regenerates src/lib/emoji-data.generated.ts from emojibase-data.
//
//   npm run emoji:gen
//
// The picker used to carry ~340 hand-picked emoji, so most of Unicode was
// simply unreachable. Generating instead means the whole RGI set (every emoji
// a platform font can draw), its CLDR keywords, and every GitHub/Slack-style
// shortcode come from one upstream dataset — and a Unicode bump is a dependency
// bump plus a re-run rather than hand-typing hundreds of rows.
//
// The dataset is a devDependency: nothing fetches it at runtime (the CSP blocks
// CDNs) and nothing fetches it at build time either.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import emojis from "emojibase-data/en/data.json" with { type: "json" };
import emojibaseShortcodes from "emojibase-data/en/shortcodes/emojibase.json" with { type: "json" };
import githubShortcodes from "emojibase-data/en/shortcodes/github.json" with { type: "json" };
import pkg from "emojibase-data/package.json" with { type: "json" };

type Skin = { emoji: string; text: string; tone?: number | number[]; version: number };
type Emoji = {
  label: string;
  hexcode: string;
  tags?: string[];
  emoji: string;
  text: string;
  type: number;
  order?: number;
  group?: number;
  subgroup?: number;
  version: number;
  skins?: Skin[];
};

const OUT = fileURLToPath(new URL("../src/lib/emoji-data.generated.ts", import.meta.url));

/** Display categories, in picker order, each fed by one Unicode group.
 * Names/icons match what the picker showed before so the tab strip is stable. */
const CATEGORIES: { name: string; icon: string; group: number }[] = [
  { name: "Smileys", icon: "😀", group: 0 }, // smileys-emotion
  { name: "People", icon: "👋", group: 1 }, // people-body
  { name: "Nature", icon: "🌿", group: 3 }, // animals-nature
  { name: "Food", icon: "🍕", group: 4 }, // food-drink
  { name: "Activities", icon: "⚽", group: 6 }, // activities
  { name: "Travel", icon: "✈️", group: 5 }, // travel-places
  { name: "Objects", icon: "💻", group: 7 }, // objects
  { name: "Symbols", icon: "💯", group: 8 }, // symbols
  { name: "Flags", icon: "🏳️", group: 9 }, // flags
];

/** Emoji introduced this recently are missing from plenty of shipped fonts, so
 * the client re-checks them against the actual font before offering them. */
const RECENT_SINCE = 15.1;

const SKIN_TONES = ["\u{1F3FB}", "\u{1F3FC}", "\u{1F3FD}", "\u{1F3FE}", "\u{1F3FF}"];
const MODIFIER_BASE = /\p{Emoji_Modifier_Base}/u;
const VARIATION_SELECTOR = "\u{FE0F}";

/** Same rule the client applies: drop any tone already present, then repeat the
 * modifier after every base that accepts one (👋→👋🏽, 🧑‍💻→🧑🏽‍💻, 🫱‍🫲→🫱🏽‍🫲🏽).
 * A tone already forces emoji presentation, so the U+FE0F that would have
 * followed the base drops out (✋️→✋🏽, not ✋️🏽). */
function applyTone(emoji: string, tone: string): string {
  const out: string[] = [];
  let justToned = false;
  for (const cp of emoji) {
    if (SKIN_TONES.includes(cp)) continue;
    if (cp === VARIATION_SELECTOR && justToned) continue;
    out.push(cp);
    justToned = MODIFIER_BASE.test(cp);
    if (justToned) out.push(tone);
  }
  return out.join("");
}

/** Upstream spells every emoji "fully qualified" by appending U+FE0F even where
 * the code point already defaults to emoji presentation — "👍️" rather than the
 * "👍" that emoji-test.txt, every keyboard, and this app's stored page icons use.
 * Dropping the redundant selector keeps picked emoji byte-identical to what is
 * already in the database, so equality checks and round-trips still hold.
 * The selector is kept where it is load-bearing (✈️, ❤️‍🔥, 🖐️). */
const REDUNDANT_SELECTOR = /(\p{Emoji_Presentation})\u{FE0F}/gu;
function canonical(emoji: string): string {
  return emoji.replace(REDUNDANT_SELECTOR, "$1");
}

/** Search text: the CLDR label plus its keywords, punctuation flattened to
 * spaces, deduped. Accented labels also get an ASCII fold so "cote" finds
 * "flag: Côte d’Ivoire". */
function searchTerms(e: Emoji): string {
  const words = new Set<string>();
  for (const raw of [e.label, ...(e.tags ?? [])]) {
    for (const variant of [raw, raw.normalize("NFD").replace(/\p{M}/gu, "")]) {
      for (const word of variant.toLowerCase().split(/[^\p{L}\p{N}+]+/u)) {
        if (word) words.add(word);
      }
    }
  }
  return [...words].join(" ");
}

const all = emojis as Emoji[];
/** group 2 is "component" — lone skin tones and hair colors, not pickable.
 * Entries with no group at all are regional indicator letters. */
const pickable = all.filter((e) => e.group !== undefined && e.group !== 2);
const byGroup = new Map<number, Emoji[]>();
for (const e of pickable) {
  const list = byGroup.get(e.group!) ?? [];
  list.push(e);
  byGroup.set(e.group!, list);
}

// ── categories ──────────────────────────────────────────────────────────────
const packedCategories = CATEGORIES.map((cat) => {
  const list = (byGroup.get(cat.group) ?? []).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  if (!list.length) throw new Error(`no emoji for group ${cat.group} (${cat.name})`);
  const lines = list.map((e) => {
    const terms = searchTerms(e);
    // the CLDR label doubles as the button's tooltip and accessible name — at
    // this size nobody can tell 🫠 from 🫤 by sight alone
    const label = e.label.replace(/\s+/g, " ").trim();
    if (/[\t\n`]|\$\{/.test(e.emoji + label + terms)) {
      throw new Error(`unsafe characters in row for ${e.hexcode}`);
    }
    return `${canonical(e.emoji)}\t${label}\t${terms}`;
  });
  return { ...cat, packed: lines.join("\n"), count: list.length };
});

// ── skin tones ──────────────────────────────────────────────────────────────
// Upstream lists the exact tone variants, so use them to decide *which* emoji
// accept a tone, and to prove the client's insertion rule reproduces them.
const toneCapable: string[] = [];
const toneOverrides: [string, string][] = [];
for (const e of pickable) {
  const uniform = new Map<number, string>();
  for (const skin of e.skins ?? []) {
    const tones = Array.isArray(skin.tone) ? skin.tone : [skin.tone];
    if (!tones.length || tones.some((t) => t === undefined || t !== tones[0])) continue;
    uniform.set(tones[0]!, canonical(skin.emoji));
  }
  if (uniform.size === 0) continue;
  const base = canonical(e.emoji);
  toneCapable.push(base);
  for (const [tone, expected] of uniform) {
    const got = applyTone(base, SKIN_TONES[tone - 1]);
    if (got !== expected) toneOverrides.push([`${base}\t${tone}`, expected]);
  }
}
if (toneOverrides.length) {
  console.warn(`⚠ ${toneOverrides.length} tone variants need an override:`);
  for (const [key, expected] of toneOverrides.slice(0, 10)) {
    console.warn(`   ${key.replace("\t", " tone ")} → ${expected}`);
  }
}

// ── shortcodes ──────────────────────────────────────────────────────────────
// `:tada:` habits come from GitHub and Slack, so take both lists. emojibase's
// own list is the superset of aliases; GitHub's wins a tie because that spelling
// is the one people type. Codes are keyed by hexcode, including tone variants we
// do not carry — resolve against the pickable set only.
const emojiByHexcode = new Map(pickable.map((e) => [e.hexcode, e]));
const shortcodes = new Map<string, { emoji: string; order: number }>();
/** Mirrors MAX_SHORTCODE_LENGTH in lib/emoji-data — the autoformat rule builds
 * its regex from that constant, so a longer code could never be typed. */
const MAX_CODE_LENGTH = 40;
/** The shape the `:code:` rule accepts. Anything else is unreachable by typing. */
const CODE_RE = new RegExp(`^[a-z0-9_+-]{2,${MAX_CODE_LENGTH}}$`);
const skipped: string[] = [];
function addShortcodes(source: Record<string, string | string[]>, override: boolean) {
  for (const [hexcode, value] of Object.entries(source)) {
    const target = emojiByHexcode.get(hexcode);
    if (!target) continue;
    for (const code of Array.isArray(value) ? value : [value]) {
      if (!CODE_RE.test(code)) {
        skipped.push(code);
        continue;
      }
      const prev = shortcodes.get(code);
      // first spelling wins, except that GitHub outranks the generic list; when
      // two emoji claim one code, the earlier one in Unicode order keeps it
      if (prev && !override && prev.order <= (target.order ?? 0)) continue;
      shortcodes.set(code, { emoji: canonical(target.emoji), order: target.order ?? 0 });
    }
  }
}
addShortcodes(emojibaseShortcodes as Record<string, string | string[]>, false);
addShortcodes(githubShortcodes as Record<string, string | string[]>, true);
const packedShortcodes = [...shortcodes]
  .sort(([a], [b]) => (a < b ? -1 : 1))
  .map(([code, { emoji }]) => `${code}\t${emoji}`)
  .join("\n");
if (skipped.length) {
  // say which spellings are unreachable rather than dropping them quietly
  const unique = [...new Set(skipped)];
  console.warn(
    `⚠ ${unique.length} shortcodes skipped (not typeable as :code:): ${unique.slice(0, 8).join(", ")}${unique.length > 8 ? " …" : ""}`
  );
}

// ── font-support suspects ───────────────────────────────────────────────────
const recent = pickable.filter((e) => e.version >= RECENT_SINCE).map((e) => canonical(e.emoji));

// ── emit ────────────────────────────────────────────────────────────────────
const total = packedCategories.reduce((n, c) => n + c.count, 0);
const header = `// GENERATED by scripts/gen-emoji-data.mts — do not edit by hand.
// Source: emojibase-data@${pkg.version} (Unicode ${Math.floor(Math.max(...pickable.map((e) => e.version)))}).
// ${total} emoji, ${shortcodes.size} shortcodes, ${toneCapable.length} tone-capable, ${recent.length} recent.
//
// Rows are packed as newline-separated "<emoji>\\t<label>\\t<search terms>" instead of
// object literals: same data, a fraction of the bytes to ship and parse.
`;

const body = `
export const EMOJIBASE_VERSION = ${JSON.stringify(pkg.version)};

/** Emoji introduced in Unicode ${RECENT_SINCE} or later — see RECENT_EMOJI. */
export const RECENT_SINCE = ${RECENT_SINCE};

export const PACKED_CATEGORIES: { name: string; icon: string; packed: string }[] = [
${packedCategories
  .map(
    (c) => `  {
    name: ${JSON.stringify(c.name)},
    icon: ${JSON.stringify(c.icon)},
    // ${c.count} emoji
    packed: \`
${c.packed}\`,
  },`
  )
  .join("\n")}
];

/** Shortcodes for the \`:code:\` shorthand, as "<code>\\t<emoji>" rows. */
export const PACKED_SHORTCODES = \`
${packedShortcodes}\`;

/** Emoji that accept a skin-tone modifier (per upstream's own variant list). */
export const PACKED_TONE_CAPABLE = \`
${toneCapable.join("\n")}\`;

/** Newest emoji, which shipped fonts often lack; the client verifies these
 * render before offering them. */
export const PACKED_RECENT = \`
${recent.join("\n")}\`;
${
  toneOverrides.length
    ? `
/** Tone variants the insertion rule cannot derive: "<emoji>\\t<tone>" → variant. */
export const PACKED_TONE_OVERRIDES = \`
${toneOverrides.map(([k, v]) => `${k}\t${v}`).join("\n")}\`;
`
    : `
/** Every tone variant is derivable by the insertion rule. */
export const PACKED_TONE_OVERRIDES = "";
`
}`;

writeFileSync(OUT, header + body, "utf8");
console.log(
  `wrote ${OUT}\n  ${total} emoji in ${packedCategories.length} categories` +
    `\n  ${shortcodes.size} shortcodes, ${toneCapable.length} tone-capable, ${recent.length} recent` +
    `\n  ${(Buffer.byteLength(header + body) / 1024).toFixed(0)} KB`
);
