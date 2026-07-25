"use client";

import { Sparkles } from "lucide-react";
import type { DmUser } from "@/stores/dm-rooms";

/** DM avatar: image when avatarUrl exists, else the name's first letter
 * (members-modal convention). Agents get their own look — purple sparkles
 * face instead of a person-style initial, so a room's agent is readable at
 * a glance among human members. */
export function DmAvatar({ user, size = 24 }: { user: DmUser; size?: number }) {
  const style = { width: size, height: size, fontSize: Math.max(10, size * 0.45) };
  if (user.isAgent) {
    return (
      <span
        style={style}
        data-testid="dm-avatar-agent"
        aria-label={`${user.displayName} (agent)`}
        data-tip={`${user.displayName} — agent`}
        className="flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-purple-100 to-fuchsia-100 text-purple-600 ring-1 ring-inset ring-purple-300/60 dark:from-purple-950 dark:to-fuchsia-950 dark:text-purple-300 dark:ring-purple-800"
      >
        <Sparkles style={{ width: size * 0.55, height: size * 0.55 }} strokeWidth={2.2} />
      </span>
    );
  }
  if (user.avatarUrl) {
    return (
 // eslint-disable-next-line @next/next/no-img-element
      <img
        src={user.avatarUrl}
        alt={user.displayName}
        style={style}
        className="shrink-0 rounded-full object-cover"
      />
    );
  }
  return (
    <span
      style={style}
      className="flex shrink-0 items-center justify-center rounded-full bg-neutral-200 font-medium text-neutral-600 dark:bg-neutral-700 dark:text-neutral-300"
    >
      {user.displayName.charAt(0).toUpperCase()}
    </span>
  );
}
