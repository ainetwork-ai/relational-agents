"use client";

import { Bot } from "lucide-react";
import type { DmUser } from "@/stores/dm-rooms";
import { initial } from "@/lib/glyph";
import { UserAvatar } from "@/components/user-avatar";

/** DM avatar: a person goes through the shared UserAvatar — their photo when
 * they have one, else their initial — so a DM face matches the sidebar and the
 * page's face pile. Agents keep their own person-style initial ("relationship
 * agent" → R) — or their picture, when one was set for them — with a small
 * robot chip on the corner marking them as an agent. */
export function DmAvatar({ user, size = 24 }: { user: DmUser; size?: number }) {
  const style = { width: size, height: size, fontSize: Math.max(10, size * 0.45) };
  if (user.isAgent) {
    const chip = Math.max(11, Math.round(size * 0.44));
    return (
      <span
        data-testid="dm-avatar-agent"
        aria-label={`${user.displayName} (agent)`}
        data-tip={`${user.displayName} — agent`}
        className="relative inline-flex shrink-0"
        style={{ width: size, height: size }}
      >
        {user.avatarUrl ? (
          <UserAvatar user={user} size={size} />
        ) : (
          <span
            style={style}
            className="flex shrink-0 items-center justify-center rounded-full bg-neutral-200 font-medium text-neutral-600 dark:bg-neutral-700 dark:text-neutral-300"
          >
            {initial(user.displayName)}
          </span>
        )}
        <span
          className="absolute -bottom-0.5 -right-0.5 flex items-center justify-center rounded-full bg-purple-600 text-white ring-[1.5px] ring-white dark:bg-purple-500 dark:ring-neutral-900"
          style={{ width: chip, height: chip }}
        >
          <Bot style={{ width: chip * 0.7, height: chip * 0.7 }} strokeWidth={2.4} />
        </span>
      </span>
    );
  }
  return <UserAvatar user={user} size={size} />;
}
