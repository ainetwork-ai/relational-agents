// Does the emoji layer behave? Covers what an e2e spec cannot reach cheaply:
// catalogue coverage, search ranking, shortcode precedence, skin-tone
// derivation across all 330 tone-capable emoji, and the pre-load fallbacks.
//
//   npm run emoji:check
//
// Exits non-zero on the first mismatch, so it can gate a regeneration.
// The picker/editor side is covered by e2e/EMOJI-01-picker.spec.ts.
import {
  MAX_SHORTCODE_LENGTH,
  applySkinTone,
  countEmojiMatches,
  emojiCategories,
  emojiLabel,
  emojiSetReady,
  isRenderable,
  loadEmojiSet,
  randomEmoji,
  searchEmoji,
  searchShortcodes,
  shortcodeFor,
  supportsSkinTone,
} from "@/lib/emoji-data";
import { initial, firstGlyphs, isEmojiGlyph } from "@/lib/glyph";

let failures = 0;
function check(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures++;
  console.log(`${ok ? "✓" : "✗"} ${name}${ok ? "" : `\n    got  ${JSON.stringify(got)}\n    want ${JSON.stringify(want)}`}`);
}

// ── before the catalogue loads ──────────────────────────────────────────────
check("not ready initially", emojiSetReady(), false);
check("no categories yet", emojiCategories(), []);
check("no search yet", searchEmoji("cat"), []);
check("legacy :tada: still resolves", shortcodeFor("tada"), "🎉");
check("legacy suggestions still offered", searchShortcodes("tad")[0], ["tada", "🎉"]);
check("unknown code misses", shortcodeFor("melting_face"), undefined);
check("random emoji has a fallback", randomEmoji(), "😀");
check("no prototype leak before load", shortcodeFor("constructor"), undefined);

check("load", await loadEmojiSet(), true);
check("ready after load", emojiSetReady(), true);

// ── coverage ────────────────────────────────────────────────────────────────
const EMOJI_CATEGORIES = emojiCategories();
const ALL_EMOJIS = EMOJI_CATEGORIES.flatMap((c) => c.emojis.map((e) => e.emoji));
check("categories", EMOJI_CATEGORIES.length, 9);
check("total emoji", ALL_EMOJIS.length, 1914);
check("no duplicates", new Set(ALL_EMOJIS).size, 1914);
check("every row parsed", EMOJI_CATEGORIES.every((c) => c.emojis.every((e) => e.emoji && e.label && e.terms)), true);
console.log("  per category:", EMOJI_CATEGORIES.map((c) => `${c.name} ${c.emojis.length}`).join(", "));

// emoji that the old 340-entry set could not reach
for (const [emoji, label] of [
  ["🫠", "melting face"],
  ["🇰🇷", "flag: South Korea"],
  ["🧑‍🚒", "firefighter"],
  ["🐈‍⬛", "black cat"],
  ["🪅", "piñata"],
  ["🫶", "heart hands"],
  ["🏳️‍⚧️", "transgender flag"],
] as const) {
  check(`reachable ${emoji}`, emojiLabel(emoji), label);
}

// ── search ──────────────────────────────────────────────────────────────────
check("search 'cat' first hit", searchEmoji("cat")[0].emoji, "🐱");
check("search no substring noise", searchEmoji("cat").some((e) => e.emoji === "🛗"), false);
check("search 'korea'", searchEmoji("korea").map((e) => e.emoji).slice(0, 2).sort(), ["🇰🇵", "🇰🇷"]);
check("search multi-token", searchEmoji("red heart")[0].emoji, "❤️");
check("search accent fold", searchEmoji("pinata")[0].emoji, "🪅");
check("search 'grin' exact word first", searchEmoji("grinning")[0].emoji, "😀");
check("search caps", searchEmoji("PIZZA")[0].emoji, "🍕");
check("search empty", searchEmoji(""), []);
check("search miss", searchEmoji("zzzzzz"), []);
check("search capped", searchEmoji("a").length <= 240, true);
console.log(`  'a' matches ${countEmojiMatches("a")}, shown ${searchEmoji("a").length}`);

