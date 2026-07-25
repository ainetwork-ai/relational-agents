import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { requireRoomAccess } from "@/lib/chat-room-access";
import { runPipeline } from "@/lib/agent/pipeline";

export const dynamic = "force-dynamic";

/** POST /api/agent/rooms/{roomId}/run → RunResult (manual "organize now").
 *  The doc is always created in the room creator's workspace (the pipeline
 *  resolves it) — the caller's workspace is never passed. Allowed: creator,
 *  or any room member (DM). */
export async function POST(_req: NextRequest, ctx: { params: Promise<{ roomId: string }> }) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  const { roomId } = await ctx.params;
  const access = await requireRoomAccess(roomId, auth.user.id);
  if ("error" in access) return access.error;
  try {
    return NextResponse.json(await runPipeline(roomId));
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "pipeline failed" },
      { status: 500 }
    );
  }
}
