"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Bell, Check, CheckCheck, X } from "lucide-react";
import { initial } from "@/lib/glyph";
import { PageIcon } from "@/components/page-icon";
import { pageFallbackIcon, type PageRow } from "@/lib/page-label";
import { CommentBody } from "@/components/comments/comment-thread";
import { useWorkspaceMembers } from "@/hooks/use-workspace-members";
import { useNotificationsStore, type InboxNotification } from "@/stores/notifications";
import { usePagesStore } from "@/stores/pages";
import { useIntlLocale, useT } from "@/i18n/provider";
import type { T } from "@/i18n/translate";
import type { MentionPerson } from "@/lib/mention/search";

/**
 * Inbox — exactly the values measured on the original (docs/notion-comment-mention.md §6).
 *
 *   panel width 366 · title `Inbox` 14px/500 rgb(44,44,43)
 *     (366 is wider than the sidebar (270) — the value only comes out when it is an overlay
 *      floating **beside** the sidebar, like the original. Put inside the sidebar it squeezes to 269.)
 *   grouped under time-bucket headers (Today / Yesterday / Previous)
 *   avatar 24×24, 8 from the row's left · 10 from the top (no photo → initial 11px rgb(142,139,134))
 *   first line = {sender}(14/500) + phrase + [page icon] + {page title}(14/500),
 *          date at the far right 12px rgb(161,158,153)
 *   preview = body 14/400 rgb(125,122,117) — mentions look the same as in comments (faint @ + name)
 *   unread = a blue dot to the **right** of the date (it used to be drawn on the left)
 *   row height = 87 without a preview, 108 with one
 *
 * Not measured (the capture has no numbers, so we picked them): blue dot 6px, avatar–text gap 8,
 * time-bucket header 12px/500 rgb(125,122,117) (same as the §3 section header), hover background,
 * page icon size (follows the line's font size), the overlay's shadow and radius.
 */

/** First-line phrase. Bold fragments go into the `{actor}`/`{page}` slots —
 *  it has to be translated as a whole so each language keeps its own word order (`X mentioned you in Y`).
 *  `t(key)` returns the placeholders untouched when no vars are given. */
const SUMMARY: Record<string, { page: string; bare: string }> = {
 // original phrase (ko): sender → "mentioned me in" → page title
  mention: { page: "{actor} mentioned you in {page}", bare: "{actor} mentioned you" },
  comment: { page: "{actor} commented on {page}", bare: "{actor} left a comment" },
  invite: { page: "{actor} invited you to {page}", bare: "{actor} invited you" },
 // a relationship-agreement's pageId is a DM room id, so there is no page title — both phrases are the same
  consent: { page: "{actor}'s relationship agreement", bare: "{actor}'s relationship agreement" },
 // a reminder has no sender
  reminder: { page: "⏰ Reminder · {page}", bare: "⏰ Reminder" },
};

const SUMMARY_FALLBACK = {
  page: "{actor} sent you a notification in {page}",
  bare: "{actor} sent you a notification",
};

/** Title of the page a notification points at. null when there is none — then the `bare` phrase is used. */
function pageLabel(n: InboxNotification, t: T): string | null {
 // consent's pageId is a DM room, not a page
  if (!n.pageId || n.type === "consent") return null;
  return n.pageTitle?.trim() || t("Untitled");
}

/** The first line as fragments. Only the name and the page title are weight 500.
 *  `row` is that page as found in the tree — in §6 the first line has a **page icon before** the title
 *  (it comes from the same place the mention menu's page rows get their icons). A page not in the
 *  tree gets the same default glyph as the sidebar. */
