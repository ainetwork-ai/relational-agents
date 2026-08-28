"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { useDismiss } from "@/hooks/use-dismiss";
import { useAnchored } from "@/hooks/use-anchored";
import type { TableData } from "@/lib/db/schema";
import { sanitizeInline } from "@/lib/rich-text";
import { caretOffset, caretOnEdgeLine, caretRect, setCaret, setCaretAtX } from "@/lib/editor/caret";
import { useT } from "@/i18n/provider";
import { useEditor, type EBlock } from "./block-editor";

/** Inline page links in cells: `[Label](/p/<uuid>)` renders as a mention chip
 * while the cell is unfocused; the raw source comes back while editing. */
const CELL_LINK_RE = /\[([^\]]+)\]\((\/p\/[0-9a-fA-F-]{36})\)/g;

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const chipify = (html: string) =>
  html.replace(
    CELL_LINK_RE,
    (_m, label, href) =>
      `<a href="${href}" class="mention" data-mention-type="page" contenteditable="false">${label}</a>`
  );

/** What a cell shows while unfocused. Cells edited since inline formatting
 * arrived carry their own sanitized html; older ones are plain text. */
function cellHtml(raw: string, html?: string): string {
  return chipify(html != null ? sanitizeInline(html) : escapeHtml(raw));
}

/** Chips back to their `[Label](/p/…)` source, leaving b/i/u/code alone —
 * the swap that lets a mention be edited as text. */
function chipsToSource(el: HTMLElement) {
  for (const a of [...el.querySelectorAll("a.mention")]) {
    const href = a.getAttribute("href") ?? "";
    a.replaceWith(document.createTextNode(`[${a.textContent ?? ""}](${href})`));
  }
}

const EMPTY: TableData = { cells: [["", ""], ["", ""]], headerRow: true };

/** Notion's cell-selection blue (measured: rgb(39, 131, 222), 2px, radius 2). */
const SEL_COLOR = "rgb(39, 131, 222)";
/** Grip metrics, all measured — see e2e/fixtures/notion-table-grip.json.
 * The grey line lives on the row/column's outer border; hovering it swaps in a
 * six-dot button, and clicking that selects the whole row/column. */
const GRIP = {
  lineColor: "rgb(173, 169, 163)",
  lineLong: 18,
  lineThick: 2,
  hit: 8,
  btnLong: 22,
  btnShort: 14,
  btnBg: "rgb(255, 255, 255)",
  btnBorder: "rgb(230, 229, 227)",
} as const;

/** Notion's own six-dot glyph: 20×20 viewBox, r=1.25 dots at x 7.5/12.5 and
 * y 4/10/16 — 2 columns × 3 rows, rotated for the column grip. */
const DOTS_PATH =
  "M6.25 4a1.25 1.25 0 1 0 2.5 0 1.25 1.25 0 0 0-2.5 0m5 0a1.25 1.25 0 1 0 2.5 0 1.25 1.25 0 0 0-2.5 0m1.25 7.25a1.25 1.25 0 1 1 0-2.5 1.25 1.25 0 0 1 0 2.5M6.25 10a1.25 1.25 0 1 0 2.5 0 1.25 1.25 0 0 0-2.5 0m6.25 7.25a1.25 1.25 0 1 1 0-2.5 1.25 1.25 0 0 1 0 2.5M6.25 16a1.25 1.25 0 1 0 2.5 0 1.25 1.25 0 0 0-2.5 0";

type GripKind = "col" | "row";
type Grip = { kind: GripKind; i: number };

type Cell = { r: number; c: number };
/** anchor + focus cell, like a text selection's two ends */
type CellRange = { a: Cell; f: Cell };

const normalize = (g: CellRange) => ({
  r1: Math.min(g.a.r, g.f.r),
  c1: Math.min(g.a.c, g.f.c),
  r2: Math.max(g.a.r, g.f.r),
  c2: Math.max(g.a.c, g.f.c),
});

/**
 * "simple table" block: a static grid of text cells with add/remove
 * row & column and an optional header row/column.
 *
 * Caret and selection behave like the original's (measured with
 * e2e/fixtures/notion-table-cellnav.json):
 *  · → at the end of a cell goes to the next cell's start, ← at the start to
 *    the previous cell's end, wrapping across rows; at the grid's ends the
 *    caret leaves for the block before/after the table
 *  · ↑↓ move between the cell's own lines first, then to the cell above/below
 *    at the same x
 *  · Tab / Shift+Tab land at the target cell's **end**; Tab in the last cell
 *    does nothing (it does not add a row)
 *  · the cell holding the caret wears a 2px blue border; a drag that crosses
 *    cells selects a **cell range** instead of text, and Shift+arrows or
 *    Escape build the same selection from the keyboard
 */
