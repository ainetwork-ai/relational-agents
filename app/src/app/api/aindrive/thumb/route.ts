import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { aindriveHttp, cleanPath, hasServiceToken, linkAllowed } from "@/lib/aindrive";
import { getAccount, runAs, runAsOrService } from "@/lib/aindrive-account";
import { sharedLinkFor } from "@/lib/aindrive-teamspace";

export const dynamic = "force-dynamic";

/**
 * GET ?drive=<id>&path=<file> → a small thumbnail (256px webp), proxied from
 * aindrive's /api/drives/:driveId/fs/thumbnail endpoint. Mobile agents generate
 * thumbnails on-device using the system's gallery cache (~20 KB vs 10-40 MB
 * originals); desktop agents resize locally before sending.
 *
 * Same access rules as /api/aindrive/raw: viewer's own account, a shared link,
 * or the deployment's service token inside offered folders.
 */
export async function GET(req: NextRequest) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  const driveId = req.nextUrl.searchParams.get("drive") ?? "";
  let path: string;
  try {
    path = cleanPath(req.nextUrl.searchParams.get("path") ?? "");
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
  if (!driveId || !path) return NextResponse.json({ error: "drive and path required" }, { status: 400 });
  const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
  const own = !!(await getAccount(auth.user.id));
  const shared = await sharedLinkFor(auth.user.id, driveId, path);
  if (!own && !shared && !(hasServiceToken() && linkAllowed({ driveId, root: dir })))
    return NextResponse.json({ error: "Connect your aindrive to view this file", needsAccount: true }, { status: 401 });

  try {
    const fetchThumb = () =>
      aindriveHttp(`/api/drives/${encodeURIComponent(driveId)}/fs/thumbnail?path=${encodeURIComponent(path)}`, {}, 60_000);
    const res = shared
      ? await runAsOrService(shared.linkedBy, fetchThumb)
      : own
        ? await runAs(auth.user.id, fetchThumb)
        : await fetchThumb();
    if (!res.ok) {
      return NextResponse.json({ error: "thumbnail failed" }, { status: res.status });
    }
    const bytes = await res.arrayBuffer();
    return new NextResponse(bytes, {
      headers: {
        "content-type": res.headers.get("content-type") ?? "image/webp",
        "content-length": String(bytes.byteLength),
        "cache-control": "private, max-age=31536000, immutable",
      },
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
