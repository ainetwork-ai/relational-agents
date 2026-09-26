// Comments collapse when there are many — how many stay expanded?
//
// The rule from opening and counting the 18 commented rows one by one in the original's All Projects view:
// up to 3 all show; from 4 on only **the first and the last** stay and the rest
// fold into one `Show N more replies` line (N = total − 2). Saw 1·2·3·4·5·8·9·11 all.
//
//   [BASE_URL=…] [ROW_PAGE_ID=…] [USER_ID=…] node e2e/comment-collapse.check.mjs
//
// This script inserts comments into the dev DB and removes them — dev only.

import fs from "node:fs";
import { sealData } from "iron-session";
import { chromium } from "@playwright/test";
import { Client } from "pg";
import { content } from "./i18n.mjs";

const BASE = process.env.BASE_URL ?? "http://localhost:3110";
const PAGE_ID = process.env.ROW_PAGE_ID ?? "27b5c5e5-467c-4620-bde7-8d087e8a9875";
const USER_ID = process.env.USER_ID ?? "8ccf17a7-24fb-4ae9-974c-94bf5db0cf85";

const F = JSON.parse(fs.readFileSync(new URL("../src/i18n/content/e2e-fixtures/notion-row-comments.json", import.meta.url), "utf8"));
const G = F.collapse;
const B = content.COMMENT_COLLAPSE.bodyPrefix;
const env = fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const secret = env.match(/^SESSION_SECRET=(.*)$/m)?.[1].trim() || "dev-secret-change-in-production-32ch";
const cookie = await sealData({ userId: USER_ID }, { password: secret, ttl: 0 });
const pgUrl = env.match(/^POSTGRES_URL=(.*)$/m)[1].trim();

const pg = new Client({ connectionString: pgUrl });
await pg.connect();
const { rows: existing } = await pg.query("select count(*)::int n from comments where page_id=$1", [PAGE_ID]);
if (existing[0].n) {
  console.error(`\n  ${PAGE_ID} already has ${existing[0].n} comments — give an empty page (ROW_PAGE_ID).\n`);
  await pg.end();
  process.exit(1);
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
await ctx.addCookies([{ name: "rm-session", value: cookie, domain: new URL(BASE).hostname, path: "/" }]);
const page = await ctx.newPage();
page.on("pageerror", (e) => console.error("  page error:", String(e).slice(0, 200)));

const d = [];
let seeded = 0;
for (const want of G.observed) {
 // Fill only as many as this step needs
  for (let i = seeded; i < want.total; i++) {
    await pg.query(
      "insert into comments (page_id, block_id, parent_id, author_id, body) values ($1,null,null,$2,$3)",
      [PAGE_ID, USER_ID, `${B}${i + 1}`]
    );
    seeded++;
  }
  process.stdout.write(`  ${want.total} … `);
  await page.goto(`${BASE}/p/${PAGE_ID}`, { waitUntil: "domcontentloaded", timeout: 180_000 });
  await page.waitForSelector("[data-testid='page-comment-section']", { timeout: 60_000 });
  await page.waitForTimeout(1400);

  const got = await page.evaluate(() => {
    const sec = document.querySelector("[data-testid='page-comment-section']");
    const rows = [...sec.querySelectorAll("div[data-testid^='comment-row-']")];
    const more = sec.querySelector("[data-testid='comment-show-more']");
    return {
      rendered: rows.length,
      moreText: more ? more.innerText.trim() : null,
      bodies: rows.map((r) => r.querySelector("p")?.innerText.trim() ?? ""),
    };
  });

  console.log(`rendered ${got.rendered}, show-more ${JSON.stringify(got.moreText)}`);
  const label = `${want.total} comments`;
  if (got.rendered !== want.rendered)
    d.push(`${label}: rendered count ours ${got.rendered} / Notion ${want.rendered}`);
  const wantLabel = want.hidden ? G.label.replace("{n}", String(want.hidden)) : null;
  if (got.moreText !== wantLabel)
    d.push(`${label}: show-more line ours ${JSON.stringify(got.moreText)} / Notion ${JSON.stringify(wantLabel)}`);
 // When collapsed it must be the first and the last — not the middle two
  if (want.hidden) {
    const first = `${B}1`, last = `${B}${want.total}`;
    if (got.bodies[0] !== first || got.bodies[got.bodies.length - 1] !== last)
      d.push(`${label}: what remains is ${JSON.stringify(got.bodies)} — should be the first ("${first}") and the last ("${last}")`);
  }
}

 // Does expanding work in the last state (the largest count)?
const top = G.observed[G.observed.length - 1];
await page.click("[data-testid='comment-show-more']");
await page.waitForTimeout(600);
const afterExpand = await page.evaluate(() => ({
  rendered: document.querySelectorAll("div[data-testid^='comment-row-']").length,
  more: !!document.querySelector("[data-testid='comment-show-more']"),
}));
if (afterExpand.rendered !== top.total)
  d.push(`${afterExpand.rendered} after expanding — should be ${top.total}`);
if (afterExpand.more) d.push("The show-more line remains after expanding — the original removes it");

await browser.close();
await pg.query("delete from comments where page_id=$1 and author_id=$2", [PAGE_ID, USER_ID]);
await pg.end();

if (d.length) {
  console.error("\n  ┌─ Comment collapsing differs from the original ───────────────");
  for (const l of d) console.error(`  │ ${l}`);
  console.error("  │");
  console.error("  │ Reference: src/i18n/content/e2e-fixtures/notion-row-comments.json (collapse)");
  console.error("  └──────────────────────────────────────────────────────────\n");
  process.exit(1);
}
console.log(
  `Collapse rule matches the original — ${G.observed.map((o) => `${o.total}→${o.rendered}`).join(" · ")}, ${top.total} when expanded`
);
