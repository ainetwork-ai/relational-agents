"use client";

import { initial } from "@/lib/glyph";

export interface AvatarUser {
  displayName: string;
  avatarUrl?: string | null;
}

/** The one way a person's face is drawn: their photo when they have one (a
 * Google picture or an uploaded /uploads/* file), else the first glyph of
 * their name. `color` tints the initial — presence uses each peer's cursor
 * colour, everywhere else gets the neutral chip. */
export function UserAvatar({
  user,
  size = 24,
  color,
  className = "",
  title,
  testId,
}: {
  user: AvatarUser;
  size?: number;
  color?: string;
  className?: string;
  title?: string;
  testId?: string;
}) {
  const box = { width: size, height: size };

  if (user.avatarUrl) {
    return (
 // eslint-disable-next-line @next/next/no-img-element
      <img
        src={user.avatarUrl}
        alt={user.displayName}
        title={title}
        data-testid={testId}
        style={box}
        className={`shrink-0 rounded-full object-cover ${className}`}
      />
    );
  }

  return (
    <span
      title={title}
      data-testid={testId}
      style={{ ...box, fontSize: Math.max(10, size * 0.45), backgroundColor: color }}
      className={`flex shrink-0 items-center justify-center rounded-full font-medium ${
        color
          ? "text-white"
          : "bg-neutral-200 text-neutral-600 dark:bg-neutral-700 dark:text-neutral-300"
      } ${className}`}
    >
      {initial(user.displayName)}
    </span>
  );
}
