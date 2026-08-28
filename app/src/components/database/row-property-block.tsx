"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { DbProperty, DbRow } from "@/lib/db/schema";
import { useDb } from "./database-block";
import { PropertyCell } from "./property-cell";
import { PropertyTypeIcon } from "./property-type-icon";
import { useT } from "@/i18n/provider";
import { PageCommentSection } from "@/components/comments/page-comment-section";

/**
 * The property block of a database row's page — the SAME block whether the
 * row is open as a side peek or as a full page. Measured on the original
 * 2026-08-27 (e2e/fixtures/notion-row-props.json), window 1200:
 *
 *   제목
 *   세부 정보 보기            ← 28px toggle, 4 below the title, 12 + 10 above the band.
 *                             Always drawn on a full page; on a peek it is
 *                             hover-only and pushes the band down when it appears.
 *   TL   Assignee  End date  Evaluation   ← pinned band: label (24px, 13px/500 grey,
 *   ⋯    비어 있음  ⋯         비어 있음         14px type icon) over value (30px, padding
 *                                           5/6, radius 4); items min 80 / max 200,
 *                                           gap 8; sideways scroll with 32px arrows
 *                                           hanging 4px outside the band.
 *   댓글                     ← 24px row, 24 under the band, hairline under the section
 *   (body)                   ← 8px padding-top
 *
 * Every value is the real PropertyCell editor, so a property can be set here —
 * an empty one shows 비어 있음 on top of the (blank) editor and a click lands on
 * the editor. This is what makes Evaluation editable from the page, not just
 * from the table.
 */

/** How many properties sit above the body rather than in the 속성 panel until
 *  someone chooses (레이아웃 사용자 지정). The original pins four
 *  (TL · Assignee · End date · Evaluation). */
export const PINNED_COUNT = 4;

/** Does this cell hold anything? Empty string, empty list and a date object
 *  with no start all count as blank — the same states the table draws as an
 *  empty cell. */
export function hasValue(v: unknown): boolean {
  if (v === null || v === undefined || v === "") return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "object")
    return Object.values(v as Record<string, unknown>).some(
      (x) => x !== null && x !== undefined && x !== ""
    );
  return true;
}

/** Pinned vs the rest. Which properties are pinned is a choice kept on each
 *  property (`config.pinned`); until somebody makes it, the first few stand in.
 *
 *  The band's order is its own (`config.pinnedOrder`), not the property list's:
 *  measured on the original, its band reads TL · Assignee · End date ·
 *  Evaluation while neither the table's columns nor the 속성 panel start there
 *  (e2e/fixtures/notion-row-props-band.json §set). Properties with no order
 *  yet fall back to their position, after the ordered ones. */
export function splitPinned(properties: DbProperty[]): {
  pinned: DbProperty[];
  rest: DbProperty[];
  chosen: boolean;
} {
  const nonTitle = properties.filter((p) => p.type !== "title");
  const chosen = nonTitle.some((p) => p.config?.pinned !== undefined);
  const isPinned = (p: DbProperty, i: number) =>
    chosen ? !!p.config?.pinned : i < PINNED_COUNT;
  const order = (p: DbProperty) =>
    typeof p.config?.pinnedOrder === "number" ? p.config.pinnedOrder : Number.MAX_SAFE_INTEGER;
  const pinned = nonTitle
    .filter(isPinned)
    .map((p, i) => ({ p, i }))
    .sort((a, b) => order(a.p) - order(b.p) || a.i - b.i)
    .map(({ p }) => p);
  return {
    pinned,
    rest: nonTitle.filter((p, i) => !isPinned(p, i)),
    chosen,
  };
}

const LABEL_COLOR = "text-[rgb(125,122,117)] dark:text-neutral-400";

/** 패널 닫기 — the original's button that closes the 속성 panel: 24×24, Notion's
 *  arrowChevronDoubleForward glyph at 20px in rgb(142,139,134), hover wash.
 *  `round` is the full page's (radius 9999); the peek's is a 6px corner. */
export function PanelCloseButton({
  onClick,
  round = false,
  className = "",
  style,
}: {
  onClick: () => void;
  round?: boolean;
  className?: string;
  style?: React.CSSProperties;
}) {
  const t = useT();
  return (
    <button
      type="button"
      data-testid="db-details-close"
      aria-label={t("패널 닫기")}
      onClick={onClick}
      style={style}
      className={`flex h-6 w-6 shrink-0 items-center justify-center text-[rgb(142,139,134)] transition-[background] duration-100 hover:bg-[rgba(33,27,23,0.051)] dark:hover:bg-neutral-800 ${
        round ? "rounded-full" : "rounded-[6px]"
      } ${className}`}
    >
      <svg aria-hidden="true" viewBox="0 0 20 20" width={20} height={20} fill="currentColor">
        <path d="m5.492 4.158 5.4 5.4a.625.625 0 0 1 0 .884l-5.4 5.4a.625.625 0 1 1-.884-.884L9.566 10 4.608 5.042a.625.625 0 1 1 .884-.884" />
        <path d="m16.392 10.442-5.4 5.4a.625.625 0 0 1-.884-.884L15.066 10l-4.958-4.958a.625.625 0 0 1 .884-.884l5.4 5.4a.625.625 0 0 1 0 .884" />
      </svg>
    </button>
  );
}
/** The value cell owns the 5/6 padding; the PropertyCell editor inside keeps
 *  the TABLE's padding and heights (a 37px date button, py-1 on a select) which
 *  would make the cell 34–47px. These strip the editor's own box down to its
 *  content line so the cell measures the original's 30. */
