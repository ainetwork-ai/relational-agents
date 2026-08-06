"use client";

import { useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { SlidersHorizontal } from "lucide-react";
import type { DbProperty } from "@/lib/db/schema";
import { useAnchored } from "@/hooks/use-anchored";
import { useDismiss } from "@/hooks/use-dismiss";
import { useDb } from "./database-block";
import { OptionChip } from "./option-chip";

// ===========================================================================
// The menu a Status cell opens.
//
// Every number here was READ OFF the original with the cell open, not chosen:
// `e2e/fixtures/notion-status-dropdown.json` holds the same measurements, and
// `e2e/status-dropdown.check.mjs` re-measures ours against it. Ours used to be
// a 176px list hanging below the cell with a "Clear" row and a per-option
// group <select> that the original has nothing like.
//
// The shape, in the original's own pixels (box is 240 wide, positions are
// relative to its top-left):
//
//   0    search bar, 240×39, bg rgba(242,241,238,.6), radius 6, padding 4
//        └ the current value as a chip at x=12,y=9 then the text caret
//   49   group label — 12px/500, rgb(125,122,117), x=12
//   72   option row 232×28 at x=4, radius 6; chip at x=12
//   109  1px divider, x=12 w=216, rgba(42,28,0,.07)   ← 9px after the group
//   …    (…, 13px below a divider comes the next label)
//   339  1px divider, 4px after the last option
//   340  footer row 240×36: sliders icon 20×20 at x=12, "속성 편집" at x=40/14px
//
// While a query is typed the group labels disappear entirely and the list is
// just the matches, 4px under the bar (measured with "ho" → only Hold).
//
// What the original does NOT have, and so neither do we any more: a Clear row
// (hovering the chip in the search bar shows no ✕), and a create-option row
// (typing "zzq" leaves the bar and 속성 편집 with nothing between them).
// ===========================================================================

const SHADOW =
  "rgba(25, 25, 25, 0.05) 0px 20px 24px 0px, rgba(25, 25, 25, 0.027) 0px 5px 8px 0px, rgba(42, 28, 0, 0.07) 0px 0px 0px 1px";
const HOVER = "rgba(33, 27, 23, 0.051)"; // the row highlight, read off the keyboard-focused match
const RULE = "rgba(42, 28, 0, 0.07)";
const LABEL = "rgb(125, 122, 117)";

/** The three canonical group names, as the original's Korean UI writes them. */
const GROUP_LABEL: Record<string, string> = {
  "To-do": "할 일",
  "In progress": "진행 중",
  Complete: "완료",
};

interface Opt {
  id: string;
  name: string;
  color?: string;
}

export function StatusPicker({
  prop,
  value,
  slug,
  anchorRef,
  onSet,
  onClose,
}: {
  prop: DbProperty;
  value: unknown;
  /** `${rowId}-${propId}`, so tests can address this cell's menu */
  slug: string;
  /** the CELL, not the chip — the menu covers the cell's own top-left corner */
  anchorRef: React.RefObject<HTMLElement | null>;
  onSet: (v: unknown) => void;
  onClose: () => void;
}) {
  const db = useDb();
  const popRef = useRef<HTMLDivElement>(null);
  const [q, setQ] = useState("");
  // -1, not 0: with nothing typed the original highlights NO row (every option
  // row reads transparent). The highlight is the keyboard cursor, and it only
  // exists once a query narrows the list.
  const [active, setActive] = useState(-1);

  useAnchored(true, anchorRef, popRef, { cover: true });
  useDismiss(true, onClose, anchorRef, popRef);

  const options: Opt[] = useMemo(() => prop.config.options ?? [], [prop.config.options]);
  const rawGroups = prop.config.optionGroups;
  const current = options.find((o) => o.id === value);

  const query = q.trim().toLowerCase();
  const matches = useMemo(
    () => (query ? options.filter((o) => o.name.toLowerCase().includes(query)) : []),
    [options, query]
  );

  // ungrouped options still have to appear: anything no group claims is listed
  // under a last, unlabelled section rather than silently dropped
  const sections = useMemo(() => {
    const groups = rawGroups ?? [];
    const claimed = new Set(groups.flatMap((g) => g.optionIds));
    const rest = options.filter((o) => !claimed.has(o.id));
    return [
      ...groups.map((g) => ({
        id: g.id,
        label: GROUP_LABEL[g.name] ?? g.name,
        options: g.optionIds.map((id) => options.find((o) => o.id === id)).filter(Boolean) as Opt[],
      })),
      ...(rest.length ? [{ id: "__rest", label: "", options: rest }] : []),
    ].filter((s) => s.options.length > 0);
  }, [rawGroups, options]);

  const flat = query ? matches : sections.flatMap((s) => s.options);

  const choose = (o: Opt) => {
    onSet(o.id);
    onClose();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => {
        const n = flat.length;
        if (!n) return -1;
        if (i < 0) return e.key === "ArrowDown" ? 0 : n - 1;
        return (i + (e.key === "ArrowDown" ? 1 : n - 1)) % n;
      });
    } else if (e.key === "Enter") {
      e.preventDefault();
      const o = flat[active];
      if (o) choose(o);
    }
  };

  const row = (o: Opt, i: number) => (
    <button
      key={o.id}
      data-testid={`db-option-${prop.id}-${o.id}`}
      onClick={() => choose(o)}
      onMouseEnter={() => setActive(i)}
      style={{ background: i === active ? HOVER : undefined }}
      className="mx-1 flex h-7 items-center rounded-[6px] px-2 text-left"
    >
      <OptionChip color={o.color ?? "gray"} title={o.name} dot>
        {o.name}
      </OptionChip>
    </button>
  );

  return createPortal(
    <div
      ref={popRef}
      data-testid={`db-status-popover-${slug}`}
      onKeyDown={onKeyDown}
      style={{
        visibility: "hidden",
        width: 240,
        boxShadow: SHADOW,
        // the original's box starts one pixel up and left of the cell — its 1px
        // ring sits ON the cell border rather than beside it
        transform: "translate(-1px, -1px)",
      }}
      className="popover-anim fixed z-50 flex flex-col overflow-y-auto rounded-[6px] bg-white dark:bg-neutral-800"
    >
      {/* search bar: the chosen value as a chip, then the caret */}
      <div className="shrink-0 rounded-[6px] bg-[rgba(242,241,238,0.6)] p-1 dark:bg-neutral-700/40">
        <div className="flex max-h-[240px] flex-wrap items-center gap-1.5 overflow-y-auto px-2 pb-[6px] pt-[5px]">
          {current && (
            <OptionChip color={current.color ?? "gray"} title={current.name} dot>
              {current.name}
            </OptionChip>
          )}
          <input
            data-testid={`db-status-search-${slug}`}
            autoFocus
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setActive(0);
            }}
            className="h-5 min-w-[40px] flex-1 bg-transparent text-[14px] leading-5 text-[rgb(44,44,43)] outline-none dark:text-neutral-200"
          />
        </div>
      </div>

      {query ? (
        matches.length > 0 && (
          <div className="flex flex-col pt-1">{matches.map((o, i) => row(o, i))}</div>
        )
      ) : (
        <div className="flex flex-col">
          {sections.map((s, si) => {
            const before = sections.slice(0, si).reduce((n, x) => n + x.options.length, 0);
            return (
              <div key={s.id} className="flex flex-col">
                {si > 0 && <div className="mx-3 mt-[9px] h-px" style={{ background: RULE }} />}
                {/* the label's own strut has to be 14px: with the panel's inherited
                    line-height it sat 5px lower and pushed every row below it down */}
                {s.label && (
                  <div className={`px-3 text-[12px] leading-[14px] ${si === 0 ? "mt-[10px]" : "mt-[13px]"}`}>
                    <span
                      className="text-[12px] font-medium leading-[14px]"
                      style={{ color: LABEL }}
                    >
                      {s.label}
                    </span>
                  </div>
                )}
                <div className="mt-[9px] flex flex-col gap-px">
                  {s.options.map((o, i) => row(o, before + i))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {flat.length > 0 && <div className="mx-3 mt-1 h-px shrink-0" style={{ background: RULE }} />}
      <div className="shrink-0 py-1">
        <button
          data-testid={`db-status-edit-property-${prop.id}`}
          onClick={() => {
            db.editProperty(prop.id);
            onClose();
          }}
          className="mx-1 flex h-7 w-[232px] items-center gap-2 rounded-[6px] px-2 text-left hover:bg-[rgba(33,27,23,0.051)] dark:hover:bg-neutral-700"
        >
          <SlidersHorizontal size={20} strokeWidth={1.6} className="shrink-0 text-[rgb(44,44,43)] dark:text-neutral-200" />
          <span className="text-[14px] text-[rgb(44,44,43)] dark:text-neutral-200">속성 편집</span>
        </button>
      </div>
    </div>,
    document.body
  );
}