export function TableBlock({ block }: { block: EBlock }) {
  const editor = useEditor();
  const t = useT();
  const table = block.content.table ?? EMPTY;
  const cells = table.cells.length ? table.cells : EMPTY.cells;
  const nRows = cells.length;
  const nCols = cells[0]?.length ?? 0;

  const wrapRef = useRef<HTMLDivElement>(null);
  const cellEls = useRef(new Map<string, HTMLDivElement>());
  const key = (r: number, c: number) => `${r}-${c}`;
  const cellAt = useCallback(
    (r: number, c: number) => cellEls.current.get(`${r}-${c}`) ?? null,
    []
  );

  /** cell holding the caret — wears the blue border */
  const [active, setActive] = useState<Cell | null>(null);
  /** cell-range selection (text selection is dropped while it lives) */
  const [range, setRange] = useState<CellRange | null>(null);
  /** the extend handle only rides a selection made with the mouse */
  const [handle, setHandle] = useState(false);
  /** cell the pointer is over — decides which grey grip lines show */
  const [hoverCell, setHoverCell] = useState<Cell | null>(null);
  /** grip line the pointer is on — it becomes the six-dot button */
  const [gripHover, setGripHover] = useState<Grip | null>(null);
  /** grip whose dropdown is open (its button stays blue while it is) */
  const [gripMenu, setGripMenu] = useState<Grip | null>(null);
 // the border/handle are positioned imperatively — they are a readout of the
 // laid-out grid, not state React should re-render for
  const borderRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<HTMLDivElement>(null);

  function commit(next: TableData) {
    editor.updateTable(block.id, next);
  }

  /** html grid for the whole table — a cell that never carried html gets its
   * plain text escaped, NOT an empty string (that would blank the cell). */
  const htmlGridOf = (source: string[][]) =>
    source.map((row, i) => row.map((text, j) => table.html?.[i]?.[j] ?? escapeHtml(text)));

  const setCell = useCallback(
    (r: number, c: number, value: string, html: string) => {
      const copy = cells.map((row) => row.slice());
      copy[r][c] = value;
      const htmlGrid = htmlGridOf(cells);
      htmlGrid[r][c] = html;
      commit({ ...table, cells: copy, html: htmlGrid });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cells, table]
  );

  function addRow() {
    commit({
      ...table,
      cells: [...cells.map((r) => r.slice()), Array(nCols).fill("")],
      html: table.html ? [...table.html.map((r) => r.slice()), Array(nCols).fill("")] : undefined,
    });
  }
  function addCol() {
    commit({
      ...table,
      cells: cells.map((r) => [...r, ""]),
      html: table.html?.map((r) => [...r, ""]),
    });
  }
  function delRow(r: number) {
    if (nRows <= 1) return;
    setRange(null);
    commit({
      ...table,
      cells: cells.filter((_, i) => i !== r),
      html: table.html?.filter((_, i) => i !== r),
    });
  }
  function delCol(c: number) {
    if (nCols <= 1) return;
    setRange(null);
    commit({
      ...table,
      cells: cells.map((row) => row.filter((_, i) => i !== c)),
      html: table.html?.map((row) => row.filter((_, i) => i !== c)),
    });
  }

 // --- row/column operations behind the grip menu ---------------------------

  /** insert a row at `at`, copying `from` when duplicating */
  function insertRow(at: number, from?: number) {
    const blank = Array(nCols).fill("");
    const rowOf = (grid?: string[][]) => (from != null ? (grid?.[from] ?? blank).slice() : blank.slice());
    const nextCells = cells.map((r) => r.slice());
    nextCells.splice(at, 0, rowOf(cells));
    const nextHtml = table.html
      ? (() => { const h = table.html!.map((r) => r.slice()); h.splice(at, 0, rowOf(table.html)); return h; })()
      : undefined;
    setRange(null);
    commit({ ...table, cells: nextCells, html: nextHtml });
  }

  /** insert a column at `at`, copying `from` when duplicating */
  function insertCol(at: number, from?: number) {
    const put = (row: string[]) => {
      const next = row.slice();
      next.splice(at, 0, from != null ? (row[from] ?? "") : "");
      return next;
    };
    setRange(null);
    commit({ ...table, cells: cells.map(put), html: table.html?.map(put) });
  }

  /** blank every cell of a row / column (the menu's "콘텐츠 삭제") */
  function clearLine(kind: GripKind, i: number) {
    const copy = cells.map((row) => row.slice());
    const htmlGrid = htmlGridOf(cells);
    for (let r = 0; r < nRows; r++)
      for (let c = 0; c < nCols; c++) {
        if (kind === "row" ? r !== i : c !== i) continue;
        copy[r][c] = "";
        htmlGrid[r][c] = "";
        const el = cellAt(r, c);
        if (el) { el.dataset.raw = ""; el.innerHTML = ""; }
      }
    commit({ ...table, cells: copy, html: htmlGrid });
  }

 // --- selection overlay ----------------------------------------------------

  const paint = useCallback(() => {
    const wrap = wrapRef.current;
    const border = borderRef.current;
    const target = range
      ? normalize(range)
      : active
        ? { r1: active.r, c1: active.c, r2: active.r, c2: active.c }
        : null;
    if (!border) return;
    const a = target && cellAt(target.r1, target.c1);
    const b = target && cellAt(target.r2, target.c2);
    if (!wrap || !a || !b) {
      border.style.display = "none";
      if (handleRef.current) handleRef.current.style.display = "none";
      return;
    }
    const w = wrap.getBoundingClientRect();
    const ab = a.getBoundingClientRect();
    const bb = b.getBoundingClientRect();
 // the border sits on the grid lines — 1px outside the cells' union
    const box = {
      left: ab.left - w.left - 1,
      top: ab.top - w.top - 1,
      width: bb.right - ab.left + 2,
      height: bb.bottom - ab.top + 2,
    };
    border.style.display = "block";
    border.style.left = `${box.left}px`;
    border.style.top = `${box.top}px`;
    border.style.width = `${box.width}px`;
    border.style.height = `${box.height}px`;
    const h = handleRef.current;
    if (h) {
      h.style.display = range && handle ? "block" : "none";
      h.style.left = `${box.left + box.width - 4}px`;
      h.style.top = `${box.top + box.height / 2 - 6}px`;
    }
  }, [range, active, handle, cellAt]);

  useLayoutEffect(() => {
    paint();
  }, [paint, block.version, nRows, nCols, cells]);
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const ro = new ResizeObserver(() => paint());
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [paint]);

  /** drop the DOM text selection — a cell range replaces it, as in the original */
  const dropTextSelection = () => {
    const sel = window.getSelection();
    if (sel && sel.rangeCount) sel.removeAllRanges();
  };

  const selectCells = useCallback((g: CellRange, withHandle = false) => {
    setRange(g);
    setHandle(withHandle);
    setActive(null);
    dropTextSelection();
 // park focus on the grid itself: a focused cell makes the browser reinstate
 // a caret (and with it a text selection) the moment we drop ours
    const wrap = wrapRef.current;
    if (wrap && document.activeElement !== wrap) wrap.focus({ preventScroll: true });
  }, []);

  /** put the caret in a cell, clearing any cell range */
  const enterCell = useCallback(
    (r: number, c: number, where: "start" | "end" | { x: number; edge: "first" | "last" }) => {
      const el = cellAt(r, c);
      if (!el) return false;
      setRange(null);
      setHandle(false);
      setActive({ r, c });
      if (typeof where === "string") setCaret(el, where);
      else setCaretAtX(el, where.x, where.edge);
      return true;
    },
    [cellAt]
  );

  const nextCell = (r: number, c: number): Cell | null =>
    c + 1 < nCols ? { r, c: c + 1 } : r + 1 < nRows ? { r: r + 1, c: 0 } : null;
  const prevCell = (r: number, c: number): Cell | null =>
    c > 0 ? { r, c: c - 1 } : r > 0 ? { r: r - 1, c: nCols - 1 } : null;

  /** clear the text of every cell in the range (the original's "콘텐츠 삭제") */
  const clearRange = (g: CellRange) => {
    const { r1, c1, r2, c2 } = normalize(g);
    const copy = cells.map((row) => row.slice());
    const htmlGrid = htmlGridOf(cells);
    for (let r = r1; r <= r2; r++)
      for (let c = c1; c <= c2; c++) {
        copy[r][c] = "";
        htmlGrid[r][c] = "";
        const el = cellAt(r, c);
        if (el) {
          el.dataset.raw = "";
          el.innerHTML = "";
        }
      }
    commit({ ...table, cells: copy, html: htmlGrid });
  };

 // --- keys inside a cell ---------------------------------------------------

  /** Extend (or start) the cell range by one cell in a direction. */
  const extend = (from: Cell, dr: number, dc: number) => {
    const anchor = range?.a ?? from;
    const cur = range?.f ?? from;
    const f = {
      r: Math.min(Math.max(cur.r + dr, 0), nRows - 1),
      c: Math.min(Math.max(cur.c + dc, 0), nCols - 1),
    };
    selectCells({ a: anchor, f });
  };

  /** Keys while a cell range is up — the grid itself has focus then, not a cell.
   * Arrows walk/extend the range, Backspace clears the cells' contents. */
  const onRangeKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!range) return;
    const stop = () => {
      e.preventDefault();
      e.stopPropagation();
    };
    const DIRS: Record<string, [number, number]> = {
      ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0],
    };
    const d = DIRS[e.key];
    if (d) {
      stop();
      if (e.shiftKey) extend(range.f, d[0], d[1]);
      else {
        const to = {
          r: Math.min(Math.max(range.f.r + d[0], 0), nRows - 1),
          c: Math.min(Math.max(range.f.c + d[1], 0), nCols - 1),
        };
        enterCell(to.r, to.c, d[1] < 0 ? "start" : "end");
      }
      return;
    }
    if (e.key === "Escape") {
      stop();
      setRange(null);
      setHandle(false);
      return;
    }
    if (e.key === "Backspace" || e.key === "Delete") {
      stop();
      clearRange(range);
    }
  };

  const onCellKeyDown = (e: React.KeyboardEvent<HTMLDivElement>, r: number, c: number) => {
    const el = e.currentTarget;
    const sel = window.getSelection();
    const hasText = !!sel && sel.rangeCount > 0 && !sel.isCollapsed;
    const len = el.innerText.replace(/\n+$/, "").length;
    const off = sel && sel.rangeCount ? caretOffset(el) : 0;
    const stop = () => {
      e.preventDefault();
      e.stopPropagation();
    };

    if (range) {
      onRangeKeyDown(e);
      if (e.defaultPrevented) return;
    }

    if (e.key === "Escape") {
      stop();
      selectCells({ a: { r, c }, f: { r, c } });
      return;
    }

    if (e.key === "Tab") {
      stop();
      const to = e.shiftKey ? prevCell(r, c) : nextCell(r, c);
      if (to) enterCell(to.r, to.c, "end");
      return;
    }

    if (e.key === "Enter" && !e.shiftKey) {
      stop();
      return;
    }

    if (e.key === "ArrowRight" && !hasText && off === len) {
      if (e.shiftKey) {
        stop();
        extend({ r, c }, 0, 1);
        return;
      }
      stop();
      const to = nextCell(r, c);
      if (to) enterCell(to.r, to.c, "start");
      else editor.focusNeighbour(block.id, 1);
      return;
    }

    if (e.key === "ArrowLeft" && !hasText && off === 0) {
      if (e.shiftKey) {
        stop();
        extend({ r, c }, 0, -1);
        return;
      }
      stop();
      const to = prevCell(r, c);
      if (to) enterCell(to.r, to.c, "end");
      else editor.focusNeighbour(block.id, -1);
      return;
    }

    if ((e.key === "ArrowDown" || e.key === "ArrowUp") && !hasText) {
      const down = e.key === "ArrowDown";
      if (!caretOnEdgeLine(el, down ? "last" : "first")) return; // another line in this cell
      if (e.shiftKey) {
        stop();
        extend({ r, c }, down ? 1 : -1, 0);
        return;
      }
      const x = caretRect()?.left ?? el.getBoundingClientRect().left;
      stop();
      const to = down ? (r + 1 < nRows ? { r: r + 1, c } : null) : r > 0 ? { r: r - 1, c } : null;
      if (to) enterCell(to.r, to.c, { x, edge: down ? "first" : "last" });
      else editor.focusNeighbour(block.id, down ? 1 : -1);
      return;
    }
  };

 // --- drag: inside a cell selects text, across cells selects cells ---------

  const cellFromPoint = (x: number, y: number): Cell | null => {
    const el = document.elementFromPoint(x, y) as HTMLElement | null;
    const cell = el?.closest?.(`[data-testid^="table-cell-${block.id}-"]`) as HTMLElement | null;
    if (!cell) return null;
    const parts = cell.getAttribute("data-testid")!.split("-");
    return { r: Number(parts[parts.length - 2]), c: Number(parts[parts.length - 1]) };
  };

  const startDrag = (anchor: Cell, mode: "cells" | "maybe") => {
    let crossed = mode === "cells";
    const move = (ev: MouseEvent) => {
      const at = cellFromPoint(ev.clientX, ev.clientY);
      if (!at) return;
      if (!crossed && at.r === anchor.r && at.c === anchor.c) return; // still plain text drag
      crossed = true;
      ev.preventDefault();
      selectCells({ a: anchor, f: at }, true);
    };
    const up = () => {
      window.removeEventListener("mousemove", move, true);
      window.removeEventListener("mouseup", up, true);
    };
    window.addEventListener("mousemove", move, true);
    window.addEventListener("mouseup", up, true);
  };

 // A caret back inside a cell (a click, or setCaret from a neighbouring
 // block) and a cell range cannot both be live — the caret wins.
  useEffect(() => {
    if (!range) return;
    const onSelChange = () => {
      if (document.activeElement === wrapRef.current) return; // our own range is up
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return;
      const node = sel.anchorNode;
      const el = node && (node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as HTMLElement));
      if (el?.closest?.(`[data-testid^="table-cell-${block.id}-"]`)) {
        setRange(null);
        setHandle(false);
      }
    };
    document.addEventListener("selectionchange", onSelChange);
    return () => document.removeEventListener("selectionchange", onSelChange);
  }, [range, block.id]);

 // a click outside the table (or Escape) drops the cell selection
  const dropRange = useCallback(() => {
    setRange(null);
    setHandle(false);
  }, []);
 // while the grip's dropdown is open Escape belongs to the menu, not to us —
 // both would otherwise claim the same keystroke in the capture phase
  useDismiss(!!range && !gripMenu, dropRange, wrapRef);

  const sel = range ? normalize(range) : null;

  /** grip lines are lit for the pointer's row+column, and for every row and
   * column a cell selection covers (measured: the original lights all of them) */
  const litCols = new Set<number>();
  const litRows = new Set<number>();
  if (sel) {
    for (let c = sel.c1; c <= sel.c2; c++) litCols.add(c);
    for (let r = sel.r1; r <= sel.r2; r++) litRows.add(r);
  } else if (hoverCell) {
    litCols.add(hoverCell.c);
    litRows.add(hoverCell.r);
  }
  for (const g of [gripHover, gripMenu]) if (g) (g.kind === "col" ? litCols : litRows).add(g.i);

  /** a grip's button is blue once its whole row/column is the selection */
  const gripSelected = (kind: GripKind, i: number) =>
    !!sel &&
    (kind === "col"
      ? sel.c1 === i && sel.c2 === i && sel.r1 === 0 && sel.r2 === nRows - 1
      : sel.r1 === i && sel.r2 === i && sel.c1 === 0 && sel.c2 === nCols - 1);

  const openGrip = (kind: GripKind, i: number) => {
    selectCells(
      kind === "col"
        ? { a: { r: 0, c: i }, f: { r: nRows - 1, c: i } }
        : { a: { r: i, c: 0 }, f: { r: i, c: nCols - 1 } }
    );
    setGripMenu({ kind, i });
  };

  return (
    <div data-testid={`table-${block.id}`} className="my-1.5 w-full">
      {/* The scroll box is inset by 8px on every side (and pulled back out by
          the same margin) so the grips can hang over the table's outer borders:
          overflow-x:auto makes the other axis scroll too, and a 7px overhang
          would otherwise be clipped. */}
      <div
        className="-m-2 w-[calc(100%+1rem)] overflow-x-auto p-2"
        onMouseLeave={() => { setHoverCell(null); setGripHover(null); }}
      >
      <div className="flex">
        <div
          ref={wrapRef}
          tabIndex={-1}
          onKeyDown={(e) => range && onRangeKeyDown(e)}
 // the grid takes focus only to hold a cell-range selection — it is not a
 // keyboard stop, so the app's global :focus-visible ring must not draw here
          style={{ outline: "none" }}
          className="relative min-w-0 flex-1"
        >
          {cells.map((row, r) => (
            <div key={r} className="flex">
              {row.map((value, c) => (
                <div
                  key={c}
                  onMouseEnter={() => setHoverCell({ r, c })}
                  className={`relative min-w-[100px] flex-1 border border-neutral-200 dark:border-neutral-700 ${
                    c === 0 ? "" : "-ml-px"
                  } ${r === 0 ? "" : "-mt-px"} ${
                    (!!table.headerRow && r === 0) || (!!table.headerCol && c === 0)
                      ? "bg-neutral-50 font-medium dark:bg-neutral-800/60"
                      : ""
                  }`}
                >
                  <Cell
                    testid={`table-cell-${block.id}-${r}-${c}`}
                    value={value}
                    html={table.html?.[r]?.[c]}
                    version={block.version}
                    register={(el) => {
                      if (el) cellEls.current.set(key(r, c), el);
                      else cellEls.current.delete(key(r, c));
                    }}
                    onChange={(text, html) => setCell(r, c, text, html)}
                    onFocusCell={() => {
                      setActive({ r, c });
                      setRange(null);
                      setHandle(false);
                    }}
                    onBlurCell={() => setActive((cur) => (cur && cur.r === r && cur.c === c ? null : cur))}
                    onMouseDownCell={() => {
                      setRange(null);
                      setHandle(false);
                      setActive({ r, c });
                      startDrag({ r, c }, "maybe");
                    }}
                    onKeyDownCell={(e) => onCellKeyDown(e, r, c)}
                  />
                  {/* column grip: on this column's top border (first row only) */}
                  {r === 0 && (
                    <TableGrip
                      kind="col"
                      testid={`table-grip-col-${block.id}-${c}`}
                      lit={litCols.has(c)}
                      hovered={gripHover?.kind === "col" && gripHover.i === c}
                      selected={gripSelected("col", c) || (gripMenu?.kind === "col" && gripMenu.i === c)}
                      label={t("열 이동")}
                      onEnter={() => setGripHover({ kind: "col", i: c })}
                      onLeave={() => setGripHover((g) => (g?.kind === "col" && g.i === c ? null : g))}
                      onClick={() => openGrip("col", c)}
                    />
                  )}
                  {/* row grip: on this row's left border (first column only) */}
                  {c === 0 && (
                    <TableGrip
                      kind="row"
                      testid={`table-grip-row-${block.id}-${r}`}
                      lit={litRows.has(r)}
                      hovered={gripHover?.kind === "row" && gripHover.i === r}
                      selected={gripSelected("row", r) || (gripMenu?.kind === "row" && gripMenu.i === r)}
                      label={t("행 이동")}
                      onEnter={() => setGripHover({ kind: "row", i: r })}
                      onLeave={() => setGripHover((g) => (g?.kind === "row" && g.i === r ? null : g))}
                      onClick={() => openGrip("row", r)}
                    />
                  )}
                </div>
              ))}
            </div>
          ))}

          {/* caret cell / cell-range border — one border around the union */}
          <div
            ref={borderRef}
            data-testid={`table-selection-${block.id}`}
            data-range={sel ? `${sel.r1},${sel.c1},${sel.r2},${sel.c2}` : undefined}
            className="pointer-events-none absolute z-10"
            style={{
              display: "none",
              border: `2px solid ${SEL_COLOR}`,
              borderRadius: 2,
              background: "transparent",
            }}
          />
          {/* extend handle: right edge, vertically centred (6×12) */}
          <div
            ref={handleRef}
            data-testid={`table-selection-handle-${block.id}`}
            onMouseDown={(e) => {
              if (!range) return;
              e.preventDefault();
              e.stopPropagation();
              startDrag(range.a, "cells");
            }}
            className="absolute z-20 cursor-col-resize"
            style={{
              display: "none",
              width: 6,
              height: 12,
              background: "rgb(255, 255, 255)",
              border: `2px solid ${SEL_COLOR}`,
            }}
          />
        </div>
        {/* add column */}
        <button
          data-testid={`table-add-col-${block.id}`}
          onClick={addCol}
          aria-label={t("열 추가")}
          className="ml-0.5 flex w-6 shrink-0 items-center justify-center self-stretch rounded text-neutral-400 transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-800"
        >
          <Plus size={14} />
        </button>
      </div>

      {/* add row */}
      <button
        data-testid={`table-add-row-${block.id}`}
        onClick={addRow}
        aria-label={t("행 추가")}
        className="mt-0.5 flex h-5 items-center justify-center rounded text-neutral-400 transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-800"
        style={{ width: `calc(100% - 1.5rem)` }}
      >
        <Plus size={14} />
      </button>

      </div>
      {gripMenu && (
        <GripMenu
          blockId={block.id}
          grip={gripMenu}
          headerRow={!!table.headerRow}
          canDelete={gripMenu.kind === "col" ? nCols > 1 : nRows > 1}
          onClose={() => setGripMenu(null)}
          onAction={(action) => {
            const { kind, i } = gripMenu;
            setGripMenu(null);
            const col = kind === "col";
            if (action === "header") commit({ ...table, headerRow: !table.headerRow });
            else if (action === "before") { if (col) insertCol(i); else insertRow(i); }
            else if (action === "after") { if (col) insertCol(i + 1); else insertRow(i + 1); }
            else if (action === "duplicate") { if (col) insertCol(i + 1, i); else insertRow(i + 1, i); }
            else if (action === "clear") clearLine(kind, i);
            else if (action === "delete") { if (col) delCol(i); else delRow(i); }
          }}
        />
      )}
    </div>
  );
}

