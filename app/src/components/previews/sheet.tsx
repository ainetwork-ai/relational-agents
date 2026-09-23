"use client";
// Spreadsheets (xlsx/xlsm/xltx/xlsb/xls/ods) via SheetJS, drawn by our own
// grid: A/B/C + 1/2/3 sticky headers, sheet tabs along the bottom like Drive.
// Cells are rendered as React text nodes (formatted `.w` text), never as
// library HTML, so no sandbox frame is needed here.
import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import type { CellObject, WorkBook, WorkSheet } from "xlsx";
import type { PreviewProps } from "./types";
import { OfficeBytes, PROTECTED_MESSAGE } from "./office-password";
import { PreviewLoading, PreviewMessage } from "./status";

const MAX_ROWS = 2000;
const MAX_COLS = 200;
// DOM budget: a 2000 x 200 grid would be 400k cells. Wide sheets get fewer rows.
const MAX_CELLS = 150_000;
const DEFAULT_COL_PX = 96;

type Parsed = { wb: WorkBook; utils: typeof import("xlsx").utils; visible: number[] };

function colName(c: number): string {
  let s = "";
  for (let n = c + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

function SheetGrid({ ws, utils }: { ws: WorkSheet; utils: Parsed["utils"] }) {
  const grid = useMemo(() => {
    const ref = ws["!ref"];
    if (!ref) return null;
    const range = utils.decode_range(ref);
    const cols = Math.min(range.e.c + 1, MAX_COLS);
    const rowCap = Math.min(MAX_ROWS, Math.max(50, Math.floor(MAX_CELLS / Math.max(cols, 1))));
    const rows = Math.min(range.e.r + 1, rowCap);
    // Merges clipped to what we draw: anchor → spans, covered cells skipped.
    const spans = new Map<string, { rs: number; cs: number }>();
    const covered = new Set<string>();
    for (const m of ws["!merges"] ?? []) {
      if (m.s.r >= rows || m.s.c >= cols) continue;
      const er = Math.min(m.e.r, rows - 1), ec = Math.min(m.e.c, cols - 1);
      spans.set(`${m.s.r},${m.s.c}`, { rs: er - m.s.r + 1, cs: ec - m.s.c + 1 });
      for (let r = m.s.r; r <= er; r++) for (let c = m.s.c; c <= ec; c++) if (r !== m.s.r || c !== m.s.c) covered.add(`${r},${c}`);
    }
    const widths = Array.from({ length: cols }, (_, c) => {
      const info = ws["!cols"]?.[c];
      if (info?.hidden) return 0;
      return Math.round(info?.wpx ?? (info?.wch ? info.wch * 7 + 5 : DEFAULT_COL_PX));
    });
    return { rows, cols, totalRows: range.e.r + 1, totalCols: range.e.c + 1, spans, covered, widths };
  }, [ws, utils]);

  if (!grid) return <div className="p-6 text-xs text-neutral-500 dark:text-neutral-400">This sheet is empty.</div>;
  const dense = (ws as { "!data"?: CellObject[][] })["!data"];
  const cellAt = (r: number, c: number): CellObject | undefined => (dense ? dense[r]?.[c] : ws[utils.encode_cell({ r, c })]);
  const clipped = grid.rows < grid.totalRows || grid.cols < grid.totalCols;

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {clipped && (
        <div className="shrink-0 px-3 py-1.5 text-xs text-neutral-500 dark:text-neutral-400 bg-neutral-50 dark:bg-neutral-800 border-b border-neutral-200 dark:border-neutral-700">
          Showing the first {grid.rows.toLocaleString()} of {grid.totalRows.toLocaleString()} rows
          {grid.cols < grid.totalCols && ` and ${grid.cols} of ${grid.totalCols} columns`}. Download for the full sheet.
        </div>
      )}
      <div className="flex-1 min-h-0 overflow-auto bg-white">
        <table className="border-separate border-spacing-0 text-[13px] leading-5 text-neutral-800 dark:text-neutral-200" style={{ tableLayout: "fixed", width: 44 + grid.widths.reduce((a, b) => a + b, 0) }}>
          <colgroup>
            <col style={{ width: 44 }} />
            {grid.widths.map((w, c) => <col key={c} style={{ width: w }} />)}
          </colgroup>
          <thead>
            <tr>
              <th className="sticky top-0 left-0 z-20 bg-[#f8f9fa] border-r border-b border-[#c0c0c0]" />
              {grid.widths.map((w, c) => (
                <th key={c} className="sticky top-0 z-10 bg-[#f8f9fa] border-r border-b border-[#c0c0c0] font-normal text-[11px] text-neutral-500 dark:text-neutral-400 h-5 overflow-hidden">
                  {w ? colName(c) : null}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: grid.rows }, (_, r) => {
              const hpx = ws["!rows"]?.[r]?.hidden ? 0 : ws["!rows"]?.[r]?.hpx;
              return (
                <tr key={r} style={hpx !== undefined ? { height: hpx } : undefined}>
                  <th className="sticky left-0 z-10 bg-[#f8f9fa] border-r border-b border-[#c0c0c0] font-normal text-[11px] text-neutral-500 dark:text-neutral-400 text-center h-[21px]">{r + 1}</th>
                  {grid.widths.map((_, c) => {
                    const key = `${r},${c}`;
                    if (grid.covered.has(key)) return null;
                    const cell = cellAt(r, c);
                    const span = grid.spans.get(key);
                    // A formula saved without a cached result (e.g. by a script) has
                    // no value to show; show the formula itself, muted.
                    // (SheetJS only keeps such cells as "z" stubs, hence sheetStubs.)
                    const formulaOnly = !!cell?.f && (cell.t === "z" || cell.v == null);
                    const text = !cell ? "" : formulaOnly ? `=${cell.f}` : cell.t === "z" ? "" : (cell.w ?? (cell.v == null ? "" : utils.format_cell(cell)));
                    const numeric = cell?.t === "n" || cell?.t === "d";
                    return (
                      <td
                        key={c}
                        rowSpan={span?.rs}
                        colSpan={span?.cs}
                        title={text.length > 12 ? text : undefined}
                        className={clsx(
                          "border-r border-b border-[#e2e3e3] px-1.5 whitespace-nowrap overflow-hidden text-ellipsis",
                          numeric && "text-right tabular-nums",
                          cell?.t === "b" && "text-center",
                          cell?.t === "e" && "text-red-600",
                          formulaOnly && "text-neutral-500 dark:text-neutral-400 italic",
                          span && "text-center align-middle",
                        )}
                      >
                        {text}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Workbook({ name, data }: { name: string; data: ArrayBuffer }) {
  const [state, setState] = useState<{ status: "loading" } | { status: "error"; message: string } | ({ status: "ready" } & Parsed)>({ status: "loading" });
  const [active, setActive] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const XLSX = await import("xlsx");
      // Let the spinner paint before the synchronous parse.
      await new Promise((r) => setTimeout(r, 0));
      try {
        // dense: row arrays instead of an A1-keyed object (far less memory).
        // sheetRows caps parsing; the true extent survives in !fullref.
        const wb = XLSX.read(new Uint8Array(data), { type: "array", dense: true, cellDates: true, sheetRows: MAX_ROWS, sheetStubs: true });
        for (const n of wb.SheetNames) {
          const ws = wb.Sheets[n];
          if (ws["!fullref"]) ws["!ref"] = clampRef(XLSX.utils, ws["!fullref"], ws["!ref"]);
        }
        const hidden = wb.Workbook?.Sheets?.map((s) => !!s.Hidden) ?? [];
        const visible = wb.SheetNames.map((_, i) => i).filter((i) => !hidden[i]);
        if (!cancelled) {
          setState({ status: "ready", wb, utils: XLSX.utils, visible: visible.length ? visible : [0] });
          setActive(visible[0] ?? 0);
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : "";
        if (!cancelled) setState({ status: "error", message: /password|encrypt/i.test(msg) ? PROTECTED_MESSAGE : "Could not read this spreadsheet. Download it to open it." });
      }
    })();
    return () => { cancelled = true; };
  }, [data]);

  if (state.status === "loading") return <PreviewLoading label="Reading spreadsheet…" />;
  if (state.status === "error") return <PreviewMessage name={name} message={state.message} />;
  const { wb, utils, visible } = state;
  const sheetName = wb.SheetNames[active];

  return (
    <div className="h-full flex flex-col">
      <SheetGrid key={sheetName} ws={wb.Sheets[sheetName]} utils={utils} />
      <div role="tablist" className="shrink-0 flex gap-0.5 overflow-x-auto border-t border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 px-2">
        {visible.map((i) => (
          <button
            key={i}
            role="tab"
            aria-selected={i === active}
            onClick={() => setActive(i)}
            className={clsx(
              "shrink-0 max-w-[180px] truncate px-3 py-1.5 text-xs border-b-2 -mt-px",
              i === active ? "bg-white border-blue-500 text-blue-500 font-medium" : "border-transparent text-neutral-500 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800",
            )}
            title={wb.SheetNames[i]}
          >
            {wb.SheetNames[i]}
          </button>
        ))}
      </div>
    </div>
  );
}

/** With sheetRows, !ref is truncated to the parsed rows but we want the true
    row count for the "showing N of M" note: keep the full extent's size
    while the grid itself only reads what was parsed. */
function clampRef(utils: Parsed["utils"], full: string, parsed: string | undefined): string {
  if (!parsed) return full;
  const f = utils.decode_range(full), p = utils.decode_range(parsed);
  return utils.encode_range({ s: p.s, e: { r: f.e.r, c: Math.max(f.e.c, p.e.c) } });
}

export default function SheetPreview({ src }: PreviewProps) {
  return <OfficeBytes src={src}>{(data) => <Workbook name={src.name} data={data} />}</OfficeBytes>;
}
