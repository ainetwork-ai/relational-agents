import { NextRequest, NextResponse } from "next/server";
import { spacesFor, userOfAppKey } from "@/lib/aindrive-app";

export const dynamic = "force-dynamic";

/**
 * Called by aindrive's server for its share sheet (lib/aindrive-app):
 * GET ?driveId&path → { app, spaces } — the person's teamspaces and whether
 * this folder is shared into each.
 */
export async function GET(req: NextRequest) {
  const userId = userOfAppKey(req.headers.get("authorization"));
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const driveId = req.nextUrl.searchParams.get("driveId") ?? "";
  const path = req.nextUrl.searchParams.get("path") ?? "";
  if (!driveId) return NextResponse.json({ error: "driveId required" }, { status: 400 });
  return NextResponse.json({ spaces: await spacesFor(userId, driveId, path) });
}
