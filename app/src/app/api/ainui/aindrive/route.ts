import { NextRequest, NextResponse } from "next/server";
import type { A2uiAction } from "ain-ui";
import { requireAuth } from "@/lib/auth/middleware";
import { callAindriveSurface, type AindriveLink } from "@/lib/aindrive";
import { runAs, runAsOrService } from "@/lib/aindrive-account";
import { teamspaceDrive } from "@/lib/aindrive-teamspace";
import { userLink } from "@/lib/aindrive-user";
import { mayOpen } from "@/lib/aindrive-file-sale";
import { backupFolder } from "@/lib/aindrive-backup";
import { confineAction, confineSurface } from "@/lib/ainui-boundary";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  // Bound base64 uploads before parsing JSON, including chunked requests.
  const reader = req.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (reader) {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 12 * 1024 * 1024) {
          await reader.cancel();
          return NextResponse.json({ error: "Upload too large" }, { status: 413 });
        }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  let body: { source?: string; action?: A2uiAction; mode?: string };
  try { body = JSON.parse(raw); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  let link: AindriveLink | null = null;
  let by: string | null = auth.user.id;
  let shared = false;
  let protectedPath: string | undefined;
  const source = typeof body?.source === "string" ? body.source : "";
  const linked = /^\/api\/aindrive\/links\/([0-9a-f-]{36})$/i.exec(source);
  const own = /^\/api\/aindrive\/drives\/([A-Za-z0-9_-]{4,64})$/.exec(source);
  if (linked) {
    const found = await teamspaceDrive(auth.user.id, linked[1]);
    if (!found?.link) return NextResponse.json({ error: "Folder not found" }, { status: 404 });
    if (!(await mayOpen(auth.user.id, found.drive))) return NextResponse.json({ error: "Purchase required" }, { status: 402 });
    link = found.link; by = found.drive.createdBy; shared = true;
    if (found.drive.backup) {
      const folder = backupFolder({ id: found.drive.teamspaceId, name: found.teamspaceName });
      protectedPath = link.root ? `${link.root}/${folder}` : folder;
    }
  } else if (own) link = { driveId: own[1], root: "" };
  else if (source === "/api/aindrive") link = await userLink(auth.user.id);
  if (!link) return NextResponse.json({ error: "Folder not found" }, { status: 404 });
  let action: A2uiAction;
  try {
    action = confineAction(body.action ?? { name: "aindrive.open", context: { drive_id: link.driveId, path: link.root, is_dir: true } }, link, protectedPath);
  } catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 403 }); }
  try {
    if (body.mode === "pick" && !["aindrive.open", "aindrive.search", "aindrive.view"].includes(action.name))
      return NextResponse.json({ error: "File selection is read-only" }, { status: 403 });
    const call = () => callAindriveSurface(action);
    const messages = shared ? await runAsOrService(by, call) : await runAs(auth.user.id, call);
    return NextResponse.json({ messages: confineSurface(messages, link.root, body.mode === "pick"), link });
  } catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 502 }); }
}
