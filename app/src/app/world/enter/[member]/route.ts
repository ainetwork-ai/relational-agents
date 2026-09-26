import { NextRequest, NextResponse } from "next/server";
import { demoLoginEnabled, demoRoom, isMemberKey, unbindTryMember } from "@/lib/world-demo";

export const dynamic = "force-dynamic";

/**
 * GET /world/enter/<member>[?to=treasury] — into the try-it room as one of its
 * members: the account's World ID binding is dropped (visitors share these
 * accounts), then demo login signs in and lands in the room, or on its
 * treasury page. Locations are relative for the reason demo-login gives: inside
 * the container req.nextUrl.origin is the bind address, not the public host.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ member: string }> }) {
  if (!demoLoginEnabled()) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { member } = await ctx.params;
  if (!isMemberKey(member)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const room = await demoRoom("try");
  if (!room) return new NextResponse(null, { status: 303, headers: { Location: "/world?try=missing#try" } });
  await unbindTryMember(room, member);
  const to = req.nextUrl.searchParams.get("to") === "treasury" ? `/treasury/${room.roomId}` : `/dm/${room.roomId}`;
  const login = `/api/auth/demo-login?as=try-${member}&returnTo=${encodeURIComponent(to)}`;
  return new NextResponse(null, { status: 303, headers: { Location: login } });
}
