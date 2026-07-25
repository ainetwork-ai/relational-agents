import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { writeDbCell, writeDbAddRow } from "@/lib/okf-store";

export const dynamic = "force-dynamic";

/** PATCH { path, rowId, propId, value } → write one CSV cell (display string). */
export async function PATCH(req: NextRequest) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  const body = await req.json().catch(() => ({}));
  const { path: relPath, rowId, propId, value } = body ?? {};
  if (typeof relPath !== "string" || typeof rowId !== "string" || typeof propId !== "string") {
    return NextResponse.json({ error: "bad input" }, { status: 400 });
  }
  try {
    writeDbCell(relPath, rowId, propId, String(value ?? ""));
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "write failed" }, { status: 400 });
  }
}

/** POST { path } → append an empty row → { rowId }. */
export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  const body = await req.json().catch(() => ({}));
  const relPath = body?.path;
  if (typeof relPath !== "string") return NextResponse.json({ error: "bad input" }, { status: 400 });
  try {
    return NextResponse.json({ rowId: writeDbAddRow(relPath) }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "write failed" }, { status: 400 });
  }
}
