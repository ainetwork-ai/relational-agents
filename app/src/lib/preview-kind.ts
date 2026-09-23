// Which inline renderer <FilePreview> (components/previews) uses for a file,
// decided by extension alone. Pure + dependency-free (safe on the server too).
//
// Ported from aindrive (web/lib/preview-kind.ts) — keep the tables in sync.
// Coverage target: every type Google Drive previews
// (https://support.google.com/drive/answer/37603).

export type PreviewKind =
  | "markdown"  // read-only source view (same as text)
  | "text"      // read-only monospace view
  | "image"     // browser-native <img>
  | "tiff"      // decoded client-side (utif) → canvas
  | "psd"       // composite decoded client-side (ag-psd)
  | "pdf"       // pdf.js; also Illustrator .ai (PDF-compatible container)
  | "video"     // <video>; download card when the container/codec won't play
  | "audio"     // <audio>
  | "docx"      // docx-preview
  | "sheet"     // SheetJS
  | "pptx"      // pptx-preview
  | "archive"   // libarchive.js listing + single-entry extract
  | "font"      // FontFace specimen
  | "dxf"       // dxf-viewer (WebGL)
  | "converted" // legacy Office, iWork, PostScript, XPS — aindrive converts these
                //   to PDF server-side; here: download card (no converter)
  | "none";     // no inline preview; download only

const TABLE: Record<Exclude<PreviewKind, "none">, string[]> = {
  markdown: ["md", "markdown"],
  text: [
    "txt", "log", "text", "json", "jsonc", "json5", "ndjson",
    "js", "mjs", "cjs", "jsx", "ts", "mts", "cts", "tsx",
    "html", "htm", "xhtml", "css", "scss", "sass", "less",
    "py", "pyi", "rs", "go", "java", "kt", "kts", "scala", "groovy", "gradle",
    "c", "h", "cpp", "cc", "cxx", "hpp", "hh", "hxx", "m", "mm", "cs", "swift", "dart",
    "php", "rb", "pl", "pm", "lua", "r", "jl", "ex", "exs", "erl", "hs", "clj", "elm",
    "sh", "bash", "zsh", "fish", "ps1", "bat", "cmd",
    "sql", "graphql", "gql", "proto", "vue", "svelte", "astro",
    "yml", "yaml", "toml", "ini", "cfg", "conf", "properties", "env",
    "xml", "xsd", "xsl", "plist", "csv", "tsv", "tex", "bib", "rst", "adoc", "org",
    "diff", "patch", "srt", "vtt", "dockerfile", "makefile", "cmake",
  ],
  image: ["jpg", "jpeg", "jpe", "jfif", "png", "apng", "gif", "webp", "bmp", "dib", "svg", "ico", "avif"],
  tiff: ["tif", "tiff"],
  psd: ["psd"],
  pdf: ["pdf", "ai"],
  video: [
    // native in browsers:
    "mp4", "m4v", "webm", "mov", "ogv", "mkv",
    // not browser-playable (see NATIVE_VIDEO) — download card:
    "avi", "wmv", "asf", "flv", "f4v", "3gp", "3g2", "mpg", "mpeg", "mpe", "m1v", "m2v", "vob", "m2ts", // not ts/mts: TypeScript owns those
  ],
  audio: ["mp3", "mpga", "mp2", "m2a", "wav", "ogg", "oga", "opus", "m4a", "aac", "flac", "weba"],
  docx: ["docx", "docm", "dotx", "dotm"],
  sheet: ["xlsx", "xlsm", "xltx", "xltm", "xlsb", "xls", "ods"],
  pptx: ["pptx", "pptm", "ppsx", "ppsm", "potx"],
  archive: ["zip", "rar", "7z", "tar", "gz", "tgz", "bz2", "tbz", "tbz2", "xz", "txz"],
  font: ["ttf", "otf", "woff", "woff2"],
  dxf: ["dxf"],
  converted: [
    "doc", "dot", "rtf", "odt", "ott", "wpd",
    "ppt", "pps", "pot", "odp",
    "key", "numbers", "pages",
    "eps", "ps",
    "xps", "oxps",
  ],
};

// Containers browsers usually decode in <video>. Everything else in the video
// row goes straight to the download card instead of a doomed native try.
const NATIVE_VIDEO = new Set(["mp4", "m4v", "webm", "mov", "ogv", "mkv"]);

const BY_EXT = new Map<string, PreviewKind>();
for (const [kind, exts] of Object.entries(TABLE) as Array<[PreviewKind, string[]]>) {
  for (const e of exts) {
    // An extension in two rows would silently route to whichever came last.
    if (BY_EXT.has(e)) throw new Error(`preview-kind: .${e} listed under both ${BY_EXT.get(e)} and ${kind}`);
    BY_EXT.set(e, kind);
  }
}

// Extension-less files that are conventionally text.
const TEXT_BASENAMES = new Set([
  "dockerfile", "makefile", "readme", "license", "licence", "changelog",
  "authors", "contributors", "notice", "gemfile", "procfile", "vagrantfile",
  ".gitignore", ".gitattributes", ".dockerignore", ".npmrc", ".editorconfig", ".env",
]);

/** Lowercased extension without the dot ("" when none). ".env" → "". */
export function extOf(name: string): string {
  const base = name.slice(name.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
}

export function previewKindFor(name: string): PreviewKind {
  const ext = extOf(name);
  const kind = BY_EXT.get(ext);
  if (kind) return kind;
  const base = name.slice(name.lastIndexOf("/") + 1).toLowerCase();
  if (TEXT_BASENAMES.has(base)) return "text";
  return "none";
}

/**
 * Kind with a mime fallback: name first; a known text/* mime only rescues
 * text files whose ext isn't in the table (.jsonl, .mdx, yarn.lock…).
 */
export function previewKindForEntry(name: string, mime: string | undefined): PreviewKind {
  const kind = previewKindFor(name);
  if (kind === "none" && mime?.startsWith("text/")) return "text";
  return kind;
}

/** Video the browser should try to play natively. */
export function isNativeVideo(name: string): boolean {
  return NATIVE_VIDEO.has(extOf(name));
}
