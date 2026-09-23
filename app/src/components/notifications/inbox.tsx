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
 * 수신함 — 원본에서 잰 값 그대로 (docs/notion-comment-mention.md §6).
 *
 *   패널 폭 366 · 제목 `수신함` 14px/500 rgb(44,44,43)
 *     (366 은 사이드바(270)보다 넓다 — 원본처럼 사이드바 **옆에 뜨는 오버레이**여야
 *      나오는 값이다. 사이드바 안에 넣으면 269 로 눌린다.)
 *   시간대 머리(오늘 / 어제 / 이전)로 묶는다
 *   아바타 24×24, 행 왼쪽에서 8 · 위에서 10 (사진이 없으면 이니셜 11px rgb(142,139,134))
 *   첫 줄 = {보낸 사람}(14/500) + 문구 + [페이지 아이콘] + {페이지 제목}(14/500),
 *          오른쪽 끝 날짜 12px rgb(161,158,153)
 *   미리보기 = 본문 14/400 rgb(125,122,117) — 멘션은 댓글과 같은 모양(연한 @ + 이름)
 *   안 읽음 = 날짜 **오른쪽**의 파란 점 (예전엔 왼쪽에 그렸다)
 *   행 높이 = 미리보기 없으면 87, 있으면 108
 *
 * 잰 값이 아닌 것(원본 캡처에 수치가 없어 우리가 고른 것): 파란 점 6px, 아바타–글 간격 8,
 * 시간대 머리 12px/500 rgb(125,122,117)(§3 섹션 머리와 같은 값), 호버 배경,
 * 페이지 아이콘 크기(줄의 글자 크기를 따른다), 오버레이의 그림자·라운드.
 */

/** 첫 줄 문구. `{actor}`/`{page}` 자리에 굵은 조각이 들어간다 —
 *  통째로 번역해야 영어의 어순(`X mentioned you in Y`)이 산다.
 *  `t(key)` 는 vars 를 주지 않으면 자리표시자를 그대로 돌려준다. */
const SUMMARY: Record<string, { page: string; bare: string }> = {
 // 원본 문구: 보낸 사람 → `다음에서 나를 멘션함` → 페이지 제목
  mention: { page: "{actor} 다음에서 나를 멘션함 {page}", bare: "{actor}님이 나를 멘션했습니다" },
  comment: { page: "{actor}님이 {page}에 댓글을 달았습니다.", bare: "{actor}님이 댓글을 달았습니다." },
  invite: { page: "{actor}님이 {page}에 초대했습니다", bare: "{actor}님이 나를 초대했습니다" },
 // 관계 계약의 pageId 는 DM 방 id 라 페이지 제목이 없다 — 두 쪽이 같은 문구다
  consent: { page: "{actor}님의 관계 계약", bare: "{actor}님의 관계 계약" },
 // 리마인더는 보낸 사람이 없다
  reminder: { page: "⏰ 리마인더 · {page}", bare: "⏰ 리마인더" },
};

const SUMMARY_FALLBACK = {
  page: "{actor}님이 {page}에서 알림을 보냈습니다",
  bare: "{actor}님이 나에게 알림을 보냈습니다",
};

/** 알림이 가리키는 페이지 제목. 없으면 null — 그러면 `bare` 문구를 쓴다. */
function pageLabel(n: InboxNotification, t: T): string | null {
 // consent 의 pageId 는 페이지가 아니라 DM 방이다
  if (!n.pageId || n.type === "consent") return null;
  return n.pageTitle?.trim() || t("제목 없음");
}

/** 첫 줄을 조각으로. 이름과 페이지 제목만 weight 500 이다.
 *  `row` 는 트리에서 찾은 그 페이지 — §6 의 첫 줄에는 제목 **앞에 페이지 아이콘**이
 *  붙는다(멘션 메뉴의 페이지 행이 아이콘을 얻는 것과 같은 곳에서 온다). 트리에 없는
 *  페이지면 사이드바와 같은 기본 글리프를 쓴다. */
