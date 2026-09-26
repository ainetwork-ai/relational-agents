import { NextRequest, NextResponse } from "next/server";
import { resolveEditAccess } from "@/lib/pages/edit-access";
import { signingOf } from "@/lib/willow/record-drive";

export const dynamic = "force-dynamic";

/**
 * GET /api/willow/page?pageId= → { driveId, teamspaceId, userId } | {}
 *
 * Whether this person's edits of the page are signed: a signed-in editor of a
 * page in a teamspace linked to aindrive (docs/willow-ainmem-plan.md Task 6).
 * Share-token editors have no device binding and stay unsigned.
 */
export async function GET(req: NextRequest) {
  const pageId = req.nextUrl.searchParams.get("pageId") ?? "";
  const access = await resolveEditAccess(req, pageId);
  if (!access.ok || !access.userId) return NextResponse.json({});
  const s = await signingOf(pageId);
  if (!s) return NextResponse.json({});
  return NextResponse.json({ driveId: s.driveId, teamspaceId: s.teamspaceId, userId: access.userId });
}
