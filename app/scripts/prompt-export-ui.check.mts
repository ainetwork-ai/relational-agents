// Prompt export — the two places a person reaches it from the UI.
//
//   npx tsx --tsconfig scripts/tsconfig.json scripts/prompt-export-ui.check.mts
//
// 1. A saved prompt page is one long code block. Its Copy button floats over the
//    block on hover; a touch screen has no hover, so there it must be shown anyway,
//    be a 36px target, and not sit on the first line of the prompt. Checked on the
//    CSS the real class names compile to (Tailwind + globals.css), evaluated for a
//    device with (hover: none) and one with (hover: hover), at rest.
// 2. The assistant panel's "Turn this page into an AI prompt." stays reachable once
//    the (reused) assistant room has history, and what it sends in either language
//    is read by the prompt skill as "this page".
import fs from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { compile } from "tailwindcss";
import { CODE_BOX_CLASS, CODE_COPY_CLASS, CODE_TOOLBAR_CLASS } from "@/components/editor/block-row";
import { CHIP_CLASS, PAGE_SUGGESTION, SuggestionChips, pageIdOf, suggestionsFor } from "@/components/assistant/assistant-dock";
import { asksForPrompt, findRefInText, parsePromptRequest } from "@/lib/prompt-export/input";
import { makeT } from "@/i18n/translate";

let fails = 0;
let passes = 0;
const show = (s: unknown) => JSON.stringify(s);
function eq(name: string, got: unknown, want: unknown) {
  if (show(got) === show(want)) {
    passes++;
    return;
  }
  fails++;
  console.log(`✗ ${name}\n    want ${show(want)}\n    got  ${show(got)}`);
}
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) passes++;
  else {
    fails++;
    console.log(`✗ ${name}${detail ? `  (${detail})` : ""}`);
  }
}

// ── the CSS the class names compile to ──────────────────────────────────────
const app = path.resolve(import.meta.dirname, "..");
const globalsPath = path.join(app, "src/app/globals.css");
async function loadStylesheet(id: string, base: string) {
  const file = id === "tailwindcss" ? path.join(app, "node_modules/tailwindcss/index.css") : path.resolve(base, id);
  return { path: file, base: path.dirname(file), content: fs.readFileSync(file, "utf8") };
}
const compiler = await compile(fs.readFileSync(globalsPath, "utf8"), { base: path.dirname(globalsPath), loadStylesheet });
const classesOf = (s: string) => s.split(/\s+/).filter(Boolean);
const css = compiler.build([CODE_BOX_CLASS, CODE_TOOLBAR_CLASS, CODE_COPY_CLASS, CHIP_CLASS].flatMap(classesOf));

interface Decl {
  ctx: string[];
  prop: string;
  value: string;
  important: boolean;
  order: number;
}
/** Declarations with the stack of selectors / at-rules around each (Tailwind emits nested CSS). */
function declarations(src: string): Decl[] {
  const out: Decl[] = [];
  const stack: string[] = [];
  let buf = "";
  let quote: string | null = null;
  const text = src.replace(/\/\*[\s\S]*?\*\//g, "");
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      buf += c;
      if (c === "\\") buf += text[++i] ?? "";
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      buf += c;
    } else if (c === "\\") {
      buf += c + (text[++i] ?? "");
    } else if (c === "{") {
      stack.push(buf.trim());
      buf = "";
    } else if (c === "}" || c === ";") {
      const d = buf.trim();
      buf = "";
      const m = d.match(/^([a-z-]+)\s*:\s*([\s\S]+)$/i);
      if (m && stack.length) {
        const important = /!important\s*$/.test(m[2]);
        out.push({ ctx: [...stack], prop: m[1].toLowerCase(), value: m[2].replace(/!important\s*$/, "").trim(), important, order: out.length });
      }
      if (c === "}") stack.pop();
    } else buf += c;
  }
  return out;
}
const DECLS = declarations(css);
const LAYERS = ["theme", "base", "components", "utilities"];

/** The value each property ends up with on an element carrying `classes`, at rest
 *  (no hover, focus or disabled state), light theme, on a device whose primary
 *  pointer does or does not hover. Width queries are not assumed either way. */
