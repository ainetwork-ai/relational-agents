"use client";

import type { DmUser } from "@/stores/dm-rooms";

/** DM avatar: image when avatarUrl exists, else the name's first letter (members-modal convention). */
export function DmAvatar({ user, size = 24 }: { user: DmUser; size?: number }) {
  const style = { width: size, height: size, fontSize: Math.max(10, size * 0.45) };
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
