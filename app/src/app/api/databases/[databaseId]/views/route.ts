import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { publish } from "@/lib/realtime";
import { db } from "@/lib/db";
import { dbViews } from "@/lib/db/schema";
import type { DbView } from "@/lib/db/schema";
import { eq, max } from "drizzle-orm";
import { loadDatabaseForUser } from "@/lib/db-access";
import { isOkfId, decodeId, okfAddView } from "@/lib/okf-store";

export const dynamic = "force-dynamic";

/** POST { name, type } → add a view (table | board | list | gallery | calendar). */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ databaseId: string }> }
) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  const { databaseId } = await params;

  const body = await req.json().catch(() => ({}));
  const type = (body?.type ?? "table") as DbView["type"];
  const name = body?.name || defaultName(type);

  // file-backed database: views live in the .dbmeta.json sidecar
  if (isOkfId(databaseId)) {
    try {
      const view = await okfAddView(decodeId(databaseId), { name, type, config: body?.config });
      publish({ type: "blocks", pageId: databaseId, clientId: req.headers.get("x-client-id"), at: Date.now() });
      return NextResponse.json({ view: { ...view, databaseId } }, { status: 201 });
    } catch {
      return NextResponse.json({ error: "write failed" }, { status: 400 });
    }
  }

  if (!(await loadDatabaseForUser(databaseId, auth.user.id)))
    return NextResponse.json({ error: "Not found" }, { status: 404 });

  const [{ maxPos }] = await db
    .select({ maxPos: max(dbViews.position) })
    .from(dbViews)
    .where(eq(dbViews.databaseId, databaseId));

  const [view] = await db
    .insert(dbViews)
    .values({ databaseId, name, type, config: body?.config ?? {}, position: (maxPos ?? 0) + 1 })
    .returning();

  publish({
    type: "blocks",
    pageId: databaseId,
    clientId: req.headers.get("x-client-id"),
    at: Date.now(),
  });
  return NextResponse.json({ view }, { status: 201 });
}

function defaultName(type: string): string {
  return type.charAt(0).toUpperCase() + type.slice(1);
}
