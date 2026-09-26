import { after, NextResponse } from "next/server";
import { demoLoginEnabled, resetTryRoom, topUpTryRoom } from "@/lib/world-demo";

export const dynamic = "force-dynamic";

/** POST /world/reset — the try-it room's "Start over", then back to the page; a low wallet is refilled after the response. */
export async function POST() {
  if (!demoLoginEnabled()) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { status, room } = await resetTryRoom();
  if (room)
    after(() =>
      topUpTryRoom(room)
        .then((tx) => {
          if (tx) console.log(`world demo: try-it treasury topped up — tx ${tx}`);
        })
        .catch((err: unknown) => console.error("world demo: try-it top-up failed:", err))
    );
  return new NextResponse(null, { status: 303, headers: { Location: `/world?reset=${status}#try` } });
}
