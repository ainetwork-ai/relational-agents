import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { runAs } from "@/lib/aindrive-account";
import { deleteResponse, readResponse, writeResponse } from "@/lib/aindrive-http";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ driveId: string }> };

/** One file of a drive in the caller's own aindrive account, as them.
 *  GET ?path= · PUT { path, content } · DELETE ?path= */
async function handle(
  req: NextRequest,
  ctx: Ctx,
  fn: (link: { driveId: string; root: string }, req: NextRequest) => Promise<Response>
) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  const { driveId } = await ctx.params;
  if (!/^[A-Za-z0-9_-]{4,64}$/.test(driveId)) return NextResponse.json({ error: "bad drive id" }, { status: 400 });
  return runAs(auth.user.id, () => fn({ driveId, root: "" }, req)).catch(
    (e: Error) => NextResponse.json({ error: e.message }, { status: 401 })
  );
}

export const GET = (req: NextRequest, ctx: Ctx) => handle(req, ctx, readResponse);
export const PUT = (req: NextRequest, ctx: Ctx) => handle(req, ctx, writeResponse);
export const DELETE = (req: NextRequest, ctx: Ctx) => handle(req, ctx, deleteResponse);
