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
  ainAddress: text("ain_address").unique().notNull(),
  displayName: text("display_name").notNull(),
  avatarUrl: text("avatar_url"),
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
  // 방별 관계 에이전트 설정 (소유자 편집) — AgentConfig 타입, isAgent 사용자에만 의미
  agentConfig: jsonb("agent_config").$type<Record<string, unknown>>(),
  ownerId: uuid("owner_id"),
  timezone: text("timezone"),
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
// Notion-specific tables (plan.md schema)
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
    // page options menu (Notion "..."): wide body / edits blocked
    fullWidth: boolean("full_width").default(false).notNull(),
    isLocked: boolean("is_locked").default(false).notNull(),
    // 접근 제한 페이지: 일반 멤버는 pageMembers 명시 권한 없으면 못 봄(기본 workspace-wide
    // 열람에서 제외). DM 관계 문서처럼 참여자 전용 페이지에 쓴다. 기본 false = 기존 동작.
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

/** Simple-table payload (Notion "table" block). cells[row][col]; the header
 *  flags mirror Notion's "header row / header column" toggles. */
export interface TableData {
  cells: string[][];
  headerRow?: boolean;
  headerCol?: boolean;
}

/** One step of a "button" block's action chain (notion.com/help/buttons).
 *  Actions run in order; a rejected confirm stops the chain. */
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
    // link options (Notion: expiry / password / duplicate-as-template)
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
  /** date: repeat every year (birthdays, anniversaries) — calendar views lay
   *  the row out on its month/day in EVERY year, ignoring the stored year */
  recurring?: "yearly";
  /** relation: the target database whose rows this links to */
  relationDatabaseId?: string;
  /** relation: this prop is a COMPUTED mirror of a relation on another db
   *  (two-way relation) — its value is derived, never stored */
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
 *  "is any of"), a "YYYY-MM-DD" date, or a relative date token (`@today`,
 *  `past_week`, …) resolved at match time. */
export interface ViewFilter {
  propertyId: string;
  op: FilterOp;
  value?: unknown;
}
export interface ViewSort {
  propertyId: string;
  dir: "asc" | "desc";
}
/** Notion advanced filters: a GROUP of conditions with its own AND/OR,
 *  combined with the top-level rules via filterConjunction (2-level nesting). */
export interface ViewFilterGroup {
  conjunction?: "and" | "or";
  filters: ViewFilter[];
}
export type ViewType = "table" | "board" | "list" | "gallery" | "calendar" | "timeline" | "dashboard";

export interface ViewConfig {
  groupByPropertyId?: string; // board grouping
  filters?: ViewFilter[];
  /** nested filter groups (Notion "+ Add filter group") */
  filterGroups?: ViewFilterGroup[];
  sorts?: ViewSort[];
  /** how multiple filters combine (default "and") */
  filterConjunction?: "and" | "or";
  /** property ids hidden in this view */
  hiddenProperties?: string[];
  /** per-property column widths in px (table view; drag the column edge) */
  widths?: Record<string, number>;
  /** which date property the calendar view lays rows out on */
  calendarDatePropertyId?: string;
  /** a linked database view embedded inside another page */
  embedded?: boolean;
  /** per-property column-footer aggregation (Notion "Calculate"):
   *  { [propertyId]: "count" | "count_values" | "empty" | "sum" | "avg" | "min" | "max" } */
  calcs?: Record<string, string>;
  /** dashboard view: its widget layout (notion.com/help/dashboards — up to 12
   *  widgets, up to 4 per row; each widget carries its own data config) */
  widgets?: DashWidget[];
}

/** One dashboard-view widget. `width` is in quarters of the row (Notion:
 *  max 4 widgets per row); rows wrap in reading order. */
export interface DashWidget {
  id: string;
  kind: "counter" | "bar" | "donut" | "table" | "board" | "list";
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
}

export const databases = pgTable("databases", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id")
    .references(() => workspaces.id, { onDelete: "cascade" })
    .notNull(),
  title: text("title").default("Untitled Database").notNull(),
  // editable text under the DB title (Notion parity)
  description: text("description").default("").notNull(),
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
export const teamspaces = pgTable(
  "teamspaces",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .references(() => workspaces.id, { onDelete: "cascade" })
      .notNull(),
    name: text("name").notNull(),
    icon: text("icon"),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("teamspaces_workspace_idx").on(t.workspaceId)]
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
// not yet accepted (Notion's guest-by-email share). Resolved into a pageMembers
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
 *  with no FK — OKF (file) page ids are base64url strings (comments precedent).
 *  Blocks are stored as a raw jsonb array of {id,type,content,position,parentBlockId}. */
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
    resolved: boolean("resolved").default(false).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("comments_page_idx").on(t.pageId)]
);