function summaryNodes(n: InboxNotification, t: T, row?: PageRow): ReactNode[] {
  const tpl = SUMMARY[n.type] ?? SUMMARY_FALLBACK;
  const page = pageLabel(n, t);
  const actor = n.actor?.displayName ?? t("Someone");
  const text = t(page ? tpl.page : tpl.bare);

  return text.split(/(\{actor\}|\{page\})/).map((part, i) => {
    if (part === "{actor}") {
      return (
        <span key={i} className="font-medium">
          {actor}
        </span>
      );
    }
    if (part === "{page}") {
      return (
        <span key={i} className="font-medium">
          <span
            data-testid={`inbox-pageicon-${n.id}`}
            className="mr-[3px] inline-block align-[-0.1em] text-[14px] leading-none"
          >
            <PageIcon icon={row?.icon} fallback={pageFallbackIcon(row ?? {})} />
          </span>
          {page}
        </span>
      );
    }
    return part;
  });
}

/** The original's time-bucket headers: Today / Yesterday / Previous by notification date. */
function bucketOf(iso: string): "Today" | "Yesterday" | "Previous" {
  const at = new Date(iso).getTime();
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  if (at >= midnight.getTime()) return "Today";
  if (at >= midnight.getTime() - 86_400_000) return "Yesterday";
  return "Previous";
}

function groupByDay(items: InboxNotification[]): { label: string; items: InboxNotification[] }[] {
  const out: { label: string; items: InboxNotification[] }[] = [];
  for (const n of items) {
    const label = bucketOf(n.createdAt);
    const last = out[out.length - 1];
    if (last?.label === label) last.items.push(n);
    else out.push({ label, items: [n] });
  }
  return out;
}

/** Same date notation as the original's comments — month and day (e.g. May 14). */
function fmtDate(iso: string, locale: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat(locale, { month: "long", day: "numeric" }).format(d);
}

/**
 * Where a click goes. A comment notification **carries its commentId** — it used to be dropped.
 *
 * TODO(comment-deeplink): nothing reads `?comment=` yet. The page opens at the top.
 * Scrolling to / highlighting that comment is separate work (owned by page-comment-section).
 */
export function notificationHref(n: InboxNotification): string | null {
  if (!n.pageId) return null;
 // a relationship-agreement notification's pageId is a DM room id — land on the consent banner
  if (n.type === "consent") return `/dm/${n.pageId}`;
  return n.commentId ? `/p/${n.pageId}?comment=${n.commentId}` : `/p/${n.pageId}`;
}

