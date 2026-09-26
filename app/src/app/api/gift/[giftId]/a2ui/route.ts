import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { canSeeGift, findGift } from "@/lib/gift";
import { announceGift } from "@/lib/gift-announce";
import { A2UI_MIME, actionToGift, parseA2uiAction } from "@/lib/x402/a2ui";
import { payGift } from "@/lib/x402/pay";
import { giftSurfaceFor as surfaceFor } from "@/lib/x402/surface";
import { getT } from "@/i18n/server";

export const dynamic = "force-dynamic";

/**
 * The gift as an A2UI v0.9 surface, for any renderer (aindrive's MCP Apps
 * view, CopilotKit, @a2ui/*):
 *   GET  → the surface (application/a2ui+json), locked or open for this viewer
 *   POST → { action } — the renderer's click (`ainmem.gift.pay`); the payment
 *          runs and the NEXT surface comes back, open or with the error on it
 */
const a2ui = (messages: unknown, status = 200) =>
  new NextResponse(JSON.stringify(messages), { status, headers: { "content-type": A2UI_MIME } });

export async function GET(_req: NextRequest, ctx: { params: Promise<{ giftId: string }> }) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  const { giftId } = await ctx.params;
  const surface = await surfaceFor(giftId, auth.user.id, await getT());
  return surface ? a2ui(surface) : NextResponse.json({ error: "gift not found" }, { status: 404 });
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ giftId: string }> }) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  const { giftId } = await ctx.params;
  const action = parseA2uiAction(await req.json().catch(() => null));
  const want = action ? actionToGift(action) : { error: "action required" };
  if ("error" in want) return NextResponse.json({ error: want.error }, { status: 400 });
  if (want.giftId !== giftId) return NextResponse.json({ error: "action is for another gift" }, { status: 400 });
  const found = await findGift(giftId);
  if (!found || !(await canSeeGift(auth.user.id, found.workspaceId))) return NextResponse.json({ error: "gift not found" }, { status: 404 });
  if (found.gift.spec.recipientUserId === auth.user.id) return a2ui(await surfaceFor(giftId, auth.user.id, await getT(), "You can watch your own video without pocket money"));
  const r = await payGift(auth.user.id, giftId, req.nextUrl.origin);
  if (r.ok && !r.already) await announceGift(found.workspaceId, auth.user.id, r.spec, r.receipt).catch(() => {});
  return a2ui(await surfaceFor(giftId, auth.user.id, await getT(), r.ok ? undefined : r.error));
}