// ── shortcodes ──────────────────────────────────────────────────────────────
check("shortcodes resolve", [":tada:", ":kr:"].every((c) => shortcodeFor(c.slice(1, -1))), true);
check("max length", MAX_SHORTCODE_LENGTH, 40);
check(":tada:", shortcodeFor("tada"), "🎉");
check(":kr:", shortcodeFor("kr"), "🇰🇷");
check(":melting_face:", shortcodeFor("melting_face"), "🫠");
check("legacy :calendar: kept", shortcodeFor("calendar"), "📅");
check("legacy :moon: kept", shortcodeFor("moon"), "🌙");
check("legacy :check: kept", shortcodeFor("check"), "✅");
check("legacy :+1: kept", shortcodeFor("+1"), "👍");
check("no prototype leak", shortcodeFor("constructor"), undefined);
check("suggest 'tad'", searchShortcodes("tad")[0], ["tada", "🎉"]);
check("suggest shortest first", searchShortcodes("hear")[0][0].length <= searchShortcodes("hear")[1][0].length, true);

// ── canonical form matches what the app already stores ──────────────────────
for (const [emoji, name] of [
  ["👍", "thumbs up"],
  ["⭐", "star"],
  ["❤️", "red heart"],
  ["✈️", "airplane"],
  ["💡", "light bulb"],
  ["⚙️", "gear"],
] as const) {
  check(`canonical ${name}`, ALL_EMOJIS.includes(emoji), true);
}

// ── skin tones ──────────────────────────────────────────────────────────────
check("tone on hand", applySkinTone("👋", 3), "👋🏽");
check("tone on ZWJ profession", applySkinTone("🧑‍💻", 3), "🧑🏽‍💻");
check("tone drops FE0F", applySkinTone("✋", 5), "✋🏿");
check("tone on 🖐️", applySkinTone("🖐️", 1), "🖐🏻");
check("tone override (holding hands)", applySkinTone("🧑‍🤝‍🧑", 4), "🧑🏾‍🤝‍🧑🏾");
check("tone re-applied not doubled", applySkinTone(applySkinTone("👋", 2), 5), "👋🏿");
check("tone 0 is identity", applySkinTone("👋", 0), "👋");
check("tone 0 strips", applySkinTone("👋🏽", 0), "👋");
check("no tone on 🎃", applySkinTone("🎃", 3), "🎃");
check("no tone on family", applySkinTone("👪", 3), "👪");
check("supportsSkinTone 👋", supportsSkinTone("👋"), true);
check("supportsSkinTone 🍕", supportsSkinTone("🍕"), false);
check("toned emoji keeps its label", emojiLabel(applySkinTone("👋", 2)), "waving hand");
// every tone-capable emoji round-trips through all five tones
let toneMismatch = 0;
for (const emoji of ALL_EMOJIS.filter(supportsSkinTone)) {
  for (let t = 1; t <= 5; t++) {
    const toned = applySkinTone(emoji, t);
    if (toned === emoji || !emojiLabel(toned)) toneMismatch++;
  }
}
check("all tone variants distinct + labelled", toneMismatch, 0);

// ── font gate (no canvas here → everything offered) ─────────────────────────
check("SSR offers new emoji", isRenderable("🫩"), true);
check("SSR offers old emoji", isRenderable("😀"), true);

// ── graphemes ───────────────────────────────────────────────────────────────
check("isEmojiGlyph ZWJ", isEmojiGlyph("🧑‍💻"), true);
check("isEmojiGlyph flag", isEmojiGlyph("🇰🇷"), true);
check("isEmojiGlyph letter", isEmojiGlyph("A"), false);
check("initial keeps whole emoji", initial("💞 team"), "💞");
check("initial keeps ZWJ emoji", initial("🧑‍💻 dev"), "🧑‍💻");
check("initial letter", initial("ainmem"), "A");
check("initial fallback", initial(""), "?");
check("firstGlyphs 2 of emoji name", firstGlyphs("🧑‍💻🎉 notes", 2), "🧑‍💻🎉");
check("firstGlyphs letters", firstGlyphs("Memory Lab", 2), "Me");
check("firstGlyphs flag", firstGlyphs("🇰🇷 팀", 1), "🇰🇷");

console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
