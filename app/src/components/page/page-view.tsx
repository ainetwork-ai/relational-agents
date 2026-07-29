"use client";

import { useEffect, useRef, useState } from "react";
import type { Block, Page } from "@/lib/db/schema";
import { usePagesStore } from "@/stores/pages";
import { useDebounced } from "@/hooks/use-debounced";
import { IconPicker } from "./icon-picker";
import { BlockEditor, type BlockEditorHandle } from "@/components/editor/block-editor";
import { SharePopover } from "./share-popover";
import { MessageSquare, Link2, Check, Lock as LockIcon } from "lucide-react";
import { PageOptionsMenu } from "./page-options";
import { ReadOnlyBlocks } from "@/components/read-only-blocks";
import { CommentThreadPanel } from "@/components/comments/comment-thread-panel";
import { useCommentUi, PAGE_ANCHOR } from "@/stores/comment-ui";
import { copyText } from "@/lib/compat";
import { uploadBlob } from "@/lib/upload";
import { Breadcrumbs } from "./breadcrumbs";
import { RowPropertiesPanel } from "@/components/database/row-properties";
import { PresenceBar } from "@/components/presence/presence-bar";
import { PageCallButton } from "@/components/call/call-button";
import { LiveCursors } from "@/components/presence/live-cursors";
import { usePresence } from "@/hooks/use-presence";
import { useRecentsStore } from "@/stores/recents";

export function PageView({
  initialPage,
  initialBlocks,
  wide = false,
}: {
  initialPage: Page;
  initialBlocks: Block[];
  /** database pages render near-full-width , not the 836px column */
  wide?: boolean;
}) {
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
  useEffect(() => {
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
  }, [initialPage.id]);

 // Parent renders <PageView key={page.id}>, so navigation remounts and
 // resets this state naturally.
  const [title, setTitle] = useState(initialPage.title);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const editorRef = useRef<BlockEditorHandle>(null);
  const saveTitle = useDebounced((value: string) => {
    updatePage(initialPage.id, { title: value });
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
          writes get reverted to the layout metadata on re-commits */}
      <title>{title.trim() ? title : "Untitled"}</title>
      <div className="sticky top-0 z-30 flex items-center justify-between gap-1 bg-white px-3 py-1.5 dark:bg-[#191919]">
        <Breadcrumbs pageId={initialPage.id} />
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
        <PageCallButton pageId={initialPage.id} />
        <CopyLinkButton pageId={initialPage.id} />
        <SharePopover pageId={initialPage.id} />
        <PageOptionsMenu page={page} />
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
        className={`group/pagehead mx-auto px-16 ${wide || page.fullWidth ? "max-w-[1500px]" : "max-w-[calc(708px+8rem)]"}`}
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
              placeholder={<span className="text-sm text-neutral-400">😀 Add icon</span>}
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
            className="flex items-center gap-1 rounded px-1.5 py-0.5 text-sm text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-600 dark:hover:bg-neutral-800"
          >
            💬 Add comment
          </button>
        </div>

        <textarea
          ref={titleRef}
          data-testid="page-title"
          rows={1}
          value={title}
          disabled={page.isLocked}
          placeholder="Untitled"
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

        {/* database-row pages show their EDITABLE properties above the body
            self-hides on ordinary pages. Locked page → read-only. */}
        <div className={page.isLocked ? "pointer-events-none opacity-90" : undefined}>
          <RowPropertiesPanel pageId={initialPage.id} />
        </div>

        {page.isLocked ? (
          <ReadOnlyBlocks blocks={initialBlocks} />
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

/** Page cover: add/change/remove a cover image by URL. */
function CoverControls({
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
        className="flex items-center gap-1 rounded px-1.5 py-0.5 text-sm text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-600 dark:hover:bg-neutral-800"
      >
        🖼 Add cover
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

/** "Copy link": copies this page's own URL (always available, unlike the
 * public-share link which only exists after publishing). standard behavior. */
function CopyLinkButton({ pageId }: { pageId: string }) {
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

/** "Edited 3h ago" — coarse relative time for the top bar. */
function editedAgo(updatedAt: string | Date | null | undefined): string {
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
