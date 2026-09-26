/**
 * The prompt templates and the small Handlebars subset they need.
 *
 * CLAUDE_XML is notion2prompt's templates/claude-xml.hbs byte for byte (no trailing
 * newline after the last {{/if}}); its templates/default.hbs is the very same file,
 * so DEFAULT is too. MARKDOWN is ours: the "simple markdown" notion2prompt's README
 * describes for `default` but never shipped — files as sections, no XML.
 *
 * The engine does `{{ var }}` (HTML-escaped), `{{{var}}}` (raw), `{{#if}}` and
 * `{{#each}}`, with Handlebars' standalone-line rule (a line holding only a block tag
 * disappears with its newline) — what handlebars-rust applies to these templates.
 * Pure.
 */

export const CLAUDE_XML = `<project_path>{{ absolute_content_path }}</project_path>

{{#if source_tree}}
<source_tree>
\`\`\`
{{{source_tree}}}
\`\`\`
</source_tree>
{{/if}}

<files>
{{#each files}}
{{#if code}}
<file>
<path>{{path}}</path>
<content>
{{{code}}}
</content>
</file>
{{/if}}
{{/each}}
</files>

{{#if instructions}}
<instructions>
{{{instructions}}}
</instructions>

<final_instruction>
Consider the project path in <project_path>, {{#if source_tree}}the source tree in <source_tree>,{{/if}} and the files in <files>. Then, follow the instructions given in <instructions>. Take a deep breath and think step by step about how to best complete this task.
</final_instruction>
{{/if}}`;

export const DEFAULT = CLAUDE_XML;

export const MARKDOWN = `# {{ absolute_content_path }}

{{#if source_tree}}
\`\`\`
{{{source_tree}}}
\`\`\`
{{/if}}

{{#each files}}
{{#if code}}
---
<!-- {{path}} -->

{{{code}}}
{{/if}}
{{/each}}
{{#if instructions}}
---

## Instructions

{{{instructions}}}
{{/if}}`;

export const TEMPLATES = { "claude-xml": CLAUDE_XML, default: DEFAULT, markdown: MARKDOWN } as const;

type Token =
  | { t: "text"; v: string }
  | { t: "var"; name: string; raw: boolean }
  | { t: "open"; kind: "if" | "each"; name: string }
  | { t: "close"; kind: "if" | "each" };

function tokenize(src: string): Token[] {
  const out: Token[] = [];
  const re = /\{\{\{\s*([\w.]+)\s*\}\}\}|\{\{\s*(#if|#each|\/if|\/each)?\s*([\w.]*)\s*\}\}/g;
  let last = 0;
  for (const m of src.matchAll(re)) {
    const at = m.index ?? 0;
    if (at > last) out.push({ t: "text", v: src.slice(last, at) });
    last = at + m[0].length;
    if (m[1] !== undefined) out.push({ t: "var", name: m[1], raw: true });
    else if (m[2] === "#if" || m[2] === "#each") out.push({ t: "open", kind: m[2] === "#if" ? "if" : "each", name: m[3] });
    else if (m[2] === "/if" || m[2] === "/each") out.push({ t: "close", kind: m[2] === "/if" ? "if" : "each" });
    else out.push({ t: "var", name: m[3], raw: false });
  }
  if (last < src.length) out.push({ t: "text", v: src.slice(last) });
  return out;
}

/** Handlebars' standalone rule, decided on the original text of the neighbours: a block
 *  tag alone on its line (only spaces or tabs around it) takes that line with it. */
function stripStandalone(tokens: Token[]): Token[] {
  const orig = tokens.map((x) => (x.t === "text" ? x.v : null));
  const last = tokens.length - 1;
  const standalone = tokens.map((x, i) => {
    if (x.t !== "open" && x.t !== "close") return false;
    let before = "";
    if (i > 0) {
      const prev = orig[i - 1];
      if (prev === null) return false;
      const nl = prev.lastIndexOf("\n");
      if (nl >= 0) before = prev.slice(nl + 1);
      else if (i - 1 === 0) before = prev;
      else return false;
    }
    let after = "";
    if (i < last) {
      const next = orig[i + 1];
      if (next === null) return false;
      const nl = next.indexOf("\n");
      if (nl >= 0) after = next.slice(0, nl);
      else if (i + 1 === last) after = next;
      else return false;
    }
    return /^[ \t]*$/.test(before) && /^[ \t\r]*$/.test(after);
  });
  const out = tokens.map((x) => ({ ...x }));
  standalone.forEach((s, i) => {
    if (!s) return;
    const p = out[i - 1];
    const n = out[i + 1];
    if (p && p.t === "text") p.v = p.v.replace(/[ \t]*$/, "");
    if (n && n.t === "text") n.v = n.v.replace(/^[ \t]*\r?\n?/, "");
  });
  return out;
}

const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#x27;", "`": "&#x60;", "=": "&#x3D;" };
export const escapeHtml = (s: string) => s.replace(/[&<>"'`=]/g, (c) => ESC[c]);

type Ctx = Record<string, unknown>;

const truthy = (v: unknown) => (Array.isArray(v) ? v.length > 0 : !!v);
const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));

interface Node {
  tok: Token;
  body?: Node[];
}

function parse(tokens: Token[]): Node[] {
  const root: Node[] = [];
  const stack: Node[][] = [root];
  for (const tok of tokens) {
    if (tok.t === "open") {
      const node: Node = { tok, body: [] };
      stack[stack.length - 1].push(node);
      stack.push(node.body!);
    } else if (tok.t === "close") {
      if (stack.length > 1) stack.pop();
    } else stack[stack.length - 1].push({ tok });
  }
  return root;
}

function run(nodes: Node[], ctx: Ctx): string {
  let out = "";
  for (const { tok, body } of nodes) {
    if (tok.t === "text") out += tok.v;
    else if (tok.t === "var") out += tok.raw ? str(ctx[tok.name]) : escapeHtml(str(ctx[tok.name]));
    else if (tok.t === "open" && tok.kind === "if") {
      if (truthy(ctx[tok.name])) out += run(body ?? [], ctx);
    } else if (tok.t === "open" && tok.kind === "each") {
      const list = ctx[tok.name];
      if (Array.isArray(list)) for (const item of list) out += run(body ?? [], (item ?? {}) as Ctx);
    }
  }
  return out;
}

/** Render a template (one of TEMPLATES, or any text in the same subset). */
export function renderTemplate(src: string, data: Ctx): string {
  return run(parse(stripStandalone(tokenize(src))), data);
}
