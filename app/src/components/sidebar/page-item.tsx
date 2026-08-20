"use client";

import { useState, useRef, memo } from "react";
import { usePathname, useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import { useAnchored } from "@/hooks/use-anchored";
import { useDismiss } from "@/hooks/use-dismiss";
import Link from "next/link";
import {
  ChevronRight,
  Plus,
  MoreHorizontal,
  Star,
  StarOff,
  Trash2,
  Pencil,
  Table2,
} from "lucide-react";
import type { Page } from "@/lib/db/schema";
import { pageLabel, type PageRow } from "@/lib/page-label";
import { usePagesStore } from "@/stores/pages";
import { useShallow } from "zustand/react/shallow";
import { useUiStore } from "@/stores/ui";
import { PageIcon } from "@/components/page-icon";
import { useToastStore } from "@/stores/toast";

const EMPTY_CHILDREN: Page[] = [];

export const PageItem = memo(function PageItem({ page, depth }: { page: Page; depth: number }) {
  const router = useRouter();
  const pathname = usePathname();
  const createPage = usePagesStore((s) => s.createPage);
  const updatePage = usePagesStore((s) => s.updatePage);
  const archivePage = usePagesStore((s) => s.archivePage);
  const restorePage = usePagesStore((s) => s.restorePage);
  const expanded = useUiStore((s) => s.expanded[page.id] ?? false);
  const toggleExpanded = useUiStore((s) => s.toggleExpanded);
  const expand = useUiStore((s) => s.expand);
  const openPeek = useUiStore((s) => s.openPeek);

  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(page.title);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuBtnRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const children = usePagesStore(
    useShallow((s) => s.childrenOf.get(page.id) ?? EMPTY_CHILDREN)
  );
 // the whole tree is loaded up front (stores/pages.ts), so leaf-ness is known
 // at render time — no lazy fetch to wait for
  const hasChildren = children.length > 0;
  const isActive = pathname === `/p/${page.id}`;
  const dropHint = useUiStore((s) =>
    s.dropHint?.targetId === page.id ? s.dropHint.zone : null
  );

 // portalled and placed: inside the sidebar's scroller this menu was cut off
 // by 90px on the lower pages. Both refs count as inside for dismissal.
  useAnchored(menuOpen, menuBtnRef, menuRef);
  useDismiss(menuOpen, () => setMenuOpen(false), menuBtnRef, menuRef);

  function startRenaming() {
    setDraft(page.title);
    setRenaming(true);
  }

  async function addChild() {
    const child = await createPage(page.id);
    expand(page.id);
 // Notion opens a new sub-page in the center peek rather than navigating away
 // — the popup header says where it went ("추가 대상 🏠 팀스페이스 홈"), and you
 // keep the page you were reading behind it. ⤢ in the peek makes it full-page.
    openPeek(child.id, page.id);
  }

  function commitRename() {
    setRenaming(false);
    if (draft !== page.title) updatePage(page.id, { title: draft });
  }

 // Pointer-based drag to reorder (before/after a sibling) or reparent (drop
 // onto the middle of a row → nest as a child). Persists position/parentPageId.
  function onGripPointerDown(e: React.PointerEvent) {
    if (e.button !== 0) return;
 // the original has no grip in the sidebar: you drag the row itself. Buttons
 // and the rename input inside it keep their own clicks.
    if ((e.target as HTMLElement).closest("button,input")) return;
    e.preventDefault();
 // live three-zone preview (above / inside / below) while dragging
    const onMove = (ev: PointerEvent) => {
      const el = document.elementFromPoint(ev.clientX, ev.clientY);
      const row = el?.closest('[data-testid^="page-tree-item-"]') as HTMLElement | null;
      const ui = useUiStore.getState();
      if (!row) {
        if (ui.dropHint) ui.setDropHint(null);
        return;
      }
      const targetId = row.getAttribute("data-testid")!.replace("page-tree-item-", "");
      if (targetId === page.id) {
        if (ui.dropHint) ui.setDropHint(null);
        return;
      }
      const rect = row.getBoundingClientRect();
      const rel = (ev.clientY - rect.top) / rect.height;
      const zone = rel < 0.33 ? "before" : rel > 0.66 ? "after" : "inside";
      if (ui.dropHint?.targetId !== targetId || ui.dropHint?.zone !== zone)
        ui.setDropHint({ targetId, zone });
    };
    window.addEventListener("pointermove", onMove);
    const onUp = (ev: PointerEvent) => {
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointermove", onMove);
      useUiStore.getState().setDropHint(null);
      const el = document.elementFromPoint(ev.clientX, ev.clientY);
      const row = el?.closest('[data-testid^="page-tree-item-"]') as HTMLElement | null;
      if (!row) return;
      const targetId = row.getAttribute("data-testid")!.replace("page-tree-item-", "");
      if (targetId === page.id) return;
      const store = usePagesStore.getState();
      const target = store.pages[targetId];
      if (!target) return;
      const rect = row.getBoundingClientRect();
      const rel = (ev.clientY - rect.top) / rect.height;
      if (rel < 0.33 || rel > 0.66) {
 // reorder as a sibling of the target (before or after it)
        const before = rel < 0.33;
        store.updatePage(page.id, {
          parentPageId: target.parentPageId,
          position: target.position + (before ? -0.5 : 0.5),
        });
      } else {
 // nest under the target
        store.updatePage(page.id, { parentPageId: targetId });
        useUiStore.getState().expand(targetId);
      }
    };
    window.addEventListener("pointerup", onUp);
  }

  return (
    <div>
      <div
        data-testid={`page-tree-item-${page.id}`}
        className={`group relative flex items-center gap-0.5 rounded-md py-1 pr-1 text-sm transition-colors ${
          isActive
            ? "bg-neutral-200/70 font-medium text-neutral-900 dark:bg-neutral-700/50 dark:text-neutral-100"
            : "text-neutral-600 hover:bg-neutral-200/50 dark:text-neutral-400 dark:hover:bg-neutral-800"
        }`}
        onPointerDown={onGripPointerDown}
        style={{ paddingLeft: `${depth * 12 + 4}px` }}
      >
        {dropHint === "before" && (
          <span data-testid={`page-drop-hint-${page.id}`} className="pointer-events-none absolute -top-px left-2 right-1 h-0.5 rounded bg-blue-500" />
        )}
        {dropHint === "after" && (
          <span data-testid={`page-drop-hint-${page.id}`} className="pointer-events-none absolute -bottom-px left-2 right-1 h-0.5 rounded bg-blue-500" />
        )}
        {dropHint === "inside" && (
          <span data-testid={`page-drop-hint-${page.id}`} className="pointer-events-none absolute inset-0 rounded-md bg-blue-500/10 ring-2 ring-inset ring-blue-400/70" />
        )}
        <button
          data-testid={`page-tree-toggle-${page.id}`}
          onClick={hasChildren ? () => toggleExpanded(page.id) : undefined}
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded transition-colors hover:bg-neutral-300/60 dark:hover:bg-neutral-700"
          aria-label={hasChildren ? (expanded ? "Collapse" : "Expand") : undefined}
        >
          {/* Swap the page icon for the chevron on row hover. A leaf keeps its
              icon — a deliberate divergence from the original, which offers the
              chevron (and "No pages inside") on every page (comcom, 2026-08-19) */}
          <span className={`text-[15px] leading-none ${hasChildren ? "group-hover:hidden" : ""}`}>
            {(page as PageRow).isDatabase && !page.icon ? (
              <Table2 size={13} className="shrink-0 text-neutral-400" aria-label="데이터베이스" />
            ) : (
              <PageIcon icon={page.icon} fallback="📄" />
            )}
          </span>
          {hasChildren && (
            <ChevronRight
              size={12}
              className={`hidden transition-transform duration-150 group-hover:block ${expanded ? "rotate-90" : ""}`}
            />
          )}
        </button>

        {renaming ? (
          <input
            ref={inputRef}
            autoFocus
            onFocus={(e) => e.target.select()}
            data-testid={`page-rename-input-${page.id}`}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitRename();
              if (e.key === "Escape") setRenaming(false);
            }}
            className="min-w-0 flex-1 rounded border border-blue-400 bg-white px-1 py-0 text-sm outline-none dark:bg-neutral-900"
          />
        ) : (
          <Link
            href={`/p/${page.id}`}
            aria-current={isActive ? "page" : undefined}
            className="flex min-w-0 flex-1 items-center gap-1.5"
          >
            <span className="truncate">{pageLabel(page as PageRow)}</span>
          </Link>
        )}

        {/* while the menu is open these must stay laid out: the panel is anchored
            to the ⋯ button, and `group-hover:flex` alone removed that button the
            moment the pointer left the row for the menu — the menu folded away
            before any item could be clicked */}
        <div
          className={`ml-auto shrink-0 items-center gap-0.5 group-hover:flex ${
            menuOpen ? "flex" : "hidden"
          }`}
        >
          <button
            ref={menuBtnRef}
            data-testid={`page-item-menu-${page.id}`}
            onClick={() => setMenuOpen((v) => !v)}
            className="flex h-5 w-5 items-center justify-center rounded transition-colors hover:bg-neutral-300/60 dark:hover:bg-neutral-700"
            aria-label="Page options"
          >
            <MoreHorizontal size={16} />
          </button>
          <button
            data-testid={`page-add-child-${page.id}`}
            onClick={addChild}
            className="flex h-5 w-5 items-center justify-center rounded transition-colors hover:bg-neutral-300/60 dark:hover:bg-neutral-700"
            aria-label="Add sub-page"
          >
            <Plus size={16} />
          </button>
        </div>

        {menuOpen &&
          createPortal(
            <div
              ref={menuRef}
              data-testid={`page-menu-${page.id}`}
              style={{ visibility: "hidden" }}
              className="popover-anim fixed z-50 w-44 overflow-y-auto rounded-lg border border-neutral-200 bg-white py-1 shadow-lg dark:border-neutral-700 dark:bg-neutral-800"
            >
            <MenuButton
              testid={`page-menu-rename-${page.id}`}
              icon={<Pencil size={14} />}
              label="Rename"
              onClick={() => {
                setMenuOpen(false);
                startRenaming();
              }}
            />
            <MenuButton
              testid={`page-menu-favorite-${page.id}`}
              icon={page.isFavorite ? <StarOff size={14} /> : <Star size={14} />}
              label={page.isFavorite ? "Remove from Favorites" : "Add to Favorites"}
              onClick={() => {
                setMenuOpen(false);
                updatePage(page.id, { isFavorite: !page.isFavorite });
              }}
            />
            <MenuButton
              testid={`page-menu-delete-${page.id}`}
              icon={<Trash2 size={14} />}
              label="Delete"
              danger
              onClick={async () => {
                setMenuOpen(false);
                await archivePage(page.id);
                useToastStore
                  .getState()
                  .show("Moved to Trash", { onUndo: () => restorePage(page.id) });
                if (isActive) router.push("/");
              }}
            />
            </div>,
            document.body
          )}
      </div>

      {/* a stale expanded flag (last child deleted) renders nothing — the
          toggle is gone with the children, so there'd be no way to collapse */}
      {expanded && hasChildren && (
        <div>
          {children.map((child) => (
            <PageItem key={child.id} page={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
});

function MenuButton({
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
        danger ? "text-red-500" : "text-neutral-700 dark:text-neutral-300"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}
