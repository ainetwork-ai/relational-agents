"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useDmEvents } from "@/hooks/use-dm-events";
import { DmAvatar } from "@/components/dm/dm-avatar";
import type { DmUser } from "@/stores/dm-rooms";

interface RoomMessage {
  id: string;
  authorId: string | null;
  text: string;
  createdAt: string;
}

/**
 * In-call transcript panel (Meet-style right sidebar): the room's messages,
 * refetched on dm-message like dm-view, plus my in-flight STT line. Read-only
 * — speech is the composer.
 */
export function CallChatPanel({
  roomId,
  meId,
  members,
  interim,
}: {
  roomId: string;
  meId: string | null;
  members: DmUser[];
  interim: string;
}) {
  const [messages, setMessages] = useState<RoomMessage[]>([]);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const refetch = useCallback(() => {
    fetch(`/api/dm/rooms/${roomId}/messages`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.messages) setMessages(d.messages);
      })
      .catch(() => {});
  }, [roomId]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  useDmEvents(
    (event) => {
      if (event.type === "dm-message" && event.roomId === roomId) refetch();
    },
    () => refetch()
  );

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages, interim]);

  const byId = new Map(members.map((m) => [m.id, m]));
  const me = meId ? byId.get(meId) : undefined;

  return (
    <aside
      data-testid="call-chat-panel"
      className="flex w-[340px] flex-none flex-col border-l border-neutral-200 bg-white dark:border-neutral-800 dark:bg-[#191919]"
    >
      <div className="border-b border-neutral-200 px-4 py-3 text-sm font-semibold dark:border-neutral-800">
        In-call messages
      </div>
      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
        {messages.map((m) => {
          const author = m.authorId ? byId.get(m.authorId) : undefined;
          return (
            <div key={m.id} className="flex items-start gap-2" data-testid="call-chat-msg">
              {author && <DmAvatar user={author} size={22} />}
              <div className="min-w-0">
                <div className="text-[11px] font-medium text-neutral-400">
                  {author?.displayName ?? "…"}
                  <span className="ml-1.5 font-normal">
                    {new Date(m.createdAt).toLocaleTimeString("en-US", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </div>
                <div className="whitespace-pre-wrap break-words text-sm text-neutral-800 dark:text-neutral-200">
                  {m.text}
                </div>
              </div>
            </div>
          );
        })}
        {interim && (
          <div className="flex items-start gap-2" data-testid="call-chat-interim">
            {me && <DmAvatar user={me} size={22} />}
            <div className="min-w-0 pt-0.5 text-sm italic text-neutral-400">{interim}…</div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>
    </aside>
  );
}
