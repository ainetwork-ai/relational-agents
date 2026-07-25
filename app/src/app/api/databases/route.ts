import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { getDefaultWorkspaceId } from "@/lib/workspace";
import { provisionDatabase } from "@/lib/db/provision-database";
import { db } from "@/lib/db";
import { databases } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

/** GET /api/databases → { databases: [{ id, title }] } for the user's workspace.
 *  Powers the relation property's target-database picker. */
export async function GET() {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;

  const workspaceId = await getDefaultWorkspaceId(auth.user.id);
  if (!workspaceId) return NextResponse.json({ databases: [] });

  const rows = await db
    .select({ id: databases.id, title: databases.title })
    .from(databases)
    .where(eq(databases.workspaceId, workspaceId))
    .orderBy(databases.createdAt);

  return NextResponse.json({ databases: rows });
}

/** POST /api/databases { title? } → provisions a project-tracker database. */
export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;

  const body = await req.json().catch(() => ({}));
  const workspaceId = await getDefaultWorkspaceId(auth.user.id);
  if (!workspaceId) {
    return NextResponse.json({ error: "No workspace" }, { status: 400 });
  }

  const snapshot = await provisionDatabase(
    workspaceId,
    auth.user.id,
    body?.title || "Tasks"
  );
  return NextResponse.json(snapshot, { status: 201 });
}
