import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { publish } from "@/lib/realtime";
import { db } from "@/lib/db";
import { dbViews } from "@/lib/db/schema";
import type { ViewConfig } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { loadDatabaseForUser } from "@/lib/db-access";
import { isOkfId, decodeId, okfPatchView, okfDeleteView } from "@/lib/okf-store";

export const dynamic = "force-dynamic";

/** PATCH { config } → replaces the view config (groupBy / filters / sorts). */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ databaseId: string; viewId: string }> }
) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  const { databaseId, viewId } = await params;

  const body = await req.json().catch(() => ({}));
  const patch: { config?: ViewConfig; name?: string } = {};
  if (body?.config && typeof body.config === "object") patch.config = body.config as ViewConfig;
  if (typeof body?.name === "string" && body.name.trim()) patch.name = body.name.trim();

  // file-backed database: view config/name persist in the schema overlay
  // (the default "okf-table" view materializes on first patch)
  if (isOkfId(databaseId)) {
    try {
      const view = await okfPatchView(decodeId(databaseId), viewId, patch);
      if (!view) return NextResponse.json({ error: "Not found" }, { status: 404 });
      publish({ type: "blocks", pageId: databaseId, clientId: req.headers.get("x-client-id"), at: Date.now() });
      return NextResponse.json({ view: { ...view, databaseId } });
    } catch {
      return NextResponse.json({ error: "write failed" }, { status: 400 });
    }
  }

  if (!(await loadDatabaseForUser(databaseId, auth.user.id)))
    return NextResponse.json({ error: "Not found" }, { status: 404 });

  const [view] = await db
    .update(dbViews)
    .set(patch)
    .where(and(eq(dbViews.id, viewId), eq(dbViews.databaseId, databaseId)))
    .returning();

  publish({
    type: "blocks",
    pageId: databaseId,
    clientId: req.headers.get("x-client-id"),
    at: Date.now(),
  });
  return NextResponse.json({ view });
}

/** DELETE → remove a view (Notion: view tab menu → Delete view). */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ databaseId: string; viewId: string }> }
) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  const { databaseId, viewId } = await params;

  if (isOkfId(databaseId)) {
    try {
      await okfDeleteView(decodeId(databaseId), viewId);
      publish({ type: "blocks", pageId: databaseId, clientId: req.headers.get("x-client-id"), at: Date.now() });
      return NextResponse.json({ ok: true });
    } catch {
      return NextResponse.json({ error: "write failed" }, { status: 400 });
    }
  }

  if (!(await loadDatabaseForUser(databaseId, auth.user.id)))
    return NextResponse.json({ error: "Not found" }, { status: 404 });

  await db
    .delete(dbViews)
    .where(and(eq(dbViews.id, viewId), eq(dbViews.databaseId, databaseId)));
  publish({
    type: "blocks",
    pageId: databaseId,
    clientId: req.headers.get("x-client-id"),
    at: Date.now(),
  });
  return NextResponse.json({ ok: true });
}
