"use client";

import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { isImeComposing } from "@/hooks/use-ime-guard";
import { indentStep } from "@/lib/editor/indent";
import { bulletGlyph, numberLabel } from "@/lib/editor/list-markers";
import { createPortal } from "react-dom";
import { useLocale, useT } from "@/i18n/provider";
import { useDismiss } from "@/hooks/use-dismiss";
import { useAnchored } from "@/hooks/use-anchored";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight, GripVertical, Plus, Trash2, Copy, Repeat, FileText, MessageSquare, AlignLeft, AlignCenter, Maximize, Check, Link2, PanelTop, PanelLeft, TextAlignStart, TextAlignCenter, TextAlignEnd } from "lucide-react";
import { ALIGNS, setAll, uniformField, type Align } from "@/lib/editor/table-data";
import { CODE_LANGUAGES } from "@/lib/editor/block-defs";
import { sanitizeInline } from "@/lib/rich-text";
import { copyText, resolveAppUrl } from "@/lib/compat";
import { uploadBlob } from "@/lib/upload";
import { FileAttachment, FileAttachPicker } from "./file-attachment";
import { GiftBlock } from "./gift-block";
import { AlbumGrid, type AlbumFile } from "./album-grid";
import { useAindriveInfo } from "@/lib/aindrive-client";
import { parseAindriveUrl } from "@/lib/aindrive-url";
import { highlightCode } from "@/lib/editor/highlight";
import { IconPicker } from "@/components/page/icon-picker";
import { BLOCK_DRAG_MIME, useEditor, type EBlock } from "./block-editor";
import type { ButtonAction } from "@/lib/db/schema";
import { TableBlock } from "./table-block";
import { VideoBody } from "./video-body";
import { DatabaseBlock } from "@/components/database/database-block";
import { usePagesStore } from "@/stores/pages";
import { useCommentsStore } from "@/stores/comments";
import { useCommentUi } from "@/stores/comment-ui";
import { PageIcon } from "@/components/page-icon";
import { ensureKatex, renderTex, renderTexInline } from "@/lib/katex-loader";
import { MemorySelect } from "@/components/database/memory-select";

const LIST_RUN = new Set(["bulleted_list", "numbered_list", "todo", "toggle"]);
const HANDLE_TOP: Record<string, number> = { paragraph: 8, heading1: 39.5, heading2: 31.6, heading3: 25, quote: 8 };

function BlockRowInner({ block, depth, indentPx = 0, parentType }: { block: EBlock; depth: number; indentPx?: number; parentType?: string; hasChildren?: boolean; subtree?: EBlock[] }) {
  const editor = useEditor();
 // Original (measured 2026-08-25): list-like blocks (bullet, number, to-do, toggle) get 1px above and below each item, except
 // the first item of a list run gets 6px on top — when the previous sibling is not list-like. The gap between blocks is 0 and
 // all spacing is the block's own padding.
  const sibs = editor.childrenOf(block.parentBlockId ?? null);
  const prev = sibs[sibs.findIndex((b) => b.id === block.id) - 1];
  const listRun = LIST_RUN.has(block.type);
 // …but INSIDE a list-ish block (a bullet's or toggle's children) there is no
 // run boundary at all: nested items are 1/1 (nested bullet 30, nested open
 // empty toggle 70 — 2026-08-26 input cases)
  const nested = !!parentType && LIST_RUN.has(parentType);
  const listFirst = !nested && !(prev && LIST_RUN.has(prev.type));
  const next = sibs[sibs.findIndex((b) => b.id === block.id) + 1];
 // …and the last item of a run gets 6 at the bottom (a lone item = 6+28+6 = 40). Both are decided by the neighbours.
  const listLast = !nested && !(next && LIST_RUN.has(next.type));
 // Vertical position of the gutter (+, six dots): the original centres its 24px controls on the first text line (line box)
 // — paragraph 8, H1 39.5, H2 31.6, H3 25, list first item 8 / later 3, quote 8.
  const handleTop = HANDLE_TOP[block.type] ?? (listRun ? (listFirst ? 8 : 3) : 2);
 // The highlight's top/bottom inset is min(2px, that side's padding): list items have 1px padding, so 1.
  const halo = { top: listRun && !listFirst ? 1 : 2, bottom: listRun && !listLast ? 1 : 2 };

 // A columns layout renders its column children side-by-side; each column
 // stacks its own children vertically.
  if (block.type === "column_list") {
    const columns = editor.childrenOf(block.id);
    return (
      <div
        data-testid={`block-${block.id}`}
        data-block-type="column_list"
        className="group/block relative my-1 flex gap-4"
        onDragOver={(e) => editor.onDragOverRow(e, block.id)}
        onDrop={(e) => editor.onDropRow(e, block.id)}
      >
        {columns.map((col) => (
          <ColumnCell key={col.id} block={col} />
        ))}
        <button
          data-testid={`column-add-${block.id}`}
          onClick={() => editor.addColumn(block.id)}
          aria-label="Add column"
          className="flex w-6 shrink-0 items-center justify-center rounded text-neutral-300 opacity-0 transition-opacity hover:bg-neutral-100 hover:text-neutral-500 group-hover/block:opacity-100 dark:text-neutral-600 dark:hover:bg-neutral-800"
        >
          <Plus size={14} />
        </button>
      </div>
    );
  }

  const isDrop = editor.dropTarget?.id === block.id;
 // Toggle manages its own children (gated by expand) and callout draws them
 // inside its colored box; every other block renders its indented children
 // here so Tab-nesting works for all types.
  const nestedChildren =
    block.type === "toggle" || block.type === "callout" ? [] : editor.childrenOf(block.id);

  return (
    <div
      data-testid={`block-${block.id}`}
      data-block-type={block.type}
      className="group/block relative -mx-1.5 px-1.5"
      onDragOver={(e) => editor.onDragOverRow(e, block.id)}
      onDrop={(e) => editor.onDropRow(e, block.id)}
      onContextMenu={(e) => {
 // right-click on a block opens the full block action menu;
 // plain inputs keep the native menu, as does Ctrl/Cmd-click
        if (e.ctrlKey || e.metaKey) return;
        const t = e.target as HTMLElement;
        if (t.closest?.("input, textarea")) return;
        e.preventDefault();
        const handle = document.querySelector(
          `[data-testid="block-handle-${block.id}"]`
        );
        if (handle instanceof HTMLElement) handle.click();
      }}
      onClick={(e) => {
 // Measured on Notion (docs/notion-selection-copy.md §5): with blocks
 // selected, a click on TEXT — any block's, selected or not, with Shift or ⌘
 // or neither — clears the selection and leaves a caret there; a click on a
 // block's own padding (not on its text) selects just that block; a click
 // in the ⠿ gutter leaves the selection alone.
        const t = e.target as HTMLElement;
        if (t.closest("[data-block-type]") !== e.currentTarget) return; // a nested row's click
        if (t.closest('[data-testid^="block-handle-"], [data-gutter]')) return;
        const onText = !!t.closest("[contenteditable], input, textarea, button, a, select");
        if (!onText) {
          e.preventDefault();
          e.stopPropagation();
          if (e.shiftKey) editor.shiftSelect(block.id);
          else editor.selectBlock(block.id);
          return;
        }
        if (editor.selectedIds.size) editor.clearSelection();
      }}
    >
      {isDrop && editor.dropTarget?.before && (
        <div className="absolute -top-0.5 left-0 right-0 h-[3px] rounded bg-blue-500" />
      )}

      <div
 // the original's block box is 6px wider than the text column on each side
 // (720 vs 708): the grip highlight reaches 4px past the glyphs, and the
 // gutter is measured from that wider edge. Bleed the row out by 6 and pad
 // it back so the text stays put (2026-08-26, m-halo-text)
        className="relative flex items-start rounded"
        style={{ paddingLeft: indentPx }}
      >
        {/* selected: the original's halo — an overlay inset 2px into the block
            box (716×36 in a 720×40 text block), rgba(35,131,226,0.14), 4px
            radius, no ring, pointer-events none. Two selected neighbours
            therefore show a 4px seam, not one continuous slab (measured,
            docs/notion-selection-copy.md §2·§6). */}
        {editor.isHalo(block.id) && (
          <div
            data-selected=""
            aria-hidden="true"
            className="pointer-events-none absolute z-[1] rounded-[4px] bg-[rgba(35,131,226,0.14)]"
 // this div sits 6px inside the row box (the row bleeds -mx-1.5 to be the
 // 720-wide block box); 2px inside THAT box is -4px from here, after the
 // nesting indent on the left
            style={{ top: editor.haloInset(block.id).top, bottom: editor.haloInset(block.id).bottom, left: indentPx - 4, right: -4 }}
          />
        )}
        {/* The + and the drag handle belong to the ONE line the pointer is on.
            `group-hover/block:` was a descendant selector, so every block
            CONTAINING the pointer lit its own gutter: a nested parent showed
            handles along with its child, and a row peek — which renders inside
            the database block — showed handles on all of its lines at once.
            This keys off the nearest block instead: hovered, and not
            containing another hovered block.

            A full-page database gets no gutter at all: it IS the page, not a
            line you can reorder or add below, and Notion shows nothing there.
            It is also the one block that reclaims the page's left inset
            (-ml-9), so these controls landed ON its view tabs. */}
        {!(block.type === "database" && (block.content as { fullPage?: boolean }).fullPage === true) && (
        <div
          className="absolute flex items-center gap-0 opacity-0 transition-opacity duration-100 [[data-block-type]:hover:not(:has([data-block-type]:hover))>*>&]:opacity-100"
          style={{ left: indentPx - 58, top: handleTop }} /* + at -52, grip at -28: the original's gutter */
        >
          <button
            tabIndex={-1}
            data-testid={`block-add-below-${block.id}`}
            onClick={() => editor.insertBelow(block.id)}
            className="flex h-6 w-6 items-center justify-center rounded text-neutral-300 transition-colors hover:bg-neutral-100 hover:text-neutral-500 dark:text-neutral-600 dark:hover:bg-neutral-800"
            aria-label="Add block below"
          >
            <Plus size={15} />
          </button>
          <BlockHandle block={block} halo={halo} />
        </div>
        )}

        <BlockCommentAnchor blockId={block.id}>
          <BlockBody block={block} depth={depth} listFirst={listFirst} listLast={listLast} inList={!!parentType && parentType !== "toggle" && LIST_RUN.has(parentType)} />
        </BlockCommentAnchor>
      </div>

      {nestedChildren.length > 0 && (
        <div>
          {nestedChildren.map((c) => (
            <BlockRow key={c.id} block={c} depth={depth + 1} indentPx={indentPx + indentStep(block.type)} parentType={block.type} hasChildren={editor.blocks.some((x) => x.parentBlockId === c.id)} />
          ))}
        </div>
      )}

      {isDrop && !editor.dropTarget?.before && (
        <div className="absolute -bottom-0.5 left-0 right-0 h-[3px] rounded bg-blue-500" />
      )}
    </div>
  );
}

