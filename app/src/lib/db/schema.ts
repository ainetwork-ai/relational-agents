import {
  pgTable,
  uuid,
  text,
  boolean,
  timestamp,
  jsonb,
  uniqueIndex,
  index,
  doublePrecision,
  integer,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// Tables copied column-for-column from ../slack-a2a/slack (auth + workspace)
// ---------------------------------------------------------------------------

export const workspaces = pgTable("workspaces", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").unique().notNull(),
  iconText: text("icon_text").default("WS").notNull(),
  iconUrl: text("icon_url"),
  description: text("description"),
  createdBy: uuid("created_by"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  defaultNotificationPref: text("default_notification_pref").default("all").notNull(),
  defaultChannels: jsonb("default_channels").$type<string[]>().default([]),
});

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  // Google sign-in identity. `sub` is the stable one — an account can change
  // its email — so lookups go through sub first and fall back to email for
  // rows that predate it (and for page_invites, which invites by email).
  googleSub: text("google_sub").unique(),
  email: text("email").unique(),
 // Wallet identity (AIN/MetaMask/raw-key logins — the relational-chain line).
 // Google accounts have none and wallet accounts may lack googleSub/email;
 // the two login families coexist on this one table.
  ainAddress: text("ain_address").unique(),
  // aindrive identity ("<aindrive server>|<aindrive user id>") — set by
  // "aindrive로 로그인" and by connecting aindrive in-app, so either path lands
  // on the same account. Keyed on the aindrive id, never adopted by email.
  aindriveSub: text("aindrive_sub").unique(),
  displayName: text("display_name").notNull(),
  avatarUrl: text("avatar_url"),
 // /home dashboard cover the user picked (uploaded or built-in); null = default
  homeCoverUrl: text("home_cover_url"),
  status: text("status").default("offline").notNull(),
  statusMessage: text("status_message"),
  statusEmoji: text("status_emoji"),
  statusExpiresAt: timestamp("status_expires_at"),
  isAgent: boolean("is_agent").default(false).notNull(),
  a2aId: text("a2a_id").unique(),
  a2aUrl: text("a2a_url"),
  agentCardJson: jsonb("agent_card_json"),
  agentInvitedBy: uuid("agent_invited_by"),
  agentVisibility: text("agent_visibility").default("private"),
  agentCategory: text("agent_category"),
  agentTags: jsonb("agent_tags").$type<string[]>().default([]),
  encryptedPrivateKey: text("encrypted_private_key"),
 // Sui identity, generated lazily the first time this person's relationship
 // needs to touch the chain. The Move module checks `members` by Sui address,
 // so a member signs their own add_memory even though the sponsor pays gas.
 // Stored the same way encryptedPrivateKey is (demo: at rest as issued).
  suiAddress: text("sui_address"),
  encryptedSuiKey: text("encrypted_sui_key"),
 // per-room relationship-agent config (owner-edited) — AgentConfig type, only meaningful for isAgent users
  agentConfig: jsonb("agent_config").$type<Record<string, unknown>>(),
  ownerId: uuid("owner_id"),
  timezone: text("timezone"),
  // UI language (ko | en); null = follow the browser. Per user, like Notion.
  language: text("language"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const workspaceMembers = pgTable(
  "workspace_members",
  {
    workspaceId: uuid("workspace_id")
      .references(() => workspaces.id, { onDelete: "cascade" })
      .notNull(),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    role: text("role").default("member").notNull(),
    joinedAt: timestamp("joined_at").defaultNow().notNull(),
  },
  (t) => [uniqueIndex("workspace_members_pk").on(t.workspaceId, t.userId)]
);

export const inviteTokens = pgTable(
  "invite_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    token: text("token").unique().notNull(),
    workspaceId: uuid("workspace_id")
      .references(() => workspaces.id, { onDelete: "cascade" })
      .notNull(),
    createdBy: uuid("created_by")
      .references(() => users.id)
      .notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("invite_tokens_workspace_idx").on(t.workspaceId),
    index("invite_tokens_expires_idx").on(t.expiresAt),
  ]
);

// ---------------------------------------------------------------------------
// Workspace tables (plan.md schema)
// ---------------------------------------------------------------------------

export const pages = pgTable(
  "pages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .references(() => workspaces.id, { onDelete: "cascade" })
      .notNull(),
    parentPageId: uuid("parent_page_id"),
    teamspaceId: uuid("teamspace_id"),
    title: text("title").default("").notNull(),
    icon: text("icon"),
    coverUrl: text("cover_url"),
    isArchived: boolean("is_archived").default(false).notNull(),
    isFavorite: boolean("is_favorite").default(false).notNull(),
 // page options menu: wide body / edits blocked
    fullWidth: boolean("full_width").default(false).notNull(),
    isLocked: boolean("is_locked").default(false).notNull(),
 // restricted page: ordinary members can't see it without an explicit
 // pageMembers grant (excluded from workspace-wide reads). Used for
 // participant-only pages like DM relationship docs. Default false = legacy behavior.
    restricted: boolean("restricted").default(false).notNull(),
    position: doublePrecision("position").notNull(),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [index("pages_workspace_parent_idx").on(t.workspaceId, t.parentPageId)]
);

export type BlockType =
  | "paragraph"
  | "heading1"
  | "heading2"
  | "heading3"
  | "bulleted_list"
  | "numbered_list"
  | "todo"
  | "toggle"
  | "quote"
  | "divider"
  | "code"
  | "callout"
  | "image"
  | "table"
  | "database"
  | "child_page"
  | "column_list"
  | "column"
  | "bookmark"
  | "embed"
  | "video"
  | "toc"
  | "link_to_page"
  | "file"
  | "template_button"
  | "button"
  | "equation"
  | "ai_prompt";

/** Simple-table payload. cells[row][col]; the header
 * flags mirror "header row / header column" toggles. */
export interface TableData {
  cells: string[][];
  /** per-cell sanitized inline HTML, mirroring a block's content.text/html
   * pair — present only for cells edited since formatting arrived. */
  html?: string[][];
  /** per-cell text colour / background, by palette name ("gray", "blue", …).
   * The row and column menus write a whole line at once, as the original does. */
  color?: string[][];
  bg?: string[][];
  /** per-cell text alignment ("center" / "right"; absent = left). Ours, not
   * the original's — Notion's simple table has no alignment at all. */
  align?: string[][];
  headerRow?: boolean;
  headerCol?: boolean;
}

/** One step of a "button" block's action chain (help/buttons).
 * Actions run in order; a rejected confirm stops the chain. */
export type ButtonAction =
  | { type: "open_url"; url: string }
  | { type: "open_page"; pageId: string }
  | { type: "insert_blocks"; markdown: string }
  | { type: "add_page"; databaseId: string; title?: string }
  | { type: "confirm"; message: string }
  | { type: "notify"; body: string };

export interface BlockContent {
  text?: string;
  /** sanitized inline HTML (b/i/u/s/code/a) — plain `text` mirrors it */
  html?: string;
  checked?: boolean;
  language?: string;
  url?: string;
  emoji?: string;
  table?: TableData;
  /** for the "database" block: which collection this embeds */
  databaseId?: string;
  /** embed the database as a full page vs inline */
  fullPage?: boolean;
  /** render a specific saved view (linked database) */
  linkedViewId?: string;
  /** for the "child_page" block: the real page this links to */
  childPageId?: string;
  /** for the "template_button" block: markdown inserted below on click */
  template?: string;
  /** for the "button" block: its action chain */
  actions?: ButtonAction[];
  /** for the "button"/"callout" block: its emoji icon (null = removed) */
  icon?: string | null;
  [key: string]: unknown;
}

export const blocks = pgTable(
  "blocks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    pageId: uuid("page_id")
      .references(() => pages.id, { onDelete: "cascade" })
      .notNull(),
    type: text("type").$type<BlockType>().notNull(),
    content: jsonb("content").$type<BlockContent>().default({}).notNull(),
    parentBlockId: uuid("parent_block_id"),
    position: doublePrecision("position").notNull(),
    /** Deletion is `alive=false`, never a DELETE (docs/save-protocol-target.md
     * §1.1): undo and a resent transaction can bring the same id back, and a
     * late `update` to a block someone else removed lands on a row instead of
     * vanishing. Readers filter on it; a purge of long-dead rows is a batch. */
    alive: boolean("alive").default(true).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [index("blocks_page_position_idx").on(t.pageId, t.position)]
);

export const pageShares = pgTable(
  "page_shares",
  {
    pageId: uuid("page_id")
      .references(() => pages.id, { onDelete: "cascade" })
      .primaryKey(),
    token: text("token").unique().notNull(),
 // link permission for "anyone with the link": view | comment | edit | full
    permission: text("permission").default("view").notNull(),
 // link options
    expiresAt: timestamp("expires_at"),
    passwordHash: text("password_hash"),
    allowDuplicate: boolean("allow_duplicate").default(true).notNull(),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("page_shares_token_idx").on(t.token)]
);

// ---------------------------------------------------------------------------
// Database engine (project-management: typed properties, rows, views)
// ---------------------------------------------------------------------------

export type PropertyType =
  | "title"
  | "text"
  | "number"
  | "select"
  | "multi_select"
  | "status"
  | "date"
  | "person"
  | "checkbox"
  | "url"
  | "relation"
  | "formula"
  | "rollup"
  | "email"
  | "phone"
  | "files"
  | "created_time"
  | "last_edited_time"
  | "created_by"
  | "last_edited_by";

export interface SelectOption {
  id: string;
  name: string;
  color: string;
  /** status option group band: "todo" | "in_progress" | "complete" */
  group?: string;
}

/** Aggregation config for a rollup property. */
export interface RollupConfig {
  /** which relation-type property on THIS db supplies the linked rows */
  relationPropertyId?: string;
  /** which property on the RELATED db is aggregated */
  targetPropertyId?: string;
  /** how to aggregate: sum | count | avg */
  function?: string;
}

export interface PropertyConfig {
  options?: SelectOption[]; // select / status
  /** status: its options bucketed into groups — the original's Status carries
   * `To-do · In progress · Complete`, and one of its views filters by the
   * GROUP rather than by an option (docs/notion-projects-spec.md) */
  optionGroups?: { id: string; name: string; color?: string; optionIds: string[] }[];
  /** status: the option new rows start on — the original tags it `기본` in the
   * property editor and applies it to every page created without a value */
  defaultOptionId?: string;
  /** status/select: the property editor's 콘텐츠 줄바꿈하기 switch. Stored so the
   * toggle round-trips; table cells still clip to one line (table_wrap: false
   * in every capture), so nothing reads it yet. */
  wrapContent?: boolean;
  /** date: repeat every year (birthdays, anniversaries) — calendar views lay
 * the row out on its month/day in EVERY year, ignoring the stored year */
  recurring?: "yearly";
  /** date: how every cell in the column reads — the picker's `날짜 형식` row.
   * The original keeps this on the property, which is why its Projects table
   * shows `Start date` as 08/04/2026 and `End date` as 2026년 8월 4일 at the
   * same time. One of DateFormat; undefined means 전체 날짜. */
  dateFormat?: string;
  /** relation: the target database whose rows this links to */
  relationDatabaseId?: string;
  /** relation: this prop is a COMPUTED mirror of a relation on another db
 * (two-way relation) — its value is derived, never stored */
  mirrorOf?: { databaseId: string; propId: string };
  /** relation: id of the mirror property created on the target db */
  twoWayPropId?: string;
  /** formula: a safe arithmetic expression over prop("Name") references */
  formula?: string;
  /** rollup: aggregate a target property over related rows */
  rollup?: RollupConfig;
  /** number: value formatting — "number" | "percent" | "currency" | "comma" */
  numberFormat?: string;
  /** number: how to render the value — "number" | "bar" (progress) */
  display?: string;
  /** show this property above a row page's body rather than in its 속성 panel
   * — what the original's 레이아웃 사용자 지정 chooses. Lives on the property
   * because `config` is already JSON: pinning needed no new column. Undefined
   * on every property means nobody has chosen, and the first few stand in. */
  pinned?: boolean;
  /** where this property sits in the band, low first. The original's layout
   * editor orders the pinned properties independently of the property list
   * (its band reads TL · Assignee · End date · Evaluation while the property
   * order starts elsewhere) — so the order is its own field, not `position`.
   * Undefined falls back to `position`. */
  pinnedOrder?: number;
  /** 속성 표시 여부 — what the 속성 panel's label menu sets for a property that
   * is NOT pinned: "always" (the default) · "hide_empty" · "never". The band
   * ignores it; a pinned property keeps its slot however empty it is. */
  pageVisibility?: "always" | "hide_empty" | "never";
  [key: string]: unknown;
}

export type FilterOp =
  | "equals"
  | "not_equals"
  | "contains"
  | "not_contains"
  | "starts_with"
  | "ends_with"
  | "is_me"
  | "not_empty"
  | "is_empty"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "before"
  | "after"
  | "on_or_before"
  | "on_or_after"
  | "within"
  | "checked"
  | "unchecked";

/** A view filter. `value` may be a scalar, an ARRAY (select/status/person
 * "is any of"), a "YYYY-MM-DD" date, or a relative date token (`@today`,
 * `past_week`, …) resolved at match time. */
export interface ViewFilter {
  propertyId: string;
  op: FilterOp;
  value?: unknown;
}
export interface ViewSort {
  propertyId: string;
  dir: "asc" | "desc";
}
/**  advanced filters: a GROUP of conditions with its own AND/OR,
 * combined with the top-level rules via filterConjunction (2-level nesting). */
export interface ViewFilterGroup {
  conjunction?: "and" | "or";
  filters: ViewFilter[];
}
export type ViewType =
  | "table"
  | "board"
  | "list"
  | "gallery"
  | "calendar"
  | "timeline"
  | "dashboard"
  | "chart";

/** A chart view's own settings — mirrors the original's `chart_config`
 * (docs/notion-projects-spec.md): a column chart grouped by a property,
 * measuring count or a sum, optionally stacked by a second property. */
export interface ChartConfig {
  type?: "column" | "bar" | "line" | "donut";
  groupByPropertyId?: string;
  aggregate?: "count" | "sum";
  aggregatePropertyId?: string;
  stackByPropertyId?: string;
  height?: "small" | "medium" | "large";
  caption?: string;
  showCaption?: boolean;
  showDataLabels?: boolean;
  hideEmptyGroups?: boolean;
}

export type TimelineZoom = "month" | "quarter" | "year";

export interface ViewConfig {
  groupByPropertyId?: string; // board grouping
  filters?: ViewFilter[];
  /** nested filter groups */
  filterGroups?: ViewFilterGroup[];
  sorts?: ViewSort[];
  /** how multiple filters combine (default "and") */
  filterConjunction?: "and" | "or";
  /** property ids hidden in this view */
  hiddenProperties?: string[];
  /** column order for THIS view (property ids). Notion keeps order per view —
   * the same database starts with a different column in each of its views. */
  propertyOrder?: string[];
  /** draw the row's icon in the title cell. The original leaves it on for its
   * tables and turns it off for `My`, `All Projects` and `My Timeline`. */
  showPageIcon?: boolean;
  /** freeze columns up to and including this index while the table scrolls
   * sideways. -1 (the default, and what every view of the original carries in
   * `table_frozen_column_index`) freezes nothing. */
  frozenColumnIndex?: number;
  /** per-property column widths in px (table view; drag the column edge) */
  widths?: Record<string, number>;
  /** which date property the calendar view lays rows out on */
  calendarDatePropertyId?: string;
  /** timeline: how wide a window one screen covers, and whether the side table
   * is open (the original's `My Timeline` keeps it open at quarter zoom) */
  timelineZoom?: TimelineZoom;
  timelineShowTable?: boolean;
  /** a linked database view embedded inside another page */
  embedded?: boolean;
  /** per-property column-footer aggregation:
 * { [propertyId]: "count" | "count_values" | "empty" | "sum" | "avg" | "min" | "max" } */
  calcs?: Record<string, string>;
  /** grouped table: collapsed section keys, and whether each section header
   * shows its row count (the capture renders the count slot empty — off) */
  collapsedGroups?: string[];
  showGroupCount?: boolean;
  /** drop sections that hold no rows (every grouped view in the original has
   * this on; a chart there has it off) */
  hideEmptyGroups?: boolean;
  /** chart view: what it plots */
  chart?: ChartConfig;
  /** dashboard view: its widget layout (.com/help/dashboards — up to 12
 * widgets, up to 4 per row; each widget carries its own data config) */
  widgets?: DashWidget[];
}

/** One dashboard-view widget. `width` is in quarters of the row (
 * max 4 widgets per row); rows wrap in reading order. */
export interface DashWidget {
  id: string;
  kind: "counter" | "bar" | "donut" | "table" | "board" | "list" | "chart";
  title?: string;
  width: 1 | 2 | 3 | 4;
  /** bar / donut / board: the select/status property that forms the groups */
  groupByPropertyId?: string;
  /** counter / bar / donut: what the number means */
  aggregate?: "count" | "sum";
  /** number property summed when aggregate = "sum" */
  aggregatePropertyId?: string;
  /** table / list: row cap */
  limit?: number;
  /** counter: fixed fraction digits (undefined = auto, up to 2) */
  decimals?: number;
  /** counter: literal text around the value — "$", " ETH", "%" … */
  prefix?: string;
  suffix?: string;
  /** counter: tint green/red by sign and show a leading + (PnL-style) */
  colorBySign?: boolean;
  /** chart: date property on the x axis, number property on the y axis */
  xPropertyId?: string;
  yPropertyId?: string;
  /** chart: line through the points, or OHLC candles per time bucket */
  chartType?: "line" | "candles";
  /** chart: candle bucket size */
  bucket?: "hour" | "day" | "week";
  /** chart: select/status property that draws each row as a colored marker */
  markerPropertyId?: string;
}

export const databases = pgTable("databases", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id")
    .references(() => workspaces.id, { onDelete: "cascade" })
    .notNull(),
  title: text("title").default("Untitled Database").notNull(),
 // editable text under the DB title
  description: text("description").default("").notNull(),
 // 설명 표시 / 설명 숨기기. Deliberately nullable: null means nobody has toggled
 // it, and then the description shows if there is any — a database that already
 // has text must not go blank the moment this column exists.
  descriptionVisible: boolean("description_visible"),
 // What one row is called, used wherever the UI offers to make one: the
 // original's Projects says "새 프로젝트", not "새 페이지". Null = 페이지.
  itemName: text("item_name"),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const dbProperties = pgTable(
  "db_properties",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    databaseId: uuid("database_id")
      .references(() => databases.id, { onDelete: "cascade" })
      .notNull(),
    name: text("name").notNull(),
    type: text("type").$type<PropertyType>().notNull(),
    config: jsonb("config").$type<PropertyConfig>().default({}).notNull(),
    position: doublePrecision("position").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("db_properties_database_idx").on(t.databaseId)]
);

export const dbRows = pgTable(
  "db_rows",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    databaseId: uuid("database_id")
      .references(() => databases.id, { onDelete: "cascade" })
      .notNull(),
 // { [propertyId]: value } — value shape depends on the property type
    values: jsonb("values").$type<Record<string, unknown>>().default({}).notNull(),
    position: doublePrecision("position").notNull(),
 // sub-items: a row nested under another row (null = top-level)
    parentRowId: uuid("parent_row_id"),
 // audit columns backing created_by / last_edited_by property types
    createdBy: uuid("created_by").references(() => users.id),
    updatedBy: uuid("updated_by").references(() => users.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [index("db_rows_database_position_idx").on(t.databaseId, t.position)]
);

export const dbViews = pgTable(
  "db_views",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    databaseId: uuid("database_id")
      .references(() => databases.id, { onDelete: "cascade" })
      .notNull(),
    name: text("name").notNull(),
    type: text("type").$type<ViewType>().notNull(),
    config: jsonb("config").$type<ViewConfig>().default({}).notNull(),
    position: doublePrecision("position").notNull(),
  },
  (t) => [index("db_views_database_idx").on(t.databaseId)]
);

// ---------------------------------------------------------------------------
// Teamspaces: a named grouping of pages inside a workspace (pages.teamspaceId).
// ---------------------------------------------------------------------------
/** Who can see and join a teamspace — the "보안" field of the create dialog. */
export type TeamspaceVisibility = "open" | "closed" | "private";

export const teamspaces = pgTable(
  "teamspaces",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .references(() => workspaces.id, { onDelete: "cascade" })
      .notNull(),
    name: text("name").notNull(),
    icon: text("icon"),
 // "이 팀스페이스의 용도는 무엇인가요?" — optional, shown under the name
    description: text("description").default("").notNull(),
 // open = anyone in the workspace can see and join (Notion's default 공개)
    visibility: text("visibility").$type<TeamspaceVisibility>().default("open").notNull(),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("teamspaces_workspace_idx").on(t.workspaceId)]
);

