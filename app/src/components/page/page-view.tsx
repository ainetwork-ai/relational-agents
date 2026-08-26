"use client";

import { CommentIcon, EmojiFaceIcon, PhotoIcon } from "@/components/icons/page-controls";
import { useEffect, useRef, useState } from "react";
import type { Block, Page } from "@/lib/db/schema";
import { usePagesStore } from "@/stores/pages";
import { useDebounced } from "@/hooks/use-debounced";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { IconPicker } from "./icon-picker";
import { BlockEditor, type BlockEditorHandle } from "@/components/editor/block-editor";
import { SharePopover } from "./share-popover";
import { MessageSquare, Link2, Check, Lock as LockIcon, Maximize2, X } from "lucide-react";
import { PageIcon } from "@/components/page-icon";
import { PageOptionsMenu } from "./page-options";
import { ReadOnlyBlocks } from "@/components/read-only-blocks";
import { CommentThreadPanel } from "@/components/comments/comment-thread-panel";
import { useCommentUi, PAGE_ANCHOR } from "@/stores/comment-ui";
import { copyText } from "@/lib/compat";
import { domToPlainText, plainTextToLinkedHtml } from "@/lib/rich-text";
import { uploadBlob } from "@/lib/upload";
import { Breadcrumbs } from "./breadcrumbs";
import { RowPropertiesPanel } from "@/components/database/row-properties";
import { DatabaseBlock } from "@/components/database/database-block";
import { PresenceBar } from "@/components/presence/presence-bar";
import { LiveCursors } from "@/components/presence/live-cursors";
import { usePresence } from "@/hooks/use-presence";
import { useRecentsStore } from "@/stores/recents";

