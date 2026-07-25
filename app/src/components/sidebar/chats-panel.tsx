"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Plus,
  MoreHorizontal,
  Trash2,
  Pencil,
  Star,
  StarOff,
  Smile,
  Pin,
  PinOff,
  Bell,
  BellOff,
} from "lucide-react";
import { useAiChatsStore, sortChats } from "@/stores/ai-chats";
import type { AiChat } from "@/lib/db/schema";
import { useToastStore } from "@/stores/toast";
import { IconPicker } from "@/components/page/icon-picker";
import { PageIcon } from "@/components/page-icon";
import { DmSection } from "@/components/dm/dm-section";
import { RelationshipsStrip } from "@/components/dm/relationships-strip";
import { AgentsSection } from "@/components/sidebar/agents-section";
import { ChatsToolbar } from "@/components/sidebar/chats-toolbar";

export function ChatsPanel() {
  const router = useRouter();
  const chats = useAiChatsStore((s) => s.chats);
  const loaded = useAiChatsStore((s) => s.loaded);
  const load = useAiChatsStore((s) => s.load);
  const hasMore = useAiChatsStore((s) => s.hasMore);
  const loadMore = useAiChatsStore((s) => s.loadMore);
  const create = useAiChatsStore((s) => s.create);
  const patch = useAiChatsStore((s) => s.patch);
  const remove = useAiChatsStore((s) => s.remove);
  const markReadLocal = useAiChatsStore((s) => s.markReadLocal);
  const unreadOnly = useAiChatsStore((s) => s.unreadOnly);
  const mutedChatIds = useAiChatsStore((s) => s.mutedChatIds);
  const setMuted = useAiChatsStore((s) => s.setMuted);
  const show = useToastStore((s) => s.show);

  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [renameFor, setRenameFor] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [iconFor, setIconFor] = useState<string | null>(null);
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(-1);
  const renameRef = useRef<HTMLInputElement>(null);

  const q = query.trim().toLowerCase();
  const ordered = sortChats(chats);
  const afterUnread = unreadOnly ? ordered.filter((c) => c.hasUnread) : ordered;
  const visibleChats = q
    ? afterUnread.filter((c) => (c.title || "New chat").toLowerCase().includes(q))
    : afterUnread;
  const pinnedChats = visibleChats.filter((c) => c.isPinned);
  const unpinnedChats = visibleChats.filter((c) => !c.isPinned);
  // 키보드 내비게이션 순서: 화면에 보이는 순서(고정 섹션 먼저) 그대로.
  const navChats = [...pinnedChats, ...unpinnedChats];

  // 방향키로 활성 항목 이동, Enter로 열기. 컨테이너 자신이 포커스일 때만 동작시켜
  // 이름변경 입력창/메뉴 버튼 등 하위 요소의 키 입력과 충돌하지 않게 한다.
  function handleListKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.target !== e.currentTarget || navChats.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => (i + 1 >= navChats.length ? 0 : i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => (i - 1 < 0 ? navChats.length - 1 : i - 1));
    } else if (e.key === "Enter") {
      if (activeIndex >= 0 && activeIndex < navChats.length) {
        e.preventDefault();
        openChat(navChats[activeIndex].id);
      }
    }
  }

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (renameFor) renameRef.current?.focus();
  }, [renameFor]);

  async function newChat() {
    const chat = await create();
    router.push(`/chat/${chat.id}`);
  }

  // 새 채팅 단축키: Cmd/Ctrl+J
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "j" || e.key === "J")) {
        e.preventDefault();
        void newChat();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function openChat(id: string) {
    markReadLocal(id);
    void patch(id, { markRead: true });
    router.push(`/chat/${id}`);
  }

  function startRename(id: string, current: string) {
    setMenuFor(null);
    setRenameDraft(current);
    setRenameFor(id);
  }

  async function commitRename(id: string) {
    const title = renameDraft.trim();
    setRenameFor(null);
    await patch(id, { title: title || "New chat" });
  }

  async function doDelete(id: string) {
    setConfirmDel(null);
    setMenuFor(null);
    await remove(id);
    show("Chat deleted");
  }

  // 고정/전체 두 섹션이 같은 행 마크업을 공유하므로 헬퍼로 뺀다 (JSX 중복 방지).
  function renderChatRow(c: AiChat) {
    const muted = mutedChatIds.has(c.id);
    const navIndex = navChats.indexOf(c);
    const isActive = navIndex !== -1 && navIndex === activeIndex;
    return (
      <div
        key={c.id}
        data-testid={`chat-item-${c.id}`}
        role="option"
        aria-selected={isActive}
        data-active={isActive ? "1" : undefined}
        className={`group/chat relative flex items-center rounded-md pr-1 transition-colors hover:bg-neutral-200/50 dark:hover:bg-neutral-800 ${
          isActive ? "bg-neutral-200/50 dark:bg-neutral-800" : ""
        }`}
      >
        {renameFor === c.id ? (
          <input
            ref={renameRef}
            data-testid={`chat-rename-input-${c.id}`}
            value={renameDraft}
            onChange={(e) => setRenameDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void commitRename(c.id);
              else if (e.key === "Escape") setRenameFor(null);
            }}
            onBlur={() => void commitRename(c.id)}
            className="min-w-0 flex-1 rounded bg-white px-2 py-1 text-sm outline-none ring-1 ring-blue-400 dark:bg-neutral-900"
          />
        ) : (
          <button
            data-testid={`chat-open-${c.id}`}
            onClick={() => openChat(c.id)}
            className="flex min-w-0 flex-1 items-center gap-1.5 px-2 py-1 text-left text-sm text-neutral-600 dark:text-neutral-400"
          >
            <span className="shrink-0 text-[15px] leading-none">
              <PageIcon icon={c.icon} fallback="💬" />
            </span>
            <span className="truncate">{c.title || "New chat"}</span>
            {c.isPinned && (
              <Pin
                data-testid={`chat-pinned-icon-${c.id}`}
                size={11}
                className="shrink-0 text-neutral-400"
              />
            )}
            {c.isFavorite && <Star size={11} className="shrink-0 text-amber-400" />}
            {muted && (
              <BellOff
                data-testid={`chat-muted-icon-${c.id}`}
                size={11}
                className="shrink-0 text-neutral-400"
              />
            )}
            {c.hasUnread && (
              <span
                data-testid={`chat-unread-${c.id}`}
                aria-label="Unread response"
                className="ml-auto h-2 w-2 shrink-0 rounded-full bg-blue-500"
              />
            )}
          </button>
        )}

        <button
          data-testid={`chat-menu-${c.id}`}
          onClick={() => setMenuFor(menuFor === c.id ? null : c.id)}
          aria-label="Chat options"
          className="hidden h-5 w-5 shrink-0 items-center justify-center rounded text-neutral-400 hover:bg-neutral-300/60 hover:text-neutral-600 group-hover/chat:flex dark:hover:bg-neutral-700"
        >
          <MoreHorizontal size={14} />
        </button>

        {menuFor === c.id && (
          <div
            data-testid={`chat-menu-popover-${c.id}`}
            className="popover-anim absolute right-1 top-7 z-50 w-44 rounded-lg border border-neutral-200 bg-white p-1 shadow-xl dark:border-neutral-700 dark:bg-neutral-900"
            onMouseLeave={() => setMenuFor(null)}
          >
            <button
              data-testid={`chat-rename-${c.id}`}
              onClick={() => startRename(c.id, c.title)}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
            >
              <Pencil size={13} /> Rename
            </button>
            <button
              data-testid={`chat-icon-${c.id}`}
              onClick={() => {
                setIconFor(iconFor === c.id ? null : c.id);
                setMenuFor(null);
              }}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
            >
              <Smile size={13} /> Change icon
            </button>
            <button
              data-testid={`chat-fav-${c.id}`}
              onClick={() => {
                void patch(c.id, { isFavorite: !c.isFavorite });
                setMenuFor(null);
              }}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
            >
              {c.isFavorite ? <StarOff size={13} /> : <Star size={13} />}
              {c.isFavorite ? "Remove from favorites" : "Add to favorites"}
            </button>
            <button
              data-testid={`chat-pin-${c.id}`}
              onClick={() => {
                void patch(c.id, { isPinned: !c.isPinned });
                setMenuFor(null);
              }}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
            >
              {c.isPinned ? <PinOff size={13} /> : <Pin size={13} />}
              {c.isPinned ? "Unpin" : "Pin"}
            </button>
            <button
              data-testid={`chat-mute-${c.id}`}
              onClick={() => {
                void setMuted(c.id, !muted);
                setMenuFor(null);
              }}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
            >
              {muted ? <Bell size={13} /> : <BellOff size={13} />}
              {muted ? "Unmute" : "Mute"}
            </button>
            <button
              data-testid={`chat-delete-${c.id}`}
              onClick={() => {
                setConfirmDel(c.id);
                setMenuFor(null);
              }}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40"
            >
              <Trash2 size={13} /> Delete
            </button>
          </div>
        )}

        {iconFor === c.id && (
          <div className="absolute right-1 top-7 z-50 rounded-lg border border-neutral-200 bg-white p-1 shadow-xl dark:border-neutral-700 dark:bg-neutral-900">
            <IconPicker
              icon={c.icon}
              testid={`chat-iconpicker-trigger-${c.id}`}
              pickerTestid={`chat-iconpicker-${c.id}`}
              triggerClassName="rounded-md px-2 py-1 text-sm text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
              placeholder="Pick an icon"
              onChange={(icon) => {
                void patch(c.id, { icon });
                setIconFor(null);
              }}
            />
          </div>
        )}

        {confirmDel === c.id && (
          <div
            data-testid={`chat-delete-modal-${c.id}`}
            className="absolute right-1 top-7 z-50 w-52 rounded-lg border border-neutral-200 bg-white p-3 shadow-xl dark:border-neutral-700 dark:bg-neutral-900"
          >
            <p className="mb-2 text-xs text-neutral-600 dark:text-neutral-300">
              Delete this chat? This cannot be undone.
            </p>
            <div className="flex justify-end gap-2">
              <button
                data-testid={`chat-delete-cancel-${c.id}`}
                onClick={() => setConfirmDel(null)}
                className="rounded px-2 py-1 text-xs text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
              >
                Cancel
              </button>
              <button
                data-testid={`chat-delete-confirm-${c.id}`}
                onClick={() => void doDelete(c.id)}
                className="rounded bg-red-600 px-2 py-1 text-xs font-medium text-white hover:bg-red-700"
              >
                Delete
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-2 pb-4" data-testid="chats-panel">
      <RelationshipsStrip />

      <DmSection />

      <AgentsSection />

      <div className="mt-1 flex items-center justify-between px-2 pb-1 pt-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400">
          AI chats
        </h3>
        <button
          data-testid="chat-new"
          onClick={newChat}
          aria-label="New chat"
          data-tip="New AI chat"
          className="flex h-7 w-7 items-center justify-center rounded-md text-neutral-400 transition-all hover:bg-neutral-200/70 hover:text-neutral-700 active:scale-90 dark:hover:bg-neutral-700 dark:hover:text-neutral-200"
        >
          <Plus size={17} strokeWidth={2.2} />
        </button>
      </div>

      {loaded && chats.length > 0 && (
        <div className="px-1 pb-1">
          <input
            data-testid="chat-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search chats"
            className="w-full rounded-md border border-neutral-200 bg-white px-2 py-1 text-xs text-neutral-700 outline-none focus:border-neutral-400 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200"
          />
        </div>
      )}

      {loaded && chats.length > 0 && <ChatsToolbar />}

      {!loaded ? (
        <div className="space-y-1.5 px-2 py-1">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-5 animate-pulse rounded bg-neutral-200/70 dark:bg-neutral-800" />
          ))}
        </div>
      ) : chats.length === 0 ? (
        <p className="px-2 py-6 text-center text-xs text-neutral-400" data-testid="chats-empty">
          No chats yet.
          <br />Start a new one.
        </p>
      ) : visibleChats.length === 0 ? (
        q ? (
          <p className="px-2 py-6 text-center text-xs text-neutral-400" data-testid="chats-search-empty">
            No chats match &ldquo;{query}&rdquo;.
          </p>
        ) : (
          <p className="px-2 py-6 text-center text-xs text-neutral-400" data-testid="chats-unread-empty">
            No unread chats.
          </p>
        )
      ) : (
        <div
          data-testid="chats-list"
          role="listbox"
          tabIndex={0}
          onKeyDown={handleListKeyDown}
          className="outline-none"
        >
          {pinnedChats.length > 0 && (
            <div
              data-testid="chats-pinned-section"
              className="mb-1 space-y-0.5 border-b border-neutral-200/60 pb-1 dark:border-neutral-800"
            >
              {pinnedChats.map((c) => renderChatRow(c))}
            </div>
          )}
          {unpinnedChats.map((c) => renderChatRow(c))}
          {hasMore && (
            <button
              type="button"
              data-testid="chats-load-more"
              onClick={() => void loadMore()}
              className="mt-1 w-full rounded-md px-2 py-1.5 text-center text-xs text-neutral-400 hover:bg-neutral-200/50 hover:text-neutral-600 dark:hover:bg-neutral-800 dark:hover:text-neutral-300"
            >
              Show more
            </button>
          )}
        </div>
      )}
    </div>
  );
}
