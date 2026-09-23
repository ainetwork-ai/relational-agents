/**
 * /api/upload/tus[/**] — the resumable upload endpoint.
 *
 * The protocol is entirely @tus/server's (handleWeb); this file does two
 * things: make every method pass requireAuth first (OPTIONS included — it only
 * advertises capabilities, but this app is same-origin and has no reason to
 * expose an unauthenticated surface), and hand the authenticated userId to the
 * tus hooks through AsyncLocalStorage so naming and ownership work.
 *
 * The chunk size must stay under the Next proxy body cap (next.config.ts) and
 * nginx's client_max_body_size — going over the proxy cap TRUNCATES rather
 * than rejects, which corrupts data silently. lib/files/upload-protocol.ts
 * owns those numbers.
 */
import type { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { getTusServer, runWithTusUser } from "@/lib/files/tus-server";

export const dynamic = "force-dynamic";

async function handler(req: NextRequest) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  return runWithTusUser(auth.user.id, () => getTusServer().handleWeb(req));
}

export { handler as POST, handler as PATCH, handler as HEAD, handler as DELETE, handler as OPTIONS };
