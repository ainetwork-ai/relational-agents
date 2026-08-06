"use client";

import { useEffect, useRef, useState } from "react";
import {
  X,
  Maximize2,
  ChevronUp,
  ChevronDown,
  Star,
  Plus,
  MessageSquare,
} from "lucide-react";
import { useRouter } from "next/navigation";
import type { Block, Page } from "@/lib/db/schema";
import { useDb } from "./database-block";
import { PropertyCell } from "./property-cell";
import { BlockEditor } from "@/components/editor/block-editor";
import { IconPicker } from "@/components/page/icon-picker";
import { SharePopover } from "@/components/page/share-popover";
import { PageOptionsMenu } from "@/components/page/page-options";
import { CopyLinkButton, CoverControls, editedAgo } from "@/components/page/page-view";
import { CommentThreadPanel } from "@/components/comments/comment-thread-panel";
import { useCommentUi, PAGE_ANCHOR } from "@/stores/comment-ui";
import { usePagesStore } from "@/stores/pages";

const MIN_WIDTH = 420;
const DEFAULT_FRACTION = 0.51; // what the capture's 861px is of its window

/** How many properties sit above the body rather than in the 속성 panel. The
 *  original pins four (TL · Assignee · End date · Evaluation). */
const PINNED_COUNT = 4;

/** Does this cell hold anything? Empty string, empty list and a date object
 *  with no start all count as blank — the same states the table draws as an
 *  empty cell. */
function hasValue(v: unknown): boolean {
  if (v === null || v === undefined || v === "") return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "object")
    return Object.values(v as Record<string, unknown>).some((x) => x !== null && x !== undefined && x !== "");
  return true;
}

/**
 * A database row opened as a page, in Notion's SIDE PEEK: a panel docked to the
 * right edge for the window's full height, resizable by its left edge, with the
 * table still visible (and unclouded — a side peek dims nothing) behind it.
 *
 * Modelled on docs/database_tableview_newpage.html: 닫기 · 전체 페이지로 열기 ·
 * 이전/다음 페이지 on the left of the header, 공유 · 링크 복사 · 즐겨찾기 · 작업 on the
 * right; then 아이콘 추가 / 커버 추가, a 32px title, the row's properties with
 * Add a property, a 댓글 section, and the page body.
 */
