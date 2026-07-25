"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Plus, X } from "lucide-react";
import type { TableData } from "@/lib/db/schema";
import { useEditor, type EBlock } from "./block-editor";

/** Inline page links in cells: `[Label](/p/<uuid>)` renders as a mention chip
 *  while the cell is unfocused; the raw source comes back while editing. */
const CELL_LINK_RE = /\[([^\]]+)\]\((\/p\/[0-9a-fA-F-]{36})\)/g;

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function cellHtml(raw: string): string {
  return escapeHtml(raw).replace(
    CELL_LINK_RE,
    (_m, label, href) =>
      `<a href="${href}" class="mention" data-mention-type="page" contenteditable="false">${label}</a>`
  );
}

const EMPTY: TableData = { cells: [["", ""], ["", ""]], headerRow: true };

/**
 * Notion "simple table" block: a static grid of text cells with add/remove
 * row & column and an optional header row/column. Cells are plain-text
 * contentEditable; the whole grid persists in block.content.table.
 */
export function TableBlock({ block }: { block: EBlock }) {
  const editor = useEditor();
  const table = block.content.table ?? EMPTY;
  const cells = table.cells.length ? table.cells : EMPTY.cells;
  const nRows = cells.length;
  const nCols = cells[0]?.length ?? 0;

  function commit(next: TableData) {
    editor.updateTable(block.id, next);
  }

  function setCell(r: number, c: number, value: string) {
    const copy = cells.map((row) => row.slice());
    copy[r][c] = value;
    commit({ ...table, cells: copy });
  }

  function addRow() {
    commit({ ...table, cells: [...cells.map((r) => r.slice()), Array(nCols).fill("")] });
  }
  function addCol() {
    commit({ ...table, cells: cells.map((r) => [...r, ""]) });
  }
  function delRow(r: number) {
    if (nRows <= 1) return;
    commit({ ...table, cells: cells.filter((_, i) => i !== r) });
  }
  function delCol(c: number) {
    if (nCols <= 1) return;
    commit({ ...table, cells: cells.map((row) => row.filter((_, i) => i !== c)) });
  }

  return (
    <div data-testid={`table-${block.id}`} className="my-1.5 w-full overflow-x-auto">
      {/* column delete handles */}
      <div className="flex pl-5 pr-7">
        {Array.from({ length: nCols }).map((_, c) => (
          <div
            key={c}
            className="group/col flex h-4 min-w-[100px] flex-1 items-center justify-center"
          >
            <button
              data-testid={`table-del-col-${block.id}-${c}`}
              onClick={() => delCol(c)}
              disabled={nCols <= 1}
              aria-label="Delete column"
              className="flex h-3.5 w-6 items-center justify-center rounded text-neutral-400 opacity-0 transition-opacity hover:bg-neutral-200 group-hover/col:opacity-100 disabled:opacity-0 dark:hover:bg-neutral-700"
            >
              <X size={11} />
            </button>
          </div>
        ))}
      </div>

      <div className="flex">
        <div className="min-w-0 flex-1">
          {cells.map((row, r) => (
            <div key={r} className="group/row flex">
              {/* row delete handle */}
              <div className="flex w-5 shrink-0 items-start justify-center pt-1.5">
                <button
                  data-testid={`table-del-row-${block.id}-${r}`}
                  onClick={() => delRow(r)}
                  disabled={nRows <= 1}
                  aria-label="Delete row"
                  className="flex h-6 w-4 items-center justify-center rounded text-neutral-400 opacity-0 transition-opacity hover:bg-neutral-200 group-hover/row:opacity-100 disabled:opacity-0 dark:hover:bg-neutral-700"
                >
                  <X size={11} />
                </button>
              </div>
              {row.map((value, c) => (
                <Cell
                  key={c}
                  testid={`table-cell-${block.id}-${r}-${c}`}
                  value={value}
                  version={block.version}
                  header={
                    (!!table.headerRow && r === 0) || (!!table.headerCol && c === 0)
                  }
                  first={c === 0}
                  firstRow={r === 0}
                  onChange={(v) => setCell(r, c, v)}
                />
              ))}
            </div>
          ))}
        </div>
        {/* add column */}
        <button
          data-testid={`table-add-col-${block.id}`}
          onClick={addCol}
          aria-label="Add column"
          className="ml-0.5 flex w-6 shrink-0 items-center justify-center self-stretch rounded text-neutral-400 transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-800"
        >
          <Plus size={14} />
        </button>
      </div>

      {/* add row */}
      <button
        data-testid={`table-add-row-${block.id}`}
        onClick={addRow}
        aria-label="Add row"
        className="ml-5 mt-0.5 flex h-5 items-center justify-center rounded text-neutral-400 transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-800"
        style={{ width: `calc(100% - 1.25rem - 1.5rem)` }}
      >
        <Plus size={14} />
      </button>
    </div>
  );
}

function Cell({
  testid,
  value,
  version,
  header,
  first,
  firstRow,
  onChange,
}: {
  testid: string;
  value: string;
  version: number;
  header: boolean;
  first: boolean;
  firstRow: boolean;
  onChange: (v: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();

  // Sync DOM from state only on structural changes (version bump) or when the
  // value diverges while unfocused — never while the user is typing here.
  // Unfocused cells render `[Label](/p/…)` page links as mention chips.
  useEffect(() => {
    const el = ref.current;
    if (!el || el === document.activeElement) return;
    const want = value ?? "";
    if (el.dataset.raw !== want) {
      el.dataset.raw = want;
      el.innerHTML = cellHtml(want);
    }
  }, [version, value]);

  return (
    <div
      className={`min-w-[100px] flex-1 border border-neutral-200 dark:border-neutral-700 ${
        !first ? "-ml-px" : ""
      } ${!firstRow ? "-mt-px" : ""} ${
        header ? "bg-neutral-50 font-medium dark:bg-neutral-800/60" : ""
      }`}
    >
      <div
        ref={ref}
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
          }
        }}
        onFocus={(e) => {
          // edit the raw source, not the rendered chips
          const el = e.currentTarget as HTMLElement;
          const raw = el.dataset.raw ?? el.innerText.replace(/\n+$/, "");
          if (el.innerText.replace(/\n+$/, "") !== raw) el.innerText = raw;
        }}
        onBlur={(e) => {
          // back to rendered chips
          const el = e.currentTarget as HTMLElement;
          const raw = el.innerText.replace(/\n+$/, "");
          el.dataset.raw = raw;
          el.innerHTML = cellHtml(raw);
        }}
        onInput={(e) => {
          const el = e.currentTarget as HTMLElement;
          const raw = el.innerText.replace(/\n+$/, "");
          el.dataset.raw = raw;
          onChange(raw);
        }}
        onKeyDown={(e) => {
          // keep table keys from bubbling to the block-level editor handlers
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            e.stopPropagation();
          }
        }}
        className="min-h-[2rem] whitespace-pre-wrap px-2 py-1 text-sm text-neutral-800 outline-none dark:text-neutral-200"
      />
    </div>
  );
}
