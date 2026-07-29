"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { dmRoomLabel, useDmRoomsStore, type DmRoomSummary } from "@/stores/dm-rooms";
import { DmAvatar } from "./dm-avatar";
import { RelationshipsStrip } from "./relationships-strip";
import { NewDmModal } from "./new-dm-modal";

function preview(room: DmRoomSummary): string {
  const m = room.lastMessage;
  if (!m) return "Start the conversation";
  if (m.text) return m.text;
  if (m.hasAttachments) return "📷 Photo";
  return "";
}

/** Sidebar Chats tab, "Relationships" section — sits above the AI chat list. */
export function DmSection() {
  const router = useRouter();
  const rooms = useDmRoomsStore((s) => s.rooms);
  const loaded = useDmRoomsStore((s) => s.loaded);
  const load = useDmRoomsStore((s) => s.load);
  const markReadLocal = useDmRoomsStore((s) => s.markReadLocal);
  const [meId, setMeId] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);

  useEffect(() => {
    void load();
    let alive = true;
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : { user: null }))
      .then((d) => alive && setMeId(d?.user?.id ?? null));
    return () => {
      alive = false;
    };
  }, [load]);

  function openRoom(id: string) {
    markReadLocal(id);
    router.push(`/dm/${id}`);
  }

  return (
    <div data-testid="dm-section" className="pb-2">
      <div className="flex items-center justify-between px-2 pb-1 pt-1">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400">
          Relationships
        </h3>
        <button
          data-testid="dm-new"
          onClick={() => setShowModal(true)}
          aria-label="New relationship"
          data-tip="New relationship"
          className="flex h-7 w-7 items-center justify-center rounded-md text-neutral-400 transition-all hover:bg-neutral-200/70 hover:text-neutral-700 active:scale-90 dark:hover:bg-neutral-700 dark:hover:text-neutral-200"
        >
          <Plus size={17} strokeWidth={2.2} />
        </button>
      </div>

      {/* face strip and room list share this section's one header */}
      <RelationshipsStrip />

      {!loaded ? (
        <div className="space-y-1.5 px-2 py-1">
          {[0, 1].map((i) => (
            <div key={i} className="h-7 animate-pulse rounded bg-neutral-200/70 dark:bg-neutral-800" />
          ))}
        </div>
      ) : rooms.length === 0 ? (
        <button
          data-testid="dms-empty"
          onClick={() => setShowModal(true)}
          className="mx-1 flex w-[calc(100%-0.5rem)] items-center gap-2 rounded-md px-2 py-2 text-left text-xs text-neutral-400 transition-colors hover:bg-neutral-200/50 hover:text-neutral-600 dark:hover:bg-neutral-800"
        >
          <Plus size={14} className="shrink-0" />
          Send someone your first message
        </button>
      ) : (
        rooms.map((room) => {
          const others = room.members.filter((m) => m.id !== meId);
          // a human fronts the row; the agent still counts as a member below
          const face = others.find((m) => !m.isAgent) ?? others[0] ?? room.members[0];
          return (
            <div
              key={room.id}
              data-testid={`dm-item-${room.id}`}
              className="group/dm relative mx-1 flex items-center rounded-md transition-colors hover:bg-neutral-200/50 dark:hover:bg-neutral-800/70"
            >
              <button
                data-testid={`dm-open-${room.id}`}
                onClick={() => openRoom(room.id)}
                className="flex min-w-0 flex-1 items-center gap-2.5 px-2 py-1.5 text-left"
              >
                <span className="relative shrink-0">
                  {face && <DmAvatar user={face} size={28} />}
                  {room.members.length > 2 && (
                    <span className="absolute -bottom-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-neutral-500 px-0.5 text-[9px] font-semibold text-white ring-2 ring-white dark:bg-neutral-500 dark:ring-neutral-900">
                      {room.members.length}
                    </span>
                  )}
                </span>
                <span className="min-w-0 flex-1 leading-tight">
                  <span
                    className={`block truncate text-[13px] ${
                      room.unreadCount > 0
                        ? "font-semibold text-neutral-900 dark:text-neutral-50"
                        : "font-medium text-neutral-700 dark:text-neutral-300"
                    }`}
                  >
                    {dmRoomLabel(room, meId)}
                  </span>
                  <span
                    className={`mt-0.5 block truncate text-[11px] ${
                      room.unreadCount > 0
                        ? "text-neutral-500 dark:text-neutral-300"
                        : "text-neutral-400 dark:text-neutral-500"
                    }`}
                  >
                    {preview(room)}
                  </span>
                </span>
                {room.unreadCount > 0 && (
                  <span
                    data-testid={`dm-unread-${room.id}`}
                    aria-label={`${room.unreadCount} unread`}
                    className="ml-auto flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full bg-blue-500 px-1.5 text-[10px] font-semibold tabular-nums text-white shadow-sm"
                  >
                    {room.unreadCount > 99 ? "99+" : room.unreadCount}
                  </span>
                )}
              </button>
            </div>
          );
        })
      )}

      {showModal && <NewDmModal onClose={() => setShowModal(false)} />}
    </div>
  );
}