/** R016 — anchors a block's comment thread inline: a block with unresolved
 * comments keeps a highlight and a right-margin marker (count). Clicking the
 * marker opens that block's thread in the side panel. */
function BlockCommentAnchor({
  blockId,
  children,
}: {
  blockId: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const pageId = pathname?.match(/\/p\/([0-9a-f-]{36})/)?.[1] ?? null;
  const list = useCommentsStore((s) => (pageId ? s.byPage[pageId] : undefined));
  const openThread = useCommentUi((s) => s.open);

 // only UNRESOLVED threads anchor to the block; resolving clears the
 // highlight + marker.
  const unresolved = (list ?? []).filter(
    (c) => c.blockId === blockId && c.parentId === null && !c.resolved
  ).length;

  return (
    <div className="relative flex min-w-0 flex-1 items-start">
      <div
        className={`min-w-0 flex-1 rounded ${
          unresolved > 0
            ? "bg-amber-100/50 ring-1 ring-amber-200/70 dark:bg-amber-400/10 dark:ring-amber-400/20"
            : ""
        }`}
      >
        {children}
      </div>
      {unresolved > 0 && (
        <button
          data-testid={`block-comment-marker-${blockId}`}
          onClick={() => openThread(blockId)}
          aria-label="Open comments"
          className="ml-1 mt-0.5 flex shrink-0 items-center gap-0.5 rounded px-1 py-0.5 text-xs text-amber-600 transition-colors hover:bg-amber-100 dark:text-amber-400"
        >
          <MessageSquare size={13} />
          {unresolved}
        </button>
      )}
    </div>
  );
}

/** One column of a column_list: a vertical stack of its child blocks. */
function ColumnCell({ block }: { block: EBlock }) {
  const editor = useEditor();
  const children = editor.childrenOf(block.id);
  return (
    <div
      data-testid={`block-${block.id}`}
      data-block-type="column"
      className="min-w-0 flex-1 rounded-md"
    >
      {children.map((c) => (
        <BlockRow key={c.id} block={c} depth={0} hasChildren={editor.blocks.some((x) => x.parentBlockId === c.id)} />
      ))}
    </div>
  );
}

/** File attachment block: upload any file, then a download chip. */
function FileBlockBody({ block }: { block: EBlock }) {
  const editor = useEditor();
  // a gift behind x402: a file its maker keeps unshared, opened with pocket money
  const gift = block.content.gift as Parameters<typeof GiftBlock>[0]["gift"] | undefined;
  if (gift?.spec?.id) return <GiftBlock blockId={block.id} gift={gift} />;
  // an album: several photos in one block, shown as a grid
  const files = block.content.files as AlbumFile[] | undefined;
  if (Array.isArray(files) && files.length) return <AlbumGrid blockId={block.id} files={files} />;
  // an uploaded file or an aindrive link — both preview the same way
  if (block.content.url)
    return <FileAttachment blockId={block.id} url={block.content.url} name={block.content.text ?? ""} />;
  return (
    <FileAttachPicker
      blockId={block.id}
      // a paste can carry a file's NAME without a fetchable url (Notion
      // attachments live behind their auth) — keep the name visible
      pendingName={block.content.text || undefined}
      onFile={(f) => editor.setFileData(block.id, f)}
    />
  );
}

/** Inline picker for the link-to-page block (search existing pages). */
function LinkToPagePicker({ block }: { block: EBlock }) {
  const editor = useEditor();
  const pages = usePagesStore((s) => s.pages);
  const [q, setQ] = useState("");
  const matches = Object.values(pages)
    .filter((p) => !p.isArchived)
    .filter((p) => (p.title || "Untitled").toLowerCase().includes(q.toLowerCase()))
    .slice(0, 8);
  return (
    <div className="my-0.5 w-full rounded-md border border-neutral-200 p-1.5 dark:border-neutral-700">
      <input
        data-testid={`link-page-search-${block.id}`}
        autoFocus
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Link to page…"
        className="mb-1 w-full rounded border border-neutral-200 px-2 py-1 text-sm outline-none dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-200"
      />
      <div className="max-h-40 overflow-y-auto">
        {matches.map((p) => (
          <button
            key={p.id}
            data-testid={`link-page-pick-${p.id}`}
            onClick={() => editor.setLinkTarget(block.id, p.id)}
            className="block w-full truncate rounded px-2 py-1 text-left text-sm text-neutral-700 hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-700"
          >
            {p.icon ? <><PageIcon icon={p.icon} />{" "}</> : ""}
            {p.title || "Untitled"}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Sub-page block: a clickable link to a real child page. */
function ChildPageBody({ block }: { block: EBlock }) {
  const childId = block.content.childPageId;
  const page = usePagesStore((s) => (childId ? s.pages[childId] : undefined));
  if (!childId) {
    return (
      <div className="my-0.5 h-8 w-full animate-pulse rounded-md bg-neutral-100 dark:bg-neutral-800" />
    );
  }
  return (
    <Link
      href={`/p/${childId}`}
      data-testid={`child-page-${block.id}`}
      className="my-0.5 flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-[15px] leading-6 text-neutral-800 transition-colors hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-800"
    >
      <span className="shrink-0 text-base"><PageIcon icon={page?.icon} fallback={<FileText size={18} className="text-neutral-400" />} /></span>
      <span className="truncate border-b border-neutral-200 font-medium dark:border-neutral-700">
        {page?.title || (block.content.text as string) || "Untitled"}
      </span>
    </Link>
  );
}

/** The Turn into submenu, in the original's order and words (measured 2026-09-09 on
 * the ⠿ menu of a text block: Text · Heading 1-4 · Page · Bulleted list ·
 * Numbered list · To-do list · Toggle list · Code · Quote · Callout · Block equation ·
 * Synced block · Toggle heading 1-4 · 2-5 columns). Ours lists the types we have. Labels
 * are t() keys. */
export const TURN_INTO: { type: EBlock["type"]; label: string }[] = [
  { type: "paragraph", label: "Text" },
  { type: "heading1", label: "Heading 1" },
  { type: "heading2", label: "Heading 2" },
  { type: "heading3", label: "Heading 3" },
  { type: "child_page", label: "Page" },
  { type: "bulleted_list", label: "Bulleted list" },
  { type: "numbered_list", label: "Numbered list" },
  { type: "todo", label: "To-do list" },
  { type: "toggle", label: "Toggle list" },
  { type: "code", label: "Code" },
  { type: "quote", label: "Quote" },
  { type: "callout", label: "Callout" },
  { type: "equation", label: "Block equation" },
];

/** The ⠿ grip: draggable AND a click-menu (Delete / Duplicate / Turn into). */
function BlockHandle({ block, halo }: { block: EBlock; halo: { top: number; bottom: number } }) {
  const editor = useEditor();
  const t = useT();
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [turnOpen, setTurnOpen] = useState(false);
  const turnRef = useRef<HTMLDivElement>(null);
  /** the Table section's `Align` submenu (ours — the original has no alignment) */
  const [alignOpen, setAlignOpen] = useState(false);
  const alignRef = useRef<HTMLDivElement>(null);
  const [commentOpen, setCommentOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  const addComment = useCommentsStore((s) => s.add);
  const openThread = useCommentUi((s) => s.open);
  const pathname = usePathname();
  const pageId = pathname?.match(/\/p\/([0-9a-f-]{36})/)?.[1] ?? null;

 // the menu is portalled, so `ref` (the handle's box) is not its ancestor:
 // both count as inside, or the first mousedown on the menu closes it
  const menuRef = useRef<HTMLDivElement>(null);
  useAnchored(open, ref, menuRef, { gap: 2 });
  useDismiss(open, () => {
    setOpen(false);
    setTurnOpen(false);
    setAlignOpen(false);
 // the submenus are portalled too — all count as inside
  }, ref, menuRef, alignRef, turnRef);

 // The Turn into submenu: portalled (the menu scrolls, so an in-flow child was
 // clipped to nothing — "Turn into does nothing"), placed beside the menu
 // with its top on the Turn into row, kept inside the window. Measured on the
 // original: the panel opens on HOVER, sits at menu.right − 4px, 220 wide,
 // 28px rows, same 10px radius and shadow as the menu.
  useEffect(() => {
    if (!turnOpen) return;
    const panel = turnRef.current;
    const row = document.querySelector(`[data-testid="block-turninto-${block.id}"]`);
    const menu = menuRef.current;
    if (!panel || !(row instanceof HTMLElement) || !menu) return;
    const rb = row.getBoundingClientRect(), mb = menu.getBoundingClientRect();
    const margin = 8;
    panel.style.left = `${mb.right - 4}px`;
    panel.style.top = `${rb.top}px`;
    panel.style.visibility = "visible";
    const pb = panel.getBoundingClientRect();
    if (pb.right > window.innerWidth - margin) panel.style.left = `${mb.left - pb.width + 4}px`;
    if (pb.bottom > window.innerHeight - margin) panel.style.top = `${Math.max(margin, window.innerHeight - margin - pb.height)}px`;
  }, [turnOpen, block.id]);

 // place the Align submenu beside its row and keep it in the window
  useEffect(() => {
    if (!alignOpen) return;
    const panel = alignRef.current;
    const row = document.querySelector(`[data-testid="block-table-align-${block.id}"]`);
    const menu = menuRef.current;
    if (!panel || !(row instanceof HTMLElement) || !menu) return;
    const rb = row.getBoundingClientRect(), mb = menu.getBoundingClientRect();
    const margin = 8;
    panel.style.left = `${mb.right + 4}px`;
    panel.style.top = `${rb.top}px`;
    panel.style.visibility = "visible";
    const pb = panel.getBoundingClientRect();
    if (pb.right > window.innerWidth - margin) panel.style.left = `${mb.left - pb.width - 4}px`;
    if (pb.bottom > window.innerHeight - margin) panel.style.top = `${window.innerHeight - margin - pb.height}px`;
  }, [alignOpen, block.id]);

  async function submitComment() {
    const body = draft.trim();
    if (!body || !pageId) return;
    setDraft("");
    setCommentOpen(false);
    await addComment(pageId, body, block.id);
 // open the freshly-created thread beside the block
    openThread(block.id);
  }

  return (
    <div ref={ref} className="relative">
      <button
        tabIndex={-1}
        data-testid={`block-handle-${block.id}`}
        draggable
        onDragStart={(e) => {
 // ghost: the actual block rendered as the drag image
          const el = document.querySelector(`[data-testid="block-${block.id}"]`);
          if (el instanceof HTMLElement && e.dataTransfer) {
            e.dataTransfer.setDragImage(el, 8, 8);
            e.dataTransfer.effectAllowed = "move";
          }
          e.dataTransfer?.setData(BLOCK_DRAG_MIME, block.id);
          editor.onDragStart(block.id);
        }}
        onDragEnd={() => editor.onDragEnd()}
        onClick={() => {
 // Measured on the original: on an EMPTY line the ⠿ click opens the block
 // type picker straight away (the same panel the + opens, with the filter
 // placeholder) — there is nothing to act on, so Turn into is the whole menu.
          const empty = block.type === "paragraph" && (block.content.text ?? "").trim() === "";
          if (empty) {
            editor.insertBelow(block.id); // reuses this empty line and opens the picker on it
            return;
          }
          setOpen((v) => !v);
        }}
        className="flex h-6 w-[18px] cursor-grab items-center justify-center rounded text-neutral-300 transition-colors hover:bg-neutral-100 hover:text-neutral-500 active:cursor-grabbing dark:text-neutral-600 dark:hover:bg-neutral-800"
        aria-label="Block actions (drag to reorder)"
      >
        <GripVertical size={15} />
      </button>
      {open &&
        (() => {
          const row = document.querySelector(`[data-testid="block-${block.id}"]`);
          return row
            ? createPortal(
                <div
                  data-testid={`block-halo-${block.id}`}
                  aria-hidden="true"
                  style={{ top: halo.top, bottom: halo.bottom }}
                  className="pointer-events-none absolute inset-x-0.5 z-0 rounded bg-[rgba(35,131,226,0.14)]"
                />,
                row
              )
            : null;
        })()}
      {open &&
        createPortal(
 // portalled and placed by useAnchored: in the page it was `absolute left-5
 // top-0`, so on a line near the bottom of the window the menu ran 106px past
 // it and the main scroller clipped what was left
          <div
            ref={menuRef}
            style={{ visibility: "hidden" }}
            className="popover-anim fixed z-50 w-44 overflow-y-auto rounded-lg border border-neutral-200 bg-white py-1 shadow-xl dark:border-neutral-700 dark:bg-neutral-800"
 // hovering any other row folds the Turn into panel; the pointer travelling into
 // the (portalled) panel itself fires nothing here, so it stays open
            onMouseOver={(e) => {
              if (turnOpen && !(e.target as HTMLElement).closest("[data-turn-into]")) setTurnOpen(false);
            }}
          >
          {block.type === "table" && block.content.table && (() => {
            const table = block.content.table;
 // null when the cells disagree; "default" reads as left
            const raw = uniformField(table, "align");
            const align: Align | null = raw == null ? null : ((raw === "default" ? "left" : raw) as Align);
            return (
              <>
                {/* Measured: the original opens this menu on a table with a Table
                    section on top — Turn into database / Fit to width /
                    Header row / Header column (both labelled "Header row" there, and told
                    apart only by their icon). Ours carries the two header
                    toggles plus Align, which the original does not have.
                    e2e/fixtures/notion-table-block-menu.json */}
                <div
                  data-testid={`block-table-section-${block.id}`}
                  className="px-3 pb-0.5 pt-1 text-xs font-medium text-neutral-500 dark:text-neutral-400"
                >
                  {t("Table")}
                </div>
                <MenuToggle
                  testid={`block-table-headerrow-${block.id}`}
                  icon={<PanelTop size={13} />}
                  label={t("Header row")}
                  on={!!table.headerRow}
                  onClick={() => editor.updateTable(block.id, { ...table, headerRow: !table.headerRow })}
                />
                <MenuToggle
                  testid={`block-table-headercol-${block.id}`}
                  icon={<PanelLeft size={13} />}
                  label={t("Header column")}
                  on={!!table.headerCol}
                  onClick={() => editor.updateTable(block.id, { ...table, headerCol: !table.headerCol })}
                />
                <div>
                  <MenuBtn
                    testid={`block-table-align-${block.id}`}
                    icon={<TextAlignStart size={13} />}
                    label={t("Sort")}
                    onClick={() => setAlignOpen((v) => !v)}
                  />
                  {/* portalled: the menu box scrolls (overflow-y-auto), and an
                      absolutely positioned child of it gets clipped on the x
                      axis — the submenu was in the DOM but invisible. */}
                  {alignOpen && createPortal(
                    <div
                      ref={alignRef}
                      data-testid={`block-table-align-menu-${block.id}`}
                      style={{ visibility: "hidden" }}
                      className="popover-anim fixed z-[60] w-36 rounded-lg border border-neutral-200 bg-white py-1 shadow-xl dark:border-neutral-700 dark:bg-neutral-800"
                    >
                      {ALIGNS.map((a) => (
                        <button
                          key={a}
                          data-testid={`block-table-align-${block.id}-${a}`}
                          data-on={align === a ? "1" : undefined}
                          onClick={() => {
                            setAlignOpen(false);
                            setOpen(false);
                            editor.updateTable(block.id, setAll(table, "align", a));
                          }}
                          className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-neutral-700 transition-colors hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-700"
                        >
                          {a === "left" ? <TextAlignStart size={13} /> : a === "center" ? <TextAlignCenter size={13} /> : <TextAlignEnd size={13} />}
                          <span className="flex-1">{t(a === "left" ? "Left" : a === "center" ? "Center" : "Right")}</span>
                          {align === a && <Check size={12} className="text-neutral-400" />}
                        </button>
                      ))}
                    </div>,
                    document.body
                  )}
                </div>
                <div className="my-1 h-px bg-neutral-100 dark:bg-neutral-700" />
              </>
            );
          })()}
          <MenuBtn
            testid={`block-delete-${block.id}`}
            icon={<Trash2 size={13} />}
            label={t("Delete")}
            danger
            onClick={() => {
              setOpen(false);
              editor.deleteBlock(block.id);
            }}
          />
          <MenuBtn
            testid={`block-duplicate-${block.id}`}
            icon={<Copy size={13} />}
            label={t("Duplicate")}
            onClick={() => {
              setOpen(false);
              editor.duplicateBlock(block.id);
            }}
          />
          <MenuBtn
            testid={`block-copylink-${block.id}`}
            icon={<Link2 size={13} />}
            label={t("Copy link to block")}
            onClick={() => {
              setOpen(false);
              void copyText(
                `${window.location.origin}${window.location.pathname}#b-${block.id}`
              );
            }}
          />
          <MenuBtn
            testid={`block-comment-${block.id}`}
            icon={<MessageSquare size={13} />}
            label={locale === "en" ? "Comment" : t("Comments")}
            onClick={() => {
              setOpen(false);
              setTurnOpen(false);
              setCommentOpen(true);
            }}
          />
          <div data-turn-into onMouseEnter={() => setTurnOpen(true)}>
            <MenuBtn
              testid={`block-turninto-${block.id}`}
              icon={<Repeat size={13} />}
              label={t("Turn into")}
              onClick={() => setTurnOpen((v) => !v)}
            />
          </div>
          </div>,
          document.body
        )}
      {open &&
        turnOpen &&
        createPortal(
          <div
            ref={turnRef}
            data-testid={`block-turninto-menu-${block.id}`}
            style={{ visibility: "hidden" }}
            className="popover-anim fixed z-50 max-h-[80vh] w-[220px] overflow-y-auto rounded-lg border border-neutral-200 bg-white py-1 shadow-xl dark:border-neutral-700 dark:bg-neutral-800"
          >
            {TURN_INTO.map((o) => (
              <button
                key={o.type}
                data-testid={`block-turninto-${block.id}-${o.type}`}
                onClick={() => {
                  setOpen(false);
                  setTurnOpen(false);
                  editor.turnInto(block.id, o.type);
                }}
                className="block h-7 w-full px-3 text-left text-sm leading-7 text-neutral-700 transition-colors hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-700"
              >
                {t(o.label)}
              </button>
            ))}
          </div>,
          document.body
        )}
      {commentOpen &&
        pageId &&
        createPortal(
          <div
            className="fixed inset-0 z-[60]"
            onMouseDown={() => setCommentOpen(false)}
          >
            <div
              className="popover-anim absolute left-1/2 top-24 w-80 -translate-x-1/2 rounded-lg border border-neutral-200 bg-white p-3 shadow-xl dark:border-neutral-700 dark:bg-neutral-800"
              onMouseDown={(e) => e.stopPropagation()}
            >
              <div className="mb-2 text-xs font-medium text-neutral-500">
                Comment on this block
              </div>
              <input
                autoFocus
                data-testid="block-comment-input"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (!isImeComposing(e) && e.key === "Enter") {
                    e.preventDefault();
                    void submitComment();
                  } else if (e.key === "Escape") {
                    setCommentOpen(false);
                  }
                }}
                placeholder="Add a comment…"
                className="w-full rounded border border-neutral-300 bg-transparent px-2 py-1 text-sm text-neutral-800 outline-none placeholder:text-neutral-400 dark:border-neutral-600 dark:text-neutral-200"
              />
              <div className="mt-2 flex justify-end">
                <button
                  data-testid="block-comment-submit"
                  onClick={() => void submitComment()}
                  className="rounded bg-blue-500 px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-blue-600"
                >
                  Comment
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}

// Shared type geometry for the code editor + its highlight overlay — they MUST
// match exactly (font, size, line-height, padding, wrapping) so the colored
// layer aligns under the transparent caret layer.
const CODE_TYPE_CLASS =
  "whitespace-pre-wrap break-words py-3 font-mono text-[13.6px] leading-[20.4px]";

// The language select and Copy float over the block and show on hover. A touch
// screen has no hover (Tailwind only applies group-hover under (hover: hover)),
// so there `touch-reveal` keeps them shown, Copy grows to a 36px target, and the
// box's top padding grows to hold that row (top-2 + h-9 = 44px = pt-11) instead of
// covering the first line. A saved AI prompt page is one long code block, and
// selecting ~15k characters by hand on a phone is not a way to copy it.
// Exported for scripts/prompt-export-ui.check.mts, which compiles them with Tailwind.
export const CODE_BOX_CLASS =
  "group/code relative w-full rounded-[10px] bg-[rgba(66,35,3,0.03)] px-[22px] py-6 dark:bg-white/[0.06] [@media(hover:none)]:pt-11";
export const CODE_TOOLBAR_CLASS =
  "absolute left-3 right-3 top-2 flex items-center justify-between touch-reveal opacity-0 transition-opacity focus-within:opacity-100 group-hover/code:opacity-100";
export const CODE_COPY_CLASS =
  "flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-neutral-500 transition-colors hover:bg-neutral-200/60 dark:hover:bg-neutral-700 [@media(hover:none)]:h-9 [@media(hover:none)]:min-w-9 [@media(hover:none)]:justify-center [@media(hover:none)]:px-2.5";

/** Code block: language select + copy button + caption + a dependency-free
 * syntax-highlight overlay painted behind a transparent-text editor.
 * The <Editable> is untouched (full editing/caret model); we only read its
 * text to paint colors behind it. */
function CodeBlock({ block }: { block: EBlock }) {
  const editor = useEditor();
  const t = useT();
  const [copied, setCopied] = useState(false);
  const caption = (block.content.caption as string) ?? "";
  const text = (block.content.text as string) ?? "";
  const language = block.content.language ?? "plain";
 // The overlay is rendered from the stored text (source of truth on
 // mount/reload/remote/version bump). During active typing the editor's DOM
 // leads React state, so we ALSO repaint the overlay imperatively on input —
 // no extra React state, no effect (keeps the editor's model untouched).
  const overlayRef = useRef<HTMLPreElement>(null);

  return (
    // Original (measured 2026-08-26): wrapper 8, container r10 bg rgba(66,35,3,.03) with 24/22 padding,
    // and inside it the editing area 12/12 — a one-line code block is 108.4. Language and copy float over the
    // container only on hover, and the caption takes space only when there is one.
    <div className="w-full px-0.5 py-2">
    <div className={CODE_BOX_CLASS}>
      <div className={CODE_TOOLBAR_CLASS}>
        <MemorySelect
          testid={`code-lang-${block.id}`}
          value={language}
          options={CODE_LANGUAGES.map((l) => ({ value: l, label: l }))}
          onChange={(v) => editor.setLanguage(block.id, v)}
        />
        <button
          data-testid={`code-copy-${block.id}`}
          onClick={async () => {
            if (await copyText(text)) {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }
          }}
          className={CODE_COPY_CLASS}
          aria-label="Copy code"
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
          {copied ? t("Copied") : t("Copy")}
        </button>
      </div>
      <div
        className="relative"
        onInput={(e) => {
          const typed = (e.target as HTMLElement).innerText.replace(/\n$/, "");
          if (overlayRef.current)
            overlayRef.current.innerHTML = highlightCode(typed, language) + "\n";
        }}
      >
        {/* colored layer (read-only, non-interactive) sits behind the caret layer */}
        <pre
          ref={overlayRef}
          aria-hidden
          data-testid={`code-highlight-${block.id}`}
          className={`pointer-events-none absolute inset-0 m-0 overflow-hidden text-neutral-800 dark:text-neutral-200 ${CODE_TYPE_CLASS}`}
          dangerouslySetInnerHTML={{ __html: highlightCode(text, language) + "\n" }}
        />
        {/* editor on top: transparent text so only the colored layer shows */}
        <Editable
          block={block}
          className={`relative caret-neutral-800 text-transparent dark:caret-neutral-200 ${CODE_TYPE_CLASS}`}
        />
      </div>
      {caption !== "" && (
      <input
        data-testid={`code-caption-${block.id}`}
        value={caption}
        onChange={(e) => editor.setImageMeta(block.id, { caption: e.target.value })}
        placeholder="Add a caption"
        className="w-full bg-transparent px-3 py-1 text-xs text-neutral-500 outline-none placeholder:text-neutral-300 dark:placeholder:text-neutral-600"
      />
      )}
    </div>
    </div>
  );
}

// Callout background palette (name → light / dark bg classes).
const CALLOUT_COLORS: { name: string; bg: string }[] = [
  { name: "default", bg: "bg-[#f9f8f7] dark:bg-neutral-800/80" },
  { name: "gray", bg: "bg-neutral-200/70 dark:bg-neutral-700/50" },
  { name: "brown", bg: "bg-amber-100/70 dark:bg-amber-900/25" },
  { name: "orange", bg: "bg-orange-100 dark:bg-orange-900/25" },
  { name: "yellow", bg: "bg-yellow-100 dark:bg-yellow-900/25" },
  { name: "green", bg: "bg-green-100 dark:bg-green-900/25" },
  { name: "blue", bg: "bg-blue-100 dark:bg-blue-900/25" },
  { name: "purple", bg: "bg-purple-100 dark:bg-purple-900/25" },
  { name: "pink", bg: "bg-pink-100 dark:bg-pink-900/25" },
  { name: "red", bg: "bg-red-100 dark:bg-red-900/25" },
];
const calloutBg = (color?: string) =>
  (CALLOUT_COLORS.find((c) => c.name === color) ?? CALLOUT_COLORS[0]).bg;

/** Callout: a pickable emoji icon (any emoji, via the full IconPicker) + a
 * background color (was a hardcoded 💡 on neutral). Child blocks render
 * INSIDE the colored box, under the first line — the way Notion draws a
 * multi-block callout. An explicit `icon: null` means "no icon" (Notion
 * callouts can drop theirs); only a missing key falls back to 💡. */
function CalloutBlock({ block }: { block: EBlock }) {
  const editor = useEditor();
  const [colorOpen, setColorOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const icon =
    block.content.icon === null ? null : ((block.content.icon as string | undefined) ?? "💡");
  const color = (block.content.color as string) ?? "default";
  const children = editor.childrenOf(block.id);

 // dismiss:manual — the callout's colour menu is `absolute` inside `ref`, not
 // portalled, so a click on it really is inside the ref. (The block menu above
 // IS portalled and uses useDismiss with both refs.)
  useEffect(() => {
    if (!colorOpen) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setColorOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [colorOpen]);

  return (
    <div
      data-testid={`callout-${block.id}`}
      data-color={color}
      className="w-full px-0.5 py-2"
    >
    {/* Original (measured 2026-08-26): 82 = 8 + (1+12 + 6+28+6 + 12+1) + 8 */}
    <div className={`group/callout relative w-full rounded-[10px] border border-transparent p-3 ${calloutBg(color)}`}>
      <div className="flex w-full items-start">
      {icon !== null && (
        <IconPicker
          icon={icon}
          onChange={(v) => editor.setImageMeta(block.id, { icon: v ?? "💡" })}
          testid={`callout-icon-${block.id}`}
          pickerTestid={`callout-icon-picker-${block.id}`}
          triggerClassName="mt-[1.5px] flex h-6 w-6 shrink-0 select-none items-center justify-center rounded text-[20px] leading-6 transition-colors hover:bg-black/5 dark:hover:bg-white/10"
          placeholder="💡"
          allowRemove={false}
        />
      )}
      <div className="min-w-0 flex-1">
      {/* the original's callout is a container: once its text lives in a first
          child paragraph (Enter did that), the box shows only children */}
      {!((block.content.text ?? "") === "" && children.length > 0) && (
      <Editable
        block={block}
        className="m-1.5 px-0.5 py-0.5 text-base leading-6 text-neutral-800 dark:text-neutral-200"
      />
      )}
      {/* Original (measured 2026-09-10): a callout's child text sits at the same x as the callout's own text
          (366/417 → child 411/417). Our children used to start 6px to the left. */}
      {children.length > 0 && (
        <div className="pl-1.5">
          {children.map((c) => (
            <BlockRow key={c.id} block={c} depth={0} indentPx={0} parentType="callout" hasChildren={editor.blocks.some((x) => x.parentBlockId === c.id)} />
          ))}
        </div>
      )}
      </div>
      {/* color menu */}
      <div ref={ref} className="relative shrink-0">
        <button
          data-testid={`callout-color-${block.id}`}
          onClick={() => setColorOpen((v) => !v)}
          aria-label="Callout color"
          className="rounded p-1 text-neutral-400 opacity-0 transition-opacity hover:bg-black/5 group-hover/callout:opacity-100 dark:hover:bg-white/10"
        >
          <span className={`block h-3.5 w-3.5 rounded-full border border-black/10 ${calloutBg(color)}`} />
        </button>
        {colorOpen && (
          <div
            data-testid={`callout-color-menu-${block.id}`}
            className="popover-anim absolute right-0 top-8 z-40 grid w-40 grid-cols-5 gap-1 rounded-lg border border-neutral-200 bg-white p-2 shadow-xl dark:border-neutral-700 dark:bg-neutral-800"
          >
            {CALLOUT_COLORS.map((c) => (
              <button
                key={c.name}
                data-testid={`callout-color-opt-${block.id}-${c.name}`}
                onClick={() => {
                  editor.setImageMeta(block.id, { color: c.name });
                  setColorOpen(false);
                }}
                aria-label={c.name}
                className={`h-6 w-6 rounded border border-black/10 ${c.bg} ${
                  color === c.name ? "ring-2 ring-blue-400" : ""
                }`}
              />
            ))}
          </div>
        )}
      </div>
      </div>
    </div>
    </div>
  );
}

/** A menu row with a switch on the right — the original's Header row/column rows.
 * Track 30×18 (radius 44), knob 14, on = rgb(39,131,222): measured. */
function MenuToggle({
  testid,
  icon,
  label,
  on,
  onClick,
}: {
  testid: string;
  icon: React.ReactNode;
  label: string;
  on: boolean;
  onClick: () => void;
}) {
  return (
    <button
      data-testid={testid}
      data-on={on ? "1" : "0"}
      onClick={onClick}
      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-neutral-700 transition-colors hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-700"
    >
      {icon}
      <span className="flex-1 truncate">{label}</span>
      <span
        style={{ width: 30, height: 18, borderRadius: 44, background: on ? "rgb(39, 131, 222)" : "rgba(135, 131, 120, 0.3)" }}
        className="relative shrink-0"
      >
        <span
          style={{ position: "absolute", top: 2, left: on ? 14 : 2, width: 14, height: 14, borderRadius: 44, background: "rgb(255, 255, 255)", transition: "left 0.15s ease-in-out" }}
        />
      </span>
    </button>
  );
}

function MenuBtn({
  testid,
  icon,
  label,
  onClick,
  danger,
}: {
  testid: string;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      data-testid={testid}
      onClick={onClick}
      className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-700 ${
        danger ? "text-red-500" : "text-neutral-700 dark:text-neutral-200"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

function BlockBody({ block, depth, listFirst, listLast, inList }: { block: EBlock; depth: number; listFirst: boolean; listLast: boolean; inList: boolean }) {
  const editor = useEditor();
  const t = useT();
  const listTop = listFirst ? "pt-1.5" : "pt-[1px]";
  const listBottom = listLast ? "pb-1.5" : "pb-[1px]";

  switch (block.type) {
    case "divider":
      return (
        <div className="w-full px-0.5 py-1.5">
          <hr className="h-px border-0 bg-[rgba(28,19,1,0.11)] dark:bg-white/15" />
        </div>
      );

    case "toc": {
 // live outline of the page's headings; entries scroll to their block
      const heads = editor.blocks.filter((b) =>
        ["heading1", "heading2", "heading3"].includes(b.type)
      );
      return (
        <nav data-testid={`block-toc-${block.id}`} className="w-full py-1">
          {heads.length === 0 && (
            <p className="text-sm text-neutral-400">Add headings to build the outline.</p>
          )}
          {heads.map((h) => (
            <button
              key={h.id}
              data-testid={`toc-entry-${h.id}`}
              onClick={() => {
                const el = document.querySelector(`[data-testid="block-${h.id}"]`);
                el?.scrollIntoView({ block: "center" });
                el?.setAttribute("data-flash", "1");
                setTimeout(() => el?.removeAttribute("data-flash"), 2000);
              }}
              style={{ paddingLeft: (Number(h.type.slice(-1)) - 1) * 16 }}
              className="block w-full truncate py-0.5 text-left text-sm text-neutral-500 underline decoration-neutral-300 underline-offset-2 hover:text-neutral-800 dark:hover:text-neutral-200"
            >
              {h.content.text || "Untitled heading"}
            </button>
          ))}
        </nav>
      );
    }

    case "image":
      return <ImageBody block={block} />;

    case "video":
     // Video is separate — the original opens the `Upload / Link` popover here (docs/notion-video.md).
     // bookmark and embed are URL-only, so they keep the old path.
      return (
        <VideoBody
          blockId={block.id}
          url={typeof block.content.url === "string" ? block.content.url : ""}
          onUrl={(u) => editor.setImageUrl(block.id, u)}
        />
      );

    case "bookmark":
    case "embed":
      return <EmbedBody block={block} kind={block.type} />;

    case "child_page":
      return <ChildPageBody block={block} />;

    case "file":
      return <FileBlockBody block={block} />;

    case "button":
      return <ButtonBlock block={block} />;

    case "template_button":
      return <TemplateButtonBody block={block} />;

    case "equation":
      return <EquationBody block={block} />;

    case "ai_prompt":
      return <AiPromptBody block={block} />;

    case "link_to_page":
 // link to an EXISTING page: picker until a target is chosen, then the
 // same link chip as a child page
      return block.content.childPageId ? (
        <ChildPageBody block={block} />
      ) : (
        <LinkToPagePicker block={block} />
      );

    case "table":
      return <TableBlock block={block} />;

    case "database":
      return block.content.databaseId ? (
        <DatabaseBlock
          databaseId={block.content.databaseId}
          fullPage={block.content.fullPage}
          linkedViewId={block.content.linkedViewId}
          initialViewType={
            typeof block.content.initialViewType === "string" ? block.content.initialViewType : undefined
          }
        />
      ) : (
        <div className="my-2 h-16 w-full animate-pulse rounded-md bg-neutral-100 dark:bg-neutral-800" />
      );

    case "code":
      return <CodeBlock block={block} />;

    case "todo":
      return (
        <div className={`flex w-full items-start gap-0.5 ${listTop} ${listBottom}`}>
          <input
            type="checkbox"
            data-testid={`todo-checkbox-${block.id}`}
            checked={block.content.checked ?? false}
            onChange={(e) => editor.setChecked(block.id, e.target.checked)}
            className="mx-1 mt-1.5 h-4 w-4 shrink-0 cursor-pointer accent-blue-500 max-md:mt-1 max-md:h-5 max-md:w-5"
          />
          <Editable
            block={block}
            className={`flex-1 px-1.5 py-0.5 text-base leading-6 ${
              block.content.checked
                ? "text-neutral-400 line-through"
                : "text-neutral-800 dark:text-neutral-200"
            }`}
          />
        </div>
      );

    case "toggle": {
      const children = editor.childrenOf(block.id);
      const expanded = block.content.expanded ?? true;
      return (
        <div className={`w-full ${listTop} ${listBottom}`}>
          <div className="flex items-start gap-0.5">
            <button
              data-testid={`toggle-expand-${block.id}`}
              onClick={() => editor.toggleExpand(block.id)}
              className="mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-800"
              aria-label={expanded ? "Collapse" : "Expand"}
            >
              {/* a filled triangle in text ink, not a stroke chevron (R2#7) */}
              <span
                aria-hidden="true"
                className={`text-[10px] leading-none text-neutral-800 transition-transform duration-150 dark:text-neutral-200 ${
                  expanded ? "rotate-90" : ""
                }`}
              >
                ▶
              </span>
            </button>
            <Editable
              block={block}
              className="flex-1 px-1.5 py-0.5 text-base leading-6 text-neutral-800 dark:text-neutral-200"
            />
          </div>
          {/* Original (measured 2026-09-10): a toggle's children sit at the same x as the toggle text — 32px from the box.
              A child's own indent restarts from this wrapper (0). Before, we added (depth+1)*24 again inside a box
              that already had padding, so every level drifted. */}
          {expanded && (
            <div className="ml-8">
              {children.length === 0 ? (
                <button
                  data-testid="toggle-add-inside"
                  onClick={() => editor.addInsideToggle(block.id)}
 // Original (measured 2026-08-26): an empty toggle's hint row is 40px — the same height as one paragraph line
                  className="ml-1 flex h-10 items-center rounded px-0.5 text-base text-neutral-400 transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-800"
                >
                  {t("Empty toggle. Click or drag blocks inside.")}
                </button>
              ) : (
                children.map((c) => <BlockRow key={c.id} block={c} depth={depth + 1} indentPx={0} parentType={block.type} hasChildren={editor.blocks.some((x) => x.parentBlockId === c.id)} />)
              )}
            </div>
          )}
        </div>
      );
    }

    case "bulleted_list":
      return (
        <div className={`flex w-full items-start gap-0.5 ${listTop} ${listBottom}`}>
          <span className="mt-0.5 w-6 shrink-0 select-none text-center text-base leading-6 text-neutral-800 dark:text-neutral-200">
            {bulletGlyph(editor.listLevel(block))}
          </span>
          <Editable
            block={block}
            className="flex-1 px-1.5 py-0.5 text-base leading-6 text-neutral-800 dark:text-neutral-200"
          />
        </div>
      );

    case "numbered_list":
      return (
        <div className={`flex w-full items-start gap-0.5 ${listTop} ${listBottom}`}>
          <span className="mt-0.5 w-6 shrink-0 select-none text-right text-base leading-6 text-neutral-800 dark:text-neutral-200">
            {numberLabel(editor.numberOf(block), editor.listLevel(block))}.
          </span>
          <Editable
            block={block}
            className="flex-1 px-1.5 py-0.5 text-base leading-6 text-neutral-800 dark:text-neutral-200"
          />
        </div>
      );

    case "quote":
      return (
        <div className="w-full border-l-[3px] border-neutral-800 py-2 pl-4 dark:border-neutral-300 [&>div]:min-h-6">
          <Editable
            block={block}
            className="px-2 py-0 text-base leading-6 text-neutral-700 dark:text-neutral-300"
          />
        </div>
      );

    case "callout":
      return <CalloutBlock block={block} />;

    case "heading1":
      return (
        <div className="w-full pb-1.5 pt-[30px]">
          <Editable
            block={block}
            placeholder="Heading 1"
            className="w-full px-0.5 py-0.5 text-[30px] font-semibold leading-[39px] text-neutral-900 dark:text-neutral-100"
          />
        </div>
      );
    case "heading2":
      return (
        <div className="w-full pb-1.5 pt-[26px]">
          <Editable
            block={block}
            placeholder="Heading 2"
            className="w-full px-0.5 py-0.5 text-[24px] font-semibold leading-[31.2px] text-neutral-900 dark:text-neutral-100"
          />
        </div>
      );
    case "heading3":
      return (
        <div className="w-full pb-1.5 pt-[22px]">
          <Editable
            block={block}
            placeholder="Heading 3"
            className="w-full px-0.5 py-0.5 text-[20px] font-semibold leading-[26px] text-neutral-900 dark:text-neutral-100"
          />
        </div>
      );

    default:
      return (
 // Original (measured 2026-08-26): a paragraph nested in a list item is 30 = 1 + 28 + 1
        <div className={inList ? "w-full py-[1px]" : "w-full py-1.5"}>
          <Editable
            block={block}
 // one rule decides the empty line's hint, the dictionary decides the language:
 // the type menu open on this line → the filter hint, otherwise the usual one
            placeholder={t(editor.slashBareBlockId === block.id ? "Type to filter…" : "Press '/' for commands")}
            bare={editor.slashBareBlockId === block.id}
            className="w-full px-0.5 py-0.5 text-base leading-6 text-neutral-800 dark:text-neutral-200"
          />
        </div>
      );
  }
}

/** Normalize common share URLs to their embeddable form (YouTube watch → embed). */
function toEmbedUrl(url: string): string {
  const yt = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]{11})/);
  if (yt) return `https://www.youtube.com/embed/${yt[1]}`;
  return url;
}

/** Bookmark (link card), video, and generic embed blocks — all URL-based. */
function EmbedBody({ block, kind }: { block: EBlock; kind: "bookmark" | "video" | "embed" }) {
  const editor = useEditor();
  const [draft, setDraft] = useState("");
  const url = typeof block.content.url === "string" ? block.content.url : "";
  const aindrive = useAindriveInfo();

  // an aindrive file link shows the file, whichever block it landed in
  if (url && parseAindriveUrl(url, aindrive?.base))
    return <FileAttachment blockId={block.id} url={url} name={block.content.text && block.content.text !== url ? block.content.text : ""} />;

  if (!url) {
    const placeholder =
      kind === "bookmark"
        ? "Paste a link to bookmark"
        : kind === "video"
          ? "Paste a video URL (YouTube, .mp4…)"
          : "Paste any URL to embed";
    const commit = () => {
      const v = draft.trim();
      if (v) editor.setImageUrl(block.id, v);
    };
    return (
      <div className="my-1 flex w-full items-center gap-2 rounded-md bg-neutral-100 px-3 py-2.5 dark:bg-neutral-800/80">
        <input
          autoFocus
          data-testid={`${kind}-url-input-${block.id}`}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={placeholder}
          onKeyDown={(e) => {
            if (!isImeComposing(e) && e.key === "Enter") commit();
          }}
          className="flex-1 bg-transparent text-sm text-neutral-700 outline-none placeholder:text-neutral-400 dark:text-neutral-300"
        />
        <button
          data-testid={`${kind}-embed-${block.id}`}
          onClick={commit}
          className="rounded border border-neutral-300 px-2.5 py-1 text-xs font-medium text-neutral-600 transition-colors hover:bg-neutral-200 dark:border-neutral-600 dark:text-neutral-300 dark:hover:bg-neutral-700"
        >
          Embed
        </button>
      </div>
    );
  }

  if (kind === "bookmark") {
    let host = url;
    try {
      host = new URL(url).host;
    } catch {}
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        data-testid={`bookmark-card-${block.id}`}
        className="my-1 flex w-full items-center gap-3 rounded-md border border-neutral-200 px-3 py-2.5 transition-colors hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
      >
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-neutral-800 dark:text-neutral-200">{host}</div>
          <div className="truncate text-xs text-neutral-400">{url}</div>
        </div>
      </a>
    );
  }

  const isFile = kind === "video" && /\.(mp4|webm|ogg)(\?|$)/i.test(url);
  return (
    <div className="my-1 w-full" data-testid={`${kind}-frame-${block.id}`}>
      {isFile ? (
 // eslint-disable-next-line jsx-a11y/media-has-caption
        <video src={url} controls className="max-h-[420px] w-full rounded-md" />
      ) : (
        <iframe
          src={toEmbedUrl(url)}
          title={kind}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
          className="aspect-video w-full rounded-md border border-neutral-200 dark:border-neutral-700"
        />
      )}
    </div>
  );
}

function ImageBody({ block }: { block: EBlock }) {
  const editor = useEditor();
  const inputRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [resizing, setResizing] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  async function uploadFile(file: File) {
    setUploading(true);
    try {
      const up = await uploadBlob(file);
      if (up) editor.setImageUrl(block.id, up.url);
    } finally {
      setUploading(false);
    }
  }

  if (!block.content.url) {
    return (
      <div className="my-1 flex w-full items-center gap-2 rounded-md bg-neutral-100 px-3 py-2.5 dark:bg-neutral-800/80">
        <input
          ref={inputRef}
          autoFocus
          data-testid="image-url-input"
          placeholder="Paste an image URL, or upload a file"
          onKeyDown={(e) => {
            if (!isImeComposing(e) && e.key === "Enter") {
              const url = (e.target as HTMLInputElement).value.trim();
              if (url) editor.setImageUrl(block.id, url);
            }
          }}
          className="flex-1 bg-transparent text-sm text-neutral-700 outline-none placeholder:text-neutral-400 dark:text-neutral-300"
        />
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          data-testid={`image-upload-input-${block.id}`}
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void uploadFile(f);
          }}
        />
        <button
          data-testid={`image-upload-button-${block.id}`}
          disabled={uploading}
          onClick={() => fileRef.current?.click()}
          className="rounded border border-neutral-300 px-2.5 py-1 text-xs font-medium text-neutral-600 transition-colors hover:bg-neutral-200 disabled:opacity-50 dark:border-neutral-600 dark:text-neutral-300 dark:hover:bg-neutral-700"
        >
          {uploading ? "Uploading\u2026" : "Upload"}
        </button>
        <button
          onClick={() => {
            const url = inputRef.current?.value.trim();
            if (url) editor.setImageUrl(block.id, url);
          }}
          className="rounded bg-neutral-900 px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-neutral-700 dark:bg-neutral-200 dark:text-neutral-900"
        >
          Embed
        </button>
      </div>
    );
  }

  const width = (block.content.width as number | undefined) ?? undefined;
  const align = (block.content.align as string) ?? "left";
  const caption = (block.content.caption as string) ?? "";

  const alignCls =
    align === "center" ? "mx-auto" : align === "full" ? "w-full" : "";

  function onResizeStart(e: React.PointerEvent) {
    e.preventDefault();
    e.stopPropagation();
    setResizing(true);
    const startX = e.clientX;
    const startW = imgRef.current?.offsetWidth ?? 400;

    function onMove(ev: PointerEvent) {
      const delta = ev.clientX - startX;
      const maxW = containerRef.current?.offsetWidth ?? 800;
      const newW = Math.max(100, Math.min(startW + delta, maxW));
      editor.setImageMeta(block.id, { width: newW });
    }
    function onUp() {
      setResizing(false);
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
    }
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  }

  return (
    <div ref={containerRef} className="group/img my-1.5 w-full">
      {/* maxWidth caps a stored pixel width so the image can never overflow a
          narrow container (side peek, columns) and overlap its neighbours */}
      <div className={`relative inline-block ${alignCls}`} style={width ? { width, maxWidth: "100%" } : { maxWidth: "100%" }}>
        {/* Alignment toolbar (on hover) */}
        <div className="absolute -top-8 left-1/2 z-10 flex -translate-x-1/2 items-center gap-0.5 rounded-md border border-neutral-200 bg-white px-1 py-0.5 opacity-0 shadow-sm transition-opacity group-hover/img:opacity-100 dark:border-neutral-700 dark:bg-neutral-800">
          <button
            data-testid={`image-align-left-${block.id}`}
            onClick={() => editor.setImageMeta(block.id, { align: "left" })}
            className={`rounded p-1 transition-colors ${align === "left" ? "bg-neutral-100 dark:bg-neutral-700" : "hover:bg-neutral-50 dark:hover:bg-neutral-700/60"}`}
            aria-label="Align left"
          >
            <AlignLeft size={14} />
          </button>
          <button
            data-testid={`image-align-center-${block.id}`}
            onClick={() => editor.setImageMeta(block.id, { align: "center" })}
            className={`rounded p-1 transition-colors ${align === "center" ? "bg-neutral-100 dark:bg-neutral-700" : "hover:bg-neutral-50 dark:hover:bg-neutral-700/60"}`}
            aria-label="Align center"
          >
            <AlignCenter size={14} />
          </button>
          <button
            data-testid={`image-align-full-${block.id}`}
            onClick={() => editor.setImageMeta(block.id, { align: "full" })}
            className={`rounded p-1 transition-colors ${align === "full" ? "bg-neutral-100 dark:bg-neutral-700" : "hover:bg-neutral-50 dark:hover:bg-neutral-700/60"}`}
            aria-label="Full width"
          >
            <Maximize size={14} />
          </button>
        </div>

        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          ref={imgRef}
          src={block.content.url}
          alt={block.content.text ?? ""}
          className={`max-h-[420px] max-w-full rounded-md ${align === "full" ? "w-full" : ""}`}
          draggable={false}
 // a click on an image selects its block (Notion F); stop here so the row's
 // own click does not clear it again
          onClick={(e) => {
            e.stopPropagation();
            editor.selectBlock(block.id);
          }}
        />

        {/* Right resize handle */}
        <div
          data-testid={`image-resize-${block.id}`}
          onPointerDown={onResizeStart}
          className={`absolute right-0 top-0 h-full w-2 cursor-col-resize opacity-0 transition-opacity group-hover/img:opacity-100 ${resizing ? "opacity-100" : ""}`}
        >
          <div className="absolute right-0.5 top-1/2 h-8 w-1 -translate-y-1/2 rounded-full bg-neutral-400 dark:bg-neutral-500" />
        </div>
      </div>

      {/* Caption */}
      <input
        data-testid={`image-caption-${block.id}`}
        value={caption}
        onChange={(e) => editor.setImageMeta(block.id, { caption: e.target.value })}
        placeholder="Add a caption"
        className={`mt-1 block w-full bg-transparent text-center text-sm text-neutral-400 outline-none placeholder:text-neutral-300 dark:text-neutral-500 dark:placeholder:text-neutral-600 ${alignCls}`}
        style={width ? { maxWidth: width } : undefined}
      />
    </div>
  );
}

function Editable({
  block,
  className,
  placeholder,
  bare,
}: {
  block: EBlock;
  className?: string;
  placeholder?: string;
  /** the gutter + menu is open on this block: filter placeholder gets the original's pill */
  bare?: boolean;
}) {
  const editor = useEditor();
  const ref = useRef<HTMLDivElement>(null);

 // Sync DOM from state on mount and whenever a programmatic change bumps
 // the version (split/merge/type conversion/remote). Normal typing never
 // re-renders — the DOM is the source during composition. Rich blocks sync
 // via sanitized innerHTML, plain ones via innerText.
 //
 // useLayoutEffect, not useEffect: a block that changed depth REMOUNTS (it
 // moves in the React tree), so this runs as a fresh mount with an empty div.
 // The editor's caret restore is a layout effect in the parent, and parents run
 // after children — with a passive effect here the caret was placed in an empty
 // node and fell to offset 0, which is exactly what Tab and Shift+Tab did to
 // the caret before this (measured: the original keeps the offset).
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const wantHtml = block.content.html;
    if (wantHtml) {
      const safe = sanitizeInline(wantHtml);
      if (el.innerHTML !== safe) el.innerHTML = safe;
    } else {
      const want = block.content.text ?? "";
      if (el.innerText.replace(/\n+$/, "") !== want) {
        el.innerText = want;
      }
    }
 // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [block.version]);

 // inline equation chips: canonical html carries `$tex$` — upgrade each
 // span.eq to live KaTeX in the DOM (sanitize collapses it back on save)
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const upgrade = () => {
      if (!el.querySelector("span.eq:not([data-up])")) return;
      void ensureKatex().then(() => {
        for (const sp of el.querySelectorAll<HTMLElement>("span.eq:not([data-up])")) {
          sp.dataset.up = "1";
          sp.contentEditable = "false";
          const html = renderTexInline(sp.dataset.tex ?? "");
          if (html) sp.innerHTML = html;
        }
      });
    };
    upgrade();
    const mo = new MutationObserver(upgrade);
    mo.observe(el, { childList: true, subtree: true });
    return () => mo.disconnect();
  }, [block.id]);

  const setRef = useCallback(
    (el: HTMLDivElement | null) => {
      (ref as React.MutableRefObject<HTMLDivElement | null>).current = el;
      editor.registerEl(block.id, el);
    },
    [editor, block.id]
  );

  return (
    <div
      ref={setRef}
      contentEditable
      suppressContentEditableWarning
      spellCheck={false}
      data-testid={`block-editable-${block.id}`}
      data-bare-menu={bare ? "" : undefined}
      data-placeholder={placeholder}
      onInput={(e) => editor.onInput(block.id, e.currentTarget)}
      onKeyDown={(e) => editor.onKeyDown(block.id, e, e.currentTarget)}
      onCompositionStart={() => editor.onCompositionStart()}
      onCompositionEnd={(e) => editor.onCompositionEnd(block.id, e.currentTarget)}
      onPaste={(e) => editor.onPaste(block.id, e, e.currentTarget)}
      className={`min-h-[1.75rem] whitespace-pre-wrap outline-none ${className ?? ""}`}
    />
  );
}

/** Button block (help/buttons): a labelled pill that runs its
 * configured ACTION CHAIN on click — open URL/page, insert blocks, add a
 * database page, show a confirmation, send an inbox reminder. Actions run
 * in order; a rejected confirmation stops the chain. */
const BUTTON_ACTIONS: { type: ButtonAction["type"]; label: string; placeholder: string }[] = [
  { type: "open_url", label: "Open URL", placeholder: "https://…" },
  { type: "open_page", label: "Open page", placeholder: "page id" },
  { type: "insert_blocks", label: "Insert blocks", placeholder: "markdown inserted below" },
  { type: "add_page", label: "Add page to…", placeholder: "new page title" },
  { type: "confirm", label: "Show confirmation", placeholder: "Are you sure?" },
  { type: "notify", label: "Send notification", placeholder: "reminder text" },
];

function actionValue(a: ButtonAction): string {
  switch (a.type) {
    case "open_url": return a.url;
    case "open_page": return a.pageId;
    case "insert_blocks": return a.markdown;
    case "add_page": return a.title ?? "";
    case "confirm": return a.message;
    case "notify": return a.body;
  }
}

function withValue(a: ButtonAction, v: string): ButtonAction {
  switch (a.type) {
    case "open_url": return { ...a, url: v };
    case "open_page": return { ...a, pageId: v };
    case "insert_blocks": return { ...a, markdown: v };
    case "add_page": return { ...a, title: v };
    case "confirm": return { ...a, message: v };
    case "notify": return { ...a, body: v };
  }
}

function ButtonBlock({ block }: { block: EBlock }) {
  const editor = useEditor();
  const [configOpen, setConfigOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [dbs, setDbs] = useState<{ id: string; title: string }[]>([]);
  const label = block.content.text || "New button";
  const icon = (block.content.icon as string) || "";
  const actions: ButtonAction[] = Array.isArray(block.content.actions) ? (block.content.actions as ButtonAction[]) : [];

  useEffect(() => {
    if (!configOpen || dbs.length) return;
    fetch("/api/databases")
      .then((r) => (r.ok ? r.json() : { databases: [] }))
      .then((d) => setDbs(d.databases ?? []))
      .catch(() => {});
  }, [configOpen, dbs.length]);

  const save = (next: ButtonAction[]) => editor.setButtonData(block.id, { actions: next });

  async function run() {
    if (!actions.length) {
      setConfigOpen(true);
      return;
    }
    setRunning(true);
    try {
      for (const a of actions) {
        if (a.type === "confirm") {
          if (!window.confirm(a.message || "Continue?")) return;
        } else if (a.type === "open_url" && a.url) {
          window.open(resolveAppUrl(a.url), "_blank", "noopener");
        } else if (a.type === "open_page" && a.pageId) {
          window.location.assign(`/p/${a.pageId}`);
        } else if (a.type === "insert_blocks" && a.markdown?.trim()) {
          editor.insertMarkdownAfter(block.id, a.markdown);
        } else if (a.type === "add_page" && a.databaseId) {
          const snap = await fetch(`/api/databases/${a.databaseId}`).then((r) => (r.ok ? r.json() : null));
          const titleProp = snap?.properties?.find((x: { type: string }) => x.type === "title");
          await fetch(`/api/databases/${a.databaseId}/rows`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ values: titleProp && a.title ? { [titleProp.id]: a.title } : {} }),
          });
        } else if (a.type === "notify" && a.body) {
          await fetch("/api/notifications", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ type: "reminder", body: a.body }),
          });
        }
      }
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="my-0.5 w-full">
      <div className="flex items-center gap-1">
        <button
          data-testid={`button-block-${block.id}`}
          disabled={running}
          onClick={() => void run()}
          className="flex items-center gap-1.5 rounded-md border border-neutral-200 px-3 py-1 text-sm font-medium text-blue-600 transition-colors hover:bg-blue-50 disabled:opacity-60 dark:border-neutral-700 dark:text-blue-400 dark:hover:bg-blue-500/10"
        >
          <span>{icon || "▶"}</span> {label}
        </button>
        <button
          data-testid={`button-config-${block.id}`}
          onClick={() => setConfigOpen((v) => !v)}
          aria-label="Configure button"
          className="rounded p-1 text-neutral-300 transition-colors hover:bg-neutral-100 hover:text-neutral-500 dark:hover:bg-neutral-800"
        >
          ⚙
        </button>
      </div>
      {configOpen && (
        <div className="mt-1 flex w-full max-w-lg flex-col gap-1.5 rounded-md border border-neutral-200 p-2 dark:border-neutral-700">
          <div className="flex gap-1.5">
            <input
              data-testid={`button-icon-${block.id}`}
              defaultValue={icon}
              placeholder="▶"
              onBlur={(e) => editor.setButtonData(block.id, { icon: e.target.value.trim() })}
              className="w-12 rounded border border-neutral-200 px-2 py-1 text-center text-xs outline-none dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-200"
            />
            <input
              data-testid={`button-label-${block.id}`}
              defaultValue={label}
              placeholder="Button name"
              onBlur={(e) => editor.setButtonData(block.id, { label: e.target.value })}
              className="flex-1 rounded border border-neutral-200 px-2 py-1 text-xs outline-none dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-200"
            />
          </div>
          {actions.map((a, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <select
                data-testid={`button-action-type-${block.id}-${i}`}
                value={a.type}
                onChange={(e) => {
                  const t = e.target.value as ButtonAction["type"];
                  const blank =
                    t === "open_url" ? { type: t, url: "" } :
                    t === "open_page" ? { type: t, pageId: "" } :
                    t === "insert_blocks" ? { type: t, markdown: "" } :
                    t === "add_page" ? { type: t, databaseId: dbs[0]?.id ?? "" } :
                    t === "confirm" ? { type: t, message: "" } :
                    { type: t, body: "" };
                  save(actions.map((x, j) => (j === i ? (blank as ButtonAction) : x)));
                }}
                className="rounded border border-neutral-200 bg-white px-1 py-1 text-xs outline-none dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-200"
              >
                {BUTTON_ACTIONS.map((k) => (
                  <option key={k.type} value={k.type}>{k.label}</option>
                ))}
              </select>
              {a.type === "add_page" && (
                <select
                  data-testid={`button-action-db-${block.id}-${i}`}
                  value={a.databaseId}
                  onChange={(e) => save(actions.map((x, j) => (j === i ? { ...a, databaseId: e.target.value } : x)))}
                  className="max-w-[140px] rounded border border-neutral-200 bg-white px-1 py-1 text-xs outline-none dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-200"
                >
                  {dbs.map((d) => (
                    <option key={d.id} value={d.id}>{d.title}</option>
                  ))}
                </select>
              )}
              <input
                data-testid={`button-action-value-${block.id}-${i}`}
                defaultValue={actionValue(a)}
                placeholder={BUTTON_ACTIONS.find((k) => k.type === a.type)?.placeholder}
                onBlur={(e) => save(actions.map((x, j) => (j === i ? withValue(a, e.target.value) : x)))}
                className="min-w-0 flex-1 rounded border border-neutral-200 px-2 py-1 text-xs outline-none dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-200"
              />
              <button
                data-testid={`button-action-remove-${block.id}-${i}`}
                onClick={() => save(actions.filter((_, j) => j !== i))}
                aria-label="Remove action"
                className="rounded p-1 text-neutral-300 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/30"
              >
                ✕
              </button>
            </div>
          ))}
          <button
            data-testid={`button-action-add-${block.id}`}
            onClick={() => save([...actions, { type: "open_url", url: "" }])}
            className="self-start rounded border border-dashed border-neutral-300 px-2 py-1 text-xs text-neutral-500 hover:bg-neutral-50 dark:border-neutral-600 dark:hover:bg-neutral-800"
          >
            ＋ Add action
          </button>
        </div>
      )}
    </div>
  );
}

/** Template button: click inserts its markdown
 * template as fresh blocks right below; ⚙ configures label + template. */
function TemplateButtonBody({ block }: { block: EBlock }) {
  const editor = useEditor();
  const [configOpen, setConfigOpen] = useState(false);
  const label = block.content.text || "New";
  const template = block.content.template ?? "";
  return (
    <div className="my-0.5 w-full">
      <div className="flex items-center gap-1">
        <button
          data-testid={`template-button-${block.id}`}
          onClick={() => {
            if (template.trim()) editor.insertMarkdownAfter(block.id, template);
            else setConfigOpen(true);
          }}
          className="flex items-center gap-1.5 rounded-md border border-neutral-200 px-3 py-1 text-sm font-medium text-blue-600 transition-colors hover:bg-blue-50 dark:border-neutral-700 dark:text-blue-400 dark:hover:bg-blue-500/10"
        >
          ＋ {label}
        </button>
        <button
          data-testid={`template-button-config-${block.id}`}
          onClick={() => setConfigOpen((v) => !v)}
          aria-label="Configure template button"
          className="rounded p-1 text-neutral-300 transition-colors hover:bg-neutral-100 hover:text-neutral-500 dark:hover:bg-neutral-800"
        >
          ⚙
        </button>
      </div>
      {configOpen && (
        <div className="mt-1 flex w-full max-w-md flex-col gap-1 rounded-md border border-neutral-200 p-2 dark:border-neutral-700">
          <input
            data-testid={`template-button-label-${block.id}`}
            defaultValue={label}
            placeholder="Button name"
            onBlur={(e) => editor.setTemplateData(block.id, { label: e.target.value })}
            className="rounded border border-neutral-200 px-2 py-1 text-xs outline-none dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-200"
          />
          <textarea
            data-testid={`template-button-md-${block.id}`}
            defaultValue={template}
            rows={4}
            placeholder={"Markdown inserted on click…\ne.g. ## Standup\n- [ ] yesterday\n- [ ] today"}
            onBlur={(e) => editor.setTemplateData(block.id, { template: e.target.value })}
            className="rounded border border-neutral-200 px-2 py-1 font-mono text-xs outline-none dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-200"
          />
        </div>
      )}
    </div>
  );
}

/** Block equation: TeX rendered via the vendored KaTeX; click to edit. */
function EquationBody({ block }: { block: EBlock }) {
  const editor = useEditor();
  const tex = block.content.text ?? "";
  const [editing, setEditing] = useState(tex.trim() === "");
  const [draft, setDraft] = useState(tex);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    void ensureKatex().then(() => {
      if (alive) setReady(true);
    });
    return () => {
      alive = false;
    };
  }, []);

  const html = ready && tex.trim() ? renderTex(tex) : "";

  return (
    <div className="my-1 w-full">
      {editing ? (
        <div className="flex w-full flex-col gap-1 rounded-md border border-neutral-200 p-2 dark:border-neutral-700">
          <textarea
            autoFocus
            data-testid={`equation-input-${block.id}`}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={2}
            placeholder={"E = mc^2"}
            className="w-full rounded border border-neutral-200 px-2 py-1 font-mono text-sm outline-none dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-200"
          />
          <div className="flex justify-end">
            <button
              data-testid={`equation-done-${block.id}`}
              onClick={() => {
 // content.text is the TeX source (label maps to text)
                editor.setTemplateData(block.id, { label: draft });
                setEditing(false);
              }}
              className="rounded bg-blue-500 px-2.5 py-1 text-xs font-medium text-white hover:bg-blue-600"
            >
              Done
            </button>
          </div>
        </div>
      ) : html ? (
        <div
          data-testid={`equation-render-${block.id}`}
          onClick={() => {
            setDraft(tex);
            setEditing(true);
          }}
          className="cursor-pointer overflow-x-auto rounded-md px-2 py-2 text-center transition-colors hover:bg-neutral-50 dark:hover:bg-neutral-800/60"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        <button
          onClick={() => {
            setDraft(tex);
            setEditing(true);
          }}
          className="w-full rounded-md px-2 py-2 text-left text-sm text-neutral-400 transition-colors hover:bg-neutral-50 dark:hover:bg-neutral-800/60"
        >
          {tex.trim() ? tex : "∑ Add a TeX equation"}
        </button>
      )}
    </div>
  );
}

