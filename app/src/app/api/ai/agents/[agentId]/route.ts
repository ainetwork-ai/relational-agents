import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { db } from "@/lib/db";
import { aiAgents } from "@/lib/db/schema";
import { and, eq, or } from "drizzle-orm";
import { getDefaultWorkspaceId } from "@/lib/workspace";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Access: owner (may edit) or workspace-shared agent (may read). */
async function loadAccessible(agentId: string, userId: string) {
  const workspaceId = await getDefaultWorkspaceId(userId);
  const [agent] = await db
    .select()
    .from(aiAgents)
    .where(
      and(
        eq(aiAgents.id, agentId),
        or(
          eq(aiAgents.userId, userId),
          workspaceId ? and(eq(aiAgents.workspaceId, workspaceId), eq(aiAgents.isShared, true)) : undefined
        )
      )
    )
    .limit(1);
  return agent ?? null;
}

async function loadOwned(agentId: string, userId: string) {
  const [agent] = await db
    .select()
    .from(aiAgents)
    .where(and(eq(aiAgents.id, agentId), eq(aiAgents.userId, userId)))
    .limit(1);
  return agent ?? null;
}

/** GET → { agent } (owned or workspace-shared). */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ agentId: string }> }) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  const { agentId } = await ctx.params;
  const agent = await loadAccessible(agentId, auth.user.id);
  if (!agent) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ agent });
}

/** PATCH { name?, icon?, instructions?, isFavorite?, isShared?, knowledgeScope?, lastUsedAt? }
 * → { agent }. Owner-only edits — no access reads as 404. */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ agentId: string }> }) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  const { agentId } = await ctx.params;
  const agent = await loadOwned(agentId, auth.user.id);
  if (!agent) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const patch: Partial<typeof aiAgents.$inferInsert> = {};
  if (typeof body?.name === "string") patch.name = body.name.trim() || "New agent";
  if (typeof body?.icon === "string" || body?.icon === null) patch.icon = body.icon;
  if (typeof body?.instructions === "string") patch.instructions = body.instructions;
  if (typeof body?.isFavorite === "boolean") patch.isFavorite = body.isFavorite;
  if (typeof body?.isShared === "boolean") patch.isShared = body.isShared;
  if (body?.knowledgeScope && typeof body.knowledgeScope === "object") {
    const pageIds = Array.isArray(body.knowledgeScope.pageIds)
      ? body.knowledgeScope.pageIds.filter((id: unknown): id is string => typeof id === "string")
      : [];
    patch.knowledgeScope = { pageIds };
  }
  if (body?.lastUsedAt === true) patch.lastUsedAt = new Date();
  if (Object.keys(patch).length === 0) return NextResponse.json({ agent });

  const [updated] = await db
    .update(aiAgents)
    .set(patch)
    .where(eq(aiAgents.id, agentId))
    .returning();
  return NextResponse.json({ agent: updated });
}

/** DELETE → { ok }. Owner-only — no access reads as 404. */
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ agentId: string }> }) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  const { agentId } = await ctx.params;
  const agent = await loadOwned(agentId, auth.user.id);
  if (!agent) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await db.delete(aiAgents).where(eq(aiAgents.id, agentId));
  return NextResponse.json({ ok: true });
}
