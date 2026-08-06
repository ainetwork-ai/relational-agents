// Our chips vs the original's — the numbers in e2e/fixtures/notion-chips.json.
//
//   node e2e/chip-parity.check.mjs      # 0 = no difference, 1 = differs
//
// Read-only on our dev server (3110) and dev DB: it opens the imported Projects
// page, reads computed styles off the chips the table paints, and compares them
// with what was measured on app.notion.com. "고쳤다" means this exits 0.
import fs from "node:fs";
import { chromium } from "@playwright/test";
import { sealData } from "iron-session";
import pg from "pg";

const FIX = JSON.parse(fs.readFileSync(new URL("./fixtures/notion-chips.json", import.meta.url)));
const BASE = process.env.BASE ?? "http://localhost:3110";
const env = fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const val = (k) => env.match(new RegExp(`^${k}=(.+)$`, "m"))?.[1]?.trim();

const client = new pg.Client({ connectionString: val("POSTGRES_URL") });
await client.connect();
const { rows: users } = await client.query("select id from users where is_agent is not true limit 1");
const { rows: pages } = await client.query(
  `select p.id from pages p
     join blocks b on b.page_id = p.id and b.type = 'database'
    where p.is_archived = false
    group by p.id
    order by count(b.id) desc limit 1`
);
await client.end();
if (!users.length || !pages.length) {
  console.error("dev DB has no user or no page with a database block — nothing to compare");
  process.exit(1);
}
const cookie = await sealData({ userId: users[0].id }, { password: val("SESSION_SECRET"), ttl: 3600 });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addCookies([{ name: "rm-session", value: cookie, domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax" }]);
const page = await ctx.newPage();
await page.goto(`${BASE}/p/${pages[0].id}`, { waitUntil: "domcontentloaded", timeout: 90_000 });
await page.locator("[data-dbtable]").first().waitFor({ timeout: 90_000 });
await page.waitForTimeout(2500);

const chips = await page.evaluate(`(() => {
  const out = [];
  for (const el of document.querySelectorAll("[data-chip]")) {
    const r = el.getBoundingClientRect();
    if (!r.width) continue;
    const cs = getComputedStyle(el);
    // the label, not the dot: a status chip's first span IS the dot
    const label = Array.from(el.querySelectorAll("span")).find((x) => (x.textContent || "").trim()) ?? el;
    const ls = getComputedStyle(label);
    const dot = el.querySelector("span.rounded-full");
    out.push({
      kind: el.dataset.chip,
      text: (el.innerText || "").trim().slice(0, 28),
      height: Math.round(r.height),
      radius: cs.borderTopLeftRadius,
      padLeft: Math.round(parseFloat(cs.paddingLeft)),
      padRight: Math.round(parseFloat(cs.paddingRight)),
      fontSize: Math.round(parseFloat(ls.fontSize)),
      lineHeight: Math.round(parseFloat(ls.lineHeight)),
      fontWeight: ls.fontWeight,
      bg: cs.backgroundColor,
      text_: ls.color,
      dot: !!dot,
    });
  }
  return out;
})()`);
await browser.close();

if (!chips.length) {
  console.error("no chips painted on that page — cannot compare");
  process.exit(1);
}

const want = (kind) => (kind === "status" ? FIX.status : FIX.select);
const diffs = [];
const seen = new Set();
for (const c of chips) {
  const w = want(c.kind);
  const key = c.kind + c.bg;
  const check = (name, got, exp) => {
    if (String(got) !== String(exp)) diffs.push(`${c.kind} "${c.text}": ${name} ${got} ≠ ${exp}`);
  };
  if (!seen.has(key)) {
    seen.add(key);
    check("height", c.height, w.height);
    check("radius", c.radius, w.radius);
    check("padding-left", c.padLeft, w.paddingLeft);
    check("padding-right", c.padRight, w.paddingRight);
    check("font-size", c.fontSize, w.fontSize);
    check("line-height", c.lineHeight, w.lineHeight);
    check("font-weight", c.fontWeight, String(w.fontWeight));
    check("dot", c.dot, w.dot);
 // the colour must be one the original actually paints
    const known = Object.entries(FIX.colors).filter(([k]) => !k.startsWith("_"));
    const match = known.find(([, v]) => v.bg === c.bg);
    if (!match) diffs.push(`${c.kind} "${c.text}": background ${c.bg} is not one of the original's ${known.length} chip colours`);
    else if (match[1].text !== c.text_) diffs.push(`${c.kind} "${c.text}": ${match[0]} label ${c.text_} ≠ ${match[1].text}`);
  }
}

console.log(`compared ${chips.length} chips (${seen.size} distinct kind+colour) against the original`);
if (diffs.length) {
  console.error("\n  ┌─ 원본과 다릅니다 ──────────────────────────────");
  for (const d of diffs) console.error(`  │ ${d}`);
  console.error("  │");
  console.error("  │ 기준: e2e/fixtures/notion-chips.json (원본에서 잰 값)");
  console.error("  └───────────────────────────────────────────────\n");
  process.exit(1);
}
console.log("차이 0 — 칩의 모양·색이 원본과 같습니다.");
