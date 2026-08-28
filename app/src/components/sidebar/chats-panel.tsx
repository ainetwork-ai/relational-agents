"use client";

import { useEffect, useRef, useState } from "react";
import { isImeComposing } from "@/hooks/use-ime-guard";
import { useDismiss } from "@/hooks/use-dismiss";
import { useAnchored } from "@/hooks/use-anchored";
import { createPortal } from "react-dom";
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
import { useT } from "@/i18n/provider";
import { useAiChatsStore, sortChats } from "@/stores/ai-chats";
import type { AiChat } from "@/lib/db/schema";
import { useToastStore } from "@/stores/toast";
import { IconPicker } from "@/components/page/icon-picker";
import { PageIcon } from "@/components/page-icon";
import { DmSection } from "@/components/dm/dm-section";
import { RelationAgentsSection } from "@/components/sidebar/relation-agents-section";
import { ChatsToolbar } from "@/components/sidebar/chats-toolbar";

export function ChatsPanel() {
  const router = useRouter();
  const t = useT();
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
  const menuBtn = useRef<HTMLElement | null>(null);
  const menuPop = useRef<HTMLDivElement>(null);
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
    ? afterUnread.filter((c) => (c.title || t("새 채팅")).toLowerCase().includes(q))
    : afterUnread;
  const pinnedChats = visibleChats.filter((c) => c.isPinned);
  const unpinnedChats = visibleChats.filter((c) => !c.isPinned);
 // keyboard-nav order mirrors the visual order (pinned section first).
  const navChats = [...pinnedChats, ...unpinnedChats];

 // arrows move the active item, Enter opens it. Active only while the
 // container itself has focus, so rename inputs / menu buttons keep their
 // own key handling.
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
 // one ref pair for the whole list: the row that opens the menu records its own
 // button, so the portalled panel can hang off it (in the sidebar's scroller it
 // was clipped, like the page-row menu was)
  useAnchored(menuFor !== null, menuBtn, menuPop, { align: "end" });
  useDismiss(menuFor !== null, () => setMenuFor(null), menuBtn, menuPop);


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

 // new-chat shortcut: Cmd/Ctrl+J
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
    show(t("채팅이 삭제되었습니다"));
  }

 // pinned/all share the same row markup — extracted to a helper (no JSX duplication).
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
              if (!isImeComposing(e) && e.key === "Enter") void commitRename(c.id);
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
            <span className="truncate">{c.title || t("새 채팅")}</span>
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
                aria-label={t("읽지 않은 응답")}
                className="ml-auto h-2 w-2 shrink-0 rounded-full bg-blue-500"
              />
            )}
          </button>
        )}

        <button
          data-testid={`chat-menu-${c.id}`}
          ref={(el) => { if (el) menuBtn.current = el; }}
              onClick={() => setMenuFor(menuFor === c.id ? null : c.id)}
          aria-label={t("채팅 옵션")}
          className="hidden h-5 w-5 shrink-0 items-center justify-center rounded text-neutral-400 hover:bg-neutral-300/60 hover:text-neutral-600 group-hover/chat:flex dark:hover:bg-neutral-700"
        >
          <MoreHorizontal size={14} />
        </button>

        {menuFor === c.id && (
          createPortal(
              <div
            ref={menuPop}
            data-testid={`chat-menu-popover-${c.id}`}
            style={{ visibility: "hidden" }}
            className="popover-anim fixed z-50 w-44 overflow-y-auto rounded-lg border border-neutral-200 bg-white p-1 shadow-xl dark:border-neutral-700 dark:bg-neutral-900"
            onMouseLeave={() => setMenuFor(null)}
          >
            <button
              data-testid={`chat-rename-${c.id}`}
              onClick={() => startRename(c.id, c.title)}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
            >
              <Pencil size={13} /> {t("이름 바꾸기")}
            </button>
            <button
              data-testid={`chat-icon-${c.id}`}
              onClick={() => {
                setIconFor(iconFor === c.id ? null : c.id);
                setMenuFor(null);
              }}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
            >
              <Smile size={13} /> {t("아이콘 변경")}
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
              {c.isFavorite ? t("즐겨찾기에서 제거") : t("즐겨찾기에 추가")}
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
              {c.isPinned ? t("고정 해제") : t("고정")}
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
              {muted ? t("알림 켜기") : t("알림 끄기")}
            </button>
            <button
              data-testid={`chat-delete-${c.id}`}
              onClick={() => {
                setConfirmDel(c.id);
                setMenuFor(null);
              }}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40"
            >
              <Trash2 size={13} /> {t("삭제")}
            </button>
          </div>,
          document.body
        ))}

        {iconFor === c.id && (
          <div className="absolute right-1 top-7 z-50 rounded-lg border border-neutral-200 bg-white p-1 shadow-xl dark:border-neutral-700 dark:bg-neutral-900">
            <IconPicker
              icon={c.icon}
              testid={`chat-iconpicker-trigger-${c.id}`}
              pickerTestid={`chat-iconpicker-${c.id}`}
              triggerClassName="rounded-md px-2 py-1 text-sm text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
              placeholder={t("아이콘 선택")}
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
              {t("이 채팅을 삭제할까요? 되돌릴 수 없습니다.")}
            </p>
            <div className="flex justify-end gap-2">
              <button
                data-testid={`chat-delete-cancel-${c.id}`}
                onClick={() => setConfirmDel(null)}
                className="rounded px-2 py-1 text-xs text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
              >
                {t("취소")}
              </button>
              <button
                data-testid={`chat-delete-confirm-${c.id}`}
                onClick={() => void doDelete(c.id)}
                className="rounded bg-red-600 px-2 py-1 text-xs font-medium text-white hover:bg-red-700"
              >
                {t("삭제")}
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-2 pb-4" data-testid="chats-panel">
      <DmSection />

      <RelationAgentsSection />

      <div className="mt-1 flex items-center justify-between px-2 pb-1 pt-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400">
          {t("AI 채팅")}
        </h3>
        <button
          data-testid="chat-new"
          onClick={newChat}
          aria-label={t("새 채팅")}
          data-tip={t("새 AI 채팅")}
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
            placeholder={t("채팅 검색")}
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
          {t("아직 채팅이 없습니다.")}
          <br />{t("새 채팅을 시작해 보세요.")}
        </p>
      ) : visibleChats.length === 0 ? (
        q ? (
          <p className="px-2 py-6 text-center text-xs text-neutral-400" data-testid="chats-search-empty">
            {t("“{q}”와 일치하는 채팅이 없습니다.", { q: query })}
          </p>
        ) : (
          <p className="px-2 py-6 text-center text-xs text-neutral-400" data-testid="chats-unread-empty">
            {t("읽지 않은 채팅이 없습니다.")}
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
              {t("더 보기")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