export function PageView({
  initialPage,
  initialBlocks,
  wide = false,
  peek,
}: {
  initialPage: Page;
  initialBlocks: Block[];
  /** database pages render near-full-width , not the 836px column */
  wide?: boolean;
  /** Rendered inside the center peek popup (PagePeek): the header trades the
   *  breadcrumb trail for Notion's destination line — ⤢ 전체 페이지로 열기, then
   *  "추가 대상 🏠 <parent>" — and gains a ✕. */
  peek?: { parent: Page | null; onClose: () => void };
}) {
  const router = useRouter();
  const storePage = usePagesStore((s) => s.pages[initialPage.id]);
  const updatePage = usePagesStore((s) => s.updatePage);
  const openComments = useCommentUi((s) => s.open);
  const page = storePage ?? initialPage;
  const { self, others } = usePresence(initialPage.id);

 // record this visit for Quick Find's "recently opened" list
  const recordRecent = useRecentsStore((s) => s.record);
  useEffect(() => {
    recordRecent(initialPage.id);
  }, [initialPage.id, recordRecent]);

 // Remember and restore the scroll position per page, so navigating back
 // returns to where the reader left off. Restore retries briefly
 // because block content can grow the scroll height after mount.
  const isPeek = !!peek;
  useEffect(() => {
 // A peek scrolls inside its own panel — touching <main> here would move the
 // page UNDER the popup and store its offset against the peeked page's key.
    if (isPeek) return;
    const main = document.querySelector('main[aria-label="Page content"]');
    if (!(main instanceof HTMLElement)) return;
    const key = `scroll:${initialPage.id}`;
    const saved = Number(sessionStorage.getItem(key) ?? 0);
    let tries = 0;
    let raf = 0;
    const restore = () => {
      if (saved > 0 && main.scrollHeight - main.clientHeight >= saved) {
        main.scrollTop = saved;
      } else if (saved > 0 && ++tries < 600) {
        raf = requestAnimationFrame(restore);
        return;
      }
    };
    raf = requestAnimationFrame(restore);
    const onScroll = () => {
 // navigating away clamps main.scrollTop to 0 BEFORE this passive
 // effect's cleanup runs — don't let that clobber the saved position
      if (!location.pathname.includes(initialPage.id)) return;
      sessionStorage.setItem(key, String(Math.round(main.scrollTop)));
    };
    main.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      main.removeEventListener("scroll", onScroll);
    };
  }, [initialPage.id, isPeek]);

 // Parent renders <PageView key={page.id}>, so navigation remounts and
 // resets this state naturally.
  const [title, setTitle] = useState(initialPage.title);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const editorRef = useRef<BlockEditorHandle>(null);
  // A page whose body IS a database: its title is the database's name, so the
  // placeholder says so and the save writes both. Notion has one object here;
  // we have two rows and have to keep them in step.
  const fullPageDb = initialBlocks.find(
    (b) => b.type === "database" && (b.content as { fullPage?: boolean }).fullPage
  );
  const databaseId = (fullPageDb?.content as { databaseId?: string } | undefined)?.databaseId;

 // 설명 — a database page's own text under the title (Notion's collection
 // description), not a block: it lives on the database row, so the block editor
 // never sees it and the view tabs sit below it.
  const [desc, setDesc] = useState("");
  const [descShown, setDescShown] = useState(false);
  const [descLoaded, setDescLoaded] = useState(false);
  const descRef = useRef<HTMLDivElement>(null);
 // bumped when the DOM must resync from `desc` (load, blur) — never while
 // typing, or the innerHTML rewrite would throw the caret to the start
  const [descSync, setDescSync] = useState(0);
  useEffect(() => {
    if (!databaseId) return;
    let alive = true;
    void fetch(`/api/databases/${databaseId}?meta=1`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!alive || !d?.database) return;
        const text: string = d.database.description ?? "";
        const flag: boolean | null = d.database.descriptionVisible ?? null;
        setDesc(text);
 // never toggled → show it if there is anything to show, which is what a
 // database imported with a description expects
        setDescShown(flag ?? text.trim() !== "");
        setDescLoaded(true);
        setDescSync((n) => n + 1);
      });
    return () => {
      alive = false;
    };
  }, [databaseId]);

  const saveDesc = useDebounced((value: string) => {
    void fetch(`/api/databases/${databaseId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ description: value }),
    });
  }, 400);

 // the toggle is the whole feature: 설명 추가 → write, 설명 숨기기 → keep the text
 // and fold it away, 설명 표시 → bring it back.
  function toggleDesc() {
    const next = !descShown;
    setDescShown(next);
    if (next) requestAnimationFrame(() => focusDescEnd());
    void fetch(`/api/databases/${databaseId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ descriptionVisible: next }),
    });
  }

 /** Characters before the caret, measured the way domToPlainText counts them.
  *  The sentinel keeps a trailing <br> from being read as filler (worth
  *  nothing) when the caret sits on a fresh empty line. */
  function descCaretOffset(el: HTMLDivElement): number | null {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || !sel.focusNode || !el.contains(sel.focusNode)) return null;
    const upToCaret = document.createRange();
    upToCaret.selectNodeContents(el);
    const live = sel.getRangeAt(0);
    upToCaret.setEnd(live.endContainer, live.endOffset);
    const probe = document.createElement("div");
    probe.append(upToCaret.cloneContents(), document.createTextNode("\u0000"));
    return domToPlainText(probe).length - 1;
  }

 /** Rewrite the markup so finished URLs are anchors — but only with the caret
  *  at the very end, where putting it back is exact. Mid-text edits wait for
  *  the blur rebuild rather than risk moving someone's cursor. */
  function relinkIfCaretAtEnd(el: HTMLDivElement, text: string) {
    if (descCaretOffset(el) !== text.length) return;
    const next = plainTextToLinkedHtml(text);
    if (next === el.innerHTML) return;
    el.innerHTML = next;
    focusDescEnd();
  }

  function focusDescEnd() {
    const el = descRef.current;
    if (!el) return;
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  }

 // The description is stored as plain text but rendered as inline HTML so a
 // pasted URL reads as a link, the way it does in the reference capture. React
 // must not own these children — it would rewrite them mid-keystroke — so the
 // DOM is written here and read back with innerText.
  useEffect(() => {
    const el = descRef.current;
    if (el) el.innerHTML = plainTextToLinkedHtml(desc);
 // `desc` is deliberately NOT a dependency: resync on load/blur (descSync)
 // only, never on a typed character.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [descSync, descShown]);

  const saveTitle = useDebounced((value: string) => {
    updatePage(initialPage.id, { title: value });
    if (databaseId) {
      void fetch(`/api/databases/${databaseId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: value }),
      });
    }
  }, 300);

  useEffect(() => {
    const el = titleRef.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight}px`;
    }
  }, [title]);

  return (
    <div className="min-h-full pb-32">
      {/* React 19 hoists this and keeps ownership — direct document.title
          writes get reverted to the layout metadata on re-commits. A peek is
          a popup over another page: it must not take the tab's title. */}
      {!peek && <title>{title.trim() ? title : "Untitled"}</title>}
      <div className="sticky top-0 z-30 flex items-center justify-between gap-1 bg-white px-3 py-1.5 dark:bg-[#191919]">
        {peek ? (
          /* Notion's peek header: open-as-full-page, a divider, then where the
             page went. A page with no parent went to Private, which Notion
             names 개인 페이지 rather than leaving the line blank. */
          <div className="flex min-w-0 items-center">
            <Link
              href={`/p/${initialPage.id}`}
 // NO prefetch: the Link would prefetch this route the moment the peek
 // opens — before anything was typed — and the click then rendered that
 // stale snapshot: an Untitled page without the content just written.
              prefetch={false}
              onClick={(e) => {
 // the title save is debounced 300ms; expanding right after typing let
 // the full page SSR read the OLD title. Land the save, then navigate.
                e.preventDefault();
                saveTitle.cancel();
                peek.onClose();
                void updatePage(initialPage.id, { title }).then(() => {
                  router.push(`/p/${initialPage.id}`);
                });
              }}
              data-testid="peek-open-full"
              aria-label="전체 페이지로 열기"
              data-tip="전체 페이지로 열기"
              className="rounded p-1 text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-600 dark:hover:bg-neutral-800 dark:hover:text-neutral-300"
            >
              <Maximize2 size={14} />
            </Link>
            <span
              aria-hidden="true"
              className="mx-1.5 h-3.5 w-px shrink-0 bg-neutral-200 dark:bg-neutral-700"
            />
            <span className="flex min-w-0 items-center gap-1 text-sm">
              <span className="shrink-0 text-neutral-400 dark:text-neutral-500">추가 대상</span>
              {peek.parent ? (
                <Link
                  href={`/p/${peek.parent.id}`}
                  onClick={peek.onClose}
                  data-testid="peek-destination"
                  className="flex min-w-0 items-center gap-1 rounded px-1 py-0.5 font-semibold text-neutral-700 transition-colors hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-800"
                >
                  <span className="shrink-0 text-[15px] leading-none">
                    <PageIcon icon={peek.parent.icon} fallback="📄" />
                  </span>
                  <span className="truncate">{peek.parent.title || "Untitled"}</span>
                </Link>
              ) : (
                <span
                  data-testid="peek-destination"
                  className="flex min-w-0 items-center gap-1 px-1 font-semibold text-neutral-700 dark:text-neutral-200"
                >
                  <LockIcon size={12} className="shrink-0 text-neutral-400" />
                  <span className="truncate">개인 페이지</span>
                </span>
              )}
            </span>
          </div>
        ) : (
          <Breadcrumbs pageId={initialPage.id} current={page} />
        )}
        <div className="flex items-center gap-1">
        <PresenceBar self={self} others={others} />
        {page.isLocked && (
          <span
            data-testid="page-locked-banner"
            className="mr-1 flex items-center gap-1 rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400"
          >
            <LockIcon size={11} /> Locked
          </span>
        )}
        {editedAgo(page.updatedAt) && (
          <span
            data-testid="page-edited-ago"
 // Date.now()-relative text can cross a minute boundary between
 // SSR and hydration — a mismatch here regenerates the whole tree
            suppressHydrationWarning
            className="mr-1 hidden text-xs text-neutral-400 sm:block"
          >
            {editedAgo(page.updatedAt)}
          </span>
        )}
        <button
          data-testid="page-fav-toggle"
          onClick={() => updatePage(initialPage.id, { isFavorite: !page.isFavorite })}
          aria-label={page.isFavorite ? "Remove from favorites" : "Add to favorites"}
          data-tip={page.isFavorite ? "Remove from favorites" : "Add to favorites"}
          className={`rounded-md px-2 py-1 text-sm transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-800 ${
            page.isFavorite ? "text-yellow-500" : "text-neutral-500 dark:text-neutral-400"
          }`}
        >
          {page.isFavorite ? "★" : "☆"}
        </button>
        <button
          data-testid="page-comments-button"
          onClick={() => openComments(PAGE_ANCHOR)}
          aria-label="Comments"
          data-tip="Comments"
          className="flex items-center gap-1 rounded-md px-2 py-1 text-sm text-neutral-500 transition-colors hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800"
        >
          <MessageSquare size={16} />
        </button>
        <CopyLinkButton pageId={initialPage.id} />
        <SharePopover pageId={initialPage.id} />
        <PageOptionsMenu page={page} />
        {peek && (
          <button
            data-testid="peek-close"
            onClick={peek.onClose}
            aria-label="닫기"
            data-tip="닫기"
            className="rounded-md px-1.5 py-1 text-neutral-500 transition-colors hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800"
          >
            <X size={16} />
          </button>
        )}
        </div>
      </div>
      <LiveCursors others={others} />
      {page.coverUrl && (
        <CoverControls
          coverUrl={page.coverUrl}
          onSet={(url) => updatePage(initialPage.id, { coverUrl: url })}
        />
      )}

      <div
        className={`group/pagehead mx-auto ${
 // A database page: no width cap and a fixed 96px inset, which is what the
 // original measures — its content div carries `padding-left: 96px` with no
 // max-width, so the column grows with the window while the margin stays put.
 // (A cap centred the column, and then the table's resting position — and
 // where its horizontal scroll began — moved with the window.)
          wide
 // 96px margin, then the text starts 44px further in and the database 8px in —
 // the original's offsets from its own padding edge (title 410, table 374,
 // padding edge 366). The 44 is applied here and the editor takes 36 back.
            ? "max-w-none px-24 pl-[calc(6rem+44px)]"
            : isPeek
 // the center peek uses the original's own peek layout: margins FIXED at
 // 126px and the content takes the rest, uncapped (`.layout-center-peek
 // { --content-width: 1fr; --margin-width: 126px }` read from Notion's
 // stylesheet over CDP) — 723px of content in the 975px panel.
              ? "max-w-none px-[126px]"
              : page.fullWidth
 // 전체 너비 in the original: no width cap, the same 96px inset every page
 // carries (measured off the user's capture: 1521px blocks in a 1728px
 // window = 2×96 + scrollbar). We had a 1500px cap and 64px insets.
              ? "max-w-none px-24"
 // a default page: 708px of content inside the 96px insets. px-16 made our
 // text column wider than the original's whenever the window was narrow
 // enough for the margins to touch.
              : "max-w-[calc(708px+12rem)] px-24"
        }`}
      >
        {/* icon first so its -mt-9 really overlaps the cover,
            then the hover action row between icon and title (#2/#95) */}
        {page.icon && (
          <div className={page.coverUrl ? "-mt-9" : "pt-12"}>
            <IconPicker
              icon={page.icon}
              allowImage
              onChange={(icon) => updatePage(initialPage.id, { icon })}
            />
          </div>
        )}
        {/* hover action row: Add icon · Add cover · Add comment —
            revealed on header hover, never pinned to the viewport */}
        <div
          className={`flex items-center gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover/pagehead:opacity-100 ${
            page.icon ? "pt-1" : page.coverUrl ? "pt-2" : "pt-14"
          }`}
        >
          {!page.icon && (
            <IconPicker
              icon={page.icon}
              allowImage
              placeholder={<span className="flex items-center gap-1.5 text-sm text-neutral-400"><EmojiFaceIcon /> Add icon</span>}
              triggerClassName="rounded px-1.5 py-0.5 transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-800"
              onChange={(icon) => updatePage(initialPage.id, { icon })}
            />
          )}
          {!page.coverUrl && (
            <CoverControls
              coverUrl={page.coverUrl}
              onSet={(url) => updatePage(initialPage.id, { coverUrl: url })}
            />
          )}
          <button
            data-testid="page-head-comment"
            onClick={() => openComments(PAGE_ANCHOR)}
            className="flex items-center gap-1.5 rounded px-1.5 py-0.5 text-sm text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-600 dark:hover:bg-neutral-800"
          >
            <CommentIcon /> Add comment
          </button>
          {/* 설명 추가 / 설명 숨기기 / 설명 표시 — only a database page has a
              description, and the row it sits in is the same hover row as
              아이콘 추가 · 커버 추가 (Notion's .notion-page-controls). */}
          {databaseId && descLoaded && (
            <button
              data-testid="db-description-toggle"
              onClick={toggleDesc}
              className="flex items-center gap-1 rounded px-1.5 py-0.5 text-sm text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-600 dark:hover:bg-neutral-800"
            >
              <InfoCircleIcon />
              {descShown ? "설명 숨기기" : desc.trim() ? "설명 표시" : "설명 추가"}
            </button>
          )}
        </div>

        <textarea
          ref={titleRef}
          data-testid="page-title"
          rows={1}
          value={title}
          disabled={page.isLocked}
          placeholder={fullPageDb ? "새 데이터베이스" : "Untitled"}
          onChange={(e) => {
            const v = e.target.value.replace(/\n/g, "");
            setTitle(v);
            saveTitle.call(v);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              editorRef.current?.focusFirst();
            }
          }}
          className="mt-2 w-full resize-none overflow-hidden bg-transparent text-4xl font-bold text-neutral-900 outline-none placeholder:text-neutral-300 dark:text-neutral-100 dark:placeholder:text-neutral-600"
        />

        {/* The description sits between the title and the database's view tabs,
            where Notion puts it, with the capture's own metrics: 14px/1.5, a
            12px inline start, 780px measure (a description does not stretch to
            a wide table's width), 12px below. */}
        {databaseId && descShown && (
          <div
            ref={descRef}
            data-testid="db-page-description"
            contentEditable={!page.isLocked}
            suppressContentEditableWarning
            role="textbox"
            aria-multiline="true"
            aria-label="설명"
            data-placeholder="설명을 추가하세요"
            data-placeholder-persist=""
            onInput={(e) => {
 // domToPlainText, never innerText — innerText counts a pasted blank line
 // twice and the description drifted apart a line on every save
              const el = e.currentTarget as HTMLDivElement;
              const text = domToPlainText(el);
              setDesc(text);
              saveDesc.call(text);
 // a URL becomes a link the moment it is finished, not at the next blur:
 // clicking one you had just typed did nothing, because there was no anchor
              if (/\s$/.test(text)) relinkIfCaretAtEnd(el, text);
            }}
            onBlur={() => {
 // relinkify from the text that ended up in the DOM: a URL typed by hand
 // becomes a link now, and text typed against a link's edge normalizes
              const el = descRef.current;
              if (!el) return;
              const text = domToPlainText(el);
              setDesc(text);
              saveDesc.call(text);
              setDescSync((n) => n + 1);
            }}
            onPaste={(e) => {
 // plain text only — the store holds text, and pasted markup would be
 // dropped on the next blur anyway (silently losing what it looked like)
              e.preventDefault();
              const el = e.currentTarget as HTMLDivElement;
              document.execCommand("insertText", false, e.clipboardData.getData("text/plain"));
 // links in what was just pasted are live immediately (onInput above has
 // already recorded the text; this only rewrites the markup)
              relinkIfCaretAtEnd(el, domToPlainText(el));
            }}
            onClick={(e) => {
 // links inside a contenteditable are not followed by the browser
              const anchor = (e.target as HTMLElement).closest?.("a[href]");
              const href = anchor?.getAttribute("href");
              if (!href) return;
              e.preventDefault();
              window.open(href, "_blank", "noopener,noreferrer");
            }}
 // -ml-9 + pl-2, not pl-3: the description's text starts where the table's
 // first-column CONTENT starts (the original keeps these two flush). The
 // database block below takes the same -ml-9 back to the table edge, and a
 // cell insets its content 8px — so the description does exactly that too.
 // pl-3 measured it from the TEXT column instead, which put it 40px adrift.
            className="-ml-9 mb-3 mt-1.5 max-w-[780px] whitespace-pre-wrap break-words pb-1 pl-2 pt-[3px] text-sm leading-[1.5] text-neutral-800 outline-none dark:text-neutral-200"
          />
        )}

        {/* database-row pages show their EDITABLE properties above the body
            self-hides on ordinary pages. Locked page → read-only. */}
        <div className={page.isLocked ? "pointer-events-none opacity-90" : undefined}>
          <RowPropertiesPanel pageId={initialPage.id} />
        </div>

        {page.isLocked ? (
          <ReadOnlyBlocks blocks={initialBlocks} />
        ) : fullPageDb && databaseId ? (
 // 원본(2026-08-20 실측): full-page 데이터베이스 페이지에는 블록 캔버스가
 // 없다 — 편집 가능한 곳은 제목과 설명뿐. 에디터를 안 그리므로 드롭도 블록
 // 추가도 여기서는 불가능하고, 과거에 잘못 붙은 블록이 있어도 렌더되지 않는다.
          <DatabaseBlock databaseId={databaseId} fullPage />
        ) : (
          <BlockEditor
            ref={editorRef}
            pageId={initialPage.id}
            initialBlocks={initialBlocks}
          />
        )}
      </div>
      <CommentThreadPanel pageId={initialPage.id} />
    </div>
  );
}

/** Notion's own infoCircleFill glyph, kept as-is next to 설명 추가/숨기기/표시 —
 *  lucide has no filled info circle and the outline one reads as a different
 *  control. Path and viewBox are Notion's (docs/target.html). */
function InfoCircleIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="2.37 2.37 15.26 15.25"
      className="h-3.5 w-3.5 shrink-0 fill-current"
    >
      <path d="M2.375 10a7.625 7.625 0 1 1 15.25 0 7.625 7.625 0 0 1-15.25 0M8.65 8.25a.625.625 0 1 0 0 1.25h.725v3.25H8.65a.625.625 0 1 0 0 1.25h2.7a.625.625 0 1 0 0-1.25h-.725V8.875A.625.625 0 0 0 10 8.25zM10.7 6.3a.8.8 0 1 0-1.6 0 .8.8 0 0 0 1.6 0" />
    </svg>
  );
}

/** Page cover: add/change/remove a cover image by URL. Exported so the
 *  database row peek shows the same 커버 추가 control the page does. */
export function CoverControls({
  coverUrl,
  onSet,
}: {
  coverUrl: string | null;
  onSet: (url: string | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [repositioning, setRepositioning] = useState(false);
  const [pos, setPos] = useState(50);

 // subtle parallax: the cover image trails the page scroll a little
  useEffect(() => {
    if (!coverUrl) return;
    const main = document.querySelector('main[aria-label="Page content"]');
    if (!(main instanceof HTMLElement)) return;
    const onScroll = () => {
      const img = document.querySelector('[data-testid="page-cover-image"]');
      if (img instanceof HTMLElement)
        img.style.transform = `translateY(${Math.min(48, main.scrollTop * 0.25)}px) scale(1.1)`;
    };
    main.addEventListener("scroll", onScroll, { passive: true });
    return () => main.removeEventListener("scroll", onScroll);
  }, [coverUrl]);

 // cover value grammar: "gradient:<name>" (preset gallery) or a URL with an
 // optional "#pos=NN" fragment (vertical object-position %, Reposition)
  const [base, posStr] = (coverUrl ?? "").split("#pos=");
  const savedPos = posStr ? Number(posStr) : 50;
  const gradient = base.startsWith("gradient:") ? GRADIENTS[base.slice(9)] : null;

  const editor = editing ? (
    <div className="popover-anim absolute left-1/2 top-2 z-20 flex w-[22rem] -translate-x-1/2 flex-col gap-1.5 rounded-md border border-neutral-200 bg-white p-1.5 shadow-lg dark:border-neutral-700 dark:bg-neutral-800">
      <div className="flex gap-1.5">
        <input
          autoFocus
          data-testid="page-cover-url-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Paste an image URL…"
          className="w-full rounded border border-neutral-200 px-2 py-1 text-xs outline-none dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-200"
        />
        <button
          data-testid="page-cover-save"
          onClick={() => {
            if (draft.trim()) onSet(draft.trim());
            setEditing(false);
          }}
          className="rounded bg-blue-500 px-2.5 py-1 text-xs font-medium text-white hover:bg-blue-600"
        >
          Save
        </button>
      </div>
      {/* preset gallery */}
      <div className="flex flex-wrap gap-1">
        {Object.entries(GRADIENTS).map(([name, css]) => (
          <button
            key={name}
            data-testid={`page-cover-gallery-${name}`}
            onClick={() => {
              onSet(`gradient:${name}`);
              setEditing(false);
            }}
            aria-label={`${name} cover`}
            style={{ background: css }}
            className="h-7 w-9 rounded border border-neutral-200 dark:border-neutral-600"
          />
        ))}
      </div>
      <label className="cursor-pointer text-xs text-neutral-400 hover:text-neutral-600">
        ⬆ Upload an image…
        <input
          data-testid="page-cover-upload"
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            void (async () => {
              const up = await uploadBlob(f);
              if (!up) return;
              onSet(up.url);
              setEditing(false);
            })();
          }}
        />
      </label>
    </div>
  ) : null;

  if (coverUrl) {
    return (
      <div className="group/cover relative h-[30vh] overflow-hidden">
        {gradient ? (
          <div data-testid="page-cover-image" style={{ background: gradient }} className="h-full w-full" />
        ) : (
 // eslint-disable-next-line @next/next/no-img-element
          <img
            data-testid="page-cover-image"
            src={base}
            alt=""
            style={{ objectPosition: `50% ${repositioning ? pos : savedPos}%` }}
            onPointerDown={(e) => {
 // while repositioning, drag the image itself
              if (!repositioning) return;
              e.preventDefault();
              const startY = e.clientY;
              const startPos = pos;
              const h = e.currentTarget.getBoundingClientRect().height;
              const onMove = (ev: PointerEvent) => {
                const deltaPct = ((ev.clientY - startY) / h) * 100;
                setPos(Math.min(100, Math.max(0, Math.round(startPos - deltaPct))));
              };
              const onUp = () => {
                document.removeEventListener("pointermove", onMove);
                document.removeEventListener("pointerup", onUp);
              };
              document.addEventListener("pointermove", onMove);
              document.addEventListener("pointerup", onUp);
            }}
            className={`h-full w-full scale-110 object-cover will-change-transform ${
              repositioning ? "cursor-grab active:cursor-grabbing" : ""
            }`}
          />
        )}
        {repositioning && (
          <span className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded bg-black/50 px-2 py-1 text-xs text-white">
            Drag image to reposition
          </span>
        )}
        <div className="absolute right-3 top-3 flex gap-1 opacity-0 transition-opacity group-hover/cover:opacity-100">
          {!gradient && !repositioning && (
            <button
              data-testid="page-cover-reposition"
              onClick={() => {
                setPos(savedPos);
                setRepositioning(true);
              }}
              className="rounded bg-white/80 px-2 py-1 text-xs text-neutral-600 shadow hover:bg-white dark:bg-neutral-800/80 dark:text-neutral-300"
            >
              Reposition
            </button>
          )}
          <button
            data-testid="page-cover-change"
            onClick={() => {
              setDraft(gradient ? "" : base);
              setEditing(true);
            }}
            className="rounded bg-white/80 px-2 py-1 text-xs text-neutral-600 shadow hover:bg-white dark:bg-neutral-800/80 dark:text-neutral-300"
          >
            Change cover
          </button>
          <button
            data-testid="page-cover-remove"
            onClick={() => onSet(null)}
            className="rounded bg-white/80 px-2 py-1 text-xs text-neutral-600 shadow hover:bg-white dark:bg-neutral-800/80 dark:text-neutral-300"
          >
            Remove
          </button>
        </div>
        {repositioning && (
          <div className="absolute left-1/2 top-3 z-20 flex -translate-x-1/2 gap-1 rounded-md bg-white/90 p-1 shadow dark:bg-neutral-800/90">
            <button
              data-testid="page-cover-pos-up"
              onClick={() => setPos((v) => Math.max(0, v - 10))}
              className="rounded px-2 py-1 text-xs text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-700"
            >
              ▲
            </button>
            <button
              data-testid="page-cover-pos-down"
              onClick={() => setPos((v) => Math.min(100, v + 10))}
              className="rounded px-2 py-1 text-xs text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-700"
            >
              ▼
            </button>
            <button
              data-testid="page-cover-savepos"
              onClick={() => {
                setRepositioning(false);
                onSet(pos === 50 ? base : `${base}#pos=${pos}`);
              }}
              className="rounded bg-blue-500 px-2 py-1 text-xs font-medium text-white hover:bg-blue-600"
            >
              Save position
            </button>
          </div>
        )}
        {editor}
      </div>
    );
  }
 // no cover: a small inline trigger — page-view hosts it in the hover
 // action row above the title, not pinned at the viewport top
  return (
    <div className="relative inline-block">
      <button
        data-testid="page-cover-add"
        onClick={() => {
          setDraft("");
          setEditing(true);
        }}
        className="flex items-center gap-1.5 rounded px-1.5 py-0.5 text-sm text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-600 dark:hover:bg-neutral-800"
      >
        <PhotoIcon /> 커버 추가
      </button>
      {editor}
    </div>
  );
}

