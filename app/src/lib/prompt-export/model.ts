/**
 * The content tree the prompt export works on — notion2prompt's NotionObject
 * (Page | Database | Block) in the shape of Notion's own API objects, so the
 * render stage can follow notion2prompt's formatting rule for rule.
 *
 * Everything here is plain JSON: the fetch stage builds it (collect.ts, fed by
 * source-db.ts for Postgres + OKF), the HTTP API hands it out as the
 * "two-stage" library result, and the render stage (render.ts) turns it into
 * a prompt again without touching the database.
 *
 * ainmem's block types are mapped onto the nearest Notion type in map.ts; the
 * few with no Notion counterpart (gift, button) keep their own type here.
 */

export interface Annotations {
  bold?: boolean;
  italic?: boolean;
  strikethrough?: boolean;
  underline?: boolean;
  code?: boolean;
  /** kept for completeness; markdown has no colour, so the renderer ignores it */
  color?: string;
}

export type Mention =
  | { type: "user"; id: string; name?: string | null }
  /** `url` is where the page opens; notion2prompt's own default is https://www.notion.so/<hyphenated id> */
  | { type: "page"; id: string; url?: string }
  | { type: "database"; id: string; url?: string }
  | { type: "date"; start: string; end?: string | null }
  | { type: "link_preview" | "link_mention"; url: string }
  /** a kind the renderer does not know (template_mention …) — rendered as a link mention */
  | { type: "other"; kind: string; url?: string | null };

export type RichText =
  | { type: "text"; content: string; link?: string | null; href?: string | null; annotations?: Annotations; plainText?: string }
  | { type: "equation"; expression: string; href?: string | null; annotations?: Annotations; plainText?: string }
  | { type: "mention"; mention: Mention; plainText: string; href?: string | null; annotations?: Annotations };

export type Icon = { emoji: string } | { url: string } | null;

interface BlockBase {
  /** the block's id (a Postgres uuid, an OKF block id, or a synthetic id) */
  id: string;
  children?: PBlock[];
}

export type TextBlockType =
  | "paragraph"
  | "heading_1"
  | "heading_2"
  | "heading_3"
  | "bulleted_list_item"
  | "numbered_list_item"
  | "quote"
  | "toggle"
  | "template";

/** How a child database block was resolved by the fetch stage. */
export type ChildDbContent =
  | { state: "fetched"; databaseId: string }
  | { state: "linked" }
  | { state: "inaccessible" }
  | { state: "not_fetched"; databaseId?: string };

export type PBlock = BlockBase &
  (
    | { type: TextBlockType; richText: RichText[] }
    | { type: "to_do"; richText: RichText[]; checked: boolean }
    | { type: "callout"; richText: RichText[]; icon?: Icon }
    | { type: "code"; richText: RichText[]; language: string; caption?: RichText[] }
    | { type: "equation"; expression: string }
    | { type: "divider" | "breadcrumb" | "table_of_contents" | "column_list" | "column" }
    | { type: "image" | "video" | "file" | "pdf"; url: string; caption?: RichText[] }
    | { type: "bookmark"; url: string; caption?: RichText[] }
    | { type: "embed" | "link_preview"; url: string }
    | { type: "child_page"; title: string; pageId?: string }
    | { type: "child_database"; title: string; content: ChildDbContent }
    | { type: "link_to_page"; pageId: string; title?: string }
    | { type: "table"; width: number; hasColumnHeader?: boolean; hasRowHeader?: boolean }
    | { type: "table_row"; cells: RichText[][] }
    | { type: "synced_block"; syncedFrom?: string | null }
    | { type: "unsupported"; blockType: string }
    // ainmem-only
    | { type: "gift"; label: string }
    | { type: "button"; label: string }
  );

export interface PersonRef {
  id: string;
  name?: string | null;
  email?: string | null;
}

export type RollupItem =
  | { type: "title" | "rich_text"; richText: RichText[] }
  | { type: "number"; number: number }
  | { type: "date"; start: string }
  | { type: "text"; text: string };

