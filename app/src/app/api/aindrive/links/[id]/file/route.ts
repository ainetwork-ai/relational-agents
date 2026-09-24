import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { teamspaceDrive } from "@/lib/aindrive-teamspace";
import { runAsOrService } from "@/lib/aindrive-account";
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
  return { link: found.link, by: found.drive.createdBy };
}

/** GET ?path= → { path, content } — one file in a teamspace drive. */
export async function GET(req: NextRequest, ctx: Ctx) {
  const r = await linkOf(ctx);
  if ("res" in r) return r.res;
  return runAsOrService(r.by, () => readResponse(r.link, req)).catch(
    (e: Error) => NextResponse.json({ error: e.message }, { status: 401 })
  );
}

/** PUT { path, content } → create or overwrite. */
export async function PUT(req: NextRequest, ctx: Ctx) {
  const r = await linkOf(ctx);
  if ("res" in r) return r.res;
  return runAsOrService(r.by, () => writeResponse(r.link, req)).catch(
    (e: Error) => NextResponse.json({ error: e.message }, { status: 401 })
  );
}

/** DELETE ?path= → delete a file or folder. */
export async function DELETE(req: NextRequest, ctx: Ctx) {
  const r = await linkOf(ctx);
  if ("res" in r) return r.res;
  return runAsOrService(r.by, () => deleteResponse(r.link, req)).catch(
    (e: Error) => NextResponse.json({ error: e.message }, { status: 401 })
  );
}
