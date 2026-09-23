import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { aindriveConfigured, aindrivePublicBase, cleanPath, linkAllowed, listFiles } from "@/lib/aindrive";

export const dynamic = "force-dynamic";

/**
 * GET ?drive=<id>&path=<folder> → { base, entries } — one folder of an offered
 * drive, for "aindrive에서 가져오기". Same scope as /api/aindrive/raw.
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
  if (!driveId || !linkAllowed({ driveId, root: path }))
    return NextResponse.json({ error: "This folder is outside the aindrive folders offered here" }, { status: 403 });
  try {
    const entries = (await listFiles({ driveId, root: "" }, path))
      .map(({ name, isDir, size }) => ({ name, isDir, size }))
      .sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1));
    return NextResponse.json({ base: aindrivePublicBase(), entries });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