function computed(classes: string, hover: "none" | "hover"): Record<string, string> {
  const have = new Set(classesOf(classes));
  const win = new Map<string, { rank: number; order: number; value: string }>();
  for (const d of DECLS) {
    let cls: string | null = null;
    let layer = -1;
    let applies = true;
    for (const p of d.ctx) {
      if (p.startsWith("@layer")) layer = LAYERS.indexOf(p.slice(6).trim());
      else if (p.startsWith("@supports")) continue;
      else if (p.startsWith("@media")) {
        const q = p.slice(6).replace(/\s+/g, "");
        if (q === "(hover:none)") applies &&= hover === "none";
        else if (q === "(hover:hover)") applies &&= hover === "hover";
        else applies = false;
      } else if (p.startsWith("@")) applies = false;
      else if (p.startsWith("&")) applies = false; // :hover, :focus-within, group-hover, .dark, :disabled …
      else if (cls === null && /^\.(?:\\.|[A-Za-z0-9_-])+$/.test(p)) cls = p.slice(1).replace(/\\(.)/g, "$1");
      else applies = false; // any other selector is not about these class lists
    }
    if (!applies || cls === null || !have.has(cls)) continue;
    // cascade: important layered > important unlayered > normal unlayered > normal layered
    const rank = d.important ? (layer >= 0 ? 30 - layer : 20) : layer >= 0 ? layer : 10;
    const prev = win.get(d.prop);
    if (!prev || rank > prev.rank || (rank === prev.rank && d.order > prev.order)) win.set(d.prop, { rank, order: d.order, value: d.value });
  }
  const r: Record<string, string> = {};
  for (const [k, v] of win) r[k] = v.value;
  // longhands this check reads
  if (r["padding-block"] && !r["padding-top"]) r["padding-top"] = firstValue(r["padding-block"]);
  return r;
}
/** the first value of a shorthand: "calc(var(--spacing) * 6) 0" → "calc(var(--spacing) * 6)" */
function firstValue(v: string): string {
  let depth = 0;
  for (let i = 0; i < v.length; i++) {
    if (v[i] === "(") depth++;
    else if (v[i] === ")") depth--;
    else if (depth === 0 && /\s/.test(v[i])) return v.slice(0, i);
  }
  return v;
}
const SPACING_PX = 4; // --spacing: 0.25rem
/** a length as px (NaN when absent or not one of the forms Tailwind emits here) */
function px(v: string | undefined): number {
  if (!v) return NaN;
  let m = v.match(/^calc\(var\(--spacing\)\s*\*\s*([\d.]+)\)$/);
  if (m) return Number(m[1]) * SPACING_PX;
  m = v.match(/^([\d.]+)px$/);
  if (m) return Number(m[1]);
  m = v.match(/^([\d.]+)rem$/);
  if (m) return Number(m[1]) * 16;
  return NaN;
}
const opacity = (v: string | undefined) => (v === undefined ? 1 : v.endsWith("%") ? Number(v.slice(0, -1)) / 100 : Number(v));

ok("css: compiled globals.css carries .touch-reveal", css.includes(".touch-reveal"));

// ── 1. the code block's Copy on a touch screen ──────────────────────────────
{
  const bar = computed(CODE_TOOLBAR_CLASS, "none");
  const copy = computed(CODE_COPY_CLASS, "none");
  const box = computed(CODE_BOX_CLASS, "none");
  eq("code copy (touch): the toolbar is shown", opacity(bar.opacity), 1);
  ok("code copy (touch): the toolbar takes taps", bar["pointer-events"] !== "none", bar["pointer-events"]);
  ok("code copy (touch): Copy is at least 36px tall", px(copy.height ?? copy["min-height"]) >= 36, show(copy));
  ok("code copy (touch): Copy is at least 36px wide", px(copy["min-width"] ?? copy.width) >= 36, show(copy));
  const barBottom = px(bar.top) + px(copy.height);
  ok(
    "code copy (touch): the toolbar row ends above the code (top + Copy ≤ box padding-top)",
    barBottom <= px(box["padding-top"]),
    `toolbar ends at ${barBottom}px, code starts after ${px(box["padding-top"])}px`
  );
}
{
  // with a mouse nothing moves: hover-only, and the measured geometry (24px top padding) stays
  const bar = computed(CODE_TOOLBAR_CLASS, "hover");
  const copy = computed(CODE_COPY_CLASS, "hover");
  const box = computed(CODE_BOX_CLASS, "hover");
  eq("code copy (mouse): the toolbar waits for hover", opacity(bar.opacity), 0);
  eq("code copy (mouse): the box keeps its 24px top padding", px(box["padding-top"]), 24);
  eq("code copy (mouse): Copy keeps its size", copy.height ?? null, null);
}

