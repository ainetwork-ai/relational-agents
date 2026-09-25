"use client";

import { useEffect, useRef } from "react";
import {
  Type, Heading1, Heading2, Heading3, List, ListOrdered, ListChecks, ListCollapse,
  TextQuote, Minus, ListTree, Link2, Paperclip, Sparkles, Sigma, MousePointerClick,
  LayoutTemplate, Code, Info, Table, Database, Image, Bookmark, Video, AppWindow,
  LayoutDashboard, FileText, Columns2, HardDrive, type LucideIcon,
} from "lucide-react";
import { useAnchoredAt } from "@/hooks/use-anchored";
import { useT } from "@/i18n/provider";
import type { BlockType } from "@/lib/db/schema";
import { SLASH_ITEMS } from "@/lib/editor/block-defs";

/** One line-drawn icon per slash item — keyed by id first, then block type, so
 * "dashboard" and "database" (both type `database`) get their own. Replaces the
 * emoji/text glyphs, which rendered at a different weight and colour than the
 * SVG ones beside them. */
const ITEM_ICON: Record<string, LucideIcon> = {
  paragraph: Type, heading1: Heading1, heading2: Heading2, heading3: Heading3,
  bulleted_list: List, numbered_list: ListOrdered, todo: ListChecks, toggle: ListCollapse,
  quote: TextQuote, divider: Minus, toc: ListTree, link_to_page: Link2, child_page: FileText,
  file: Paperclip, ai_prompt: Sparkles, equation: Sigma, button: MousePointerClick,
  template_button: LayoutTemplate, code: Code, callout: Info, table: Table, database: Database,
  dashboard: LayoutDashboard, image: Image, bookmark: Bookmark, video: Video,
  embed: AppWindow, column_list: Columns2, aindrive: HardDrive,
};

const CATEGORY_ORDER: Record<string, number> = {
  aindrive: -1,
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
  const t = useT();
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
            aindrive: "aindrive",
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
              <>
                {/* a section rule between groups (never above the first) — 1px,
                    rgba(42,28,0,.07), inset 12px, matching the original */}
                {i > 0 && (
                  <div key={`sep-${cat}`} className="mx-3 my-1.5 h-px bg-[rgba(42,28,0,0.07)] dark:bg-white/10" />
                )}
                <p
                  key={`hdr-${cat}`}
                  className="px-3 pb-1 pt-2.5 text-[12px] font-medium leading-[14.4px] text-[#7d7a75] dark:text-neutral-400"
                >
                  {t(SECTION_LABEL[cat])}
                </p>
              </>
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
            <span className="flex h-5 w-5 shrink-0 items-center justify-center text-[#37352f] dark:text-neutral-300">
              {(() => {
                const Icon = ITEM_ICON[item.id ?? item.type] ?? ITEM_ICON[item.type];
                return Icon ? (
                  <Icon size={17} strokeWidth={1.75} aria-hidden="true" />
                ) : (
                  <span className="text-[13px] text-neutral-500">{item.glyph ?? item.label.slice(0, 2)}</span>
                );
              })()}
            </span>
            <span className="min-w-0 flex-1 truncate text-[14px] leading-5 text-[#2c2c2b] dark:text-neutral-200">
              {t(item.label)}
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
        <span>{t("메뉴 닫기")}</span>
        <span className="text-[12px] text-[#a19e99]">esc</span>
      </div>
    </div>
  );
}
