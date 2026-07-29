"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { BlockType } from "@/lib/db/schema";
import { SLASH_ITEMS } from "@/lib/editor/block-defs";

const CATEGORY_ORDER: Record<string, number> = {
  basic: 0,
  media: 1,
  database: 2,
  advanced: 3,
  ai: 4,
};

export function filterSlashItems(query: string) {
  const q = query.toLowerCase().trim();
  const base = q
    ? SLASH_ITEMS.filter((i) => i.keywords.includes(q) || i.label.toLowerCase().includes(q))
    : SLASH_ITEMS;
 // stable category grouping (menu renders one section header per group)
  return [...base].sort(
    (a, b) =>
      (CATEGORY_ORDER[a.category ?? "basic"] ?? 0) - (CATEGORY_ORDER[b.category ?? "basic"] ?? 0)
  );
}

/** Named SVG icons for items whose tile outgrows a text glyph. */
function ItemIcon({ name }: { name: "dashboard" }) {
  if (name === "dashboard") {
 // panel grid — a generic dashboard (any subject, not domain-specific)
    return (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="3" y="3" width="8" height="10" rx="1.5" />
        <rect x="14" y="3" width="7" height="6" rx="1.5" />
        <rect x="14" y="12" width="7" height="9" rx="1.5" />
        <rect x="3" y="16" width="8" height="5" rx="1.5" />
      </svg>
    );
  }
  return null;
}

export function SlashMenu({
  anchor,
  query,
  selectedIndex,
  onPick,
}: {
  anchor: { x: number; y: number };
  query: string;
  selectedIndex: number;
  onPick: (type: BlockType, preset?: Record<string, unknown>) => void;
}) {
  const items = filterSlashItems(query);
  const listRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
 // Flip above the caret when the menu would clip past the bottom of the
 // viewport (and there is room above). Measured after render so the flip
 // tracks the filtered item count.
  const [flip, setFlip] = useState(false);
  useLayoutEffect(() => {
    const h = menuRef.current?.offsetHeight ?? 0;
    const below = anchor.y + 24 + h <= window.innerHeight - 8;
    setFlip(!below && anchor.y - 8 - h >= 0);
  }, [anchor.x, anchor.y, query]);

  useEffect(() => {
    const el = listRef.current?.children[selectedIndex] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  if (items.length === 0) return null;

  return (
    <div
      data-testid="slash-menu"
      className="popover-anim fixed z-50 max-h-72 w-72 overflow-y-auto rounded-lg border border-neutral-200 bg-white py-1.5 shadow-xl dark:border-neutral-700 dark:bg-neutral-800"
      style={
        flip
          ? { left: anchor.x, bottom: window.innerHeight - anchor.y + 8 }
          : { left: anchor.x, top: anchor.y + 24 }
      }
      ref={menuRef}
    >
      <div ref={listRef}>
        {items.map((item, i) => {
          const SECTION_LABEL: Record<string, string> = {
            basic: "Basic blocks",
            media: "Media",
            database: "Database",
            advanced: "Advanced",
            ai: "AI",
          };
          const cat = item.category ?? "basic";
          const prevCat = i > 0 ? (items[i - 1].category ?? "basic") : null;
          const header =
            cat !== prevCat ? (
              <p
                key={`hdr-${cat}`}
                className="sticky top-0 bg-white/95 px-3 pb-1 pt-1.5 text-xs font-medium text-neutral-400 backdrop-blur dark:bg-neutral-800/95"
              >
                {SECTION_LABEL[cat]}
              </p>
            ) : null;
          return (
          <div key={item.id ?? item.type}>
          {header}
          <button
            data-testid={`slash-menu-item-${item.id ?? item.type}`}
            onMouseDown={(e) => {
 // mousedown (not click) so the editable keeps focus/selection
              e.preventDefault();
              onPick(item.type, item.preset);
            }}
            className={`flex w-full items-center gap-3 px-3 py-1.5 text-left transition-colors ${
              i === selectedIndex
                ? "bg-neutral-100 dark:bg-neutral-700"
                : "hover:bg-neutral-50 dark:hover:bg-neutral-700/60"
            }`}
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded border border-neutral-200 bg-white text-sm text-neutral-500 dark:border-neutral-600 dark:bg-neutral-800">
              {item.icon ? <ItemIcon name={item.icon} /> : (item.glyph ?? item.label.slice(0, 2))}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm text-neutral-800 dark:text-neutral-200">
                {item.label}
              </span>
              <span className="block truncate text-xs text-neutral-400">
                {item.hint}
              </span>
            </span>
            {item.md && (
              <kbd className="shrink-0 rounded border border-neutral-200 px-1 text-[10px] text-neutral-400 dark:border-neutral-600">
                {item.md}
              </kbd>
            )}
          </button>
          </div>
          );
        })}
      </div>
    </div>
  );
}