// ── 2. the assistant panel's page suggestion ────────────────────────────────
const UUID = "0f6b5e2a-1c3d-4e5f-8a9b-0c1d2e3f4a5b";
const OKF = "cm9vbXMvZmFtaWx5L3JlbGF0aW9uc2hpcC5tZA";
eq("dock: page id from a page path", pageIdOf(`/p/${UUID}`), UUID);
eq("dock: page id from an OKF path", pageIdOf(`/p/${OKF}`), OKF);
eq("dock: no page id off a page", pageIdOf("/dm/room1"), null);

eq("dock: empty room on a page, drives shared → page first, then the drive examples", suggestionsFor({ pageId: UUID, hasDrives: true, hasHistory: false }).list[0], PAGE_SUGGESTION);
eq("dock: empty room on a page, drives shared → four in the list", suggestionsFor({ pageId: UUID, hasDrives: true, hasHistory: false }).list.length, 4);
eq("dock: empty room on a page, no drives", suggestionsFor({ pageId: UUID, hasDrives: false, hasHistory: false }), { list: [PAGE_SUGGESTION], chips: [] });
eq("dock: room with history on a page → the page chip stays", suggestionsFor({ pageId: UUID, hasDrives: true, hasHistory: true }), { list: [], chips: [PAGE_SUGGESTION] });
eq("dock: room with history on an OKF page → the page chip stays", suggestionsFor({ pageId: OKF, hasDrives: false, hasHistory: true }).chips, [PAGE_SUGGESTION]);
eq("dock: room with history off a page → nothing", suggestionsFor({ pageId: null, hasDrives: true, hasHistory: true }), { list: [], chips: [] });
eq("dock: empty room off a page, no drives → nothing", suggestionsFor({ pageId: null, hasDrives: false, hasHistory: false }), { list: [], chips: [] });

{
  const picked: string[] = [];
  const html = renderToStaticMarkup(createElement(SuggestionChips, { items: ["Turn this page into an AI prompt."], onPick: (s: string) => picked.push(s) }));
  ok("dock chips: a button per suggestion", /<button[^>]*data-testid="assistant-chip"[^>]*>[\s\S]*Turn this page into an AI prompt\.[\s\S]*<\/button>/.test(html), html);
  ok("dock chips: not disabled at rest", !/<button[^>]*\sdisabled=""/.test(html), html);
  const busy = renderToStaticMarkup(createElement(SuggestionChips, { items: ["x"], onPick: () => {}, disabled: true }));
  ok("dock chips: disabled while a question is being sent", /<button[^>]*\sdisabled=""/.test(busy), busy);
  eq("dock chips: nothing when there is nothing to offer", renderToStaticMarkup(createElement(SuggestionChips, { items: [], onPick: () => {} })), "");
  const chip = computed(CHIP_CLASS, "none");
  ok("dock chips (touch): at least 36px tall", px(chip.height) >= 36, show(chip));
}

for (const lang of ["en", "ko"] as const) {
  const said = makeT(lang)(PAGE_SUGGESTION);
  const req = parsePromptRequest(said);
  ok(`dock → skill (${lang}): the suggestion asks for a prompt`, asksForPrompt(said), said);
  ok(`dock → skill (${lang}): it names no other page`, findRefInText(said) === null, said);
  ok(`dock → skill (${lang}): it means the page behind the panel`, req.thisPage || !req.rest, show(req));
}

console.log(`\nprompt export UI: ${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
