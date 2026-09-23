import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { userLink } from "@/lib/aindrive-user";
import { treeResponse } from "@/lib/aindrive-http";

export const dynamic = "force-dynamic";

/** GET → { link, entries } — every file and folder in the caller's Home folder. */
export async function GET() {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  const link = await userLink(auth.user.id);
  if (!link) return NextResponse.json({ error: "No aindrive folder linked" }, { status: 404 });
  return treeResponse(link);
}
