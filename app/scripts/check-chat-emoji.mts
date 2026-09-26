/**
 * The chat and treasury surfaces draw their icons from lucide-react, and the
 * agent's words in the chat carry no emoji.
 *
 * The failure it guards against: emoji used as UI — 🌍 on a World ID button,
 * 🔁 before "Recurring buy", ✅/⛔ leading the agent's messages — which reads
 * as generated rather than designed, renders differently per platform, and
 * doubles what an icon or the notice's own tone already says.
 *
 * The rule: no emoji on a code line in the files below. Text people wrote is
 * not code and is not checked; data that is an emoji by nature (a page's icon,
 * the hearts in a doc title) says so on its line:
 *
 *   "🛒", // emoji:data — the callout's icon on the page the agent writes
 *
 *   pnpm check:chat-emoji
 *
 * What it does not cover: the rest of the app (the editor's callouts and page
 * icons are Notion-style emoji by design), and call records, whose "📞 " prefix
 * is how a stored message is recognised as a call (app/api/calls).
 */
import fs from "node:fs";
import path from "node:path";

const APP = path.resolve(import.meta.dirname, "..");
const SCOPE = [
  "src/app/(app)/dm",
  "src/components/dm",
  "src/components/room-chat",
  "src/components/chat",
  "src/components/a2ui",
  "src/components/treasury",
  "src/components/treasury-app",
  "src/components/treasurer",
  "src/lib/agent/treasury",
  "src/lib/agent/treasurer",
  "src/lib/agent/respond.ts",
  "src/lib/agent/spend.ts",
  "src/lib/agent/family-skills.ts",
  "src/app/api/auth/world/connect",
];
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{2300}-\u{23FF}]/u;
const COMMENT = /^\s*(\/\/|\*|\/\*|\{\/\*)/;

function files(rel: string): string[] {
  const p = path.join(APP, rel);
  if (!fs.existsSync(p)) return [];
  if (fs.statSync(p).isFile()) return [p];
  return fs.readdirSync(p, { withFileTypes: true }).flatMap((e) => files(path.join(rel, e.name)));
}

const checked = SCOPE.flatMap(files).filter((f) => /\.(ts|tsx)$/.test(f));
const offenders: string[] = [];
for (const file of checked) {
  fs.readFileSync(file, "utf8")
    .split("\n")
    .forEach((line, i) => {
      if (COMMENT.test(line) || !EMOJI.test(line) || line.includes("emoji:data")) return;
      offenders.push(`${path.relative(APP, file)}:${i + 1}: ${line.trim().slice(0, 100)}`);
    });
}

if (offenders.length) {
  console.error("\n  ┌─ Emoji on the chat / treasury surfaces ──");
  for (const o of offenders) console.error(`  │ ${o}`);
  console.error("  │");
  console.error("  │ Draw it with a lucide-react icon (the card renderer: an Icon part or a Chip's `icon`),");
  console.error("  │ or drop it from the agent's words. Data that is an emoji by nature: `// emoji:data — why` on the line.");
  console.error("  └──────────────────────────────────────────\n");
  process.exit(1);
}
console.log(`No emoji on the chat / treasury surfaces (${checked.length} files checked)`);
