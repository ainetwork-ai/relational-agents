"use client";

import { CommentIcon, EmojiFaceIcon, PhotoIcon } from "@/components/icons/page-controls";
import { isImeComposing } from "@/hooks/use-ime-guard";
import { useEffect, useRef, useState } from "react";
import type { Block, Page } from "@/lib/db/schema";
import { usePagesStore } from "@/stores/pages";
import { useDebounced } from "@/hooks/use-debounced";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { IconPicker } from "./icon-picker";
import { BlockEditor, type BlockEditorHandle } from "@/components/editor/block-editor";
import { SharePopover } from "./share-popover";
import { FamilyFoldersPill } from "@/components/family/family-folders";
import { MessageSquare, Link2, Check, Lock as LockIcon, Maximize2, X } from "lucide-react";
import { PageIcon } from "@/components/page-icon";
import { PageOptionsMenu } from "./page-options";
import { ReadOnlyBlocks } from "@/components/read-only-blocks";
import { CommentThreadPanel } from "@/components/comments/comment-thread-panel";
import { focusPageComposer } from "@/components/comments/comment-thread";
import { useCommentUi, PAGE_ANCHOR } from "@/stores/comment-ui";
import { copyText } from "@/lib/compat";
import { domToPlainText, plainTextToLinkedHtml } from "@/lib/rich-text";
import { uploadBlob } from "@/lib/upload";
import { Breadcrumbs } from "./breadcrumbs";
import { RowPropertiesPanel } from "@/components/database/row-properties";
import { useRowDetails, DETAILS_SIDEBAR_WIDTH } from "@/stores/row-details";
import { DatabaseBlock } from "@/components/database/database-block";
import { PresenceBar } from "@/components/presence/presence-bar";
import { LiveCursors } from "@/components/presence/live-cursors";
import { usePresence } from "@/hooks/use-presence";
import { useRecentsStore } from "@/stores/recents";
import { useT } from "@/i18n/provider";
import type { T } from "@/i18n/translate";

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
    *  breadcrumb trail for Notion's destination line — ⤢ Open as full page, then
    *  "Add to 🏠 <parent>" — and gains a ✕. */
  peek?: { parent: Page | null; onClose: () => void };
}) {
  const t = useT();
  const router = useRouter();
  const storePage = usePagesStore((s) => s.pages[initialPage.id]);
  const updatePage = usePagesStore((s) => s.updatePage);
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
 // a row page's Properties sidebar takes its width off the page's box (row-details.ts)
  const detailsOpen = useRowDetails((st) => st.open);
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
 // set when Backspace merged the first block into the title: the very next ⌘Z
 // belongs to the editor (it puts the block AND the title back), not to the
 // textarea's native undo. Cleared as soon as the title is touched otherwise.
  const mergedTitleRef = useRef<string | null>(null);
  const openComments = useCommentUi((s) => s.open);
  const editorRef = useRef<BlockEditorHandle>(null);
  // A page whose body IS a database: its title is the database's name, so the
  // placeholder says so and the save writes both. Notion has one object here;
  // we have two rows and have to keep them in step.
  const fullPageDb = initialBlocks.find(
    (b) => b.type === "database" && (b.content as { fullPage?: boolean }).fullPage
  );
  const databaseId = (fullPageDb?.content as { databaseId?: string } | undefined)?.databaseId;

 // Description — a database page's own text under the title (Notion's collection
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

 // the toggle is the whole feature: Add description → write, Hide description → keep the text
 // and fold it away, Show description → bring it back.
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
 // scrollHeight is an integer: a 38.4px line (a database page's 32px/1.2 title)
 // came back as 39 and pushed everything under it 0.6px off the original.
 // Snap to whole lines of the computed line-height instead.
      const lh = parseFloat(getComputedStyle(el).lineHeight);
      const lines = lh > 0 ? Math.max(1, Math.round(el.scrollHeight / lh)) : 0;
      el.style.height = lines ? `${lines * lh}px` : `${el.scrollHeight}px`;
    }
  }, [title]);

  return (
    <div className="min-h-full pb-32">
      {/* React 19 hoists this and keeps ownership — direct document.title
          writes get reverted to the layout metadata on re-commits. A peek is
          a popup over another page: it must not take the tab's title. */}
      {!peek && <title>{title.trim() ? title : t("Untitled")}</title>}
      {/* 44px tall like Notion's .notion-topbar (measured 2026-08-27: the frame
          starts at y=44). It was py-1.5 around 28px buttons = 40. */}
      <div className="sticky top-0 z-30 flex h-11 items-center justify-between gap-1 bg-white px-3 dark:bg-[#191919]">
        {peek ? (
          /* Notion's peek header: open-as-full-page, a divider, then where the
             page went. A page with no parent went to Private, which Notion
             labels "Private" rather than leaving the line blank. */
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
              aria-label={t("Open as full page")}
              data-tip={t("Open as full page")}
              className="rounded p-1 text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-600 dark:hover:bg-neutral-800 dark:hover:text-neutral-300"
            >
              <Maximize2 size={14} />
            </Link>
            <span
              aria-hidden="true"
              className="mx-1.5 h-3.5 w-px shrink-0 bg-neutral-200 dark:bg-neutral-700"
            />
            <span className="flex min-w-0 items-center gap-1 text-sm">
              <span className="shrink-0 text-neutral-400 dark:text-neutral-500">{t("Add to")}</span>
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
                  <span className="truncate">{peek.parent.title || t("Untitled")}</span>
                </Link>
              ) : (
                <span
                  data-testid="peek-destination"
                  className="flex min-w-0 items-center gap-1 px-1 font-semibold text-neutral-700 dark:text-neutral-200"
                >
                  <LockIcon size={12} className="shrink-0 text-neutral-400" />
                  <span className="truncate">{t("Private")}</span>
                </span>
              )}
            </span>
          </div>
        ) : (
          <Breadcrumbs pageId={initialPage.id} current={page} />
        )}
        <div className="flex items-center gap-1">
        <FamilyFoldersPill teamspaceId={page.teamspaceId} />
        <PresenceBar self={self} others={others} />
        {page.isLocked && (
          <span
            data-testid="page-locked-banner"
            className="mr-1 flex items-center gap-1 rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400"
          >
            <LockIcon size={11} /> {t("Locked")}
          </span>
        )}
        {editedAgo(page.updatedAt, t) && (
          <span
            data-testid="page-edited-ago"
 // Date.now()-relative text can cross a minute boundary between
 // SSR and hydration — a mismatch here regenerates the whole tree
            suppressHydrationWarning
            className="mr-1 hidden text-xs text-neutral-400 sm:block"
          >
            {editedAgo(page.updatedAt, t)}
          </span>
        )}
        <button
          data-testid="page-fav-toggle"
          onClick={() => updatePage(initialPage.id, { isFavorite: !page.isFavorite })}
          aria-label={page.isFavorite ? t("Remove from Favorites") : t("Add to Favorites")}
          data-tip={page.isFavorite ? t("Remove from Favorites") : t("Add to Favorites")}
          className={`rounded-md px-2 py-1 text-sm transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-800 ${
            page.isFavorite ? "text-yellow-500" : "text-neutral-500 dark:text-neutral-400"
          }`}
        >
          {page.isFavorite ? "★" : "☆"}
        </button>
        <button
          data-testid="page-comments-button"
          onClick={() => { if (!focusPageComposer()) openComments(PAGE_ANCHOR); }}
          aria-label={t("Comments")}
          data-tip={t("Comments")}
          className="flex items-center gap-1 rounded-md px-2 py-1 text-sm text-neutral-500 transition-colors hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800"
        >
          <MessageSquare size={16} />
        </button>
        <CopyLinkButton pageId={initialPage.id} />
        <SharePopover pageId={initialPage.id} />
        <PageOptionsMenu
          page={page}
 // after Move to Trash, don't stay on the deleted page: in a peek, close the peek;
 // on a full page, go home the same way the sidebar row menu does
          onDeleted={peek ? peek.onClose : () => router.push("/")}
        />
        {peek && (
          <button
            data-testid="peek-close"
            onClick={peek.onClose}
            aria-label={t("Close")}
            data-tip={t("Close")}
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
          short={wide}
          onSet={(url) => updatePage(initialPage.id, { coverUrl: url })}
        />
      )}

      <div style={detailsOpen && !isPeek ? { marginRight: DETAILS_SIDEBAR_WIDTH } : undefined}>
      <div
        data-testid="page-root"
        className={`group/pagehead mx-auto ${
 // A database page: no width cap and a fixed 96px inset, which is what the
 // original measures — its content div carries `padding-left: 96px` with no
 // max-width, so the column grows with the window while the margin stays put.
 // (A cap centred the column, and then the table's resting position — and
 // where its horizontal scroll began — moved with the window.)
 //
 // Nothing more than the 96 (2026-08-27, measured off the original's padding
 // edge 366): the icon sits at +8 IN the title row, the h1 box at +44 with its
 // own 8px padding, the description box at +0 with 12px padding, the tabs at
 // +0. Each child carries its own offset below; the container adds none.
          wide
            ? "max-w-none px-24"
            : isPeek
 // the center peek uses the original's own peek layout: margins FIXED at
 // 126px and the content takes the rest, uncapped (`.layout-center-peek
 // { --content-width: 1fr; --margin-width: 126px }` read from Notion's
 // stylesheet over CDP) — 723px of content in the 975px panel.
              ? "max-w-none px-[126px]"
              : page.fullWidth
 // Full width in the original: no width cap, the same 96px inset every page
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
        {page.icon && !wide && (
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
 // a database page: the original's .notion-page-controls row is 48 tall right
 // under the cover — 16 above, 28px buttons, 4 below — and the title row
 // follows with no gap
            wide && page.coverUrl ? "pt-4 pb-1 [&>button]:h-7" : page.icon ? "pt-1" : page.coverUrl ? "pt-2" : "pt-14"
          }`}
        >
          {!page.icon && (
            <IconPicker
              icon={page.icon}
              allowImage
              placeholder={<span className="flex items-center gap-1.5 text-sm text-neutral-400"><EmojiFaceIcon /> {t("Add icon")}</span>}
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
            onClick={() => { if (!focusPageComposer()) openComments(PAGE_ANCHOR); }}
            className="flex items-center gap-1.5 rounded px-1.5 py-0.5 text-sm text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-600 dark:hover:bg-neutral-800"
          >
            <CommentIcon /> {t("Add comment")}
          </button>
          {/* Add description / Hide description / Show description — only a database page has a
              description, and the row it sits in is the same hover row as
              Add icon · Add cover (Notion's .notion-page-controls). */}
          {databaseId && descLoaded && (
            <button
              data-testid="db-description-toggle"
              onClick={toggleDesc}
              className="flex items-center gap-1 rounded px-1.5 py-0.5 text-sm text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-600 dark:hover:bg-neutral-800"
            >
              <InfoCircleIcon />
              {descShown ? t("Hide description") : desc.trim() ? t("Show description") : t("Add description")}
            </button>
          )}
        </div>

        {/* A database page's title row (original, from the padding edge): a 36×36
            icon at +8 (4px radius, vertically centred on the 38.4px line), then
            the h1 at +44 with 8px of its own padding — 32px/1.2 bold, not the
            36px of an ordinary page. Both on ONE line; the icon is not stacked
            above like a page's 78px one. */}
        <div className={wide ? "flex items-center" : "contents"}>
        {wide && page.icon && (
          <div className="ml-2 shrink-0">
            <IconPicker
              icon={page.icon}
              allowImage
              triggerClassName="flex h-9 w-9 items-center justify-center rounded text-[30px] leading-none transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-800 [&>*]:h-9 [&>*]:w-9"
              onChange={(icon) => updatePage(initialPage.id, { icon })}
            />
          </div>
        )}
        <textarea
          ref={titleRef}
          data-testid="page-title"
          rows={1}
          value={title}
          disabled={page.isLocked}
          placeholder={fullPageDb ? t("New database") : t("Untitled")}
          onChange={(e) => {
            const v = e.target.value.replace(/\n/g, "");
            mergedTitleRef.current = null;
            setTitle(v);
            saveTitle.call(v);
          }}
          onBlur={() => {
 // the ⌘Z-belongs-to-the-editor window closes as soon as the caret leaves the
 // title; otherwise a later ⌘Z would undo whatever the body did last and put
 // this title back on top of it
            mergedTitleRef.current = null;
          }}
          onKeyDown={(e) => {
            if (!isImeComposing(e) && e.key === "Enter") {
              e.preventDefault();
              editorRef.current?.focusFirst();
              return;
            }
 // ⌘Z right after a Backspace merged the first block into this title undoes
 // BOTH, in one press, as the original does (docs/notion-indent.md §6).
            if (
              (e.metaKey || e.ctrlKey) &&
              !e.shiftKey &&
              e.key.toLowerCase() === "z" &&
              mergedTitleRef.current !== null &&
              e.currentTarget.value === mergedTitleRef.current
            ) {
              e.preventDefault();
              mergedTitleRef.current = null;
              editorRef.current?.undo();
            }
          }}
          className={`block w-full resize-none overflow-hidden bg-transparent font-bold text-neutral-900 outline-none placeholder:text-neutral-300 dark:text-neutral-100 dark:placeholder:text-neutral-600 ${
            wide ? "min-w-0 flex-1 pl-2 text-[32px] leading-[1.2]" : "mt-2 text-[40px] leading-[48px]"
          }`}
        />
        </div>

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
            aria-label={t("Description")}
            data-placeholder={t("Add a description")}
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
 // Measured off the original (2026-08-27): the description box starts AT the
 // padding edge (+0) with 12px of its own padding, directly under the title
 // row (no margin; the 3px top padding is the only gap). An earlier version
 // aligned its text with the table's first cell instead — that was 4px off.
            className="mb-3 max-w-[780px] whitespace-pre-wrap break-words pb-1 pl-3 pt-[3px] text-sm leading-[1.5] text-neutral-800 outline-none dark:text-neutral-200"
          />
        )}

        {/* database-row pages show their EDITABLE properties above the body —
            the same block the side peek draws — and the body sits inside it,
            where the original's does. Self-hides on ordinary pages (the body
            renders plain). Locked page → read-only. */}
        <RowPropertiesPanel pageId={initialPage.id} locked={!!page.isLocked}>
          {page.isLocked ? (
            <ReadOnlyBlocks blocks={initialBlocks} />
          ) : fullPageDb && databaseId ? (
 // The original (measured 2026-08-20): a full-page database page has no block
 // canvas — only the title and the description are editable. The editor isn't drawn, so
 // neither drops nor adding blocks work here, and blocks wrongly attached in the past don't render.
            <DatabaseBlock databaseId={databaseId} fullPage />
          ) : (
            <BlockEditor
              ref={editorRef}
              pageId={initialPage.id}
              initialBlocks={initialBlocks}
 // Backspace at the very start of the first block moves that text into the
 // title, as the original does (docs/notion-indent.md §6). The caret lands at
 // the join so the next keystroke continues the sentence.
              onMergeIntoTitle={(text) => {
                if (page.isLocked) return;
                const base = title;
                const merged = (base + text).replace(/\n/g, "");
                const put = (v: string) => {
                  setTitle(v);
                  saveTitle.call(v);
                };
                put(merged);
                requestAnimationFrame(() => {
                  const el = titleRef.current;
                  if (!el) return;
                  el.focus();
                  el.setSelectionRange(base.length, base.length);
                });
 // ⌘Z takes the title back with the block (the original undoes both in one)
                mergedTitleRef.current = merged;
 // Only put the old title back if the title is still the one this merge made.
 // The frame's thunks live in the editor's history, so a ⌘Z long after the
 // user rewrote the title would otherwise overwrite what they typed.
                return {
                  undo: () => { if (titleRef.current?.value === merged) put(base); },
                  redo: () => { if (titleRef.current?.value === base) put(merged); },
                };
              }}
            />
          )}
        </RowPropertiesPanel>
      </div>
      </div>
      {/* block comments only — a page's own comments live in the page */}
      <CommentThreadPanel pageId={initialPage.id} />
    </div>
  );
}

/** Notion's own infoCircleFill glyph, kept as-is next to Add/Hide/Show description —
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
  *  database row peek shows the same Add cover control the page does. */
export function CoverControls({
  coverUrl,
  onSet,
  short = false,
}: {
  coverUrl: string | null;
  onSet: (url: string | null) => void;
  /** a database page's cover is 20vh in the original (measured 198.4px in a
   *  992px-tall window), against the 30vh of an ordinary page */
  short?: boolean;
}) {
  const t = useT();
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
          placeholder={t("Paste an image URL…")}
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
          {t("Save")}
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
            aria-label={t("{name} cover", { name })}
            style={{ background: css }}
            className="h-7 w-9 rounded border border-neutral-200 dark:border-neutral-600"
          />
        ))}
      </div>
      <label className="cursor-pointer text-xs text-neutral-400 hover:text-neutral-600">
        ⬆ {t("Upload image…")}
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
      <div className={`group/cover relative overflow-hidden ${short ? "h-[20vh]" : "h-[30vh]"}`}>
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
            {t("Drag image to reposition")}
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
              {t("Reposition")}
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
            {t("Change cover")}
          </button>
          <button
            data-testid="page-cover-remove"
            onClick={() => onSet(null)}
            className="rounded bg-white/80 px-2 py-1 text-xs text-neutral-600 shadow hover:bg-white dark:bg-neutral-800/80 dark:text-neutral-300"
          >
            {t("Remove")}
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
              {t("Save position")}
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
        <PhotoIcon /> {t("Add cover")}
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
  const t = useT();
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
      aria-label={t("Copy link")}
      className="flex items-center gap-1 rounded-md px-2 py-1 text-sm text-neutral-500 transition-colors hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800"
    >
      {copied ? <Check size={16} /> : <Link2 size={16} />}
    </button>
  );
}

/** "Edited 3h ago" — coarse relative time for the top bar (the row peek
 *  shows the same line the capture has there). */
export function editedAgo(
  updatedAt: string | Date | null | undefined,
 // callers without a t (row-peek) get the Korean source text
  t: T = (k, vars) => (vars ? k.replace(/\{(\w+)\}/g, (m, v) => String(vars[v] ?? m)) : k),
): string {
  if (!updatedAt) return "";
  const ms = new Date(updatedAt).getTime();
  if (isNaN(ms)) return "";
  const mins = Math.max(0, Math.round((Date.now() - ms) / 60000));
  if (mins < 1) return t("Edited just now");
  if (mins < 60) return t("Edited {n} minutes ago", { n: mins });
  const hours = Math.round(mins / 60);
  if (hours < 24) return t("Edited {n} hours ago", { n: hours });
  return t("Edited {n} days ago", { n: Math.round(hours / 24) });
}