function summaryNodes(n: InboxNotification, t: T, row?: PageRow): ReactNode[] {
  const tpl = SUMMARY[n.type] ?? SUMMARY_FALLBACK;
  const page = pageLabel(n, t);
  const actor = n.actor?.displayName ?? t("누군가");
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

/** 원본의 시간대 머리. 알림 날짜로 오늘 / 어제 / 이전. */
function bucketOf(iso: string): "오늘" | "어제" | "이전" {
  const at = new Date(iso).getTime();
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  if (at >= midnight.getTime()) return "오늘";
  if (at >= midnight.getTime() - 86_400_000) return "어제";
  return "이전";
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

/** 원본 댓글과 같은 날짜 표기 — `5월 14일`. */
function fmtDate(iso: string, locale: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat(locale, { month: "long", day: "numeric" }).format(d);
}

/**
 * 클릭했을 때 갈 곳. 댓글 알림은 **commentId 를 들고 간다** — 예전엔 버렸다.
 *
 * TODO(comment-deeplink): `?comment=` 를 읽는 쪽이 아직 없다. 페이지는 맨 위에서 열린다.
 * 해당 댓글로 스크롤/강조하는 것은 별도 작업(page-comment-section 담당).
 */
export function notificationHref(n: InboxNotification): string | null {
  if (!n.pageId) return null;
 // 관계 계약 알림의 pageId 는 DM 방 id 다 — 동의 배너 위로 내린다
  if (n.type === "consent") return `/dm/${n.pageId}`;
  return n.commentId ? `/p/${n.pageId}?comment=${n.commentId}` : `/p/${n.pageId}`;
}

/** 행 하나 — 잰 값이 다 여기 있다. */
function InboxRow({
  n,
  members,
  onOpen,
  onMarkRead,
}: {
  n: InboxNotification;
 // 실제 멤버만 멘션으로 물들인다 — 댓글과 같은 규칙(CommentBody). null 이면
 // 아직 모르는 것이라 평문으로 그린다.
  members: MentionPerson[] | null;
  onOpen: (n: InboxNotification) => void;
  onMarkRead: (id: string) => void;
}) {
  const t = useT();
  const locale = useIntlLocale();
  const preview = n.body?.trim() ?? "";
 // 첫 줄의 페이지 아이콘 — 멘션 메뉴의 페이지 행과 같은 출처(페이지 트리)
  const pageRow = usePagesStore((s) => (n.pageId ? s.pages[n.pageId] : undefined));

  return (
    <div
      data-testid={`inbox-item-${n.id}`}
      onClick={() => onOpen(n)}
      className={`group relative flex cursor-pointer gap-2 overflow-hidden rounded-md px-2 pt-[10px] transition-colors hover:bg-neutral-200/50 dark:hover:bg-neutral-700/60 ${
        preview ? "h-[108px]" : "h-[87px]"
      } ${n.read ? "opacity-60" : ""}`}
    >
      {/* 아바타 24×24 — 행 왼쪽에서 8(px-2), 위에서 10(pt-[10px]) */}
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
          {/* 날짜와 안 읽음 점은 첫 줄(20) 안에서 세로 가운데 */}
          <div
            className={`flex h-[20px] shrink-0 items-center gap-1.5 ${
              n.read ? "" : "transition-opacity group-hover:opacity-0"
            }`}
          >
            <span className="text-[12px] leading-[16px] text-[rgb(161,158,153)]">
              {fmtDate(n.createdAt, locale)}
            </span>
            {/* 안 읽음: 날짜 **오른쪽**의 파란 점 (예전엔 줄 왼쪽에 있었다) */}
            {!n.read && (
              <span
                data-testid={`inbox-unread-${n.id}`}
                aria-label={t("읽지 않음")}
                className="h-1.5 w-1.5 rounded-full bg-blue-500"
              />
            )}
          </div>
        </div>

        {preview && (
          <p className="mt-px line-clamp-1 text-[14px] leading-[20px] font-normal text-[rgb(125,122,117)] dark:text-neutral-400">
            {/* 원본은 수신함에서도 댓글과 **같은 방식**으로 그린다: 칩이 아니라
                보조색 이름 + 그 색의 60% 로 연한 `@`. 그리는 코드도 같은 것을 쓴다 —
                따로 두었더니 댓글에는 없는 `@단어` 가 수신함에서만 물들었다. */}
            <CommentBody body={preview} members={members} />
          </p>
        )}
      </div>

      {/* 원본은 호버에서 오른쪽에 아이콘 3개(알림 끄기 · 읽음 표시 · 보관)를 낸다.
          우리가 실제로 하는 것은 읽음 표시 하나뿐이라 그것만 둔다. */}
      {!n.read && (
        <button
          data-testid={`inbox-markread-${n.id}`}
          onClick={(e) => {
            e.stopPropagation();
            onMarkRead(n.id);
          }}
          className="absolute top-[8px] right-2 flex h-6 w-6 items-center justify-center rounded-md text-neutral-400 opacity-0 transition-all group-hover:opacity-100 hover:bg-neutral-300/60 hover:text-neutral-600 dark:hover:bg-neutral-600"
          aria-label={t("읽음으로 표시")}
        >
          <Check size={14} />
        </button>
      )}
    </div>
  );
}

/** 시간대 머리로 묶은 목록. 두 껍데기(사이드바 패널 · 옛 팝업)가 같이 쓴다. */
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
 // 한 번만 묻고 행들에 나눠 준다 (행마다 물으면 같은 답을 17번 구독한다)
  const members = useWorkspaceMembers();
  const groups = useMemo(() => groupByDay(items), [items]);

  if (items.length === 0) {
    return <p className="px-3 py-6 text-center text-xs text-neutral-400">{t("아직 알림이 없습니다")}</p>;
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
 * 수신함 패널. 사이드바가 자기 수신함 화면을 켤 때 그린다.
 *
 * **사이드바 안이 아니라 그 옆에 뜬다.** 원본의 폭은 366 인데 사이드바는 270 이라,
 * 사이드바의 자식으로 흐르게 두면 366 이 269 로 눌린다(`max-w-full` 이 그렇게
 * 만든다 — 잰 값이 화면에서는 안 나오던 이유). 그래서 사이드바(`aside.relative`)를
 * 기준으로 `left-full` 에 절대배치해 오른쪽 옆에 띄우고, 폭은 366 그대로 둔다.
 * 테두리를 두지 않는 것도 폭 때문이다: 366 짜리 상자에 테두리를 주면 행이 364 가 된다.
 * 닫기는 X 버튼과 사이드바의 수신함 버튼(토글) 둘 다 — 화면을 덮는 배경막이 없으므로
 * 패널이 열려 있어도 사이드바는 그대로 쓸 수 있다.
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
          {t("수신함")}
        </h2>
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
        aria-label={t("수신함")}
        data-tip={t("수신함")}
       // 28×28 — 원본에서 잰 값(§6). 옆의 탭 알약들은 32 라 이 버튼만 한 치수 작다.
        className={`relative flex h-7 shrink-0 items-center justify-center gap-1.5 rounded-full text-sm font-medium transition-colors ${
          active
            ? `bg-neutral-200/70 text-neutral-800 dark:bg-neutral-700/70 dark:text-neutral-100 ${showLabel ? "px-2.5" : "w-7 shrink-0"}`
            : "w-7 shrink-0 text-neutral-500 hover:bg-neutral-200/60 dark:text-neutral-400 dark:hover:bg-neutral-800"
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
        <div className="fixed inset-0 z-50" onClick={() => setOpen(false)}>
          <div
            data-testid="inbox-panel"
            onClick={(e) => e.stopPropagation()}
            className="absolute bottom-16 left-3 flex max-h-[60vh] w-[366px] flex-col overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-2xl dark:border-neutral-700 dark:bg-neutral-800"
          >
            <div className="flex items-center justify-between border-b border-neutral-100 px-2 py-2 dark:border-neutral-700">
              <h2 className="text-[14px] leading-[20px] font-medium text-[rgb(44,44,43)] dark:text-neutral-200">
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
