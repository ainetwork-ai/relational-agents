import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users, type User } from "@/lib/db/schema";

/**
 * `users.displayName` is the ONE global name for a person — every surface that
 * shows a human (member lists, message authors, mentions) renders this column,
 * so setting it once is visible to everyone.
 *
 * The catch is the copies: room titles, agent names and the personal workspace
 * name are all built from the name at creation time and then frozen, which is
 * why a counterparty could still read "User-0x…" after you renamed yourself.
 * `propagateDisplayName` refreshes those copies.
 */

export const MAX_DISPLAY_NAME = 80;

export function normalizeDisplayName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = raw.trim().slice(0, MAX_DISPLAY_NAME);
  return name || null;
}

/** Name for a brand-new account when the caller supplied none. */
export function fallbackDisplayName(address: string): string {
  return `User-${address.slice(0, 8)}`;
}

/**
 * Login-time rename. The login form is the only place that offers a name, so a
 * returning user typing a different one IS the rename gesture — every wallet
 * path (AIN, MetaMask, raw key) honours it, not just the first sign-up.
 */
export async function applyLoginDisplayName(user: User, provided: unknown): Promise<User> {
  const name = normalizeDisplayName(provided);
  if (!name || name === user.displayName) return user;
  const [renamed] = await db
    .update(users)
    .set({ displayName: name })
    .where(eq(users.id, user.id))
    .returning();
  return renamed ?? user;
}
