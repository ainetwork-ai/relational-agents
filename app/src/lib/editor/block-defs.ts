import type { BlockType } from "@/lib/db/schema";

export interface SlashItem {
  type: BlockType;
  label: string;
  keywords: string;
  hint: string;
  /** menu section */
  category?: "aindrive" | "basic" | "media" | "database" | "advanced" | "ai";
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

/** Preset key of the menu's aindrive item. Never stored: the editor takes it
 *  off the block and opens the picker on that block, for this person only. */
export const AINDRIVE_PICK = "__aindrivePick";

/** Blocks that should open on the aindrive picker when they first render. */
export const aindrivePickPending = new Set<string>();

/** Order matters: first match wins for slash-menu filtering. */
export const SLASH_ITEMS: SlashItem[] = [
  // First in the menu: bringing in a file from a linked aindrive folder is the
  // thing this workspace is for. A file block that opens straight on the
  // aindrive picker — the file stays in aindrive, the block keeps its link.
  { type: "file", id: "aindrive", label: "aindrive에서 가져오기", keywords: "aindrive drive import link file 에이아이드라이브 드라이브 가져오기", hint: "Link a file from aindrive", category: "aindrive", glyph: "☁", preset: { [AINDRIVE_PICK]: true } },
  { type: "paragraph", label: "텍스트", keywords: "text paragraph plain", hint: "Just start writing" , category: "basic", glyph: "Aa" },
  { type: "heading1", label: "제목1", keywords: "heading1 h1 title big", hint: "Big section heading" , category: "basic", md: "#", glyph: "H1" },
  { type: "heading2", label: "제목2", keywords: "heading2 h2 subtitle", hint: "Medium section heading" , category: "basic", md: "##", glyph: "H2" },
  { type: "heading3", label: "제목3", keywords: "heading3 h3", hint: "Small section heading" , category: "basic", md: "###", glyph: "H3" },
  { type: "bulleted_list", label: "글머리 기호 목록", keywords: "bullet list ul dash", hint: "Simple bulleted list" , category: "basic", md: "-", glyph: "•" },
  { type: "numbered_list", label: "번호 매기기 목록", keywords: "number ordered ol", hint: "Numbered list" , category: "basic", md: "1.", glyph: "1." },
  { type: "todo", label: "할 일 목록", keywords: "todo checkbox task check", hint: "Track with a checkbox" , category: "basic", md: "[]", glyph: "☑" },
  { type: "toggle", label: "토글 목록", keywords: "toggle collapse fold", hint: "Hide content inside" , category: "basic", md: ">", glyph: "▸" },
  { type: "quote", label: "인용", keywords: "quote blockquote citation", hint: "Capture a quote" , category: "basic", md: ">", glyph: "❝" },
  { type: "divider", label: "구분선", keywords: "divider hr separator line", hint: "Visual divider" , category: "basic", md: "---", glyph: "―" },
  { type: "toc", label: "목차", keywords: "toc table of contents outline", hint: "Outline of the page headings" , category: "advanced", glyph: "☰" },
  { type: "link_to_page", label: "페이지 링크", keywords: "link to page existing", hint: "Link an EXISTING page" , category: "advanced", glyph: "↗" },
  { type: "file", label: "파일", keywords: "file attachment upload", hint: "Upload any file" , category: "media", glyph: "📎" },
  { type: "ai_prompt", label: "AI에게 요청", keywords: "ai ask write draft assistant gpt gemma", hint: "Draft content with the local AI" , category: "ai", glyph: "✨" },
  { type: "equation", label: "블록 수식", keywords: "equation math tex latex katex", hint: "Display a TeX equation" , category: "basic", md: "$$", glyph: "Σ" },
  { type: "button", label: "버튼", keywords: "button click action automation trigger", hint: "Run actions on click" , category: "advanced", glyph: "▶" },
  { type: "template_button", label: "템플릿 버튼", keywords: "template button repeat duplicate", hint: "Insert preset blocks on click" , category: "advanced", glyph: "＋" },
  { type: "code", label: "코드", keywords: "code snippet monospace", hint: "Code with syntax" , category: "basic", md: "```", glyph: "</>" },
  { type: "callout", label: "콜아웃", keywords: "callout info banner note", hint: "Make it stand out" , category: "basic", glyph: "💡" },
  { type: "table", label: "표", keywords: "table grid rows columns spreadsheet", hint: "Simple rows-and-columns table" , category: "basic", glyph: "▦" },
  { type: "database", label: "데이터베이스", keywords: "database board kanban project task tracker properties view", hint: "Table + board with typed properties" , category: "database", glyph: "🗃" },
  { type: "image", label: "이미지", keywords: "image picture img photo", hint: "Embed from a URL" , category: "media", glyph: "🖼" },
  { type: "bookmark", label: "웹 북마크", keywords: "bookmark link url web", hint: "Save a link as a visual card" , category: "media", glyph: "🔖" },
  { type: "video", label: "동영상", keywords: "video youtube mp4 embed", hint: "Embed a video by URL" , category: "media", glyph: "▶" },
  { type: "embed", label: "임베드", keywords: "embed iframe figma pdf", hint: "Embed any page/file by URL" , category: "media", glyph: "⧉" },
  { type: "database", id: "dashboard", label: "대시보드 보기", keywords: "dashboard view stats chart aggregate kpi", hint: "Database opened as a dashboard" , category: "database", icon: "dashboard", preset: { initialViewType: "dashboard" } },
  { type: "child_page", label: "페이지", keywords: "page subpage child document new", hint: "Insert a sub-page inside this page" , category: "advanced", glyph: "📄" },
  { type: "column_list", label: "열", keywords: "columns column layout side two", hint: "Two columns side by side" , category: "advanced", glyph: "◫" },
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
  // 원본: ">" 는 토글, '"' 가 인용 (2026-08-26 실측)
  { prefix: ">", type: "toggle" },
  { prefix: '"', type: "quote" },
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
