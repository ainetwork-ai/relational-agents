import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { readNode, decodeId } from "@/lib/okf-store";
import { okfGateFor } from "@/lib/okf-acl";

export const dynamic = "force-dynamic";

/** GET ?path=<relpath> | ?id=<base64url> → the parsed OKF node.
 * Participant-only paths 404 for non-members (existence stays hidden). */
export async function GET(req: NextRequest) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  const params = new URL(req.url).searchParams;
  const idParam = params.get("id");
  const relPath = idParam ? decodeId(idParam) : params.get("path") || "";
  const gate = await okfGateFor(auth.user.id);
  if (!gate.canRead(relPath)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    const node = readNode(relPath);
    if (!node) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ node });
  } catch {
    return NextResponse.json({ error: "Bad path" }, { status: 400 });
  }
}
