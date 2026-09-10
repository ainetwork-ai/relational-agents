"use client";

import { useRouter } from "next/navigation";
import { v5 as uuidv5 } from "uuid";
import { uploadBlob } from "@/lib/upload";
import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import type { Block, BlockContent, BlockType, ButtonAction, TableData } from "@/lib/db/schema";
import { MARKDOWN_SHORTCUTS, TEXT_TYPES } from "@/lib/editor/block-defs";
import { caretOffset, caretRect, setCaret } from "@/lib/editor/caret";
import { tryInlineAutoformat } from "@/lib/editor/inline-autoformat";
import {
  htmlToMarkdownish,
  htmlToNotionBlocks,
  htmlToNotionExportBlocks,
} from "@/lib/editor/html-paste";
import { notionClipboardToBlocks } from "@/lib/editor/notion-clipboard";
import { copyPayload, isTextBlockType, readPayloadTree, serializeBlocks, writePayload } from "@/lib/editor/block-clipboard";
import { newId } from "@/lib/compat";
import { htmlToText, sanitizeInline } from "@/lib/rich-text";
import { parseMarkdown } from "@/lib/memory-parse";
import { SelectionToolbar } from "./selection-toolbar";
import { SlashMenu, filterSlashItems } from "./slash-menu";
import { MentionMenu, mentionChipHtml, type MentionItem } from "./mention-menu";
import { EmojiSuggestMenu, emojiCandidates, type EmojiCandidate } from "./emoji-suggest";
import { loadEmojiSet } from "@/lib/emoji-data";
import { BlockRow } from "./block-row";
import { EmptyPageStarter } from "./empty-page-starter";
import { usePageSync } from "@/hooks/use-page-sync";
import { diffBlocks } from "@/lib/editor/block-diff";
import { getTransactionQueue, migrateLegacyDraft } from "@/lib/editor/transaction-queue";
import { isTextOperation, type Transaction } from "@/lib/transactions/types";
import { liveIdAtPos, livePosOfId } from "@/lib/editor/text-edit";
import type { ItemId } from "@/lib/text-crdt/types";
import { applyMoveTextSlice, applyTextOp } from "@/lib/text-crdt/ops";
import { textInstanceOf } from "@/lib/text-crdt/content";
import { usePagesStore } from "@/stores/pages";
import {
  LIST_TYPES,
  indentBlocks,
  outdentBlocks,
  liftChildren,
  moveChildren,
} from "@/lib/editor/indent";

export interface EBlock {
  id: string;
  type: BlockType;
  content: BlockContent;
  parentBlockId: string | null;
  position: number;
  /** bump to force the contentEditable DOM to resync from content.text */
  version: number;
}

interface SlashState {
  blockId: string;
  /** text offset right after the '/' */
  offset: number;
  /** opened from the gutter +: no "/" character in the block, the whole
   * text is the filter, and the block shows a filter placeholder (original) */
  bare?: boolean;
  /** bare mode anchors to the block box (left edge, full height), not the caret */
  anchorHeight?: number;
  query: string;
  selected: number;
  anchor: { x: number; y: number };
}

interface MentionState {
  blockId: string;
  /** text offset right after the '@' */
  offset: number;
  query: string;
  selected: number;
  anchor: { x: number; y: number };
}

interface EditorApi {
  blocks: EBlock[];
  registerEl: (id: string, el: HTMLElement | null) => void;
  onInput: (id: string, el: HTMLElement) => void;
  onKeyDown: (id: string, e: React.KeyboardEvent, el: HTMLElement) => void;
  /** IME composition (Hangul, Kana, Pinyin…) — see onKeyDown's isComposing guard */
  onCompositionStart: () => void;
  onCompositionEnd: (id: string, el: HTMLElement) => void;
  onPaste: (id: string, e: React.ClipboardEvent, el: HTMLElement) => void;
  toggleExpand: (id: string) => void;
  addInsideToggle: (id: string) => void;
  addColumn: (columnListId: string) => void;
  setChecked: (id: string, checked: boolean) => void;
  setLanguage: (id: string, language: string) => void;
  setImageUrl: (id: string, url: string) => void;
  /** link-to-page block: set the target page */
  setLinkTarget: (id: string, pageId: string) => void;
  /** file block: set the uploaded attachment */
  setFileData: (id: string, data: { url: string; name: string }) => void;
  /** parse markdown and insert the blocks after `anchorId` (null = append) */
  insertMarkdownAfter: (anchorId: string | null, md: string) => void;
  /** insert an Ask-AI prompt block right after `anchorId` (selection toolbar) */
  insertAiPromptAfter: (anchorId: string) => void;
  /** template_button block: update its label and/or markdown template */
  setTemplateData: (id: string, data: { label?: string; template?: string }) => void;
  /** button block: update its label / icon / action chain */
  setButtonData: (id: string, data: Partial<{ label: string; icon: string; actions: ButtonAction[] }>) => void;
  setImageMeta: (
    id: string,
    meta: { caption?: string; width?: number; align?: string; icon?: string | null; color?: string }
  ) => void;
  updateTable: (id: string, table: TableData) => void;
  /** move the caret into the nearest editable block in `dir` — the table block
   * uses it to let an arrow key leave the grid at its edge */
  focusNeighbour: (id: string, dir: -1 | 1) => boolean;
  insertBelow: (id: string) => void;
  indentBlock: (id: string, el: HTMLElement) => void;
  outdentBlock: (id: string, el: HTMLElement) => void;
  deleteBlock: (id: string) => void;
  duplicateBlock: (id: string) => void;
  turnInto: (id: string, type: BlockType) => void;
  onDragStart: (id: string) => void;
  onDragEnd: () => void;
  onDragOverRow: (e: React.DragEvent, id: string) => void;
  onDropRow: (e: React.DragEvent, id: string) => void;
  dropTarget: { id: string; before: boolean; side?: "left" | "right" } | null;
  childrenOf: (id: string | null) => EBlock[];
  numberOf: (b: EBlock) => number;
  selectedIds: Set<string>;
  /** block whose type menu was opened from the gutter + (shows the filter placeholder) */
  slashBareBlockId: string | null;
  shiftSelect: (id: string) => void;
  /** select just this block (a click on an image, a divider… — Notion F) */
  selectBlock: (id: string) => void;
  clearSelection: () => void;
  /** draw this block's halo? selected, and no selected ancestor (the ancestor's
   * halo covers its subtree — measured, ⌘A on Notion halos only top-level blocks) */
  isHalo: (id: string) => boolean;
  /** the halo's vertical inset: 2px on a text block; 1px on a list item, except
   * on a side that meets a non-list neighbour, where it is 2px (measured) */
  haloInset: (id: string) => { top: number; bottom: number };
}

// Anchored on globalThis like DbCtx (db-context.ts): Turbopack's production
// build can instantiate a module twice, and a bare module-level createContext
// then splits into two objects — provider writes one, useEditor reads the
// other, and the throw below takes the whole tree down. Prod-only; dev keeps
// modules single-instance. See vercel/next.js#89192 for the bug class.
const gEditor = globalThis as { __ainmemEditorCtx?: ReturnType<typeof createContext<EditorApi | null>> };
const EditorCtx = (gEditor.__ainmemEditorCtx ??= createContext<EditorApi | null>(null));
export function useEditor() {
  const ctx = useContext(EditorCtx);
  if (!ctx) throw new Error("useEditor outside BlockEditor");
  return ctx;
}

export interface BlockEditorHandle {
  focusFirst: () => void;
}

function normalize(el: HTMLElement): string {
 // rich contentEditable encodes trailing spaces as &nbsp; — markdown
 // shortcut matching ("# " etc.) needs plain spaces
 // Inline equation chips read as their `$tex$` source, not the KaTeX
 // markup's text soup.
  let root: HTMLElement = el;
  if (el.querySelector("span.eq")) {
    root = el.cloneNode(true) as HTMLElement;
    for (const sp of root.querySelectorAll<HTMLElement>("span.eq")) {
      sp.replaceWith(document.createTextNode(`$${sp.dataset.tex ?? ""}$`));
    }
  }
  return (root === el ? el.innerText : (root.textContent ?? "")).replace(/ /g, " ").replace(/\n+$/, "");
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Heuristic: does pasted plain text carry block-level markdown structure?
 * Multi-line paste (each line → a block) or a single clear markdown marker
 * routes through the parser; a single plain line keeps inline paste. */
function looksLikeMarkdown(text: string): boolean {
  const lines = text.replace(/\r/g, "").split("\n").filter((l) => l.trim() !== "");
  if (lines.length > 1) return true;
  const t = text.trim();
  return (
    /^#{1,6}\s/.test(t) ||
    /^[-*]\s\S/.test(t) ||
    /^\d+\.\s/.test(t) ||
    /^>\s/.test(t) ||
    t.startsWith("```") ||
    t === "---" ||
    t === "***" ||
    /^!\[[^\]]*\]\([^)]+\)/.test(t)
  );
}

function fromRow(b: Block): EBlock {
  return {
    id: b.id,
    type: b.type,
    content: (b.content ?? {}) as BlockContent,
    parentBlockId: b.parentBlockId,
    position: b.position,
    version: 0,
  };
}

// The bootstrap paragraph an empty page starts with is part of the SERVER
// render, so its id must come out identical on server and client — newId()
// there minted a fresh uuid per render and every empty page hydrated
// mismatched (server block-<a>, client block-<b>). Derived from the pageId
// instead: same page, same id, on both sides. The namespace is arbitrary but
// must never change.
// blocks that take no children in the original — Tab never nests under them.
// The set and the tree surgery live in lib/editor/indent.ts (measured rules).
// where a markdown prefix converts the block (the original converts an EMPTY list item too)
const SHORTCUT_HOSTS = new Set<string>(["paragraph", "bulleted_list", "numbered_list", "todo", "toggle"]);
const BOOTSTRAP_NS = "9a3c5e88-0b5d-4b6a-9f3e-2f1c7a4d8e01";
function bootstrapParagraph(pageId: string): EBlock {
  return { ...freshParagraph(null, 1), id: uuidv5(pageId, BOOTSTRAP_NS) };
}

function freshParagraph(parentBlockId: string | null, position: number): EBlock {
  return {
    id: newId(),
    type: "paragraph",
    content: { text: "" },
    parentBlockId,
    position,
    version: 0,
  };
}

/** DataTransfer type stamped on a block drag from the ⠿ handle, so drop targets
 * can tell it from a native drag of text or an image. */
export const BLOCK_DRAG_MIME = "application/x-ainmem-block";

/** Types that keep their type when a block is split by Enter. */
const CONTINUING: BlockType[] = ["bulleted_list", "numbered_list", "todo"];

export const BlockEditor = forwardRef<
  BlockEditorHandle,
  {
    pageId: string;
    initialBlocks: Block[];
    shareToken?: string;
    /** What an empty body offers. A page gets the 시작하기 row; a database row
     *  opened in a peek gets Notion's quieter line there instead. */
    emptyVariant?: "page" | "row";
  }
