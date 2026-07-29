"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight, GripVertical, Plus, Trash2, Copy, Repeat, FileText, MessageSquare, AlignLeft, AlignCenter, Maximize, Check, Link2 } from "lucide-react";
import { CODE_LANGUAGES } from "@/lib/editor/block-defs";
import { sanitizeInline } from "@/lib/rich-text";
import { copyText, resolveAppUrl } from "@/lib/compat";
import { uploadBlob } from "@/lib/upload";
import { highlightCode } from "@/lib/editor/highlight";
import { IconPicker } from "@/components/page/icon-picker";
import { useEditor, type EBlock } from "./block-editor";
import type { ButtonAction } from "@/lib/db/schema";
import { TableBlock } from "./table-block";
import { DatabaseBlock } from "@/components/database/database-block";
import { usePagesStore } from "@/stores/pages";
import { useCommentsStore } from "@/stores/comments";
import { useCommentUi } from "@/stores/comment-ui";
import { PageIcon } from "@/components/page-icon";
import { ensureKatex, renderTex, renderTexInline } from "@/lib/katex-loader";
import { MemorySelect } from "@/components/database/memory-select";

export function BlockRow({ block, depth }: { block: EBlock; depth: number }) {
  const editor = useEditor();

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
 // Toggle manages its own children (gated by expand); every other block
 // renders its indented children here so Tab-nesting works for all types.
  const nestedChildren =
    block.type === "toggle" ? [] : editor.childrenOf(block.id);

  return (
    <div
      data-testid={`block-${block.id}`}
      data-block-type={block.type}
      className="group/block relative"
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
        if (e.shiftKey) {
          e.preventDefault();
          e.stopPropagation();
          editor.shiftSelect(block.id);
        } else if (editor.selectedIds.size) {
          editor.clearSelection();
        }
      }}
    >
      {isDrop && editor.dropTarget?.before && (
        <div className="absolute -top-0.5 left-0 right-0 h-[3px] rounded bg-blue-500" />
      )}

      <div
        className={`relative flex items-start rounded ${
          editor.selectedIds.has(block.id) ? "bg-blue-100/80 ring-1 ring-inset ring-blue-300/70 dark:bg-blue-500/25 dark:ring-blue-500/50" : ""
        }`}
        style={{ paddingLeft: depth * 24 }}
      >
        <div className="absolute top-0.5 flex items-center gap-0.5 opacity-0 transition-opacity duration-100 group-hover/block:opacity-100" style={{ left: depth * 24 - 40 }} /* hug the block */>
          <button
            tabIndex={-1}
            data-testid={`block-add-below-${block.id}`}
            onClick={() => editor.insertBelow(block.id)}
            className="flex h-6 w-5 items-center justify-center rounded text-neutral-300 transition-colors hover:bg-neutral-100 hover:text-neutral-500 dark:text-neutral-600 dark:hover:bg-neutral-800"
            aria-label="Add block below"
          >
            <Plus size={15} />
          </button>
          <BlockHandle block={block} />
        </div>

        <BlockCommentAnchor blockId={block.id}>
          <BlockBody block={block} depth={depth} />
        </BlockCommentAnchor>
      </div>

      {nestedChildren.length > 0 && (
        <div>
          {nestedChildren.map((c) => (
            <BlockRow key={c.id} block={c} depth={depth + 1} />
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
        <BlockRow key={c.id} block={c} depth={0} />
      ))}
    </div>
  );
}

