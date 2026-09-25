import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { db } from "@/lib/db";
import { teamspaces, teamspaceMembers, pages } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getDefaultWorkspaceId, workspaceForRequest } from "@/lib/workspace";

export const dynamic = "force-dynamic";

/** GET [?workspaceId=] → teamspaces of that workspace (member-checked), else
 * of the caller's active workspace. The sidebar asks for the viewed page's
 * workspace so the list is right before the session follows (QA-3). */
export async function GET(req: NextRequest) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;

  const workspaceId = await workspaceForRequest(req, auth.user.id);
  if (!workspaceId) return NextResponse.json({ teamspaces: [] });

  const rows = await db
    .select()
    .from(teamspaces)
    .where(eq(teamspaces.workspaceId, workspaceId))
    .orderBy(teamspaces.createdAt);
  // a private teamspace is not even named to someone outside it (a surprise
  // birthday plan, say) — the same rule its pages and folders follow
  const mine = new Set(
    (
      await db
        .select({ id: teamspaceMembers.teamspaceId })
        .from(teamspaceMembers)
        .where(eq(teamspaceMembers.userId, auth.user.id))
    ).map((m) => m.id)
  );
  return NextResponse.json({ teamspaces: rows.filter((t) => t.visibility !== "private" || mine.has(t.id)) });
}

const VISIBILITIES = ["open", "closed", "private"] as const;

/**
 * POST { name, description?, icon?, visibility? } → create a teamspace.
 *
 * Mirrors step 1 of Notion's 팀스페이스 만들기 dialog: icon + name, an optional
 * description, and the 보안 choice. The creator is written into
 * teamspace_members as owner in the same transaction — a teamspace with no
 * members would be unreachable by the person who just made it.
 */
export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;

  const workspaceId = await getDefaultWorkspaceId(auth.user.id);
  if (!workspaceId) return NextResponse.json({ error: "No workspace" }, { status: 400 });

  const body = await req.json().catch(() => ({}));
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 80) : "";
  if (!name) return NextResponse.json({ error: "Name required" }, { status: 400 });
  const description =
    typeof body.description === "string" ? body.description.trim().slice(0, 300) : "";
  const icon = typeof body.icon === "string" && body.icon ? body.icon.slice(0, 8) : null;
  const visibility = VISIBILITIES.includes(body.visibility) ? body.visibility : "open";

  const teamspace = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(teamspaces)
      .values({ workspaceId, name, description, icon, visibility, createdBy: auth.user.id })
      .returning();
    await tx
      .insert(teamspaceMembers)
      .values({ teamspaceId: row.id, userId: auth.user.id, role: "owner" })
      .onConflictDoNothing();
    // Notion gives a new teamspace one page — 팀스페이스 홈 — so it is never an
    // empty row you cannot click into. Same transaction: a teamspace that
    // exists without its home page would be a half-created thing.
    await tx.insert(pages).values({
      workspaceId,
      teamspaceId: row.id,
      title: "팀스페이스 홈",
      icon: "🏠",
      parentPageId: null,
      position: Date.now(),
      createdBy: auth.user.id,
    });
    return row;
  });

  return NextResponse.json({ teamspace }, { status: 201 });
}
