"use client";

import { useRouter } from "next/navigation";
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
import { htmlToMarkdownish } from "@/lib/editor/html-paste";
import { newId } from "@/lib/compat";
import { sanitizeInline } from "@/lib/rich-text";
import { parseMarkdown } from "@/lib/notion-parse";
import { SelectionToolbar } from "./selection-toolbar";
import { SlashMenu, filterSlashItems } from "./slash-menu";
import { MentionMenu, mentionChipHtml, type MentionItem } from "./mention-menu";
import { EmojiSuggestMenu, emojiCandidates, type EmojiCandidate } from "./emoji-suggest";
import { BlockRow } from "./block-row";
import { useDebounced } from "@/hooks/use-debounced";
import { usePageSync } from "@/hooks/use-page-sync";
import { usePagesStore } from "@/stores/pages";

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
  insertBelow: (id: string) => void;
  indentBlock: (id: string, el: HTMLElement) => void;
  outdentBlock: (id: string, el: HTMLElement) => void;
  deleteBlock: (id: string) => void;
  duplicateBlock: (id: string) => void;
  turnInto: (id: string, type: BlockType) => void;
  onDragStart: (id: string) => void;
  onDragOverRow: (e: React.DragEvent, id: string) => void;
  onDropRow: (e: React.DragEvent, id: string) => void;
  dropTarget: { id: string; before: boolean; side?: "left" | "right" } | null;
  childrenOf: (id: string | null) => EBlock[];
  numberOf: (b: EBlock) => number;
  selectedIds: Set<string>;
  shiftSelect: (id: string) => void;
  clearSelection: () => void;
}

const EditorCtx = createContext<EditorApi | null>(null);
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
 *  Multi-line paste (each line → a block) or a single clear markdown marker
 *  routes through the parser; a single plain line keeps inline paste. */
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

/** Types that keep their type when a block is split by Enter. */
const CONTINUING: BlockType[] = ["bulleted_list", "numbered_list", "todo"];

export const BlockEditor = forwardRef<
  BlockEditorHandle,
  { pageId: string; initialBlocks: Block[]; shareToken?: string }
