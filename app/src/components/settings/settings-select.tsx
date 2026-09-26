"use client";

import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check } from "lucide-react";
import { useAnchored } from "@/hooks/use-anchored";
import { useDismiss } from "@/hooks/use-dismiss";

export interface SelectOption<V extends string> {
  value: V;
  /** first line */
  label: string;
  /** second, dimmer line — Notion's language list shows `native / translated` */
  sub?: string;
}

/** The dropdown at the right end of a settings row. Measured on the original's
 *  Preferences › Language: button 28px tall, r6, 1px border, 14px text, chevron; the
 *  list is 216px wide with 43px two-line rows (docs/settings_my_settings.html). */
export function SettingsSelect<V extends string>({
  value,
  options,
  onChange,
  testid,
}: {
  value: V;
  options: SelectOption<V>[];
  onChange: (v: V) => void;
  testid?: string;
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  useAnchored(open, btnRef, popRef, { align: "end" });
  useDismiss(open, () => setOpen(false), btnRef, popRef);
  const current = options.find((o) => o.value === value) ?? options[0];

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        data-testid={testid}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex h-7 shrink-0 items-center gap-1 whitespace-nowrap rounded-md border max-md:h-9 border-[rgba(28,19,1,0.11)] px-2 text-sm text-neutral-800 transition-colors hover:bg-neutral-100 dark:border-neutral-600 dark:text-neutral-200 dark:hover:bg-neutral-700"
      >
        {current.label}
        <svg aria-hidden viewBox="3.06 0 9.88 16" width={10} height={16} fill="currentColor" className="text-neutral-500">
          <path d="m12.76 6.52-4.32 4.32a.62.62 0 0 1-.44.18.62.62 0 0 1-.44-.18L3.24 6.52a.63.63 0 0 1 0-.88c.24-.24.64-.24.88 0L8 9.52l3.88-3.88c.24-.24.64-.24.88 0s.24.64 0 .88" />
        </svg>
      </button>
      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={popRef}
            role="listbox"
            style={{ visibility: "hidden" }}
            className="popover-anim fixed z-[60] w-[216px] rounded-lg border border-neutral-200 bg-white p-1 shadow-lg dark:border-neutral-700 dark:bg-neutral-800"
          >
            {options.map((o) => (
              <button
                key={o.value}
                role="option"
                aria-selected={o.value === value}
                data-testid={testid ? `${testid}-${o.value}` : undefined}
                onClick={() => {
                  setOpen(false);
                  if (o.value !== value) onChange(o.value);
                }}
                className={`flex w-full items-center gap-2 rounded-md px-2 text-left transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-700 ${
                  o.sub ? "h-[43px]" : "h-7"
                }`}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-neutral-800 dark:text-neutral-200">{o.label}</span>
                  {o.sub && <span className="block truncate text-xs text-neutral-500">{o.sub}</span>}
                </span>
                {o.value === value && <Check size={14} className="shrink-0 text-neutral-700 dark:text-neutral-300" />}
              </button>
            ))}
          </div>,
          document.body
        )}
    </>
  );
}
