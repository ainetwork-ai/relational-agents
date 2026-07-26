// Every relationship is different, so the agent is configurable per room: the
// profile decides the sections, the vocabulary and which rules apply, and the
// fields under it override that profile for this room alone.
//
// Drives the real settings dialog and then checks the document, because the
// point of the form is what it does to the record — not that it saves.
//
//   CALL_ROOM_ID=<room with an agent> OKF_DOC="<doc folder>" \
//   [BASE_URL=…] [MEMBER=vc-alice] node e2e/agent-settings.check.mjs

import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.BASE_URL ?? "http://localhost:36625";
const ROOM = process.env.CALL_ROOM_ID;
const MEMBER = process.env.MEMBER ?? "vc-alice";
const ROOT = process.env.OKF_ROOT ?? "/mnt/newdata/git/notion/memory-data/content";
const DOC = process.env.OKF_DOC;
if (!ROOM || !DOC) {
  console.error("CALL_ROOM_ID and OKF_DOC are required");
  process.exit(2);
}

let failed = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};
// Body minus its H1: the heading is the section's label and a profile switch is
// supposed to change it. Everything below it is the writing, which must not
// change no matter what the profile is called.
const bodyOf = (file) => {
  const p = path.join(ROOT, DOC, file);
  if (!fs.existsSync(p)) return "";
  const body = fs.readFileSync(p, "utf8").split("---").slice(2).join("---").trim();
  return body.replace(/^#\s.*\n?/, "").trim();
};
const titleOf = (file) => {
  const p = path.join(ROOT, DOC, file);
  if (!fs.existsSync(p)) return null;
  return (fs.readFileSync(p, "utf8").match(/^title:\s*(.+)$/m) ?? [])[1]?.trim() ?? null;
};
const config = async (ctx) => {
  const { agents } = await (await ctx.request.get(`${BASE}/api/dm/rooms/${ROOM}/agent`)).json();
  return agents[0]?.agentConfig ?? {};
};

const browser = await chromium.launch();
const ctx = await browser.newContext();
await ctx.request.post(`${BASE}/api/auth/demo-login`, { data: { as: MEMBER } });
// start from a known profile: this check flips back and forth, and a previous
// run that ended mid-flight would otherwise decide what "restored" means
await ctx.request.patch(`${BASE}/api/dm/rooms/${ROOM}/agent`, { data: { profile: "romantic" } });
// Titles are what a profile switch is supposed to change; the writing under
// them is what it must never touch. Asserting only titles let a run that
// emptied every section pass 12/12.
const SECTIONS = ["Timeline.md", "Decisions.md", "Overview.md", "People notes.md", "Open topics.md"];
const bodiesBefore = Object.fromEntries(SECTIONS.map((f) => [f, bodyOf(f)]));
const page = await ctx.newPage();
await page.goto(`${BASE}/dm/${ROOM}`);

// --- switch to Business through the dialog ----------------------------------
await page.getByTestId("dm-agent-settings").click();
await page.getByTestId("agent-settings").waitFor();
await page.getByTestId("profile-business").waitFor();
check("both profiles are offered", (await page.getByTestId(/^profile-/).count()) >= 2);
await page.getByTestId("profile-business").click();
await page.getByTestId("agent-settings-save").click();
await page.getByTestId("agent-settings").waitFor({ state: "detached", timeout: 10_000 });

check("profile stored", (await config(ctx)).profile === "business");

await page.waitForTimeout(500);

check("timeline relabelled", titleOf("Timeline.md") === "Meeting log", `${titleOf("Timeline.md")}`);
check("decisions relabelled", titleOf("Decisions.md") === "Agreements", `${titleOf("Decisions.md")}`);
check("new section created", titleOf("Action items.md") === "Action items");
check("no file was moved", fs.existsSync(path.join(ROOT, DOC, "Timeline.md")));

// --- overrides ---------------------------------------------------------------
await page.getByTestId("dm-agent-settings").click();
await page.getByTestId("agent-settings").waitFor();
await page.getByTestId("profile-business").waitFor();
await page.locator("#agent-extra").fill("Always put anything we promise into Action items.");
await page.locator("#agent-tone").selectOption("formal");
await page.getByTestId("agent-settings-save").click();
await page.getByTestId("agent-settings").waitFor({ state: "detached", timeout: 10_000 });

const saved = await config(ctx);
check("extra instructions kept", (saved.systemPrompt ?? "").includes("Action items"));
check("tone override kept", saved.persona?.tone === "formal", `${saved.persona?.tone}`);

// --- back to Romantic --------------------------------------------------------
await page.getByTestId("dm-agent-settings").click();
await page.getByTestId("agent-settings").waitFor();
await page.getByTestId("profile-romantic").waitFor();
await page.getByTestId("profile-romantic").click();
await page.getByTestId("agent-settings-save").click();
await page.getByTestId("agent-settings").waitFor({ state: "detached", timeout: 10_000 });
await page.waitForTimeout(500);

check("timeline restored", titleOf("Timeline.md") === "Timeline", `${titleOf("Timeline.md")}`);
check("decisions restored", titleOf("Decisions.md") === "Decisions", `${titleOf("Decisions.md")}`);
check("the other profile's section survives", titleOf("Action items.md") === "Action items");
const index = fs.readFileSync(path.join(ROOT, DOC, "index.md"), "utf8");
check("and stays reachable from the index", index.includes("[Action items]"));

for (const f of SECTIONS) {
  const before = bodiesBefore[f];
  if (!before) continue; // nothing was in it to lose
  const now = bodyOf(f);
  check(
    `${f} 내용 보존`,
    now.includes(before),
    `${before.length}B → ${now.length}B`
  );
}

await browser.close();
console.log(failed ? `\n${failed} FAILED` : "\n전부 통과");
process.exit(failed ? 1 : 0);
