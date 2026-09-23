import type { User } from "@/lib/db/schema";
import { resolveAvatarUrl } from "@/lib/avatar";

/** Whitelist of user fields safe to send to the client (never the full row —
 * users carries encryptedPrivateKey and other agent internals). */
export function toPublicUser(user: User) {
  return {
    id: user.id,
    ainAddress: user.ainAddress,
    displayName: user.displayName,
   // resolved here so no client has to guess whether a portrait exists — the
   // one place every user crosses on its way to the browser
    avatarUrl: resolveAvatarUrl(user.displayName, user.avatarUrl),
    homeCoverUrl: user.homeCoverUrl,
    status: user.status,
    isAgent: user.isAgent,
    timezone: user.timezone,
    createdAt: user.createdAt,
  };
}

export type PublicUser = ReturnType<typeof toPublicUser>;
