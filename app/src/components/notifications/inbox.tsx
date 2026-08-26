"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, Check, CheckCheck, X } from "lucide-react";
import { useNotificationsStore, type InboxNotification } from "@/stores/notifications";
import { useT } from "@/i18n/provider";
import type { T } from "@/i18n/translate";

// display-only; translated at render via t(TYPE_LABEL[type])
const TYPE_LABEL: Record<string, string> = {
  mention: "님이 나를 멘션했습니다",
  comment: "님이 댓글을 남겼습니다",
  invite: "님이 나를 초대했습니다",
  consent: "님의 관계 계약",
};

function summarize(n: InboxNotification, t: T): string {
  const where = n.pageTitle ? ` · ${n.pageTitle || t("제목 없음")}` : "";
 // reminders are actorless
  if (n.type === "reminder") return `⏰ ${t("리마인더")}${where}`;
  const who = n.actor?.displayName ?? t("누군가");
  const what = t(TYPE_LABEL[n.type] ?? "님이 나에게 알림을 보냈습니다");
  return `${who}${what}${where}`;
}

/** Inline sidebar panel (Inbox replaces the sidebar content, not a
 * popup). Rendered by the sidebar when its Inbox view is active. */
export function InboxPanel({ onClose }: { onClose: () => void }) {
  const t = useT();
  const router = useRouter();
  const items = useNotificationsStore((s) => s.items);
  const load = useNotificationsStore((s) => s.load);
  const markRead = useNotificationsStore((s) => s.markRead);
  const markAll = useNotificationsStore((s) => s.markAll);

  useEffect(() => {
    load();
  }, [load]);

  function openNotification(n: InboxNotification) {
    void markRead(n.id);
    if (!n.pageId) return;
    // consent notifications carry the DM room id — land on the consent banner
    router.push(n.type === "consent" ? `/dm/${n.pageId}` : `/p/${n.pageId}`);
  }

  return (
    <div data-testid="inbox-panel" className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between px-3 py-1.5">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-neutral-400">{t("수신함")}</h2>
        <div className="flex items-center gap-1">
          <button
            data-testid="inbox-markall"
            onClick={() => markAll()}
            className="flex items-center gap-1 rounded px-1.5 py-1 text-xs text-neutral-500 transition-colors hover:bg-neutral-200/60 hover:text-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-700"
          >
            <CheckCheck size={13} /> {t("모두 읽음으로 표시")}
          </button>
          <button
            onClick={onClose}
            className="rounded p-1 text-neutral-400 transition-colors hover:bg-neutral-200/60 hover:text-neutral-600 dark:hover:bg-neutral-700"
            aria-label={t("수신함 닫기")}
          >
            <X size={15} />
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        {items.length === 0 ? (
          <p className="px-3 py-6 text-center text-xs text-neutral-400">{t("아직 알림이 없습니다")}</p>
        ) : (
          items.map((n) => (
            <div
              key={n.id}
              data-testid={`inbox-item-${n.id}`}
              onClick={() => openNotification(n)}
              className={`group flex cursor-pointer items-start gap-2 rounded-md px-2 py-2 text-sm transition-colors hover:bg-neutral-200/50 dark:hover:bg-neutral-700/60 ${
                n.read ? "opacity-60" : ""
              }`}
            >
              {!n.read && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-blue-500" />}
              <div className="min-w-0 flex-1">
                <p className="truncate text-neutral-800 dark:text-neutral-200">{summarize(n, t)}</p>
                {n.body && <p className="truncate text-xs text-neutral-400">{n.body}</p>}
              </div>
              {!n.read && (
                <button
                  data-testid={`inbox-markread-${n.id}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    void markRead(n.id);
                  }}
                  className="shrink-0 rounded p-1 text-neutral-400 opacity-0 transition-all hover:bg-neutral-300/60 hover:text-neutral-600 group-hover:opacity-100 dark:hover:bg-neutral-600"
                  aria-label={t("읽음으로 표시")}
                >
                  <Check size={13} />
                </button>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

/** Sidebar inbox: a bell button with an unread badge. With `onOpen` the button
 * is controlled by the sidebar (inline panel); without it, it opens the
 * legacy popup listing the caller's notifications. */
export function NotificationsInbox({
  onOpen,
  active,
  showLabel = true,
}: { onOpen?: () => void; active?: boolean; showLabel?: boolean } = {}) {
  const t = useT();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const items = useNotificationsStore((s) => s.items);
  const unreadCount = useNotificationsStore((s) => s.unreadCount);
  const load = useNotificationsStore((s) => s.load);
  const markRead = useNotificationsStore((s) => s.markRead);
  const markAll = useNotificationsStore((s) => s.markAll);

 // Load on mount + poll so the badge reflects new mentions/comments.
  useEffect(() => {
    load();
    const timer = setInterval(load, 15_000);
    return () => clearInterval(timer);
  }, [load]);

 // Refresh the list each time the panel is opened.
  useEffect(() => {
    if (open) load();
  }, [open, load]);

  function openNotification(n: InboxNotification) {
    void markRead(n.id);
    setOpen(false);
    if (!n.pageId) return;
    router.push(n.type === "consent" ? `/dm/${n.pageId}` : `/p/${n.pageId}`);
  }

  return (
    <>
      {/* icon pill for the sidebar tool row: label only while
          the inbox panel is open, unread count rides the icon's corner */}
      <button
        data-testid="inbox-button"
        onClick={() => (onOpen ? onOpen() : setOpen((v) => !v))}
        aria-label={t("수신함")}
        data-tip={t("수신함")}
        className={`relative flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-full text-sm font-medium transition-colors ${
          active
            ? `bg-neutral-200/70 text-neutral-800 dark:bg-neutral-700/70 dark:text-neutral-100 ${showLabel ? "px-2.5" : "w-8 min-w-7 shrink"}`
            : "w-8 min-w-7 shrink text-neutral-500 hover:bg-neutral-200/60 dark:text-neutral-400 dark:hover:bg-neutral-800"
        }`}
      >
        <Bell size={16} className="shrink-0" />
        {active && showLabel && t("수신함")}
        {unreadCount > 0 && (
          <span
            data-testid="inbox-badge"
            className={`flex h-3.5 min-w-3.5 shrink-0 items-center justify-center rounded-full bg-red-500 px-[3px] text-[9px] font-semibold text-white ${
              active && showLabel ? "" : "absolute -top-0.5 -right-0.5"
            }`}
          >
            {unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50"
          onClick={() => setOpen(false)}
        >
          <div
            data-testid="inbox-panel"
            onClick={(e) => e.stopPropagation()}
            className="absolute bottom-16 left-3 flex max-h-[60vh] w-80 flex-col overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-2xl dark:border-neutral-700 dark:bg-neutral-800"
          >
            <div className="flex items-center justify-between border-b border-neutral-100 px-3 py-2 dark:border-neutral-700">
              <h2 className="text-sm font-semibold text-neutral-800 dark:text-neutral-200">
                {t("수신함")}
              </h2>
              <div className="flex items-center gap-1">
                <button
                  data-testid="inbox-markall"
                  onClick={() => markAll()}
                  className="flex items-center gap-1 rounded px-1.5 py-1 text-xs text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-700"
                >
                  <CheckCheck size={13} /> {t("모두 읽음으로 표시")}
                </button>
                <button
                  onClick={() => setOpen(false)}
                  className="rounded p-1 text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-600 dark:hover:bg-neutral-700"
                  aria-label={t("수신함 닫기")}
                >
                  <X size={15} />
                </button>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-1">
              {items.length === 0 ? (
                <p className="px-3 py-6 text-center text-xs text-neutral-400">
                  {t("아직 알림이 없습니다")}
                </p>
              ) : (
                items.map((n) => (
                  <div
                    key={n.id}
                    data-testid={`inbox-item-${n.id}`}
                    onClick={() => openNotification(n)}
                    className={`group flex cursor-pointer items-start gap-2 rounded-md px-2 py-2 text-sm transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-700/60 ${
                      n.read ? "opacity-60" : ""
                    }`}
                  >
                    {!n.read && (
                      <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-blue-500" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-neutral-800 dark:text-neutral-200">
                        {summarize(n, t)}
                      </p>
                      {n.body && (
                        <p className="truncate text-xs text-neutral-400">{n.body}</p>
                      )}
                    </div>
                    {!n.read && (
                      <button
                        data-testid={`inbox-markread-${n.id}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          void markRead(n.id);
                        }}
                        className="shrink-0 rounded p-1 text-neutral-400 opacity-0 transition-all hover:bg-neutral-200/60 hover:text-neutral-600 group-hover:opacity-100 dark:hover:bg-neutral-600"
                        aria-label={t("읽음으로 표시")}
                      >
                        <Check size={13} />
                      </button>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
