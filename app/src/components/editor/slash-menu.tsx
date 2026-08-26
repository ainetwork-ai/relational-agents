"use client";

import { useEffect, useRef } from "react";
import { useAnchoredAt } from "@/hooks/use-anchored";
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
  gap = 2,
  anchorHeight,
  query,
  selectedIndex,
  onPick,
}: {
  anchor: { x: number; y: number };
  gap?: number;
  anchorHeight?: number;
  query: string;
  selectedIndex: number;
  onPick: (type: BlockType, preset?: Record<string, unknown>) => void;
}) {
  const items = filterSlashItems(query);
  const listRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
 // Below the caret, flipped above it when the window's bottom is too close,
 // and clamped sideways — all of it in useAnchoredAt now, which every other
 // caret menu uses too (this one used to own its flip and clamp nothing).
  useAnchoredAt(true, anchor, menuRef, { gap, ...(anchorHeight ? { lineHeight: anchorHeight } : {}) });

  useEffect(() => {
    const el = listRef.current?.children[selectedIndex] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  if (items.length === 0) return null;

  return (
    <div
      data-testid="slash-menu"
 // 원본(2026-08-26 실측): 324 wide, radius 10, layered shadow, no border; a
 // scrolling list of 32px rows capped at 354.8, then a 42px "메뉴 닫기 esc" footer
      className="popover-anim fixed z-50 w-[324px] overflow-hidden rounded-[10px] bg-white shadow-[0_20px_24px_rgba(25,25,25,0.05),0_5px_8px_rgba(25,25,25,0.027),0_0_0_1px_rgba(42,28,0,0.07)] dark:bg-neutral-800 dark:shadow-[0_0_0_1px_rgba(255,255,255,0.1)]"
      style={{ visibility: "hidden" }}
      ref={menuRef}
    >
      <div ref={listRef} className="max-h-[354.8px] overflow-y-auto pb-1">
        {items.map((item, i) => {
          const SECTION_LABEL: Record<string, string> = {
            basic: "기본 블록",
            media: "미디어",
            database: "데이터베이스",
            advanced: "고급 블록",
            ai: "AI",
          };
          const cat = item.category ?? "basic";
          const prevCat = i > 0 ? (items[i - 1].category ?? "basic") : null;
          const header =
            cat !== prevCat ? (
              <p
                key={`hdr-${cat}`}
                className="px-3 pb-1 pt-2.5 text-[12px] font-medium leading-[14.4px] text-[#7d7a75] dark:text-neutral-400"
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
            className={`mx-1 flex h-8 w-[calc(100%-8px)] items-center gap-2 rounded-md px-2 text-left transition-colors ${
              i === selectedIndex
                ? "bg-[rgba(33,27,23,0.05)] dark:bg-white/10"
                : "hover:bg-[rgba(33,27,23,0.05)] dark:hover:bg-white/10"
            }`}
          >
            <span className="flex h-5 w-5 shrink-0 items-center justify-center text-[13px] text-neutral-500">
              {item.icon ? <ItemIcon name={item.icon} /> : (item.glyph ?? item.label.slice(0, 2))}
            </span>
            <span className="min-w-0 flex-1 truncate text-[14px] leading-5 text-[#2c2c2b] dark:text-neutral-200">
              {item.label}
            </span>
            {item.md && (
              <kbd className="shrink-0 pr-1 font-sans text-[12px] text-[#a19e99]">
                {item.md}
              </kbd>
            )}
          </button>
          </div>
          );
        })}
      </div>
      <div className="flex h-[42px] items-center justify-between border-t border-[rgba(42,28,0,0.07)] px-3 text-[14px] text-[#2c2c2b] dark:border-white/10 dark:text-neutral-200">
        <span>메뉴 닫기</span>
        <span className="text-[12px] text-[#a19e99]">esc</span>
      </div>
    </div>
  );
}
