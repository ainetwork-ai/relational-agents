import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { aindriveConfigured, offeredDrives } from "@/lib/aindrive";
import { getAccount, runAs } from "@/lib/aindrive-account";
import { ShareError, shareFolder, shareableTeamspaces, sharedBy } from "@/lib/aindrive-share";

export const dynamic = "force-dynamic";

/**
 * Sharing your aindrive folders with a teamspace — the step right after
 * "aindrive로 로그인", and whenever someone wants to share another.
 *
 * GET  → { connected, drives: [{ id, name, online, sharedIn: [{ teamspaceId, teamspaceName }] }],
 *          teamspaces: [{ id, name, icon, workspaceId, workspaceName, members }] }
 *        drives = the caller's own, listed over aindrive MCP as them
 * POST { teamspaceId, driveIds: string[] } → { shared: [...], failed: [{ driveId, error }] }
 */
export async function GET() {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  if (!aindriveConfigured() || !(await getAccount(auth.user.id)))
    return NextResponse.json({ connected: false, drives: [], teamspaces: [] });
  const [drives, shared, teamspaces] = await Promise.all([
    runAs(auth.user.id, () => offeredDrives()).catch(() => []),
    sharedBy(auth.user.id),
    shareableTeamspaces(auth.user.id),
  ]);
  return NextResponse.json({
    connected: true,
    // a drive offered only from a sub-folder shares that sub-folder
    drives: drives.map((d) => ({ id: d.id, name: d.name, root: d.root, online: d.online, sharedIn: shared.get(d.id) ?? [] })),
    teamspaces,
  });
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  if (!aindriveConfigured())
    return NextResponse.json({ error: "aindrive is not configured on this server" }, { status: 503 });
  const body = (await req.json().catch(() => ({}))) as { teamspaceId?: unknown; driveIds?: unknown };
  const teamspaceId = typeof body.teamspaceId === "string" ? body.teamspaceId : "";
  const driveIds = Array.isArray(body.driveIds)
    ? [...new Set(body.driveIds.filter((d): d is string => typeof d === "string"))].slice(0, 50)
    : [];
  if (!/^[0-9a-f-]{36}$/i.test(teamspaceId) || !driveIds.length)
    return NextResponse.json({ error: "teamspaceId and driveIds required" }, { status: 400 });
  // names and sub-folders as aindrive lists them, not as the browser says
  const offered = await runAs(auth.user.id, () => offeredDrives()).catch(() => []);
  const shared: { driveId: string; id: string }[] = [];
  const failed: { driveId: string; error: string }[] = [];
  for (const driveId of driveIds) {
    const d = offered.find((x) => x.id === driveId);
    try {
      const drive = await shareFolder(auth.user.id, teamspaceId, { driveId, root: d?.root ?? "", name: d?.name });
      shared.push({ driveId, id: drive.id });
    } catch (e) {
      if (!(e instanceof ShareError)) throw e;
      // already shared there is what was asked for
      if (e.status === 409) continue;
      failed.push({ driveId, error: e.message });
    }
  }
  return NextResponse.json({ shared, failed }, { status: failed.length && !shared.length ? 400 : 200 });
}
