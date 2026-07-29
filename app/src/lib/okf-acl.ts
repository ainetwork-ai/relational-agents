import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { okfAcl } from "@/lib/db/schema";
import { decodeId, isOkfId } from "@/lib/okf-store";

/**
 * OKF path ACL — the file tree has no native permissions, so keeping
 * participant-only content (relationship docs) as files means this layer
 * gates every read/write path.
 *
 * Rule: a path that IS a registered restricted path, or lives under one, is
 * accessible only to its memberIds. Unregistered paths stay workspace-shared.
 */

/** Whether a path is a restricted path or under one. `a/b` covers `a/b` and `a/b/c.md`, not `a/bb`. */
function covers(restricted: string, target: string): boolean {
  return target === restricted || target.startsWith(`${restricted}/`);
}

/** Register/refresh a path (or ancestor) as participant-only. Idempotent. */
export async function setOkfAcl(
  path: string,
  roomId: string | null,
  memberIds: string[]
): Promise<void> {
  const unique = [...new Set(memberIds)];
  await db
    .insert(okfAcl)
    .values({ path, roomId, memberIds: unique, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: okfAcl.path,
      set: { roomId, memberIds: unique, updatedAt: new Date() },
    });
}

export async function clearOkfAcl(path: string): Promise<void> {
  await db.delete(okfAcl).where(eq(okfAcl.path, path));
}

export interface OkfGate {
  /** Can this user read the OKF-relative path. */
  canRead(relPath: string): boolean;
  /** Can this user read the page id (encoded OKF id or UUID). UUIDs are
 * always true (Postgres pages go through restricted/pageMembers instead). */
  canReadId(pageId: string): boolean;
}

/** Build this user's gate — reads the restriction list once and reuses it as a filter. */
export async function okfGateFor(userId: string): Promise<OkfGate> {
  const rows = await db.select().from(okfAcl);
  const denied = rows.filter((r) => !(r.memberIds ?? []).includes(userId)).map((r) => r.path);
  const canRead = (relPath: string) => !denied.some((d) => covers(d, relPath));
  return {
    canRead,
    canReadId: (pageId: string) => (isOkfId(pageId) ? canRead(safeDecode(pageId)) : true),
  };
}

/** One-off check (for single uses inside routes). */
export async function canReadOkfPath(relPath: string, userId: string): Promise<boolean> {
  const gate = await okfGateFor(userId);
  return gate.canRead(relPath);
}

function safeDecode(id: string): string {
  try {
    return decodeId(id);
  } catch {
    return id;
  }
}
