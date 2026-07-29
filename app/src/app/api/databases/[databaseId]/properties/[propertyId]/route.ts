import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { db } from "@/lib/db";
import { dbProperties } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { loadDatabaseForUser } from "@/lib/db-access";
import {
  isOkfId,
  decodeId,
  writeDbRenameColumn,
  writeDbDeleteColumn,
  okfSetPropMeta,
  okfDatabaseSnapshot,
} from "@/lib/okf-store";

export const dynamic = "force-dynamic";

/** PATCH { name?, type?, config?, position? } → updates a property. */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ databaseId: string; propertyId: string }> }
) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  const { databaseId, propertyId } = await params;

  const body = await req.json().catch(() => ({}));

 // file-backed database: rename goes to the CSV header; declared type /
 // config (select options, number format) / position go to the .dbmeta.json.
  if (isOkfId(databaseId)) {
    try {
      const rel = decodeId(databaseId);
      if (typeof body?.name === "string") await writeDbRenameColumn(rel, propertyId, body.name);
      if (
        (body?.config && typeof body.config === "object") ||
        typeof body?.position === "number" ||
        typeof body?.type === "string"
      ) {
        await okfSetPropMeta(rel, propertyId, {
          ...(typeof body?.type === "string" ? { type: body.type } : {}),
          ...(body?.config && typeof body.config === "object" ? { config: body.config } : {}),
          ...(typeof body?.position === "number" ? { position: body.position } : {}),
        });
      }
      const snap = await okfDatabaseSnapshot(databaseId, rel);
      const property = snap?.properties.find((p) => p.id === propertyId) ?? null;
      return NextResponse.json({ property });
    } catch {
      return NextResponse.json({ error: "write failed" }, { status: 400 });
    }
  }

  if (!(await loadDatabaseForUser(databaseId, auth.user.id)))
    return NextResponse.json({ error: "Not found" }, { status: 404 });

  const update: Record<string, unknown> = {};
  if (typeof body?.name === "string") update.name = body.name;
  if (typeof body?.type === "string") update.type = body.type;
  if (body?.config && typeof body.config === "object") update.config = body.config;
  if (typeof body?.position === "number") update.position = body.position;
  if (Object.keys(update).length === 0) {
    const [p] = await db.select().from(dbProperties).where(eq(dbProperties.id, propertyId)).limit(1);
    return NextResponse.json({ property: p });
  }

  const [property] = await db
    .update(dbProperties)
    .set(update)
    .where(and(eq(dbProperties.id, propertyId), eq(dbProperties.databaseId, databaseId)))
    .returning();

  return NextResponse.json({ property });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ databaseId: string; propertyId: string }> }
) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  const { databaseId, propertyId } = await params;

 // file-backed database: remove the CSV column (+ its meta annotation)
  if (isOkfId(databaseId)) {
    try {
      await writeDbDeleteColumn(decodeId(databaseId), propertyId);
      return NextResponse.json({ ok: true });
    } catch {
      return NextResponse.json({ error: "write failed" }, { status: 400 });
    }
  }

  if (!(await loadDatabaseForUser(databaseId, auth.user.id)))
    return NextResponse.json({ error: "Not found" }, { status: 404 });

  await db
    .delete(dbProperties)
    .where(and(eq(dbProperties.id, propertyId), eq(dbProperties.databaseId, databaseId)));
  return NextResponse.json({ ok: true });
}
