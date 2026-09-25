// One-off cleanup: remove the memories that came from 📞 call bubbles.
//
// A call posts "📞 Video Call" and "📞 Video Call ended · 4:12" into the chat
// as ordinary messages, and until the pipeline learned to skip them the write
// path recorded each one as a fact — "had a video call", "had a video call
// lasting 36 seconds". They carry no content: the metadata is already in the
// chat bubble, and what was actually said now lives in the call recap.
//
// The pipeline appends only, so the agent cannot remove these itself.
//
//   node scripts/strip-call-bubble-lines.mjs [--write]
//
// Default is a dry run: it prints what it would remove and touches nothing.

import fs from "node:fs";
import path from "node:path";

const ROOT = process.env.OKF_ROOT ?? "/mnt/newdata/git/notion/memory-data/content";
const WRITE = process.argv.includes("--write");

// Only the bare "they had a call" sentences. A recap callout ("> 📞 …") says
// what the call was about and must survive, so the pattern requires the
// content-free shape and never matches a quote line.
// The whole line has to be the bare fact — "…had a video call", optionally
// with its duration. A trailing `.*` once made this match sentences that go on
// to say something ("…had a video call with her parents and she cried"), and
// those are memories, not bubbles.
const BUBBLE_LINE =
  /^-?\s*(\d{4}-\d{2}-\d{2}:\s*)?.{0,80}?\bhad (a|another) video call\b( lasting [^.]{1,40})?\.?\s*$/i;

function isSources(block) {
  return /^Sources:/i.test(block.trim());
}

let totalRemoved = 0;
const touched = [];

for (const dir of fs.readdirSync(ROOT)) {
  const file = path.join(ROOT, dir, "Timeline.md");
  if (!fs.existsSync(file)) continue;

  const original = fs.readFileSync(file, "utf8");
  // paragraphs, so a removed line takes its provenance with it
  const blocks = original.split(/\n\n/);
  const kept = [];
  const removed = [];

  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.split("\n").length === 1 && BUBBLE_LINE.test(b.trim()) && !b.trim().startsWith(">")) {
      removed.push(b.trim());
      // its Sources paragraph(s) follow immediately — and duplicates of the
      // same anchor do occur, so consume the whole run
      while (i + 1 < blocks.length && isSources(blocks[i + 1])) {
        removed.push(blocks[i + 1].trim());
        i++;
      }
      continue;
    }
    kept.push(b);
  }

  if (!removed.length) continue;
  const out = kept.join("\n\n").replace(/\n{3,}/g, "\n\n");
  const lines = removed.filter((r) => !isSources(r)).length;
  totalRemoved += lines;
  touched.push({ dir, lines, sources: removed.length - lines });

  console.log(`\n── ${dir}`);
  for (const r of removed) console.log(`   − ${r.slice(0, 110)}`);
  if (WRITE) fs.writeFileSync(file, out);
}

console.log(
  `\n${WRITE ? "제거함" : "제거 예정"}: ${totalRemoved}줄 (+ 딸린 Sources), 파일 ${touched.length}개`
);
if (!WRITE) console.log("실제로 지우려면 --write");