/** Preset cover gallery. */
const GRADIENTS: Record<string, string> = {
  sunset: "linear-gradient(135deg,#f6d365,#fda085)",
  ocean: "linear-gradient(135deg,#89f7fe,#66a6ff)",
  forest: "linear-gradient(135deg,#c1dfc4,#deecdd)",
  berry: "linear-gradient(135deg,#f093fb,#f5576c)",
  night: "linear-gradient(135deg,#30cfd0,#330867)",
  sand: "linear-gradient(135deg,#fdfbfb,#ebedee)",
  flame: "linear-gradient(135deg,#ff9a9e,#fecfef)",
  slate: "linear-gradient(135deg,#a8c0ff,#3f2b96)",
}

/** "Copy link": copies this page's own URL (shared with the row peek) (always available, unlike the
 * public-share link which only exists after publishing). standard behavior. */
export function CopyLinkButton({ pageId }: { pageId: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      data-testid="page-copy-link"
      onClick={async () => {
        const url = `${window.location.origin}/p/${pageId}`;
        if (await copyText(url)) {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }
      }}
      aria-label="Copy link to page"
      className="flex items-center gap-1 rounded-md px-2 py-1 text-sm text-neutral-500 transition-colors hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800"
    >
      {copied ? <Check size={16} /> : <Link2 size={16} />}
    </button>
  );
}

/** "Edited 3h ago" — coarse relative time for the top bar (the row peek
 *  shows the same line the capture has there). */
export function editedAgo(updatedAt: string | Date | null | undefined): string {
  if (!updatedAt) return "";
  const t = new Date(updatedAt).getTime();
  if (isNaN(t)) return "";
  const mins = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (mins < 1) return "Edited just now";
  if (mins < 60) return `Edited ${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `Edited ${hours}h ago`;
  return `Edited ${Math.round(hours / 24)}d ago`;
}
