import { NextResponse } from "next/server";
import { checkSchemaDrift, reportSchemaDrift } from "@/lib/db/schema-drift";

export const dynamic = "force-dynamic";

/**
 * GET /api/health → { ok } · 503 when this build's schema is not present.
 *
 * Unauthenticated, because a deploy step has to be able to ask before anyone
 * logs in — so the answer is a status code and nothing else. An earlier version
 * put the missing table and column names in the body, plus `String(err)` from
 * the driver, which on a connection failure reads
 * `connect ECONNREFUSED <host>:5432` or names the database user. That is a map
 * of the inside handed to whoever asks. What is missing belongs in the server
 * log (reportSchemaDrift) and in `pnpm db:check`, both of which are already
 * where the person fixing it is looking.
 */
export async function GET() {
  const schema = await checkSchemaDrift();
  if (!schema.ok) reportSchemaDrift(schema);
  return NextResponse.json({ ok: schema.ok }, { status: schema.ok ? 200 : 503 });
}
