import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { db } from "@/lib/db";
import { pages, workspaces, workspaceMembers } from "@/lib/db/schema";
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { getSession } from "@/lib/auth/session";
import { getDefaultWorkspaceId } from "@/lib/workspace";

export const dynamic = "force-dynamic";

/** GET → { workspaces: [...], activeId } — the caller's workspaces. Guest
 * memberships (DM-partner plumbing) are hidden: a relationship must not put
 * someone else's workspace in your switcher. */
export async function GET() {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;

  const rows = await db
    .select({
      id: workspaces.id,
      name: workspaces.name,
      iconText: workspaces.iconText,
      description: workspaces.description,
      role: workspaceMembers.role,
    })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaceMembers.workspaceId, workspaces.id))
    .where(and(eq(workspaceMembers.userId, auth.user.id), ne(workspaceMembers.role, "guest")))
    .orderBy(workspaceMembers.joinedAt);

  // per-workspace last content edit — lets Home order/annotate the cards
  const lastEdited = new Map<string, string>();
  if (rows.length) {
    const edits = await db
      .select({
        workspaceId: pages.workspaceId,
        lastEditedAt: sql<string>`max(${pages.updatedAt})`,
      })
      .from(pages)
      .where(inArray(pages.workspaceId, rows.map((r) => r.id)))
      .groupBy(pages.workspaceId);
    for (const e of edits) lastEdited.set(e.workspaceId, e.lastEditedAt);
  }

  const activeId = await getDefaultWorkspaceId(auth.user.id);
  return NextResponse.json({
    workspaces: rows.map((r) => ({ ...r, lastEditedAt: lastEdited.get(r.id) ?? null })),
    activeId,
  });
}

/** POST { name } → create a workspace, join as owner, switch to it. */
export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;

  const body = await req.json().catch(() => ({}));
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return NextResponse.json({ error: "Name required" }, { status: 400 });

 // workspaces.name is globally unique — suffix on collision so a caller can
 // always create "My Workspace" even if another user already owns that name.
  let workspace;
  try {
    [workspace] = await db
      .insert(workspaces)
      .values({
        name,
        iconText: name.slice(0, 2).toUpperCase() || "WS",
        createdBy: auth.user.id,
      })
      .returning();
  } catch {
    [workspace] = await db
      .insert(workspaces)
      .values({
        name: `${name} ${auth.user.id.slice(0, 6)}`,
        iconText: name.slice(0, 2).toUpperCase() || "WS",
        createdBy: auth.user.id,
      })
      .returning();
  }

  await db
    .insert(workspaceMembers)
    .values({ workspaceId: workspace.id, userId: auth.user.id, role: "owner" })
    .onConflictDoNothing();

  const session = await getSession();
  session.activeWorkspaceId = workspace.id;
  await session.save();

  return NextResponse.json(
    {
      workspace: {
        id: workspace.id,
        name: workspace.name,
        iconText: workspace.iconText,
        description: workspace.description,
        role: "owner",
      },
    },
    { status: 201 }
  );
}