/** Teamspace membership — what step 2 of the create flow writes. The creator is
 *  inserted as owner; invitees added from the member search land as members. */
export const teamspaceMembers = pgTable(
  "teamspace_members",
  {
    teamspaceId: uuid("teamspace_id")
      .references(() => teamspaces.id, { onDelete: "cascade" })
      .notNull(),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    role: text("role").default("member").notNull(),
    joinedAt: timestamp("joined_at").defaultNow().notNull(),
  },
  (t) => [uniqueIndex("teamspace_members_pk").on(t.teamspaceId, t.userId)]
);

// Invite specific people to a page. permission ∈ view|comment|edit|full.
export const pageMembers = pgTable(
  "page_members",
  {
    pageId: uuid("page_id")
      .references(() => pages.id, { onDelete: "cascade" })
      .notNull(),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    permission: text("permission").default("view").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [uniqueIndex("page_members_pk").on(t.pageId, t.userId)]
);

// Pending page invites: a specific person invited to a page by email who has
// not yet accepted. Resolved into a pageMembers
// row once the invitee signs in with a matching email; until then it shows in
// the share dialog as a pending guest with its own permission level.
export const pageInvites = pgTable(
  "page_invites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    pageId: uuid("page_id")
      .references(() => pages.id, { onDelete: "cascade" })
      .notNull(),
    email: text("email").notNull(),
    permission: text("permission").default("edit").notNull(),
    invitedBy: uuid("invited_by")
      .references(() => users.id)
      .notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [uniqueIndex("page_invites_pk").on(t.pageId, t.email)]
);

// Comments: page-level discussion threads (blockId null) and inline block
// comments (blockId set). parentId = the thread root (null = this IS a root).
// blockId/parentId are plain uuids — no FK, so churning autosave block ids and
// self-references never dangle a cascade.
/** Point-in-time page versions for Page history / restore. pageId is text
 * with no FK — OKF (file) page ids are base64url strings (comments precedent).
 * Blocks are stored as a raw jsonb array of {id,type,content,position,parentBlockId}. */
export interface SnapshotBlock {
  id: string;
  type: BlockType;
  content: BlockContent;
  position: number;
  parentBlockId: string | null;
}

export const pageSnapshots = pgTable("page_snapshots", {
  id: uuid("id").primaryKey().defaultRandom(),
  pageId: text("page_id").notNull(),
  title: text("title").default("").notNull(),
  blocks: jsonb("blocks").$type<SnapshotBlock[]>().notNull(),
  createdBy: uuid("created_by"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type PageSnapshot = typeof pageSnapshots.$inferSelect;

/**
 * Every applied save transaction (docs/save-protocol-target.md §3–4). The row
 * is what makes a save idempotent: a client that retries the same transaction
 * (5s later, or from the next session after the tab closed mid-flight) finds
 * its id here and the server answers "done" without applying it twice.
 * `page_id` is text, not a uuid FK: file-backed (OKF) pages save through the
 * same route and their ids are base64url paths.
 */
export const transactions = pgTable(
  "transactions",
  {
    id: uuid("id").primaryKey(),
    pageId: text("page_id").notNull(),
    userId: uuid("user_id"),
    operations: jsonb("operations").notNull(),
    userAction: text("user_action"),
    clientTimestamp: timestamp("client_timestamp"),
    appliedAt: timestamp("applied_at").defaultNow().notNull(),
  },
  (t) => [index("transactions_page_applied_idx").on(t.pageId, t.appliedAt)]
);

export const comments = pgTable(
  "comments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
 // text + no FK: OKF (file) page/block ids are base64url strings, not
 // uuids — same trade-off as notifications (no cascade on page delete)
    pageId: text("page_id").notNull(),
    blockId: text("block_id"),
    parentId: uuid("parent_id"),
    authorId: uuid("author_id")
      .references(() => users.id)
      .notNull(),
    body: text("body").notNull(),
 // attachments are rows in `files`, not a column here — see that table for why
    resolved: boolean("resolved").default(false).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("comments_page_idx").on(t.pageId)]
);

// Inbox notifications: a mention/comment/invite raised for a recipient user.
// pageId/commentId are plain uuids (nullable) — no FK, so an OKF-page mention
// or a churning autosave block id never dangles a cascade.
/**
 * An attached file, as a first-class row.
 *
 * The bytes live in object storage under a key that IS their SHA-256, so the
 * same bytes are one object however many times they are uploaded. What cannot
 * be derived from the bytes lives here: the name a person gave it, its size
 * and type, and which comment it hangs off.
 *
 * `fileUrl` is `s3://<bucket>/files/<sha256>.<ext>` — or, until the migration
 * finishes, a legacy `/uploads/<name>` path. The proxy routes read both.
 *
 * `commentId` cascades: deleting a comment deletes its file rows, which makes
 * "is this object still referenced?" answerable with one query instead of a
 * scan through jsonb. The row is created when the comment is inserted, not
 * when the upload finishes — an upload that is never sent leaves no row.
 */
export const files = pgTable(
  "files",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    commentId: uuid("comment_id")
      .references(() => comments.id, { onDelete: "cascade" })
      .notNull(),
    userId: uuid("user_id")
      .references(() => users.id)
      .notNull(),
    fileName: text("file_name").notNull(),
    fileUrl: text("file_url").notNull(),
    fileSize: integer("file_size"),
    mimeType: text("mime_type"),
 // captured at upload for images, so a comment can size the box before the
 // bytes arrive instead of jumping when they do
    width: integer("width"),
    height: integer("height"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("files_comment_idx").on(t.commentId), index("files_user_idx").on(t.userId)]
);

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    type: text("type").notNull(), // 'mention' | 'comment' | 'invite'
    actorId: uuid("actor_id").references(() => users.id),
 // text, not uuid: OKF page ids are base64url path encodings (comments and
 // page_snapshots already store them as text for the same reason)
    pageId: text("page_id"),
    commentId: uuid("comment_id"),
    body: text("body").default("").notNull(),
    read: boolean("read").default(false).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("notifications_user_idx").on(t.userId)]
);

// Schema overlay for file-backed (OKF) databases. The md/csv folder tree stays
// the canonical CONTENT store; what a bare CSV can't hold (declared property
// types, authored select options, column positions, extra views + configs)
// lives HERE in Postgres — not in a sidecar file beside the data. Keyed by
// (content root, csv rel path); prop keys inside `meta` are CSV header names
// so column renames migrate cleanly while positional col-ids shift.
export const okfDbMeta = pgTable(
  "okf_db_meta",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    root: text("root").notNull(),
    path: text("path").notNull(),
    meta: jsonb("meta").$type<Record<string, unknown>>().default({}).notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [uniqueIndex("okf_db_meta_root_path_idx").on(t.root, t.path)]
);

// ---------------------------------------------------------------------------
// Relationship agent (hackathon) — stub chat + write-pipeline state.
// chat_rooms/chat_messages started as the stub contract the chat owner replaces with the real implementation.
// ---------------------------------------------------------------------------

export const chatRooms = pgTable("chat_rooms", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
 // "agent" = Agent Lab relationship room (creator-only), "dm" = human↔human DM (membership-based)
  kind: text("kind").$type<"agent" | "dm">().default("agent").notNull(),
 // DM room scope — members can only be invited from the same workspace (agent stub rooms: null)
  workspaceId: uuid("workspace_id"),
 // 1:1 DM dedup key = sorted "userA|userB" (group/agent rooms: null).
 // Immutable across membership changes, so an old group room can never
 // hijack a fresh 1:1.
  directKey: text("direct_key"),
 // when everyone consented — messages before this are never collected
  consentAt: timestamp("consent_at"),
 // when everyone signed the dissolution — the chat closes, the record stays
  dissolvedAt: timestamp("dissolved_at"),
  createdBy: uuid("created_by").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
 // The relationship as a shared object on Sui, created at consent. Null when
 // the chain was unreachable or unconfigured — the room works either way.
  suiObjectId: text("sui_object_id"),
  suiCreateTx: text("sui_create_tx"),
 // The two user ids written into the object's `members` at birth. The Move
 // module checks the sender against that set, so a later memory has to be
 // signed by one of exactly these two — not by whoever is in the room now.
  suiMemberIds: jsonb("sui_member_ids").$type<string[]>(),
});