>(function BlockEditor({ pageId, initialBlocks, shareToken, emptyVariant = "page" }, apiRef) {
  const [blocks, setBlocks] = useState<EBlock[]>(() => {
    const mapped = initialBlocks.map(fromRow);
    return mapped.length > 0 ? mapped : [bootstrapParagraph(pageId)];
  });
  const [slash, setSlash] = useState<SlashState | null>(null);
 // the original locks background scroll while the type menu is open, so the
 // menu (anchored to a fixed point) can't drift away from its line. Freeze the
 // nearest scroll container at its current offset for as long as the menu lives.
  useEffect(() => {
    if (!slash) return;
    const el = editables.current.get(slash.blockId);
    let sc: HTMLElement | null = el?.parentElement ?? null;
    while (sc && sc.scrollHeight <= sc.clientHeight) sc = sc.parentElement;
    if (!sc) return;
    const prev = sc.style.overflowY;
    sc.style.overflowY = "hidden";
    return () => { sc.style.overflowY = prev; };
  }, [slash]);

 // the original closes the type menu on a mousedown anywhere outside the
 // menu — the line it belongs to included (measured 2026-08-26: clicking the
 // line closes the menu and the line goes back to its usual placeholder)
  useEffect(() => {
    if (!slash) return;
    const onDown = (ev: MouseEvent) => {
      const t = ev.target as HTMLElement | null;
      if (!t || t.closest('[data-testid="slash-menu"]')) return;
      setSlash(null);
    };
    document.addEventListener("mousedown", onDown, true);
    return () => document.removeEventListener("mousedown", onDown, true);
  }, [slash]);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [mention, setMention] = useState<MentionState | null>(null);
  const [emojiSug, setEmojiSug] = useState<MentionState | null>(null);
 // URL paste → "keep link / bookmark" chooser
  const [pasteLink, setPasteLink] = useState<{
    blockId: string;
    url: string;
    anchor: { x: number; y: number };
  } | null>(null);
  const mentionItemsRef = useRef<MentionItem[]>([]);
 // an IME (Hangul, Kana, Pinyin…) owns the text until it commits. composingRef
 // keeps the DOM-rewriting autoformat off that text; splitOnComposeEnd holds
 // the block whose Enter we deferred until the commit lands.
  const composingRef = useRef(false);
  const splitOnComposeEnd = useRef<string | null>(null);
 // when a composition-deferred Enter actually split, so the same keypress
 // passed back through by the IME can be recognised and dropped
  const composedSplitAt = useRef(0);
 // block-level multi-selection (Esc to select, Shift+Arrow / Shift+Click to extend)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const selectedIdsRef = useRef<Set<string>>(selectedIds);
  const selAnchorRef = useRef<string | null>(null);
  const selFocusRef = useRef<string | null>(null);
  useEffect(() => {
    selectedIdsRef.current = selectedIds;
  }, [selectedIds]);
 // deep link: /p/<page>#b-<blockId> ("Copy link to block") scrolls to and
 // briefly rings the target block — on mount AND on same-document hash nav
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | null = null;
    const flash = () => {
      const m = window.location.hash.match(/^#b-(.+)$/);
      if (!m) return;
      const el = document.querySelector(`[data-testid="block-${m[1]}"]`);
      if (!el) return;
      el.scrollIntoView({ block: "center" });
 // data attribute, not classList — React re-renders reset className but
 // leave unmanaged attributes alone (styled via globals.css)
      el.setAttribute("data-flash", "1");
      if (t) clearTimeout(t);
      t = setTimeout(() => el.removeAttribute("data-flash"), 2500);
    };
    flash();
    window.addEventListener("hashchange", flash);
    return () => {
      window.removeEventListener("hashchange", flash);
      if (t) clearTimeout(t);
    };
  }, []);

  const [dropTarget, setDropTarget] = useState<{ id: string; before: boolean; side?: "left" | "right" } | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "offline" | "error">("idle");

  const editables = useRef(new Map<string, HTMLElement>());
  const deletedIds = useRef(new Set<string>());
  const pendingFocus = useRef<{ id: string; pos: number | "start" | "end" } | null>(null);
  const draggingId = useRef<string | null>(null);
 // Snapshot merges must never clobber unsaved local edits: while dirty,
 // remote refreshes are deferred until our save commits (then reconciled).
  const dirtyRef = useRef(false);
  const seqRef = useRef(0);
  const needResyncRef = useRef(false);
  const applyRemoteRef = useRef<() => Promise<void>>(async () => {});
 // Block-level undo/redo. Native contentEditable undo fights our state model
 // and DESTROYS content (parity review R008) — we own the history instead.
  const historyRef = useRef<{ past: EBlock[][]; future: EBlock[][] }>({
    past: [],
    future: [],
  });
  const lastPushRef = useRef(0);
  const blocksRef = useRef<EBlock[]>(blocks);
  useEffect(() => {
    blocksRef.current = blocks;
  }, [blocks]);
  const rootRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

 // Ids the SERVER is known to hold (mount snapshot, refreshed on remote sync
 // and successful saves). Anything else in our list was created locally and
 // becomes a `set` operation, so the server can tell a fresh insert apart from
 // a stale block someone else already deleted.
  const serverIdsRef = useRef<Set<string>>(new Set(initialBlocks.map((b) => b.id)));

  const queue = getTransactionQueue();

  /**
   * One edit → one transaction of block-level operations, stored in IndexedDB
   * before anything else happens and sent by the tab's queue (see
   * lib/editor/transaction-queue.ts and docs/save-protocol-target.md §9 stage 1).
   * This replaced a debounced PUT of EVERY block on every keystroke: a request
   * that grew with the page until the browser refused it (65 KB of Korean under
   * a 64 KiB keepalive budget) and a whole page of edits went into a
   * localStorage draft that expired after 24 hours.
   */
  const commit = useCallback(
    (prev: EBlock[], next: EBlock[], userAction: string) => {
      const { ops, patches } = diffBlocks(prev, next, queue.sessionId);
      if (ops.length === 0 && patches.size === 0) return;
 // A text edit produced character ops AND a fresh instance for the block(s)
 // it touched (block-diff). Store that instance so the next diff starts from a
 // valid replica — content only, no version bump, so the DOM the user is
 // typing in is not resynced out from under the caret.
      if (patches.size) {
        const apply = (list: EBlock[]) =>
          list.map((b) => (patches.has(b.id) ? { ...b, content: patches.get(b.id)! } : b));
        blocksRef.current = apply(blocksRef.current);
        setBlocks((cur) => apply(cur));
      }
      if (ops.length === 0) return;
      dirtyRef.current = true;
      for (const op of ops) {
        if (op.command === "update" && op.args.alive === false) deletedIds.current.add(op.pointer.id);
        else deletedIds.current.delete(op.pointer.id);
      }
      setSaveState("saving");
      void queue.enqueue({
        id: newId(),
        pageId,
        timestamp: Date.now(),
        debug: { userAction, clientCommitTimeMs: Date.now() },
        operations: ops,
      });
    },
    [pageId, queue]
  );

 // Queue → editor: save state for the badge (and data-save-state for tests),
 // and after an acknowledgement, the housekeeping the old save did inline.
  useEffect(() => {
    queue.start();
    queue.setShareToken(pageId, shareToken);
    const offState = queue.subscribe(pageId, (s) => {
      if (s.pending === 0) {
        dirtyRef.current = false;
 // reconcile a deferred remote change once our own edits have landed — even
 // if we were not the one dirtying, a remote op to our focused block was
 // deferred and set this flag; applyRemote keeps the focused block and merges
 // the rest, so a paused tab still converges.
        if (needResyncRef.current) {
          needResyncRef.current = false;
          void applyRemoteRef.current();
        }
        setSaveState(s.touched ? "saved" : "idle");
      } else if (s.lastFailure === "network") setSaveState("offline");
      else if (s.lastFailure === "server" || s.lastFailure === "rejected") setSaveState("error");
      else setSaveState("saving");
    });
    const offAck = queue.onAck(pageId, ({ transactions, response }) => {
      for (const t of transactions) {
        for (const op of t.operations) {
          if (op.command === "update" && op.args.alive === false) {
            deletedIds.current.delete(op.pointer.id);
            serverIdsRef.current.delete(op.pointer.id);
          } else serverIdsRef.current.add(op.pointer.id);
        }
      }
 // refused for good (no edit right, malformed): what we show is not what the
 // server has — take the server's version back
      if (response === null) needResyncRef.current = true;
    });
 // an old-style draft (the failed-save localStorage copy) is an edit the
 // server never saw: hand it to the queue instead of throwing it away
    void migrateLegacyDraft(pageId);
    return () => {
      offState();
      offAck();
    };
  }, [pageId, queue, shareToken]);

  const mutate = useCallback(
    (updater: (prev: EBlock[]) => EBlock[], opts?: { coalesce?: boolean; action?: string }) => {
      dirtyRef.current = true;
      seqRef.current++;
      const now = Date.now();
      const h = historyRef.current;
 // plain typing coalesces into one undo frame; structural ops never do
      if (!(opts?.coalesce && now - lastPushRef.current < 1000)) {
        h.past.push(blocksRef.current.map((b) => ({ ...b, content: { ...b.content } })));
        if (h.past.length > 200) h.past.shift();
        h.future = [];
      }
      lastPushRef.current = now;
 // Run the updater exactly ONCE, here, instead of inside setBlocks. React may
 // invoke a setState updater more than once (dev StrictMode always does, and a
 // replayed render can too), and ours is not pure: the structural ops mint a
 // block id with newId() and set pendingFocus. Two invocations therefore built
 // two *different* blocks, and one Enter left a second blank line behind — a
 // ghost the server never received (it only ever saw the payload below).
 // blocksRef is the authoritative list, so back-to-back mutate calls inside one
 // handler still compose.
      const prev = blocksRef.current;
      const next = updater(prev);
      blocksRef.current = next;
      setBlocks(next);
      commit(prev, next, opts?.action ?? "mutate");
    },
    [commit]
  );

  const restoreSnapshot = useCallback(
    (snap: EBlock[]) => {
      dirtyRef.current = true;
      seqRef.current++;
      const restored = snap.map((b) => {
        const cur = blocksRef.current.find((x) => x.id === b.id);
        return {
          ...b,
          content: { ...b.content },
          version: Math.max(b.version, cur?.version ?? 0) + 1,
        };
      });
      const prev = blocksRef.current;
      blocksRef.current = restored;
      setBlocks(restored);
      commit(prev, restored, "history.restore");
    },
    [commit]
  );

  const undo = useCallback(() => {
    const h = historyRef.current;
    const snap = h.past.pop();
    if (!snap) return;
    h.future.push(blocksRef.current.map((b) => ({ ...b, content: { ...b.content } })));
    restoreSnapshot(snap);
  }, [restoreSnapshot]);

  const redo = useCallback(() => {
    const h = historyRef.current;
    const snap = h.future.pop();
    if (!snap) return;
    h.past.push(blocksRef.current.map((b) => ({ ...b, content: { ...b.content } })));
    restoreSnapshot(snap);
  }, [restoreSnapshot]);

 // Window-level so undo still works when the focused block was just removed.
 // Title/inputs keep their native undo.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      const k = e.key.toLowerCase();
      if (k === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if (k === "y" || (k === "z" && e.shiftKey)) {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);

 // Signal hydration completion (the e2e harness waits on this before typing —
 // keystrokes before handler attachment would be silently lost). The first
 // paragraph of a new page is seeded SERVER-side; the local fallback in
 // useState is only for legacy empty pages and is persisted on first edit.
  useEffect(() => {
 // page-scoped: a stale flag from the previous page's editor must not
 // satisfy a readiness check for this one (S020 navigation race)
    (window as unknown as Record<string, unknown>).__editorReady = pageId;
    return () => {
      (window as unknown as Record<string, unknown>).__editorReady = null;
    };
  }, [pageId]);

 // The emoji catalogue is a lazy chunk (see lib/emoji-data). Warm it a moment
 // after the editor settles: both `:shortcode:` expansion and the icon picker
 // then answer from memory, instead of the first `:tada:` racing a fetch.
  useEffect(() => {
    const warm = setTimeout(() => void loadEmojiSet(), 1000);
    return () => clearTimeout(warm);
  }, []);

 // A cross-block text selection that survived a Tab (see onRootKeyDownCapture)
  const pendingSelection = useRef<{ startId: string; startOff: number; endId: string; endOff: number } | null>(null);

 // Apply pending caret placement after React commits block changes.
 // useLayoutEffect (not useEffect): during fast typing the NEXT keydown can
 // arrive before a passive effect runs, landing keystrokes in the pre-split
 // block ("row-6row-7" merges, S032) — layout effects run before that.
  useLayoutEffect(() => {
    const pf = pendingFocus.current;
    if (!pf) return;
 // A block that changed depth is a different node in the React tree, so its
 // editable can arrive a frame late — and the map can still hold the detached
 // old one. Place the caret only in a CONNECTED node, and retry next frame
 // otherwise; dropping the request left the caret at offset 0 (Tab, measured).
    const apply = () => {
      const el = editables.current.get(pf.id);
      if (!el || !el.isConnected) return false;
      setCaret(el, pf.pos);
      if (typeof pf.pos === "number" && caretOffset(el) !== pf.pos) setCaret(el, pf.pos);
      return true;
    };
    if (apply()) {
      pendingFocus.current = null;
      return;
    }
    const raf = requestAnimationFrame(() => {
      if (apply()) pendingFocus.current = null;
    });
    return () => cancelAnimationFrame(raf);
  }, [blocks]);

 // …and the same for a text selection that spanned blocks (Tab keeps it).
  useLayoutEffect(() => {
    const ps = pendingSelection.current;
    if (!ps) return;
    const place = () => {
      const a = editables.current.get(ps.startId);
      const b = editables.current.get(ps.endId);
      if (!a || !b || !a.isConnected || !b.isConnected) return false;
      const at = (el: HTMLElement, off: number): [Node, number] => {
        let left = off;
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        let n = walker.nextNode();
        while (n) {
          const len = n.textContent?.length ?? 0;
          if (left <= len) return [n, left];
          left -= len;
          n = walker.nextNode();
        }
        return [el, el.childNodes.length];
      };
      const sel = window.getSelection();
      if (!sel) return true;
      const r = document.createRange();
      const [sn, so] = at(a, ps.startOff);
      const [en, eo] = at(b, ps.endOff);
      r.setStart(sn, so);
      r.setEnd(en, eo);
      sel.removeAllRanges();
      sel.addRange(r);
      return true;
    };
    if (place()) {
      pendingSelection.current = null;
      return;
    }
    const raf = requestAnimationFrame(() => {
      if (place()) pendingSelection.current = null;
    });
    return () => cancelAnimationFrame(raf);
  }, [blocks]);

 // After a remote character op re-rendered the focused block, put the caret
 // back after the same character it was after (design §3.5).
  useLayoutEffect(() => {
    const r = restoreCaretRef.current;
    if (!r) return;
    restoreCaretRef.current = null;
    const el = editables.current.get(r.blockId);
    const inst = textInstanceOf((blocksRef.current.find((b) => b.id === r.blockId) ?? { content: {} as BlockContent }).content);
    if (!el || !inst) return;
    let pos = 0;
    if (r.leftId !== "start") {
      const lp = livePosOfId(inst.items, r.leftId);
      pos = lp >= 0 ? lp + 1 : 0; // left char deleted remotely → fall back to start
    }
    setCaret(el, pos);
  }, [blocks]);


 // Remote changes (other clients): refetch and merge, block-level LWW.
 // The locally-focused block always wins; unsaved local blocks are kept.
  const applyRemote = useCallback(async () => {
    if (dirtyRef.current) {
      needResyncRef.current = true; // reconcile after our own save lands
      return;
    }
    const seqAtStart = seqRef.current;
    const res = await fetch(`/api/pages/${pageId}/blocks`).catch(() => null);
    if (!res?.ok) return;
    const { blocks: rows } = (await res.json()) as { blocks: Block[] };
 // ids the server held BEFORE this sync: a local block in that set that is
 // now missing from `rows` was deleted remotely — keeping it would turn it
 // into a "new" block on the next save and resurrect it
    const prevServerIds = serverIdsRef.current;
    serverIdsRef.current = new Set(rows.map((r) => r.id));

 // Local edits raced this fetch — the snapshot is stale relative to what
 // the user just typed. Merging it would clobber those keystrokes (found
 // by S032: seed block emptied when the mount-sync response landed right
 // after the first Enter). Defer to the post-save resync instead.
    if (seqRef.current !== seqAtStart || dirtyRef.current) {
      needResyncRef.current = true;
      return;
    }

    const active = document.activeElement as HTMLElement | null;
    const tid = active?.dataset?.testid;
    const focusedId = tid?.startsWith("block-editable-")
      ? tid.slice("block-editable-".length)
      : null;

    setBlocks((prev) => {
      const prevById = new Map(prev.map((b) => [b.id, b]));
      const next: EBlock[] = [];
      for (const row of rows) {
        if (deletedIds.current.has(row.id)) continue; // deleted locally, save pending
        const old = prevById.get(row.id);
        if (old && row.id === focusedId) {
          // The block the caret is in. applyRemote only runs when nothing is
          // dirty (guarded above), so the DOM is not mid-keystroke: rebuild it
          // from the server if it drifted (a deferred remote op), keeping the
          // caret after the same character via item coordinates.
          if (JSON.stringify(old.content) === JSON.stringify(row.content ?? {})) { next.push(old); continue; }
          const cap = captureCaret(focusedId, prev);
          if (cap) restoreCaretRef.current = cap;
          next.push({ ...fromRow(row), version: old.version + 1 });
          continue;
        }
        if (
          old &&
          old.type === row.type &&
          old.position === row.position &&
          (old.parentBlockId ?? null) === (row.parentBlockId ?? null) &&
          JSON.stringify(old.content) === JSON.stringify(row.content ?? {})
        ) {
          next.push(old); // unchanged — keep identity and DOM
        } else {
          next.push({ ...fromRow(row), version: (old?.version ?? 0) + 1 });
        }
      }
      const rowIds = new Set(rows.map((r) => r.id));
      for (const b of prev) {
        if (rowIds.has(b.id)) continue;
 // deleted remotely (the server used to hold it) — drop it, unless the
 // caret is inside: never yank content out from under the user
        if (prevServerIds.has(b.id) && b.id !== focusedId) continue;
        next.push(b); // created locally, save pending (or focused survivor)
      }
      blocksRef.current = next; // in step now, not one effect later (see above)
      return next;
    });
  }, [pageId]);

  useEffect(() => {
    applyRemoteRef.current = applyRemote;
  }, [applyRemote]);

 // Mount sync: browser-back can hydrate from a stale router-cache RSC
 // snapshot (blocks added since that visit would be missing). Reconcile with
 // the server once; applyRemote's dirty/seq/focus guards keep S032 safe.
  useEffect(() => {
    void applyRemoteRef.current();
  }, []);

 // Another client's save arrives as the transactions the server applied
 // (target §4.4): apply the same operations here instead of refetching the
 // page. Block-level LWW until the text CRDT (stage 3): the block the caret
 // is in keeps the local version — a remote content change to it would yank
 // the text out from under the typist — and is reconciled on the next full
 // sync. "blocks" (disk edits, non-transaction writers) and reconnects still
 // refetch.
  const bump = (b: EBlock, content: BlockContent): EBlock => ({ ...b, content, version: b.version + 1 });
  const restoreCaretRef = useRef<{ blockId: string; leftId: ItemId | "start" } | null>(null);
 // the character just left of the caret in the focused block, so it can be
 // found again after a remote op re-renders that block
  const captureCaret = (blockId: string, list: EBlock[]): { blockId: string; leftId: ItemId | "start" } | null => {
    const el = editables.current.get(blockId);
    if (!el || document.activeElement !== el) return null;
    const off = caretOffset(el);
    const inst = textInstanceOf((list.find((b) => b.id === blockId) ?? { content: {} as BlockContent }).content);
    if (!inst) return null;
    return { blockId, leftId: off > 0 ? liveIdAtPos(inst.items, off - 1) ?? "start" : "start" };
  };

  const applyRemoteTransactions = useCallback((txs: Transaction[]) => {
    const active = document.activeElement as HTMLElement | null;
    const tid = active?.dataset?.testid;
    const focusedId = tid?.startsWith("block-editable-") ? tid.slice("block-editable-".length) : null;
    let deferred = false;
    setBlocks((prev) => {
      let next = prev;
      for (const t of txs) {
        for (const op of t.operations) {
          const id = op.pointer.id;
          if (op.command === "set") {
            const a = op.args;
            const cur = next.find((b) => b.id === id);
            if (cur && id === focusedId) {
              deferred = true;
              continue;
            }
            const row: EBlock = { id, type: a.type, content: a.content ?? {}, parentBlockId: a.parentBlockId ?? null, position: a.position, version: (cur?.version ?? 0) + 1 };
            next = cur ? next.map((b) => (b.id === id ? row : b)) : [...next, row];
            serverIdsRef.current.add(id);
          } else if (op.command === "update") {
            const a = op.args;
            if (a.alive === false) {
              next = next.filter((b) => b.id !== id);
              serverIdsRef.current.delete(id);
              continue;
            }
            const cur = next.find((b) => b.id === id);
            if (!cur) {
              if (a.alive === true) deferred = true; // a revive we cannot rebuild from a partial update
              continue;
            }
            if (id === focusedId && a.content !== undefined) {
              deferred = true;
              continue;
            }
            next = next.map((b) =>
              b.id === id
                ? {
                    ...b,
                    type: a.type ?? b.type,
                    content: a.content ?? b.content,
                    parentBlockId: a.parentBlockId !== undefined ? a.parentBlockId : b.parentBlockId,
 // position travels with parentBlockId in an indent/outdent (block-diff sends
 // both); dropping it here left the other tab with the new parent and the old
 // order, so the same page rendered differently in two tabs.
                    position: a.position !== undefined ? (a.position as number) : b.position,
                    version: b.version + 1,
                  }
                : b
            );
          } else if (isTextOperation(op)) {
            // a remote character op: merge it into our items and re-render. When
            // it lands in the block the caret is in, remember the character just
            // left of the caret and put the caret back after it once React has
            // re-rendered — so a remote insert to our left does not drag our
            // cursor along (design §3.5). While an IME is composing, defer: the
            // browser owns the DOM until the syllable commits, and re-rendering
            // under it drops the composition.
            const cur = next.find((b) => b.id === id);
            const targetId = op.command === "moveTextSlice" ? op.args.toBlock : id;
            const tgt = op.command === "moveTextSlice" ? next.find((b) => b.id === targetId) : cur;
            const touchesFocus = id === focusedId || targetId === focusedId;
            if (!cur || (op.command === "moveTextSlice" && !tgt) || (touchesFocus && composingRef.current)) {
              deferred = true;
              continue;
            }
            try {
              const caretLeft = touchesFocus ? captureCaret(focusedId!, next) : null;
              if (op.command === "moveTextSlice") {
                const r = applyMoveTextSlice(cur.content, tgt!.id === cur.id ? null : tgt!.content, op);
                next = next.map((b) => (b.id === cur.id ? bump(b, r.source) : b.id === tgt!.id ? bump(b, r.target) : b));
              } else {
                const content = applyTextOp(cur.content, op);
                next = next.map((b) => (b.id === id ? bump(b, content) : b));
              }
              if (caretLeft) restoreCaretRef.current = caretLeft;
            } catch {
              deferred = true;
            }
          }
        }
      }
      const out = next === prev ? prev : next;
 // keep blocksRef in step with the state right now, not one effect later:
 // a keystroke that fires before the [blocks] effect runs would otherwise
 // diff against a list missing this remote change and drop the edit.
      blocksRef.current = out;
      return out;
    });
    if (deferred) needResyncRef.current = true;
  }, []);

  const resyncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
 // A remote op we could not apply live (its origin was not in our items yet —
 // it arrived before the op it depends on, or landed in a block we are
 // composing in) sets needResync. Service it shortly even while idle, so a tab
 // that is not itself saving still converges instead of waiting for its next
 // edit. applyRemote keeps the focused block and reconciles the rest.
  const scheduleResync = useCallback(() => {
    if (resyncTimer.current) return;
    resyncTimer.current = setTimeout(() => {
      resyncTimer.current = null;
      if (needResyncRef.current && !dirtyRef.current) void applyRemoteRef.current();
      else if (needResyncRef.current) scheduleResync();
    }, 400);
  }, []);

  usePageSync(pageId, queue.sessionId, (event) => {
    if (event.type === "transactions" && event.transactions) {
      applyRemoteTransactions(event.transactions);
      if (needResyncRef.current) scheduleResync();
    } else if (event.type === "blocks") void applyRemote();
  }, shareToken);

 // A remote change to the block you are typing in is deferred to keep your
 // caret (applyRemoteTransactions); when you move the caret out of the editor
 // — or to another block — reconcile so the block catches up to the server.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const onFocusOut = () => {
      // reconcile the block we just left (applyRemote keeps whatever is focused
      // now, so this is safe whether we moved to another block or clicked away)
      setTimeout(() => {
        if (needResyncRef.current && !dirtyRef.current) void applyRemoteRef.current();
      }, 0);
    };
    root.addEventListener("focusout", onFocusOut);
    return () => root.removeEventListener("focusout", onFocusOut);
  }, []);

  useImperativeHandle(apiRef, () => ({
    focusFirst: () => {
      const roots = blocks
        .filter((b) => !b.parentBlockId)
        .sort((a, b) => a.position - b.position);
      const first = roots[0];
      if (!first) return;
      const el = editables.current.get(first.id);
      if (el) setCaret(el, "start");
    },
  }));

  const childrenOf = useCallback(
    (parentId: string | null) =>
      blocksRef.current
        .filter((b) => (b.parentBlockId ?? null) === parentId)
        .sort((a, b) => a.position - b.position),
    []
  );

  const numberOf = useCallback(
    (b: EBlock) => {
      const sibs = blocksRef.current
        .filter((x) => (x.parentBlockId ?? null) === (b.parentBlockId ?? null))
        .sort((x, y) => x.position - y.position);
      let n = 0;
      for (const s of sibs) {
        if (s.type === "numbered_list") n += 1;
        else n = 0;
        if (s.id === b.id) break;
      }
      return Math.max(n, 1);
    },
    []
  );

  const positionAfter = useCallback((all: EBlock[], after: EBlock): number => {
    const sibs = all
      .filter((b) => (b.parentBlockId ?? null) === (after.parentBlockId ?? null))
      .sort((a, b) => a.position - b.position);
    const idx = sibs.findIndex((s) => s.id === after.id);
    const next = sibs[idx + 1];
    return next ? (after.position + next.position) / 2 : after.position + 1;
  }, []);

  const registerEl = useCallback((id: string, el: HTMLElement | null) => {
    if (el) editables.current.set(id, el);
    else editables.current.delete(id);
  }, []);

  /**
   * Turn a block into `type`. The target is passed in rather than read from the
   * slash state so the empty-page starter panel can use the same path — one
   * conversion routine, not two that drift.
   */
  const applyPick = useCallback(
    (
      type: BlockType,
      preset: Record<string, unknown> | undefined,
      target: { blockId: string; offset: number; query: string; bare?: boolean }
    ) => {
      const { blockId, offset, query } = target;

 // A database block must provision a collection server-side, so it can't
 // be done in the synchronous mutate path. Convert now, create async,
 // then stamp the databaseId when it lands.
      if (type === "database") {
        mutate((prev) =>
          prev.map((b) =>
            b.id === blockId
              ? { ...b, type: "database" as BlockType, content: { text: "" }, version: b.version + 1 }
              : b
          )
        );
        void (async () => {
          const res = await fetch("/api/databases", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ title: "Tasks" }),
          });
          if (!res.ok) return;
          const { database } = await res.json();
          mutate((prev) =>
            prev.map((b) =>
              b.id === blockId
                ? { ...b, content: { databaseId: database.id, ...(preset ?? {}) }, version: b.version + 1 }
                : b
            )
          );
        })();
        return;
      }

 // A sub-page block links to a real page. Create it (so it appears in the
 // sidebar tree + breadcrumbs), then stamp its id when it lands.
      if (type === "child_page") {
        mutate((prev) => {
          const next = prev.map((b) => ({ ...b }));
          const cur = next.find((b) => b.id === blockId);
          if (!cur) return prev;
          cur.type = "child_page" as BlockType;
          cur.content = {};
          cur.version++;
 // A sub-page renders as an uneditable link chip. If it is the last block
 // among its siblings there is nothing below to hold the caret and the page
 // looks frozen (QA-4). Give it a trailing empty paragraph to type into.
          const hasSiblingAfter = next.some(
            (b) =>
              b.id !== cur.id &&
              (b.parentBlockId ?? null) === (cur.parentBlockId ?? null) &&
              b.position > cur.position
          );
          if (!hasSiblingAfter) {
            const nb = freshParagraph(cur.parentBlockId ?? null, positionAfter(next, cur));
            next.push(nb);
            pendingFocus.current = { id: nb.id, pos: "start" };
          }
          return next;
        });
        void (async () => {
          const child = await usePagesStore.getState().createPage(pageId);
          mutate((prev) =>
            prev.map((b) =>
              b.id === blockId
                ? { ...b, content: { childPageId: child.id }, version: b.version + 1 }
                : b
            )
          );
        })();
        return;
      }

 // A columns layout: turn this block into a column_list holding two empty
 // columns (each a block whose children stack vertically).
      if (type === "column_list") {
        mutate((prev) => {
          const next = prev.map((b) => ({ ...b }));
          const cur = next.find((b) => b.id === blockId);
          if (!cur) return prev;
          cur.type = "column_list";
          cur.content = {};
          cur.version++;
          const col1: EBlock = { id: newId(), type: "column", content: {}, parentBlockId: cur.id, position: 1, version: 0 };
          const col2: EBlock = { id: newId(), type: "column", content: {}, parentBlockId: cur.id, position: 2, version: 0 };
          const p1 = freshParagraph(col1.id, 1);
          const p2 = freshParagraph(col2.id, 1);
          next.push(col1, col2, p1, p2);
          pendingFocus.current = { id: p1.id, pos: "start" };
          return next;
        });
        return;
      }

      mutate((prev) => {
        const next = prev.map((b) => ({ ...b }));
        const cur = next.find((b) => b.id === blockId);
        if (!cur) return prev;
        const el = editables.current.get(blockId);
        const text = el ? normalize(el) : cur.content.text ?? "";
        const stripped = target.bare ? text.slice(query.length) : text.slice(0, offset - 1) + text.slice(offset + query.length);

        if (type === "divider") {
          cur.type = "divider";
          cur.content = {};
          cur.version++;
          const nb = freshParagraph(cur.parentBlockId, 0);
          nb.position = positionAfter(next, cur);
          nb.content.text = stripped;
          nb.content.html = undefined;
          next.push(nb);
          pendingFocus.current = { id: nb.id, pos: "start" };
          return next;
        }

        cur.type = type;
 // conversions restart from plain text — stale html would resurrect
 // the "/command" string through the html-first DOM sync
        cur.content = { ...cur.content, text: stripped, html: undefined };
        if (type === "code") cur.content.language = cur.content.language ?? "plain";
        if (type === "todo") cur.content.checked = cur.content.checked ?? false;
        if (type === "toggle") cur.content.expanded = true;
        if (type === "image") cur.content.url = cur.content.url ?? "";
 // a fresh table is 3×3 with no header row, like the original's (measured:
 // e2e/fixtures/notion-table-grip.json §newTable)
        if (type === "table")
          cur.content.table = cur.content.table ?? {
            cells: [["", "", ""], ["", "", ""], ["", "", ""]],
          };
        if (preset) Object.assign(cur.content, preset);
        cur.version++;
 // image/table manage their own focus targets, not a text caret
        if (type !== "image" && type !== "table") {
          pendingFocus.current = { id: cur.id, pos: Math.max(offset - 1, 0) };
        }
        return next;
      });
    },
    [mutate, positionAfter, pageId]
  );

  /**
   * The empty-page 데이터베이스 button: this page BECOMES the database.
   *
   * Notion does not put an inline table inside a prose page here — the page's
   * own title turns into the database's, so the block is flagged fullPage and
   * the database is provisioned bare (one 이름 column, one 표 view). The inline
   * table is what /database gives you.
   */
  const becomeDatabasePage = useCallback(
    async (blockId: string) => {
      mutate((prev) =>
        prev.map((b) =>
          b.id === blockId
            ? { ...b, type: "database" as BlockType, content: { fullPage: true }, version: b.version + 1 }
            : b
        )
      );
      const res = await fetch("/api/databases", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ shape: "minimal", title: "" }),
      });
      if (!res.ok) return;
      const { database } = await res.json();
      mutate((prev) =>
        prev.map((b) =>
          b.id === blockId
            ? { ...b, content: { databaseId: database.id, fullPage: true }, version: b.version + 1 }
            : b
        )
      );
   // the page is now a database page: widen it, and mark it locally so the
   // sidebar renames/re-icons the row at once — waiting for the next /api/pages
   // round trip is what made the label appear to change only after navigating
   // away and back.
      usePagesStore.getState().markAsDatabase(pageId);
      void usePagesStore.getState().updatePage(pageId, { fullWidth: true });
    },
    [mutate, pageId]
  );

  const applySlashPick = useCallback(
    (type: BlockType, preset?: Record<string, unknown>) => {
      if (!slash) return;
      const target = { blockId: slash.blockId, offset: slash.offset, query: slash.query, bare: slash.bare };
      setSlash(null);
      applyPick(type, preset, target);
    },
    [slash, applyPick]
  );

  const applyMentionPick = useCallback(
    (item: MentionItem) => {
      if (!mention) return;
      const { blockId, query } = mention;
      setMention(null);
      const el = editables.current.get(blockId);
      if (!el) return;
      el.focus();
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return;
      const range = sel.getRangeAt(0);
 // delete the "@" + query typed right before the caret (single text node)
      const back = 1 + query.length;
      try {
        range.setStart(range.startContainer, Math.max(0, range.startOffset - back));
      } catch {
 // caret spans nodes — skip the delete, just insert at the caret
      }
      sel.removeAllRanges();
      sel.addRange(range);
 // insertHTML replaces the selection with the chip, preserving the rest of
 // the block's inline formatting (the standard rich-editor technique).
      document.execCommand("insertHTML", false, mentionChipHtml(item, escapeHtml) + " ");
 // persist without bumping version so the DOM (and caret) isn't resynced
      const html = sanitizeInline(el.innerHTML);
      const text = normalize(el);
      mutate((prev) =>
        prev.map((b) => (b.id === blockId ? { ...b, content: { ...b.content, text, html } } : b))
      );
    },
    [mention, mutate]
  );

  const applyEmojiPick = useCallback(
    (item: EmojiCandidate) => {
      if (!emojiSug) return;
      const { blockId, query } = emojiSug;
      setEmojiSug(null);
      const el = editables.current.get(blockId);
      if (!el) return;
      el.focus();
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return;
      const range = sel.getRangeAt(0);
 // delete the ":" + query typed right before the caret (single text node)
      const back = 1 + query.length;
      try {
        range.setStart(range.startContainer, Math.max(0, range.startOffset - back));
      } catch {
 // caret spans nodes — skip the delete, just insert at the caret
      }
      sel.removeAllRanges();
      sel.addRange(range);
      document.execCommand("insertText", false, item.emoji);
      const html = sanitizeInline(el.innerHTML);
      const text = normalize(el);
      mutate((prev) =>
        prev.map((b) => (b.id === blockId ? { ...b, content: { ...b.content, text, html } } : b))
      );
    },
    [emojiSug, mutate]
  );

 // Tab / Shift+Tab on one block or on a whole selection. The rules (which run
 // of siblings moves, what the outdented block adopts, how positions are
 // rewritten) are in lib/editor/indent.ts, measured on the original
 // 2026-09-10 — docs/notion-indent.md.
 //
 // `keepCaret` restores the caret to the same character afterwards: the row
 // remounts at its new depth, so without this the caret lands at offset 0 of
 // the new node (measured on our own app before the fix).
  const nest = useCallback(
    (ids: string[], dir: "in" | "out", keepCaret?: { id: string; el: HTMLElement }) => {
      const off = keepCaret ? caretOffset(keepCaret.el) : null;
      let moved = false;
      mutate((prev) => {
        const next = prev.map((b) => ({ ...b }));
        moved = dir === "in" ? indentBlocks(next, ids) : outdentBlocks(next, ids);
        if (!moved) return prev; // refused: no previous sibling, or it takes no children
        if (keepCaret && off !== null) pendingFocus.current = { id: keepCaret.id, pos: off };
        return next;
      });
      return moved;
    },
    [mutate]
  );

  const splitBlock = useCallback(
    (id: string, el: HTMLElement) => {
      const off = caretOffset(el);
      const text = normalize(el);
      const before = text.slice(0, off);
      const after = text.slice(off);

 // Extract the DOM after the caret so inline formatting survives the
 // split (plain-text slicing would drop b/i/code/a marks).
      let beforeHtml = "";
      let afterHtml = "";
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0 && text !== "") {
        const endRange = document.createRange();
        endRange.selectNodeContents(el);
        endRange.setStart(sel.getRangeAt(0).startContainer, sel.getRangeAt(0).startOffset);
        const tmp = document.createElement("div");
        tmp.appendChild(endRange.extractContents());
        afterHtml = sanitizeInline(tmp.innerHTML);
        beforeHtml = sanitizeInline(el.innerHTML);
      }

      mutate((prev) => {
        const next = prev.map((b) => ({ ...b, content: { ...b.content } }));
        const cur = next.find((b) => b.id === id);
        if (!cur) return prev;

 // Enter on an empty paragraph inside a callout leaves the callout: the
 // paragraph goes, a fresh one lands right after the callout (the original)
        const host = cur.parentBlockId ? next.find((b) => b.id === cur.parentBlockId) : undefined;
        if (cur.type === "paragraph" && text === "" && host?.type === "callout") {
          const out = freshParagraph(host.parentBlockId, 0);
          out.position = positionAfter(next, host);
          deletedIds.current.add(cur.id);
          const rest = next.filter((b) => b.id !== cur.id);
          rest.push(out);
          pendingFocus.current = { id: out.id, pos: "start" };
          return rest;
        }
 // Enter on an empty continuing block. Measured on the original (T5b,
 // 2026-09-10): an INDENTED empty list item climbs one level and stays a list
 // item; only at the top level does it become a paragraph. We used to convert
 // in place at any depth, which made a nested list impossible to leave without
 // Shift+Tab.
        if (CONTINUING.includes(cur.type) && text === "") {
          if (cur.parentBlockId) {
            if (outdentBlocks(next, [cur.id])) {
              pendingFocus.current = { id: cur.id, pos: "start" };
              return next;
            }
          }
          cur.type = "paragraph";
          cur.version++;
          pendingFocus.current = { id: cur.id, pos: "start" };
          return next;
        }

        cur.content.text = before;
        cur.content.html = beforeHtml;
        cur.version++;

 // Enter at the end of an OPEN toggle puts the new line inside it, as its
 // first child — the original's behaviour (2026-08-26 input cases). A
 // collapsed toggle, or a split mid-title, keeps the sibling behaviour.
        const intoToggle = cur.type === "toggle" && cur.content.expanded !== false && after === "";
 // A callout is a container in the original: its text IS its first child
 // paragraph. Enter at the end of the callout's own text adopts that model —
 // the text moves into a real first child, and the new line becomes the
 // second — so Tab/Backspace/Enter inside behave exactly as there.
        const intoCallout = cur.type === "callout" && after === "";
        let firstPos = 1;
        if (intoCallout && (cur.content.text ?? "") !== "") {
          const p1 = freshParagraph(cur.id, 0);
          const kids = next.filter((b) => b.parentBlockId === cur.id);
          p1.position = kids.length ? Math.min(...kids.map((k) => k.position)) - 2 : 0;
          p1.content.text = cur.content.text ?? "";
          p1.content.html = cur.content.html;
          cur.content.text = "";
          cur.content.html = undefined;
          next.push(p1);
          firstPos = p1.position + 1;
        }
        const nb = freshParagraph(intoToggle || intoCallout ? cur.id : cur.parentBlockId, 0);
        if (intoCallout) nb.position = firstPos;
        else if (intoToggle) {
          const kids = next.filter((b) => b.parentBlockId === cur.id);
          nb.position = kids.length ? Math.min(...kids.map((k) => k.position)) - 1 : 1;
        } else nb.position = positionAfter(next, cur);
        nb.content.text = after;
        nb.content.html = afterHtml;
        if (CONTINUING.includes(cur.type)) {
          nb.type = cur.type;
          if (cur.type === "todo") nb.content.checked = false;
        }
        next.push(nb);
 // The children go with the SECOND half. Measured on the original
 // (T13/T13b/T13c/T14b, 2026-09-10): pressing Enter at the end of a block that
 // has children puts the new line directly under it and re-parents the
 // children to that new line — so the nesting below stays put instead of the
 // new block appearing under the whole subtree at the wrong level.
 // A toggle/callout keeps its own children: there the new block went INSIDE it.
        if (!intoToggle && !intoCallout) moveChildren(next, cur.id, nb.id);
        pendingFocus.current = { id: nb.id, pos: "start" };
        return next;
      });
    },
    [mutate, positionAfter]
  );

  const handleBackspaceAtStart = useCallback(
    (id: string, el: HTMLElement): boolean => {
      const text = normalize(el);
      const block = blocksRef.current.find((b) => b.id === id);
      if (!block) return false;

 // Backspace at offset 0 peels ONE thing per press, and the original's order
 // depends on the type (measured 2026-09-10, docs/notion-indent.md):
 //   a nested list item  → drops the bullet/number/checkbox, SAME depth (T7c)
 //   anything else nested → climbs one level (T7 paragraph, T7b later child,
 //                          T7d heading — the heading stays a heading)
 //   at the top level     → the existing style-drop / merge below
 // Before this an indented block merged into its previous sibling, and an
 // indented FIRST child did nothing at all: it was stuck at its depth.
      if (LIST_TYPES.has(block.type)) {
        mutate((prev) =>
          prev.map((b) =>
            b.id === id ? { ...b, type: "paragraph" as BlockType, version: b.version + 1 } : b
          )
        );
        pendingFocus.current = { id, pos: "start" };
        return true;
      }
      if (block.parentBlockId) {
        if (nest([id], "out", { id, el })) return true;
      }

 // Styled block → demote to paragraph first.
      if (block.type !== "paragraph" && TEXT_TYPES.includes(block.type)) {
        mutate((prev) =>
          prev.map((b) =>
            b.id === id ? { ...b, type: "paragraph" as BlockType, version: b.version + 1 } : b
          )
        );
 // the row re-mounts as a paragraph; without this the caret is gone and the
 // next keystroke lands nowhere (2026-08-26 input cases)
        pendingFocus.current = { id, pos: "start" };
        return true;
      }

      const sibs = childrenOf(block.parentBlockId ?? null);
      const idx = sibs.findIndex((s) => s.id === id);
      const prevSib = sibs[idx - 1];
 // First child of a toggle: Backspace at its start folds it back into the
 // toggle's title — the original's behaviour (Enter into an open toggle, then
 // Backspace, leaves you typing at the end of the title; 2026-08-26 cases)
      if (!prevSib) {
        const parent = block.parentBlockId ? blocksRef.current.find((b) => b.id === block.parentBlockId) : undefined;
        if (!parent || parent.type !== "toggle") return false;
        const parentLen = (parent.content.text ?? "").length;
        const curHtml = block.content.html ?? escapeHtml(text);
        deletedIds.current.add(id);
        mutate((prev) =>
          prev
            .filter((b) => b.id !== id)
            .map((b) =>
              b.id === parent.id
                ? { ...b, content: { ...b.content, text: (b.content.text ?? "") + text, html: sanitizeInline((b.content.html ?? escapeHtml(b.content.text ?? "")) + curHtml) }, version: b.version + 1 }
                : b
            )
        );
        pendingFocus.current = { id: parent.id, pos: parentLen };
        return true;
      }

 // Previous block is non-text (divider/image) → remove it instead.
      if (!TEXT_TYPES.includes(prevSib.type) && prevSib.type !== "code") {
        deletedIds.current.add(prevSib.id);
        mutate((prev) => prev.filter((b) => b.id !== prevSib.id));
        return true;
      }

 // Merge into the previous text block (rich HTML concat keeps marks).
      const prevLen = (prevSib.content.text ?? "").length;
      const curHtml = block.content.html ?? escapeHtml(text);
      deletedIds.current.add(id);
      mutate((prev) => {
 // Nothing renders a block whose parent is gone (roots are parentBlockId ===
 // null), so a merge that deletes a block with children used to make that
 // whole subtree vanish from the page while still saving it. The original lifts
 // them to where the deleted block was — NOT into the block that absorbed the
 // text (T28: A, B⊃K → Backspace at B's start leaves 'AB' and K at the TOP
 // level right after it).
        const lifted = prev.map((b) => ({ ...b }));
        liftChildren(lifted, id, block.parentBlockId ?? null, prevSib.id);
        const next = lifted
          .filter((b) => b.id !== id)
          .map((b) =>
            b.id === prevSib.id
              ? {
                  ...b,
                  content: {
                    ...b.content,
                    text: (b.content.text ?? "") + text,
                    html: sanitizeInline(
                      (b.content.html ?? escapeHtml(b.content.text ?? "")) + curHtml
                    ),
                  },
                  version: b.version + 1,
                }
              : b
          );
        return next;
      });
      pendingFocus.current = { id: prevSib.id, pos: prevLen };
      return true;
    },
    [childrenOf, mutate, nest]
  );

  const moveBlock = useCallback(
    (id: string, dir: -1 | 1, el: HTMLElement) => {
      const off = caretOffset(el);
      mutate((prev) => {
        const next = prev.map((b) => ({ ...b }));
        const cur = next.find((b) => b.id === id);
        if (!cur) return prev;
        const sibs = next
          .filter((b) => (b.parentBlockId ?? null) === (cur.parentBlockId ?? null))
          .sort((a, b) => a.position - b.position);
        const idx = sibs.findIndex((s) => s.id === id);
        const swap = sibs[idx + dir];
        if (!swap) return prev;
        const tmp = cur.position;
        cur.position = swap.position;
        swap.position = tmp;
        pendingFocus.current = { id, pos: off };
        return next;
      });
    },
    [mutate]
  );

  const onInput = useCallback(
    (id: string, el: HTMLElement) => {
 // inline markdown (**bold** etc.) / :emoji: autoformat — rewrites the
 // DOM in place; normalize() below re-reads it either way. Never while an IME
 // composes: replacing nodes it is composing into drops the pending syllable.
 // The next non-composing keystroke autoformats instead (a closing "**" is
 // ASCII, so nothing a user can type is left unformatted).
      if (
        !composingRef.current &&
        el.closest("[data-block-type]")?.getAttribute("data-block-type") !== "code"
      )
        tryInlineAutoformat();
      const text = normalize(el);

      if (pasteLink && pasteLink.blockId === id) setPasteLink(null);

 // :emoji live query (closes on removed ':' or a space)
      if (emojiSug && emojiSug.blockId === id) {
        if (text.length < emojiSug.offset || text[emojiSug.offset - 1] !== ":") {
          setEmojiSug(null);
        } else {
          const q = text.slice(emojiSug.offset);
          if (/\s/.test(q) || q.length > 30) setEmojiSug(null);
          else setEmojiSug({ ...emojiSug, query: q, selected: 0 });
        }
      }

 // @-mention live query (closes on removed '@' or a space)
      if (mention && mention.blockId === id) {
        if (text.length < mention.offset || text[mention.offset - 1] !== "@") {
          setMention(null);
        } else {
          const q = text.slice(mention.offset);
          if (/\s/.test(q)) setMention(null);
          else setMention({ ...mention, query: q, selected: 0 });
        }
      }

 // slash-menu live query
      if (slash && slash.blockId === id) {
        if (slash.bare) {
          setSlash({ ...slash, query: text, selected: 0 });
        } else if (text.length < slash.offset || text[slash.offset - 1] !== "/") {
          setSlash(null);
        } else {
          const query = text.slice(slash.offset);
          setSlash({ ...slash, query, selected: 0 });
        }
      } else {
 // markdown shortcuts on a plain paragraph — and, as the original does, on a
 // list item whose whole text is the prefix (an empty bullet turning into a
 // heading, a toggle, a divider…; 2026-08-26 input cases)
        const block = blocksRef.current.find((b) => b.id === id);
        if (block && SHORTCUT_HOSTS.has(block.type)) {
 // we convert on the third backtick immediately, no space needed
          if (text === "```") {
            mutate((prev) =>
              prev.map((b) =>
                b.id === id
                  ? {
                      ...b,
                      type: "code" as BlockType,
                      content: { ...b.content, text: "", html: undefined, language: "plain" },
                      version: b.version + 1,
                    }
                  : b
              )
            );
            pendingFocus.current = { id, pos: "start" };
            return;
          }
 // "---" becomes a divider on the third dash — the original converts
 // immediately, no space ("- " is already the bullet shortcut, so a
 // space-terminated form could never be reached). Same shape as the slash
 // menu's divider: the line turns into the rule, the caret lands on a fresh
 // paragraph below it.
          if (text === "---") {
            mutate((prev) => {
              const next = prev.map((b) => ({ ...b }));
              const cur = next.find((b) => b.id === id);
              if (!cur) return prev;
              cur.type = "divider" as BlockType;
              cur.content = {};
              cur.version++;
              const nb = freshParagraph(cur.parentBlockId, 0);
              nb.position = positionAfter(next, cur);
              next.push(nb);
              pendingFocus.current = { id: nb.id, pos: "start" };
              return next;
            });
            return;
          }
          for (const s of MARKDOWN_SHORTCUTS) {
            if (s.type === block.type) continue; // the original leaves "- " in a bullet as text
            if (text === s.prefix + " " || text === s.prefix + " ") {
              mutate((prev) =>
                prev.map((b) =>
                  b.id === id
                    ? {
                        ...b,
                        type: s.type,
                        content: {
                          ...b.content,
                          text: "",
                          html: undefined,
                          ...(s.type === "code" ? { language: "plain" } : {}),
                          ...(s.type === "todo" ? { checked: false } : {}),
                          ...(s.type === "toggle" ? { expanded: true } : {}),
                        },
                        version: b.version + 1,
                      }
                    : b
                )
              );
              pendingFocus.current = { id, pos: "start" };
              return;
            }
          }
        }
      }

      const html = sanitizeInline(el.innerHTML);
      mutate(
        (prev) =>
          prev.map((b) =>
            b.id === id ? { ...b, content: { ...b.content, text, html } } : b
          ),
        { coalesce: true }
      );
    },
    [slash, mention, emojiSug, pasteLink, mutate, positionAfter]
  );

 // Smart paste: clipboard image → upload + image block; markdown/multi-line
 // text → parse into MULTIPLE blocks split at the caret; single plain line →
 // the original inline paste. Code blocks always paste literally.
  const onPaste = useCallback(
    (id: string, e: React.ClipboardEvent, el: HTMLElement) => {
      const cd = e.clipboardData;
      const block = blocksRef.current.find((b) => b.id === id);

 // Code blocks take clipboard content verbatim (never linkify / parse).
      if (block?.type === "code") {
        e.preventDefault();
        document.execCommand("insertText", false, cd.getData("text/plain"));
        return;
      }

 // 1) An image on the clipboard → upload it and insert an image block.
      const files = cd.files ? Array.from(cd.files) : [];
      const items = cd.items ? Array.from(cd.items) : [];
      const imageFile =
        files.find((f) => f.type.startsWith("image/")) ??
        items.find((it) => it.kind === "file" && it.type.startsWith("image/"))?.getAsFile() ??
        null;
      if (imageFile) {
        e.preventDefault();
        void (async () => {
          const up = await uploadBlob(imageFile);
          if (!up) return;
          const { url } = up;
          mutate((prev) => {
            const next = prev.map((b) => ({ ...b, content: { ...b.content } }));
            const cur = next.find((b) => b.id === id);
            if (!cur) return prev;
            const nb: EBlock = {
              id: newId(),
              type: "image",
              content: { url, text: "" },
              parentBlockId: cur.parentBlockId ?? null,
              position: positionAfter(next, cur),
              version: 0,
            };
            next.push(nb);
            return next;
          });
        })();
        return;
      }

      let text = cd.getData("text/plain");
 // 1.5) rich HTML from outside (web / Google Docs): convert the block
 // structure to markdown and reuse the markdown pipeline below
      const htmlClip = cd.getData("text/html");
      {
 // Notion's clipboard converts to a typed TREE: toggles keep their type
 // and nested blocks keep their parents — structure the flat markdown
 // pipeline below cannot carry. The `text/_notion-blocks-v3-*` payload is
 // the real block records (icons, colors, checked, bold runs, collapsed
 // toggle children) and always beats the lossy HTML flavor; the HTML
 // walker still covers older notion.so DOM-on-clipboard copies.
        const notionType = Array.from(cd.types ?? []).find((t) =>
          t.startsWith("text/_notion-blocks-")
        );
        const tree =
          readPayloadTree(cd) ??
          (notionType ? notionClipboardToBlocks(cd.getData(notionType)) : null) ??
          (htmlClip ? (htmlToNotionBlocks(htmlClip) ?? htmlToNotionExportBlocks(htmlClip)) : null);
        if (tree && tree.length) {
          e.preventDefault();
          mutate((prev) => {
            const next = prev.map((b) => ({ ...b, content: { ...b.content } }));
            const cur = next.find((b) => b.id === id);
            if (!cur) return prev;
            const rootParent = cur.parentBlockId ?? null;
            const lastAt: EBlock[] = [];
            let anchorTop: EBlock = cur;
            let start = 0;
 // an empty target block becomes the first pasted block (no blank lead)
            if (normalize(el).trim() === "" && cur.type === "paragraph" && tree[0].depth === 0) {
              cur.type = tree[0].type;
              cur.content = { ...tree[0].content };
              cur.version++;
              lastAt[0] = cur;
              start = 1;
            }
            for (let k = start; k < tree.length; k++) {
              const pb = tree[k];
 // clamp: a child can only hang off a block that actually got emitted
              const d = Math.min(pb.depth, lastAt.length);
              let parentBlockId: string | null;
              let position: number;
              if (d === 0) {
                parentBlockId = rootParent;
                position = positionAfter(next, anchorTop);
              } else {
                const parent = lastAt[d - 1];
                parentBlockId = parent.id;
                position =
                  Math.max(0, ...next.filter((b) => b.parentBlockId === parent.id).map((b) => b.position)) + 1;
              }
              const nb: EBlock = {
                id: newId(),
                type: pb.type,
                content: { ...pb.content },
                parentBlockId,
                position,
                version: 0,
              };
              next.push(nb);
              lastAt.length = d + 1;
              lastAt[d] = nb;
              if (d === 0) anchorTop = nb;
            }
            pendingFocus.current = { id: anchorTop.id, pos: "end" };
            return next;
          });
          return;
        }
        if (htmlClip) {
          const md = htmlToMarkdownish(htmlClip);
          if (md && looksLikeMarkdown(md)) text = md;
        }
      }
      if (!text) {
 // rich HTML we could not convert must NOT fall through to the browser
 // default — that dumps the clipboard's raw styled DOM (a whole Notion
 // page, sidebar and all) into this one contenteditable block
        if (htmlClip) e.preventDefault();
        return;
      }

 // 2) Markdown / multi-line text → parse and split the current block.
      if (looksLikeMarkdown(text)) {
        const parsed = parseMarkdown(text, "p", { noTitle: true }).blocks;
        const multiBlock =
          parsed.length > 1 || (parsed.length === 1 && parsed[0].type !== "paragraph");
        if (multiBlock) {
          e.preventDefault();
          const off = caretOffset(el);
          const whole = normalize(el);
          const before = whole.slice(0, off);
          const after = whole.slice(off);
          mutate((prev) => {
            const next = prev.map((b) => ({ ...b, content: { ...b.content } }));
            const cur = next.find((b) => b.id === id);
            if (!cur) return prev;
            const parentId = cur.parentBlockId ?? null;
            let anchor: EBlock = cur;
            let startIdx = 0;
 // An empty target block becomes the first parsed block (no blank lead).
            if (before.trim() === "" && after.trim() === "" && cur.type === "paragraph") {
              cur.type = parsed[0].type;
              cur.content = { ...parsed[0].content };
              cur.version++;
              startIdx = 1;
            } else {
              cur.content.text = before;
              cur.content.html = before ? escapeHtml(before) : undefined;
              cur.version++;
            }
            for (let k = startIdx; k < parsed.length; k++) {
              const p = parsed[k];
              const nb: EBlock = {
                id: newId(),
                type: p.type,
                content: { ...p.content },
                parentBlockId: parentId,
                position: positionAfter(next, anchor),
                version: 0,
              };
              next.push(nb);
              anchor = nb;
            }
            if (after.trim() !== "") {
              const nb = freshParagraph(parentId, 0);
              nb.position = positionAfter(next, anchor);
              nb.content.text = after;
              next.push(nb);
              anchor = nb;
            }
            pendingFocus.current = { id: anchor.id, pos: "end" };
            return next;
          });
          return;
        }
      }

 // 3) Single plain line → the original inline paste behavior. A bare
 // URL becomes a link and offers "keep / bookmark".
      e.preventDefault();
      const urlish = /^https?:\/\/\S+$/i.test(text.trim());
      if (urlish) {
        const url = text.trim();
        document.execCommand(
          "insertHTML",
          false,
          `<a href="${escapeHtml(url)}">${escapeHtml(url)}</a>`
        );
        const rect = caretRect() ?? el.getBoundingClientRect();
        setPasteLink({ blockId: id, url, anchor: { x: rect.left, y: rect.top } });
        return;
      }
      document.execCommand("insertText", false, text);
    },
    [mutate, positionAfter]
  );

  /** Block ids in rendered (DFS) order — the visual top-to-bottom sequence. */
  const visualOrder = useCallback((): string[] => {
    const order: string[] = [];
    const walk = (parentId: string | null) => {
      for (const b of childrenOf(parentId)) {
        order.push(b.id);
        walk(b.id);
      }
    };
    walk(null);
    return order;
  }, [childrenOf]);

  /** Move the caret to the nearest editable neighbour in the given direction. */
  const focusNeighbour = useCallback(
    (id: string, dir: -1 | 1): boolean => {
      const order = visualOrder();
      const idx = order.indexOf(id);
      for (let i = idx + dir; i >= 0 && i < order.length; i += dir) {
        const el = editables.current.get(order[i]);
        if (el) {
          setCaret(el, dir === -1 ? "end" : "start");
          return true;
        }
      }
      return false;
    },
    [visualOrder]
  );

 // --- block-level multi-selection ------------------------------------------
  const clearSelection = useCallback(() => {
    selAnchorRef.current = null;
    selFocusRef.current = null;
    setSelectedIds((prev) => (prev.size ? new Set() : prev));
  }, []);

  const rangeIds = useCallback(
    (anchorId: string, focusId: string): Set<string> => {
      const order = visualOrder();
      const a = order.indexOf(anchorId);
      const b = order.indexOf(focusId);
      if (a === -1 || b === -1) return new Set([focusId]);
      const [lo, hi] = a <= b ? [a, b] : [b, a];
      return new Set(order.slice(lo, hi + 1));
    },
    [visualOrder]
  );

  const selectBlock = useCallback((id: string) => {
    selAnchorRef.current = id;
    selFocusRef.current = id;
    setSelectedIds(new Set([id]));
  }, []);

  const shiftSelect = useCallback(
    (id: string) => {
      const anchor = selAnchorRef.current ?? id;
      selAnchorRef.current = anchor;
      selFocusRef.current = id;
      setSelectedIds(rangeIds(anchor, id));
    },
    [rangeIds]
  );

 // reads the STATE, not selectedIdsRef: the ref is refreshed in an effect,
 // so during the render that follows a selection change it still holds the
 // previous set and every halo would lag one step behind
  const isHalo = useCallback(
    (id: string): boolean => {
      if (!selectedIds.has(id)) return false;
      const byId = new Map(blocksRef.current.map((b) => [b.id, b]));
      let p = byId.get(id)?.parentBlockId ?? null;
      while (p) {
        if (selectedIds.has(p)) return false;
        p = byId.get(p)?.parentBlockId ?? null;
      }
      return true;
    },
    [selectedIds]
  );
  const haloInset = useCallback(
    (id: string): { top: number; bottom: number } => {
      const all = blocksRef.current;
      const b = all.find((x) => x.id === id);
      if (!b || !LIST_TYPES.has(b.type)) return { top: 2, bottom: 2 };
      const sibs = all.filter((x) => (x.parentBlockId ?? null) === (b.parentBlockId ?? null)).sort((x, y) => x.position - y.position);
      const i = sibs.findIndex((x) => x.id === id);
      const prev = sibs[i - 1];
      const next = sibs[i + 1];
      return { top: prev && LIST_TYPES.has(prev.type) ? 1 : 2, bottom: next && LIST_TYPES.has(next.type) ? 1 : 2 };
    },
    []
  );

  const withSubtree = useCallback((ids: Set<string>): Set<string> => {
    const all = new Set(ids);
    let grew = true;
    while (grew) {
      grew = false;
      for (const b of blocksRef.current) {
        if (b.parentBlockId && all.has(b.parentBlockId) && !all.has(b.id)) {
          all.add(b.id);
          grew = true;
        }
      }
    }
    return all;
  }, []);

  const bulkDelete = useCallback(() => {
    const ids = selectedIdsRef.current;
    if (ids.size === 0) return;
    const subtree = withSubtree(ids);
    for (const id of subtree) deletedIds.current.add(id);
    mutate((prev) => prev.filter((b) => !subtree.has(b.id)));
    clearSelection();
  }, [mutate, withSubtree, clearSelection]);

  const bulkDuplicate = useCallback(() => {
    const ids = selectedIdsRef.current;
    if (ids.size === 0) return;
    const order = visualOrder().filter((id) => ids.has(id));
    mutate((prev) => {
      const next = prev.map((b) => ({ ...b, content: { ...b.content } }));
      for (const id of order) {
        const cur = next.find((b) => b.id === id);
        if (!cur) continue;
        const copy: EBlock = {
          ...cur,
          id: newId(),
          content: { ...cur.content },
          position: positionAfter(next, cur),
          version: 0,
        };
        next.push(copy);
      }
      return next;
    });
    clearSelection();
  }, [mutate, positionAfter, visualOrder, clearSelection]);

 // A drag that crosses a block boundary becomes BLOCK selection, live, the
 // way the original does it. This can't ride on the native selection: every
 // block is its own contenteditable, and the browser CLAMPS a selection to
 // the editable the drag started in — dragging over several blocks selected
 // nothing beyond the first, and Backspace silently did nothing.
  const onEditorMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      const t = e.target as HTMLElement;
 // buttons, checkboxes and the drag grip keep their own gestures
      if (t.closest("button, input, textarea, [draggable='true']")) return;
 // a row peek nests another editor inside a database block — each editor
 // only converts drags over its OWN blocks (the event bubbles to both)
      const inRoot = t.closest('[data-testid="editor-root"]') === e.currentTarget;
 // …or the press landed on the page margin around this editor (an ancestor
 // of the root, handed in by the document listener below): a marquee start,
 // and no native text selection should begin there (Notion E)
      const fromMargin = !inRoot && t.contains(e.currentTarget as Node);
      if (!inRoot && !fromMargin) return;
      if (fromMargin) e.preventDefault();
      const root = e.currentTarget as HTMLElement;
      const tid = t.closest("[data-block-type]")?.getAttribute("data-testid");
 // no anchor yet is fine: a drag can start in the empty space below the
 // last block (the usual bottom-up sweep) — the first block the pointer
 // enters becomes the anchor
      let anchor: string | null = tid?.startsWith("block-")
        ? tid.slice("block-".length)
        : null;
      const startedOnBlock = anchor !== null;
 // Measured on Notion (docs/notion-selection-copy.md §1): a drag that starts
 // in TEXT stays a text selection for as long as it only crosses text blocks
 // — it becomes a block selection the moment it reaches a block with no text
 // of its own (an image, a divider, a table). A drag that starts off any block
 // (the margins) selects blocks from the first one it enters.
      const startedOnText =
        startedOnBlock && isTextBlockType(blocksRef.current.find((b) => b.id === anchor)?.type ?? "paragraph");
      let active = false;
      let lastOver: string | null = anchor; // the row under the pointer, for the click-swallow below
 // Each block is its own editing host, and Chrome confines a drag-selection
 // to the host it STARTED in — so a text drag could never reach the next
 // block. Notion avoids that by wrapping the whole page in one contenteditable
 // (measured: `div.whenContentEditable[contenteditable=true]` above every
 // block leaf). The editing root is fixed when the press lands, so give this
 // press the same single root right now and take it back on release.
      const startLeaf = startedOnText ? (t.closest("[contenteditable]") as HTMLElement | null) : null;
      const sharedRoot = startedOnText && !!startLeaf;
      if (sharedRoot) {
        root.setAttribute("contenteditable", "true");
        root.style.outline = "none";
      }
      const onMove = (ev: MouseEvent) => {
        const overEl = document
          .elementFromPoint(ev.clientX, ev.clientY)
          ?.closest?.("[data-block-type]");
        const overTid =
          overEl && overEl.closest('[data-testid="editor-root"]') === root
            ? overEl.getAttribute("data-testid")
            : null;
        const over = overTid?.startsWith("block-") ? overTid.slice("block-".length) : null;
        if (over) lastOver = over;
        if (!active) {
 // off any block, nothing has been decided yet
          if (!over) return;
 // within the starting block, native text selection stays in charge
          if (startedOnBlock && over === anchor) return;
          if (startedOnText) {
            const overType = blocksRef.current.find((b) => b.id === over)?.type ?? "paragraph";
            if (isTextBlockType(overType)) return; // still text → the browser keeps selecting (across leaves, see below)
          }
          active = true;
          (document.activeElement as HTMLElement | null)?.blur?.();
        }
 // once block selection is live, the pointer drives the focus edge; off
 // any block (margins) the last range simply holds
        if (!over) return;
        anchor ??= over;
        window.getSelection()?.removeAllRanges();
        selAnchorRef.current = anchor;
        selFocusRef.current = over;
        setSelectedIds(rangeIds(anchor, over));
        ev.preventDefault();
      };
      const onUp = (ev: MouseEvent) => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
 // A plain click on the margin (no marquee happened) clears whatever was
 // selected and puts the caret in the block on that line — start of it from
 // the left margin, end of it from the right (Notion S1·S2·T1).
        if (fromMargin && !active) {
          clearSelection();
          window.getSelection()?.removeAllRanges();
 // the innermost row whose own text line covers that y (a parent row also
 // spans its children's y, so take the deepest match)
          let leaf: HTMLElement | null = null;
          for (const r of root.querySelectorAll<HTMLElement>("[data-block-type]")) {
            const ce = r.querySelector<HTMLElement>("[contenteditable]");
            if (!ce || ce.closest("[data-block-type]") !== r) continue;
            const b = ce.getBoundingClientRect();
            if (ev.clientY >= b.top && ev.clientY <= b.bottom) leaf = ce;
          }
          if (leaf) {
            const rootRect = root.getBoundingClientRect();
            setCaret(leaf, ev.clientX < rootRect.left ? "start" : "end");
          }
        }
 // the press and the release landed on different rows, so the browser fires
 // a `click` on their common ancestor — a PARENT row, whose onClick would
 // clear a block selection or, landing on its padding, select that parent
 // around a text selection we just made. Swallow that one click (root
 // onClickCapture) after any drag that crossed rows.
        if (active || (lastOver !== null && lastOver !== anchor)) swallowNextClick.current = true;
        if (sharedRoot) {
 // the shared editing root was only for the press; hand focus back to the
 // leaf the selection started in so keys still reach its handlers. The
 // selection itself survives (it is the document's, not the host's).
          root.removeAttribute("contenteditable");
          root.style.outline = "";
          if (!active) startLeaf?.focus({ preventScroll: true });
        }
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [rangeIds, clearSelection]
  );
 // one-shot: the click the browser synthesizes right after a cross-row drag
 // (same gesture) is swallowed; any new press arms a fresh gesture, so a
 // click that never came cannot eat the next real one
  const swallowNextClick = useRef(false);
  const swallowClickAfterDrag = useCallback((e: React.MouseEvent) => {
    if (swallowNextClick.current) {
      swallowNextClick.current = false;
      e.stopPropagation();
    }
  }, []);
  useEffect(() => {
    const arm = () => { swallowNextClick.current = false; };
    document.addEventListener("mousedown", arm, true);
    return () => document.removeEventListener("mousedown", arm, true);
  }, []);

 // A press on the page margin (outside the editor column) starts a block
 // marquee, like the original's (docs/notion-selection-copy.md §1 E). Only
 // the first editor inside the pressed element takes it, so a row peek's
 // nested editor does not double up with the host page.
  useEffect(() => {
    const onDown = (ev: MouseEvent) => {
      const root = rootRef.current;
      const t = ev.target as HTMLElement | null;
      if (!root || !t || ev.button !== 0) return;
      if (t === root || !t.contains(root)) return;
      if (!t.closest('main[aria-label="Page content"]')) return;
      if (t.closest("button, input, textarea, a, [contenteditable], [role='dialog']")) return;
      if (t.querySelector('[data-testid="editor-root"]') !== root) return;
      onEditorMouseDown({
        button: 0,
        target: t,
        currentTarget: root,
        preventDefault: () => ev.preventDefault(),
      } as unknown as React.MouseEvent);
    };
    document.addEventListener("mousedown", onDown, true);
    return () => document.removeEventListener("mousedown", onDown, true);
  }, [onEditorMouseDown]);

 // ⌘C on a TEXT selection that spans blocks: the browser would hand out
 // styled spans; the original hands out markdown + semantic html with just
 // the selected part of the first and last block (docs/notion-selection-copy
 // §3 B·C·H). Inside one block the browser's own copy is left alone.
  const onRootCopy = useCallback((e: React.ClipboardEvent) => {
    const root = rootRef.current;
    const sel = window.getSelection();
    if (!root || !sel || sel.rangeCount === 0 || sel.isCollapsed) return;
    const range = sel.getRangeAt(0);
    const rowOf = (n: Node | null): Element | null =>
      n ? ((n.nodeType === Node.TEXT_NODE ? n.parentElement : (n as Element)) as Element | null)?.closest?.("[data-block-type]") ?? null : null;
    const a = rowOf(range.startContainer);
    const b = rowOf(range.endContainer);
    if (!a || !b || a === b) return;
    const overrides = new Map<string, string>();
    const ids: string[] = [];
    for (const row of root.querySelectorAll<HTMLElement>("[data-block-type]")) {
      const id = row.getAttribute("data-testid")?.slice("block-".length);
      const ce = row.querySelector<HTMLElement>("[contenteditable]");
      if (!id || !ce || ce.closest("[data-block-type]") !== row) continue; // no text of its own
 // Selection.containsNode (and toString) are clamped to the focused editing
 // host in Chrome; the Range is the real thing and spans the leaves
      if (!range.intersectsNode(ce)) continue;
      const part = document.createRange();
      part.selectNodeContents(ce);
      if (range.compareBoundaryPoints(Range.START_TO_START, part) > 0) part.setStart(range.startContainer, range.startOffset);
      if (range.compareBoundaryPoints(Range.END_TO_END, part) < 0) part.setEnd(range.endContainer, range.endOffset);
      const holder = document.createElement("div");
      holder.appendChild(part.cloneContents());
      overrides.set(id, sanitizeInline(holder.innerHTML));
      ids.push(id);
    }
    if (ids.length < 2) return;
    e.preventDefault();
    writePayload(e.clipboardData, serializeBlocks(blocksRef.current, ids, overrides, { onlyListed: true }));
  }, []);

 // A key on a TEXT selection that spans blocks. The browser would only edit
 // the focused block's part; the original deletes the selected text end to
 // end and joins the first and last block (typed text lands at the join).
 // Blocks wholly inside the selection go, with their children; a last block
 // that still has children keeps them and just loses its selected text.
  const onRootKeyDownCapture = useCallback(
    (e: React.KeyboardEvent) => {
      const root = rootRef.current;
      const sel = window.getSelection();
      if (!root || !sel || sel.rangeCount === 0 || sel.isCollapsed) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return; // shortcuts (⌘C among them) keep their own paths
      const range = sel.getRangeAt(0);
      const rowOf = (n: Node | null): HTMLElement | null =>
        n ? (((n.nodeType === Node.TEXT_NODE ? n.parentElement : (n as Element)) as Element | null)?.closest?.("[data-block-type]") as HTMLElement | null) ?? null : null;
      const first = rowOf(range.startContainer);
      const last = rowOf(range.endContainer);
      if (!first || !last || first === last) return;
      if (e.key === "Escape") {
 // Escape on a text selection that spans blocks: back to a caret at its
 // start (the block's own Escape would select the block while the text
 // selection lingered — both at once)
        e.preventDefault();
        e.stopPropagation();
        const startLeaf = first.querySelector<HTMLElement>("[contenteditable]");
        sel.collapseToStart();
        if (startLeaf && startLeaf.closest("[data-block-type]") === first) startLeaf.focus({ preventScroll: true });
        return;
      }
      if (e.key === "Tab") {
 // A text selection that spans blocks: Tab moves EVERY block it touches, not
 // just the one holding the caret (measured on the original, T16 2026-09-10 —
 // both spanned blocks went one level in and stayed siblings of each other).
        e.preventDefault();
        e.stopPropagation();
        const ids: string[] = [];
        for (const row of root.querySelectorAll<HTMLElement>("[data-block-type]")) {
          if (row === first || row === last || range.intersectsNode(row)) {
            const id = row.getAttribute("data-testid")?.slice("block-".length);
            if (id) ids.push(id);
          }
        }
 // and the selection survives it (T16b: the same four characters were still
 // selected after Tab and after Shift+Tab), so remember its ends by character
 // offset and re-select once the rows have re-rendered at their new depth
        const own = (row: Element) => {
          const ce = row.querySelector<HTMLElement>("[contenteditable]");
          return ce && ce.closest("[data-block-type]") === row ? ce : null;
        };
        const offIn = (leaf: HTMLElement, node: Node, offset: number) => {
          const r = document.createRange();
          r.selectNodeContents(leaf);
          r.setEnd(node, offset);
          return r.toString().length;
        };
        const startLeaf = own(first);
        const endLeaf = own(last);
        const idAttr = (row: Element) => row.getAttribute("data-testid")?.slice("block-".length) ?? "";
        const keep =
          startLeaf && endLeaf
            ? {
                startId: idAttr(first),
                startOff: offIn(startLeaf, range.startContainer, range.startOffset),
                endId: idAttr(last),
                endOff: offIn(endLeaf, range.endContainer, range.endOffset),
              }
            : null;
        if (nest(ids, e.shiftKey ? "out" : "in") && keep) pendingSelection.current = keep;
        return;
      }
      const printable = e.key.length === 1;
      const edits = printable || e.key === "Backspace" || e.key === "Delete" || e.key === "Enter";
      if (!edits) return;
      e.preventDefault();
      e.stopPropagation();
      const idOf = (row: Element) => row.getAttribute("data-testid")?.slice("block-".length) ?? "";
      const leafOf = (row: Element) => {
        const ce = row.querySelector<HTMLElement>("[contenteditable]");
        return ce && ce.closest("[data-block-type]") === row ? ce : null;
      };
      const firstLeaf = leafOf(first);
      const lastLeaf = leafOf(last);
      if (!firstLeaf || !lastLeaf) return;
      const html = (r: Range) => { const d = document.createElement("div"); d.appendChild(r.cloneContents()); return d.innerHTML; };
      const pre = document.createRange(); pre.selectNodeContents(firstLeaf); pre.setEnd(range.startContainer, range.startOffset);
      const post = document.createRange(); post.selectNodeContents(lastLeaf); post.setStart(range.endContainer, range.endOffset);
      const prefix = sanitizeInline(html(pre));
      const suffix = sanitizeInline(html(post));
      const typed = printable ? e.key.replace(/&/g, "&amp;").replace(/</g, "&lt;") : "";
      const joined = prefix + typed + suffix;
      const firstId = idOf(first);
      const lastId = idOf(last);
      const between: string[] = [];
      for (const row of root.querySelectorAll<HTMLElement>("[data-block-type]")) {
        if (row === first || row === last) continue;
        if (row.contains(first) || row.contains(last)) continue; // an ancestor row is not "between"
        if (range.intersectsNode(row)) between.push(idOf(row));
      }
      const caretPos = htmlToText(prefix + typed).length;
      mutate((prev) => {
        const next = prev.map((b) => ({ ...b, content: { ...b.content } }));
        const f = next.find((b) => b.id === firstId);
        if (!f) return prev;
        f.content.html = joined;
        f.content.text = htmlToText(joined);
        f.version++;
        const gone = new Set(between);
        const lastBlock = next.find((b) => b.id === lastId);
        const lastHasKids = next.some((b) => b.parentBlockId === lastId);
        if (lastBlock) {
          if (lastHasKids) {
            lastBlock.content.html = suffix;
            lastBlock.content.text = htmlToText(suffix);
            lastBlock.version++;
 // its text moved into the first block already; keep the block for its kids
            f.content.html = prefix + typed;
            f.content.text = htmlToText(prefix + typed);
          } else gone.add(lastId);
        }
 // descendants of removed blocks go with them
        let grew = true;
        while (grew) { grew = false; for (const b of next) if (b.parentBlockId && gone.has(b.parentBlockId) && !gone.has(b.id)) { gone.add(b.id); grew = true; } }
        return next.filter((b) => !gone.has(b.id));
      });
      pendingFocus.current = { id: firstId, pos: caretPos };
    },
    [mutate, nest]
  );

 // In selection mode the caret is blurred, so keys are handled at the window.
  useEffect(() => {
    if (selectedIds.size === 0) return;
    const onKey = (e: KeyboardEvent) => {
      const order = visualOrder();
      const focusId = selFocusRef.current;
      if (!focusId) return;
      const idx = order.indexOf(focusId);
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const dir = e.key === "ArrowDown" ? 1 : -1;
        const nextId = order[Math.min(Math.max(idx + dir, 0), order.length - 1)];
        selFocusRef.current = nextId;
        if (e.shiftKey) setSelectedIds(rangeIds(selAnchorRef.current ?? nextId, nextId));
        else {
          selAnchorRef.current = nextId;
          setSelectedIds(new Set([nextId]));
        }
      } else if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        bulkDelete();
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "d") {
        e.preventDefault();
        bulkDuplicate();
      } else if ((e.metaKey || e.ctrlKey) && (e.key.toLowerCase() === "c" || e.key.toLowerCase() === "x")) {
 // ⌘C on a block selection: markdown + semantic html + our block tree
 // (docs/notion-selection-copy.md §3). The caret is blurred in this mode, so
 // the browser has nothing to copy on its own — this used to do nothing.
        e.preventDefault();
        const ids = order.filter((id) => selectedIdsRef.current.has(id));
        copyPayload(serializeBlocks(blocksRef.current, ids));
        if (e.key.toLowerCase() === "x") bulkDelete();
      } else if (e.key === "Tab") {
 // A block selection indents/outdents the whole selection and KEEPS it
 // (measured on the original, T15 2026-09-10: two selected blocks both moved
 // one level and stayed selected). The caret is blurred in this mode, so the
 // per-block Tab handler never fires — this used to leak Tab to the browser,
 // which moved focus out of the editor and did nothing to the blocks.
        e.preventDefault();
        const ids = order.filter((id) => selectedIdsRef.current.has(id));
        nest(ids, e.shiftKey ? "out" : "in");
      } else if (e.key === "Escape") {
        e.preventDefault();
        clearSelection();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [selectedIds, visualOrder, rangeIds, bulkDelete, bulkDuplicate, clearSelection, nest]);

  const indentBlock = useCallback(
    (id: string, el: HTMLElement) => nest([id], "in", { id, el }),
    [nest]
  );

  const outdentBlock = useCallback(
    (id: string, el: HTMLElement) => nest([id], "out", { id, el }),
    [nest]
  );

  const onKeyDown = useCallback(
    (id: string, e: React.KeyboardEvent, el: HTMLElement) => {
      const block = blocksRef.current.find((b) => b.id === id);
      if (!block) return;

 // While an IME is composing, the keystroke belongs to the IME, not to us:
 // Chrome delivers keydown with isComposing=true BEFORE it commits the
 // syllable. Splitting here moved focus to the new block while the IME still
 // owned "트", so its commit landed there — 프로젝트 + Enter came out as
 // "프로젝트" / "트". Remember the Enter and split once the text is committed
 // (Latin typing never composes, which is why it looked fine in English).
 // The event's own flag decides, never composingRef: were a compositionend
 // ever missed, a sticky ref would swallow every keystroke that follows.
      if ((e.nativeEvent as KeyboardEvent).isComposing) {
        if (e.key === "Enter" && !e.shiftKey && block.type !== "code") {
 // preventDefault stops the browser's own newline; the IME still commits
          e.preventDefault();
          splitOnComposeEnd.current = id;
        }
        return;
      }

 // Some IMEs hand the committing Enter back as a second keydown, this time
 // with isComposing=false. We already split for it from compositionend, so
 // splitting again is the "one Enter, two blank lines" report. Only a
 // pass-through can land this soon after that split — a person pressing Enter
 // twice needs a key release in between (~100ms at the very fastest, and key
 // repeat waits far longer).
      if (e.key === "Enter" && !e.shiftKey && Date.now() - composedSplitAt.current < 50) {
        composedSplitAt.current = 0;
        e.preventDefault();
        return;
      }

      if (slash && slash.blockId === id) {
        const items = filterSlashItems(slash.query);
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setSlash({ ...slash, selected: (slash.selected + 1) % items.length });
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setSlash({
            ...slash,
            selected: (slash.selected - 1 + items.length) % items.length,
          });
          return;
        }
        if (e.key === "Enter") {
          e.preventDefault();
          const item = items[slash.selected] ?? items[0];
          if (item) applySlashPick(item.type, item.preset);
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          setSlash(null);
          return;
        }
      }

      if (emojiSug && emojiSug.blockId === id && emojiSug.query) {
        const items = emojiCandidates(emojiSug.query);
        if (items.length) {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setEmojiSug({ ...emojiSug, selected: (emojiSug.selected + 1) % items.length });
            return;
          }
          if (e.key === "ArrowUp") {
            e.preventDefault();
            setEmojiSug({
              ...emojiSug,
              selected: (emojiSug.selected - 1 + items.length) % items.length,
            });
            return;
          }
          if (e.key === "Enter" || e.key === "Tab") {
            e.preventDefault();
            applyEmojiPick(items[emojiSug.selected] ?? items[0]);
            return;
          }
        }
        if (e.key === "Escape") {
          e.preventDefault();
          setEmojiSug(null);
          return;
        }
      }

      if (mention && mention.blockId === id) {
        const items = mentionItemsRef.current;
        if (e.key === "ArrowDown") {
          e.preventDefault();
          if (items.length) setMention({ ...mention, selected: (mention.selected + 1) % items.length });
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          if (items.length)
            setMention({ ...mention, selected: (mention.selected - 1 + items.length) % items.length });
          return;
        }
        if (e.key === "Enter") {
          e.preventDefault();
          const item = items[mention.selected] ?? items[0];
          if (item) applyMentionPick(item);
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          setMention(null);
          return;
        }
      }

      if (e.key === ":" && !slash && !mention && !emojiSug) {
 // the emoji catalogue is a lazy chunk; start it on the opening ':' so the
 // suggestions and the `:shortcode:` expansion have it a keystroke later
        void loadEmojiSet();
        const rect = caretRect() ?? el.getBoundingClientRect();
        setEmojiSug({
          blockId: id,
          offset: caretOffset(el) + 1,
          query: "",
          selected: 0,
          anchor: { x: rect.left, y: rect.top },
        });
        return; // let the ':' character insert
      }

      if (e.key === "@" && !slash && !mention) {
        const rect = caretRect() ?? el.getBoundingClientRect();
        setMention({
          blockId: id,
          offset: caretOffset(el) + 1,
          query: "",
          selected: 0,
          anchor: { x: rect.left, y: rect.top },
        });
        return; // let the '@' character insert
      }

 // Escape (nothing else open) → select the whole block (block-selection mode)
      if (e.key === "Escape") {
        e.preventDefault();
        el.blur();
        selectBlock(id);
        return;
      }

 // Ctrl/Cmd+A: the first press keeps the browser default (select this
 // block's text). Once that covers the whole block — or the block is
 // empty — the next press escalates to selecting EVERY block, as the
 // original does; Backspace then deletes them via selection mode.
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "a") {
        const sel = window.getSelection();
        const whole = (el.textContent ?? "").trim();
        const covered = whole === "" || (sel?.toString().trim() ?? "") === whole;
        if (covered) {
          e.preventDefault();
          const order = visualOrder();
          if (order.length) {
            el.blur();
            sel?.removeAllRanges();
            selAnchorRef.current = order[0];
            selFocusRef.current = order[order.length - 1];
            setSelectedIds(new Set(order));
          }
          return;
        }
      }

      if (e.key === "/" && !slash) {
        const rect = caretRect() ?? el.getBoundingClientRect();
        setSlash({
          blockId: id,
          offset: caretOffset(el) + 1,
          query: "",
          selected: 0,
          anchor: { x: rect.left, y: rect.top },
        });
        return; // let the '/' character insert
      }

      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "ArrowDown") {
        e.preventDefault();
        moveBlock(id, 1, el);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "ArrowUp") {
        e.preventDefault();
        moveBlock(id, -1, el);
        return;
      }

      if (e.key === "Tab" && block.type === "code") {
 // A code block's Tab is a tab CHARACTER, not a block indent (measured on the
 // original, T23 2026-09-10: the code read "\tab" and the block stayed at its
 // depth). We used to indent the block, so code could not be indented at all.
        e.preventDefault();
        if (e.shiftKey) return; // Shift+Tab in code: the original does nothing
        document.execCommand("insertText", false, "\t");
        return;
      }
      if (e.key === "Tab") {
        e.preventDefault();
        if (e.shiftKey) outdentBlock(id, el);
        else indentBlock(id, el);
        return;
      }

 // Cross-block caret navigation at the block's edges.
      if (e.key === "ArrowUp" && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
        const sel = window.getSelection();
        if (sel?.isCollapsed && caretOffset(el) === 0 && focusNeighbour(id, -1)) {
          e.preventDefault();
          return;
        }
      }
      if (e.key === "ArrowDown" && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
        const sel = window.getSelection();
        if (sel?.isCollapsed && caretOffset(el) === normalize(el).length && focusNeighbour(id, 1)) {
          e.preventDefault();
          return;
        }
      }

      if (e.key === "Enter" && !e.shiftKey && block.type !== "code") {
        e.preventDefault();
        splitBlock(id, el);
        return;
      }

      if (e.key === "Backspace") {
        const sel = window.getSelection();
        if (sel && sel.isCollapsed && caretOffset(el) === 0) {
          const handled = handleBackspaceAtStart(id, el);
          if (handled) e.preventDefault();
        }
      }
    },
    [slash, mention, emojiSug, applySlashPick, applyMentionPick, applyEmojiPick, moveBlock, splitBlock, handleBackspaceAtStart, indentBlock, outdentBlock, focusNeighbour, selectBlock, visualOrder]
  );

  const onCompositionStart = useCallback(() => {
    composingRef.current = true;
  }, []);

 // The IME has committed: the syllable is in the DOM (and no longer composing),
 // so an Enter we held back can now split the block at the real caret.
  const onCompositionEnd = useCallback(
    (id: string, el: HTMLElement) => {
      composingRef.current = false;
      if (splitOnComposeEnd.current !== id) return;
      splitOnComposeEnd.current = null;
      splitBlock(id, el);
      composedSplitAt.current = Date.now();
    },
    [splitBlock]
  );

  const toggleExpand = useCallback(
    (id: string) => {
      mutate((prev) =>
        prev.map((b) =>
          b.id === id
            ? {
                ...b,
                content: { ...b.content, expanded: !(b.content.expanded ?? true) },
              }
            : b
        )
      );
    },
    [mutate]
  );

  const addInsideToggle = useCallback(
    (id: string) => {
      const nb = freshParagraph(id, 1);
      mutate((prev) => [...prev, nb]);
      pendingFocus.current = { id: nb.id, pos: "start" };
    },
    [mutate]
  );

 // Append a new column to a column_list (N-way columns, not just 2).
  const addColumn = useCallback(
    (columnListId: string) => {
      mutate((prev) => {
        const cols = prev.filter((b) => b.parentBlockId === columnListId && b.type === "column");
        const maxPos = cols.reduce((m, c) => Math.max(m, c.position), 0);
        const col: EBlock = {
          id: newId(),
          type: "column",
          content: {},
          parentBlockId: columnListId,
          position: maxPos + 1,
          version: 0,
        };
        const para = freshParagraph(col.id, 1);
        pendingFocus.current = { id: para.id, pos: "start" };
        return [...prev, col, para];
      });
    },
    [mutate]
  );

  const setChecked = useCallback(
    (id: string, checked: boolean) => {
      mutate((prev) =>
        prev.map((b) =>
          b.id === id ? { ...b, content: { ...b.content, checked } } : b
        )
      );
    },
    [mutate]
  );

  const setLanguage = useCallback(
    (id: string, language: string) => {
      mutate((prev) =>
        prev.map((b) =>
          b.id === id ? { ...b, content: { ...b.content, language } } : b
        )
      );
    },
    [mutate]
  );

  const setImageUrl = useCallback(
    (id: string, url: string) => {
      mutate((prev) =>
        prev.map((b) =>
          b.id === id ? { ...b, content: { ...b.content, url }, version: b.version + 1 } : b
        )
      );
    },
    [mutate]
  );

  const setLinkTarget = useCallback(
    (id: string, pageId: string) => {
      mutate(
        (prev) =>
          prev.map((b) =>
            b.id === id
              ? { ...b, content: { ...b.content, childPageId: pageId }, version: b.version + 1 }
              : b
          ),
        { coalesce: true }
      );
    },
    [mutate]
  );

  const setFileData = useCallback(
    (id: string, data: { url: string; name: string }) => {
      mutate(
        (prev) =>
          prev.map((b) =>
            b.id === id
              ? { ...b, content: { ...b.content, url: data.url, text: data.name }, version: b.version + 1 }
              : b
          ),
        { coalesce: true }
      );
    },
    [mutate]
  );

  const setImageMeta = useCallback(
    (
      id: string,
      meta: { caption?: string; width?: number; align?: string; icon?: string | null; color?: string }
    ) => {
      mutate((prev) =>
        prev.map((b) =>
          b.id === id
            ? { ...b, content: { ...b.content, ...meta }, version: b.version + 1 }
            : b
        ),
        { coalesce: true }
      );
    },
    [mutate]
  );

  const updateTable = useCallback(
    (id: string, table: TableData) => {
 // structural table changes (add/remove row/col) bump version so the
 // component resyncs; cell-text edits coalesce into one undo frame and
 // do NOT bump version (avoids clobbering the focused cell's DOM).
      mutate(
        (prev) =>
          prev.map((b) =>
            b.id === id ? { ...b, content: { ...b.content, table } } : b
          ),
        { coalesce: true }
      );
    },
    [mutate]
  );

  const insertBelow = useCallback(
    (id: string) => {
 // standard behavior: + inserts a block AND opens the type menu — a silent
 // empty block reads as "nothing happened".
 // the original: + opens the type menu on an EMPTY line — this one if it is
 // already an empty paragraph, otherwise a new one below — with a filter
 // placeholder, the caret at its start, and no "/" to delete afterwards
      const here = blocksRef.current.find((b) => b.id === id);
      const reuse = !!here && here.type === "paragraph" && (here.content.text ?? "") === "";
      const nb = reuse ? here : freshParagraph(null, 0);
      if (!reuse) {
        mutate((prev) => {
          const next = prev.map((b) => ({ ...b }));
          const cur = next.find((b) => b.id === id);
          if (!cur) return prev;
          nb.parentBlockId = cur.parentBlockId;
          nb.position = positionAfter(next, cur);
          next.push(nb);
          return next;
        });
      }
      pendingFocus.current = { id: nb.id, pos: "start" };
 // Open the menu in the SAME batch as the line, so the line's first paint
 // already carries the filter placeholder (a frame of the default English
 // placeholder flashed otherwise); the anchor is refined once the row exists.
      setSlash({ blockId: nb.id, offset: 0, query: "", selected: 0, bare: true, anchor: { x: -9999, y: -9999 }, anchorHeight: 40 });
 // The new block's editable may take more than one frame to mount on
 // slow renders — retry briefly instead of silently leaving a bare "/".
      const openMenu = (attempt: number) => {
        const el = editables.current.get(nb.id);
        if (!el) {
          if (attempt < 10) requestAnimationFrame(() => openMenu(attempt + 1));
          return;
        }
 // reusing the line changes no state, so pendingFocus is never consumed —
 // put the caret there ourselves (the placeholder pill needs :focus)
        if (reuse) setCaret(el, "start");
        const row = document.querySelector(`[data-testid="block-${nb.id}"]`) as HTMLElement | null;
        const rect = row?.getBoundingClientRect() ?? el.getBoundingClientRect();
 // the original's + menu: left edge on the block box, 8px below the line (or
 // above it when the window's bottom is too close)
        setSlash((prev) =>
          prev && prev.blockId === nb.id
            ? { ...prev, anchor: { x: rect.left, y: rect.top }, anchorHeight: rect.height }
            : prev
        );
      };
      requestAnimationFrame(() => openMenu(0));
    },
    [mutate, positionAfter]
  );

  const deleteBlock = useCallback(
    (id: string) => {
      const subtree = new Set<string>([id]);
      let grew = true;
      while (grew) {
        grew = false;
        for (const b of blocksRef.current) {
          if (b.parentBlockId && subtree.has(b.parentBlockId) && !subtree.has(b.id)) {
            subtree.add(b.id);
            grew = true;
          }
        }
      }
      for (const bid of subtree) deletedIds.current.add(bid);
      mutate((prev) => prev.filter((b) => !subtree.has(b.id)));
    },
    [mutate]
  );

  const duplicateBlock = useCallback(
    (id: string) => {
      mutate((prev) => {
        const next = prev.map((b) => ({ ...b, content: { ...b.content } }));
        const cur = next.find((b) => b.id === id);
        if (!cur) return prev;
        const copy: EBlock = {
          ...cur,
          id: newId(),
          content: { ...cur.content },
          position: positionAfter(next, cur),
          version: 0,
        };
        next.push(copy);
        return next;
      });
    },
    [mutate, positionAfter]
  );

  const turnInto = useCallback(
    (id: string, type: BlockType) => {
      mutate((prev) =>
        prev.map((b) => {
          if (b.id !== id) return b;
          const content: BlockContent = { text: b.content.text ?? "", html: b.content.html };
          if (type === "code") content.language = "plain";
          if (type === "todo") content.checked = false;
          if (type === "toggle") content.expanded = true;
          if (type === "table")
            content.table = { cells: [["", "", ""], ["", "", ""], ["", "", ""]] };
          return { ...b, type, content, version: b.version + 1 };
        })
      );
    },
    [mutate]
  );

  const onDragStart = useCallback((id: string) => {
    draggingId.current = id;
  }, []);
 // A block drag that ends anywhere but on a row (dropped in the margin,
 // cancelled with Escape) used to leave draggingId and the drop line behind:
 // the blue 3px indicator stayed on the last hovered row, and the next native
 // drag of anything (selected text, an image) moved it around. Every drag
 // end clears both.
  const onDragEnd = useCallback(() => {
    draggingId.current = null;
    setDropTarget(null);
  }, []);
  useEffect(() => {
    const end = () => onDragEnd();
    window.addEventListener("dragend", end, true);
    window.addEventListener("drop", end, true);
    return () => {
      window.removeEventListener("dragend", end, true);
      window.removeEventListener("drop", end, true);
    };
  }, [onDragEnd]);

  const onDragOverRow = useCallback((e: React.DragEvent, id: string) => {
    if (!draggingId.current || draggingId.current === id) return;
 // only OUR block drag draws the drop line — a native drag of selected text
 // or an image carries no block marker
    if (!e.dataTransfer?.types?.includes(BLOCK_DRAG_MIME)) return;
    e.preventDefault();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
 // Only a narrow strip at each edge makes columns (Notion is ~a handle's width,
 // not a quarter of the block); the wide middle stays a plain reorder so that
 // an ordinary drop between rows never silently splits the block into columns.
    const EDGE = Math.min(64, rect.width * 0.15);
    const fromLeft = e.clientX - rect.left;
    const side = fromLeft < EDGE ? "left" : fromLeft > rect.width - EDGE ? "right" : undefined;
    const before = e.clientY < rect.top + rect.height / 2;
    setDropTarget({ id, before, side });
  }, []);

  const onDropRow = useCallback(
    (e: React.DragEvent, targetId: string) => {
      e.preventDefault();
      const dragId = draggingId.current;
      draggingId.current = null;
      setDropTarget(null);
      if (!dragId || dragId === targetId) return;

      const side = dropTarget?.id === targetId ? dropTarget.side : undefined;

      mutate((prev) => {
        const next = prev.map((b) => ({ ...b }));
        const drag = next.find((b) => b.id === dragId);
        const target = next.find((b) => b.id === targetId);
        if (!drag || !target) return prev;

 // side-drop: wrap the target + dragged block into a NEW column_list that
 // takes the target's slot.
        if (side && target.type !== "column" && target.type !== "column_list") {
          const cl: EBlock = {
            id: newId(), type: "column_list", content: {},
            parentBlockId: target.parentBlockId ?? null, position: target.position, version: 0,
          };
          const colA: EBlock = { id: newId(), type: "column", content: {}, parentBlockId: cl.id, position: 1, version: 0 };
          const colB: EBlock = { id: newId(), type: "column", content: {}, parentBlockId: cl.id, position: 2, version: 0 };
          const dragCol = side === "left" ? colA : colB;
          const targetCol = side === "left" ? colB : colA;
          drag.parentBlockId = dragCol.id; drag.position = 1;
          target.parentBlockId = targetCol.id; target.position = 1;
          next.push(cl, colA, colB);
          return next;
        }

        const sibs = next
          .filter((b) => (b.parentBlockId ?? null) === (target.parentBlockId ?? null))
          .sort((a, b) => a.position - b.position);
        const tIdx = sibs.findIndex((s) => s.id === targetId);
        const before = dropTarget?.id === targetId ? dropTarget.before : false;
        drag.parentBlockId = target.parentBlockId ?? null;
        if (before) {
          const prevSib = sibs[tIdx - 1];
          drag.position = prevSib
            ? (prevSib.position + target.position) / 2
            : target.position - 1;
        } else {
          const nextSib = sibs[tIdx + 1];
          drag.position = nextSib
            ? (target.position + nextSib.position) / 2
            : target.position + 1;
        }
        return next;
      });
    },
    [mutate, dropTarget]
  );

  const insertMarkdownAfter = useCallback(
    (anchorId: string | null, md: string) => {
      const parsed = parseMarkdown(md, "p", { noTitle: true }).blocks;
      if (!parsed.length) return;
      mutate((prev) => {
        const next = prev.map((b) => ({ ...b, content: { ...b.content } }));
        const cur = anchorId ? next.find((b) => b.id === anchorId) : undefined;
        const parentId = cur?.parentBlockId ?? null;
        let anchor: EBlock | null = cur ?? null;
        for (const pb of parsed) {
          const nb: EBlock = {
            id: newId(),
            type: pb.type,
            content: { ...pb.content },
            parentBlockId: parentId,
            position: anchor
              ? positionAfter(next, anchor)
              : Math.max(
                  0,
                  ...next
                    .filter((b) => (b.parentBlockId ?? null) === null)
                    .map((b) => b.position)
                ) + 1,
            version: 0,
          };
          next.push(nb);
          anchor = nb;
        }
        return next;
      });
    },
    [mutate, positionAfter]
  );

  const insertAiPromptAfter = useCallback(
    (anchorId: string) => {
      mutate((prev) => {
        const next = prev.map((b) => ({ ...b, content: { ...b.content } }));
        const cur = next.find((b) => b.id === anchorId);
        if (!cur) return prev;
        const nb: EBlock = {
          id: newId(),
          type: "ai_prompt",
          content: {},
          parentBlockId: cur.parentBlockId ?? null,
          position: positionAfter(next, cur),
          version: 0,
        };
        next.push(nb);
        return next;
      });
    },
    [mutate, positionAfter]
  );

  const setTemplateData = useCallback(
    (id: string, data: { label?: string; template?: string }) => {
      mutate((prev) =>
        prev.map((b) =>
          b.id === id
            ? {
                ...b,
                content: {
                  ...b.content,
                  ...(data.label !== undefined ? { text: data.label } : {}),
                  ...(data.template !== undefined ? { template: data.template } : {}),
                },
                version: b.version + 1,
              }
            : b
        )
      );
    },
    [mutate]
  );

  const setButtonData = useCallback(
    (id: string, data: Partial<{ label: string; icon: string; actions: ButtonAction[] }>) => {
      mutate((prev) =>
        prev.map((b) =>
          b.id === id
            ? {
                ...b,
                content: {
                  ...b.content,
                  ...(data.label !== undefined ? { text: data.label } : {}),
                  ...(data.icon !== undefined ? { icon: data.icon } : {}),
                  ...(data.actions !== undefined ? { actions: data.actions } : {}),
                },
                version: b.version + 1,
              }
            : b
        )
      );
    },
    [mutate]
  );

  const api = useMemo<EditorApi>(
    () => ({
      // a getter, not the state value, so `api` keeps its identity across
      // keystrokes — that is what lets a memoized BlockRow skip re-rendering
      // (perf §3.6). All the callbacks below are stable (blocksRef-based).
      get blocks() { return blocksRef.current; },
      registerEl,
      onInput,
      onKeyDown,
      onCompositionStart,
      onCompositionEnd,
      onPaste,
      toggleExpand,
      addInsideToggle,
      addColumn,
      setChecked,
      setLanguage,
      setImageUrl,
      setImageMeta,
      setLinkTarget,
      setFileData,
      insertMarkdownAfter,
      insertAiPromptAfter,
      setTemplateData,
      setButtonData,
      updateTable,
      focusNeighbour,
      insertBelow,
      indentBlock,
      outdentBlock,
      deleteBlock,
      duplicateBlock,
      turnInto,
      onDragStart,
      onDragEnd,
      onDragOverRow,
      onDropRow,
      dropTarget,
      childrenOf,
      numberOf,
      selectedIds,
      slashBareBlockId: slash?.bare ? slash.blockId : null,
      shiftSelect,
      selectBlock,
      clearSelection,
      isHalo,
      haloInset,
    }),
    [
      registerEl,
      onInput,
      onKeyDown,
      onCompositionStart,
      onCompositionEnd,
      onPaste,
      toggleExpand,
      addInsideToggle,
      addColumn,
      setChecked,
      setLanguage,
      setImageUrl,
      setImageMeta,
      setLinkTarget,
      setFileData,
      insertMarkdownAfter,
      insertAiPromptAfter,
      setTemplateData,
      setButtonData,
      updateTable,
      focusNeighbour,
      insertBelow,
      indentBlock,
      outdentBlock,
      deleteBlock,
      duplicateBlock,
      turnInto,
      onDragStart,
      onDragEnd,
      onDragOverRow,
      onDropRow,
      dropTarget,
      childrenOf,
      numberOf,
      selectedIds,
      slash,
      shiftSelect,
      selectBlock,
      clearSelection,
      isHalo,
      haloInset,
    ]
  );

  const roots = useMemo(
    () => blocks.filter((b) => (b.parentBlockId ?? null) === null).sort((a, b) => a.position - b.position),
    [blocks]
  );
 // The row elements depend only on the block list, so a re-render from anything
 // else (the save-state badge, a slash menu, selection) does not recreate 227
 // BlockRow elements — only a block change does. Memoized rows keep a keystroke
 // to one element rebuilt, not the whole list twice.
  const childOf = useMemo(() => {
    const s = new Set<string>();
    for (const b of blocks) if (b.parentBlockId) s.add(b.parentBlockId);
    return s;
  }, [blocks]);
 // Every root's descendants, in order. A nested block that changes (a child
 // turned into a heading from its ⠿ menu) leaves its ROOT's object untouched,
 // and a cache keyed on the root alone kept serving the old element — the
 // conversion was saved but did not paint until the next selection change.
  const subtreeOf = useMemo(() => {
    const byParent = new Map<string, EBlock[]>();
    for (const b of blocks) {
      if (!b.parentBlockId) continue;
      const list = byParent.get(b.parentBlockId);
      if (list) list.push(b);
      else byParent.set(b.parentBlockId, [b]);
    }
    const out = new Map<string, EBlock[]>();
    const walk = (id: string, acc: EBlock[]) => {
      for (const c of byParent.get(id) ?? []) {
        acc.push(c);
        walk(c.id, acc);
      }
    };
    for (const b of blocks) {
      if (b.parentBlockId) continue;
      const acc: EBlock[] = [];
      walk(b.id, acc);
      out.set(b.id, acc);
    }
    return out;
  }, [blocks]);
  const rowCache = useRef(new Map<string, { block: EBlock; hasChildren: boolean; subtree: EBlock[]; el: React.ReactElement }>());
  const rows = useMemo(() => {
    const cache = rowCache.current;
    const seen = new Set<string>();
    const sameRefs = (a: EBlock[], b: EBlock[]) => a.length === b.length && a.every((x, i) => x === b[i]);
    const out = roots.map((b) => {
      seen.add(b.id);
      const hc = childOf.has(b.id);
      const hit = cache.get(b.id);
      const fresh = subtreeOf.get(b.id) ?? [];
 // Reuse the very element object for a block whose subtree did not change,
 // so React bails out of it and jsx() runs only for the block that did — a
 // keystroke rebuilds one row's element, not all 227.
      if (hit && hit.block === b && hit.hasChildren === hc && sameRefs(hit.subtree, fresh)) return hit.el;
      const el = <BlockRow key={b.id} block={b} depth={0} hasChildren={hc} subtree={fresh} />;
      cache.set(b.id, { block: b, hasChildren: hc, subtree: fresh, el });
      return el;
    });
    for (const id of cache.keys()) if (!seen.has(id)) cache.delete(id);
    return out;
  }, [roots, childOf, subtreeOf]);

  return (
    <EditorCtx.Provider value={api}>
      <div
        ref={rootRef}
        data-testid="editor-root"
        data-save-state={saveState}
        className="relative mt-2 min-h-[40vh] pb-8"
        onMouseDown={onEditorMouseDown}
        onClickCapture={swallowClickAfterDrag}
        onKeyDownCapture={onRootKeyDownCapture}
        onCopy={onRootCopy}
        onDragOver={(e) => {
 // OS file drag → allow dropping (else the browser navigates away)
          if (e.dataTransfer.types.includes("Files")) e.preventDefault();
        }}
        onClick={(e) => {
 // Links live inside contentEditable, where the browser won't follow
 // them on its own — delegate here (inline links AND page mention
 // chips): internal hrefs SPA-navigate, external open a new tab.
          const anchor = (e.target as HTMLElement).closest?.("a[href]");
          if (anchor && rootRef.current?.contains(anchor)) {
            e.preventDefault();
            const href = anchor.getAttribute("href") ?? "";
            if (href.startsWith("/")) router.push(href);
            else if (/^https?:/.test(href) || href.startsWith("mailto:"))
              window.open(href, "_blank", "noopener,noreferrer");
            return;
          }
 // clicking bare canvas (below the last block) focuses the tail line — and
 // drops any block selection first (Notion S11)
          if (e.target !== e.currentTarget) return;
          clearSelection();
          const order = visualOrder();
          const last = order[order.length - 1];
          const el = last ? editables.current.get(last) : null;
          if (el) {
            el.focus();
            const range = document.createRange();
            range.selectNodeContents(el);
            range.collapse(false);
            const sel = window.getSelection();
            sel?.removeAllRanges();
            sel?.addRange(range);
          } else if (last) {
 // The tail block is uneditable (a sub-page, image, divider or table) so it
 // holds no caret. Clicking below it should still let you type — append an
 // empty paragraph after it and land there (QA-4).
            mutate((prev) => {
              const next = prev.map((b) => ({ ...b }));
              const cur = next.find((b) => b.id === last);
              if (!cur) return prev;
              const nb = freshParagraph(cur.parentBlockId ?? null, positionAfter(next, cur));
              next.push(nb);
              pendingFocus.current = { id: nb.id, pos: "start" };
              return next;
            });
          }
        }}
        onDrop={(e) => {
          const files = Array.from(e.dataTransfer?.files ?? []).filter((f) =>
            f.type.startsWith("image/")
          );
          if (!files.length) return; // internal block drags keep their handlers
          e.preventDefault();
 // a row-peek's editor sits INSIDE the host page's editor (React tree), so
 // without this the host would re-handle the same drop: a second upload of
 // the same bytes, appended to the host page (how images ended up under the
 // Projects database, 2026-08-19)
          e.stopPropagation();
          void (async () => {
            for (const f of files) {
              const up = await uploadBlob(f);
              if (!up) continue;
              const { url } = up;
              mutate((prev) => {
                const next = prev.map((b) => ({ ...b, content: { ...b.content } }));
                const last = next
                  .filter((b) => !b.parentBlockId)
                  .sort((a, b) => a.position - b.position)
                  .at(-1);
                next.push({
                  id: newId(),
                  type: "image",
                  content: { url, text: "" },
                  parentBlockId: null,
                  position: (last?.position ?? 0) + 1,
                  version: 0,
                });
                return next;
              });
            }
          })();
        }}
      >
        <SelectionToolbar container={rootRef} />
        {selectedIds.size > 0 && (
          <div
            data-testid="bulk-toolbar"
            className="popover-anim fixed left-1/2 top-4 z-50 flex -translate-x-1/2 items-center gap-1 rounded-lg border border-neutral-200 bg-white px-2 py-1 text-sm shadow-xl dark:border-neutral-700 dark:bg-neutral-800"
          >
            <span className="px-1.5 text-xs text-neutral-500" data-testid="bulk-count">
              {selectedIds.size} selected
            </span>
            <button
              data-testid="bulk-duplicate"
              onClick={bulkDuplicate}
              className="rounded px-2 py-1 text-neutral-700 transition-colors hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-700"
            >
              Duplicate
            </button>
            <button
              data-testid="bulk-delete"
              onClick={bulkDelete}
              className="rounded px-2 py-1 text-red-500 transition-colors hover:bg-red-50 dark:hover:bg-red-500/10"
            >
              Delete
            </button>
          </div>
        )}
        {/* saving is silent — data-save-state still drives tests; a save
            that has not landed (queue retrying) surfaces a badge. The queue
            keeps the edit in IndexedDB either way; the badge only says so. */}
        {(saveState === "offline" || saveState === "error") && (
          <span
            data-testid={saveState === "offline" ? "offline-badge" : "save-error-badge"}
            className="pointer-events-none fixed right-4 top-3 rounded bg-amber-50 px-2 py-0.5 text-xs text-amber-600 dark:bg-amber-900/30 dark:text-amber-400"
          >
            {saveState === "offline" ? "오프라인" : "저장 실패"} — 변경 내용은 이 브라우저에 보관됨
          </span>
        )}
        {rows}
        {blocks.length === 1 &&
          blocks[0].type === "paragraph" &&
          !(blocks[0].content.text ?? "").trim() && (
          <>
            {/* An empty page offers what it can become — Notion's 시작하기 row.
                The template list below is the same one that used to sit here
                unconditionally; it now opens from the 템플릿 button. A row opened
                in a peek gets the one line Notion shows there instead: the row
                is an entry in a database, not a page you are starting fresh. */}
            {emptyVariant === "row" ? (
              <p
                data-testid="empty-row-hint"
                className="pb-6 pl-2 pt-2 text-sm text-neutral-400"
              >
                &apos;Enter&apos; 키를 눌러 빈 페이지에 입력을 시작하거나{" "}
                <button
                  data-testid="empty-row-templates"
                  onClick={() => setTemplatesOpen((v) => !v)}
                  className="underline decoration-neutral-300 transition-colors hover:text-neutral-600 dark:hover:text-neutral-200"
                >
                  템플릿을 생성하세요
                </button>
                .
              </p>
            ) : (
            <EmptyPageStarter
              onPick={(type, preset) =>
                type === "database"
                  ? void becomeDatabasePage(blocks[0].id)
                  : applyPick(type, preset, { blockId: blocks[0].id, offset: 0, query: "" })
              }
              onTemplates={() => setTemplatesOpen((v) => !v)}
            />
            )}
            {templatesOpen && (
            <div data-testid="page-template-strip" className="mt-4 text-sm text-neutral-400">
              <p className="mb-1.5 text-xs uppercase tracking-wide">Start with a template</p>
              <div className="flex flex-col items-start gap-0.5">
                {PAGE_TEMPLATES.map((t) => (
                  <button
                    key={t.key}
                    data-testid={`page-template-${t.key}`}
                    onClick={() => {
                      const first = blocks[0].id;
                      insertMarkdownAfter(first, t.md);
                      deleteBlock(first);
                    }}
                    className="rounded px-1.5 py-0.5 text-left transition-colors hover:bg-neutral-100 hover:text-neutral-600 dark:hover:bg-neutral-800"
                  >
                    {t.emoji} {t.name}
                  </button>
                ))}
              </div>
            </div>
            )}
          </>
          )}
        {slash && (
          <SlashMenu
            anchor={slash.anchor}
            gap={slash.bare ? 8 : 2}
            anchorHeight={slash.anchorHeight}
            query={slash.query}
            selectedIndex={slash.selected}
            onPick={applySlashPick}
          />
        )}
        {pasteLink && (
          <div
            data-testid="paste-link-menu"
            className="popover-anim fixed z-50 flex items-center gap-1 rounded-lg border border-neutral-200 bg-white p-1 text-xs shadow-xl dark:border-neutral-700 dark:bg-neutral-800"
            style={{ left: pasteLink.anchor.x, top: pasteLink.anchor.y + 26 }}
          >
            <button
              data-testid="paste-link-keep"
              onClick={() => setPasteLink(null)}
              className="rounded px-2 py-1 text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-700"
            >
              Keep as link
            </button>
            <button
              data-testid="paste-link-bookmark"
              onClick={() => {
                const { blockId, url } = pasteLink;
                setPasteLink(null);
                mutate((prev) => {
                  const next = prev.map((b) => ({ ...b, content: { ...b.content } }));
                  const cur = next.find((b) => b.id === blockId);
                  if (!cur) return prev;
 // strip the just-pasted link text from the block…
                  const el2 = editables.current.get(blockId);
                  if (el2) {
                    el2.querySelectorAll("a").forEach((a) => {
                      if (a.getAttribute("href") === url) a.remove();
                    });
                    cur.content.text = normalize(el2);
                    cur.content.html = sanitizeInline(el2.innerHTML);
                    cur.version++;
                  }
 // …and add a bookmark block right below
                  const nb: EBlock = {
                    id: newId(),
                    type: "bookmark",
                    content: { url, text: url },
                    parentBlockId: cur.parentBlockId ?? null,
                    position: positionAfter(next, cur),
                    version: 0,
                  };
                  next.push(nb);
                  return next;
                });
              }}
              className="rounded px-2 py-1 text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-700"
            >
              Create bookmark
            </button>
          </div>
        )}
        {emojiSug && emojiSug.query.length >= 1 && (
          <EmojiSuggestMenu
            anchor={emojiSug.anchor}
            query={emojiSug.query}
            selectedIndex={emojiSug.selected}
            onPick={applyEmojiPick}
          />
        )}
        {mention && (
          <MentionMenu
            anchor={mention.anchor}
            query={mention.query}
            selectedIndex={mention.selected}
            onItems={(items) => {
              mentionItemsRef.current = items;
            }}
            onPick={applyMentionPick}
          />
        )}
      </div>
    </EditorCtx.Provider>
  );
});

/** Built-in page templates offered on a fresh, empty page (template
 * picker). Content is plain markdown fed through the md paste pipeline. */
const PAGE_TEMPLATES = [
  {
    key: "meeting",
    name: "Meeting notes",
    emoji: "📝",
    md: "## Attendees\n- Who was there\n\n## Agenda\n- Topics to cover\n\n## Notes\n- Discussion points\n\n## Action items\n- [ ] Follow up",
  },
  {
    key: "todo",
    name: "To-do list",
    emoji: "✅",
    md: "- [ ] First task\n- [ ] Second task\n- [ ] Third task",
  },
  {
    key: "weekly",
    name: "Weekly planner",
    emoji: "📅",
    md: "## Monday\n- Plan\n\n## Tuesday\n- Plan\n\n## Wednesday\n- Plan\n\n## Thursday\n- Plan\n\n## Friday\n- Plan",
  },
  {
    key: "brief",
    name: "Project brief",
    emoji: "🎯",
    md: "## Overview\nWhat this project is about.\n\n## Goals\n- Goal one\n\n## Timeline\nKey dates.\n\n## Team\n- Owner",
  },
];
