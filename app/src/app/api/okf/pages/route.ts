import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { listPages } from "@/lib/okf-store";
import { okfGateFor } from "@/lib/okf-acl";

export const dynamic = "force-dynamic";

/** GET → flat page list (encoded ids + parent links) from the OKF folder.
 *  The sidebar-store shape; the migration points the main sidebar here.
 *  참여자 전용 경로(관계 문서 등)는 멤버가 아니면 목록에서 제외된다. */
export async function GET() {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  const gate = await okfGateFor(auth.user.id);
  return NextResponse.json({ pages: listPages().filter((p) => gate.canReadId(p.id)) });
}
