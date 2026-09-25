import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { foldersSharedWith } from "@/lib/aindrive-share";

export const dynamic = "force-dynamic";

/** GET ?workspaceId= → { folders } — aindrive folders teammates shared into
 *  teamspaces the caller can see (in that workspace, when given). */
export async function GET(req: NextRequest) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  const ws = req.nextUrl.searchParams.get("workspaceId");
  const folders = await foldersSharedWith(auth.user.id, ws && /^[0-9a-f-]{36}$/i.test(ws) ? ws : null);
  return NextResponse.json({ folders });
}
