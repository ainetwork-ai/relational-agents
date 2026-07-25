import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { db } from "@/lib/db";
import { dbProperties } from "@/lib/db/schema";
import type { PropertyType } from "@/lib/db/schema";
import { eq, max } from "drizzle-orm";
import { loadDatabaseForUser } from "@/lib/db-access";
import { isOkfId, decodeId, writeDbAddColumn } from "@/lib/okf-store";

export const dynamic = "force-dynamic";

/** POST { name, type, config? } → adds a property → { property }. */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ databaseId: string }> }
) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  const { databaseId } = await params;

  const body = await req.json().catch(() => ({}));
  const name: string = body?.name || "Property";
  const type: PropertyType = body?.type || "text";

 // file-backed database: add a CSV column; declared type/config → .dbmeta.json
  if (isOkfId(databaseId)) {
    try {
      const col = await writeDbAddColumn(decodeId(databaseId), name, type, body?.config);
      const property = {
        id: col.propId,
        databaseId,
        name: col.name,
        type,
        config: body?.config ?? {},
        position: col.position,
        createdAt: new Date(),
      };
      return NextResponse.json({ property }, { status: 201 });
    } catch {
      return NextResponse.json({ error: "write failed" }, { status: 400 });
    }
  }

  if (!(await loadDatabaseForUser(databaseId, auth.user.id)))
    return NextResponse.json({ error: "Not found" }, { status: 404 });

  const [{ maxPos }] = await db
    .select({ maxPos: max(dbProperties.position) })
    .from(dbProperties)
    .where(eq(dbProperties.databaseId, databaseId));

  const [property] = await db
    .insert(dbProperties)
    .values({
      databaseId,
      name,
      type,
      config: body?.config ?? {},
      position: (maxPos ?? 0) + 1,
    })
    .returning();

  return NextResponse.json({ property }, { status: 201 });
}