// relation_contracts / relation_dissolves lived here: one wallet-signed row per
// member, completing the set stamped chat_rooms.consent_at / dissolved_at, and
// the set could be relayed on-chain verbatim. Wallets are gone, so nothing can
// produce a signature; both tables are dropped. chat_rooms keeps consent_at and
// dissolved_at — they are plain timestamps the app still reads.

// DM membership + read state. (roomId,userId) composite unique — no id column (workspace_members pattern).
export const chatRoomMembers = pgTable(
  "chat_room_members",
  {
    roomId: uuid("room_id").notNull(),
    userId: uuid("user_id").notNull(),
 // unread badge = count of others' messages after this timestamp
    lastReadAt: timestamp("last_read_at"),
    joinedAt: timestamp("joined_at").defaultNow().notNull(),
  },
  (t) => [uniqueIndex("chat_room_members_pk").on(t.roomId, t.userId)]
);

export const chatMessages = pgTable(
  "chat_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    roomId: uuid("room_id").notNull(),
    authorId: uuid("author_id").notNull(),
    text: text("text").notNull(),
 // DM attachments (uploaded images/files) — [{url,name}], urls restricted to /uploads/*
    attachments: jsonb("attachments")
      .$type<{ url: string; name: string }[]>()
      .default([])
      .notNull(),
 // Side-channel with the agent: set to the human party of a private exchange
 // (@agent question and the agent's answer). Visible only to that user and the
 // message author; never collected into the shared relationship document.
 // NULL = an ordinary room message everyone sees.
    privateToUserId: uuid("private_to_user_id"),
 // when the write pipeline processed it — null = not yet collected. A
 // checkpoint that stays safe under createdAt ties, replacing
 // lastProcessedMessageId comparisons.
    processedAt: timestamp("processed_at"),
 // set when this message actually became part of the relationship record (it
 // was cited as a source of an applied edit). Drives the quiet "added to your
 // record" marker, so the agent no longer announces itself in the transcript.
    recordedAt: timestamp("recorded_at"),
 // Set on the "📞 …" call bubbles, so the bubble in the chat can lead back to
 // what that call left in the record. The recap cites the call the same way
 // (#call-{callId}), and this is the other half of that link — without it a
 // bubble is a dead end, since its own message id appears nowhere in the doc.
    callId: text("call_id"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("chat_messages_room_created_idx").on(t.roomId, t.createdAt)]
);

