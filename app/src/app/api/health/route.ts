import { NextResponse } from "next/server";
import { checkSchemaDrift } from "@/lib/db/schema-drift";

export const dynamic = "force-dynamic";

/**
 * GET /api/health → { ok, schema }
 *
 * Unauthenticated on purpose: a deploy step has to be able to ask before
 * anyone logs in, and the answer carries no content — only whether this build's
 * schema is present. Returns 503 when it is not, so a deploy script can fail on
 * the status code without parsing anything.
 */
export async function GET() {
  const schema = await checkSchemaDrift();
  return NextResponse.json(
    {
      ok: schema.ok,
      schema: schema.ok
        ? { ok: true }
        : {
            ok: false,
            missingTables: schema.missingTables,
            missingColumns: schema.missingColumns,
            ...(schema.error ? { error: schema.error } : {}),
            hint: "run `pnpm db:push` against this deployment's POSTGRES_URL",
          },
    },
    { status: schema.ok ? 200 : 503 }
  );
}
