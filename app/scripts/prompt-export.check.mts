// Prompt export (notion2prompt parity) checks — src/lib/prompt-export.
//
//   pnpm check:prompt
//   npx tsx --tsconfig scripts/tsconfig.json scripts/prompt-export.check.mts
//   N2P_SNAPSHOTS=/path/to/notion2prompt/tests/snapshots npx tsx … scripts/prompt-export.check.mts
//
// 1. Render stage vs notion2prompt's golden output: every insta snapshot under
//    tests/snapshots (blocks, rich text, lists, nesting, tables, databases, pages,
//    integration), tests/snapshots/end_to_end_child_database_output.md, the claude-xml
//    template rendered as handlebars renders it, and a few cases derived from its code.
//    The expected texts are embedded below; with N2P_SNAPSHOTS set, each one that has
//    a .snap file is also compared with that file (insta trims trailing newlines).
// 2. Fetch stage on an in-memory source: depth, limit, cycles, duplicates, permissions
//    (nothing a reader may not see — not even a title — reaches the output),
//    child pages off, always-fetch-databases, database roots, block roots.
// 3. Files: separate vs merged child pages, ainmem vs notion2prompt layout, templates.
// 4. Reading requests: ids and links, options in a sentence (English and Korean), titles.
// 5. ainmem → Notion shape: inline HTML, nesting, tables, callouts, gifts.
import fs from "node:fs";
import path from "node:path";
import { collect, PromptNotFound, type PromptSource, type SourceDatabase, type SourcePage } from "@/lib/prompt-export/collect";
import { asksForPrompt, coversAsked, expandAliases, findRefInText, parsePromptRequest, parseRef, scoreTitle, titleCoverage } from "@/lib/prompt-export/input";
import { mapBlock, nestBlocks } from "@/lib/prompt-export/map";
import type { PBlock, PDatabase, PPage, PromptContent, PValue, RichText } from "@/lib/prompt-export/model";
import { formatNumberAuto } from "@/lib/prompt-export/properties";
import {
  cleanFilename,
  composeDatabaseSummary,
  composePageMarkdown,
  drawTree,
  renderBlocks,
  renderPrompt,
  sanitizeFilename,
} from "@/lib/prompt-export/render";
import { htmlToRichText, richTextToMarkdown, text } from "@/lib/prompt-export/rich-text";
import { renderTemplate } from "@/lib/prompt-export/template";
import { PROMPT_EXPORT_CHECK as K } from "@/i18n/content/scripts";

