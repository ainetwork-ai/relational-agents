import type { User } from "@/lib/db/schema";

/** Whitelist of user fields safe to send to the client (never the full row —
 * users carries encryptedPrivateKey and other agent internals). */
export function toPublicUser(user: User) {
  return {
    id: user.id,
    // identity is the Google account now; ainAddress survives only on agent
    // rows (generated key) and external A2A bots (an `a2a:<url>` marker)
    email: user.email,
    ainAddress: user.ainAddress,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    homeCoverUrl: user.homeCoverUrl,
    status: user.status,
    isAgent: user.isAgent,
    timezone: user.timezone,
    createdAt: user.createdAt,
  };
}

export type PublicUser = ReturnType<typeof toPublicUser>;