/** A property value, Notion-shaped (notion2prompt's PropertyTypeValue). */
export type PValue =
  | { type: "title" | "rich_text"; richText: RichText[] }
  | { type: "number"; number: number | null }
  | { type: "select" | "status"; name: string | null }
  | { type: "multi_select"; names: string[] }
  | { type: "date"; start: string | null; end?: string | null }
  | { type: "people"; people: PersonRef[] }
  | { type: "files"; files: { name: string; url: string }[] }
  | { type: "checkbox"; checked: boolean }
  | { type: "url"; url: string | null }
  | { type: "email" | "phone_number"; value: string | null }
  | {
      type: "formula";
      formula:
        | { type: "string"; string: string | null }
        | { type: "number"; number: number | null }
        | { type: "boolean"; boolean: boolean }
        | { type: "date"; start: string | null };
    }
  | { type: "relation"; ids: string[] }
  | {
      type: "rollup";
      rollup:
        | { type: "number"; number: number | null }
        | { type: "date"; start: string | null }
        | { type: "array"; items: RollupItem[] }
        | { type: "string"; string: string | null }
        | { type: "boolean"; boolean: boolean }
        | { type: "unsupported" }
        | { type: "incomplete" };
    }
  | { type: "created_time" | "last_edited_time"; time: string }
  | { type: "created_by" | "last_edited_by"; user: PersonRef }
  | { type: "unique_id"; prefix: string | null; number: number | null }
  | { type: "verification"; state: string | null; verifiedBy?: string | null };

export interface PProperty {
  name: string;
  value: PValue;
}

/** A page: title + properties + blocks + metadata (notion2prompt's Page). */
export interface PPage {
  id: string;
  title: string;
  url: string;
  /** Notion properties, in schema order. Plain pages have none but the title. */
  properties: PProperty[];
  blocks: PBlock[];
  icon?: string | null;
}

/** A database: schema + rows (notion2prompt's Database; rows are pages). */
export interface PDatabase {
  id: string;
  title: string;
  url?: string;
  /** property name → Notion type name, in schema order */
  schema: { name: string; type: string }[];
  /** row pages, newest first by their first date property (notion2prompt's query_rows order) */
  rows: PPage[];
}

/** One node of the page tree the fetch stage walked: the root, then the child
 *  pages and row pages it followed, in document order. */
export interface TreeNode {
  kind: "page" | "database";
  id: string;
  title: string;
  /** how it was reached from its parent */
  via?: "child_page" | "link_to_page" | "parent" | "row" | "child_database";
  children: TreeNode[];
}

export type SkipReason = "permission" | "cycle" | "duplicate" | "depth" | "limit" | "missing";

export interface Skipped {
  reason: SkipReason;
  kind: "page" | "database" | "block" | "row";
  /** never a title: a skipped item may be one the reader must not learn about */
  id: string;
}

export interface FetchStats {
  pages: number;
  databases: number;
  rows: number;
  blocks: number;
  /** root + blocks + rows + child pages — what `limit` caps */
  items: number;
  /** deepest page level reached (root = 0) */
  maxDepthReached: number;
  /** something was left out because of `depth` */
  depthLimited: boolean;
  /** something was left out because of `limit` */
  limitReached: boolean;
}

export interface Location {
  /** workspace name, then teamspace name, then the root's ancestor page titles */
  segments: string[];
}

/** The fetch stage's result (notion2prompt's FetchResult / NotionContent). */
export interface PromptContent {
  version: 1;
  root:
    | { kind: "page"; id: string }
    | { kind: "database"; id: string }
    | { kind: "block"; block: PBlock; pageId: string };
  /** every page the fetch stage read, by id (row pages of a root database included) */
  pages: Record<string, PPage>;
  /** every database it resolved, by id */
  databases: Record<string, PDatabase>;
  tree: TreeNode;
  location: Location;
  stats: FetchStats;
  skipped: Skipped[];
  options: FetchOptions;
}

export interface FetchOptions {
  /** how many levels of child pages to follow below the root (0 = the root alone) */
  depth: number;
  /** cap on root + blocks + rows + child pages */
  limit: number;
  /** follow child pages (sub-pages, linked pages, parent/child pages) */
  childPages: boolean;
  /** resolve child databases even where the depth budget is spent */
  alwaysFetchDatabases: boolean;
}

export type TemplateName = "claude-xml" | "default" | "markdown";

export interface RenderOptions {
  template: TemplateName;
  /** free text for <instructions>; empty drops the block */
  instruction?: string | null;
  /** true / false as in notion2prompt; "auto" prints the section only when a page has a property to show */
  includeProperties: boolean | "auto";
  /** each child page its own file (true) or merged inline after its placeholder (false) */
  separateChildPages: boolean;
  /** "ainmem": breadcrumb paths, a real page tree, the workspace path as project path.
   *  "notion2prompt": `<title>_<id>.md`, the flat `└──` tree and `/direct_template`, byte for byte. */
  layout: "ainmem" | "notion2prompt";
}

export interface RenderedFile {
  path: string;
  code: string;
}

export interface RenderedPrompt {
  prompt: string;
  files: RenderedFile[];
  sourceTree: string;
  projectPath: string;
  chars: number;
  /** a rough count for the reader, not a tokenizer */
  estimatedTokens: number;
}
