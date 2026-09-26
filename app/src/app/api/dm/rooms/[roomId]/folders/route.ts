import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { requireRoomAccess } from "@/lib/chat-room-access";
import { aindriveConfigured } from "@/lib/aindrive";
import { roomSources } from "@/lib/agent/shared-drives";
import { folderHandle } from "@/lib/mention/folder";

export const dynamic = "force-dynamic";

/**
 * GET → { folders: [{ handle, label, owner }] }
 *
 * The aindrive folders this room's agent may read — what the composer's "@"
 * menu offers next to the members, so a question can name the folder it is
 * about ("@agent @Mom's-phone what is in this folder?"). The same set the
 * agent reads for a non-quiet message (lib/agent/shared-drives roomSources);
 * the agent narrows to the mentioned ones by the same handle.
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ roomId: string }> }) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  const { roomId } = await ctx.params;
  const access = await requireRoomAccess(roomId, auth.user.id);
  if ("error" in access) return access.error;
  if (!aindriveConfigured()) return NextResponse.json({ folders: [] });
  const sources = await roomSources(access.room, roomId, auth.user.id, null).catch((e) => {
    console.error("room folders failed:", e);
    return [];
  });
  return NextResponse.json({
    folders: sources
      .filter((s) => s.label)
      .map((s) => ({ handle: folderHandle(s.label), label: s.label, owner: s.ownerName ?? null })),
  });
}