// Inbox notifications: a mention/comment/invite raised for a recipient user.
// pageId/commentId are plain uuids (nullable) — no FK, so an OKF-page mention
// or a churning autosave block id never dangles a cascade.
export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    type: text("type").notNull(), // 'mention' | 'comment' | 'invite'
    actorId: uuid("actor_id").references(() => users.id),
    pageId: uuid("page_id"),
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
// chat_rooms/chat_messages는 채팅 담당이 실구현으로 대체할 스텁 계약(스펙 §3).
// ---------------------------------------------------------------------------

export const chatRooms = pgTable("chat_rooms", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  // "agent" = Agent Lab 관계 방(생성자 전용), "dm" = 사람↔사람 DM(멤버십 기반)
  kind: text("kind").$type<"agent" | "dm">().default("agent").notNull(),
  // DM 방의 스코프 — 멤버 초대는 같은 워크스페이스 구성원만 (agent 스텁 방은 null)
  workspaceId: uuid("workspace_id"),
  // 1:1 DM 중복 방지 키 = 정렬된 "userA|userB" (그룹/agent 방은 null). 멤버십이
  // 바뀌어도 불변이라, 과거 그룹방이 새 1:1을 가로채는 문제를 막는다.
  directKey: text("direct_key"),
  // 전원 동의 완료 시각 — 이 시각 이전 메시지는 수집하지 않는다 (스펙 §2)
  consentAt: timestamp("consent_at"),
  createdBy: uuid("created_by").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// DM 멤버십 + 읽음 상태. (roomId,userId) 복합 유니크 — id 컬럼 없음(workspace_members 패턴).
export const chatRoomMembers = pgTable(
  "chat_room_members",
  {
    roomId: uuid("room_id").notNull(),
    userId: uuid("user_id").notNull(),
    // 이 시각 이후 + 타인이 쓴 메시지 수 = 미읽음 배지
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
    // DM 첨부 (업로드된 이미지/파일) — [{url,name}], url은 /uploads/* 만 허용
    attachments: jsonb("attachments")
      .$type<{ url: string; name: string }[]>()
      .default([])
      .notNull(),
    // write 파이프라인이 처리한 시각 — null이면 미수집. createdAt 동률 tie에도
    // 안전한 체크포인트 표현이라 lastProcessedMessageId 비교를 대체한다.
    processedAt: timestamp("processed_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("chat_messages_room_created_idx").on(t.roomId, t.createdAt)]
);

export const agentRoomStates = pgTable("agent_room_states", {
  roomId: uuid("room_id").primaryKey(),
  rootPageId: uuid("root_page_id"),
  // 섹션 key → pageId 매핑 (제목 rename에 안전)
  sectionPageIds: jsonb("section_page_ids").$type<Record<string, string>>().default({}).notNull(),
  // OKF 저장(현행): 관계 문서는 파일이 원본이다. 루트 폴더의 OKF 상대 경로와
  // 섹션 key → .md 상대 경로 매핑. 위 rootPageId/sectionPageIds는 Postgres에
  // 문서를 두던 시절의 레거시(기존 방 열람용으로만 남긴다).
  rootOkfPath: text("root_okf_path"),
  sectionOkfPaths: jsonb("section_okf_paths").$type<Record<string, string>>().default({}).notNull(),
  lastRunAt: timestamp("last_run_at"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// OKF 파일 트리에는 원래 접근 제어가 없다(폴더=워크스페이스 공유 콘텐츠).
// 관계 문서처럼 "참여자만" 볼 수 있어야 하는 콘텐츠를 파일로 두기 위한 경로
// 단위 ACL. 등록된 경로와 그 하위 전체는 memberIds에게만 노출된다.
export const okfAcl = pgTable("okf_acl", {
  // OKF 루트 기준 상대 경로 (보통 문서 루트 폴더)
  path: text("path").primaryKey(),
  // 출처 방 (관계 문서면 그 방) — 감사/정리용
  roomId: uuid("room_id"),
  memberIds: jsonb("member_ids").$type<string[]>().default([]).notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type OkfAcl = typeof okfAcl.$inferSelect;

// 레이어 2 — 방↔챗봇 임포트. 어떤 프로바이더의 A2A 봇이든 방 단위로 초대된다.
// 우리 관계 에이전트도 이 테이블을 통해 임포트되는 일반 봇일 뿐이다 (스펙 v2 §2).
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

// 외부 플랫폼에서 우리 에이전트를 임포트할 때 쓰는 멤버별 Bearer 토큰 (스펙 v2 §6).
// URL만 아는 제3자(C)는 토큰이 없어 거부된다. 화자 식별 = 토큰 소유자.
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

/** 소유자가 편집하는 방별 에이전트 설정 (users.agentConfig) — 스펙 v2 §4-3. */
export interface AgentConfig {
  /** 사용자 정의 시스템 프롬프트 (기본 프롬프트 뒤에 이어붙음) */
  systemPrompt?: string;
  persona?: { name?: string; tone?: string };
  /** 활성 스킬 키 목록 (제공 슈퍼셋 중 선택) */
  skills?: string[];
  behavior?: { proactive?: boolean };
  [key: string]: unknown;
}

export type ChatRoomBot = typeof chatRoomBots.$inferSelect;

export type ChatRoom = typeof chatRooms.$inferSelect;
export type ChatRoomMember = typeof chatRoomMembers.$inferSelect;
export type ChatMessage = typeof chatMessages.$inferSelect;

// ---------------------------------------------------------------------------
// Notion AI 채팅 (사이드바 Chats 탭). 사람↔사람 DM이 아니라 AI 대화 스레드다.
// 위 chat_rooms(관계-에이전트 스텁)와 의미가 달라 별도 테이블로 둔다.
// ---------------------------------------------------------------------------
export const aiChats = pgTable(
  "ai_chats",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull(),
    userId: uuid("user_id").notNull(),
    title: text("title").default("New chat").notNull(),
    icon: text("icon"), // emoji, null → 기본 아이콘
    agentName: text("agent_name"), // Custom Agent로 시작한 채팅이면 그 이름
    isFavorite: boolean("is_favorite").default(false).notNull(),
    // 목록 최상단 고정 (chats-pinned-section)
    isPinned: boolean("is_pinned").default(false).notNull(),
    // 미읽음 파란 점: 백그라운드에서 assistant 응답이 도착했고 아직 안 열어봄
    hasUnread: boolean("has_unread").default(false).notNull(),
    // 읽기전용 공유 토큰 (null → 비공개)
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
    // 응답이 참조한 노션 페이지들 [{id,title}] (출처 표시용)
    sources: jsonb("sources").$type<{ id: string; title: string }[]>().default([]),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("ai_chat_messages_chat_created_idx").on(t.chatId, t.createdAt)]
);

// ---------------------------------------------------------------------------
// Custom Agents (사이드바 Chats 탭 위 Agents 섹션). 저장된 지침(instructions)으로
// 새 ai_chats 스레드를 시작하는 프리셋 — agentName이 그 채팅에 남는다.
// ---------------------------------------------------------------------------
/** 에이전트가 참고할 지식 범위 — 명시 지정된 페이지 목록. pageIds가 비어있으면
 *  제한 없음(기존 동작과 동일). */
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
    icon: text("icon"), // emoji, null → 기본 아이콘
    instructions: text("instructions").default("").notNull(),
    isFavorite: boolean("is_favorite").default(false).notNull(),
    // 워크스페이스 구성원 전체에게 공유 (Notion: shared custom agents)
    isShared: boolean("is_shared").default(false).notNull(),
    // 이 에이전트가 참고할 페이지 범위 (지식 범위 섹션에서 편집)
    knowledgeScope: jsonb("knowledge_scope").$type<AgentKnowledgeScope>().default({}).notNull(),
    lastUsedAt: timestamp("last_used_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [index("ai_agents_user_updated_idx").on(t.userId, t.updatedAt)]
);

// ---------------------------------------------------------------------------
// AI 채팅 부가 기능 목(mock) — 커넥터/플랜 게이팅/알림 설정. 실제 OAuth·결제·푸시
// 없이 결정론적 in-app 상태만 재현한다 (클론이므로 mock이 적절).
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

// 워크스페이스 단위 AI 사용량/플랜 게이팅 목. workspaceId가 곧 PK (1행/워크스페이스).
export const aiUsage = pgTable("ai_usage", {
  workspaceId: uuid("workspace_id").primaryKey(),
  plan: text("plan").default("free").notNull(),
  messageCount: integer("message_count").default(0).notNull(),
  monthlyLimit: integer("monthly_limit").default(20).notNull(),
  aiDisabledByAdmin: boolean("ai_disabled_by_admin").default(false).notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// 사용자 단위 알림 설정 목. userId가 곧 PK.
export const aiNotifPrefs = pgTable("ai_notif_prefs", {
  userId: uuid("user_id").primaryKey(),
  enabled: boolean("enabled").default(true).notNull(),
  sound: boolean("sound").default(true).notNull(),
  dndUntil: timestamp("dnd_until"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// per-chat 음소거: (userId, chatId) 존재 = 그 채팅 알림 음소거됨.
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
