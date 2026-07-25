import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { db } from "@/lib/db";
import { pages, workspaceMembers } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { toPublicUser, type PublicUser } from "@/lib/auth/public-user";
import { publish, type CursorInfo } from "@/lib/realtime";
import { isOkfId } from "@/lib/okf-store";

export const dynamic = "force-dynamic";

const STALE_MS = 15_000;

interface PresenceEntry {
  clientId: string;
  user: PublicUser;
  cursor?: CursorInfo;
  at: number;
}

// pageId → clientId → entry. Survives dev HMR duplication via globalThis.
const KEY = Symbol.for("notion.presence.registry");
function registry(): Map<string, Map<string, PresenceEntry>> {
  const g = globalThis as unknown as Record<symbol, Map<string, Map<string, PresenceEntry>>>;
  if (!g[KEY]) g[KEY] = new Map();
  return g[KEY];
}

function prune(page: Map<string, PresenceEntry>) {
  const now = Date.now();
  for (const [clientId, entry] of page) {
    if (now - entry.at > STALE_MS) page.delete(clientId);
  }
}

async function assertAccess(pageId: string, userId: string) {
  if (isOkfId(pageId)) return false; // file-backed page: no SQL presence registry
  const [page] = await db.select().from(pages).where(eq(pages.id, pageId)).limit(1);
  if (!page) return false;
  const [membership] = await db
    .select()
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.workspaceId, page.workspaceId),
        eq(workspaceMembers.userId, userId)
      )
    )
    .limit(1);
  return !!membership;
}

/** GET → { presences: [{ clientId, user, cursor, at }] } (fresh only). */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ pageId: string }> }
) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  const { pageId } = await params;
  // file-backed (OKF) pages have no SQL presence registry — report empty, not 404
  if (isOkfId(pageId)) return NextResponse.json({ presences: [] });
  if (!(await assertAccess(pageId, auth.user.id)))
    return NextResponse.json({ error: "Not found" }, { status: 404 });

  const page = registry().get(pageId);
  if (!page) return NextResponse.json({ presences: [] });
  prune(page);
  return NextResponse.json({ presences: Array.from(page.values()) });
}

/** POST { clientId, cursor? } → register a heartbeat and broadcast presence. */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ pageId: string }> }
) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  const { pageId } = await params;
  // file-backed (OKF) pages: presence heartbeats are a no-op (no SQL registry)
  if (isOkfId(pageId)) return NextResponse.json({ ok: true });
  if (!(await assertAccess(pageId, auth.user.id)))
    return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const clientId = typeof body?.clientId === "string" ? body.clientId : null;
  if (!clientId)
    return NextResponse.json({ error: "clientId required" }, { status: 400 });

  const cursor: CursorInfo | undefined =
    body?.cursor && typeof body.cursor.label === "string" && typeof body.cursor.color === "string"
      ? {
          label: body.cursor.label,
          color: body.cursor.color,
          blockId: typeof body.cursor.blockId === "string" ? body.cursor.blockId : undefined,
          x: typeof body.cursor.x === "number" ? body.cursor.x : undefined,
          y: typeof body.cursor.y === "number" ? body.cursor.y : undefined,
        }
      : undefined;

  const user = toPublicUser(auth.user);
  const at = Date.now();

  const map = registry();
  let page = map.get(pageId);
  if (!page) {
    page = new Map();
    map.set(pageId, page);
  }
  page.set(clientId, { clientId, user, cursor, at });
  prune(page);

  publish({
    type: cursor ? "cursor" : "presence",
    pageId,
    clientId,
    at,
    user,
    cursor,
  });

  return NextResponse.json({ ok: true });
}
