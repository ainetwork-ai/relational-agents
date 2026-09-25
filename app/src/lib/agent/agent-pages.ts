import "server-only";
import { and, eq, inArray, max } from "drizzle-orm";
import { db } from "@/lib/db";
import { blocks, databases, dbProperties, dbRows, dbViews, pages, type BlockContent, type BlockType, type DbProperty, type ViewConfig } from "@/lib/db/schema";

/** A block an agent writes, with its children (a toggle's contents). */
export interface NewBlock {
  type: BlockType;
  content: BlockContent;
  children?: NewBlock[];
}

export const b = {
  h2: (text: string): NewBlock => ({ type: "heading2", content: { text } }),
  h3: (text: string): NewBlock => ({ type: "heading3", content: { text } }),
  p: (text: string): NewBlock => ({ type: "paragraph", content: { text } }),
  todo: (text: string, checked = false): NewBlock => ({ type: "todo", content: { text, checked } }),
  num: (text: string): NewBlock => ({ type: "numbered_list", content: { text } }),
  bullet: (text: string): NewBlock => ({ type: "bulleted_list", content: { text } }),
  callout: (icon: string, text: string): NewBlock => ({ type: "callout", content: { icon, text } }),
  file: (url: string, text: string): NewBlock => ({ type: "file", content: { url, text } }),
  toggle: (text: string, children: NewBlock[]): NewBlock => ({ type: "toggle", content: { text, expanded: false }, children }),
  database: (databaseId: string): NewBlock => ({ type: "database", content: { databaseId } }),
  divider: (): NewBlock => ({ type: "divider", content: {} }),
};

/**
 * Writes an agent-made page into a teamspace. Asking again rebuilds the same
 * page (same id, so a link already posted keeps working): its blocks are
 * replaced and the databases it held are dropped with them.
 */
export async function writeAgentPage(opts: {
  workspaceId: string;
  teamspaceId: string;
  title: string;
  icon: string;
  byUserId: string;
  blocks: NewBlock[];
  fullWidth?: boolean;
}): Promise<string> {
  const [prev] = await db
    .select({ id: pages.id })
    .from(pages)
    .where(and(eq(pages.teamspaceId, opts.teamspaceId), eq(pages.title, opts.title), eq(pages.isArchived, false)));
  let pageId: string;
  if (prev) {
    pageId = prev.id;
    const old = await db.select({ content: blocks.content }).from(blocks).where(and(eq(blocks.pageId, pageId), eq(blocks.type, "database")));
    await db.delete(blocks).where(eq(blocks.pageId, pageId));
    const oldDbs = old.map((x) => x.content.databaseId).filter((x): x is string => typeof x === "string");
    const keep = new Set(opts.blocks.filter((x) => x.type === "database").map((x) => x.content.databaseId as string));
    const drop = oldDbs.filter((id) => !keep.has(id));
    if (drop.length) await db.delete(databases).where(inArray(databases.id, drop));
    await db.update(pages).set({ icon: opts.icon, updatedAt: new Date() }).where(eq(pages.id, pageId));
  } else {
    const [{ top }] = await db.select({ top: max(pages.position) }).from(pages).where(eq(pages.teamspaceId, opts.teamspaceId));
    const [pg] = await db
      .insert(pages)
      .values({
        workspaceId: opts.workspaceId,
        teamspaceId: opts.teamspaceId,
        title: opts.title,
        icon: opts.icon,
        fullWidth: opts.fullWidth ?? false,
        position: (top ?? 0) + 1,
        createdBy: opts.byUserId,
      })
      .returning();
    pageId = pg.id;
  }
  let pos = 0;
  for (const blk of opts.blocks) {
    const [row] = await db.insert(blocks).values({ pageId, type: blk.type, content: blk.content, position: ++pos }).returning();
    if (blk.children?.length)
      await db
        .insert(blocks)
        .values(blk.children.map((c, i) => ({ pageId, parentBlockId: row.id, type: c.type, content: c.content, position: i + 1 })));
  }
  return pageId;
}

export interface ColumnDef {
  name: string;
  type: DbProperty["type"];
  /** select options, in order, with colors */
  options?: { name: string; color: string }[];
  numberFormat?: string;
}

/** A database with typed columns, rows given by column name, and views
 *  described by column name (resolved to property ids here). */
export async function createAgentDatabase(opts: {
  workspaceId: string;
  byUserId: string;
  title: string;
  columns: ColumnDef[];
  rows: Record<string, unknown>[];
  views: { name: string; type: "table" | "board" | "calendar" | "list" | "gallery"; groupBy?: string; date?: string; hide?: string[] }[];
}): Promise<string> {
  const [database] = await db.insert(databases).values({ workspaceId: opts.workspaceId, title: opts.title, createdBy: opts.byUserId }).returning();
  const props = await db
    .insert(dbProperties)
    .values(
      opts.columns.map((c, i) => ({
        databaseId: database.id,
        name: c.name,
        type: c.type,
        config: c.options
          ? { options: c.options.map((o) => ({ id: crypto.randomUUID(), name: o.name, color: o.color })) }
          : c.numberFormat
            ? { numberFormat: c.numberFormat }
            : {},
        position: i + 1,
      }))
    )
    .returning();
  const byName = new Map(props.map((p) => [p.name, p]));
  const cell = (p: DbProperty, v: unknown) => {
    if (v === undefined || v === null || v === "") return null;
    if (p.type === "select" || p.type === "status") return p.config.options?.find((o) => o.name === v)?.id ?? null;
    if (p.type === "date") return typeof v === "string" ? { start: v } : v;
    return v;
  };
  if (opts.rows.length)
    await db.insert(dbRows).values(
      opts.rows.map((r, i) => ({
        databaseId: database.id,
        position: i + 1,
        createdBy: opts.byUserId,
        updatedBy: opts.byUserId,
        values: Object.fromEntries(props.map((p) => [p.id, cell(p, r[p.name])])),
      }))
    );
  await db.insert(dbViews).values(
    opts.views.map((v, i) => {
      const config: ViewConfig = {};
      if (v.groupBy) config.groupByPropertyId = byName.get(v.groupBy)?.id;
      if (v.date) config.calendarDatePropertyId = byName.get(v.date)?.id;
      if (v.hide) config.hiddenProperties = v.hide.map((h) => byName.get(h)?.id).filter((x): x is string => !!x);
      return { databaseId: database.id, name: v.name, type: v.type, config, position: i + 1 };
    })
  );
  return database.id;
}