const BARE_EDITOR =
  "[&>div]:w-full [&>div]:p-0 [&>div>button]:h-auto [&>div>button]:min-h-0 [&>div>button]:items-center [&>div>button]:overflow-hidden [&>div>button]:whitespace-nowrap [&>div>button]:p-0 [&>div>input]:p-0 [&>div>textarea]:p-0";
const HOVER_BG = "hover:bg-[rgba(33,27,23,0.051)] dark:hover:bg-neutral-800";

export function RowPropertyBlock({
  row,
  surface,
  detailsOpen,
  onToggleDetails,
  onOpenComments,
  commentsPageId,
  children,
}: {
  row: DbRow;
  surface: "peek" | "full";
  detailsOpen: boolean;
  onToggleDetails: () => void;
  onOpenComments?: () => void;
  /** the page this row opens into — its comments are drawn in the 댓글 section
   *  itself, the way the original does it (not in a docked panel) */
  commentsPageId?: string | null;
  /** the page body — wrapped so it starts where the original's does */
  children?: ReactNode;
}) {
  const db = useDb();
  const t = useT();
  const { pinned } = splitPinned(db.properties);
 // the composer is always drawn; pressing 댓글 just puts the caret in it
  const [focusComposer, setFocusComposer] = useState(false);
  void surface;

  return (
    <>
      <div>
        {/* 세부 정보 보기 / 숨기기 — 4 under the title, 12 of padding below, 28
            tall, always there (the original never hides it, peek or page) */}
        <div className="mt-1 flex gap-1 pb-3">
          <button
            type="button"
            data-testid="row-props-toggle"
            aria-label={t("세부 정보 보기/숨기기")}
            onClick={onToggleDetails}
            className={`inline-flex h-7 items-center whitespace-nowrap rounded-[6px] px-2 text-[14px] leading-[16.8px] text-[rgb(142,139,134)] ${HOVER_BG}`}
          >
            {detailsOpen ? t("세부 정보 숨기기") : t("세부 정보 보기")}
          </button>
        </div>

        <PinnedBand row={row} pinned={pinned} />
      </div>

      {/* 댓글 — its own labelled row 24 under the band, a hairline under the
          section, then the body. The thread itself lives HERE: the original
          keeps a page's comments in the page, between the band and the body,
          and never opens them in a docked panel
          (e2e/fixtures/notion-row-comments.json — inline). */}
      <div
        data-testid="row-props-comments-section"
        className="mt-6 border-b border-[rgba(55,53,47,0.09)] pl-2 dark:border-neutral-800"
      >
        <button
          type="button"
          data-testid="row-props-comments"
          onClick={() => {
            setFocusComposer(true);
            onOpenComments?.();
          }}
          className={`flex h-6 items-center gap-[2px] py-[3px] text-[13px] font-medium leading-[18px] ${LABEL_COLOR}`}
        >
          <span data-role="comments-label">{t("댓글")}</span>
        </button>
        {commentsPageId && (
          <div>
            <PageCommentSection pageId={commentsPageId} autoFocus={focusComposer} />
          </div>
        )}
      </div>
      <div data-testid="row-props-body" className="pt-2">
        {children}
      </div>
    </>
  );
}

function PinnedBand({ row, pinned }: { row: DbRow; pinned: DbProperty[] }) {
  const t = useT();
  const scroller = useRef<HTMLDivElement | null>(null);
  const [edges, setEdges] = useState({ start: true, end: true });

  const measure = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    setEdges({
      start: el.scrollLeft <= 0,
      end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 1,
    });
  }, []);
  useEffect(() => {
    measure();
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure, pinned.length]);

  const arrow = (dir: -1 | 1, hidden: boolean) => (
    <button
      type="button"
      data-role="band-arrow"
      aria-label={dir < 0 ? t("이전 고정된 속성으로 스크롤하기") : t("다음 고정된 속성으로 스크롤하기")}
      aria-hidden={hidden}
      tabIndex={hidden ? -1 : 0}
 // one click moves the band by its visible width less 200 — the step measured
 // on the original (394 wide → 194), clamped by the browser at either end
      onClick={() =>
        scroller.current?.scrollBy({
          left: dir * Math.max(1, scroller.current.clientWidth - 200),
          behavior: "smooth",
        })
      }
      style={{ top: 11.5, [dir < 0 ? "left" : "right"]: -4, opacity: hidden ? 0 : 1 }}
      className={`absolute z-10 flex h-8 w-8 items-center justify-center rounded-[6px] bg-white p-1 text-[rgb(142,139,134)] shadow-[0_0_0_1px_rgba(42,28,0,0.07),0_2px_4px_rgba(0,0,0,0.06)] transition-opacity dark:bg-neutral-900 ${
        hidden ? "pointer-events-none" : ""
      }`}
    >
      {dir < 0 ? <ChevronLeft size={20} /> : <ChevronRight size={20} />}
    </button>
  );

  return (
    <div
      data-pinned-row=""
      data-pinned-layout-mode="scroll"
      data-testid="row-props-band"
      role="group"
      aria-label={t("페이지 속성")}
      className="relative ml-[2px] mt-[10px]"
    >
      <div
        ref={scroller}
        onScroll={measure}
        className="no-native-scrollbar overflow-x-auto"
        style={{ scrollbarWidth: "none" }}
      >
        <div data-role="band-track" className="flex min-w-max flex-row items-stretch gap-2">
          {pinned.map((p) => (
            <PinnedItem key={p.id} prop={p} row={row} collapsePeople />
          ))}
        </div>
      </div>
      {arrow(-1, edges.start)}
      {arrow(1, edges.end)}
    </div>
  );
}