let fails = 0;
let passes = 0;
const show = (s: string) => JSON.stringify(s);
function eq(name: string, got: string, want: string) {
  if (got === want) {
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

// ── builders ────────────────────────────────────────────────────────────────
let n = 0;
const nid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
const rt = (s: string): RichText[] => (s ? [text(s)] : []);
const kids = (c?: PBlock[]) => (c && c.length ? { children: c } : {});
const B = {
  p: (s: string, c?: PBlock[]): PBlock => ({ id: nid(), type: "paragraph", richText: rt(s), ...kids(c) }),
  pr: (r: RichText[]): PBlock => ({ id: nid(), type: "paragraph", richText: r }),
  h1: (s: string): PBlock => ({ id: nid(), type: "heading_1", richText: rt(s) }),
  h2: (s: string): PBlock => ({ id: nid(), type: "heading_2", richText: rt(s) }),
  h3: (s: string): PBlock => ({ id: nid(), type: "heading_3", richText: rt(s) }),
  ul: (s: string, c?: PBlock[]): PBlock => ({ id: nid(), type: "bulleted_list_item", richText: rt(s), ...kids(c) }),
  ol: (s: string, c?: PBlock[]): PBlock => ({ id: nid(), type: "numbered_list_item", richText: rt(s), ...kids(c) }),
  olr: (r: RichText[]): PBlock => ({ id: nid(), type: "numbered_list_item", richText: r }),
  todo: (s: string, checked: boolean): PBlock => ({ id: nid(), type: "to_do", richText: rt(s), checked }),
  toggle: (s: string, c?: PBlock[]): PBlock => ({ id: nid(), type: "toggle", richText: rt(s), ...kids(c) }),
  toggler: (r: RichText[]): PBlock => ({ id: nid(), type: "toggle", richText: r }),
  quote: (s: string, c?: PBlock[]): PBlock => ({ id: nid(), type: "quote", richText: rt(s), ...kids(c) }),
  callout: (s: string, emoji: string | null, c?: PBlock[]): PBlock => ({ id: nid(), type: "callout", richText: rt(s), icon: emoji ? { emoji } : null, ...kids(c) }),
  code: (s: string, language: string): PBlock => ({ id: nid(), type: "code", richText: rt(s), language }),
  divider: (): PBlock => ({ id: nid(), type: "divider" }),
  breadcrumb: (): PBlock => ({ id: nid(), type: "breadcrumb" }),
  toc: (): PBlock => ({ id: nid(), type: "table_of_contents" }),
  bookmark: (url: string, caption = ""): PBlock => ({ id: nid(), type: "bookmark", url, ...(caption ? { caption: rt(caption) } : {}) }),
  image: (url: string, caption = ""): PBlock => ({ id: nid(), type: "image", url, ...(caption ? { caption: rt(caption) } : {}) }),
  video: (url: string): PBlock => ({ id: nid(), type: "video", url }),
  file: (url: string): PBlock => ({ id: nid(), type: "file", url }),
  pdf: (url: string): PBlock => ({ id: nid(), type: "pdf", url }),
  embed: (url: string): PBlock => ({ id: nid(), type: "embed", url }),
  linkPreview: (url: string): PBlock => ({ id: nid(), type: "link_preview", url }),
  childPage: (title: string, pageId?: string): PBlock => ({ id: nid(), type: "child_page", title, ...(pageId ? { pageId } : {}) }),
  childDb: (title: string, databaseId?: string): PBlock => ({ id: nid(), type: "child_database", title, content: { state: "not_fetched", ...(databaseId ? { databaseId } : {}) } }),
  fetchedDb: (title: string, databaseId: string): PBlock => ({ id: nid(), type: "child_database", title, content: { state: "fetched", databaseId } }),
  linkedDb: (title: string): PBlock => ({ id: nid(), type: "child_database", title, content: { state: "linked" } }),
  equation: (e: string): PBlock => ({ id: nid(), type: "equation", expression: e }),
  linkToPage: (pageId: string): PBlock => ({ id: nid(), type: "link_to_page", pageId }),
  columns: (cols: PBlock[][]): PBlock => ({ id: nid(), type: "column_list", children: cols.map((c) => ({ id: nid(), type: "column" as const, children: c })) }),
  synced: (from: string | null, c: PBlock[]): PBlock => ({ id: nid(), type: "synced_block", syncedFrom: from, children: c }),
  unsupported: (t: string): PBlock => ({ id: nid(), type: "unsupported", blockType: t }),
  table: (width: number, header: boolean, rows: string[][]): PBlock => ({
    id: nid(),
    type: "table",
    width,
    hasColumnHeader: header,
    children: rows.map((r) => ({ id: nid(), type: "table_row" as const, cells: r.map((c) => rt(c)) })),
  }),
};
const title = (s: string): PValue => ({ type: "title", richText: rt(s) });
const select = (s: string | null): PValue => ({ type: "select", name: s });
const PAGE_ID = "00000000-0000-0000-0000-000000000002";
const PAGE_URL = "https://www.notion.so/00000000-0000-0000-0000-000000000002";
const page = (t: string, blocks: PBlock[] = [], properties: PPage["properties"] = []): PPage => ({ id: PAGE_ID, title: t, url: PAGE_URL, properties, blocks });
const DB_ID = "00000000-0000-0000-0000-000000000003";
const row = (id: string, name: string, extra: PPage["properties"] = []): PPage => ({ id, title: name, url: `https://www.notion.so/${id.replace(/-/g, "")}`, properties: [{ name: "Name", value: title(name) }, ...extra], blocks: [] });
const one = (b: PBlock) => renderBlocks([b]);

// ── 1. render stage vs notion2prompt ────────────────────────────────────────

/** name → [actual, expected]; names match tests/snapshots/snapshot_tests__<name>.snap */
const golden: [string, string, string][] = [];
const g = (name: string, got: string, want: string) => golden.push([name, got, want]);

g("blocks__paragraph_block", one(B.p("Hello, world!")), "Hello, world!\n");
g("blocks__paragraph_empty", one(B.p("")), "\n");
g("blocks__heading1_block", one(B.h1("Main Title")), "# Main Title\n");
g("blocks__heading2_block", one(B.h2("Section Title")), "## Section Title\n");
g("blocks__heading3_block", one(B.h3("Subsection Title")), "### Subsection Title\n");
g("blocks__bulleted_list_item", one(B.ul("List item")), "- List item\n");
g("blocks__numbered_list_item", one(B.ol("First item")), "1. First item\n");
g("blocks__todo_checked", one(B.todo("Completed task", true)), "- [x] Completed task\n");
g("blocks__todo_unchecked", one(B.todo("Pending task", false)), "- [ ] Pending task\n");
g("blocks__toggle_block", one(B.toggle("Toggle header", [B.p("Hidden content")])), "▸ Toggle header\n  Hidden content\n");
g("blocks__quote_block", one(B.quote("A wise saying")), "> A wise saying\n");
g("blocks__callout_block", one(B.callout("Important notice", "💡")), "> 💡  Important notice\n");
g("blocks__code_rust", one(B.code('fn main() {\n    println!("hello");\n}', "rust")), '```rust\nfn main() {\n    println!("hello");\n}\n```\n');
g("blocks__code_python", one(B.code('def hello():\n    print("hello")', "python")), '```python\ndef hello():\n    print("hello")\n```\n');
g("blocks__divider_block", one(B.divider()), "---\n");
g("blocks__breadcrumb_block", one(B.breadcrumb()), "[Breadcrumb]\n");
g("blocks__bookmark_block", one(B.bookmark("https://example.com")), "[🔖 https://example.com]\n");
g("blocks__bookmark_block_with_caption", one(B.bookmark("https://example.com", "Example Site")), "[🔖 https://example.com - Example Site]\n");
g("blocks__image_external_block", one(B.image("https://example.com/image.png")), "![Image](https://example.com/image.png)\n");
g("blocks__image_with_caption_block", one(B.image("https://example.com/photo.jpg", "A beautiful photo")), "![A beautiful photo](https://example.com/photo.jpg)\n");
g("blocks__video_block", one(B.video("https://example.com/video.mp4")), "[Video: https://example.com/video.mp4]\n");
g("blocks__file_block_test", one(B.file("https://example.com/doc.pdf")), "[File: https://example.com/doc.pdf]\n");
g("blocks__pdf_block", one(B.pdf("https://example.com/paper.pdf")), "[PDF: https://example.com/paper.pdf]\n");
g("blocks__embed_block", one(B.embed("https://twitter.com/status/123")), "[Embed: https://twitter.com/status/123]\n");
g("blocks__link_preview_block", one(B.linkPreview("https://github.com/repo")), "[Link Preview: https://github.com/repo]\n");
g("blocks__child_page_block", one(B.childPage("My Sub-Page")), "📄 [[My Sub-Page]]\n");
g("blocks__child_database_block", one(B.childDb("My Database")), "🗄️ [[My Database]]\n");
g("blocks__equation_block", one(B.equation("E = mc^2")), "$$\nE = mc^2\n$$\n");
g("blocks__link_to_page_block", one(B.linkToPage("aabbccdd-aabb-ccdd-aabb-ccddaabbccdd")), "[[aabbccddaabbccddaabbccddaabbccdd]]\n");
g(
  "blocks__table_of_contents_with_headings",
  renderBlocks([B.toc(), B.h1("Introduction"), B.h2("Overview"), B.h1("Conclusion")]),
  "## Table of Contents\n\n* [Introduction](#introduction)\n  * [Overview](#overview)\n* [Conclusion](#conclusion)\n\n# Introduction\n## Overview\n# Conclusion\n"
);
g("blocks__column_list_block", one(B.columns([[B.p("Column 1 content")], [B.p("Column 2 content")]])), "Column 1 content\nColumn 2 content\n");
g("blocks__synced_block", one(B.synced(null, [B.p("Synced content")])), "Synced content\n");
g("blocks__synced_reference_block", one(B.synced("aabbccdd-aabb-ccdd-aabb-ccddaabbccdd", [B.p("Referenced content")])), "[Synced from: aabbccddaabbccddaabbccddaabbccdd]\nReferenced content\n");
g("blocks__unsupported_block", one(B.unsupported("new_block_type")), "[Unsupported block type: new_block_type]\n");

g("rich_text__bold_text", one(B.pr([text("Bold text", { bold: true })])), "**Bold text**\n");
g("rich_text__italic_text", one(B.pr([text("Italic text", { italic: true })])), "*Italic text*\n");
g("rich_text__strikethrough_text", one(B.pr([text("Struck through", { strikethrough: true })])), "~~Struck through~~\n");
g("rich_text__underline_text", one(B.pr([text("Underlined text", { underline: true })])), "<u>Underlined text</u>\n");
g("rich_text__inline_code", one(B.pr([text("let x = 42", { code: true })])), "`let x = 42`\n");
g("rich_text__combined_bold_italic", one(B.pr([text("Bold and italic", { bold: true, italic: true })])), "***Bold and italic***\n");
g("rich_text__text_with_link", one(B.pr([text("Click here", undefined, "https://example.com")])), "[Click here](https://example.com)\n");
g(
  "rich_text__mixed_rich_text",
  one(B.pr([text("Normal "), text("bold", { bold: true }), text(" and "), text("italic", { italic: true }), text(" text.")])),
  "Normal **bold** and *italic* text.\n"
);
g(
  "rich_text__all_annotations_combined",
  one(B.pr([text("Everything", { bold: true, italic: true, strikethrough: true, underline: true })])),
  "<u>***~~Everything~~***</u>\n"
);
g("rich_text__inline_equation", one(B.pr([{ type: "equation", expression: "x^2 + y^2 = r^2" }])), "$x^2 + y^2 = r^2$\n");

g("lists__single_bulleted_item", renderBlocks([B.ul("Single bullet")]), "- Single bullet\n");
g("lists__multiple_bulleted_items", renderBlocks([B.ul("First"), B.ul("Second"), B.ul("Third")]), "- First\n- Second\n- Third\n");
g("lists__single_numbered_item", renderBlocks([B.ol("Only item")]), "1. Only item\n");
g("lists__multiple_numbered_items", renderBlocks([B.ol("First"), B.ol("Second"), B.ol("Third")]), "1. First\n2. Second\n3. Third\n");
g("lists__nested_bulleted_list", renderBlocks([B.ul("Parent", [B.ul("Child A"), B.ul("Child B")]), B.ul("Sibling")]), "- Parent\n   - Child A\n   - Child B\n- Sibling\n");
g("lists__nested_numbered_list", renderBlocks([B.ol("Parent", [B.ol("Sub 1"), B.ol("Sub 2")]), B.ol("Next parent")]), "1. Parent\n   1. Sub 1\n   2. Sub 2\n2. Next parent\n");
g("lists__mixed_list_types", renderBlocks([B.ul("Bullet A"), B.ul("Bullet B"), B.ol("Number 1"), B.ol("Number 2")]), "- Bullet A\n- Bullet B\n1. Number 1\n1. Number 2\n");
g(
  "lists__todo_list_mixed",
  renderBlocks([B.todo("Buy groceries", true), B.todo("Clean house", false), B.todo("Read book", true), B.todo("Exercise", false)]),
  "- [x] Buy groceries\n- [ ] Clean house\n- [x] Read book\n- [ ] Exercise\n"
);

g(
  "nesting__toggle_with_paragraph_children",
  one(B.toggle("Click to expand", [B.p("First paragraph inside toggle"), B.p("Second paragraph inside toggle")])),
  "▸ Click to expand\n  First paragraph inside toggle\n  Second paragraph inside toggle\n"
);
g("nesting__toggle_with_nested_toggles", one(B.toggle("Outer toggle", [B.toggle("Inner toggle", [B.p("Deeply nested content")])])), "▸ Outer toggle\n  ▸ Inner toggle\n    Deeply nested content\n");
g("nesting__quote_block_with_children", one(B.quote("Main quote", [B.p("Attribution or follow-up")])), "> Main quote\nAttribution or follow-up\n");
g(
  "nesting__callout_block_with_children",
  one(B.callout("Warning message", "⚠️", [B.p("Details about the warning"), B.ul("Step 1"), B.ul("Step 2")])),
  "> ⚠️  Warning message\nDetails about the warning\n- Step 1\n- Step 2\n"
);
g("nesting__bulleted_with_nested_bullets_3_levels", one(B.ul("Level 1", [B.ul("Level 2", [B.ul("Level 3")])])), "- Level 1\n   - Level 2\n      - Level 3\n");
g(
  "nesting__numbered_with_nested_numbered",
  renderBlocks([B.ol("Chapter 1", [B.ol("Section 1.1"), B.ol("Section 1.2")]), B.ol("Chapter 2", [B.ol("Section 2.1")])]),
  "1. Chapter 1\n   1. Section 1.1\n   2. Section 1.2\n2. Chapter 2\n   1. Section 2.1\n"
);
g(
  "nesting__heading_then_paragraphs_then_heading",
  renderBlocks([B.h1("Introduction"), B.p("First paragraph under intro."), B.p("Second paragraph under intro."), B.h2("Details"), B.p("Content under details.")]),
  "# Introduction\nFirst paragraph under intro.\nSecond paragraph under intro.\n## Details\nContent under details.\n"
);
g(
  "nesting__deep_nesting_5_levels",
  one(B.toggle("Level 1", [B.toggle("Level 2", [B.toggle("Level 3", [B.toggle("Level 4", [B.toggle("Level 5", [B.p("Bottom")])])])])])),
  "▸ Level 1\n  ▸ Level 2\n    ▸ Level 3\n      ▸ Level 4\n        ▸ Level 5\n          Bottom\n"
);

g("tables__simple_table_with_header", one(B.table(3, true, [["Name", "Age", "City"], ["Alice", "30", "NYC"], ["Bob", "25", "SF"]])), "| Name | Age | City |\n| --- | --- | --- |\n| Alice | 30 | NYC |\n| Bob | 25 | SF |\n");
g("tables__simple_table_without_header", one(B.table(2, false, [["A1", "B1"], ["A2", "B2"]])), "| A1 | B1 |\n| --- | --- |\n| A2 | B2 |\n");
g(
  "tables__table_with_empty_cells",
  one(B.table(3, true, [["Header 1", "Header 2", "Header 3"], ["Data", "", "More data"], ["", "Only middle", ""]])),
  "| Header 1 | Header 2 | Header 3 |\n| --- | --- | --- |\n| Data |  | More data |\n|  | Only middle |  |\n"
);
g("tables__table_single_column", one(B.table(1, true, [["Items"], ["Apple"], ["Banana"]])), "| Items |\n| --- |\n| Apple |\n| Banana |\n");
g("tables__table_many_columns", one(B.table(5, true, [["A", "B", "C", "D", "E"], ["1", "2", "3", "4", "5"]])), "| A | B | C | D | E |\n| --- | --- | --- | --- | --- |\n| 1 | 2 | 3 | 4 | 5 |\n");

const tracker: PDatabase = {
  id: DB_ID,
  title: "Project Tracker",
  schema: [
    { name: "Name", type: "title" },
    { name: "Status", type: "status" },
    { name: "Priority", type: "select" },
  ],
  rows: [row(nid(), "Task 1"), row(nid(), "Task 2")],
};
g(
  "databases__database_summary_simple",
  composeDatabaseSummary(tracker),
  "# Project Tracker\n\n## Schema\n\n| Property | Type |\n|----------|------|\n| Name | title |\n| Priority | select |\n| Status | status |\n\n## Data\n\nDatabase contains 2 pages.\n## Metadata\n\n- **Database ID**: 00000000000000000000000000000003\n"
);
g(
  "databases__database_summary_empty",
  composeDatabaseSummary({ id: DB_ID, title: "Empty Database", schema: [{ name: "Title", type: "title" }], rows: [] }),
  "# Empty Database\n\n## Schema\n\n| Property | Type |\n|----------|------|\n| Title | title |\n\n## Data\n\n*Database has no rows.*\n## Metadata\n\n- **Database ID**: 00000000000000000000000000000003\n"
);
g(
  "databases__database_summary_many_property_types",
  composeDatabaseSummary({
    id: DB_ID,
    title: "Comprehensive DB",
    schema: [
      { name: "Name", type: "title" },
      { name: "Amount", type: "number" },
      { name: "Due Date", type: "date" },
      { name: "Assignee", type: "people" },
      { name: "Done", type: "checkbox" },
      { name: "Website", type: "url" },
      { name: "Email", type: "email" },
      { name: "Created", type: "created_time" },
    ],
    rows: [row(nid(), "Row 1")],
  }),
  "# Comprehensive DB\n\n## Schema\n\n| Property | Type |\n|----------|------|\n| Amount | number |\n| Assignee | people |\n| Created | created_time |\n| Done | checkbox |\n| Due Date | date |\n| Email | email |\n| Name | title |\n| Website | url |\n\n## Data\n\nDatabase contains 1 pages.\n## Metadata\n\n- **Database ID**: 00000000000000000000000000000003\n"
);
g("databases__child_database_not_fetched", one(B.childDb("Key Highlights")), "🗄️ [[Key Highlights]]\n");
{
  const metrics: PDatabase = { id: "metrics", title: "Metrics", schema: [], rows: [] };
  g("databases__child_database_embedded", renderBlocks([B.fetchedDb("Metrics", "metrics")], { databases: { metrics } }), "🗄️ **Metrics**\n\n*No data available.*\n\n");
}

g(
  "pages__minimal_page",
  composePageMarkdown(page("My Page")),
  "# My Page\n\n## Properties\n\n\n## Metadata\n\n- **Page ID**: 00000000000000000000000000000002\n- **URL**: https://www.notion.so/00000000-0000-0000-0000-000000000002\n"
);
g(
  "pages__page_with_content",
  composePageMarkdown(
    page("Development Guide", [
      B.h1("Getting Started"),
      B.p("Welcome to the development guide."),
      B.h2("Installation"),
      B.code("cargo install notion2prompt", "bash"),
      B.h2("Usage"),
      B.p("Run the CLI with your Notion page URL."),
    ])
  ),
  "# Development Guide\n\n## Properties\n\n\n# Getting Started\nWelcome to the development guide.\n## Installation\n```bash\ncargo install notion2prompt\n```\n## Usage\nRun the CLI with your Notion page URL.\n\n## Metadata\n\n- **Page ID**: 00000000000000000000000000000002\n- **URL**: https://www.notion.so/00000000-0000-0000-0000-000000000002\n"
);
g(
  "pages__page_with_props",
  composePageMarkdown(
    page("Feature Spec", [B.p("Description of the feature.")], [
      { name: "Name", value: title("Feature Spec") },
      { name: "Status", value: select("In Progress") },
      { name: "Priority", value: select("High") },
      { name: "Done", value: { type: "checkbox", checked: false } },
    ])
  ),
  "# Feature Spec\n\n## Properties\n\n- **Done**: ⬜\n- **Priority**: High\n- **Status**: In Progress\n\nDescription of the feature.\n\n## Metadata\n\n- **Page ID**: 00000000000000000000000000000002\n- **URL**: https://www.notion.so/00000000-0000-0000-0000-000000000002\n"
);
g(
  "pages__full_page",
  composePageMarkdown(
    page(
      "Weekly Standup Notes",
      [
        B.h1("Summary"),
        B.p("This week's key accomplishments."),
        B.ul("Shipped feature X"),
        B.ul("Fixed critical bug Y"),
        B.h2("Action Items"),
        B.todo("Follow up with design team", false),
        B.todo("Deploy to production", true),
        B.divider(),
        B.h2("Resources"),
        B.bookmark("https://docs.example.com"),
        B.code("SELECT * FROM users;", "sql"),
      ],
      [{ name: "Date", value: { type: "date", start: "2026-02-16" } }]
    )
  ),
  "# Weekly Standup Notes\n\n## Properties\n\n- **Date**: 2026-02-16\n\n# Summary\nThis week's key accomplishments.\n- Shipped feature X\n- Fixed critical bug Y\n## Action Items\n- [ ] Follow up with design team\n- [x] Deploy to production\n---\n## Resources\n[🔖 https://docs.example.com]\n```sql\nSELECT * FROM users;\n```\n\n## Metadata\n\n- **Page ID**: 00000000000000000000000000000002\n- **URL**: https://www.notion.so/00000000-0000-0000-0000-000000000002\n"
);
g(
  "pages__page_with_varied_blocks",
  composePageMarkdown(
    page("Block Showcase", [
      B.h1("Text Blocks"),
      B.p("A simple paragraph."),
      B.quote("A thoughtful quote."),
      B.callout("Take note!", "📝"),
      B.h2("Lists"),
      B.ul("Bullet A"),
      B.ul("Bullet B"),
      B.ol("Step 1"),
      B.ol("Step 2"),
      B.h2("Media"),
      B.image("https://example.com/img.png"),
      B.divider(),
      B.h2("Code"),
      B.code("console.log('hello')", "javascript"),
      B.equation("\\int_0^1 x^2 dx = \\frac{1}{3}"),
    ])
  ),
  "# Block Showcase\n\n## Properties\n\n\n# Text Blocks\nA simple paragraph.\n> A thoughtful quote.\n> 📝  Take note!\n## Lists\n- Bullet A\n- Bullet B\n1. Step 1\n1. Step 2\n## Media\n![Image](https://example.com/img.png)\n---\n## Code\n```javascript\nconsole.log('hello')\n```\n$$\n\\int_0^1 x^2 dx = \\frac{1}{3}\n$$\n\n## Metadata\n\n- **Page ID**: 00000000000000000000000000000002\n- **URL**: https://www.notion.so/00000000-0000-0000-0000-000000000002\n"
);

g("integration__jetbrains_blocks", renderBlocks([B.p("This is a collaboration between Flow AI and JetBrains.")]), "This is a collaboration between Flow AI and JetBrains.\n");
g("integration__aie_agents_blocks", renderBlocks([B.childDb("Key Highlights"), B.p(""), B.h2("Videos (not from conference)")]), "🗄️ [[Key Highlights]]\n\n## Videos (not from conference)\n");
g(
  "integration__amundi_blocks",
  renderBlocks([
    B.toggler([text("Project Overview", { bold: true })]),
    B.p("This project integrates Flow AI's advanced capabilities with Amundi's technology infrastructure to enhance portfolio management and risk analysis."),
    B.olr([text("Key Features", { bold: true })]),
    B.ul("Real-time market data analysis"),
    B.ul("Automated risk assessment"),
    B.childDb("Implementation Timeline"),
  ]),
  "▸ **Project Overview**\nThis project integrates Flow AI's advanced capabilities with Amundi's technology infrastructure to enhance portfolio management and risk analysis.\n1. **Key Features**\n- Real-time market data analysis\n- Automated risk assessment\n🗄️ [[Implementation Timeline]]\n"
);
g(
  "integration__key_highlights_db_summary",
  composeDatabaseSummary({
    id: "1abcd412-8533-800c-984c-f7a33514bc7d",
    title: "Key Highlights",
    schema: [
      { name: "Name", type: "title" },
      { name: "Category", type: "select" },
      { name: "Priority", type: "select" },
    ],
    rows: [],
  }),
  "# Key Highlights\n\n## Schema\n\n| Property | Type |\n|----------|------|\n| Category | select |\n| Name | title |\n| Priority | select |\n\n## Data\n\n*Database has no rows.*\n## Metadata\n\n- **Database ID**: 1abcd4128533800c984cf7a33514bc7d\n"
);

// tests/snapshots/end_to_end_child_database_output.md
{
  const hl = (name: string, cat: string, pri: string) => ({
    ...row(nid(), name),
    properties: [
      { name: "Name", value: title(name) },
      { name: "Category", value: select(cat) },
      { name: "Priority", value: select(pri) },
    ],
  });
  const kh: PDatabase = {
    id: "kh",
    title: "Key Highlights",
    schema: [
      { name: "Name", type: "title" },
      { name: "Category", type: "select" },
      { name: "Priority", type: "select" },
    ],
    rows: [
      hl("Agent Engineering is the new Software Engineering", "AI/ML", "High"),
      hl("Evaluation frameworks critical for agent success", "Technology", "High"),
      hl("Enterprise AI must show real ROI, not just demos", "Business", "Medium"),
    ],
  };
  const body = renderBlocks([B.fetchedDb("Key Highlights", "kh"), B.p(""), B.h2("Videos (not from conference)")], { databases: { kh } });
  eq(
    "end_to_end_child_database_output.md",
    `# AIE Agents at Work - NYC 2025 \n\n${body}`,
    "# AIE Agents at Work - NYC 2025 \n\n🗄️ **Key Highlights**\n\n  | Name |Category |Priority |\n  | --- | --- | --- |\n  | Agent Engineering is the new Software Engineering |AI/ML |High |\n  | Evaluation frameworks critical for agent success |Technology |High |\n  | Enterprise AI must show real ROI, not just demos |Business |Medium |\n  \n## Videos (not from conference)\n"
  );
  const snaps = process.env.N2P_SNAPSHOTS;
  if (snaps) {
    const e2e = path.join(snaps, "end_to_end_child_database_output.md");
    if (fs.existsSync(e2e)) eq("end_to_end (vs file)", `# AIE Agents at Work - NYC 2025 \n\n${body}`, fs.readFileSync(e2e, "utf8"));
  }
}

// derived from notion2prompt's code (no snapshot upstream)
{
  const chores: PDatabase = {
    id: "chores",
    title: "Chores",
    schema: [
      { name: "Name", type: "title" },
      { name: "Done", type: "checkbox" },
      { name: "Points", type: "number" },
      { name: "Due", type: "date" },
      { name: "Tags", type: "multi_select" },
    ],
    rows: [
      {
        id: "00000000-0000-0000-0000-000000000021",
        title: "Dishes",
        url: "",
        blocks: [],
        properties: [
          { name: "Name", value: title("Dishes") },
          { name: "Done", value: { type: "checkbox", checked: true } },
          { name: "Points", value: { type: "number", number: 3 } },
          { name: "Due", value: { type: "date", start: "2026-09-20" } },
          { name: "Tags", value: { type: "multi_select", names: ["home", "daily"] } },
        ],
      },
      {
        id: "00000000000000000000000000000022",
        title: "",
        url: "",
        blocks: [],
        properties: [
          { name: "Name", value: title("") },
          { name: "Done", value: { type: "checkbox", checked: false } },
          { name: "Points", value: { type: "number", number: null } },
          { name: "Due", value: { type: "date", start: null } },
          { name: "Tags", value: { type: "multi_select", names: [] } },
        ],
      },
    ],
  };
  g(
    "derived__inline_db_alignment_and_untitled",
    renderBlocks([B.fetchedDb("Chores", "chores")], { databases: { chores } }),
    "🗄️ **Chores**\n\n  | Name |Done |Due |Points |Tags |\n  | --- | :---: | :---: | ---: | --- |\n  | Dishes |✅ |2026-09-20 |3 |home, daily |\n  | *Untitled Row (00000000000000000000000000000022)* |⬜ | | | |\n  "
  );
  g(
    "derived__list_run_restart_and_container_numbering",
    renderBlocks([B.ol("A"), B.ol("B"), B.p("P"), B.ol("C"), B.toggle("T", [B.ol("x"), B.ol("y")])]),
    "1. A\n2. B\nP\n1. C\n▸ T\n  1. x\n  1. y\n"
  );
  g(
    "derived__misc_placeholders",
    renderBlocks([B.callout("No icon", null), B.h1(""), B.linkedDb("Linked"), B.toc()]),
    ">  No icon\n# \n🗄️ **Linked** _(linked database — not retrievable via API)_\n[Table of Contents - No headings found]\n"
  );
  g(
    "derived__numbered_in_bullet_started_run_and_bullets_in_numbered_run",
    renderBlocks([B.ol("1st"), B.ul("dot"), B.ol("2nd"), B.p("stop"), B.ul("b", [B.ol("in bullet"), B.ol("again")])]),
    "1. 1st\n- dot\n2. 2nd\nstop\n- b\n   1. in bullet\n   1. again\n"
  );
  g(
    "derived__rich_text_mentions_and_links",
    renderBlocks([
      B.pr([
        { type: "mention", mention: { type: "user", id: "u1", name: "Mom" }, plainText: "Mom" },
        text(" "),
        { type: "mention", mention: { type: "page", id: "aabbccddaabbccddaabbccddaabbccdd" }, plainText: "Chuseok" },
        text(" "),
        { type: "mention", mention: { type: "date", start: "2026-10-03T09:00:00+09:00", end: "2026-10-05" }, plainText: "", annotations: { bold: true } },
        text(" "),
        { type: "mention", mention: { type: "link_mention", url: "ftp://x" }, plainText: "odd" },
        text(" "),
        text("Key Highlights table", undefined, null),
        { type: "text", content: " db", link: "https://www.notion.so/ws/Tracker-aabbccddaabbccddaabbccddaabbccdd" },
        text(" "),
        text("bold link", { bold: true }, "https://example.com"),
      ]),
    ]),
    "@Mom [Chuseok](https://www.notion.so/aabbccdd-aabb-ccdd-aabb-ccddaabbccdd) ****2026-10-03 → 2026-10-05**** [odd (invalid URL: ftp://x)](about:blank) Key Highlights table📊 **Child Database:** [ db](https://www.notion.so/aabbccdd-aabb-ccdd-aabb-ccddaabbccdd) [**bold link**](https://example.com)\n"
  );
}

for (const [name, got, want] of golden) eq(name, got, want);
{
  const dir = process.env.N2P_SNAPSHOTS;
  if (dir) {
    let compared = 0;
    for (const [name, got] of golden) {
      const f = path.join(dir, `snapshot_tests__${name}.snap`);
      if (!fs.existsSync(f)) continue;
      const raw = fs.readFileSync(f, "utf8");
      const body = raw.replace(/^---\n[\s\S]*?\n---\n/, "");
      // insta compares with trailing newlines trimmed; sorted property/schema lines are
      // what the snapshot tests normalise to, as the renderer here always writes them
      eq(`${name} (vs .snap)`, got.trimEnd(), body.trimEnd());
      compared++;
    }
    ok("compared against notion2prompt's .snap files", compared >= 60, `${compared} compared`);
    console.log(`  (${compared} snapshots compared with ${dir})`);
  }
}

// number formatting (format_number_auto, Rust {:.2} ties to even)
eq("number 42", formatNumberAuto(42), "42");
eq("number -3", formatNumberAuto(-3), "-3");
eq("number 3.14159", formatNumberAuto(3.14159), "3.14");
eq("number 2.5", formatNumberAuto(2.5), "2.5");
eq("number 0.125 (tie → even)", formatNumberAuto(0.125), "0.12");
eq("number 0.375 (tie → even)", formatNumberAuto(0.375), "0.38");
eq("number 3.001", formatNumberAuto(3.001), "3");

// ── templates ─────────────────────────────────────────────────────────────────
const contentOf = (root: PromptContent["root"], pages: Record<string, PPage>, dbs: Record<string, PDatabase> = {}, tree?: PromptContent["tree"]): PromptContent => ({
  version: 1,
  root,
  pages,
  databases: dbs,
  tree: tree ?? { kind: root.kind === "database" ? "database" : "page", id: root.kind === "block" ? root.block.id : root.id, title: "", children: [] },
  location: { segments: ["Kim family", "Our family"] },
  stats: { pages: 0, databases: 0, rows: 0, blocks: 0, items: 0, maxDepthReached: 0, depthLimited: false, limitReached: false },
  skipped: [],
  options: { depth: 5, limit: 1000, childPages: true, alwaysFetchDatabases: false },
});
const n2p = { layout: "notion2prompt" as const, includeProperties: false };
{
  const myPage = page("My Page");
  const c = contentOf({ kind: "page", id: PAGE_ID }, { [PAGE_ID]: myPage });
  const fileBlock =
    "<files>\n<file>\n<path>My Page_00000000000000000000000000000002.md</path>\n<content>\n# My Page\n\n## Metadata\n\n- **Page ID**: 00000000000000000000000000000002\n- **URL**: https://www.notion.so/00000000-0000-0000-0000-000000000002\n\n</content>\n</file>\n</files>\n\n";
  const head = "<project_path>/direct_template</project_path>\n\n<source_tree>\n```\ndirect_template/\n└── My Page_00000000000000000000000000000002.md\n\n```\n</source_tree>\n\n";
  eq("template__page_no_instruction", renderPrompt(c, n2p).prompt, head + fileBlock);
  eq("template__default_is_claude_xml", renderPrompt(c, { ...n2p, template: "default" }).prompt, head + fileBlock);
  eq(
    "template__page_with_instruction",
    renderPrompt(c, { ...n2p, instruction: "Summarize this page." }).prompt,
    head +
      fileBlock +
      "<instructions>\nSummarize this page.\n</instructions>\n\n<final_instruction>\nConsider the project path in <project_path>, the source tree in <source_tree>, and the files in <files>. Then, follow the instructions given in <instructions>. Take a deep breath and think step by step about how to best complete this task.\n</final_instruction>\n"
  );
  // upstream hands the instruction to handlebars as it is, and "   " is truthy there: the block stays (the ainmem layout drops it)
  eq("template__blank_instruction_kept", renderPrompt(c, { ...n2p, instruction: "   " }).prompt, head + fileBlock + "<instructions>\n   \n</instructions>\n\n<final_instruction>\nConsider the project path in <project_path>, the source tree in <source_tree>, and the files in <files>. Then, follow the instructions given in <instructions>. Take a deep breath and think step by step about how to best complete this task.\n</final_instruction>\n");

  const t1 = row("00000000-0000-0000-0000-000000000011", "Task 1");
  const t2 = row("00000000-0000-0000-0000-000000000012", "Task 2");
  const db2: PDatabase = { ...tracker, rows: [t1, t2] };
  const dc = contentOf({ kind: "database", id: DB_ID }, {}, { [DB_ID]: db2 });
  eq(
    "template__database_root_two_rows",
    renderPrompt(dc, n2p).prompt,
    "<project_path>/direct_template</project_path>\n\n<source_tree>\n```\ndirect_template/\n└── Project Tracker_00000000000000000000000000000003.md\n└── Task 1_00000000000000000000000000000011.md\n└── Task 2_00000000000000000000000000000012.md\n\n```\n</source_tree>\n\n<files>\n<file>\n<path>Project Tracker_00000000000000000000000000000003.md</path>\n<content>\n# Project Tracker\n\n## Schema\n\n| Property | Type |\n|----------|------|\n| Name | title |\n| Priority | select |\n| Status | status |\n\n## Data\n\nDatabase contains 2 pages.\n## Metadata\n\n- **Database ID**: 00000000000000000000000000000003\n\n</content>\n</file>\n<file>\n<path>Task 1_00000000000000000000000000000011.md</path>\n<content>\n# Task 1\n\n## Metadata\n\n- **Page ID**: 00000000000000000000000000000011\n- **URL**: https://www.notion.so/00000000000000000000000000000011\n\n</content>\n</file>\n<file>\n<path>Task 2_00000000000000000000000000000012.md</path>\n<content>\n# Task 2\n\n## Metadata\n\n- **Page ID**: 00000000000000000000000000000012\n- **URL**: https://www.notion.so/00000000000000000000000000000012\n\n</content>\n</file>\n</files>\n\n"
  );
  // the block root
  const blk = B.p("Just this.");
  const bc = contentOf({ kind: "block", block: blk, pageId: PAGE_ID }, {});
  const r = renderPrompt(bc, n2p);
  eq("block root file", r.files[0]?.code ?? "", `# Block ${blk.id.replace(/-/g, "")}\n\nJust this.\n`);
  eq("block root path", r.files[0]?.path ?? "", `block_${blk.id.replace(/-/g, "")}.md`);
  // path escaping ({{path}} is HTML-escaped) and the markdown template
  eq("template path escape", renderTemplate("<path>{{path}}</path>", { path: `a&b'c\`d=e<>"` }), "<path>a&amp;b&#x27;c&#x60;d&#x3D;e&lt;&gt;&quot;</path>");
  const md = renderPrompt(c, { template: "markdown", layout: "ainmem", includeProperties: false, instruction: "Summarize." }).prompt;
  ok("markdown template: no XML", !md.includes("<files>") && !md.includes("<project_path>"));
  ok("markdown template: file and instruction", md.includes("# My Page\n") && md.includes("## Instructions\n\nSummarize.\n"));
}

// filenames
eq("clean_filename", cleanFilename('a/b:c*d?"e<f>g|h', "id"), "a_b_c_d__e_f_g_h_id.md");
eq("clean_filename empty", cleanFilename(" .. ", "id"), "Untitled Page_id.md");
eq("sanitize long Hangul on a char boundary", sanitizeFilename(K.longTitle), K.longTitle.slice(0, 33));
eq(
  "source tree drawing",
  drawTree("Our family/", ["Hub.md", "Hub/A.md", "Hub/A/C.md", "Hub/B.md"]),
  "Our family/\n├── Hub.md\n└── Hub/\n    ├── A.md\n    ├── A/\n    │   └── C.md\n    └── B.md\n"
);

// ── 2. fetch stage on memory ─────────────────────────────────────────────────

interface MemPage {
  title: string;
  blocks: PBlock[];
  childPageIds?: string[];
  properties?: PPage["properties"];
  /** who may see it; undefined = everyone */
  only?: string[];
}
interface MemDb {
  title: string;
  schema: PDatabase["schema"];
  rows: (PPage & { hasPage?: boolean })[];
  only?: string[];
}
function memSource(pages: Record<string, MemPage>, dbs: Record<string, MemDb>, viewers: string[], log?: string[]): PromptSource {
  const sees = (only?: string[]) => viewers.length > 0 && viewers.every((v) => !only || only.includes(v));
  return {
    async page(id) {
      log?.push(`page:${id}`);
      const p = pages[id];
      if (!p) return null;
      return {
        id,
        title: p.title,
        url: `/p/${id}`,
        properties: p.properties ?? [],
        blocks: structuredClone(p.blocks),
        childPageIds: p.childPageIds ?? [],
      } satisfies SourcePage;
    },
    async database(id) {
      log?.push(`db:${id}`);
      const d = dbs[id];
      return d ? ({ id, title: d.title, schema: d.schema, rows: structuredClone(d.rows) } satisfies SourceDatabase) : null;
    },
    async block(id) {
      for (const [pid, p] of Object.entries(pages)) {
        const find = (bs: PBlock[]): PBlock | undefined => {
          for (const b of bs) {
            if (b.id === id) return b;
            const f = b.children ? find(b.children) : undefined;
            if (f) return f;
          }
        };
        const f = find(p.blocks);
        if (f) return { block: structuredClone(f), pageId: pid };
      }
      return null;
    },
    async canSee(kind, id) {
      return sees(kind === "page" ? pages[id]?.only : dbs[id]?.only) && (kind === "page" ? !!pages[id] : !!dbs[id]);
    },
    async title(kind, id) {
      return kind === "page" ? (pages[id]?.title ?? null) : (dbs[id]?.title ?? null);
    },
    async location() {
      return ["Kim family", "Our family"];
    },
  };
}

const ALL = ["mom", "dad", "grandma"];
const P = {
  hub: "hub",
  a: "page-a",
  b: "page-b",
  c: "page-c",
  secret: "page-secret",
  sub: "page-sub",
};
const SECRET = "Grandma's birthday surprise";
function family(): { pages: Record<string, MemPage>; dbs: Record<string, MemDb> } {
  return {
    pages: {
      [P.hub]: {
        title: "Chuseok hub",
        blocks: [
          B.callout("Everything for Chuseok", "🎑"),
          B.linkToPage(P.a),
          B.childPage("stale title", P.b),
          B.linkToPage(P.secret),
          B.fetchedDb("", "chores"),
          B.childDb("", "secret-db"),
        ],
        childPageIds: [P.sub, P.secret],
      },
      [P.a]: { title: "Schedule", blocks: [B.p("Leave at 7."), B.linkToPage(P.c), B.linkToPage(P.hub)] },
      [P.b]: { title: "Food", blocks: [B.ol("Songpyeon"), B.ol("Jeon"), B.linkToPage(P.a)] },
      [P.c]: { title: "Drive down", blocks: [B.p("Take the coast road.")] },
      [P.sub]: { title: "Notes", blocks: [B.p("A sub-page by parent link.")] },
      [P.secret]: { title: SECRET, blocks: [B.p("Do not tell grandma.")], only: ["mom", "dad"] },
    },
    dbs: {
      chores: {
        title: "Chores",
        schema: [
          { name: "Task", type: "title" },
          { name: "Due", type: "date" },
        ],
        rows: [
          { id: "r1", title: "Sweep", url: "", blocks: [], properties: [{ name: "Task", value: title("Sweep") }, { name: "Due", value: { type: "date", start: "2026-10-01" } }] },
          { id: "r2", title: "Cook", url: "", blocks: [], properties: [{ name: "Task", value: title("Cook") }, { name: "Due", value: { type: "date", start: "2026-10-03" } }] },
        ],
      },
      "secret-db": { title: "Gift budget (secret)", schema: [{ name: "Item", type: "title" }], rows: [], only: ["mom", "dad"] },
    },
  };
}

async function run(viewers: string[], opts: Parameters<typeof collect>[1] = {}, root = { kind: "page" as const, id: P.hub }, log?: string[]) {
  const f = family();
  return collect(root, opts, memSource(f.pages, f.dbs, viewers, log));
}
const allText = (c: PromptContent) => renderPrompt(c, { separateChildPages: true }).prompt + JSON.stringify(c);

{
  // everyone, default options: the whole tree, grandma's secret left out for her sake
  const c = await run(ALL);
  ok("default: hub, Schedule, Food, Drive down, Notes read", ["hub", P.a, P.b, P.c, P.sub].every((id) => c.pages[id]), Object.keys(c.pages).join(","));
  ok("permission: the secret page is not read", !c.pages[P.secret]);
  ok("permission: no trace of its title or its database's", !allText(c).includes(SECRET) && !allText(c).includes("Gift budget"));
  ok("permission: reported by id and reason", c.skipped.some((s) => s.reason === "permission" && s.id === P.secret) && c.skipped.some((s) => s.reason === "permission" && s.id === "secret-db"));
  const hubMd = renderPrompt(c, { includeProperties: "auto" }).files[0].code;
  ok("link_to_page to a hidden page stays an id", hubMd.includes(`[[${P.secret}]]`));
  ok("hidden database placeholder", hubMd.includes("🗄️ [[Restricted database]]"));
  ok("child_page title refreshed from the page", hubMd.includes("📄 [[Food]]") && !hubMd.includes("stale title"));
  ok("parent-linked child gets a sub-page block", hubMd.includes("📄 [[Notes]]"));
  ok("hidden parent-linked child is left out entirely", !hubMd.includes("Restricted page"));
  ok("inline database resolved, newest first", hubMd.includes("🗄️ **Chores**\n\n  | Task |Due |\n  | --- | :---: |\n  | Cook |2026-10-03 |\n  | Sweep |2026-10-01 |\n  "));
  ok("cycle: the hub linked back from Schedule is not read again", c.skipped.some((s) => s.reason === "cycle" && s.id === P.hub));
  ok("duplicate: Schedule linked from Food is read once", c.skipped.some((s) => s.reason === "duplicate" && s.id === P.a));
  ok("tree order", c.tree.children.map((x) => x.id).join(",") === `${P.a},${P.b},chores,${P.sub}`, c.tree.children.map((x) => x.id).join(","));
  ok("stats", c.stats.pages === 5 && c.stats.databases === 1 && c.stats.rows === 2 && !c.stats.depthLimited && !c.stats.limitReached, JSON.stringify(c.stats));

  // mom and dad alone see the secret
  const c2 = await run(["mom", "dad"]);
  ok("readers who may see it get the secret page", !!c2.pages[P.secret] && renderPrompt(c2).prompt.includes("Do not tell grandma."));
  ok("…and the secret database", renderPrompt(c2, { separateChildPages: true }).prompt.includes("🗄️ **Gift budget (secret)**"));

  // the root itself hidden
  let threw = false;
  try {
    await run(["grandma"], {}, { kind: "page", id: P.secret });
  } catch (e) {
    threw = e instanceof PromptNotFound;
  }
  ok("a root the reader may not see is not found", threw);
  let threw2 = false;
  try {
    await run([], {});
  } catch (e) {
    threw2 = e instanceof PromptNotFound;
  }
  ok("no readers, nothing visible", threw2);
}
{
  const d0 = await run(ALL, { depth: 0 });
  ok("depth 0: the root alone", Object.keys(d0.pages).join() === "hub" && d0.stats.depthLimited);
  ok("depth 0: databases not resolved either", renderPrompt(d0).files[0].code.includes("🗄️ [[Chores]]"));
  const d0db = await run(ALL, { depth: 0, alwaysFetchDatabases: true });
  ok("depth 0 + always-fetch-databases: the table is there", renderPrompt(d0db).files[0].code.includes("🗄️ **Chores**"));
  const d1 = await run(ALL, { depth: 1 });
  ok("depth 1: root + its child pages", !!d1.pages[P.a] && !!d1.pages[P.b] && !d1.pages[P.c], Object.keys(d1.pages).join());
  ok("depth 1: the grandchild is skipped for depth", d1.skipped.some((s) => s.reason === "depth" && s.id === P.c));
  const d2 = await run(ALL, { depth: 2 });
  ok("depth 2: grandchild read", !!d2.pages[P.c] && d2.stats.maxDepthReached === 2);
  const off = await run(ALL, { childPages: false });
  ok("child pages off: only the root, placeholders titled", Object.keys(off.pages).join() === "hub" && renderPrompt(off).files[0].code.includes("📄 [[Schedule]]"));
  const lim = await run(ALL, { limit: 4 });
  ok("limit 4: root + 3 blocks, cut and reported", lim.stats.items === 4 && lim.stats.limitReached && lim.pages.hub.blocks.length === 3, JSON.stringify(lim.stats));
  ok("limit: nothing past it is read", Object.keys(lim.pages).join() === "hub");
  const log: string[] = [];
  await run(ALL, { depth: 50 }, { kind: "page", id: P.hub }, log);
  ok("cycles: every page read once", new Set(log).size === log.length, log.join(" "));
}
{
  // separate vs merged
  const c = await run(ALL, { depth: 2 });
  const sep = renderPrompt(c, { separateChildPages: true });
  eq(
    "separate: one file per page, breadcrumb paths",
    sep.files.map((f) => f.path).join(" | "),
    "Chuseok hub.md | Chuseok hub/Schedule.md | Chuseok hub/Schedule/Drive down.md | Chuseok hub/Food.md | Chuseok hub/Notes.md"
  );
  eq("separate: project path is the workspace/teamspace", sep.projectPath, "/Kim family/Our family");
  ok("separate: the source tree is the page tree", sep.sourceTree.startsWith("Our family/\n├── Chuseok hub.md\n└── Chuseok hub/\n    ├── Schedule.md\n    ├── Schedule/\n    │   └── Drive down.md\n"), sep.sourceTree);
  const merged = renderPrompt(c, { separateChildPages: false });
  ok("merged: one file", merged.files.length === 1);
  const m = merged.files[0].code;
  ok("merged: the child follows its placeholder", m.includes("📄 [[Schedule]]\n# Schedule\n\n"));
  ok("merged: grandchild inside the child", m.indexOf("# Drive down") > m.indexOf("# Schedule") && m.indexOf("# Drive down") < m.indexOf("# Food"));
  ok("merged: a page linked twice appears once", m.split("# Schedule\n").length === 2);
  const up = renderPrompt(c, { layout: "notion2prompt", separateChildPages: true });
  ok("notion2prompt layout: /direct_template, flat tree, title_id.md", up.projectPath === "/direct_template" && up.sourceTree.startsWith("direct_template/\n└── Chuseok hub_hub.md\n└── Schedule_page-a.md\n"), up.sourceTree);
}
{
  // a database as the root: summary + one file per row; a row with a body is read
  const pages = family().pages;
  pages.r2 = { title: "Cook", blocks: [B.todo("Buy rice flour", false)] };
  const dbs = family().dbs;
  dbs.chores.rows[1] = { ...dbs.chores.rows[1], id: "r2", hasPage: true };
  const c = await collect({ kind: "database", id: "chores" }, {}, memSource(pages, dbs, ALL));
  const r = renderPrompt(c, { includeProperties: "auto" });
  eq("database root: files", r.files.map((f) => f.path).join(" | "), "Chores.md | Chores/Cook.md | Chores/Sweep.md");
  ok("database root: summary", r.files[0].code.startsWith("# Chores\n\n## Schema\n\n| Property | Type |\n|----------|------|\n| Due | date |\n| Task | title |\n\n## Data\n\nDatabase contains 2 pages.\n"));
  ok("database root: a row page with its body and properties", r.files[1].code === "# Cook\n\n## Properties\n\n- **Due**: 2026-10-03\n\n- [ ] Buy rice flour\n\n## Metadata\n\n- **Page ID**: r2\n- **URL**: /p/r2\n", r.files[1].code);
  const off = renderPrompt(c, { includeProperties: false });
  ok("properties off: no section", !off.files[1].code.includes("## Properties"));
  // a block as the root
  const blockId = family().pages[P.a].blocks[0].id;
  void blockId;
}
{
  const f = family();
  const target = f.pages[P.b].blocks[0];
  const c = await collect({ kind: "block", id: target.id }, {}, memSource(f.pages, f.dbs, ALL));
  const r = renderPrompt(c, { layout: "notion2prompt" });
  ok("block root", r.files.length === 1 && r.files[0].code.endsWith("1. Songpyeon\n") && r.files[0].path.startsWith("block_"));
}

// ── 4. reading requests ──────────────────────────────────────────────────────
eq("ref: hyphenated uuid", JSON.stringify(parseRef("AABBCCDD-AABB-CCDD-AABB-CCDDAABBCCDD")), JSON.stringify({ kind: "id", id: "aabbccdd-aabb-ccdd-aabb-ccddaabbccdd" }));
eq("ref: 32 hex", JSON.stringify(parseRef("aabbccddaabbccddaabbccddaabbccdd")), JSON.stringify({ kind: "id", id: "aabbccdd-aabb-ccdd-aabb-ccddaabbccdd" }));
eq("ref: braced", JSON.stringify(parseRef("{aabbccdd-aabb-ccdd-aabb-ccddaabbccdd}")), JSON.stringify({ kind: "id", id: "aabbccdd-aabb-ccdd-aabb-ccddaabbccdd" }));
eq("ref: notion url (object, not the view)", JSON.stringify(parseRef("https://notion.so/aabbccddaabbccddaabbccddaabbccdd?v=11112222333344445555666677778888")), JSON.stringify({ kind: "id", id: "aabbccdd-aabb-ccdd-aabb-ccddaabbccdd" }));
eq("ref: notion page url", JSON.stringify(parseRef("https://www.notion.so/ws/My-Page-aabbccddaabbccddaabbccddaabbccdd?pvs=4")), JSON.stringify({ kind: "id", id: "aabbccdd-aabb-ccdd-aabb-ccddaabbccdd" }));
eq("ref: ainmem link", JSON.stringify(parseRef("http://localhost:3110/p/aabbccdd-aabb-ccdd-aabb-ccddaabbccdd/")), JSON.stringify({ kind: "id", id: "aabbccdd-aabb-ccdd-aabb-ccddaabbccdd" }));
eq("ref: ainmem OKF link", JSON.stringify(parseRef("/p/Zm9vL2Jhci5tZA")), JSON.stringify({ kind: "id", id: "Zm9vL2Jhci5tZA" }));
eq("ref: a title", JSON.stringify(parseRef("Chuseok hub")), JSON.stringify({ kind: "title", query: "Chuseok hub" }));
eq("ref in a sentence", findRefInText("@agent make a prompt of /p/aabbccdd-aabb-ccdd-aabb-ccddaabbccdd please") ?? "", "aabbccdd-aabb-ccdd-aabb-ccddaabbccdd");

ok("asks: English", asksForPrompt("@agent make a prompt from the Chuseok page") && asksForPrompt("turn this page into an AI prompt") && asksForPrompt("@agent convert the Food page to a prompt"));
ok("asks: Korean", asksForPrompt(K.thisPage) && asksForPrompt(K.chuseok) && asksForPrompt(K.options) && asksForPrompt(K.merged));
ok("asks: not a passing mention", !asksForPrompt("what prompt did you use to make this album?") && !asksForPrompt("@agent make a Jeju album"));

{
  const r = parsePromptRequest('@agent make a prompt from the Chuseok page, depth 2, without child pages, merged, markdown template, instruction: "Plan the menu."');
  eq("en options", JSON.stringify({ ...r.fetch, ...r.render }), JSON.stringify({ depth: 2, childPages: false, instruction: "Plan the menu.", separateChildPages: false, template: "markdown" }));
  eq("en rest names the page", r.rest, "Chuseok");
  const k = parsePromptRequest(K.options);
  eq("ko options", JSON.stringify({ ...k.fetch, ...k.render }), JSON.stringify({ depth: 2, childPages: true, instruction: K.optionsInstruction, separateChildPages: true, template: "claude-xml" }));
  eq("ko rest names the page", k.rest, K.chuseokWord);
  ok("ko this page", parsePromptRequest(K.thisPage).thisPage && parsePromptRequest(K.thisPage).rest === "");
  ok("ko merged + markdown", parsePromptRequest(K.merged).render.separateChildPages === false && parsePromptRequest(K.merged).render.template === "markdown");
  ok("ko this page only", parsePromptRequest(K.noChild).fetch.childPages === false);
  const x = parsePromptRequest("@agent turn this page into a prompt with properties, always fetch databases, limit 200, notion2prompt format");
  ok("en this page + properties + dbs + limit + layout", x.thisPage && x.render.includeProperties === true && x.fetch.alwaysFetchDatabases === true && x.fetch.limit === 200 && x.render.layout === "notion2prompt", JSON.stringify(x));
}
ok("title: whole title said wins", scoreTitle("Chuseok hub", "Chuseok hub") > scoreTitle("Chuseok album", "Chuseok hub"));
ok("title: one shared word", scoreTitle(K.hubTitle, K.chuseokWord) === 10 && scoreTitle(K.albumTitle, K.chuseokWord) === 10);
ok("title: particles dropped", scoreTitle(K.scheduleTitle, `${K.chuseokWord}\uC744`) === 10);
ok("title: no match", scoreTitle("Jeju trip", K.chuseokWord) === 0);
ok("aliases: an English word finds the Korean title word", expandAliases("Chuseok").includes(K.chuseokWord) && scoreTitle(K.hubTitle, expandAliases("Chuseok")) === 10);
ok("covers: every asked word answered", coversAsked(K.hubTitle, K.chuseokWord) && coversAsked(K.hubTitle, "Chuseok") && coversAsked(K.scheduleTitle, `${K.chuseokWord}\uC744`));
ok("covers: a half match is not taken", !coversAsked(K.albumTitle, `${K.chuseokWord} birthday`));
ok("coverage: the shorter title wins a tie", titleCoverage(K.albumTitle, K.chuseokWord) > titleCoverage(K.hubTitle, K.chuseokWord));

// ── 5. ainmem → Notion shape ────────────────────────────────────────────────
{
  const ctx = { pageUrl: (id: string) => `https://app.example/p/${id}` };
  const html =
    '<b>Bold</b> and <i>it</i> <a href="https://x.y">link</a> <span class="mention" data-mention-type="person" data-mention-id="u1">@Mom</span> ' +
    '<a href="/p/abc12345" class="mention" data-mention-type="page" data-mention-id="abc12345">@Chuseok</a> <span class="eq" data-tex="x^2">$x^2$</span> ' +
    '<span class="mention" data-mention-type="date" data-mention-id="2026-10-03">@Oct 3</span> <span class="c-red">red</span> <s>old</s> <code>a &lt; b</code> <u>u</u><br>next';
  eq("html → markdown", richTextToMarkdown(htmlToRichText(html, ctx)), "**Bold** and *it* [link](https://x.y) @Mom [Chuseok](https://app.example/p/abc12345) $x^2$ **2026-10-03** red ~~old~~ `a < b` <u>u</u>\nnext");
  // one segment per style run, as Notion's API splits it — so notion2prompt writes this too
  eq("html: nested styles", richTextToMarkdown(htmlToRichText("<b>a <i>b</i></b>")), "**a *****b***");
  const raw = [
    { id: "t", type: "toggle", content: { text: "Packing" }, parentBlockId: null, position: 1 },
    { id: "t1", type: "todo", content: { text: "Socks", checked: true }, parentBlockId: "t", position: 1 },
    { id: "t2", type: "todo", content: { text: "Gifts" }, parentBlockId: "t", position: 2 },
    { id: "c", type: "callout", content: { text: "No icon", icon: null }, parentBlockId: null, position: 2 },
    { id: "c2", type: "callout", content: { text: "Default icon" }, parentBlockId: null, position: 3 },
    { id: "g", type: "file", content: { text: "Seoyeon's video", url: "https://drive.example/private", gift: { spec: { title: "For Seoyeon", payTo: "0xabc" } } }, parentBlockId: null, position: 4 },
    { id: "tb", type: "table", content: { table: { cells: [["Who", "What"], ["Mom", "Jeon"]], html: [["<b>Who</b>", "What"], ["Mom", "Jeon"]] } }, parentBlockId: null, position: 5 },
    { id: "ai", type: "ai_prompt", content: {}, parentBlockId: null, position: 6 },
    { id: "lp", type: "link_to_page", content: {}, parentBlockId: null, position: 7 },
    { id: "d", type: "database", content: { databaseId: "db1" }, parentBlockId: null, position: 8 },
    { id: "h", type: "heading2", content: { text: "Plan", html: "<i>Plan</i>" }, parentBlockId: null, position: 9 },
    { id: "tpl", type: "template_button", content: { text: "Add day", template: "- [ ] morning" }, parentBlockId: null, position: 10 },
    { id: "btn", type: "button", content: { text: "Open map" }, parentBlockId: null, position: 11 },
    { id: "eqb", type: "equation", content: { text: "a^2+b^2" }, parentBlockId: null, position: 12 },
    { id: "x", type: "mystery", content: {}, parentBlockId: null, position: 13 },
  ];
  const md = renderBlocks(nestBlocks(raw as Parameters<typeof nestBlocks>[0], ctx), { databases: {} });
  eq(
    "ainmem blocks → markdown",
    md,
    "▸ Packing\n  - [x] Socks\n  - [ ] Gifts\n>  No icon\n> 💡  Default icon\n[🎁 Gift: Seoyeon's video]\n| **Who** | What |\n| --- | --- |\n| Mom | Jeon |\n🗄️ [[]]\n## *Plan*\n[Template] Add day\n- [ ] morning\n[Button: Open map]\n$$\na^2+b^2\n$$\n[Unsupported block type: mystery]\n"
  );
  ok("gift: nothing behind it leaks", !md.includes("drive.example") && !md.includes("0xabc"));
  ok("mapBlock: code keeps its language, raw text", renderBlocks([mapBlock({ id: "k", type: "code", content: { text: "SELECT 1;", language: "sql", html: "<b>x</b>" } }, [], ctx)!]) === "```sql\nSELECT 1;\n```\n");
}

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
