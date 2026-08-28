import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { getMaxUploadBytes } from "@/lib/files/upload-limit";

export const dynamic = "force-dynamic";

/**
 * GET → { maxUploadBytes }. The client pre-checks size against this rather
 * than a constant it was built with, so lowering MAX_UPLOAD_MB takes effect
 * without a redeploy. The authoritative refusal is still the server's.
 */
export async function GET() {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  return NextResponse.json({ maxUploadBytes: getMaxUploadBytes() });
}
