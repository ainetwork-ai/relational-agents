import { NextRequest, NextResponse } from "next/server";
import { getT } from "@/i18n/server";
import { requireAuth } from "@/lib/auth/middleware";
import { canSeeGift, findGift } from "@/lib/gift";
import { announceGift } from "@/lib/gift-announce";
import { payGift } from "@/lib/x402/pay";
import { agUiStream } from "@/lib/x402/agui";

export const dynamic = "force-dynamic";

/**
 * POST → the signed-in person pays for the gift with their wallet (the
 * "Open with pocket money" button). The x402 round trip runs server-side.
 *
 *   Accept: text/event-stream → AG-UI events as the run goes (RUN_STARTED,
 *                               STEP_* quote/sign/settle/unlock, STATE_SNAPSHOT,
 *                               RUN_FINISHED with the receipt / RUN_ERROR)
 *   otherwise                 → one JSON reply when it is over
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ giftId: string }> }) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  const { giftId } = await ctx.params;
  const found = await findGift(giftId);
  if (!found || !(await canSeeGift(auth.user.id, found.workspaceId)))
    return NextResponse.json({ error: "gift not found" }, { status: 404 });
  if (found.gift.spec.recipientUserId === auth.user.id)
    return NextResponse.json({ error: (await getT())("You can watch your own video without pocket money") }, { status: 400 });

  const run = (emit?: Parameters<typeof payGift>[3]) => payGift(auth.user.id, giftId, req.nextUrl.origin, emit);
  const after = async (r: Awaited<ReturnType<typeof payGift>>) => {
    if (r.ok && !r.already) await announceGift(found.workspaceId, auth.user.id, r.spec, r.receipt).catch(() => {});
  };

  if (req.headers.get("accept")?.includes("text/event-stream")) {
    return agUiStream(async (emit) => {
      const r = await run(emit);
      await after(r);
      // the unlock rides on the final state so the block can render it without a refetch
      if (r.ok) emit({ type: "STATE_SNAPSHOT", snapshot: { giftId, step: "done", receipt: r.receipt, settlement: r.settlement, unlock: r.unlock } });
    });
  }
  const r = await run();
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  await after(r);
  return NextResponse.json({ ok: true, receipt: r.receipt, unlock: r.unlock, settlement: r.settlement });
}
