import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { db } from "@/lib/db";
import { users, workspaceMembers } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { loadDatabaseForUser } from "@/lib/db-access";
import { isOkfId } from "@/lib/okf-store";
import { getDefaultWorkspaceId } from "@/lib/workspace";
import { toPublicUser } from "@/lib/auth/public-user";

export const dynamic = "force-dynamic";

/** GET → members of the workspace THIS database lives in — not the session's
 * active workspace. Person cells resolve ids against this roster, and a member
 * whose switcher points at another workspace (their personal one, say) must
 * still see names here, not "Unknown user". An OKF (file-backed) database
 * has no workspace row, so it answers with the active workspace's roster. */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ databaseId: string }> }
) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  const { databaseId } = await params;

  let workspaceId: string | null;
  if (isOkfId(databaseId)) {
    workspaceId = await getDefaultWorkspaceId(auth.user.id);
  } else {
    const database = await loadDatabaseForUser(databaseId, auth.user.id);
    if (!database) return NextResponse.json({ error: "Not found" }, { status: 404 });
    workspaceId = database.workspaceId;
  }
  if (!workspaceId) return NextResponse.json({ members: [] });

  const rows = await db
    .select({ user: users, role: workspaceMembers.role })
    .from(workspaceMembers)
    .innerJoin(users, eq(workspaceMembers.userId, users.id))
    .where(and(eq(workspaceMembers.workspaceId, workspaceId)));

  return NextResponse.json({
    members: rows.map((r) => ({ ...toPublicUser(r.user), role: r.role })),
  });
}
