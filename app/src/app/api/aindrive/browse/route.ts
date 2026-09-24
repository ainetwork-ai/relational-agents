import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { aindriveConfigured, aindrivePublicBase, aindriveServer, cleanPath, listFiles } from "@/lib/aindrive";
import { runAs } from "@/lib/aindrive-account";

export const dynamic = "force-dynamic";

/**
 * GET ?drive=<id>&path=<folder> → { base, entries } — one folder of the
 * caller's own drive (their connected aindrive account), for "aindrive에서 가져오기".
 */
export async function GET(req: NextRequest) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  if (!aindriveConfigured())
    return NextResponse.json({ error: "aindrive is not configured on this server" }, { status: 503 });
  const driveId = req.nextUrl.searchParams.get("drive") ?? "";
  let path: string;
  try {
    path = cleanPath(req.nextUrl.searchParams.get("path") ?? "");
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
  if (!driveId) return NextResponse.json({ error: "drive required" }, { status: 400 });
  try {
    const entries = (await runAs(auth.user.id, () => listFiles({ driveId, root: "" }, path)))
      .map(({ name, isDir, size }) => ({ name, isDir, size }))
      .sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1));
    return NextResponse.json({ base: aindrivePublicBase() ?? aindriveServer(), entries });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