/** One row — all the measured values live here. */
function InboxRow({
  n,
  members,
  onOpen,
  onMarkRead,
}: {
  n: InboxNotification;
 // only real members get mention colouring — the same rule as comments (CommentBody). null means
 // not known yet, so it renders as plain text.
  members: MentionPerson[] | null;
  onOpen: (n: InboxNotification) => void;
  onMarkRead: (id: string) => void;
}) {
  const t = useT();
  const locale = useIntlLocale();
  const preview = n.body?.trim() ?? "";
 // the page icon on the first line — same source as the mention menu's page rows (the page tree)
  const pageRow = usePagesStore((s) => (n.pageId ? s.pages[n.pageId] : undefined));

  return (
    <div
      data-testid={`inbox-item-${n.id}`}
      onClick={() => onOpen(n)}
      className={`group relative flex cursor-pointer gap-2 overflow-hidden rounded-md px-2 pt-[10px] transition-colors hover:bg-neutral-200/50 dark:hover:bg-neutral-700/60 ${
        preview ? "h-[108px]" : "h-[87px]"
      } ${n.read ? "opacity-60" : ""}`}
    >
      {/* avatar 24×24 — 8 from the row's left (px-2), 10 from the top (pt-[10px]) */}
      {n.actor?.avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={n.actor.avatarUrl}
          alt=""
          width={24}
          height={24}
          className="h-6 w-6 shrink-0 rounded-full object-cover"
        />
      ) : (
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-neutral-200 text-[11px] font-medium text-[rgb(142,139,134)] dark:bg-neutral-700 dark:text-neutral-300">
          {initial(n.actor?.displayName ?? (n.type === "reminder" ? "⏰" : "?"))}
        </span>
      )}

      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-1.5">
          <p className="line-clamp-2 min-w-0 flex-1 text-[14px] leading-[20px] font-normal text-[rgb(44,44,43)] dark:text-neutral-200">
            {summaryNodes(n, t, pageRow)}
          </p>
          {/* the date and the unread dot are vertically centred within the first line (20) */}
          <div
            className={`flex h-[20px] shrink-0 items-center gap-1.5 ${
              n.read ? "" : "transition-opacity group-hover:opacity-0"
            }`}
          >
            <span className="text-[12px] leading-[16px] text-[rgb(161,158,153)]">
              {fmtDate(n.createdAt, locale)}
            </span>
            {/* unread: a blue dot to the **right** of the date (it used to sit at the line's left) */}
            {!n.read && (
              <span
                data-testid={`inbox-unread-${n.id}`}
                aria-label={t("Unread")}
                className="h-1.5 w-1.5 rounded-full bg-blue-500"
              />
            )}
          </div>
        </div>

        {preview && (
          <p className="mt-px line-clamp-1 text-[14px] leading-[20px] font-normal text-[rgb(125,122,117)] dark:text-neutral-400">
            {/* the original draws the inbox the **same way** as comments: not a chip but
                the secondary-colour name + a faint `@` at 60% of that colour. The drawing code is shared too —
                when it was separate, `@word`s that comments leave plain got coloured only in the inbox. */}
            <CommentBody body={preview} members={members} />
          </p>
        )}
      </div>

      {/* on hover the original shows 3 icons on the right (mute · mark as read · archive).
          Mark as read is the only one we actually do, so only that one is here. */}
      {!n.read && (
        <button
          data-testid={`inbox-markread-${n.id}`}
          onClick={(e) => {
            e.stopPropagation();
            onMarkRead(n.id);
          }}
          className="absolute top-[8px] right-2 flex h-6 w-6 items-center justify-center rounded-md text-neutral-400 opacity-0 transition-all group-hover:opacity-100 hover:bg-neutral-300/60 hover:text-neutral-600 dark:hover:bg-neutral-600"
          aria-label={t("Mark as read")}
        >
          <Check size={14} />
        </button>
      )}
    </div>
  );
}

/** The list grouped under time-bucket headers. Both shells (the sidebar panel · the old popup) use it. */
function InboxList({
  items,
  onOpen,
  onMarkRead,
}: {
  items: InboxNotification[];
  onOpen: (n: InboxNotification) => void;
  onMarkRead: (id: string) => void;
}) {
  const t = useT();
 // ask once and hand it to the rows (asking per row subscribes to the same answer 17 times)
  const members = useWorkspaceMembers();
  const groups = useMemo(() => groupByDay(items), [items]);

  if (items.length === 0) {
    return <p className="px-3 py-6 text-center text-xs text-neutral-400">{t("No notifications yet")}</p>;
  }

  return (
    <>
      {groups.map((g, i) => (
        <section key={`${g.label}-${i}`} data-testid={`inbox-group-${g.label}`}>
          <h3 className="px-2 pt-3 pb-1 text-[12px] leading-[14px] font-medium text-[rgb(125,122,117)]">
            {t(g.label)}
          </h3>
          {g.items.map((n) => (
            <InboxRow key={n.id} n={n} members={members} onOpen={onOpen} onMarkRead={onMarkRead} />
          ))}
        </section>
      ))}
    </>
  );
}

