import "server-only";
import path from "node:path";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  blocks,
  databases,
  dbProperties,
  dbRows,
  pages,
  teamspaces,
  users,
  workspaces,
  type DbProperty,
  type DbRow,
} from "@/lib/db/schema";
import { getPagePermission } from "@/lib/auth/share-token";
import { getWorkspaceRole } from "@/lib/auth/workspace-role";
import { visibleTeamspace } from "@/lib/aindrive-teamspace";
import { okfGateFor, type OkfGate } from "@/lib/okf-acl";
import { decodeId, encodeId, isOkfId, okfDatabaseSnapshot, readNode, type ContentNode } from "@/lib/okf-store";
import { cleanTitle } from "@/lib/memory-parse";
import type { RelatedSnapshots } from "@/lib/db-values";
import type { Located, PromptSource, SourceDatabase, SourcePage } from "./collect";
import { isUuid } from "./input";
import { mapBlock, nestBlocks, nestByDepth, rowPageId, rowProperties, rowTitle, schemaOf, type MapCtx, type ValueCtx } from "./map";
import type { PBlock, PPage } from "./model";

/**
 * The PromptSource over ainmem's real content: Postgres pages / blocks / databases and
 * the OKF file tree, read for a set of READERS.
 *
 * canSee() is true only when EVERY reader may see the thing — the same rule the
 * agent already follows for drives (answerViewers + sharedDriveSources): a quiet
 * question has one reader, a room question everyone in the room.
 *  - a Postgres page: getPagePermission(page, reader) for each reader (restricted pages,
 *    private teamspaces, guests, explicit grants — the one rule every route uses)
 *  - an OKF page / database: the okf_acl gate of each reader
 *  - a Postgres database: through the page that holds it — a database has no ACL of its
 *    own (GET /api/databases checks the workspace only), so it counts as visible when each
 *    reader can see a page that embeds it (its original block, not a linked view, when it
 *    has one); one embedded nowhere, when each reader is a member of its workspace
 *  - a teamspace (as a root): visibleTeamspace for each reader
 * The agent's own user is never a reader: it has no workspace role.
 */

export const TEAMSPACE_PREFIX = "teamspace:";

export interface DbSourceOptions {
  /** the people who will read the result (at least one) */
  viewerIds: string[];
  /** origin for page links, "" for relative `/p/<id>` */
  baseUrl: string;
}

export interface DbSource extends PromptSource {
  locate(id: string): Promise<Located | null>;
  /** where a database lives: the pages holding its block (originals first) */
  homesOf(databaseId: string): Promise<string[]>;
  mapCtx: MapCtx;
}

