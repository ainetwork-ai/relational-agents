"use client";

/** Faces in the room chat. The agent is a rounded square with a bot mark, never a
 *  person's circle; a person is their photo, else their initial on a stable
 *  Notion tag tint (UserAvatar's own fallback is one neutral grey for all). */
import { Bot } from "lucide-react";
import type { DmUser } from "@/stores/dm-rooms";
import { UserAvatar } from "@/components/user-avatar";
import { initial } from "@/lib/glyph";
import { AGENT_AVATAR, tintFor } from "./tokens";

export function AgentMark({ size }: { size: 24 | 32 }) {
  const shape = size === 32 ? "h-8 w-8 rounded-[6px] text-[15px]" : "h-6 w-6 rounded-[5px] text-[12px]";
  return (
    <span
      aria-hidden
      data-testid="room-chat-agent-avatar"
      className={`flex shrink-0 items-center justify-center leading-none ${shape} ${AGENT_AVATAR}`}
    >
      <Bot size={size === 32 ? 17 : 13} strokeWidth={1.75} />
    </span>
  );
}

export function PersonAvatar({ user, size }: { user: DmUser; size: 24 | 32 }) {
  if (user.avatarUrl) return <UserAvatar user={user} size={size} />;
  const shape = size === 32 ? "h-8 w-8 text-[13px]" : "h-6 w-6 text-[11px]";
  return (
    <span
      aria-hidden
      data-testid="room-chat-initial-avatar"
      className={`flex shrink-0 items-center justify-center rounded-full font-semibold leading-none ${shape} ${tintFor(user.id)}`}
    >
      {initial(user.displayName)}
    </span>
  );
}
