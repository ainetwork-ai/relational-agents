import { db } from "@/lib/db";
import { aiUsage } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

/** Read the workspace's AI usage row, creating the default (free/0/20) if missing. */
export async function getOrCreateUsage(workspaceId: string) {
  const [existing] = await db
    .select()
    .from(aiUsage)
    .where(eq(aiUsage.workspaceId, workspaceId))
    .limit(1);
  if (existing) return existing;

  const [created] = await db
    .insert(aiUsage)
    .values({ workspaceId })
    .onConflictDoNothing({ target: aiUsage.workspaceId })
    .returning();
  if (created) return created;

 // if concurrent requests raced the insert: re-read the row the other request just made.
  const [row] = await db
    .select()
    .from(aiUsage)
    .where(eq(aiUsage.workspaceId, workspaceId))
    .limit(1);
  return row;
}

export function usageRemaining(usage: { messageCount: number; monthlyLimit: number }) {
  return Math.max(0, usage.monthlyLimit - usage.messageCount);
}

/** Whether the free plan hit its monthly cap (paid plans like plus mock unlimited). */
export function isOverLimit(usage: { plan: string; messageCount: number; monthlyLimit: number }) {
  return usage.plan === "free" && usage.messageCount >= usage.monthlyLimit;
}
