// app/src/lib/ens-nicknames.ts
// Extra words the family uses for each other ("Junie" for Minjun). Kept in the family's
// workspace, never onchain: ENS records are public (spec D13).
import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { databases, dbProperties, dbRows, pages, teamspaces } from "@/lib/db/schema";
import { b, createAgentDatabase, writeAgentPage } from "@/lib/agent/agent-pages";
import { ensureGeneralTeamspace } from "@/lib/workspace";
import type { T } from "@/i18n/translate";
import { descendants, type FamilyNode } from "@/lib/ens-family/family-tree";

export const NICKNAMES_DB_TITLE = "Family nicknames";

async function findTable(workspaceId: string): Promise<string | null> {
  const [d] = await db
    .select({ id: databases.id })
    .from(databases)
    .where(and(eq(databases.workspaceId, workspaceId), eq(databases.title, NICKNAMES_DB_TITLE)))
    .limit(1);
  return d?.id ?? null;
}

/** ENS name (lower case) → nicknames. Empty when the workspace has no such database. */
export async function loadNicknames(workspaceId: string): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  const id = await findTable(workspaceId);
  if (!id) return out;
  const props = await db.select().from(dbProperties).where(eq(dbProperties.databaseId, id));
  const nameProp = props.find((p) => p.type === "title");
  const nickProp = props.find((p) => p.name === "Nicknames");
  if (!nameProp || !nickProp) return out;
  const rows = await db.select({ values: dbRows.values }).from(dbRows).where(eq(dbRows.databaseId, id));
  for (const r of rows) {
    const name = String(r.values[nameProp.id] ?? "").trim().toLowerCase();
    const nicks = String(r.values[nickProp.id] ?? "").split(",").map((w) => w.trim()).filter(Boolean);
    if (name && nicks.length) out.set(name, [...(out.get(name) ?? []), ...nicks]);
  }
  return out;
}

/** Makes the table once, prefilled with every family name; never touches an existing one. */
export async function ensureNicknamesTable(opts: {
  workspaceId: string;
  byUserId: string;
  tree: FamilyNode;
  t: T;
}): Promise<{ created: boolean; pageId: string | null }> {
  if (await findTable(opts.workspaceId)) return { created: false, pageId: null };
  // a page of that title already holds the table (maybe renamed): writeAgentPage would
  // rebuild it and drop the family's database, so leave it alone
  const [page] = await db
    .select({ id: pages.id })
    .from(pages)
    .where(and(eq(pages.workspaceId, opts.workspaceId), eq(pages.title, NICKNAMES_DB_TITLE), eq(pages.isArchived, false)))
    .limit(1);
  if (page) return { created: false, pageId: null };
  const [first] = await db.select({ id: teamspaces.id }).from(teamspaces).where(eq(teamspaces.workspaceId, opts.workspaceId)).limit(1);
  const teamspaceId = first?.id ?? (await ensureGeneralTeamspace(opts.workspaceId, opts.byUserId));
  const databaseId = await createAgentDatabase({
    workspaceId: opts.workspaceId,
    byUserId: opts.byUserId,
    title: NICKNAMES_DB_TITLE,
    columns: [
      { name: "Name", type: "title" },
      { name: "Nicknames", type: "text" },
    ],
    rows: descendants(opts.tree).map((d) => ({ Name: d.node.name, Nicknames: "" })),
    views: [{ name: opts.t("Table"), type: "table" }],
  });
  const pageId = await writeAgentPage({
    workspaceId: opts.workspaceId,
    teamspaceId,
    title: NICKNAMES_DB_TITLE,
    icon: "🏷️",
    byUserId: opts.byUserId,
    blocks: [
      b.callout("🔒", opts.t("Only people in this workspace can see this page. It never goes on-chain.")),
      b.p(opts.t("Add the names you call each other, separated by commas, so the agent understands “send Junie 5 USDC”.")),
      b.database(databaseId),
    ],
  });
  return { created: true, pageId };
}
