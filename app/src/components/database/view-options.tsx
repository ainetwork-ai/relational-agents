"use client";

import {useRef, useState} from "react";
import { useDismiss } from "@/hooks/use-dismiss";
import { useAnchored } from "@/hooks/use-anchored";
import { createPortal } from "react-dom";
import { Settings2, Eye, EyeOff } from "lucide-react";
import { useDb } from "./database-block";
import { isGroupable } from "@/lib/db-values";
import { useT } from "@/i18n/provider";

/** Per-view property visibility: toggle any property shown/hidden in the
 * active view. Persisted in ViewConfig.hiddenProperties; every view
 * (table/board/list/gallery/calendar) respects it. */
export function ViewOptions() {
  const db = useDb();
  const t = useT();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const hidden = db.activeView.config.hiddenProperties ?? [];

  useDismiss(open, () => {
    setOpen(false);
  }, ref, popRef);

  function toggle(propId: string) {
    const set = new Set(hidden);
    if (set.has(propId)) set.delete(propId);
    else set.add(propId);
    db.patchView({ ...db.activeView.config, hiddenProperties: [...set] });
  }

 // portalled and placed — inside the page's scroller this popover was cut off
 // when its trigger sat low in the window
  useAnchored(open, btnRef, popRef, { align: "end" });

  return (
    <div ref={ref} className="relative">
      <button
        ref={btnRef}
        data-testid="db-view-options"
        onClick={() => setOpen((v) => !v)}
        data-tip={t("View settings")}
        aria-label={t("Properties")}
                // 28×28, radius 6, 16px icon — and ACTIVE means a blue icon, not a
        // blue chip: the original never fills these (measured toolbar, six of
        // them at a 28px pitch)
        className={`flex h-7 w-7 items-center justify-center rounded-[6px] transition-colors ${
          hidden.length
            ? "text-[rgb(39,131,222)] hover:bg-[rgba(33,27,23,0.05)]"
            : "text-[rgb(90,90,88)] hover:bg-[rgba(33,27,23,0.05)] dark:text-neutral-400 dark:hover:bg-neutral-800"
        }`}
      >
        <Settings2 size={16} />
      </button>
      {open &&
        createPortal(
          <div ref={popRef}
            style={{ visibility: "hidden" }}
            className="popover-anim fixed z-50 overflow-y-auto w-52 rounded-lg border border-neutral-200 bg-white p-1 shadow-xl dark:border-neutral-700 dark:bg-neutral-800">
          {/* Group by lives in view options — not a strip above the view */}
          <span className="block px-2 py-1 text-[10px] uppercase tracking-wide text-neutral-400">
            {t("Group")}
          </span>
          <select
            data-testid="db-group-by-select"
            value={db.activeView.config.groupByPropertyId ?? ""}
            onChange={(e) =>
              db.patchView({
                ...db.activeView.config,
                groupByPropertyId: e.target.value || undefined,
              })
            }
            className="mx-1 mb-1 w-[calc(100%-0.5rem)] rounded border border-neutral-200 bg-transparent px-1 py-0.5 text-xs text-neutral-600 outline-none dark:border-neutral-600 dark:text-neutral-300"
          >
            <option value="">{t("None")}</option>
            {db.properties
              .filter((p) => isGroupable(p) || (p.config.options?.length ?? 0) > 0)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
          </select>
          <span className="block px-2 py-1 text-[10px] uppercase tracking-wide text-neutral-400">
            {t("Properties")}
          </span>
          {db.properties.map((p) => {
            const isHidden = hidden.includes(p.id);
            return (
              <button
                key={p.id}
                data-testid={`db-prop-visToggle-${p.id}`}
                onClick={() => toggle(p.id)}
                className="flex w-full items-center justify-between rounded px-2 py-1 text-left text-sm text-neutral-700 transition-colors hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-700"
              >
                <span className="truncate">{p.name}</span>
                {isHidden ? (
                  <EyeOff size={13} className="text-neutral-400" />
                ) : (
                  <Eye size={13} className="text-blue-500" />
                )}
              </button>
            );
          })}
        </div>,
          document.body
        )}
    </div>
  );
}
