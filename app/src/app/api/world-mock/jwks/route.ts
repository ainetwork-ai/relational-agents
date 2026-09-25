import { NextResponse } from "next/server";
import { mockConfig, mockKeys, notFound } from "../_lib/mock";

export const dynamic = "force-dynamic";

/** Local mock of the sandbox IdP — the public signing key. */
export async function GET() {
  if (!mockConfig()) return notFound();
  const { publicJwk, kid } = await mockKeys();
  return NextResponse.json(
    { keys: [{ ...publicJwk, kid, alg: "RS256", use: "sig" }] },
    { headers: { "cache-control": "no-store" } }
  );
}