/** File attachment block: upload any file, then a download chip. */
function FileBlockBody({ block }: { block: EBlock }) {
  const editor = useEditor();
  if (block.content.url) {
    return (
      <a
        data-testid={`file-block-${block.id}`}
        href={block.content.url}
        download={block.content.text || true}
        className="my-0.5 flex w-full items-center gap-2 rounded-md border border-neutral-200 px-2 py-1.5 text-sm text-neutral-700 transition-colors hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"
      >
        📎 <span className="truncate underline underline-offset-2">{block.content.text || "file"}</span>
      </a>
    );
  }
  return (
    <label
      data-testid={`file-drop-${block.id}`}
      className="my-0.5 flex w-full cursor-pointer items-center gap-2 rounded-md border border-dashed border-neutral-200 px-2 py-2 text-sm text-neutral-400 hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
    >
      📎 Upload a file…
      <input
        data-testid={`file-input-${block.id}`}
        type="file"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          void (async () => {
            const up = await uploadBlob(f, "file");
            if (up) editor.setFileData(block.id, { url: up.url, name: up.name ?? f.name });
          })();
        }}
      />
    </label>
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

export const TURN_INTO: { type: EBlock["type"]; label: string }[] = [
  { type: "paragraph", label: "Text" },
  { type: "heading1", label: "Heading 1" },
  { type: "heading2", label: "Heading 2" },
  { type: "heading3", label: "Heading 3" },
  { type: "bulleted_list", label: "Bulleted list" },
  { type: "numbered_list", label: "Numbered list" },
  { type: "todo", label: "To-do" },
  { type: "toggle", label: "Toggle" },
  { type: "quote", label: "Quote" },
  { type: "callout", label: "Callout" },
  { type: "code", label: "Code" },
];

