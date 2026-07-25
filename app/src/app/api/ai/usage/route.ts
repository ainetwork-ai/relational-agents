import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { db } from "@/lib/db";
import { aiUsage } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getDefaultWorkspaceId } from "@/lib/workspace";
import { getOrCreateUsage, usageRemaining } from "@/lib/ai-usage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function toResponse(usage: {
  plan: string;
  messageCount: number;
  monthlyLimit: number;
  aiDisabledByAdmin: boolean;
}) {
  return {
    plan: usage.plan,
    messageCount: usage.messageCount,
    monthlyLimit: usage.monthlyLimit,
    remaining: usageRemaining(usage),
    aiDisabledByAdmin: usage.aiDisabledByAdmin,
  };
}

/** GET /api/ai/usage → { plan, messageCount, monthlyLimit, remaining, aiDisabledByAdmin }. */
export async function GET() {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  const workspaceId = await getDefaultWorkspaceId(auth.user.id);
  if (!workspaceId) return NextResponse.json({ error: "No workspace" }, { status: 400 });

  const usage = await getOrCreateUsage(workspaceId);
  return NextResponse.json(toResponse(usage));
}

/**
 * PATCH { plan?, aiDisabledByAdmin?, resetCount?, messageCount? } → update (test/admin mock).
 * `messageCount` isn't in the contract doc, but e2e needs to force the
 * at-limit state, so direct setting is allowed (in normal flow only the
 * message-send route increments it).
 */
export async function PATCH(req: NextRequest) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  const workspaceId = await getDefaultWorkspaceId(auth.user.id);
  if (!workspaceId) return NextResponse.json({ error: "No workspace" }, { status: 400 });

  await getOrCreateUsage(workspaceId); // create the default row first if missing

  const body = await req.json().catch(() => ({}));
  const patch: Partial<typeof aiUsage.$inferInsert> = {};
  if (typeof body?.plan === "string") patch.plan = body.plan;
  if (typeof body?.aiDisabledByAdmin === "boolean") patch.aiDisabledByAdmin = body.aiDisabledByAdmin;
  if (body?.resetCount === true) patch.messageCount = 0;
  if (typeof body?.messageCount === "number") patch.messageCount = Math.max(0, body.messageCount);

  if (Object.keys(patch).length === 0) {
    const usage = await getOrCreateUsage(workspaceId);
    return NextResponse.json(toResponse(usage));
  }

  patch.updatedAt = new Date();
  const [updated] = await db
    .update(aiUsage)
    .set(patch)
    .where(eq(aiUsage.workspaceId, workspaceId))
    .returning();
  return NextResponse.json(toResponse(updated));
}
