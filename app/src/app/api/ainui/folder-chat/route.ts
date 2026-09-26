import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { requestAindriveFolderChat, type AindriveLink } from "@/lib/aindrive";
import { runAs } from "@/lib/aindrive-account";
import { teamspaceDrive } from "@/lib/aindrive-teamspace";
import { userLink } from "@/lib/aindrive-user";
import { mayOpen } from "@/lib/aindrive-file-sale";
import { confineAction } from "@/lib/ainui-boundary";
export const dynamic = "force-dynamic";

async function relay(req: NextRequest, send: boolean) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  const body = send ? await req.json().catch(() => null) : Object.fromEntries(req.nextUrl.searchParams);
  if (!body || typeof body.source !== "string") return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const linked = /^\/api\/aindrive\/links\/([0-9a-f-]{36})$/i.exec(body.source);
  const own = /^\/api\/aindrive\/drives\/([A-Za-z0-9_-]{4,64})$/.exec(body.source);
  let link: AindriveLink | null = null;
  if (linked) {
    const found = await teamspaceDrive(auth.user.id, linked[1]);
    if (!found?.link || !(await mayOpen(auth.user.id, found.drive))) return NextResponse.json({ error: "Folder not accessible" }, { status: 403 });
    // Reading a shared folder does not authorize sending its owner's files to a remote agent.
    if (found.drive.createdBy !== auth.user.id) return NextResponse.json({ error: "Remote folder chat requires the folder owner's connected account" }, { status: 403 });
    link = found.link;
  } else if (own) link = { driveId: own[1], root: "" };
  else if (body.source === "/api/aindrive") link = await userLink(auth.user.id);
  if (!link) return NextResponse.json({ error: "Folder not found" }, { status: 404 });
  try {
    const confined = confineAction({ name: "aindrive.open", context: { drive_id: link.driveId, path: typeof body.path === "string" ? body.path : link.root, is_dir: true } }, link);
    if (send && (typeof body.q !== "string" || !body.q.trim() || body.q.length > 2000)) return NextResponse.json({ error: "Invalid question" }, { status: 400 });
    const upstream = await runAs(auth.user.id, () => requestAindriveFolderChat(link!, send ? { q: body.q, path: confined.context?.path, agentId: body.agentId, contextId: body.contextId } : undefined, req.signal));
    return new Response(upstream.body, { status: upstream.status, headers: { "content-type": upstream.headers.get("content-type") || "application/json", "cache-control": "no-store, no-transform", "x-accel-buffering": "no" } });
  } catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 403 }); }
}
export const GET = (req: NextRequest) => relay(req, false);
export const POST = (req: NextRequest) => relay(req, true);