function PinnedItem({
  prop,
  row,
 // the band collapses several people to one chip + `+ N`; the 속성 panel is
 // left as it was — the original was only measured in the band
  collapsePeople,
}: {
  prop: DbProperty;
  row: DbRow;
  collapsePeople?: boolean;
}) {
  const t = useT();
 // computed properties draw their own value from the row itself (createdAt,
 // formulas…), never from row.values — 비어 있음 must not be painted over them
  const COMPUTED = new Set(["created_time", "last_edited_time", "created_by", "last_edited_by", "formula", "rollup"]);
  const empty = !COMPUTED.has(prop.type) && !hasValue(row.values[prop.id]);
  return (
    <div
      data-testid={`row-props-item-${prop.id}`}
      data-type={prop.type}
      className="flex min-w-[80px] max-w-[200px] flex-col"
    >
      <div
        data-role="label"
        className={`flex h-6 w-min max-w-full items-center rounded-[6px] px-1.5 ${LABEL_COLOR}`}
      >
        <div className="flex min-w-0 items-center gap-[2px] text-[13px] font-medium leading-[18px]">
          {/* 14px glyph drawn at 1.2× — the original's `transform: scale(1.2)` */}
          <span
            data-role="icon"
            className="block h-[14px] w-[14px] shrink-0"
            style={{ transform: "scale(1.2)" }}
          >
            <PropertyTypeIcon type={prop.type} size={14} className="text-current" />
          </span>
          <span data-role="label-text" className="truncate">
            {prop.name}
          </span>
        </div>
      </div>
      {/* the value is the real editor; an empty one wears 비어 있음 on top so a
          click still reaches the editor underneath */}
      <div
        data-role="value"
        className={`relative flex min-h-[30px] w-full items-center rounded-[4px] px-1.5 py-[5px] ${HOVER_BG} ${BARE_EDITOR}`}
      >
        <PropertyCell prop={prop} row={row} collapsePeople={collapsePeople} />
        {empty && (
          <span
            data-role="empty"
            className="pointer-events-none absolute left-1.5 top-[5px] whitespace-nowrap text-[14px] leading-5 text-[rgb(161,158,153)]"
          >
            {t("비어 있음")}
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * The 속성 panel that 세부 정보 보기 opens: every non-pinned property, label
 * over value like the band, `footer` (Add a property) at the end. The caller
 * decides where it docks — the peek keeps it inside its own width (380px),
 * the full page hangs a 385px sidebar down the window's right edge.
 */
export function RowDetailsPanel({
  row,
  className = "",
  footer,
  onHoverChange,
  children,
}: {
  row: DbRow;
  className?: string;
  footer?: ReactNode;
  /** the peek shows its 패널 닫기 button only while the panel is hovered */
  onHoverChange?: (hovered: boolean) => void;
  /** drawn inside the panel's box, before the header (the full page's 패널 닫기) */
  children?: ReactNode;
}) {
  const db = useDb();
  const t = useT();
  const { rest } = splitPinned(db.properties);
  return (
    <aside
      data-testid="db-peek-details"
      aria-label={t("속성")}
      onMouseEnter={() => onHoverChange?.(true)}
      onMouseLeave={() => onHoverChange?.(false)}
      className={`overflow-y-auto bg-white dark:bg-[#191919] ${className}`}
    >
      {children}
      {/* 속성 — text 28px in from the panel's edge (20 + 2 + 6 in the original) */}
      <div className={`sticky top-0 z-10 flex h-6 items-center bg-white py-[3px] pl-[7px] text-[13px] font-medium leading-[18px] dark:bg-[#191919] ${LABEL_COLOR}`}>
        <span data-role="panel-title">{t("속성")}</span>
      </div>
      <div className="mt-2 flex flex-col gap-2">
        {rest.map((p) => (
          <PinnedItem key={p.id} prop={p} row={row} />
        ))}
        {footer}
      </div>
    </aside>
  );
}