/** Ask AI (scienario 44): a transient prompt box; the local model's markdown
 * answer is inserted as ORDINARY blocks (same pipeline as pasted markdown)
 * and the prompt block removes itself. */
function AiPromptBody({ block }: { block: EBlock }) {
  const editor = useEditor();
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  async function generate() {
    if (!prompt.trim() || busy) return;
    setBusy(true);
    setError(false);
 // nearby page text gives the model context (cheap: current blocks' text)
    const context = editor.blocks
      .map((b) => b.content.text ?? "")
      .filter(Boolean)
      .join("\n")
      .slice(0, 4000);
    const res = await fetch("/api/ai/write", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt, context }),
    }).catch(() => null);
    if (!res?.ok) {
      setBusy(false);
      setError(true);
      return;
    }
    const { markdown } = (await res.json()) as { markdown: string };
    editor.insertMarkdownAfter(block.id, markdown);
    editor.deleteBlock(block.id);
  }

  return (
    <div className="my-1 w-full rounded-md border border-purple-200 bg-purple-50/50 p-2 dark:border-purple-800 dark:bg-purple-900/20">
      <div className="flex items-start gap-1.5">
        <span className="pt-1 text-sm">✨</span>
        <textarea
          autoFocus
          data-testid={`ai-prompt-input-${block.id}`}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (!isImeComposing(e) && e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void generate();
            }
            if (e.key === "Escape") editor.deleteBlock(block.id);
          }}
          rows={1}
          placeholder="Ask AI to write… (Enter to generate, Esc to dismiss)"
          className="w-full resize-none bg-transparent text-sm outline-none placeholder:text-neutral-400 dark:text-neutral-200"
        />
        <button
          data-testid={`ai-generate-${block.id}`}
          disabled={busy || !prompt.trim()}
          onClick={() => void generate()}
          className="shrink-0 rounded bg-purple-500 px-2.5 py-1 text-xs font-medium text-white hover:bg-purple-600 disabled:opacity-50"
        >
          {busy ? "Generating…" : "Generate"}
        </button>
      </div>
      {error && (
        <p data-testid={`ai-error-${block.id}`} className="mt-1 pl-6 text-xs text-red-500">
          AI unavailable — is the local model running?
        </p>
      )}
    </div>
  );
}

/**
 * A keystroke changes one block's object; the editor context is now stable
 * (block-editor perf §3.6), so a memoized row re-renders only when its own
 * block (or depth/parent) changes. A block that HAS children still re-renders
 * on any edit — it re-derives its child list — but a leaf (the flat
 * many-paragraph page) is skipped, so typing touches one row, not the page.
 */
export const BlockRow = memo(
  BlockRowInner,
 // `subtree` is a memo key only (the editor hands a root the list of its
 // descendants, same array while none of them changed) — a nested child's
 // change must re-render the root that draws it
  (a, b) => a.block === b.block && a.depth === b.depth && a.indentPx === b.indentPx && a.parentType === b.parentType && a.hasChildren === b.hasChildren && a.subtree === b.subtree && !b.hasChildren
);
