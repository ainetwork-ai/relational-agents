import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { db } from "@/lib/db";
import { workspaces } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getDefaultWorkspaceId } from "@/lib/workspace";
import { requireWorkspaceRole } from "@/lib/auth/workspace-role";

export const dynamic = "force-dynamic";

function publicWorkspace(w: typeof workspaces.$inferSelect) {
  return {
    id: w.id,
    name: w.name,
    iconText: w.iconText,
    iconUrl: w.iconUrl,
    description: w.description,
  };
}

/** GET → the caller's active workspace (name / icon / description). */
export async function GET() {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;

  const workspaceId = await getDefaultWorkspaceId(auth.user.id);
  if (!workspaceId) return NextResponse.json({ workspace: null });

  const [workspace] = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .limit(1);
  return NextResponse.json({ workspace: workspace ? publicWorkspace(workspace) : null });
}

/** PATCH { name?, iconText?, description? } → update the active workspace. */
export async function PATCH(req: NextRequest) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;

  const workspaceId = await getDefaultWorkspaceId(auth.user.id);
  if (!workspaceId) return NextResponse.json({ error: "No workspace" }, { status: 400 });

  // Editing workspace settings requires admin (or owner).
  const roleCheck = await requireWorkspaceRole(workspaceId, auth.user.id, "admin");
  if (roleCheck !== true) return roleCheck;

  const body = await req.json().catch(() => ({}));
  const update: Partial<typeof workspaces.$inferInsert> = {};
  if (typeof body.name === "string" && body.name.trim()) update.name = body.name.trim();
  if (typeof body.iconText === "string") update.iconText = body.iconText.trim() || "WS";
  if (typeof body.description === "string") update.description = body.description;

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  try {
    const [updated] = await db
      .update(workspaces)
      .set(update)
      .where(eq(workspaces.id, workspaceId))
      .returning();
    return NextResponse.json({ workspace: publicWorkspace(updated) });
  } catch {
    // workspaces.name is globally unique — a taken name collides.
    return NextResponse.json({ error: "That workspace name is taken" }, { status: 409 });
  }
}
