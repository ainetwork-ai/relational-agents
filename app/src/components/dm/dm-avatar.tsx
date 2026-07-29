"use client";

import { Bot } from "lucide-react";
import type { DmUser } from "@/stores/dm-rooms";
import { initial } from "@/lib/glyph";

/** DM avatar: image when avatarUrl exists, else the name's first letter
 * (members-modal convention). Agents keep the same person-style initial —
 * their names vary ("relationshipagent" → R) — and a small robot chip on
 * the corner is what marks them as an agent. */
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
        <span
          style={style}
          className="flex shrink-0 items-center justify-center rounded-full bg-neutral-200 font-medium text-neutral-600 dark:bg-neutral-700 dark:text-neutral-300"
        >
          {initial(user.displayName)}
        </span>
        <span
          className="absolute -bottom-0.5 -right-0.5 flex items-center justify-center rounded-full bg-purple-600 text-white ring-[1.5px] ring-white dark:bg-purple-500 dark:ring-neutral-900"
          style={{ width: chip, height: chip }}
        >
          <Bot style={{ width: chip * 0.7, height: chip * 0.7 }} strokeWidth={2.4} />
        </span>
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
      {initial(user.displayName)}
    </span>
  );
}