/**
 * One row/column grip: a grey line on the outer border that turns into a
 * six-dot button under the pointer, and blue once its row/column is selected.
 * Sizes and colours are the measured ones (fixtures/notion-table-grip.json).
 */
function TableGrip({
  kind,
  testid,
  lit,
  hovered,
  selected,
  label,
  onEnter,
  onLeave,
  onClick,
}: {
  kind: GripKind;
  testid: string;
  lit: boolean;
  hovered: boolean;
  selected: boolean;
  label: string;
  onEnter: () => void;
  onLeave: () => void;
  onClick: () => void;
}) {
  const col = kind === "col";
  const asButton = hovered || selected;
 // the hit area is a touch wider than the 2px line, like the original's 6px box
  const box = col
    ? { width: GRIP.lineLong, height: GRIP.hit, left: "50%", top: 0, translate: "-50% -50%" }
    : { width: GRIP.hit, height: GRIP.lineLong, top: "50%", left: 0, translate: "-50% -50%" };
  return (
    <div
      data-testid={testid}
      data-state={selected ? "active" : hovered ? "hover" : lit ? "idle" : "off"}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      onMouseDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick();
      }}
      className="absolute z-20 flex items-center justify-center"
      style={{ ...box, opacity: lit ? 1 : 0, pointerEvents: lit ? "auto" : "none", cursor: "pointer" }}
    >
      {asButton ? (
        <button
          type="button"
          tabIndex={-1}
          aria-label={label}
          data-testid={`${testid}-button`}
          className="flex items-center justify-center"
          style={{
            width: col ? GRIP.btnLong : GRIP.btnShort,
            height: col ? GRIP.btnShort : GRIP.btnLong,
            flexShrink: 0, // the hit box is only 18/8 wide — the button overflows it, as in the original
            borderRadius: 4,
            background: selected ? SEL_COLOR : GRIP.btnBg,
            border: `1px solid ${selected ? SEL_COLOR : GRIP.btnBorder}`,
            fill: selected ? "rgb(255, 255, 255)" : GRIP.lineColor,
            cursor: "pointer",
            transition: "opacity 0.1s ease-in-out, transform 0.1s ease-in-out",
          }}
        >
          <svg
            aria-hidden="true"
            width={16}
            height={16}
            viewBox="0 0 20 20"
            style={col ? { transform: "rotate(90deg)" } : undefined}
          >
            <path d={DOTS_PATH} />
          </svg>
        </button>
      ) : (
        <span
          data-testid={`${testid}-line`}
          style={{
            width: col ? GRIP.lineLong : GRIP.lineThick,
            height: col ? GRIP.lineThick : GRIP.lineLong,
            background: GRIP.lineColor,
            borderRadius: 4,
 // the white ring is what breaks the table's own border line around it
            boxShadow: "0 0 0 2px rgb(255, 255, 255)",
          }}
        />
      )}
    </div>
  );
}

