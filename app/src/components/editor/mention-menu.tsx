"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useAnchoredAt } from "@/hooks/use-anchored";
import { FileText, Calendar } from "lucide-react";
import { usePagesStore } from "@/stores/pages";
import { PageIcon } from "@/components/page-icon";
import { MonthGrid } from "@/components/database/date-picker";
import { initial } from "@/lib/glyph";
import { useIntlLocale, useT } from "@/i18n/provider";
import { useMe } from "@/stores/me";
import { useWorkspaceMembers } from "@/hooks/use-workspace-members";
import { PEOPLE_SHOWN, rankPeople } from "@/lib/mention/search";

/**
 * The @ menu, at the values measured off Notion's comment composer on
 * 2026-09-10 (docs/notion-comment-mention.md §3·§4,
 * e2e/fixtures/notion-comment-mention.json). Every number below is a
 * measurement — not a preference. `e2e/mention.check.mjs` re-measures ours.
 *
 *   card    330 × max 325, radius 10, white, NO border, scrolls inside
 *   header  12/500 rgb(125,122,117), 14 tall, 12 in from the card, 9 above
 *           the first row (23 from the header's own top), 14 from the card top
 *   row     322 × 28, radius 6, 4 in from each side, pitch 29
 *           avatar 20 at 8, label 14/400 rgb(44,44,43) at 36
 *   page    45 tall — title 14 rgb(44,44,43) over a path 12 rgb(161,158,153)
 *   empty   the card shrinks to 330 × 65 and says 결과 없음 at 12,9
 *
 * Matching and ranking are NOT here: `@/lib/mention/search` holds the rules
 * measured in §2 (substring, case-insensitive, name + email, Korean initial
 * jamo, name-prefix > word-prefix > mid, me first, guests last, five shown)
 * and the server uses the same module to decide who gets notified.
 *
 * Deliberately not copied: Notion's `검색 피드백 보내기` footer link.
 */
const CARD = {
  width: 330,
  maxHeight: 325,
  radius: 10,
  padTop: 14,
 // unmeasured (the original's last row sits at the scroll end); 4 keeps the
 // same 4px gutter the rows have
  padBottom: 4,
  shadow:
    "rgba(25, 25, 25, 0.05) 0px 20px 24px 0px, rgba(25, 25, 25, 0.027) 0px 5px 8px 0px, rgba(42, 28, 0, 0.07) 0px 0px 0px 1px",
} as const;
const HEADER = { height: 14, indent: 12, gapToFirstRow: 9 } as const;
const ROW = { width: 322, height: 28, pageHeight: 45, radius: 6, inset: 4, gap: 1, avatar: 20, avatarLeft: 8 } as const;
const EMPTY = { width: 330, height: 65, left: 12, top: 9 } as const;

export interface MentionItem {
 // "more" is the `N개 결과 더 보기` line. The original treats it as an
 // ordinary row of the flat list, so it is one here too — the menu handles
 // picking it itself (see below), the caller never sees it in `onPick`.
  kind: "page" | "person" | "date" | "more";
  id: string;
  label: string;
  icon?: string | null;
  /** parent page title, shown as secondary text (R2#19) */
  parent?: string;
  /** person rows only: their photo, so a mention shows the same face as everywhere else */
  avatarUrl?: string | null;
  /** person rows only: draws the original's trailing `(나)` */
  isMe?: boolean;
}

/** Builds the inline mention chip's HTML for a picked item. */
export function mentionChipHtml(item: MentionItem, escape: (s: string) => string): string {
  const label = `@${escape(item.label)}`;
  if (item.kind === "page") {
    return `<a href="/p/${item.id}" class="mention" data-mention-type="page" data-mention-id="${item.id}">${label}</a>`;
  }
  return `<span class="mention" data-mention-type="${item.kind}" data-mention-id="${escape(item.id)}">${label}</span>`;
}

/**
 * 질의를 **날짜 표현으로 읽는다** — 읽힐 때만 날짜 섹션이 생긴다.
 *
 * 원본은 `@ye` 에도 날짜 섹션을 보여줬다(§3 의 `@ye` → 사람 → 날짜 →
 * 페이지 링크). 노션이 질의를 날짜식으로 파싱하기 때문이고, `ye` 는
 * `yesterday` 로 읽힌다. 우리가 읽는 것은 아래 낱말(양쪽 언어)의 **앞부분**과
 * `yyyy-mm-dd` 뿐이다 — 원본 파서의 나머지(`next friday`, `jan 5`,
 * `3 days ago` …)는 재 본 적이 없어 지어내지 않는다.
 */
