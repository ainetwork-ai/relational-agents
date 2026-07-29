"use client";

import { useState, useRef, useEffect, memo } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import {
  ChevronRight,
  Plus,
  MoreHorizontal,
  Star,
  StarOff,
  Trash2,
  Pencil,
  GripVertical,
} from "lucide-react";
import type { Page } from "@/lib/db/schema";
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

  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(page.title);
  const menuRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const children = usePagesStore(
    useShallow((s) => s.childrenOf.get(page.id) ?? EMPTY_CHILDREN)
  );
  const isActive = pathname === `/p/${page.id}`;
  const dropHint = useUiStore((s) =>
    s.dropHint?.targetId === page.id ? s.dropHint.zone : null
  );

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menuOpen]);

  function startRenaming() {
    setDraft(page.title);
    setRenaming(true);
  }

  async function addChild() {
    const child = await createPage(page.id);
    expand(page.id);
    router.push(`/p/${child.id}`);
  }

  function commitRename() {
    setRenaming(false);
    if (draft !== page.title) updatePage(page.id, { title: draft });
  }

 // Pointer-based drag to reorder (before/after a sibling) or reparent (drop
 // onto the middle of a row → nest as a child). Persists position/parentPageId.
  function onGripPointerDown(e: React.PointerEvent) {
    if (e.button !== 0) return;
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
          data-testid={`page-drag-${page.id}`}
          onPointerDown={onGripPointerDown}
          aria-label="Drag to reorder"
          className="flex h-5 w-3 shrink-0 cursor-grab items-center justify-center text-neutral-300 opacity-40 transition-opacity hover:text-neutral-500 group-hover:opacity-100 dark:text-neutral-600"
        >
          <GripVertical size={12} />
        </button>
        <button
          data-testid={`page-tree-toggle-${page.id}`}
          onClick={() => toggleExpanded(page.id)}
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded transition-colors hover:bg-neutral-300/60 dark:hover:bg-neutral-700"
          aria-label={expanded ? "Collapse" : "Expand"}
        >
          {/* Swap the page icon for the chevron on row hover */}
          <span className="text-[15px] leading-none group-hover:hidden">
            <PageIcon icon={page.icon} fallback="📄" />
          </span>
          <ChevronRight
            size={14}
            className={`hidden transition-transform duration-150 group-hover:block ${expanded ? "rotate-90" : ""}`}
          />
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
            <span className="truncate">{page.title || "Untitled"}</span>
          </Link>
        )}

        <div className="ml-auto hidden shrink-0 items-center gap-0.5 group-hover:flex">
          <button
            data-testid={`page-item-menu-${page.id}`}
            onClick={() => setMenuOpen((v) => !v)}
            className="flex h-5 w-5 items-center justify-center rounded transition-colors hover:bg-neutral-300/60 dark:hover:bg-neutral-700"
            aria-label="Page options"
          >
            <MoreHorizontal size={14} />
          </button>
          <button
            data-testid={`page-add-child-${page.id}`}
            onClick={addChild}
            className="flex h-5 w-5 items-center justify-center rounded transition-colors hover:bg-neutral-300/60 dark:hover:bg-neutral-700"
            aria-label="Add sub-page"
          >
            <Plus size={14} />
          </button>
        </div>

        {menuOpen && (
          <div
            ref={menuRef}
            data-testid={`page-menu-${page.id}`}
            className="popover-anim absolute left-6 top-7 z-50 w-44 rounded-lg border border-neutral-200 bg-white py-1 shadow-lg dark:border-neutral-700 dark:bg-neutral-800"
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
          </div>
        )}
      </div>

      {expanded && (
        <div className="relative">
          <span
            aria-hidden="true"
            className="pointer-events-none absolute bottom-0 top-0 w-px bg-neutral-200/80 dark:bg-neutral-700/60"
            style={{ left: `${depth * 12 + 26}px` }}
          />
          {children.length === 0 ? (
            <p
              className="py-1 text-xs text-neutral-400"
              style={{ paddingLeft: `${(depth + 1) * 12 + 24}px` }}
            >
              No pages inside
            </p>
          ) : (
            children.map((child) => (
              <PageItem key={child.id} page={child} depth={depth + 1} />
            ))
          )}
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
