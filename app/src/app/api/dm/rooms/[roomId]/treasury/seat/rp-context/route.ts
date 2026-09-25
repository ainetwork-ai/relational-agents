import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { requireRoomAccess } from "@/lib/chat-room-access";
import { TREASURY_SEAT_ACTION } from "@/lib/agent/treasury/types";
import { signRpContext } from "@/lib/worldid-v4";

export const dynamic = "force-dynamic";

/**
 * POST → a freshly signed IDKit v4 rp_context for claiming a seat in this room.
 *
 * IDKit v4 refuses to run without one, and it is single-use (own nonce, 5-min
 * expiry, TREASURY_SEAT_ACTION hashed into the signature), so the seat button
 * asks for a new one on every click. The signing key never leaves the server.
 * Only members get one: signing is cheap, but a signature is our name on a
 * request. 501 when World ID 4.0 is not configured — the panel then shows the
 * 3.0 widget or the dev simulator instead, and never calls this.
 */
export async function POST(_req: NextRequest, ctx: { params: Promise<{ roomId: string }> }) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  const { roomId } = await ctx.params;
  const access = await requireRoomAccess(roomId, auth.user.id);
  if ("error" in access) return access.error;

  const rpContext = await signRpContext(TREASURY_SEAT_ACTION);
  if (!rpContext)
    return NextResponse.json(
      { reason: "not-configured", message: "World ID 4.0 is not configured on this server" },
      { status: 501 }
    );
  return NextResponse.json(rpContext, { headers: { "cache-control": "no-store" } });
}