const DATE_WORDS: { words: string[]; offset: number }[] = [
  { words: ["today", "오늘"], offset: 0 },
  { words: ["tomorrow", "내일"], offset: 1 },
  { words: ["yesterday", "어제"], offset: -1 },
];

/** 오늘에서 offset 일. **로컬** 날짜다 — `toISOString` 은 UTC 라 KST 밤에
 *  하루 어긋난 날짜를 멘션하게 된다. */
function isoDay(offset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 질의 → `yyyy-mm-dd`, 날짜로 안 읽히면 null. */
function resolveDate(query: string): string | null {
  const q = query.trim().toLowerCase();
  if (!q) return isoDay(0); // 빈 `@` 는 오늘 (§3: 맨 처음은 날짜 → 사람 → …)
  if (/^\d{4}-\d{2}-\d{2}$/.test(q)) return q;
  for (const g of DATE_WORDS) if (g.words.some((w) => w.startsWith(q))) return isoDay(g.offset);
  return null;
}

/** Build a date mention for an ISO (yyyy-mm-dd) date string. */
function dateItem(iso: string, locale: string): MentionItem {
 // parse as local date (avoid the UTC shift of new Date("yyyy-mm-dd"))
  const [y, m, d] = iso.split("-").map(Number);
  const label = new Date(y, (m ?? 1) - 1, d ?? 1).toLocaleDateString(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
  return { kind: "date", id: iso, label };
}

/** @-mention popup: pages (from the tree), people (workspace members), and a date. */
export function MentionMenu({
  anchor,
  query,
  selectedIndex,
  onItems,
  onPick,
  onHover,
  portal,
}: {
  anchor: { x: number; y: number };
  query: string;
  selectedIndex: number;
  /** the FLAT list, in drawn order — the caller drives ↓/↑/Enter on it */
  onItems: (items: MentionItem[]) => void;
  onPick: (item: MentionItem) => void;
  /** move the highlight with the pointer (the original highlights on hover too) */
  onHover?: (index: number) => void;
  /** render through a portal — for a composer inside another popover */
  portal?: boolean;
}) {
  const t = useT();
  const intl = useIntlLocale();
 // the mini calendar, held as the query it was opened for — the same trick
 // `expandedFor` uses below, so a new query folds it back (and it cannot be
 // left open on a query that has no 날짜 section to hang it on)
  const [calFor, setCalFor] = useState<string | null>(null);
  const calOpen = calFor === query;
  const pages = usePagesStore((s) => s.pages);
  const me = useMe();
 // true: ask again as the menu opens — see the hook for why a cached list can
 // be the wrong workspace's
  const members = useWorkspaceMembers(true);
 // `N개 결과 더 보기` opens the rest in place — held as the query it was
 // pressed for, so a new query folds the list back with no effect to run
  const [expandedFor, setExpandedFor] = useState<string | null>(null);
  const expanded = expandedFor === query;

  const sections = useMemo(() => {
    const q = query.trim().toLowerCase();

 // people — ranked by the measured rules, five shown, the rest folded into
 // one row (§2). rankPeople is the shared implementation; do not re-filter.
    const ranked = rankPeople(members ?? [], query, me?.id ?? null, expanded ? Number.MAX_SAFE_INTEGER : PEOPLE_SHOWN);
    const personItems: MentionItem[] = ranked.shown.map((p) => ({
      kind: "person" as const,
      id: p.id,
      label: p.displayName,
      avatarUrl: p.avatarUrl,
      isMe: me?.id === p.id,
    }));
    if (ranked.more > 0) {
      personItems.push({ kind: "more", id: "more", label: t("{n}개 결과 더 보기", { n: ranked.more }) });
    }

 // most recently edited first — on a big workspace the fresh
 // page you mean must not fall out of the visible slice
    const pageItems: MentionItem[] = Object.values(pages)
      .sort(
        (a, b) =>
          new Date(b.updatedAt ?? 0).getTime() - new Date(a.updatedAt ?? 0).getTime()
      )
      .map((p) => ({
        kind: "page" as const,
        id: p.id,
        label: p.title || t("제목 없음"),
        icon: p.icon,
        parent: p.parentPageId ? (pages[p.parentPageId]?.title || t("제목 없음")) : undefined,
      }))
      .filter((it) => !q || it.label.toLowerCase().includes(q))
      .slice(0, 6);

 // 날짜 — 질의를 날짜 표현으로 읽어 나오면 한 줄, 안 나오면 섹션이 없다
    const iso = resolveDate(query);
    const dateItems: MentionItem[] = iso ? [dateItem(iso, intl)] : [];

    const date = { key: "date", label: t("날짜"), items: dateItems };
    const people = { key: "person", label: t("사람"), items: personItems };
    const page = { key: "page", label: t("페이지 링크"), items: pageItems };
 // "섹션 순서는 고정이 아니다" (§3): bare @ opens 날짜 → 사람 → 페이지 링크,
 // but a query that matches people puts them on top (measured with @ye).
 // 그룹 is a section we have no entity for.
    const order = q && personItems.length ? [people, date, page] : [date, people, page];
    return order.filter((s) => s.items.length > 0);
  }, [query, pages, members, me, expanded, t, intl]);

  const items = useMemo(() => sections.flatMap((s) => s.items), [sections]);
  const indexOf = useMemo(() => new Map(items.map((it, i) => [it, i])), [items]);

  useEffect(() => {
    onItems(items);
  }, [items, onItems]);

  const wrap = useRef<HTMLDivElement>(null);
  useAnchoredAt(true, anchor, wrap);

 // The `N개 결과 더 보기` row belongs to the menu, not to whoever opened it:
 // the caller owns the caret and so drives Enter, but it must not be handed a
 // row that is not a mention (block-editor would insert a chip for it). We
 // take that one keypress back on the window, in the capture phase, so it
 // never reaches the caller — window is above `document`, where a surface's
 // own Escape/dismiss listeners live.
  const moreHighlighted = items[selectedIndex]?.kind === "more";
  useEffect(() => {
    if (!moreHighlighted) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Enter" || e.isComposing) return;
      e.preventDefault();
      e.stopPropagation();
      setExpandedFor(query);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [moreHighlighted, query]);

  function pick(item: MentionItem) {
    if (item.kind === "more") {
      setExpandedFor(query);
      return;
    }
    onPick(item);
  }

  const card =
    items.length === 0 ? (
      <div
        data-testid="mention-menu"
        style={{
          width: EMPTY.width,
          height: EMPTY.height,
          paddingTop: EMPTY.top,
          paddingLeft: EMPTY.left,
          borderRadius: CARD.radius,
          boxShadow: CARD.shadow,
        }}
        className="bg-white dark:bg-neutral-800"
      >
        <div
          data-testid="mention-empty"
          className="text-[14px] font-normal leading-5 text-[rgb(125,122,117)]"
        >
          {t("결과 없음")}
        </div>
      </div>
    ) : (
      <div
        data-testid="mention-menu"
        style={{
          width: CARD.width,
          maxHeight: CARD.maxHeight,
          paddingTop: CARD.padTop,
          paddingBottom: CARD.padBottom,
          borderRadius: CARD.radius,
          boxShadow: CARD.shadow,
          overflowY: "auto",
 // the rows are a measured 322 wide; when the thin scrollbar takes its 8px
 // they lose their right gutter rather than growing a second, sideways bar
          overflowX: "hidden",
        }}
        className="bg-white dark:bg-neutral-800"
      >
        {sections.map((sec, si) => (
          <div key={sec.key} style={si === 0 ? undefined : { marginTop: CARD.padTop }}>
            {/* the leaf <span> is what carries the measured type, so the
                header's own box can hold the 12px indent */}
            <div className="flex items-center" style={{ height: HEADER.height, paddingLeft: HEADER.indent, marginBottom: HEADER.gapToFirstRow }}>
              <span className="text-[12px] font-medium leading-[14px] text-[rgb(125,122,117)]">
                {sec.label}
              </span>
            </div>
            {sec.items.map((item) => {
              const i = indexOf.get(item) ?? 0;
              const selected = i === selectedIndex;
              return (
                <button
                  key={`${item.kind}-${item.id}`}
                  type="button"
                  data-testid={item.kind === "more" ? "mention-more" : `mention-item-${item.kind}-${item.id}`}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pick(item);
                  }}
                  onMouseEnter={() => onHover?.(i)}
                  style={{
                    width: ROW.width,
                    height: item.kind === "page" ? ROW.pageHeight : ROW.height,
                    marginLeft: ROW.inset,
                    marginRight: ROW.inset,
                    marginBottom: ROW.gap,
                    borderRadius: ROW.radius,
                    paddingLeft: ROW.avatarLeft,
                    paddingRight: ROW.avatarLeft,
                  }}
                  className={`flex items-center text-left ${
                    selected
                      ? "bg-[rgba(33,27,23,0.051)] dark:bg-white/10"
                      : "hover:bg-[rgba(33,27,23,0.051)] dark:hover:bg-white/10"
                  }`}
                >
                  {/* 20×20 at 8 — a box of its own so it measures the same
                      whether the person has a photo, an initial or an icon,
                      and it is drawn for EVERY row: `N개 결과 더 보기` carries
                      no icon but its label must still start at the measured
                      36 (§3) = 8 + this 20 + 8 */}
                  <span
                    data-avatar=""
                    style={{ width: ROW.avatar, height: ROW.avatar }}
                    className="flex shrink-0 items-center justify-center text-[rgb(142,139,134)]"
                  >
                    {item.kind === "more" ? null : item.kind === "person" ? (
                      item.avatarUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={item.avatarUrl}
                          alt=""
                          style={{ width: ROW.avatar, height: ROW.avatar }}
                          className="rounded-full object-cover"
                        />
                      ) : (
                       // The letter of a photo-less face is decoration — the
                       // row's TEXT is the person's name and nothing else, or
                       // a reader (and anything reading innerText) hears
                       // "K Kim San". So it is drawn as ::before content,
                       // which is not in the DOM's text.
                        <span
                          data-initial={initial(item.label)}
                          aria-hidden="true"
                          style={{ width: ROW.avatar, height: ROW.avatar }}
                          className="flex items-center justify-center rounded-full bg-neutral-200 text-[10px] font-medium text-neutral-600 before:content-[attr(data-initial)] dark:bg-neutral-700 dark:text-neutral-300"
                        />
                      )
                    ) : item.kind === "page" ? (
                      item.icon ? <span className="text-base"><PageIcon icon={item.icon} /></span> : <FileText size={16} />
                    ) : (
                      <Calendar size={16} />
                    )}
                  </span>
                  <span className="min-w-0 flex-1" style={{ marginLeft: 8 }}>
                    <span className="block truncate text-[14px] font-normal leading-[18px] text-[rgb(44,44,43)] dark:text-neutral-200">
                      {item.label}
                      {item.isMe && (
                        <span className="ml-1 text-[14px] font-normal text-[rgb(125,122,117)]">{t("(나)")}</span>
                      )}
                    </span>
                    {item.kind === "page" && item.parent && (
                      <span className="block truncate text-[12px] font-normal leading-[15px] text-[rgb(161,158,153)]">
                        {item.parent}
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
            {/* pick ANY date — a typed field plus a toggleable mini
                calendar. Ours, not the original's, so it hangs off the 날짜
                section and is drawn ONLY where that section is: sitting at the
                bottom of the card it added 37px to EVERY menu, and §3 says a
                card is as tall as its rows. */}
            {sec.key === "date" && (
              <div className="mt-1 px-3 py-1.5" onMouseDown={(e) => e.stopPropagation()}>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    data-testid="mention-date-calendar"
                    onClick={() => setCalFor((v) => (v === query ? null : query))}
                    aria-label={t("달력에서 선택")}
                    className="shrink-0 rounded p-0.5 text-[rgb(142,139,134)] hover:bg-[rgba(33,27,23,0.051)] dark:hover:bg-white/10"
                  >
                    <Calendar size={15} />
                  </button>
                  <input
                    type="date"
                    data-testid="mention-date-input"
                    onChange={(e) => {
                      if (e.target.value) onPick(dateItem(e.target.value, intl));
                    }}
                    className="flex-1 bg-transparent text-[14px] text-[rgb(44,44,43)] outline-none dark:text-neutral-200"
                  />
                </div>
                {calOpen && (
                  <div className="mt-1">
                    <MonthGrid idBase="mention" selected="" onPick={(d) => onPick(dateItem(d, intl))} />
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    );

  const shell = (
    <div
      ref={wrap}
      className="popover-anim fixed z-50"
 // placed by useAnchoredAt: below the caret, above it when the window's bottom
 // is too close (this list ran 250px off the screen there). The card inside
 // keeps its own measured max-height — the hook writes one onto THIS box.
      style={{ visibility: "hidden", width: CARD.width }}
    >
      {card}
    </div>
  );

  return portal && typeof document !== "undefined" ? createPortal(shell, document.body) : shell;
}
