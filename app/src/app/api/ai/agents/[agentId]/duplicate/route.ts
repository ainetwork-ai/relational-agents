import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { db } from "@/lib/db";
import { aiAgents } from "@/lib/db/schema";
import { and, eq, or } from "drizzle-orm";
import { getDefaultWorkspaceId } from "@/lib/workspace";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** POST → { agent } — duplicate an accessible (owned or shared) agent as an
 *  owned "Name (copy)". */
export async function POST(_req: NextRequest, ctx: { params: Promise<{ agentId: string }> }) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  const { agentId } = await ctx.params;
  const workspaceId = await getDefaultWorkspaceId(auth.user.id);

  const [src] = await db
    .select()
    .from(aiAgents)
    .where(
      and(
        eq(aiAgents.id, agentId),
        or(
          eq(aiAgents.userId, auth.user.id),
          workspaceId ? and(eq(aiAgents.workspaceId, workspaceId), eq(aiAgents.isShared, true)) : undefined
        )
      )
    )
    .limit(1);
  if (!src) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!workspaceId) return NextResponse.json({ error: "No workspace" }, { status: 400 });

  const [agent] = await db
    .insert(aiAgents)
    .values({
      workspaceId,
      userId: auth.user.id,
      name: `${src.name} (copy)`,
      icon: src.icon,
      instructions: src.instructions,
      knowledgeScope: src.knowledgeScope,
    })
    .returning();
  return NextResponse.json({ agent }, { status: 201 });
}
