import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { db } from "@/lib/db";
import { teamspaces } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getDefaultWorkspaceId } from "@/lib/workspace";

export const dynamic = "force-dynamic";

/** GET → teamspaces of the caller's active workspace. */
export async function GET() {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;

  const workspaceId = await getDefaultWorkspaceId(auth.user.id);
  if (!workspaceId) return NextResponse.json({ teamspaces: [] });

  const rows = await db
    .select()
    .from(teamspaces)
    .where(eq(teamspaces.workspaceId, workspaceId))
    .orderBy(teamspaces.createdAt);

  return NextResponse.json({ teamspaces: rows });
}

/** POST { name } → create a teamspace in the active workspace. */
export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;

  const workspaceId = await getDefaultWorkspaceId(auth.user.id);
  if (!workspaceId) return NextResponse.json({ error: "No workspace" }, { status: 400 });

  const body = await req.json().catch(() => ({}));
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return NextResponse.json({ error: "Name required" }, { status: 400 });

  const [teamspace] = await db
    .insert(teamspaces)
    .values({ workspaceId, name, createdBy: auth.user.id })
    .returning();

  return NextResponse.json({ teamspace }, { status: 201 });
}
