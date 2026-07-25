"use client";

import { useEffect, useMemo, useState } from "react";
import { FileText, Calendar } from "lucide-react";
import { usePagesStore } from "@/stores/pages";
import { PageIcon } from "@/components/page-icon";
import { MonthGrid } from "@/components/database/property-cell";

export interface MentionItem {
  kind: "page" | "person" | "date";
  id: string;
  label: string;
  icon?: string | null;
  /** parent page title, shown as secondary text (R2#19) */
  parent?: string;
}

interface PublicMember {
  id: string;
  displayName: string;
  avatarUrl?: string | null;
}

/** Builds the inline mention chip's HTML for a picked item. */
export function mentionChipHtml(item: MentionItem, escape: (s: string) => string): string {
  const label = `@${escape(item.label)}`;
  if (item.kind === "page") {
    return `<a href="/p/${item.id}" class="mention" data-mention-type="page" data-mention-id="${item.id}">${label}</a>`;
  }
  return `<span class="mention" data-mention-type="${item.kind}" data-mention-id="${escape(item.id)}">${label}</span>`;
}

function todayItem(): MentionItem {
  const now = new Date();
  const label = now.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
  return { kind: "date", id: now.toISOString().slice(0, 10), label };
}

/** Build a date mention for an ISO (yyyy-mm-dd) date string. */
function dateItem(iso: string): MentionItem {
 // parse as local date (avoid the UTC shift of new Date("yyyy-mm-dd"))
  const [y, m, d] = iso.split("-").map(Number);
  const label = new Date(y, (m ?? 1) - 1, d ?? 1).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
  return { kind: "date", id: iso, label };
}

/** @-mention popup: pages (from the tree), people (workspace members), and a date. */
export function MentionMenu({
  anchor,
  query,
  selectedIndex,
  onItems,
  onPick,
}: {
  anchor: { x: number; y: number };
  query: string;
  selectedIndex: number;
  onItems: (items: MentionItem[]) => void;
  onPick: (item: MentionItem) => void;
}) {
  const [calOpen, setCalOpen] = useState(false);
  const pages = usePagesStore((s) => s.pages);
  const [people, setPeople] = useState<PublicMember[]>([]);

  useEffect(() => {
    let alive = true;
    fetch("/api/workspace/members")
      .then((r) => (r.ok ? r.json() : { members: [] }))
      .then((d) => {
        if (alive) setPeople(d.members ?? []);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const items = useMemo<MentionItem[]>(() => {
    const q = query.trim().toLowerCase();
 // most recently edited first — on a big workspace the fresh
 // page you mean must not fall out of the visible slice
    const pageItems: MentionItem[] = Object.values(pages)
      .sort(
        (a, b) =>
          new Date(b.updatedAt ?? 0).getTime() - new Date(a.updatedAt ?? 0).getTime()
      )
      .map((p) => ({
        kind: "page" as const,
        id: p.id,
        label: p.title || "Untitled",
        icon: p.icon,
        parent: p.parentPageId ? (pages[p.parentPageId]?.title || "Untitled") : undefined,
      }))
      .filter((it) => !q || it.label.toLowerCase().includes(q));
    const personItems: MentionItem[] = people
      .map((m) => ({ kind: "person" as const, id: m.id, label: m.displayName }))
      .filter((it) => !q || it.label.toLowerCase().includes(q));
    const dateItems: MentionItem[] = "today".includes(q) || !q ? [todayItem()] : [];
    return [...personItems.slice(0, 5), ...pageItems.slice(0, 6), ...dateItems];
  }, [query, pages, people]);

  useEffect(() => {
    onItems(items);
  }, [items, onItems]);

  if (items.length === 0) return null;

  return (
    <div
      data-testid="mention-menu"
      className="popover-anim fixed z-50 max-h-72 w-64 overflow-y-auto rounded-lg border border-neutral-200 bg-white py-1 shadow-xl dark:border-neutral-700 dark:bg-neutral-800"
      style={{ left: anchor.x, top: anchor.y + 24 }}
    >
      {/*  groups mentions under section headers — no per-row type
          badges (R2#18); rows are ~28px (R2#20) with a parent-path secondary
          label on pages (R2#19). selectedIndex stays a flat index. */}
      {(() => {
        const sections: { name: string; kind: MentionItem["kind"] }[] = [
          { name: "People", kind: "person" },
          { name: "Pages", kind: "page" },
          { name: "Date", kind: "date" },
        ];
        return sections.map((sec) => {
          const secItems = items.filter((it) => it.kind === sec.kind);
          if (secItems.length === 0) return null;
          return (
            <div key={sec.name}>
              <p className="px-3 pb-0.5 pt-1.5 text-[11px] font-medium text-neutral-400">
                {sec.name}
              </p>
              {secItems.map((item) => {
                const i = items.indexOf(item);
                return (
                  <button
                    key={`${item.kind}-${item.id}`}
                    data-testid={`mention-item-${item.kind}-${item.id}`}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      onPick(item);
                    }}
                    className={`mx-1 flex w-[calc(100%-0.5rem)] items-center gap-2 rounded-md px-2 py-1 text-left text-sm ${
                      i === selectedIndex
                        ? "bg-neutral-100 dark:bg-neutral-700"
                        : "hover:bg-neutral-50 dark:hover:bg-neutral-700/60"
                    }`}
                  >
                    <span className="shrink-0 text-neutral-400">
                      {item.kind === "person" ? (
                        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-blue-500 text-[10px] font-semibold text-white">
                          {(item.label ?? "?").slice(0, 1).toUpperCase()}
                        </span>
                      ) : item.kind === "page" ? (
                        item.icon ? <span className="text-base"><PageIcon icon={item.icon} /></span> : <FileText size={15} />
                      ) : (
                        <Calendar size={15} />
                      )}
                    </span>
                    <span className="truncate text-neutral-800 dark:text-neutral-200">{item.label}</span>
                    {item.parent && (
                      <span className="ml-auto max-w-[40%] truncate text-xs text-neutral-400">
                        {item.parent}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          );
        });
      })()}
      {/* pick ANY date — typed input + a toggleable mini calendar */}
      <div
        className="mt-1 border-t border-neutral-100 px-3 py-1.5 dark:border-neutral-700"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2">
          <button
            data-testid="mention-date-calendar"
            onClick={() => setCalOpen((v) => !v)}
            aria-label="Pick from calendar"
            className="shrink-0 rounded p-0.5 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600 dark:hover:bg-neutral-700"
          >
            <Calendar size={15} />
          </button>
          <input
            type="date"
            data-testid="mention-date-input"
            onChange={(e) => {
              if (e.target.value) onPick(dateItem(e.target.value));
            }}
            className="flex-1 bg-transparent text-sm text-neutral-700 outline-none dark:text-neutral-200"
          />
        </div>
        {calOpen && (
          <div className="mt-1">
            <MonthGrid idBase="mention" selected="" onPick={(d) => onPick(dateItem(d))} />
          </div>
        )}
      </div>
    </div>
  );
}
