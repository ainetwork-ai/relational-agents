import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { shareCategories } from "@/lib/family-folders";

export const dynamic = "force-dynamic";

/** GET → the signed-in person's phone folders, sorted into categories to share. */
export async function GET() {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  return NextResponse.json(await shareCategories(auth.user.id));
}
