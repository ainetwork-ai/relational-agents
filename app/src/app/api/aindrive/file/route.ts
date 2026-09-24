import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { userLink } from "@/lib/aindrive-user";
import { runAs } from "@/lib/aindrive-account";
import { deleteResponse, readResponse, writeResponse } from "@/lib/aindrive-http";

export const dynamic = "force-dynamic";

const notConnected = (e: Error) => NextResponse.json({ error: e.message }, { status: 401 });

/**
 * One file in the caller's Home folder (path relative to that folder).
 * GET ?path=  → { path, content }
 * PUT { path, content } → create or overwrite
 * DELETE ?path= → delete a file or folder
 */
export async function GET(req: NextRequest) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  const link = await userLink(auth.user.id);
  if (!link) return NextResponse.json({ error: "No aindrive folder linked" }, { status: 404 });
  return runAs(auth.user.id, () => readResponse(link, req)).catch(notConnected);
}

export async function PUT(req: NextRequest) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  const link = await userLink(auth.user.id);
  if (!link) return NextResponse.json({ error: "No aindrive folder linked" }, { status: 404 });
  return runAs(auth.user.id, () => writeResponse(link, req)).catch(notConnected);
}

export async function DELETE(req: NextRequest) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  const link = await userLink(auth.user.id);
  if (!link) return NextResponse.json({ error: "No aindrive folder linked" }, { status: 404 });
  return runAs(auth.user.id, () => deleteResponse(link, req)).catch(notConnected);
}