type GripAction = "header" | "before" | "after" | "duplicate" | "clear" | "delete";

/** The grip's dropdown. Item metrics are the measured ones: 265 wide, rows 28
 * high on a 29 pitch, 6px corners, search field on top. */
function GripMenu({
  blockId,
  grip,
  headerRow,
  canDelete,
  onClose,
  onAction,
}: {
  blockId: string;
  grip: Grip;
  headerRow: boolean;
  canDelete: boolean;
  onClose: () => void;
  onAction: (a: GripAction) => void;
}) {
  const t = useT();
  const panel = useRef<HTMLDivElement>(null);
  const anchor = useRef<HTMLElement | null>(null);
  const [query, setQuery] = useState("");
  useEffect(() => {
    anchor.current = document.querySelector(
      `[data-testid="table-grip-${grip.kind}-${blockId}-${grip.i}"]`
    ) as HTMLElement | null;
  }, [blockId, grip.kind, grip.i]);
  useAnchored(true, anchor, panel);
  useDismiss(true, onClose, panel);

  const col = grip.kind === "col";
  const items: Array<{ key: GripAction; label: string; shortcut?: string; on?: boolean; danger?: boolean }> = [
    { key: "header", label: t("제목 행"), on: headerRow },
    { key: "before", label: col ? t("왼쪽에 삽입") : t("위에 삽입") },
    { key: "after", label: col ? t("오른쪽에 삽입") : t("아래에 삽입") },
    { key: "duplicate", label: t("복제"), shortcut: "⌘D" },
    { key: "clear", label: t("콘텐츠 삭제") },
    ...(canDelete ? [{ key: "delete" as GripAction, label: t("삭제") }] : []),
  ];
  const shown = query
    ? items.filter((i) => i.label.toLowerCase().includes(query.toLowerCase()))
    : items;

  return createPortal(
    <div
      ref={panel}
      data-testid={`table-grip-menu-${blockId}`}
      style={{ visibility: "hidden", width: 265 }}
      className="popover-anim fixed z-50 rounded-lg border border-neutral-200 bg-white py-1 shadow-xl dark:border-neutral-700 dark:bg-neutral-800"
    >
      <div className="px-2 pb-1 pt-1">
        <input
          autoFocus
          data-testid={`table-grip-menu-search-${blockId}`}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("작업을 검색하세요")}
          className="h-5 w-full bg-transparent text-sm text-neutral-800 outline-none placeholder:text-neutral-400 dark:text-neutral-100"
        />
      </div>
      {shown.map((item) => (
        <button
          key={item.key}
          data-testid={`table-grip-menu-item-${item.key}`}
          onClick={() => onAction(item.key)}
          className="mx-1 flex h-7 items-center justify-between rounded-md px-2 text-left text-sm text-neutral-700 hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-700"
          style={{ width: 257 }}
        >
          <span>{item.label}</span>
          {item.shortcut && <span className="text-xs text-neutral-400">{item.shortcut}</span>}
          {item.on != null && (
            <span className="text-xs text-neutral-400">{item.on ? t("켜짐") : ""}</span>
          )}
        </button>
      ))}
    </div>,
    document.body
  );
}

