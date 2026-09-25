import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { aindriveConfigured, aindrivePublicBase, aindriveServer, cleanPath, listFiles } from "@/lib/aindrive";
import { runAs, runAsOrService } from "@/lib/aindrive-account";
import { teamspaceDrive } from "@/lib/aindrive-teamspace";

export const dynamic = "force-dynamic";

/**
 * GET ?drive=<id>&path=<folder> → { base, entries } — one folder of the
 * caller's own drive (their connected aindrive account), for "aindrive에서 가져오기".
 * GET ?link=<teamspace link id>&path=<folder> — one folder of a folder a
 * teammate shared into a teamspace the caller can see, read as that teammate;
 * nothing above the shared folder opens.
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
  const linkId = req.nextUrl.searchParams.get("link") ?? "";
  let read: () => ReturnType<typeof listFiles>;
  if (linkId) {
    const found = await teamspaceDrive(auth.user.id, linkId);
    if (!found?.link) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const { driveId: shared, root } = found.link;
    if (root && path !== root && !path.startsWith(`${root}/`))
      return NextResponse.json({ error: "Outside the shared folder" }, { status: 403 });
    read = () => runAsOrService(found.drive.createdBy, () => listFiles({ driveId: shared, root: "" }, path));
  } else {
    if (!driveId) return NextResponse.json({ error: "drive required" }, { status: 400 });
    read = () => runAs(auth.user.id, () => listFiles({ driveId, root: "" }, path));
  }
  try {
    const entries = (await read())
      .map(({ name, isDir, size }) => ({ name, isDir, size }))
      .sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1));
    return NextResponse.json({ base: aindrivePublicBase() ?? aindriveServer(), entries });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
