// Dependency-free syntax highlighter for code blocks. No external lib (the
// package manager is unavailable in this env), so this is a conservative
// tokenizer: it highlights comments, strings, numbers and a per-language
// keyword set — the visible 80% — and falls back to plain escaped text for
// unknown languages. Output is safe HTML (everything is escaped first).

const KEYWORDS: Record<string, string[]> = {
  javascript: "const let var function return if else for while do switch case break continue new class extends super this import export from default async await yield try catch finally throw typeof instanceof in of void delete null undefined true false".split(" "),
  typescript: "const let var function return if else for while do switch case break continue new class extends super this import export from default async await yield try catch finally throw typeof instanceof in of void delete null undefined true false interface type enum implements public private protected readonly as satisfies keyof namespace declare".split(" "),
  python: "def return if elif else for while break continue class import from as pass lambda yield try except finally raise with global nonlocal in is not and or None True False async await del assert".split(" "),
  json: "true false null".split(" "),
  bash: "if then else elif fi for while do done case esac function in return export local echo exit".split(" "),
  sql: "select from where insert update delete into values set create table drop alter join left right inner outer on group by order having limit as and or not null distinct".split(" "),
  go: "func package import return if else for range var const type struct interface map chan go defer select case switch break continue nil true false".split(" "),
  rust: "fn let mut const struct enum impl trait pub use mod match if else for while loop return self Self as ref move where async await dyn box true false".split(" "),
};
// language aliases → canonical keyword set
const ALIASES: Record<string, string> = {
  js: "javascript",
  jsx: "javascript",
  ts: "typescript",
  tsx: "typescript",
  py: "python",
  sh: "bash",
  shell: "bash",
  rs: "rust",
  golang: "go",
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Language uses `#` for line comments (python/bash/sql-ish) vs `//`. */
function lineCommentStyle(lang: string): "hash" | "slash" {
  return lang === "python" || lang === "bash" || lang === "sql" ? "hash" : "slash";
}

/**
 * Highlight `code` for `language`, returning HTML with <span class="tok-*">
 * wrappers. Returns escaped plain text (no spans) for unknown languages.
 */
export function highlightCode(code: string, language?: string): string {
  const langRaw = (language ?? "").toLowerCase();
  const lang = ALIASES[langRaw] ?? langRaw;
  const keywords = KEYWORDS[lang];
  if (!keywords || lang === "plain" || !langRaw) return escapeHtml(code);
  const kw = new Set(keywords);
  const hash = lineCommentStyle(lang) === "hash";

  // One master scanner, ordered so comments/strings win over identifiers.
  // Groups: 1 block comment, 2 line comment, 3 string, 4 number, 5 identifier.
  const lineComment = hash ? "#[^\\n]*" : "//[^\\n]*";
  const re = new RegExp(
    `(/\\*[\\s\\S]*?\\*/)|(${lineComment})|("(?:[^"\\\\]|\\\\.)*"|'(?:[^'\\\\]|\\\\.)*'|\`(?:[^\`\\\\]|\\\\.)*\`)|(\\b\\d[\\d_.]*\\b)|([A-Za-z_$][A-Za-z0-9_$]*)`,
    "g"
  );
  let out = "";
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code)) !== null) {
    out += escapeHtml(code.slice(last, m.index));
    const [full, block, line, str, num, ident] = m;
    if (block || line) out += `<span class="tok-comment">${escapeHtml(full)}</span>`;
    else if (str) out += `<span class="tok-string">${escapeHtml(full)}</span>`;
    else if (num) out += `<span class="tok-number">${escapeHtml(full)}</span>`;
    else if (ident && kw.has(ident)) out += `<span class="tok-keyword">${escapeHtml(full)}</span>`;
    else out += escapeHtml(full);
    last = m.index + full.length;
  }
  out += escapeHtml(code.slice(last));
  return out;
}

/** True when this language has a keyword set (so highlighting will do something). */
export function isHighlightable(language?: string): boolean {
  const raw = (language ?? "").toLowerCase();
  const lang = ALIASES[raw] ?? raw;
  return !!KEYWORDS[lang];
}
