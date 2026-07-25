import type { User } from "@/lib/db/schema";

/** Whitelist of user fields safe to send to the client (never the full row —
 * users carries encryptedPrivateKey and other agent internals). */
export function toPublicUser(user: User) {
  return {
    id: user.id,
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
