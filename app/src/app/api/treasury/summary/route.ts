import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { treasurySummary } from "@/lib/agent/treasury/summary";

export const dynamic = "force-dynamic";

/**
 * GET → { rooms } — money state of every relation the viewer is a human member of
 * (read-only; the sidebar polls it chain-free). ?balances=1 — the overview page —
 * adds each pot, read through the shared balance cache.
 */
export async function GET(req: NextRequest) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  const balances = req.nextUrl.searchParams.get("balances") === "1";
  return NextResponse.json({ rooms: await treasurySummary(auth.user.id, Date.now(), { balances }) });
}