/**
 * The inbox panel. Drawn when the sidebar switches to its inbox view.
 *
 * **It floats beside the sidebar, not inside it.** The original is 366 wide but the sidebar is 270,
 * so flowing it as a sidebar child squeezes 366 to 269 (`max-w-full` does that —
 * why the measured value never showed on screen). So it is absolutely positioned at `left-full` relative
 * to the sidebar (`aside.relative`), floating on its right, and keeps its width of 366.
 * No border for the same reason: a border on a 366 box makes the rows 364.
 * It closes from both the X button and the sidebar's inbox button (a toggle) — there is no backdrop
 * covering the screen, so the sidebar stays usable while the panel is open.
 */
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
    const href = notificationHref(n);
    if (href) router.push(href);
  }

  return (
    <div
      data-testid="inbox-panel"
      className="absolute inset-y-0 left-full z-40 flex w-[366px] flex-col overflow-hidden rounded-r-xl bg-white shadow-2xl dark:bg-neutral-800 max-md:left-0 max-md:w-[calc(100vw-1rem)] max-md:rounded-xl"
    >
      <div className="flex items-center justify-between px-2 py-1.5">
        <h2 className="text-[14px] leading-[20px] font-medium text-[rgb(44,44,43)] dark:text-neutral-200">
          {t("Inbox")}
        </h2>
        <div className="flex items-center gap-1">
          <button
            data-testid="inbox-markall"
            onClick={() => markAll()}
            className="flex items-center gap-1 rounded px-1.5 py-1 text-xs text-neutral-500 transition-colors hover:bg-neutral-200/60 hover:text-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-700"
          >
            <CheckCheck size={13} /> {t("Mark all as read")}
          </button>
          <button
            onClick={onClose}
            className="rounded p-1 text-neutral-400 transition-colors hover:bg-neutral-200/60 hover:text-neutral-600 dark:hover:bg-neutral-700"
            aria-label={t("Close inbox")}
          >
            <X size={15} />
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto pb-4">
        <InboxList items={items} onOpen={openNotification} onMarkRead={(id) => void markRead(id)} />
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
    const href = notificationHref(n);
    if (href) router.push(href);
  }

  return (
    <>
      {/* icon pill for the sidebar tool row: label only while
          the inbox panel is open, unread count rides the icon's corner */}
      <button
        data-testid="inbox-button"
        onClick={() => (onOpen ? onOpen() : setOpen((v) => !v))}
        aria-label={t("Inbox")}
        data-tip={t("Inbox")}
       // 28×28 — measured on the original (§6). The tab pills beside it are 32, so this button alone is a size smaller.
        className={`relative flex h-7 shrink-0 items-center justify-center gap-1.5 rounded-full text-sm font-medium transition-colors ${
          active
            ? `bg-neutral-200/70 text-neutral-800 dark:bg-neutral-700/70 dark:text-neutral-100 ${showLabel ? "px-2.5" : "w-7 shrink-0"}`
            : "w-7 shrink-0 text-neutral-500 hover:bg-neutral-200/60 dark:text-neutral-400 dark:hover:bg-neutral-800"
        }`}
      >
        <Bell size={16} className="shrink-0" />
        {active && showLabel && t("Inbox")}
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
        <div className="fixed inset-0 z-50" onClick={() => setOpen(false)}>
          <div
            data-testid="inbox-panel"
            onClick={(e) => e.stopPropagation()}
            className="absolute bottom-16 left-3 flex max-h-[60vh] w-[366px] flex-col overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-2xl dark:border-neutral-700 dark:bg-neutral-800"
          >
            <div className="flex items-center justify-between border-b border-neutral-100 px-2 py-2 dark:border-neutral-700">
              <h2 className="text-[14px] leading-[20px] font-medium text-[rgb(44,44,43)] dark:text-neutral-200">
                {t("Inbox")}
              </h2>
              <div className="flex items-center gap-1">
                <button
                  data-testid="inbox-markall"
                  onClick={() => markAll()}
                  className="flex items-center gap-1 rounded px-1.5 py-1 text-xs text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-700"
                >
                  <CheckCheck size={13} /> {t("Mark all as read")}
                </button>
                <button
                  onClick={() => setOpen(false)}
                  className="rounded p-1 text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-600 dark:hover:bg-neutral-700"
                  aria-label={t("Close inbox")}
                >
                  <X size={15} />
                </button>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto pb-1">
              <InboxList
                items={items}
                onOpen={openNotification}
                onMarkRead={(id) => void markRead(id)}
              />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
