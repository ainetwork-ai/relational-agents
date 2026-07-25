// Inline markdown autoformat.
// Conversion commits on the trailing SPACE (same convention as the block-level
// "# " shortcuts), except :emoji: which commits on the closing colon.

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

/** Common :shortcode: emoji. */
export const EMOJI: Record<string, string> = {
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
};

type Rule = { re: RegExp; html: (m: RegExpMatchArray) => string };
const RULES: Rule[] = [
  { re: /\*\*([^*\s][^*]*?)\*\*\s$/, html: (m) => `<b>${esc(m[1])}</b>&nbsp;` },
  { re: /(?<!\*)\*([^*\s][^*]*?)\*\s$/, html: (m) => `<i>${esc(m[1])}</i>&nbsp;` },
  { re: /~~([^~\s][^~]*?)~~\s$/, html: (m) => `<s>${esc(m[1])}</s>&nbsp;` },
  { re: /`([^`\s][^`]*?)`\s$/, html: (m) => `<code>${esc(m[1])}</code>&nbsp;` },
  { re: /:([a-z0-9_+-]{2,30}):$/, html: (m) => (EMOJI[m[1]] ? esc(EMOJI[m[1]]) : "") },
 // inline equation: $E=mc^2$ commits on the closing $ (block equations use
 // the "$$ " markdown shortcut instead)
  {
    re: /\$([^$\s][^$]{0,200}?)\$$/,
    html: (m) =>
      `<span class="eq" data-tex="${esc(m[1]).replace(/"/g, "&quot;")}" contenteditable="false">$${esc(m[1])}$</span>&nbsp;`,
  },
];

/** Convert a just-completed inline pattern at the caret. Returns true when the
 * DOM was rewritten (the caller re-reads the element afterwards anyway). */
export function tryInlineAutoformat(): boolean {
  const sel = window.getSelection();
  if (!sel || !sel.isCollapsed || !sel.anchorNode) return false;
  if (sel.anchorNode.nodeType !== Node.TEXT_NODE) return false;
  const node = sel.anchorNode as Text;
 // never rewrite inside code/links/mention chips
  if (node.parentElement?.closest("code, a, .mention, .eq")) return false;
  const upto = (node.textContent ?? "").slice(0, sel.anchorOffset);
  for (const { re, html } of RULES) {
    const m = upto.match(re);
    if (!m) continue;
    const out = html(m);
    if (!out) continue;
    const range = document.createRange();
    range.setStart(node, sel.anchorOffset - m[0].length);
    range.setEnd(node, sel.anchorOffset);
    sel.removeAllRanges();
    sel.addRange(range);
    document.execCommand("insertHTML", false, out);
    return true;
  }
  return false;
}