export function createDbSource(opts: DbSourceOptions): DbSource {
  const viewers = [...new Set(opts.viewerIds)].filter(Boolean);
  const pageUrl = (id: string) => `${opts.baseUrl}/p/${id}`;
  const mapCtx: MapCtx = { pageUrl };
  const seen = new Map<string, Promise<boolean>>();
  let gates: Promise<OkfGate[]> | null = null;
  const okfGates = () => (gates ??= Promise.all(viewers.map((v) => okfGateFor(v))));
  const once = (key: string, fn: () => Promise<boolean>) => {
    if (!seen.has(key)) seen.set(key, fn().catch(() => false));
    return seen.get(key)!;
  };

  const okfVisible = async (id: string) => {
    if (!viewers.length) return false;
    const gs = await okfGates();
    return gs.every((g) => g.canReadId(id));
  };

  async function pageVisible(id: string): Promise<boolean> {
    if (!viewers.length) return false;
    if (id.startsWith(TEAMSPACE_PREFIX)) {
      const tsId = id.slice(TEAMSPACE_PREFIX.length);
      if (!isUuid(tsId)) return false;
      for (const v of viewers) if (!(await visibleTeamspace(v, tsId))) return false;
      return true;
    }
    if (isUuid(id)) {
      const [p] = await db.select({ archived: pages.isArchived }).from(pages).where(eq(pages.id, id));
      if (!p || p.archived) return false;
      for (const v of viewers) if (!(await getPagePermission(id, v))) return false;
      return true;
    }
    if (isOkfId(id)) return (await okfVisible(id)) && readNodeSafe(id) !== null;
    return false;
  }

  /** pages holding a database's block: its original (not a linked view) first */
  async function hostsOf(databaseId: string): Promise<{ originals: string[]; linked: string[] }> {
    const rows = await db
      .select({ pageId: blocks.pageId, content: blocks.content })
      .from(blocks)
      .innerJoin(pages, eq(pages.id, blocks.pageId))
      .where(
        and(
          eq(blocks.type, "database"),
          eq(blocks.alive, true),
          eq(pages.isArchived, false),
          sql`${blocks.content}->>'databaseId' = ${databaseId}`
        )
      );
    return {
      originals: [...new Set(rows.filter((r) => !r.content?.linkedViewId).map((r) => r.pageId))],
      linked: [...new Set(rows.filter((r) => r.content?.linkedViewId).map((r) => r.pageId))],
    };
  }

  async function homesOf(databaseId: string): Promise<string[]> {
    const h = await hostsOf(databaseId);
    return [...h.originals, ...h.linked.filter((x) => !h.originals.includes(x))];
  }

  async function databaseVisible(id: string): Promise<boolean> {
    if (!viewers.length) return false;
    if (!isUuid(id)) return isOkfId(id) ? okfVisible(id) : false;
    const [d] = await db.select({ workspaceId: databases.workspaceId }).from(databases).where(eq(databases.id, id));
    if (!d) return false;
    const h = await hostsOf(id);
    const homes = h.originals.length ? h.originals : h.linked;
    if (!homes.length) {
      for (const v of viewers) {
        const role = await getWorkspaceRole(d.workspaceId, v);
        if (!role || role === "guest") return false;
      }
      return true;
    }
    for (const v of viewers) {
      let any = false;
      for (const home of homes)
        if (await getPagePermission(home, v)) {
          any = true;
          break;
        }
      if (!any) return false;
    }
    return true;
  }

  function readNodeSafe(id: string): ContentNode | null {
    try {
      return readNode(decodeId(id));
    } catch {
      return null;
    }
  }

  async function usersById(ids: string[]) {
    const uniq = [...new Set(ids.filter((x) => isUuid(x)))];
    const out = new Map<string, { name?: string | null; email?: string | null }>();
    if (!uniq.length) return out;
    for (const u of await db.select({ id: users.id, name: users.displayName, email: users.email }).from(users).where(inArray(users.id, uniq)))
      out.set(u.id, { name: u.name, email: u.email });
    return out;
  }

  const personIdsIn = (props: DbProperty[], rows: DbRow[]) => {
    const ids: string[] = [];
    for (const r of rows) {
      if (r.createdBy) ids.push(r.createdBy);
      if (r.updatedBy) ids.push(r.updatedBy);
      for (const p of props)
        if (p.type === "person") {
          const v = r.values?.[p.id];
          if (Array.isArray(v)) ids.push(...v.filter((x): x is string => typeof x === "string"));
          else if (typeof v === "string") ids.push(v);
        }
    }
    return ids;
  };

  /** relation / rollup targets the readers may see, loaded once */
  async function relatedFor(props: DbProperty[]): Promise<RelatedSnapshots> {
    const out: RelatedSnapshots = {};
    const targets = new Set<string>();
    for (const p of props) {
      if (p.config?.relationDatabaseId) targets.add(p.config.relationDatabaseId);
      if (p.config?.mirrorOf?.databaseId) targets.add(p.config.mirrorOf.databaseId);
    }
    for (const t of targets) {
      if (!isUuid(t) || !(await once(`db:${t}`, () => databaseVisible(t)))) continue;
      const tp = await db.select().from(dbProperties).where(eq(dbProperties.databaseId, t)).orderBy(asc(dbProperties.position));
      const tr = await db.select().from(dbRows).where(eq(dbRows.databaseId, t)).orderBy(asc(dbRows.position));
      out[t] = { properties: tp, rows: tr };
    }
    return out;
  }

  const live = (r: DbRow) => !r.values?.__template && !r.values?.__archived;

  /** a row page's properties — the row's values, when its database is one the readers see */
  async function rowPageProps(pageId: string): Promise<PPage["properties"]> {
    const [r] = await db.select().from(dbRows).where(sql`${dbRows.values}->>'__page' = ${pageId}`).limit(1);
    if (!r || !(await once(`db:${r.databaseId}`, () => databaseVisible(r.databaseId)))) return [];
    const props = await db.select().from(dbProperties).where(eq(dbProperties.databaseId, r.databaseId)).orderBy(asc(dbProperties.position));
    const ctx: ValueCtx = { users: await usersById(personIdsIn(props, [r])), props, related: await relatedFor(props) };
    return rowProperties(props, r, ctx);
  }

  async function postgresPage(id: string): Promise<SourcePage | null> {
    const [p] = await db.select().from(pages).where(eq(pages.id, id));
    if (!p || p.isArchived) return null;
    const rows = await db
      .select({ id: blocks.id, type: blocks.type, content: blocks.content, parentBlockId: blocks.parentBlockId, position: blocks.position })
      .from(blocks)
      .where(and(eq(blocks.pageId, id), eq(blocks.alive, true)))
      .orderBy(asc(blocks.position));
    const kids = await db
      .select({ id: pages.id })
      .from(pages)
      .where(and(eq(pages.parentPageId, id), eq(pages.isArchived, false)))
      .orderBy(asc(pages.position));
    return {
      id: p.id,
      title: p.title,
      url: pageUrl(p.id),
      icon: p.icon,
      properties: await rowPageProps(p.id),
      blocks: nestBlocks(rows, mapCtx),
      childPageIds: kids.map((k) => k.id),
    };
  }

  async function teamspacePage(id: string): Promise<SourcePage | null> {
    const tsId = id.slice(TEAMSPACE_PREFIX.length);
    const [ts] = await db.select().from(teamspaces).where(eq(teamspaces.id, tsId));
    if (!ts) return null;
    const top = await db
      .select({ id: pages.id })
      .from(pages)
      .where(and(eq(pages.teamspaceId, tsId), isNull(pages.parentPageId), eq(pages.isArchived, false)))
      .orderBy(asc(pages.position));
    return { id, title: ts.name, url: `${opts.baseUrl}/`, icon: ts.icon, properties: [], blocks: [], childPageIds: top.map((t) => t.id) };
  }

  /** OKF FsProperty / FsRow → the Postgres shapes map.ts reads */
  const fsProps = (dbId: string, props: { id: string; name: string; type: string; config: object; position: number }[]) =>
    props.map((p) => ({ id: p.id, databaseId: dbId, name: p.name, type: p.type, config: p.config ?? {}, position: p.position, createdAt: new Date(0) })) as DbProperty[];
  const fsRow = (dbId: string, r: { id: string; values: Record<string, unknown>; position: number }) =>
    ({ id: r.id, databaseId: dbId, values: r.values, position: r.position, parentRowId: null, createdBy: null, updatedBy: null, createdAt: new Date(0), updatedAt: new Date(0) }) as DbRow;

  async function okfPage(id: string): Promise<SourcePage | null> {
    const node = readNodeSafe(id);
    if (!node || node.kind === "database") return null;
    const blocksOut: PBlock[] = nestByDepth(
      node.blocks.map((b) => ({ id: b.id, type: b.type, content: b.content, depth: b.depth })),
      mapCtx
    );
    const childPageIds: string[] = [];
    let properties: PPage["properties"] = [];
    if (node.kind === "page") {
      for (const c of node.children) {
        const cid = encodeId(c.id);
        if (c.kind === "database") blocksOut.push({ id: `childdb:${cid}`, type: "child_database", title: c.name, content: { state: "not_fetched", databaseId: cid } });
        else childPageIds.push(cid);
      }
    } else {
      const props = fsProps(node.dbId, node.properties);
      properties = rowProperties(props, fsRow(node.dbId, node.row), { users: new Map(), props });
    }
    return { id, title: node.title, url: pageUrl(id), properties, blocks: blocksOut, childPageIds };
  }

  async function page(id: string): Promise<SourcePage | null> {
    if (id.startsWith(TEAMSPACE_PREFIX)) return teamspacePage(id);
    if (isUuid(id)) return postgresPage(id);
    if (isOkfId(id)) return okfPage(id);
    return null;
  }

  async function database(id: string): Promise<SourceDatabase | null> {
    if (isOkfId(id)) {
      const snap = await okfDatabaseSnapshot(id, decodeId(id)).catch(() => null);
      if (!snap) return null;
      const ctx: ValueCtx = { users: new Map(), props: snap.properties };
      return {
        id,
        title: snap.database.title,
        url: pageUrl(id),
        schema: schemaOf(snap.properties),
        rows: snap.rows.map((r) => {
          const pid = typeof r.values.__page === "string" ? r.values.__page : r.id;
          return { id: pid, title: rowTitle(snap.properties, r), url: pageUrl(pid), properties: rowProperties(snap.properties, r, ctx), blocks: [], hasPage: typeof r.values.__page === "string" };
        }),
      };
    }
    if (!isUuid(id)) return null;
    const [d] = await db.select().from(databases).where(eq(databases.id, id));
    if (!d) return null;
    const props = await db.select().from(dbProperties).where(eq(dbProperties.databaseId, id)).orderBy(asc(dbProperties.position));
    const rows = (await db.select().from(dbRows).where(eq(dbRows.databaseId, id)).orderBy(asc(dbRows.position))).filter(live);
    const ctx: ValueCtx = { users: await usersById(personIdsIn(props, rows)), props, related: await relatedFor(props) };
    const home = (await homesOf(id))[0];
    const dbUrl = home ? pageUrl(home) : `${opts.baseUrl}/`;
    return {
      id,
      title: d.title,
      url: dbUrl,
      schema: schemaOf(props),
      rows: rows.map((r) => {
        // the id a relation to this row prints too (map.ts mapValue)
        const id = rowPageId(r);
        const pid = id === r.id ? null : id;
        return {
          id,
          title: rowTitle(props, r),
          url: pid ? pageUrl(pid) : dbUrl,
          properties: rowProperties(props, r, ctx),
          blocks: [],
          hasPage: !!pid,
        };
      }),
    };
  }

  async function block(id: string): Promise<{ block: PBlock; pageId: string } | null> {
    if (!isUuid(id)) return null;
    const [b] = await db.select({ pageId: blocks.pageId, alive: blocks.alive }).from(blocks).where(eq(blocks.id, id));
    if (!b || !b.alive) return null;
    const rows = await db
      .select({ id: blocks.id, type: blocks.type, content: blocks.content, parentBlockId: blocks.parentBlockId, position: blocks.position })
      .from(blocks)
      .where(and(eq(blocks.pageId, b.pageId), eq(blocks.alive, true)));
    // the block and its subtree only
    const inTree = new Set([id]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const r of rows)
        if (r.parentBlockId && inTree.has(r.parentBlockId) && !inTree.has(r.id)) {
          inTree.add(r.id);
          grew = true;
        }
    }
    const sub = rows.filter((r) => inTree.has(r.id)).map((r) => (r.id === id ? { ...r, parentBlockId: null } : r));
    const built = nestBlocks(sub, mapCtx).find((x) => x.id === id);
    const self = rows.find((r) => r.id === id)!;
    return { block: built ?? mapBlock(self, [], mapCtx) ?? { id, type: "unsupported", blockType: self.type }, pageId: b.pageId };
  }

  async function title(kind: "page" | "database", id: string): Promise<string | null> {
    if (kind === "database") {
      if (isOkfId(id)) {
        const n = readNodeSafe(id);
        return n ? n.title : null;
      }
      if (!isUuid(id)) return null;
      const [d] = await db.select({ title: databases.title }).from(databases).where(eq(databases.id, id));
      return d ? d.title || "Untitled Database" : null;
    }
    if (id.startsWith(TEAMSPACE_PREFIX)) {
      const [ts] = await db.select({ name: teamspaces.name }).from(teamspaces).where(eq(teamspaces.id, id.slice(TEAMSPACE_PREFIX.length)));
      return ts?.name ?? null;
    }
    if (isUuid(id)) {
      const [p] = await db.select({ title: pages.title }).from(pages).where(eq(pages.id, id));
      return p ? p.title || "Untitled" : null;
    }
    const n = isOkfId(id) ? readNodeSafe(id) : null;
    return n ? n.title : null;
  }

  async function everyoneSeesTeamspace(tsId: string) {
    for (const v of viewers) if (!(await visibleTeamspace(v, tsId))) return false;
    return viewers.length > 0;
  }

  async function location(root: Located, pageOfBlock?: string): Promise<string[]> {
    let anchor: string | undefined = root.kind === "page" ? root.id : root.kind === "block" ? pageOfBlock : undefined;
    if (root.kind === "database") {
      if (isOkfId(root.id)) anchor = root.id;
      else anchor = (await homesOf(root.id))[0];
    }
    if (!anchor) {
      if (root.kind === "database" && isUuid(root.id)) {
        const [d] = await db.select({ ws: workspaces.name }).from(databases).innerJoin(workspaces, eq(workspaces.id, databases.workspaceId)).where(eq(databases.id, root.id));
        return d ? [d.ws] : [];
      }
      return [];
    }
    if (anchor.startsWith(TEAMSPACE_PREFIX)) {
      const [ts] = await db
        .select({ name: teamspaces.name, ws: workspaces.name })
        .from(teamspaces)
        .innerJoin(workspaces, eq(workspaces.id, teamspaces.workspaceId))
        .where(eq(teamspaces.id, anchor.slice(TEAMSPACE_PREFIX.length)));
      return ts ? [ts.ws] : [];
    }
    if (isOkfId(anchor)) {
      const rel = decodeId(anchor).split("#")[0];
      const dirs = path.posix.dirname(rel);
      return ["okf", ...(dirs === "." ? [] : dirs.split("/").map((d) => cleanTitle(d)))];
    }
    const [p] = await db
      .select({ ws: workspaces.name, teamspaceId: pages.teamspaceId, parent: pages.parentPageId })
      .from(pages)
      .innerJoin(workspaces, eq(workspaces.id, pages.workspaceId))
      .where(eq(pages.id, anchor));
    if (!p) return [];
    const out = [p.ws];
    if (p.teamspaceId && (await everyoneSeesTeamspace(p.teamspaceId))) {
      const [ts] = await db.select({ name: teamspaces.name }).from(teamspaces).where(eq(teamspaces.id, p.teamspaceId));
      if (ts) out.push(ts.name);
    }
    const ancestors: string[] = [];
    let cur = p.parent;
    for (let i = 0; cur && i < 20; i++) {
      if (!(await once(`page:${cur}`, () => pageVisible(cur!)))) break;
      const [a] = await db.select({ title: pages.title, parent: pages.parentPageId }).from(pages).where(eq(pages.id, cur));
      if (!a) break;
      ancestors.unshift(a.title || "Untitled");
      cur = a.parent;
    }
    return [...out, ...ancestors];
  }

  async function locate(id: string): Promise<Located | null> {
    if (id.startsWith(TEAMSPACE_PREFIX)) return { kind: "page", id };
    if (isUuid(id)) {
      const [p] = await db.select({ id: pages.id, archived: pages.isArchived }).from(pages).where(eq(pages.id, id));
      if (p && !p.archived) {
        // a database page: its body is one full-page database block — the database is the object
        const top = await db
          .select({ type: blocks.type, content: blocks.content })
          .from(blocks)
          .where(and(eq(blocks.pageId, id), eq(blocks.alive, true), isNull(blocks.parentBlockId)));
        if (top.length === 1 && top[0].type === "database" && top[0].content?.fullPage && typeof top[0].content.databaseId === "string")
          return { kind: "database", id: top[0].content.databaseId };
        return { kind: "page", id };
      }
      if (p) return null;
      const [d] = await db.select({ id: databases.id }).from(databases).where(eq(databases.id, id));
      if (d) return { kind: "database", id };
      const [b] = await db.select({ id: blocks.id }).from(blocks).where(and(eq(blocks.id, id), eq(blocks.alive, true)));
      if (b) return { kind: "block", id };
      return null;
    }
    if (isOkfId(id)) {
      const node = readNodeSafe(id);
      if (!node) return null;
      return { kind: node.kind === "database" ? "database" : "page", id };
    }
    return null;
  }

  return {
    mapCtx,
    locate,
    homesOf,
    page,
    database,
    block,
    title,
    location,
    canSee: (kind, id) => once(`${kind === "page" ? "page" : "db"}:${id}`, () => (kind === "page" ? pageVisible(id) : databaseVisible(id))),
  };
}
