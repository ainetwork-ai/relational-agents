"use client";

import { CheckCheck, Filter } from "lucide-react";
import { useAiChatsStore } from "@/stores/ai-chats";

/**
 * Toolbar atop the Chats panel: unread-only toggle + mark-all-read.
 * chats-panel.tsx may be edited by other sessions too, so this lives as its
 * own component — the panel keeps a single insertion line.
 */
export function ChatsToolbar() {
  const unreadOnly = useAiChatsStore((s) => s.unreadOnly);
  const toggleUnreadOnly = useAiChatsStore((s) => s.toggleUnreadOnly);
  const markAllRead = useAiChatsStore((s) => s.markAllRead);

  return (
    <div className="flex items-center gap-1 px-1 pb-1">
      <button
        type="button"
        data-testid="chats-unread-filter"
        onClick={toggleUnreadOnly}
        aria-pressed={unreadOnly}
        className={`flex items-center gap-1 rounded-md px-2 py-1 text-xs transition-colors ${
          unreadOnly
            ? "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
            : "text-neutral-400 hover:bg-neutral-200/70 hover:text-neutral-600 dark:hover:bg-neutral-800"
        }`}
      >
        <Filter size={12} />
        Unread only
      </button>
      <button
        type="button"
        data-testid="chats-mark-all-read"
        onClick={() => void markAllRead()}
        className="ml-auto flex items-center gap-1 rounded-md px-2 py-1 text-xs text-neutral-400 transition-colors hover:bg-neutral-200/70 hover:text-neutral-600 dark:hover:bg-neutral-800"
      >
        <CheckCheck size={12} />
        Mark all read
      </button>
    </div>
  );
}
