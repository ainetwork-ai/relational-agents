import type { BlockType } from "@/lib/db/schema";

export interface SlashItem {
  type: BlockType;
  label: string;
  keywords: string;
  hint: string;
  /** menu section */
  category?: "basic" | "media" | "database" | "advanced" | "ai";
  /** markdown shortcut shown as a kbd hint on the right */
  md?: string;
  /** compact glyph for the item icon tile */
  glyph?: string;
  /** distinct key when several items share a block type (also the testid) */
  id?: string;
  /** named SVG icon rendered instead of the text glyph (see slash-menu) */
  icon?: "dashboard";
  /** block-content preset applied on insert (e.g. a database's initial view) */
  preset?: Record<string, unknown>;
}

/** Order matters: first match wins for slash-menu filtering. */
export const SLASH_ITEMS: SlashItem[] = [
  { type: "paragraph", label: "Text", keywords: "text paragraph plain", hint: "Just start writing" , category: "basic", glyph: "Aa" },
  { type: "heading1", label: "Heading 1", keywords: "heading1 h1 title big", hint: "Big section heading" , category: "basic", md: "#", glyph: "H1" },
  { type: "heading2", label: "Heading 2", keywords: "heading2 h2 subtitle", hint: "Medium section heading" , category: "basic", md: "##", glyph: "H2" },
  { type: "heading3", label: "Heading 3", keywords: "heading3 h3", hint: "Small section heading" , category: "basic", md: "###", glyph: "H3" },
  { type: "bulleted_list", label: "Bulleted list", keywords: "bullet list ul dash", hint: "Simple bulleted list" , category: "basic", md: "-", glyph: "•" },
  { type: "numbered_list", label: "Numbered list", keywords: "number ordered ol", hint: "Numbered list" , category: "basic", md: "1.", glyph: "1." },
  { type: "todo", label: "To-do list", keywords: "todo checkbox task check", hint: "Track with a checkbox" , category: "basic", md: "[]", glyph: "☑" },
  { type: "toggle", label: "Toggle", keywords: "toggle collapse fold", hint: "Hide content inside" , category: "basic", md: ">", glyph: "▸" },
  { type: "quote", label: "Quote", keywords: "quote blockquote citation", hint: "Capture a quote" , category: "basic", md: ">", glyph: "❝" },
  { type: "divider", label: "Divider", keywords: "divider hr separator line", hint: "Visual divider" , category: "basic", md: "---", glyph: "―" },
  { type: "toc", label: "Table of contents", keywords: "toc table of contents outline", hint: "Outline of the page headings" , category: "advanced", glyph: "☰" },
  { type: "link_to_page", label: "Link to page", keywords: "link to page existing", hint: "Link an EXISTING page" , category: "advanced", glyph: "↗" },
  { type: "file", label: "File", keywords: "file attachment upload", hint: "Upload any file" , category: "media", glyph: "📎" },
  { type: "ai_prompt", label: "Ask AI", keywords: "ai ask write draft assistant gpt gemma", hint: "Draft content with the local AI" , category: "ai", glyph: "✨" },
  { type: "equation", label: "Block equation", keywords: "equation math tex latex katex", hint: "Display a TeX equation" , category: "basic", md: "$$", glyph: "Σ" },
  { type: "button", label: "Button", keywords: "button click action automation trigger videocall", hint: "Run actions on click" , category: "advanced", glyph: "▶" },
  { type: "template_button", label: "Template button", keywords: "template button repeat duplicate", hint: "Insert preset blocks on click" , category: "advanced", glyph: "＋" },
  { type: "code", label: "Code", keywords: "code snippet monospace", hint: "Code with syntax" , category: "basic", md: "```", glyph: "</>" },
  { type: "callout", label: "Callout", keywords: "callout info banner note", hint: "Make it stand out" , category: "basic", glyph: "💡" },
  { type: "table", label: "Table", keywords: "table grid rows columns spreadsheet", hint: "Simple rows-and-columns table" , category: "basic", glyph: "▦" },
  { type: "database", label: "Database", keywords: "database board kanban project task tracker properties view", hint: "Table + board with typed properties" , category: "database", glyph: "🗃" },
  { type: "image", label: "Image", keywords: "image picture img photo", hint: "Embed from a URL" , category: "media", glyph: "🖼" },
  { type: "bookmark", label: "Web bookmark", keywords: "bookmark link url web", hint: "Save a link as a visual card" , category: "media", glyph: "🔖" },
  { type: "video", label: "Video", keywords: "video youtube mp4 embed", hint: "Embed a video by URL" , category: "media", glyph: "▶" },
  { type: "embed", label: "Embed", keywords: "embed iframe figma pdf", hint: "Embed any page/file by URL" , category: "media", glyph: "⧉" },
  { type: "database", id: "dashboard", label: "Dashboard view", keywords: "dashboard view stats chart aggregate kpi", hint: "Database opened as a dashboard" , category: "database", icon: "dashboard", preset: { initialViewType: "dashboard" } },
  { type: "child_page", label: "Page", keywords: "page subpage child document new", hint: "Insert a sub-page inside this page" , category: "advanced", glyph: "📄" },
  { type: "column_list", label: "Columns", keywords: "columns column layout side two", hint: "Two columns side by side" , category: "advanced", glyph: "◫" },
];

/** Markdown prefixes applied when the user types the prefix then a space. */
export const MARKDOWN_SHORTCUTS: { prefix: string; type: BlockType }[] = [
  { prefix: "$$", type: "equation" },
  { prefix: "###", type: "heading3" },
  { prefix: "##", type: "heading2" },
  { prefix: "#", type: "heading1" },
  { prefix: "-", type: "bulleted_list" },
  { prefix: "*", type: "bulleted_list" },
  { prefix: "1.", type: "numbered_list" },
  { prefix: "[]", type: "todo" },
  { prefix: ">", type: "quote" },
  { prefix: "```", type: "code" },
];

export const CODE_LANGUAGES = [
  "plain",
  "javascript",
  "typescript",
  "python",
  "bash",
  "json",
  "html",
  "css",
  "sql",
  "go",
  "rust",
];

/** Block types whose body is editable rich text. */
export const TEXT_TYPES: BlockType[] = [
  "paragraph",
  "heading1",
  "heading2",
  "heading3",
  "bulleted_list",
  "numbered_list",
  "todo",
  "toggle",
  "quote",
  "callout",
];
