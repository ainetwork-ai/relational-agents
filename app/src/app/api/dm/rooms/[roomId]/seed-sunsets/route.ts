import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { publishToRoomMembers, requireRoomAccess } from "@/lib/chat-room-access";
import { seedSunsetStory } from "@/lib/demo/seed-sunsets";

export const dynamic = "force-dynamic";

/**
 * Demo fixture (HTTP entry point) — the seeding itself lives in
 * `@/lib/demo/seed-sunsets` so `pnpm demo:seed <roomId>` runs exactly what
 * this route runs. See that module for what gets written.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ roomId: string }> }) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  const { roomId } = await ctx.params;
  const access = await requireRoomAccess(roomId, auth.user.id);
  if ("error" in access) return access.error;

  const result = await seedSunsetStory(roomId, access.room.name, auth.user.id);
  if (!result.seeded && result.reason === "No other human member to seed as")
    return NextResponse.json({ error: result.reason }, { status: 400 });

  if (result.seeded)
    await publishToRoomMembers(roomId, { type: "dm-message", clientId: req.headers.get("x-client-id") });
  return NextResponse.json(result);
}
