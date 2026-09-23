import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { teamspaceDrive } from "@/lib/aindrive-teamspace";
import { deleteResponse, readResponse, writeResponse } from "@/lib/aindrive-http";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

async function linkOf(ctx: Ctx) {
  const auth = await requireAuth();
  if ("error" in auth) return { res: auth.error };
  const found = await teamspaceDrive(auth.user.id, (await ctx.params).id);
  if (!found) return { res: NextResponse.json({ error: "Not found" }, { status: 404 }) };
  if (!found.link)
    return { res: NextResponse.json({ error: "This folder is no longer offered on this server" }, { status: 409 }) };
  return { link: found.link };
}

/** GET ?path= → { path, content } — one file in a teamspace drive. */
export async function GET(req: NextRequest, ctx: Ctx) {
  const r = await linkOf(ctx);
  return "res" in r ? r.res : readResponse(r.link, req);
}

/** PUT { path, content } → create or overwrite. */
export async function PUT(req: NextRequest, ctx: Ctx) {
  const r = await linkOf(ctx);
  return "res" in r ? r.res : writeResponse(r.link, req);
}

/** DELETE ?path= → delete a file or folder. */
export async function DELETE(req: NextRequest, ctx: Ctx) {
  const r = await linkOf(ctx);
  return "res" in r ? r.res : deleteResponse(r.link, req);
}
