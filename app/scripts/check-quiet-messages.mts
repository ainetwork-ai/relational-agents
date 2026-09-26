/**
 * A route that reads chat messages for a person leaves out other people's quiet ones.
 *
 * The failure it guards against: a member asks the treasurer something quietly
 * (privateToUserId), and a route that reads chat_messages without the filter
 * shows that exchange to everyone else. The room list did: its last-message
 * preview and unread count put one member's quiet answer in every member's
 * sidebar.
 *
 * The rule: in a file under src/app/api, every `.from(chatMessages)` is matched
 * by a `visibleTo(` (lib/chat-room-access.ts), or the file reads through
 * `visibleRoomMessages(`.
 *
 *   pnpm check:quiet
 *
 * A route that reads messages nobody is shown, or where nothing can be quiet,
 * opts out with a one-line reason:
 *
 *   // quiet:exempt — agent rooms are one person's; nothing in them is quiet
 *
 * What it cannot see: which query a `visibleTo(` belongs to (it counts them),
 * or a library function outside src/app/api that hands messages to a route.
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../src/app/api");

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return walk(p);
    return e.isFile() && p.endsWith(".ts") ? [p] : [];
  });
}

const count = (src: string, needle: string) => src.split(needle).length - 1;

const files = walk(ROOT);
const offenders: { file: string; reads: number; filtered: number }[] = [];
for (const file of files) {
  const src = fs.readFileSync(file, "utf8");
  const reads = count(src, ".from(chatMessages)");
  if (reads === 0 || src.includes("quiet:exempt")) continue;
  const filtered = count(src, "visibleTo(");
  if (filtered >= reads) continue;
  offenders.push({ file: path.relative(path.resolve(ROOT, "../../.."), file), reads, filtered });
}

if (offenders.length) {
  console.error("\n  ┌─ A route reads chat messages without leaving out quiet ones ──");
  for (const o of offenders) console.error(`  │ ${o.file}: ${o.reads} read(s) of chatMessages, ${o.filtered} visibleTo()`);
  console.error("  │");
  console.error("  │ Add visibleTo(userId) to each query's where(), or read through visibleRoomMessages().");
  console.error("  │ Without it, one member's quiet exchange with the agent shows up for everyone else.");
  console.error("  └──────────────────────────────────────────────────────────────\n");
  process.exit(1);
}
console.log(`Every read of chat messages under src/app/api leaves out quiet ones (${files.length} files checked)`);
