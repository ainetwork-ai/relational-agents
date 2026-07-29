import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { nodeExists, readNode, writePage } from "@/lib/okf-store";
import { okfGateFor } from "@/lib/okf-acl";
import type { ParsedBlock, Frontmatter } from "@/lib/memory-parse";

export const dynamic = "force-dynamic";

/** PUT { path, title, meta?, blocks } → serialize back to the .md file. */
export async function PUT(req: NextRequest) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  const body = await req.json().catch(() => ({}));
  const { path: relPath, title, meta, blocks } = body ?? {};
  if (typeof relPath !== "string" || typeof title !== "string" || !Array.isArray(blocks)) {
    return NextResponse.json({ error: "bad input" }, { status: 400 });
  }
 // participant-only paths are member-writable only (same gate as reads)
  const gate = await okfGateFor(auth.user.id);
  if (!gate.canRead(relPath)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
   // Merge over what the file already carries. Replacing wholesale meant a
   // caller that just wanted to save blocks (meta omitted) silently dropped
   // the contract fields — type/relationId/roomId — and the reading side
   // rejects a document with no `type` at all.
    const existing = nodeExists(relPath) ? readNode(relPath) : null;
    const prev = (existing && existing.kind === "page" ? existing.meta : {}) as Frontmatter;
    writePage(relPath, title, { ...prev, ...((meta ?? {}) as Frontmatter) }, blocks as ParsedBlock[]);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "write failed" }, { status: 400 });
  }
}