>(function BlockEditor({ pageId, initialBlocks, shareToken }, apiRef) {
  const [blocks, setBlocks] = useState<EBlock[]>(() => {
    const mapped = initialBlocks.map(fromRow);
    return mapped.length > 0 ? mapped : [freshParagraph(null, 1)];
  });
  const [slash, setSlash] = useState<SlashState | null>(null);
  const [mention, setMention] = useState<MentionState | null>(null);
  const [emojiSug, setEmojiSug] = useState<MentionState | null>(null);
  // URL paste → "keep link / bookmark" chooser (UIUX #49)
  const [pasteLink, setPasteLink] = useState<{
    blockId: string;
    url: string;
    anchor: { x: number; y: number };
  } | null>(null);
  const mentionItemsRef = useRef<MentionItem[]>([]);
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

  // stable per-mount identity — the server echoes it so we can ignore our own
  // SSE events (aindrive's origin-tag pattern)
  const [clientId] = useState(() => newId());
  const [dropTarget, setDropTarget] = useState<{ id: string; before: boolean; side?: "left" | "right" } | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "offline">("idle");

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
  // is declared via `newIds` so the server can tell a fresh insert apart from
  // a stale block someone else already deleted.
  const serverIdsRef = useRef<Set<string>>(new Set(initialBlocks.map((b) => b.id)));

  const draftKey = `notion-draft-${pageId}`;
  const save = useDebounced(async (payload: EBlock[]) => {
    setSaveState("saving");
    const seq = seqRef.current;
    const payloadIds = new Set(payload.map((b) => b.id));
    // delete→undo before the flush: the block is alive again — don't delete it
    for (const id of [...deletedIds.current]) {
      if (payloadIds.has(id)) deletedIds.current.delete(id);
    }
    const dels = [...deletedIds.current];
    const newIds = payload.filter((b) => !serverIdsRef.current.has(b.id)).map((b) => b.id);
    const body = JSON.stringify({
      blocks: payload.map((b) => ({
        id: b.id,
        type: b.type,
        content: b.content,
        parentBlockId: b.parentBlockId,
        position: b.position,
      })),
      deletedIds: dels,
      newIds,
    });
    let res: Response | null = null;
    try {
      res = await fetch(`/api/pages/${pageId}/blocks`, {
        method: "PUT",
        headers: { "content-type": "application/json", "x-client-id": clientId },
        body,
        // survive page reload/navigation mid-flush (small payloads only —
        // keepalive caps the body at ~64KB)
        keepalive: body.length < 60_000,
      });
    } catch {
      // network down — keep the edits locally and resync when back online
    }
    if (res?.ok) {
      for (const d of dels) {
        deletedIds.current.delete(d);
        serverIdsRef.current.delete(d);
      }
      let dropped: string[] = [];
      try {
        dropped = ((await res.json())?.droppedIds as string[] | undefined) ?? [];
      } catch {}
      const droppedSet = new Set(dropped);
      for (const b of payload) {
        if (!droppedSet.has(b.id)) serverIdsRef.current.add(b.id);
      }
      // some of our blocks were deleted elsewhere while we were stale —
      // reconcile with the authoritative list (runs below once not dirty)
      if (dropped.length) needResyncRef.current = true;
      if (seqRef.current === seq) dirtyRef.current = false;
      setSaveState("saved");
      try {
        localStorage.removeItem(draftKey);
      } catch {}
      if (needResyncRef.current && !dirtyRef.current) {
        needResyncRef.current = false;
        void applyRemoteRef.current();
      }
    } else if (res) {
      setSaveState("idle");
    } else {
      // offline: persist a local draft so nothing is lost even across a crash
      setSaveState("offline");
      try {
        localStorage.setItem(
          draftKey,
          JSON.stringify({ blocks: payload, deletedIds: dels, at: Date.now() })
        );
      } catch {}
    }
  }, 500);

  // resync the moment the browser reports connectivity again (plus a slow
  // safety poll — some proxies never fire the online event)
  useEffect(() => {
    const retry = () => {
      if (dirtyRef.current) save.call(blocksRef.current);
    };
    window.addEventListener("online", retry);
    const iv = setInterval(() => {
      if (dirtyRef.current && navigator.onLine) retry();
    }, 5000);
    return () => {
      window.removeEventListener("online", retry);
      clearInterval(iv);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // crash recovery: a local draft newer than this mount means edits never
  // reached the server (tab closed while offline) — restore and resave it
  useEffect(() => {
    // deferred (async IIFE) so no setState runs synchronously in the effect body
    void (async () => {
      try {
        const raw = localStorage.getItem(draftKey);
        if (!raw) return;
        const draft = JSON.parse(raw) as { blocks: EBlock[]; deletedIds: string[]; at: number };
        if (!Array.isArray(draft.blocks) || Date.now() - draft.at > 24 * 60 * 60 * 1000) {
          localStorage.removeItem(draftKey);
          return;
        }
        for (const d of draft.deletedIds ?? []) deletedIds.current.add(d);
        dirtyRef.current = true;
        // bump versions so Editable repaints over the server-rendered DOM
        const restored = draft.blocks.map((b) => ({ ...b, version: (b.version ?? 0) + 1 }));
        setBlocks(restored);
        save.call(restored);
      } catch {}
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const mutate = useCallback(
    (updater: (prev: EBlock[]) => EBlock[], opts?: { coalesce?: boolean }) => {
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
      setBlocks((prev) => {
        const next = updater(prev);
        save.call(next);
        return next;
      });
    },
    [save]
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
      for (const b of restored) deletedIds.current.delete(b.id);
      for (const b of blocksRef.current) {
        if (!restored.some((r) => r.id === b.id)) deletedIds.current.add(b.id);
      }
      setBlocks(restored);
      save.call(restored);
    },
    [save]
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
    (window as unknown as Record<string, unknown>).__notionEditorReady = pageId;
    return () => {
      (window as unknown as Record<string, unknown>).__notionEditorReady = null;
    };
  }, [pageId]);

  // Apply pending caret placement after React commits block changes.
  // useLayoutEffect (not useEffect): during fast typing the NEXT keydown can
  // arrive before a passive effect runs, landing keystrokes in the pre-split
  // block ("row-6row-7" merges, S032) — layout effects run before that.
  useLayoutEffect(() => {
    const pf = pendingFocus.current;
    if (!pf) return;
    const el = editables.current.get(pf.id);
    if (el) {
      setCaret(el, pf.pos);
      pendingFocus.current = null;
    }
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
    // into a "new" block on the next save and resurrect it (S450)
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
          next.push(old);
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

  usePageSync(pageId, clientId, (event) => {
    if (event.type === "blocks") void applyRemote();
  }, shareToken);

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
      blocks
        .filter((b) => (b.parentBlockId ?? null) === parentId)
        .sort((a, b) => a.position - b.position),
    [blocks]
  );

  const numberOf = useCallback(
    (b: EBlock) => {
      const sibs = blocks
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
    [blocks]
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

  const applySlashPick = useCallback(
    (type: BlockType, preset?: Record<string, unknown>) => {
      if (!slash) return;
      const { blockId, offset, query } = slash;
      setSlash(null);

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
        mutate((prev) =>
          prev.map((b) =>
            b.id === blockId
              ? { ...b, type: "child_page" as BlockType, content: {}, version: b.version + 1 }
              : b
          )
        );
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
        const stripped = text.slice(0, offset - 1) + text.slice(offset + query.length);

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
        if (type === "table")
          cur.content.table = cur.content.table ?? {
            cells: [["", ""], ["", ""]],
            headerRow: true,
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
    [slash, mutate, positionAfter, pageId]
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

        // Enter on an empty continuing block exits the list instead of adding.
        if (CONTINUING.includes(cur.type) && text === "") {
          cur.type = "paragraph";
          cur.version++;
          pendingFocus.current = { id: cur.id, pos: "start" };
          return next;
        }

        cur.content.text = before;
        cur.content.html = beforeHtml;
        cur.version++;

        const nb = freshParagraph(cur.parentBlockId, 0);
        nb.position = positionAfter(next, cur);
        nb.content.text = after;
        nb.content.html = afterHtml;
        if (CONTINUING.includes(cur.type)) {
          nb.type = cur.type;
          if (cur.type === "todo") nb.content.checked = false;
        }
        next.push(nb);
        pendingFocus.current = { id: nb.id, pos: "start" };
        return next;
      });
    },
    [mutate, positionAfter]
  );

  const handleBackspaceAtStart = useCallback(
    (id: string, el: HTMLElement): boolean => {
      const text = normalize(el);
      const block = blocks.find((b) => b.id === id);
      if (!block) return false;

      // Styled block → demote to paragraph first (Notion behavior).
      if (block.type !== "paragraph" && TEXT_TYPES.includes(block.type)) {
        mutate((prev) =>
          prev.map((b) =>
            b.id === id ? { ...b, type: "paragraph" as BlockType, version: b.version } : b
          )
        );
        return true;
      }

      const sibs = childrenOf(block.parentBlockId ?? null);
      const idx = sibs.findIndex((s) => s.id === id);
      const prevSib = sibs[idx - 1];
      if (!prevSib) return false;

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
        const next = prev
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
    [blocks, childrenOf, mutate]
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
      // DOM in place; normalize() below re-reads it either way
      if (el.closest("[data-block-type]")?.getAttribute("data-block-type") !== "code")
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
        if (text.length < slash.offset || text[slash.offset - 1] !== "/") {
          setSlash(null);
        } else {
          const query = text.slice(slash.offset);
          setSlash({ ...slash, query, selected: 0 });
        }
      } else {
        // markdown shortcuts only on plain paragraphs
        const block = blocks.find((b) => b.id === id);
        if (block?.type === "paragraph") {
          // Notion converts on the third backtick immediately, no space needed
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
          for (const s of MARKDOWN_SHORTCUTS) {
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
    [slash, mention, emojiSug, pasteLink, blocks, mutate]
  );

  // Smart paste: clipboard image → upload + image block; markdown/multi-line
  // text → parse into MULTIPLE blocks split at the caret; single plain line →
  // the original inline paste. Code blocks always paste literally.
  const onPaste = useCallback(
    (id: string, e: React.ClipboardEvent, el: HTMLElement) => {
      const cd = e.clipboardData;
      const block = blocks.find((b) => b.id === id);

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
      if (htmlClip) {
        const md = htmlToMarkdownish(htmlClip);
        if (md && looksLikeMarkdown(md)) text = md;
      }
      if (!text) return; // nothing pasteable — let the browser default run

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
      // URL becomes a link and offers "keep / bookmark" (Notion's chooser).
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
    [blocks, mutate, positionAfter]
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
      } else if (e.key === "Escape") {
        e.preventDefault();
        clearSelection();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [selectedIds, visualOrder, rangeIds, bulkDelete, bulkDuplicate, clearSelection]);

  const indentBlock = useCallback(
    (id: string, el: HTMLElement) => {
      const off = caretOffset(el);
      mutate((prev) => {
        const next = prev.map((b) => ({ ...b }));
        const cur = next.find((b) => b.id === id);
        if (!cur) return prev;
        const sibs = next
          .filter((b) => (b.parentBlockId ?? null) === (cur.parentBlockId ?? null))
          .sort((a, b) => a.position - b.position);
        const idx = sibs.findIndex((s) => s.id === id);
        const prevSib = sibs[idx - 1];
        if (!prevSib) return prev; // first child can't indent
        const kids = next
          .filter((b) => b.parentBlockId === prevSib.id)
          .sort((a, b) => a.position - b.position);
        cur.parentBlockId = prevSib.id;
        cur.position = (kids[kids.length - 1]?.position ?? 0) + 1;
        pendingFocus.current = { id, pos: off };
        return next;
      });
    },
    [mutate]
  );

  const outdentBlock = useCallback(
    (id: string, el: HTMLElement) => {
      const off = caretOffset(el);
      mutate((prev) => {
        const next = prev.map((b) => ({ ...b }));
        const cur = next.find((b) => b.id === id);
        if (!cur || !cur.parentBlockId) return prev; // already top-level
        const parent = next.find((b) => b.id === cur.parentBlockId);
        if (!parent) return prev;
        cur.parentBlockId = parent.parentBlockId ?? null;
        cur.position = positionAfter(next, parent);
        pendingFocus.current = { id, pos: off };
        return next;
      });
    },
    [mutate, positionAfter]
  );

  const onKeyDown = useCallback(
    (id: string, e: React.KeyboardEvent, el: HTMLElement) => {
      const block = blocks.find((b) => b.id === id);
      if (!block) return;

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
    [blocks, slash, mention, emojiSug, applySlashPick, applyMentionPick, applyEmojiPick, moveBlock, splitBlock, handleBackspaceAtStart, indentBlock, outdentBlock, focusNeighbour, selectBlock]
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
      // Notion behavior: + inserts a block AND opens the type menu — a silent
      // empty block reads as "nothing happened".
      const nb = freshParagraph(null, 0);
      nb.content.text = "/";
      mutate((prev) => {
        const next = prev.map((b) => ({ ...b }));
        const cur = next.find((b) => b.id === id);
        if (!cur) return prev;
        nb.parentBlockId = cur.parentBlockId;
        nb.position = positionAfter(next, cur);
        next.push(nb);
        return next;
      });
      pendingFocus.current = { id: nb.id, pos: "end" };
      // The new block's editable may take more than one frame to mount on
      // slow renders — retry briefly instead of silently leaving a bare "/".
      const openMenu = (attempt: number) => {
        const el = editables.current.get(nb.id);
        if (!el) {
          if (attempt < 10) requestAnimationFrame(() => openMenu(attempt + 1));
          return;
        }
        const rect = caretRect() ?? el.getBoundingClientRect();
        setSlash({
          blockId: nb.id,
          offset: 1,
          query: "",
          selected: 0,
          anchor: { x: rect.left, y: rect.top },
        });
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
            content.table = { cells: [["", ""], ["", ""]], headerRow: true };
          return { ...b, type, content, version: b.version + 1 };
        })
      );
    },
    [mutate]
  );

  const onDragStart = useCallback((id: string) => {
    draggingId.current = id;
  }, []);

  const onDragOverRow = useCallback((e: React.DragEvent, id: string) => {
    if (!draggingId.current || draggingId.current === id) return;
    e.preventDefault();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    // near the left/right edge → side-drop creates columns; otherwise reorder.
    const relX = (e.clientX - rect.left) / rect.width;
    const side = relX < 0.25 ? "left" : relX > 0.75 ? "right" : undefined;
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
        // takes the target's slot (Notion's "create columns by side-drop").
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
      blocks,
      registerEl,
      onInput,
      onKeyDown,
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
      insertBelow,
      indentBlock,
      outdentBlock,
      deleteBlock,
      duplicateBlock,
      turnInto,
      onDragStart,
      onDragOverRow,
      onDropRow,
      dropTarget,
      childrenOf,
      numberOf,
      selectedIds,
      shiftSelect,
      clearSelection,
    }),
    [
      blocks,
      registerEl,
      onInput,
      onKeyDown,
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
      insertBelow,
      indentBlock,
      outdentBlock,
      deleteBlock,
      duplicateBlock,
      turnInto,
      onDragStart,
      onDragOverRow,
      onDropRow,
      dropTarget,
      childrenOf,
      numberOf,
      selectedIds,
      shiftSelect,
      clearSelection,
    ]
  );

  const roots = childrenOf(null);

  return (
    <EditorCtx.Provider value={api}>
      <div
        ref={rootRef}
        data-testid="editor-root"
        data-save-state={saveState}
        className="relative mt-2 min-h-[40vh] pb-8"
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
          // clicking bare canvas (below the last block) focuses the tail line
          if (e.target !== e.currentTarget) return;
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
          }
        }}
        onDrop={(e) => {
          const files = Array.from(e.dataTransfer?.files ?? []).filter((f) =>
            f.type.startsWith("image/")
          );
          if (!files.length) return; // internal block drags keep their handlers
          e.preventDefault();
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
        {/* saving is silent (Notion) — data-save-state still drives tests;
            only the OFFLINE state surfaces a badge */}
        {saveState === "offline" && (
          <span
            data-testid="offline-badge"
            className="pointer-events-none fixed right-4 top-3 rounded bg-amber-50 px-2 py-0.5 text-xs text-amber-600 dark:bg-amber-900/30 dark:text-amber-400"
          >
            Offline — changes kept locally
          </span>
        )}
        {roots.map((b) => (
          <BlockRow key={b.id} block={b} depth={0} />
        ))}
        {blocks.length === 1 &&
          blocks[0].type === "paragraph" &&
          !(blocks[0].content.text ?? "").trim() && (
            <div data-testid="page-template-strip" className="mt-6 text-sm text-neutral-400">
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
        {slash && (
          <SlashMenu
            anchor={slash.anchor}
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

/** Built-in page templates offered on a fresh, empty page (Notion's template
 *  picker). Content is plain markdown fed through the md paste pipeline. */
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
