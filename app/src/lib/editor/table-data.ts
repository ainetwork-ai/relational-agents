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
