import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { db } from "@/lib/db";
import { aiAgents } from "@/lib/db/schema";
import { and, eq, or, sql } from "drizzle-orm";
import { getDefaultWorkspaceId } from "@/lib/workspace";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/ai/agents → { agents } — mine + the current workspace's shared
 * (isShared) agents, most recently used first (lastUsedAt desc, nulls last →
 * updatedAt desc). */
export async function GET() {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  const workspaceId = await getDefaultWorkspaceId(auth.user.id);

  const agents = await db
    .select()
    .from(aiAgents)
    .where(
      or(
        eq(aiAgents.userId, auth.user.id),
        workspaceId
          ? and(eq(aiAgents.workspaceId, workspaceId), eq(aiAgents.isShared, true))
          : sql`false`
      )
    )
    .orderBy(sql`${aiAgents.lastUsedAt} desc nulls last`, sql`${aiAgents.updatedAt} desc`);
  return NextResponse.json({ agents });
}

/** POST /api/ai/agents { name?, icon?, instructions? } → { agent } — new Custom Agent. */
export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  const workspaceId = await getDefaultWorkspaceId(auth.user.id);
  if (!workspaceId) return NextResponse.json({ error: "No workspace" }, { status: 400 });

  const body = await req.json().catch(() => ({}));
  const [agent] = await db
    .insert(aiAgents)
    .values({
      workspaceId,
      userId: auth.user.id,
      name: typeof body?.name === "string" && body.name.trim() ? body.name.trim() : "New agent",
      icon: typeof body?.icon === "string" ? body.icon : null,
      instructions: typeof body?.instructions === "string" ? body.instructions : "",
    })
    .returning();
  return NextResponse.json({ agent }, { status: 201 });
}
