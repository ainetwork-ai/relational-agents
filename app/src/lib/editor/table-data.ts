/**
 * Per-cell table fields the row/column grips write a whole line of at once.
 *
 * Kept out of the component on purpose: the editor, the read-only renderer, the
 * HTML export and the markdown mirror all need to read the same values, and the
 * grip menu needs to write them. They all go through here instead of each one
 * re-deriving what a "line" or a default means.
 */
import type { TableData } from "@/lib/db/schema";

export type LineKind = "col" | "row";
/** fields stored as a cells-shaped grid of palette/keyword names */
export type CellField = "color" | "bg" | "align";
export type Align = "left" | "center" | "right";

/** Text alignment is ours, not the original's — Notion's simple table has no
 * alignment at all (measured: e2e/fixtures/notion-table-grip.json §menu.ours).
 * "left" is the default and is stored as nothing. */
export const ALIGNS: Align[] = ["left", "center", "right"];
const ALIGN_CLASS: Record<Align, string> = {
  left: "",
  center: "text-center",
  right: "text-right",
};

/**
 * Every grid that has to move with the text. A structural edit that forgets one
 * of these leaves the colour (or alignment) behind while the content shifts —
 * which is exactly how "insert left" ended up looking like "insert right".
 * Add a new per-cell field here and every insert/delete/move follows.
 */
export const CELL_GRIDS = ["html", "color", "bg", "align"] as const;

/** Apply the same index surgery to `cells` and to every grid it carries. */
function mapGrids(table: TableData, f: (grid: string[][]) => string[][]): TableData {
  const next: TableData = { ...table, cells: f(table.cells) };
  for (const g of CELL_GRIDS) if (table[g]) next[g] = f(table[g]!);
  return next;
}

/** Insert a blank row/column at `at`, or a copy of `copyFrom` (duplicate). */
export function insertLine(
  table: TableData,
  kind: LineKind,
  at: number,
  copyFrom?: number
): TableData {
  if (kind === "col")
    return mapGrids(table, (grid) =>
      grid.map((row) => {
        const next = row.slice();
        next.splice(at, 0, copyFrom != null ? row[copyFrom] ?? "" : "");
        return next;
      })
    );
  return mapGrids(table, (grid) => {
    const next = grid.map((row) => row.slice());
    const source = copyFrom != null ? next[copyFrom] : null;
    next.splice(at, 0, source ? source.slice() : Array(next[0]?.length ?? 0).fill(""));
    return next;
  });
}

/** Drop a row/column, never the last one. */
export function removeLine(table: TableData, kind: LineKind, i: number): TableData {
  const { rows, cols } = dims(table);
  if (kind === "col" ? cols <= 1 : rows <= 1) return table;
  return kind === "col"
    ? mapGrids(table, (grid) => grid.map((row) => row.filter((_, c) => c !== i)))
    : mapGrids(table, (grid) => grid.filter((_, r) => r !== i));
}

/** Move a row/column to another index (the grip drag). */
export function moveLine(table: TableData, kind: LineKind, from: number, to: number): TableData {
  const shift = <T,>(arr: T[]): T[] => {
    const next = arr.slice();
    const [taken] = next.splice(from, 1);
    next.splice(to, 0, taken);
    return next;
  };
  return kind === "col"
    ? mapGrids(table, (grid) => grid.map((row) => shift(row)))
    : mapGrids(table, (grid) => shift(grid));
}

/** "콘텐츠 삭제": blank the text (and its html) but keep colour and alignment. */
export function clearLineContents(table: TableData, kind: LineKind, i: number): TableData {
  const blank = (grid: string[][]) =>
    grid.map((row, r) => row.map((v, c) => ((kind === "row" ? r === i : c === i) ? "" : v)));
  const next: TableData = { ...table, cells: blank(table.cells) };
  if (table.html) next.html = blank(table.html);
  return next;
}

export function dims(table: TableData): { rows: number; cols: number } {
  return { rows: table.cells.length, cols: table.cells[0]?.length ?? 0 };
}

/** A full grid for `field`, filling anything unset with "default". */
export function gridOf(table: TableData, field: CellField): string[][] {
  return table.cells.map((row, r) => row.map((_, c) => table[field]?.[r]?.[c] ?? "default"));
}

/** The value of `field` in one cell, or "" when it is the default. */
export function cellField(table: TableData, field: CellField, r: number, c: number): string {
  const v = table[field]?.[r]?.[c];
  return v && v !== "default" ? v : "";
}

/** Write `value` into every cell — what the block handle's menu does, since it
 * has no row or column in hand. */
export function setAll(table: TableData, field: CellField, value: string): TableData {
  return { ...table, [field]: table.cells.map((row) => row.map(() => value)) };
}

/** The value `field` has in every cell, or null when they disagree. */
export function uniformField(table: TableData, field: CellField): string | null {
  let seen: string | null = null;
  for (let r = 0; r < table.cells.length; r++)
    for (let c = 0; c < table.cells[r].length; c++) {
      const v = table[field]?.[r]?.[c] || "default";
      if (seen == null) seen = v;
      else if (seen !== v) return null;
    }
  return seen ?? "default";
}

/** Write `value` across a whole row or column, leaving the rest as it was. */
export function setLine(
  table: TableData,
  field: CellField,
  kind: LineKind,
  i: number,
  value: string
): TableData {
  const grid = gridOf(table, field);
  const { rows, cols } = dims(table);
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) if (kind === "row" ? r === i : c === i) grid[r][c] = value;
  return { ...table, [field]: grid };
}

/** Tailwind class for a cell's alignment ("" for the left default). */
export function alignClass(table: TableData, r: number, c: number): string {
  const v = cellField(table, "align", r, c) as Align | "";
  return v ? ALIGN_CLASS[v] ?? "" : "";
}

/** CSS value for renderers that write style attributes (export, mirror). */
export function alignOf(table: TableData, r: number, c: number): Align {
  const v = cellField(table, "align", r, c) as Align | "";
  return v || "left";
}

/** A column's alignment, taken from its first row — markdown tables can only
 * express alignment per column, so that is the one that survives the mirror. */
export function columnAlign(table: TableData, c: number): Align {
  return alignOf(table, 0, c);
}
