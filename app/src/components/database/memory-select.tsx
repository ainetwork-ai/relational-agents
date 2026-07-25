"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";

export interface NsOption {
  value: string;
  label: string;
  /** small leading glyph (property type icon) */
  icon?: string;
  /** render the label as a colored tag (select options) */
  colorClass?: string;
}

/** Property-type glyphs for menu rows (Notion shows an icon per type). */
export const TYPE_ICON: Record<string, string> = {
  title: "Aa", text: "Aa", number: "#", select: "▾", multi_select: "≔",
  status: "◐", date: "🗓", person: "ᴘ", checkbox: "☑", url: "🔗",
  email: "@", phone: "☏", relation: "↗", formula: "Σ", rollup: "⊕",
  files: "📎", created_time: "◷", last_edited_time: "◷",
  created_by: "ᴘ", last_edited_by: "ᴘ",
};

/** Notion-style dropdown replacing native <select>: its own popover menu with
 *  a search box (when long), type icons and colored tags (R039 / scienario 4).
 *  Menu rows carry `data-testid={testid}-opt-{value}`. */
export function MemorySelect({
  testid,
  value,
  options,
  onChange,
  placeholder = "Select…",
  searchable,
}: {
  testid: string;
  value: string | undefined;
  options: NsOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  searchable?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const search = searchable ?? options.length > 6;

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const current = options.find((o) => o.value === value);
  const shown = q
    ? options.filter((o) => o.label.toLowerCase().includes(q.toLowerCase()))
    : options;

  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        data-testid={testid}
        data-value={value ?? ""}
        onClick={() => {
          setOpen((v) => !v);
          setQ("");
        }}
        className="flex items-center gap-1 rounded border border-neutral-200 bg-white px-1.5 py-1 text-xs text-neutral-700 outline-none hover:bg-neutral-50 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-200 dark:hover:bg-neutral-800"
      >
        {current?.icon && <span className="text-[10px] text-neutral-400">{current.icon}</span>}
        <span
          className={
            current?.colorClass
              ? `rounded px-1 py-0.5 text-xs font-medium ${current.colorClass}`
              : "max-w-32 truncate"
          }
        >
          {current?.label ?? placeholder}
        </span>
        <ChevronDown size={11} className="shrink-0 text-neutral-400" />
      </button>
      {open && (
        <div className="popover-anim absolute left-0 top-full z-50 mt-0.5 max-h-56 w-48 overflow-y-auto rounded-lg border border-neutral-200 bg-white p-1 shadow-xl dark:border-neutral-700 dark:bg-neutral-800">
          {search && (
            <input
              autoFocus
              data-testid={`${testid}-search`}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search…"
              className="mb-1 w-full rounded border border-neutral-200 px-1.5 py-1 text-xs outline-none dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-200"
            />
          )}
          {shown.length === 0 && (
            <p className="px-2 py-1 text-xs text-neutral-400">No results</p>
          )}
          {shown.map((o) => (
            <button
              key={o.value}
              type="button"
              data-testid={`${testid}-opt-${o.value}`}
              onClick={() => {
                onChange(o.value);
                setOpen(false);
                setQ("");
              }}
              className="flex w-full items-center gap-2 rounded px-2 py-1 text-left hover:bg-neutral-100 dark:hover:bg-neutral-700"
            >
              {o.icon && (
                <span className="w-4 shrink-0 text-center text-[10px] text-neutral-400">
                  {o.icon}
                </span>
              )}
              <span
                className={
                  o.colorClass
                    ? `rounded px-1.5 py-0.5 text-xs font-medium ${o.colorClass}`
                    : "truncate text-xs text-neutral-700 dark:text-neutral-200"
                }
              >
                {o.label}
              </span>
              {o.value === value && <span className="ml-auto text-xs text-blue-500">✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