function Cell({
  testid,
  value,
  html,
  version,
  register,
  onChange,
  onFocusCell,
  onBlurCell,
  onMouseDownCell,
  onKeyDownCell,
}: {
  testid: string;
  value: string;
  html?: string;
  version: number;
  register: (el: HTMLDivElement | null) => void;
  onChange: (text: string, html: string) => void;
  onFocusCell: () => void;
  onBlurCell: () => void;
  onMouseDownCell: () => void;
  onKeyDownCell: (e: React.KeyboardEvent<HTMLDivElement>) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();

 // Sync DOM from state only on structural changes (version bump) or when the
 // value diverges while unfocused — never while the user is typing here.
 // Unfocused cells render `[Label](/p/…)` page links as mention chips.
  useEffect(() => {
    const el = ref.current;
    if (!el || el === document.activeElement) return;
    const want = html ?? value ?? "";
    if (el.dataset.raw !== want) {
      el.dataset.raw = want;
      el.innerHTML = cellHtml(value ?? "", html);
    }
  }, [version, value, html]);

  return (
      <div
        ref={(el) => {
          ref.current = el;
          register(el);
        }}
        contentEditable
        suppressContentEditableWarning
        spellCheck={false}
        data-testid={testid}
        onMouseDown={(e) => {
 // navigate on page-link chips instead of entering edit mode
          const a = (e.target as HTMLElement).closest?.("a[href^='/p/']");
          if (a) {
            e.preventDefault();
            router.push(a.getAttribute("href")!);
            return;
          }
          onMouseDownCell();
        }}
        onFocus={() => {
 // edit the raw source of chips, keep any b/i/u formatting as it is
          const el = ref.current;
          if (el) chipsToSource(el);
          onFocusCell();
        }}
        onBlur={() => {
 // back to rendered chips
          const el = ref.current;
          if (el) {
            const raw = el.innerText.replace(/\n+$/, "");
            const safe = sanitizeInline(el.innerHTML);
            el.dataset.raw = safe;
            el.innerHTML = cellHtml(raw, safe);
          }
          onBlurCell();
        }}
        onInput={() => {
          const el = ref.current;
          if (!el) return;
          const raw = el.innerText.replace(/\n+$/, "");
          const safe = sanitizeInline(el.innerHTML);
          el.dataset.raw = safe;
          onChange(raw, safe);
        }}
        onKeyDown={onKeyDownCell}
        className="min-h-[2rem] whitespace-pre-wrap px-2 py-1 text-sm text-neutral-800 outline-none dark:text-neutral-200"
      />
  );
}