/** The ⠿ grip: draggable AND a click-menu (Delete / Duplicate / Turn into). */
function BlockHandle({ block }: { block: EBlock }) {
  const editor = useEditor();
  const [open, setOpen] = useState(false);
  const [turnOpen, setTurnOpen] = useState(false);
  const [commentOpen, setCommentOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  const addComment = useCommentsStore((s) => s.add);
  const openThread = useCommentUi((s) => s.open);
  const pathname = usePathname();
  const pageId = pathname?.match(/\/p\/([0-9a-f-]{36})/)?.[1] ?? null;

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) {
        setOpen(false);
        setTurnOpen(false);
      }
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

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
          editor.onDragStart(block.id);
        }}
        onClick={() => setOpen((v) => !v)}
        className="flex h-6 w-4 cursor-grab items-center justify-center rounded text-neutral-300 transition-colors hover:bg-neutral-100 hover:text-neutral-500 active:cursor-grabbing dark:text-neutral-600 dark:hover:bg-neutral-800"
        aria-label="Block actions (drag to reorder)"
      >
        <GripVertical size={15} />
      </button>
      {open && (
        <div className="popover-anim absolute left-5 top-0 z-50 w-44 rounded-lg border border-neutral-200 bg-white py-1 shadow-xl dark:border-neutral-700 dark:bg-neutral-800">
          <MenuBtn
            testid={`block-delete-${block.id}`}
            icon={<Trash2 size={13} />}
            label="Delete"
            danger
            onClick={() => {
              setOpen(false);
              editor.deleteBlock(block.id);
            }}
          />
          <MenuBtn
            testid={`block-duplicate-${block.id}`}
            icon={<Copy size={13} />}
            label="Duplicate"
            onClick={() => {
              setOpen(false);
              editor.duplicateBlock(block.id);
            }}
          />
          <MenuBtn
            testid={`block-copylink-${block.id}`}
            icon={<Link2 size={13} />}
            label="Copy link"
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
            label="Comment"
            onClick={() => {
              setOpen(false);
              setTurnOpen(false);
              setCommentOpen(true);
            }}
          />
          <div className="relative">
            <MenuBtn
              testid={`block-turninto-${block.id}`}
              icon={<Repeat size={13} />}
              label="Turn into"
              onClick={() => setTurnOpen((v) => !v)}
            />
            {turnOpen && (
              <div className="popover-anim absolute left-full top-0 z-50 ml-1 max-h-64 w-40 overflow-y-auto rounded-lg border border-neutral-200 bg-white py-1 shadow-xl dark:border-neutral-700 dark:bg-neutral-800">
                {TURN_INTO.map((t) => (
                  <button
                    key={t.type}
                    data-testid={`block-turninto-${block.id}-${t.type}`}
                    onClick={() => {
                      setOpen(false);
                      setTurnOpen(false);
                      editor.turnInto(block.id, t.type);
                    }}
                    className="block w-full px-3 py-1.5 text-left text-sm text-neutral-700 transition-colors hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-700"
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
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
                  if (e.key === "Enter") {
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
  "whitespace-pre-wrap break-words px-3 py-2 font-mono text-[13px] leading-6";

/** Code block: language select + copy button + caption + a dependency-free
 * syntax-highlight overlay painted behind a transparent-text editor.
 * The <Editable> is untouched (full editing/caret model); we only read its
 * text to paint colors behind it. */
function CodeBlock({ block }: { block: EBlock }) {
  const editor = useEditor();
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
    <div className="my-1 w-full overflow-hidden rounded-md bg-neutral-100 dark:bg-neutral-800/80">
      <div className="flex items-center justify-between border-b border-neutral-200/70 px-3 py-1 dark:border-neutral-700/60">
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
          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-neutral-500 transition-colors hover:bg-neutral-200/60 dark:hover:bg-neutral-700"
          aria-label="Copy code"
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <div
        className="relative"
        onInput={(e) => {
          const t = (e.target as HTMLElement).innerText.replace(/\n$/, "");
          if (overlayRef.current)
            overlayRef.current.innerHTML = highlightCode(t, language) + "\n";
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
      <input
        data-testid={`code-caption-${block.id}`}
        value={caption}
        onChange={(e) => editor.setImageMeta(block.id, { caption: e.target.value })}
        placeholder="Add a caption"
        className="w-full bg-transparent px-3 py-1 text-xs text-neutral-500 outline-none placeholder:text-neutral-300 dark:placeholder:text-neutral-600"
      />
    </div>
  );
}

// Callout background palette (name → light / dark bg classes).
const CALLOUT_COLORS: { name: string; bg: string }[] = [
  { name: "default", bg: "bg-neutral-100 dark:bg-neutral-800/80" },
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
 * background color (was a hardcoded 💡 on neutral). */
function CalloutBlock({ block }: { block: EBlock }) {
  const editor = useEditor();
  const [colorOpen, setColorOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const icon = (block.content.icon as string | null | undefined) ?? "💡";
  const color = (block.content.color as string) ?? "default";

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
      className={`group/callout relative my-1 flex w-full items-start gap-2.5 rounded-md px-3.5 py-3 ${calloutBg(color)}`}
    >
      <IconPicker
        icon={icon}
        onChange={(v) => editor.setImageMeta(block.id, { icon: v ?? "💡" })}
        testid={`callout-icon-${block.id}`}
        pickerTestid={`callout-icon-picker-${block.id}`}
        triggerClassName="shrink-0 select-none rounded p-0.5 text-lg leading-6 transition-colors hover:bg-black/5 dark:hover:bg-white/10"
        placeholder="💡"
        allowRemove={false}
      />
      <Editable
        block={block}
        className="flex-1 text-[15px] leading-6 text-neutral-800 dark:text-neutral-200"
      />
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

function BlockBody({ block, depth }: { block: EBlock; depth: number }) {
  const editor = useEditor();

  switch (block.type) {
    case "divider":
      return (
        <div className="w-full py-2">
          <hr className="border-neutral-200 dark:border-neutral-700" />
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

    case "bookmark":
    case "video":
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
        <div className="flex w-full items-start gap-2">
          <input
            type="checkbox"
            data-testid={`todo-checkbox-${block.id}`}
            checked={block.content.checked ?? false}
            onChange={(e) => editor.setChecked(block.id, e.target.checked)}
            className="mt-1.5 h-4 w-4 shrink-0 cursor-pointer accent-blue-500"
          />
          <Editable
            block={block}
            className={`flex-1 py-[3px] text-[15px] leading-6 ${
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
        <div className="w-full">
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
              className="flex-1 py-0.5 text-[15px] leading-6 text-neutral-800 dark:text-neutral-200"
            />
          </div>
          {expanded && (
            <div className="ml-3 border-l border-transparent">
              {children.length === 0 ? (
                <button
                  data-testid="toggle-add-inside"
                  onClick={() => editor.addInsideToggle(block.id)}
                  className="ml-6 rounded px-1.5 py-1 text-sm text-neutral-400 transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-800"
                >
                  Empty toggle. Click or drop blocks inside.
                </button>
              ) : (
                children.map((c) => <BlockRow key={c.id} block={c} depth={depth + 1} />)
              )}
            </div>
          )}
        </div>
      );
    }

    case "bulleted_list":
      return (
        <div className="flex w-full items-start gap-2">
          <span className="mt-0.5 w-4 shrink-0 select-none text-center text-[15px] leading-6 text-neutral-800 dark:text-neutral-200">
            •
          </span>
          <Editable
            block={block}
            className="flex-1 py-[3px] text-[15px] leading-6 text-neutral-800 dark:text-neutral-200"
          />
        </div>
      );

    case "numbered_list":
      return (
        <div className="flex w-full items-start gap-2">
          <span className="mt-0.5 w-4 shrink-0 select-none text-right text-[15px] leading-6 text-neutral-800 dark:text-neutral-200">
            {editor.numberOf(block)}.
          </span>
          <Editable
            block={block}
            className="flex-1 py-[3px] text-[15px] leading-6 text-neutral-800 dark:text-neutral-200"
          />
        </div>
      );

    case "quote":
      return (
        <div className="w-full border-l-[3px] border-neutral-800 py-0.5 pl-3 dark:border-neutral-300">
          <Editable
            block={block}
            className="py-0.5 text-[15px] leading-6 text-neutral-700 dark:text-neutral-300"
          />
        </div>
      );

    case "callout":
      return <CalloutBlock block={block} />;

    case "heading1":
      return (
        <Editable
          block={block}
          placeholder="Heading 1"
          className="w-full pb-1 pt-4 text-3xl font-bold leading-tight text-neutral-900 dark:text-neutral-100"
        />
      );
    case "heading2":
      return (
        <Editable
          block={block}
          placeholder="Heading 2"
          className="w-full pb-0.5 pt-3 text-2xl font-semibold leading-tight text-neutral-900 dark:text-neutral-100"
        />
      );
    case "heading3":
      return (
        <Editable
          block={block}
          placeholder="Heading 3"
          className="w-full pb-0.5 pt-2 text-xl font-semibold leading-tight text-neutral-900 dark:text-neutral-100"
        />
      );

    default:
      return (
        <Editable
          block={block}
          placeholder="Write something, or press '/' for commands"
          className="w-full py-0.5 text-[15px] leading-6 text-neutral-800 dark:text-neutral-200"
        />
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
            if (e.key === "Enter") commit();
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
            if (e.key === "Enter") {
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
}: {
  block: EBlock;
  className?: string;
  placeholder?: string;
}) {
  const editor = useEditor();
  const ref = useRef<HTMLDivElement>(null);

 // Sync DOM from state on mount and whenever a programmatic change bumps
 // the version (split/merge/type conversion/remote). Normal typing never
 // re-renders — the DOM is the source during composition. Rich blocks sync
 // via sanitized innerHTML, plain ones via innerText.
  useEffect(() => {
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
      data-placeholder={placeholder}
      onInput={(e) => editor.onInput(block.id, e.currentTarget)}
      onKeyDown={(e) => editor.onKeyDown(block.id, e, e.currentTarget)}
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
            if (e.key === "Enter" && !e.shiftKey) {
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
