import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { treasurySummary } from "@/lib/agent/treasury/summary";

export const dynamic = "force-dynamic";

/** GET → { rooms } — money state of every relation the viewer is a human member of (read-only; the sidebar polls it). */
export async function GET() {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  return NextResponse.json({ rooms: await treasurySummary(auth.user.id) });
}