export const agentRoomStates = pgTable("agent_room_states", {
  roomId: uuid("room_id").primaryKey(),
  rootPageId: uuid("root_page_id"),
 // section key → pageId map (safe across title renames)
  sectionPageIds: jsonb("section_page_ids").$type<Record<string, string>>().default({}).notNull(),
 // OKF storage (current): the relationship doc lives as files. OKF-relative
 // path of the root folder plus section key → .md path map. rootPageId /
 // sectionPageIds above are legacy from the Postgres-resident era (kept only
 // so old rooms stay readable).
  rootOkfPath: text("root_okf_path"),
  sectionOkfPaths: jsonb("section_okf_paths").$type<Record<string, string>>().default({}).notNull(),
  lastRunAt: timestamp("last_run_at"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// The OKF file tree has no access control of its own (folders = workspace-
// shared content). This is the per-path ACL that lets participant-only
// content like relationship docs live as files: a registered path and its
// whole subtree are visible to memberIds only.
export const okfAcl = pgTable("okf_acl", {
 // path relative to the OKF root (usually the doc's root folder)
  path: text("path").primaryKey(),
 // originating room (for relationship docs) — audit/cleanup
  roomId: uuid("room_id"),
  memberIds: jsonb("member_ids").$type<string[]>().default([]).notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type OkfAcl = typeof okfAcl.$inferSelect;

// Layer 2 — room↔chatbot imports. Any provider's A2A bot is invited per
// room; our own relationship agent is just another bot imported through this
// table.
export const chatRoomBots = pgTable(
  "chat_room_bots",
  {
    roomId: uuid("room_id").notNull(),
    agentUserId: uuid("agent_user_id").notNull(),
    importedBy: uuid("imported_by").notNull(),
    importedAt: timestamp("imported_at").defaultNow().notNull(),
  },
  (t) => [uniqueIndex("chat_room_bots_pk").on(t.roomId, t.agentUserId)]
);

// A person's own aindrive account, connected from the browser session they are
// already signed in with on aindrive (lib/aindrive-account: aindrive approves a
// pairing link, we receive that account's session). Every aindrive call made
// for this person uses it, so they reach their own drives and nothing else.
export const aindriveAccounts = pgTable("aindrive_accounts", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  server: text("server").notNull(),
  // AES-256-GCM, keyed from SESSION_SECRET — never stored in the clear
  tokenEnc: text("token_enc").notNull(),
  email: text("email"),
  name: text("name"),
  expiresAt: timestamp("expires_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// The aindrive folder a person linked from Home (lib/aindrive). One per user:
// Home is the person's own place, not a workspace's, so the link is theirs.
export const aindriveLinks = pgTable("aindrive_links", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  driveId: text("drive_id").notNull(),
  root: text("root").default("").notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// The aindrive folder a teamspace is linked to (sidebar → 새로 추가 → aindrive).
// One per teamspace: the teamspace's OKF content is backed up into it
// (lib/aindrive-backup), and whatever else the folder holds is browsable from
// the sidebar. A pointer, not a page — the files stay on someone's machine.
export const teamspaceDrives = pgTable(
  "teamspace_drives",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    teamspaceId: uuid("teamspace_id")
      .references(() => teamspaces.id, { onDelete: "cascade" })
      .notNull(),
    name: text("name").notNull(),
    driveId: text("drive_id").notNull(),
    root: text("root").default("").notNull(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    // last backup attempt: when it finished, how many files, and why it failed
    lastBackupAt: timestamp("last_backup_at"),
    lastBackupFiles: integer("last_backup_files"),
    lastBackupError: text("last_backup_error"),
  },
  (t) => [uniqueIndex("teamspace_drives_teamspace_uq").on(t.teamspaceId)]
);

// Per-member Bearer tokens for importing our agent into external platforms
//. A third party who only knows the URL has no token and is
// refused. Speaker identity = token owner.
export const agentAccessTokens = pgTable(
  "agent_access_tokens",
  {
    token: text("token").primaryKey(),
    agentUserId: uuid("agent_user_id").notNull(),
    userId: uuid("user_id").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("agent_access_tokens_agent_idx").on(t.agentUserId)]
);

/** Owner-edited per-room agent config (users.agentConfig) — spec v2 §4-3. */
export interface AgentConfig {
 // Which relationship profile this agent runs on (lib/agent/profiles) — the
 // sections it keeps, the vocabulary it speaks, which coded rules apply. An
 // unknown or missing key falls back to the default; a room is never left
 // without a profile.
  profile?: string;
  /** custom system prompt (appended after the base prompt) */
  systemPrompt?: string;
 // Everything below overrides the profile for this room only. Absent = follow
 // the profile, including when a later release changes it.
  persona?: { name?: string; tone?: string };
  /** active skill keys (a selection from the offered superset) */
  skills?: string[];
  behavior?: { proactive?: boolean; whisperOnQuestion?: boolean };
  [key: string]: unknown;
}

export type ChatRoomBot = typeof chatRoomBots.$inferSelect;

export type TeamspaceDrive = typeof teamspaceDrives.$inferSelect;
export type ChatRoom = typeof chatRooms.$inferSelect;
export type ChatRoomMember = typeof chatRoomMembers.$inferSelect;
export type ChatMessage = typeof chatMessages.$inferSelect;

// ---------------------------------------------------------------------------
// the workspace AI chats (sidebar Chats tab). AI conversation threads, not
// human↔human DMs — semantically distinct from chat_rooms above
// (relationship-agent rooms), hence a separate table.
// ---------------------------------------------------------------------------
export const aiChats = pgTable(
  "ai_chats",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull(),
    userId: uuid("user_id").notNull(),
    title: text("title").default("New chat").notNull(),
    icon: text("icon"), // emoji, null → default icon
    agentName: text("agent_name"), // if the chat started from a Custom Agent, its name
    isFavorite: boolean("is_favorite").default(false).notNull(),
 // pinned to the top of the list (chats-pinned-section)
    isPinned: boolean("is_pinned").default(false).notNull(),
 // unread blue dot: an assistant reply arrived in the background, not yet opened
    hasUnread: boolean("has_unread").default(false).notNull(),
 // read-only share token (null → private)
    shareToken: text("share_token").unique(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [index("ai_chats_user_updated_idx").on(t.userId, t.updatedAt)]
);

export const aiChatMessages = pgTable(
  "ai_chat_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    chatId: uuid("chat_id")
      .references(() => aiChats.id, { onDelete: "cascade" })
      .notNull(),
    role: text("role").$type<"user" | "assistant">().notNull(),
    content: text("content").notNull(),
 // pages the reply cited, [{id,title}] (for source display)
    sources: jsonb("sources").$type<{ id: string; title: string }[]>().default([]),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("ai_chat_messages_chat_created_idx").on(t.chatId, t.createdAt)]
);

// ---------------------------------------------------------------------------
// Custom Agents (Agents section above the sidebar Chats tab). Presets that
// start a new ai_chats thread from saved instructions — agentName sticks to
// that chat.
// ---------------------------------------------------------------------------
/** Knowledge scope the agent may consult — an explicit page list. Empty
 * pageIds = unrestricted (legacy behavior). */
export interface AgentKnowledgeScope {
  pageIds?: string[];
}

export const aiAgents = pgTable(
  "ai_agents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull(),
    userId: uuid("user_id").notNull(),
    name: text("name").default("New agent").notNull(),
    icon: text("icon"), // emoji, null → default icon
    instructions: text("instructions").default("").notNull(),
    isFavorite: boolean("is_favorite").default(false).notNull(),
 // shared with the whole workspace
    isShared: boolean("is_shared").default(false).notNull(),
 // page scope this agent consults (edited in the knowledge-scope section)
    knowledgeScope: jsonb("knowledge_scope").$type<AgentKnowledgeScope>().default({}).notNull(),
    lastUsedAt: timestamp("last_used_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [index("ai_agents_user_updated_idx").on(t.userId, t.updatedAt)]
);

// ---------------------------------------------------------------------------
// AI-chat auxiliary mocks — connectors / plan gating / notification prefs.
// Deterministic in-app state only, no real OAuth, billing, or push (a clone,
// so mocks are the right shape).
// ---------------------------------------------------------------------------

export type AiConnectorProvider = "slack" | "teams" | "drive";

export const aiConnectors = pgTable(
  "ai_connectors",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull(),
    userId: uuid("user_id").notNull(),
    provider: text("provider").$type<AiConnectorProvider>().notNull(),
    status: text("status").$type<"connected" | "disconnected">().default("disconnected").notNull(),
    accountLabel: text("account_label"),
    connectedAt: timestamp("connected_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [uniqueIndex("ai_connectors_user_provider_idx").on(t.userId, t.provider)]
);

// per-workspace AI usage / plan-gating mock. workspaceId IS the PK (one row per workspace).
export const aiUsage = pgTable("ai_usage", {
  workspaceId: uuid("workspace_id").primaryKey(),
  plan: text("plan").default("free").notNull(),
  messageCount: integer("message_count").default(0).notNull(),
  monthlyLimit: integer("monthly_limit").default(20).notNull(),
  aiDisabledByAdmin: boolean("ai_disabled_by_admin").default(false).notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// per-user notification prefs mock. userId IS the PK.
export const aiNotifPrefs = pgTable("ai_notif_prefs", {
  userId: uuid("user_id").primaryKey(),
  enabled: boolean("enabled").default(true).notNull(),
  sound: boolean("sound").default(true).notNull(),
  dndUntil: timestamp("dnd_until"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// per-chat mute: a (userId, chatId) row = that chat's notifications are muted.
export const aiChatMutes = pgTable(
  "ai_chat_mutes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull(),
    chatId: uuid("chat_id")
      .references(() => aiChats.id, { onDelete: "cascade" })
      .notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [uniqueIndex("ai_chat_mutes_user_chat_idx").on(t.userId, t.chatId)]
);

export type AiConnector = typeof aiConnectors.$inferSelect;
export type AiUsage = typeof aiUsage.$inferSelect;
export type AiNotifPrefs = typeof aiNotifPrefs.$inferSelect;
export type AiChatMute = typeof aiChatMutes.$inferSelect;

export type Page = typeof pages.$inferSelect;
export type Block = typeof blocks.$inferSelect;
export type Teamspace = typeof teamspaces.$inferSelect;
export type TeamspaceMember = typeof teamspaceMembers.$inferSelect;
export type PageMember = typeof pageMembers.$inferSelect;
export type PageInvite = typeof pageInvites.$inferSelect;
export type Comment = typeof comments.$inferSelect;
export type Notification = typeof notifications.$inferSelect;
export type User = typeof users.$inferSelect;
export type Workspace = typeof workspaces.$inferSelect;
export type Database = typeof databases.$inferSelect;
export type DbProperty = typeof dbProperties.$inferSelect;
export type DbRow = typeof dbRows.$inferSelect;
export type DbView = typeof dbViews.$inferSelect;
export type AiChat = typeof aiChats.$inferSelect;
export type AiChatMessage = typeof aiChatMessages.$inferSelect;
export type AiAgent = typeof aiAgents.$inferSelect;

/**
 * What was said out loud during a video call, transcribed.
 *
 * Deliberately NOT chat_messages. A call produces an utterance every few
 * seconds; as messages they would bury the conversation the two people can
 * actually read, and speech is not something either of them chose to write
 * down. The agent still reads these — it keeps the relationship record current
 * and decides when to speak up — so a memory can come from a call, but the
 * transcript stays what was typed. Separate tables make that guarantee
 * structural instead of a filter someone can forget.
 */
export const callUtterances = pgTable(
  "call_utterances",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    roomId: uuid("room_id").notNull(),
 // groups one call; the record cites it in place of a message anchor
    callId: text("call_id").notNull(),
    speakerId: uuid("speaker_id").notNull(),
    text: text("text").notNull(),
 // same checkpoint contract as chat_messages — null = the agent has not read it
    processedAt: timestamp("processed_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("call_utterances_room_call_idx").on(t.roomId, t.callId, t.createdAt)]
);

export type CallUtterance = typeof callUtterances.$inferSelect;

export const relationContracts = pgTable(
  "relation_contracts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    roomId: uuid("room_id").notNull(),
    userId: uuid("user_id").notNull(),
    address: text("address").notNull(), // wallet address at signing time (lowercase)
    message: text("message").notNull(), // the signed contract payload, verbatim
    signature: text("signature").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [uniqueIndex("relation_contracts_room_user").on(t.roomId, t.userId)]
);

export const relationDissolves = pgTable(
  "relation_dissolves",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    roomId: uuid("room_id").notNull(),
    userId: uuid("user_id").notNull(),
    address: text("address").notNull(), // wallet address at signing time (lowercase)
    message: text("message").notNull(), // the signed dissolve payload, verbatim
    signature: text("signature").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [uniqueIndex("relation_dissolves_room_user").on(t.roomId, t.userId)]
);

export const personhoodProofs = pgTable(
  "personhood_proofs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    roomId: uuid("room_id").notNull(),
    userId: uuid("user_id").notNull(),
    nullifierHash: text("nullifier_hash").notNull(),
 // "orb" | "device" from the proof, or "dev-simulator" when no portal app_id
    verificationLevel: text("verification_level"),
    verifiedAt: timestamp("verified_at").defaultNow().notNull(),
  },
  (t) => [uniqueIndex("personhood_proofs_room_user").on(t.roomId, t.userId)]
);

