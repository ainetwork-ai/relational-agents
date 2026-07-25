"use client";

import type { PresentClient, PresenceSelf } from "@/hooks/use-presence";
import type { PublicUser } from "@/lib/auth/public-user";

function initials(name: string) {
  return name.slice(0, 1).toUpperCase();
}

/** Face pile of everyone on the page (self + others), deduped by userId. */
export function PresenceBar({
  self,
  others,
}: {
  self: PresenceSelf;
  others: PresentClient[];
}) {
 // dedupe by userId — one avatar per person even across multiple tabs
  const byUser = new Map<string, { user: PublicUser; color: string }>();
  if (self.user) byUser.set(self.user.id, { user: self.user, color: self.color });
  for (const o of others) {
    if (!byUser.has(o.user.id)) byUser.set(o.user.id, { user: o.user, color: o.color });
  }
  const people = Array.from(byUser.values());
  if (people.length === 0) return null;

  return (
    <div data-testid="presence-bar" className="flex items-center -space-x-1.5">
      {people.map(({ user, color }) => (
        <span
          key={user.id}
          data-testid={`presence-avatar-${user.id}`}
          title={user.displayName}
          style={{ backgroundColor: color }}
          className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-white text-[11px] font-semibold text-white dark:border-[#191919]"
        >
          {initials(user.displayName)}
        </span>
      ))}
    </div>
  );
}