export function RowPeek({
  rowId,
  onClose,
  autoFocusTitle,
}: {
  rowId: string;
  onClose: () => void;
 // set when the peek was opened by creating the row: the original lands you in
 // the title with the caret already there, ready to be named
  autoFocusTitle?: boolean;
}) {
  const db = useDb();
  const router = useRouter();
  const row = db.rows.find((r) => r.id === rowId);
  const titleProp = db.properties.find((p) => p.type === "title");
  const bodyPageId = typeof row?.values["__page"] === "string" ? row.values["__page"] : null;
  const [loaded, setLoaded] = useState<{
    pageId: string;
    page: Page | null;
    blocks: Block[];
  } | null>(null);
 // derived, not reset in an effect: stepping to the next entry must not show
 // the previous one's body for a frame — and must never hand the editor blocks
 // that belong to another page
  const fetched = loaded && loaded.pageId === bodyPageId ? loaded : null;
  const blocks = fetched?.blocks ?? null;
 // How the original lays a row's page out (measured 2026-08-06 by creating a
 // row in it and capturing: docs/database_tableview_newpage2.html and
 // …_details.html, plus screenshots of the collapsed state):
 //
 //   신규 프로젝트            ← title, placeholder is 신규 + the item name
 //   세부 정보 보기            ← toggle
 //   TL   Assignee   End date   Evaluation      ← a few pinned properties,
 //   비어 있음 비어 있음 비어 있음  비어 있음          side by side, label over value
 //   댓글
 //   (body)
 //
 // and 세부 정보 보기 opens a 380px panel down the peek's right edge headed 속성,
 // holding every other property plus Add a property. Nothing is hidden for
 // being empty — the split is pinned vs not.
 //
 // An earlier pass here read the FIRST capture of this screen as "a new row
 // shows no properties at all" and hid the empty ones. That capture had been
 // saved before the properties rendered; the live original shows them.
  const [detailsOpen, setDetailsOpen] = useState(false);
  const nonTitle = db.properties.filter((p) => p.type !== "title");
 // Which four are pinned is a per-database layout in the original (레이아웃
 // 사용자 지정 — TL, Assignee, End date, Evaluation there). We have no such
 // setting yet, so the first four columns stand in for it.
  const pinnedProps = nonTitle.slice(0, PINNED_COUNT);
  const restProps = nonTitle.slice(PINNED_COUNT);
 // the store carries live edits (favourite, icon, cover) for pages it knows
  const storePage = usePagesStore((s) => (bodyPageId ? s.pages[bodyPageId] : undefined));
  const updatePage = usePagesStore((s) => s.updatePage);
  const openComments = useCommentUi((s) => s.open);
  const page = storePage ?? fetched?.page ?? null;

 // Width: the capture's 861px is ~51% of its window. Remembered per browser,
 // like the sidebar's.
  const [width, setWidth] = useState<number | null>(null);
  useEffect(() => {
 // deferred so no setState runs synchronously in the effect body (the same
 // shape the sidebar uses to restore its own remembered width)
    void Promise.resolve().then(() => {
      const saved = Number(localStorage.getItem("row-peek-width"));
      const max = window.innerWidth - 120;
      setWidth(
        saved >= MIN_WIDTH && saved <= max
          ? saved
          : Math.max(MIN_WIDTH, Math.round(window.innerWidth * DEFAULT_FRACTION))
      );
    });
  }, []);
  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    const move = (ev: PointerEvent) => {
      const next = Math.min(window.innerWidth - 120, Math.max(MIN_WIDTH, window.innerWidth - ev.clientX));
      setWidth(next);
      try {
        localStorage.setItem("row-peek-width", String(next));
      } catch {}
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  useEffect(() => {
    if (!bodyPageId) return;
    let alive = true;
    void Promise.all([
      fetch(`/api/pages/${bodyPageId}`).then((r) => (r.ok ? r.json() : null)),
      fetch(`/api/pages/${bodyPageId}/blocks`).then((r) => (r.ok ? r.json() : { blocks: [] })),
    ]).then(([p, b]) => {
      if (!alive) return;
      setLoaded({ pageId: bodyPageId, page: p?.page ?? null, blocks: b?.blocks ?? [] });
    });
    return () => {
      alive = false;
    };
  }, [bodyPageId]);

  useEffect(() => {
 // the editor consumes Escape for its own layers (slash menu, block
 // selection) and preventDefaults it — one Escape must not also close the peek
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

 // 이전 / 다음 페이지 — step through the rows the way the view lists them.
 // Template rows are definitions, not entries, so they are not stops.
  const stops = db.rows.filter((r) => !r.values.__template);
  const at = stops.findIndex((r) => r.id === rowId);
  const prev = at > 0 ? stops[at - 1] : null;
  const next = at >= 0 && at < stops.length - 1 ? stops[at + 1] : null;

  if (!row) return null;

  return (
 // No scrim: a side peek leaves the page it sits over legible (the centre
 // peek is the one that dims). The full-screen layer only catches the click
 // that dismisses it.
    <div className="fixed inset-0 z-50" onClick={onClose}>
      <div
        data-testid="db-row-peek"
        role="region"
        aria-label="사이드 보기"
        onClick={(e) => e.stopPropagation()}
        style={width ? { width } : { width: `${DEFAULT_FRACTION * 100}%` }}
        className="peek-anim-right absolute bottom-0 right-0 top-0 flex flex-col overflow-hidden rounded-tl-xl border-l border-neutral-200 bg-white shadow-2xl dark:border-neutral-700 dark:bg-[#191919]"
      >
        <div
          data-testid="db-row-peek-resize"
          onPointerDown={startResize}
          role="separator"
          aria-orientation="vertical"
          aria-label="왼쪽 및 오른쪽 방향키로 크기 조정"
          className="absolute inset-y-0 left-0 z-10 w-3 cursor-col-resize hover:bg-blue-300/40"
        />

        <div className="flex h-11 shrink-0 items-center justify-between gap-1 pl-4 pr-2.5">
          <div className="flex items-center gap-0.5">
            <PeekButton testid="db-peek-close" label="닫기" onClick={onClose}>
              <X size={16} />
            </PeekButton>
            {bodyPageId && (
              <PeekButton
                testid="db-peek-open-full"
                label="전체 페이지로 열기"
                onClick={() => router.push(`/p/${bodyPageId}`)}
              >
                <Maximize2 size={14} />
              </PeekButton>
            )}
            <span
              aria-hidden="true"
              className="mx-1 h-3.5 w-px shrink-0 bg-neutral-200 dark:bg-neutral-700"
            />
            <PeekButton
              testid="db-peek-prev"
              label="이전 페이지"
              disabled={!prev}
              onClick={() => prev && db.openRow(prev.id)}
            >
              <ChevronUp size={16} />
            </PeekButton>
            <PeekButton
              testid="db-peek-next"
              label="다음 페이지"
              disabled={!next}
              onClick={() => next && db.openRow(next.id)}
            >
              <ChevronDown size={16} />
            </PeekButton>
          </div>
          <div className="flex items-center gap-0.5">
            {/* the capture keeps the edit stamp here, left of 공유 */}
            {page && editedAgo(page.updatedAt) && (
              <span
                data-testid="db-peek-edited-ago"
                suppressHydrationWarning
                className="mr-1 hidden text-xs text-neutral-400 sm:block"
              >
                {editedAgo(page.updatedAt)}
              </span>
            )}
            {bodyPageId && <SharePopover pageId={bodyPageId} />}
            {bodyPageId && <CopyLinkButton pageId={bodyPageId} />}
            {page && bodyPageId && (
              <PeekButton
                testid="db-peek-favorite"
                label={page.isFavorite ? "즐겨찾기에서 제거" : "즐겨찾기"}
                onClick={() => updatePage(bodyPageId, { isFavorite: !page.isFavorite })}
              >
                <Star
                  size={15}
                  className={page.isFavorite ? "fill-yellow-400 text-yellow-500" : undefined}
                />
              </PeekButton>
            )}
            {page && <PageOptionsMenu page={page} />}
          </div>
        </div>

        {/* body beside the 속성 panel: the peek keeps its width, so opening the
            panel narrows the page column rather than widening the peek */}
        <div className="flex min-h-0 flex-1">
        <div className="flex-1 overflow-y-auto pb-[120px]">
          {page?.coverUrl && bodyPageId && (
            <CoverControls
              coverUrl={page.coverUrl}
              onSet={(url) => updatePage(bodyPageId, { coverUrl: url })}
            />
          )}
          <div className="group/peekhead px-10">
            {page?.icon && bodyPageId && (
              <div className={page.coverUrl ? "-mt-8" : "pt-8"}>
                <IconPicker
                  icon={page.icon}
                  allowImage
                  triggerClassName="rounded-md p-1 text-5xl leading-none transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-800"
                  onChange={(icon) => updatePage(bodyPageId, { icon })}
                />
              </div>
            )}
            {/* 아이콘 추가 · 커버 추가 — the same hover row a page has, minus 설명
                (a description belongs to the database, not to one of its rows) */}
            {bodyPageId && (
              <div
                className={`flex items-center gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover/peekhead:opacity-100 ${
                  page?.icon ? "pt-1" : page?.coverUrl ? "pt-2" : "pt-8"
                }`}
              >
                {!page?.icon && (
                  <IconPicker
                    icon={null}
                    allowImage
                    placeholder={<span className="text-sm text-neutral-400">😀 아이콘 추가</span>}
                    triggerClassName="rounded px-1.5 py-0.5 transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-800"
                    onChange={(icon) => updatePage(bodyPageId, { icon })}
                  />
                )}
                {!page?.coverUrl && (
                  <CoverControls
                    coverUrl={null}
                    onSet={(url) => updatePage(bodyPageId, { coverUrl: url })}
                  />
                )}
                {/* In the capture, beside 커버 추가. It is what chooses which
                    properties are pinned; we have no such setting yet, so it
                    shows disabled rather than being quietly absent. */}
                <button
                  data-testid="db-peek-customize-layout"
                  disabled
                  aria-disabled="true"
                  data-tip="아직 만들지 않았습니다"
                  className="flex cursor-not-allowed items-center gap-1 rounded px-1.5 py-0.5 text-sm text-neutral-300 dark:text-neutral-600"
                >
                  레이아웃 사용자 지정
                </button>
              </div>
            )}

            {/* The title is the row's title PROPERTY (the table shows the same
                value), rendered as a page title rather than as a cell. */}
            {titleProp && (
              <PeekTitle
                value={String(row.values[titleProp.id] ?? "")}
                autoFocus={autoFocusTitle}
 // 신규 + what one row is called: the original's Projects reads 신규 프로젝트
                placeholder={`신규 ${db.itemName.replace(/^새\s*/, "")}`}
                onCommit={(v) => db.updateRow(rowId, { [titleProp.id]: v })}
              />
            )}

            {/* 세부 정보 보기 / 숨기기 — the original's toggle, directly under
                the title (docs/database_tableview_newpage_details.html). */}
            <button
              data-testid="db-peek-details-toggle"
              onClick={() => setDetailsOpen((v) => !v)}
              className={`mt-1 rounded px-1.5 py-0.5 text-[13px] leading-[18px] transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-800 ${
                detailsOpen
                  ? "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"
                  : "text-neutral-500 dark:text-neutral-400"
              }`}
            >
              {detailsOpen ? "세부 정보 숨기기" : "세부 정보 보기"}
            </button>

            {/* The pinned band: a few properties laid out side by side, label
                over value, scrolling sideways rather than wrapping
                (`data-pinned-row` … `min-width: max-content` in the capture).
                Everything else lives in the 속성 panel. */}
            <div
              data-pinned-row=""
              data-testid="db-peek-props"
              role="group"
              aria-label="페이지 속성"
              className="no-native-scrollbar mt-2.5 overflow-x-auto"
              style={{ scrollbarWidth: "none" }}
            >
              <div className="flex min-w-max flex-row items-stretch gap-2">
                {pinnedProps.map((p) => (
                  <div key={p.id} data-testid={`db-peek-pinned-${p.id}`} className="min-w-[120px] px-1.5">
                    <div className="truncate text-sm text-neutral-400">{p.name}</div>
                    <div className="mt-0.5 min-w-0">
                      {hasValue(row.values[p.id]) ? (
                        <PropertyCell prop={p} row={row} />
                      ) : (
                        <span className="text-sm text-neutral-300 dark:text-neutral-600">
                          비어 있음
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* 댓글 — its own labelled section between the properties and the
                body, where the capture has it. */}
            {bodyPageId && (
              <div className="mt-3 border-t border-neutral-100 pt-2 dark:border-neutral-800">
                <button
                  data-testid="db-peek-comments"
                  onClick={() => openComments(PAGE_ANCHOR)}
                  className="flex items-center gap-1.5 rounded px-1 py-0.5 text-[13px] font-medium leading-[18px] text-neutral-500 transition-colors hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800"
                >
                  <MessageSquare size={14} /> 댓글
                </button>
              </div>
            )}

            <div className="mt-2">
              {bodyPageId && blocks ? (
                // keyed: the editor seeds its state from initialBlocks once, so
                // a new entry needs a new instance
                <BlockEditor
                  key={bodyPageId}
                  pageId={bodyPageId}
                  initialBlocks={blocks}
                  emptyVariant="row"
                />
              ) : (
                <div className="h-16 animate-pulse rounded bg-neutral-100 dark:bg-neutral-800" />
              )}
            </div>
          </div>
        </div>
        {detailsOpen && (
          <aside
            data-testid="db-peek-details"
            aria-label="속성"
 // 380px, fixed, its own scroller, a hairline down its leading edge — the
 // capture's `width: 380px; flex-shrink: 0; border-inline-start: 1px`. The peek
 // itself keeps its width, so the page column narrows rather than the panel
 // hanging outside.
            className="w-[380px] shrink-0 overflow-y-auto border-l border-neutral-200 pb-6 pl-5 pr-4 dark:border-neutral-700"
          >
            <div className="sticky top-0 bg-white py-2 text-[13px] font-medium leading-[18px] text-neutral-500 dark:bg-[#191919] dark:text-neutral-400">
              속성
            </div>
            <div className="space-y-0.5">
              {restProps.map((p) => (
                <div key={p.id} className="flex items-start gap-2">
                  <span className="mt-1.5 w-32 shrink-0 truncate text-sm text-neutral-400">
                    {p.name}
                  </span>
                  <div className="min-w-0 flex-1">
                    {hasValue(row.values[p.id]) ? (
                      <PropertyCell prop={p} row={row} />
                    ) : (
                      <div className="px-1.5 py-1">
                        <span className="text-sm text-neutral-300 dark:text-neutral-600">
                          비어 있음
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {/* Present but inert: adding a property from here is not built
                  yet, and a button that silently does nothing is worse than one
                  that says so. */}
              <button
                data-testid="db-peek-add-prop"
                disabled
                aria-disabled="true"
                data-tip="아직 만들지 않았습니다"
                className="flex h-[34px] cursor-not-allowed items-center gap-1.5 rounded px-1.5 text-sm text-neutral-300 dark:text-neutral-600"
              >
                <Plus size={14} /> Add a property
              </button>
            </div>
          </aside>
        )}
        </div>
        {bodyPageId && <CommentThreadPanel pageId={bodyPageId} />}
      </div>
    </div>
  );
}

/** The row's title, at page scale (32px/700 in the capture) with Notion's
 *  placeholder. Not PropertyCell: a table cell is 14px by design. */
function PeekTitle({
  value,
  onCommit,
  autoFocus,
  placeholder,
}: {
  value: string;
  onCommit: (v: string) => void;
  autoFocus?: boolean;
  placeholder: string;
}) {
  const [draft, setDraft] = useState(value);
  const seen = useRef(value);
  const ref = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (value !== seen.current) {
      seen.current = value;
      setDraft(value);
    }
  }, [value]);
 // 새 프로젝트 → the caret is already in the title, so the name can just be
 // typed. Only on creation: focusing a row you opened to read would steal the
 // caret from the page body.
  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);
  return (
    <input
      ref={ref}
      data-testid="db-peek-title"
      value={draft}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => draft !== value && onCommit(draft)}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
      className="mt-2 w-full bg-transparent text-[32px] font-bold leading-tight text-neutral-900 outline-none placeholder:text-neutral-300 dark:text-neutral-100 dark:placeholder:text-neutral-600"
    />
  );
}

function PeekButton({
  testid,
  label,
  onClick,
  disabled,
  children,
}: {
  testid: string;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      data-testid={testid}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      data-tip={label}
      className="flex h-7 w-7 items-center justify-center rounded text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-700 disabled:opacity-30 disabled:hover:bg-transparent dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
    >
      {children}
    </button>
  );
}
