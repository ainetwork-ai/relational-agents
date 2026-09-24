import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { userLink } from "@/lib/aindrive-user";
import { runAs } from "@/lib/aindrive-account";
import { treeResponse } from "@/lib/aindrive-http";

export const dynamic = "force-dynamic";

const notConnected = (e: Error) => NextResponse.json({ error: e.message }, { status: 401 });

/** GET → { link, entries } — every file and folder in the caller's Home folder. */
export async function GET() {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  const link = await userLink(auth.user.id);
  if (!link) return NextResponse.json({ error: "No aindrive folder linked" }, { status: 404 });
  return runAs(auth.user.id, () => treeResponse(link)).catch(notConnected);
}
