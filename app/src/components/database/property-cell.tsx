"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { isImeComposing } from "@/hooks/use-ime-guard";
import { useDismiss } from "@/hooks/use-dismiss";
import { StatusPicker } from "./status-picker";
import { useAnchored } from "@/hooks/use-anchored";
import { uploadBlob } from "@/lib/upload";
import type { DbProperty, DbRow } from "@/lib/db/schema";
import { X } from "lucide-react";
import { useIntlLocale, useT } from "@/i18n/provider";

/** The person picker, measured on the original (e2e/fixtures/notion-person-picker.json):
 *  the box is always 333 tall with the list scrolling inside, and its width is the
 *  cell's — but never under 240 (a 117px Sherpa cell still opens a 240 menu). */
const POPOVER_MAX_H = 333;
const PICKER_MIN_W = 240;
const PICKER_SHADOW =
  "rgba(25, 25, 25, 0.05) 0px 20px 24px 0px, rgba(25, 25, 25, 0.027) 0px 5px 8px 0px, rgba(42, 28, 0, 0.07) 0px 0px 0px 1px";
import { createPortal } from "react-dom";
import { findOption, personLabel, personIds, personLabels } from "@/lib/db-values";
import { evalFormula, rollupValue } from "@/lib/db-computed";
import {
  fetchDatabaseSnapshot,
  targetRowLabel,
  type DbSnapshot,
} from "@/lib/db-relation";
import { formatRowTimestamp } from "@/lib/dates";
import {
  DatePickerPanel,
  PANEL_SHADOW,
  buildDateValue,
  parseDateValue,
  type DateParts,
} from "./date-picker";
import { DEFAULT_DATE_FORMAT, fmtDateRange, type DateFormat } from "@/lib/date-format";
import { useDb } from "./database-block";
import { copyText } from "@/lib/compat";
import { classifyLink, absoluteHref } from "@/lib/app-link";
import { UrlValue } from "./url-value";
import { UserAvatar } from "@/components/user-avatar";
import { OptionChip } from "./option-chip";

/** A row timestamp, written the way the original writes it. */
function fmtTimestamp(v: unknown, locale: string): string {
  if (!v) return "";
  const d = new Date(v as string | number | Date);
  return isNaN(d.getTime()) ? "" : formatRowTimestamp(d, locale);
}

export function PropertyCell({
  prop,
  row,
 // "page" is the row page, where there is room to show a link as a card
  variant = "cell",
 // shrink the field to its text instead of filling the cell. The table's title
 // cell needs it: the original hangs the comment badge right after the title,
 // not out at the cell's right edge.
  shrinkToText,
 // the row page's pinned band draws only the first person and counts the rest
 // (`+ 5`), however much room is left — measured on the original, where a
 // 6-person cell is 135px wide against a 200px cap
 // (e2e/fixtures/notion-row-props-band.json §people). The table does not.
  collapsePeople,
}: {
  prop: DbProperty;
  row: DbRow;
  variant?: "cell" | "page";
  shrinkToText?: boolean;
  collapsePeople?: boolean;
}) {
  const intl = useIntlLocale();
  const db = useDb();
  const value = row.values[prop.id];
  const testid = `db-cell-${row.id}-${prop.id}`;

  const set = (v: unknown) => db.updateRow(row.id, { [prop.id]: v });

  switch (prop.type) {
    case "title":
    case "text":
    case "email":
    case "phone":
      return (
        <TextCell
          testid={testid}
          value={(value as string) ?? ""}
          onCommit={set}
          shrinkToText={shrinkToText}
        />
      );

    case "url":
      return (
        <UrlCell testid={testid} value={(value as string) ?? ""} onCommit={set} variant={variant} />
      );

    case "created_time":
      return (
        <div
          data-testid={testid}
 // the original prints these in the ordinary cell colour at 14px/21px and insets
 // the text 8px/10px — it does not grey them out
 // (e2e/fixtures/notion-created-time.json)
          className="flex h-[37px] items-start pl-[7px] pr-2 pt-[10px] text-[14px] font-normal leading-[21px] text-[#2c2c2b] dark:text-neutral-300"
        >
          {fmtTimestamp(row.createdAt, intl)}
        </div>
      );

    case "last_edited_time":
      return (
        <div
          data-testid={testid}
 // the original prints these in the ordinary cell colour at 14px/21px and insets
 // the text 8px/10px — it does not grey them out
 // (e2e/fixtures/notion-created-time.json)
          className="flex h-[37px] items-start pl-[7px] pr-2 pt-[10px] text-[14px] font-normal leading-[21px] text-[#2c2c2b] dark:text-neutral-300"
        >
          {fmtTimestamp(row.updatedAt, intl)}
        </div>
      );

    case "created_by":
      return (
        <div
          data-testid={testid}
 // the original prints these in the ordinary cell colour at 14px/21px and insets
 // the text 8px/10px — it does not grey them out
 // (e2e/fixtures/notion-created-time.json)
          className="flex h-[37px] items-start pl-[7px] pr-2 pt-[10px] text-[14px] font-normal leading-[21px] text-[#2c2c2b] dark:text-neutral-300"
        >
          {personLabel(db.members, row.createdBy) || "—"}
        </div>
      );

    case "last_edited_by":
      return (
        <div
          data-testid={testid}
 // the original prints these in the ordinary cell colour at 14px/21px and insets
 // the text 8px/10px — it does not grey them out
 // (e2e/fixtures/notion-created-time.json)
          className="flex h-[37px] items-start pl-[7px] pr-2 pt-[10px] text-[14px] font-normal leading-[21px] text-[#2c2c2b] dark:text-neutral-300"
        >
          {personLabel(db.members, row.updatedBy) || "—"}
        </div>
      );

    case "files":
      return <FilesCell testid={testid} value={value} onSet={set} />;

    case "number":
      return <NumberCell testid={testid} prop={prop} value={value} onSet={set} />;

    case "checkbox":
      return (
        <div className="flex items-center px-2 py-1">
          <input
            data-testid={testid}
            type="checkbox"
            checked={!!value}
            onChange={(e) => set(e.target.checked)}
            className="h-4 w-4 cursor-pointer accent-blue-500"
          />
        </div>
      );

    case "date":
      return <DateCell testid={testid} prop={prop} value={value} onSet={set} />;

    case "select":
    case "status":
      return <SelectCell testid={testid} prop={prop} value={value} onSet={set} />;

    case "multi_select":
      return <MultiSelectCell testid={testid} prop={prop} row={row} />;

    case "person":
      return <PersonCell testid={testid} value={value} onSet={set} collapse={collapsePeople} />;

    case "relation":
      return <RelationCell prop={prop} row={row} />;

    case "formula":
      return <FormulaCell prop={prop} row={row} />;

    case "rollup":
      return <RollupCell prop={prop} row={row} />;

    default:
      return <div className="px-2 py-1 text-sm text-neutral-400">—</div>;
  }
}

function RelationCell({ prop, row }: { prop: DbProperty; row: DbRow }) {
  const db = useDb();
  const t = useT();
  const [open, setOpen] = useState(false);
  const [snap, setSnap] = useState<DbSnapshot | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const targetDbId = prop.config.relationDatabaseId;
 // two-way mirror: value is COMPUTED from the source db's relation values
 // (rows over there that link to this row), never stored on this row
  const mirror = prop.config.mirrorOf;
  const value = row.values[prop.id];
  const linked: string[] = mirror
    ? (snap?.rows ?? [])
        .filter((r) => {
          const v = r.values[mirror.propId];
          return Array.isArray(v) && (v as string[]).includes(row.id);
        })
        .map((r) => r.id)
    : Array.isArray(value)
      ? (value as string[])
      : [];

 // load the target db's rows so chips can show titles and the popover can
 // list options. Refetch whenever the target database changes.
  const load = useCallback(async () => {
    const next = targetDbId ? await fetchDatabaseSnapshot(targetDbId) : null;
    setSnap(next);
    return next;
  }, [targetDbId]);

 // deferred (async IIFE) so no setState runs synchronously in the effect body
  useEffect(() => {
    let alive = true;
    void (async () => {
      const next = targetDbId ? await fetchDatabaseSnapshot(targetDbId) : null;
      if (alive) setSnap(next);
    })();
    return () => {
      alive = false;
    };
  }, [targetDbId]);

  const popRef = useRef<HTMLDivElement>(null);
 // portalled to the body, so the cell's one-line clipping cannot cut it and it
 // flips above the cell near the bottom of the window
  useAnchored(open, ref, popRef);
  useDismiss(open, () => setOpen(false), ref, popRef);

  function toggle(targetRowId: string) {
    if (mirror) {
 // edit the OTHER side: add/remove this row in the source row's relation
      const srcRow = snap?.rows.find((r) => r.id === targetRowId);
      const cur = Array.isArray(srcRow?.values[mirror.propId])
        ? (srcRow!.values[mirror.propId] as string[])
        : [];
      const next = cur.includes(row.id)
        ? cur.filter((x) => x !== row.id)
        : [...cur, row.id];
      void fetch(`/api/databases/${mirror.databaseId}/rows/${targetRowId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ values: { [mirror.propId]: next } }),
      }).then(() => load());
      return;
    }
    const next = linked.includes(targetRowId)
      ? linked.filter((x) => x !== targetRowId)
      : [...linked, targetRowId];
    db.updateRow(row.id, { [prop.id]: next });
  }

  return (
    <div ref={ref} className="relative px-1.5 py-1">
      <button
        data-testid={`relation-cell-${row.id}-${prop.id}`}
        onClick={async () => {
          if (!snap) await load();
          setOpen((v) => !v);
        }}
        className="flex min-h-[1.5rem] w-full flex-wrap items-center gap-1"
      >
        {linked.length ? (
          linked.map((id) => (
            <span
              key={id}
              data-testid={`relation-chip-${id}`}
              className="rounded bg-neutral-100 px-1.5 py-0.5 text-xs font-medium text-neutral-700 dark:bg-neutral-700 dark:text-neutral-200"
            >
              {targetRowLabel(snap, id) || "…"}
            </span>
          ))
        ) : (
          <span className="inline-block h-5 w-full" aria-hidden="true" />
        )}
      </button>
      {open &&
        createPortal(
          <div
            ref={popRef}
            style={{ visibility: "hidden" }}
            className="popover-anim fixed z-50 w-52 overflow-auto rounded-lg border border-neutral-200 bg-white p-1 shadow-xl dark:border-neutral-700 dark:bg-neutral-800"
          >
          {!targetDbId ? (
            <div className="px-2 py-1 text-xs text-neutral-400">{t("Select a target database first")}</div>
          ) : !snap || snap.rows.length === 0 ? (
            <div className="px-2 py-1 text-xs text-neutral-400">{t("No rows to link")}</div>
          ) : (
            snap.rows.map((tr) => (
              <button
                key={tr.id}
                data-testid={`relation-option-${tr.id}`}
                onClick={() => toggle(tr.id)}
                className="flex w-full items-center justify-between rounded px-2 py-1 text-left text-xs hover:bg-neutral-100 dark:hover:bg-neutral-700"
              >
                <span className="truncate text-neutral-700 dark:text-neutral-200">
                  {targetRowLabel(snap, tr.id)}
                </span>
                {linked.includes(tr.id) && <span className="text-blue-500">✓</span>}
              </button>
            ))
          )}
          </div>,
          document.body
        )}
    </div>
  );
}

function FormulaCell({ prop, row }: { prop: DbProperty; row: DbRow }) {
  const db = useDb();
 // recomputes on every render — reads the latest props/rows from context, so a
 // dependency cell change re-renders the table and updates this value live.
  const text = evalFormula(prop.config.formula, db.properties, row);
  return (
    <div
      data-testid={`db-formula-value-${row.id}-${prop.id}`}
      className="px-2 py-1 text-sm text-neutral-700 dark:text-neutral-200"
    >
      {text}
    </div>
  );
}

function RollupCell({ prop, row }: { prop: DbProperty; row: DbRow }) {
  const db = useDb();
  const [text, setText] = useState("");
  const rollup = prop.config.rollup;
  const relProp = db.properties.find((p) => p.id === rollup?.relationPropertyId);
  const relatedDbId = relProp?.config.relationDatabaseId;
  const linkedValue = relProp ? row.values[relProp.id] : undefined;
  const linkedIds: string[] = Array.isArray(linkedValue) ? (linkedValue as string[]) : [];
 // stable dependency key so the effect refires when links or config change
  const linkedKey = linkedIds.join(",");

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!relatedDbId || !rollup?.targetPropertyId) {
        if (alive) setText("");
        return;
      }
      const snap = await fetchDatabaseSnapshot(relatedDbId);
      if (!alive) return;
      const linkedRows = (snap?.rows ?? []).filter((r) => linkedIds.includes(r.id));
      setText(rollupValue(linkedRows, rollup.targetPropertyId, rollup.function));
    })();
    return () => {
      alive = false;
    };
 // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [relatedDbId, rollup?.targetPropertyId, rollup?.function, linkedKey]);

  return (
    <div
      data-testid={`db-rollup-value-${row.id}-${prop.id}`}
      className="px-2 py-1 text-sm text-neutral-700 dark:text-neutral-200"
    >
      {text}
    </div>
  );
}

function MultiSelectCell({
  testid,
  prop,
  row,
}: {
  testid: string;
  prop: DbProperty;
  row: DbRow;
}) {
  const db = useDb();
  const t = useT();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const value = row.values[prop.id];
  const selected: string[] = Array.isArray(value) ? (value as string[]) : [];
  const options = prop.config.options ?? [];

  const popRef = useRef<HTMLDivElement>(null);
 // portalled to the body, so the cell's one-line clipping cannot cut it and it
 // flips above the cell near the bottom of the window
  useAnchored(open, ref, popRef);
  useDismiss(open, () => setOpen(false), ref, popRef);

  function toggle(id: string) {
    db.toggleMulti(row.id, prop.id, id);
  }

  return (
    <div ref={ref} className="relative min-w-0 py-1 pl-[7px] pr-1.5">
      <button
        data-testid={testid}
        onClick={() => setOpen((v) => !v)}
 // the original insets the first chip 8px from the cell's border box and gaps
 // chips by 8px (e2e/fixtures/notion-chips.json → cell); our cell draws a 1px
 // left border, so 7px of padding lands the chip on 8
        className="flex min-h-[1.5rem] w-full items-center gap-2 overflow-hidden"
      >
        {selected.length ? (
 // one line, clipped by the column — the capture's cell does not wrap
          selected.map((id) => {
            const o = findOption(prop, id);
            return o ? (
              <OptionChip key={id} color={o.color} title={o.name}>
                {o.name}
              </OptionChip>
            ) : null;
          })
        ) : (
          <span className="inline-block h-5 w-full" aria-hidden="true" />
        )}
      </button>
      {open &&
        createPortal(
          <div
            ref={popRef}
            style={{ visibility: "hidden" }}
            className="popover-anim fixed z-50 w-48 overflow-auto rounded-lg border border-neutral-200 bg-white p-1 shadow-xl dark:border-neutral-700 dark:bg-neutral-800"
          >
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("Search or create…")}
            className="mb-1 w-full rounded border border-neutral-200 px-2 py-1 text-xs outline-none dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-200"
          />
          {options
            .filter((o) => o.name.toLowerCase().includes(q.toLowerCase()))
            .map((o) => (
              <button
                key={o.id}
                data-testid={`db-option-${prop.id}-${o.id}`}
                onClick={() => toggle(o.id)}
                className="flex w-full items-center justify-between rounded px-2 py-1 text-left hover:bg-neutral-100 dark:hover:bg-neutral-700"
              >
                <OptionChip color={o.color}>{o.name}</OptionChip>
                {selected.includes(o.id) && <span className="text-xs text-blue-500">✓</span>}
              </button>
            ))}
          {q && !options.some((o) => o.name.toLowerCase() === q.toLowerCase()) && (
            <button
              data-testid="db-option-create"
              onClick={async () => {
                const opt = await db.addSelectOption(prop, q);
                db.toggleMulti(row.id, prop.id, opt.id);
                setQ("");
              }}
              className="block w-full rounded px-2 py-1 text-left text-xs text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-700"
            >
              {t("Create “{q}”", { q })}
            </button>
          )}
          </div>,
          document.body
        )}
    </div>
  );
}

function TextCell({
  testid,
  value,
  onCommit,
  shrinkToText,
}: {
  testid: string;
  value: string;
  onCommit: (v: string) => void;
  shrinkToText?: boolean;
}) {
  const [draft, setDraft] = useState(value);
  const ref = useRef(value);
  useEffect(() => {
    if (value !== ref.current) {
      ref.current = value;
      setDraft(value);
    }
  }, [value]);
  const field = (
    <input
      data-testid={testid}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => draft !== value && onCommit(draft)}
      onKeyDown={(e) => {
        if (!isImeComposing(e) && e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
      className={`bg-transparent px-2 py-1 text-sm outline-none dark:text-neutral-200 ${
        shrinkToText ? "absolute inset-0 w-full" : "w-full"
      }`}
    />
  );
  if (!shrinkToText) return field;
 // A hidden twin carrying the same text in the same font sets the width, so
 // the input is exactly as wide as what it shows and whatever follows it sits
 // against the text. `field-sizing: content` would do this in one line but
 // only lands in Chromium — this works everywhere and needs no measuring pass.
  return (
    <span className="relative block max-w-full">
      <span aria-hidden="true" className="invisible block whitespace-pre px-2 py-1 text-sm">
        {draft || " "}
      </span>
      {field}
    </span>
  );
}

/**
 * Date cell. The cell itself is plain text in the column's `Date format`;
 * everything else lives in the popover (./date-picker.tsx), which is the
 * original's, measured.
 */
function DateCell({
  testid,
  prop,
  value,
  onSet,
}: {
  testid: string;
  prop: DbProperty;
  value: unknown;
  onSet: (v: unknown) => void;
}) {
  const db = useDb();
  const parts = parseDateValue(value);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const push = (next: Partial<DateParts>) => onSet(buildDateValue({ ...parts, ...next }));
  const idBase = testid.replace("db-cell-", "");
  const fmt = (prop.config?.dateFormat as DateFormat) ?? DEFAULT_DATE_FORMAT;
  const t = useT();
  const dateOpts = { locale: useIntlLocale(), t };

  const popRef = useRef<HTMLDivElement>(null);
 // portalled to the body, so the cell's one-line clipping cannot cut it and it
 // flips above the cell near the bottom of the window
  useAnchored(open, ref, popRef);
  useDismiss(open, () => setOpen(false), ref, popRef);

  return (
    <div ref={ref} className="relative">
      <button
        data-testid={testid}
        onClick={() => setOpen((v) => !v)}
 // the same metrics as every other cell's text (14px/21px, inset 8/10)
        className="flex h-[37px] w-full items-start pl-[7px] pr-2 pt-[10px] text-left text-[14px] font-normal leading-[21px] text-[#2c2c2b] dark:text-neutral-300"
      >
        {fmtDateRange(parts, fmt, dateOpts) ? (
 // one line, cut with an ellipsis rather than mid-glyph — the original nests
 // `white-space: nowrap; text-overflow: ellipsis; overflow: hidden` inside its
 // value cell, so a range wider than the cell reads "December 22, 2025 → January…"
 // (e2e/fixtures/notion-row-props-band.json §truncate)
          <span className="min-w-0 truncate">{fmtDateRange(parts, fmt, dateOpts)}</span>
        ) : (
          <span className="inline-block h-5 w-full" aria-hidden="true" />
        )}
      </button>
      {open &&
        createPortal(
          <div
            ref={popRef}
            style={{ visibility: "hidden", boxShadow: PANEL_SHADOW }}
            className="popover-anim fixed z-50 rounded-md bg-white dark:bg-[#252525]"
          >
            <DatePickerPanel
              idBase={idBase}
              parts={parts}
              fmt={fmt}
              onChange={push}
              onFormat={(f) =>
                db.updateProperty(prop.id, { config: { ...prop.config, dateFormat: f } })
              }
              onClear={() => {
                onSet(null);
                setOpen(false);
              }}
            />
          </div>,
          document.body
        )}
    </div>
  );
}

/** Format a number per the column's numberFormat config. */
export function formatNumber(n: number, fmt: string | undefined, locale: string): string {
  switch (fmt) {
    case "percent":
      return `${n}%`;
    case "currency":
      return n.toLocaleString(locale, { style: "currency", currency: "USD" });
    case "comma":
      return n.toLocaleString(locale);
    default:
      return String(n);
  }
}

/** Number cell: a plain editable value, or a progress bar (display="bar") that
 * fills 0..100% of the value. Format applies to the shown text. */
function NumberCell({
  testid,
  prop,
  value,
  onSet,
}: {
  testid: string;
  prop: DbProperty;
  value: unknown;
  onSet: (v: unknown) => void;
}) {
  const intl = useIntlLocale();
  const [editing, setEditing] = useState(false);
  const num = value === undefined || value === null || value === "" ? null : Number(value);
  const asBar = prop.config.display === "bar";

  if (editing || !asBar || num === null) {
    return (
      <input
        data-testid={testid}
        autoFocus={editing}
        type="number"
        defaultValue={num === null ? "" : String(num)}
        onBlur={(e) => {
          setEditing(false);
          onSet(e.target.value === "" ? null : Number(e.target.value));
        }}
        className="w-full bg-transparent px-2 py-1 text-sm outline-none dark:text-neutral-200"
      />
    );
  }
  const pct = Math.max(0, Math.min(100, num));
  return (
    <button
      data-testid={testid}
      onClick={() => setEditing(true)}
      className="flex w-full items-center gap-2 px-2 py-1 text-left"
    >
      <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-700">
        <span
          data-testid={testid.replace("db-cell-", "db-number-bar-")}
          style={{ width: `${pct}%` }}
          className="block h-full rounded-full bg-blue-500"
        />
      </span>
      <span className="shrink-0 text-xs text-neutral-500">{formatNumber(num, prop.config.numberFormat, intl)}</span>
    </button>
  );
}

/** URL cell: renders a clickable link when not being edited;
 * click into the cell to edit the raw value. */
function UrlCell({
  testid,
  value,
  onCommit,
  variant = "cell",
}: {
  testid: string;
  value: string;
  onCommit: (v: string) => void;
  variant?: "cell" | "page";
}) {
  const t = useT();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const ref = useRef(value);
  useEffect(() => {
    if (value !== ref.current) {
      ref.current = value;
      setDraft(value);
    }
  }, [value]);

  if (editing || !value) {
    return (
      <input
        data-testid={testid}
        autoFocus={editing}
        value={draft}
        placeholder="https://…"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          setEditing(false);
          if (draft !== value) onCommit(draft);
        }}
        onKeyDown={(e) => {
          if (!isImeComposing(e) && e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
        className="w-full bg-transparent px-2 py-1 text-sm outline-none dark:text-neutral-200"
      />
    );
  }
  const link = classifyLink(value);
 // what lands on the clipboard has to survive a paste elsewhere, so an
 // app-relative path is copied with its origin — the raw "/p/<id>" is not a link
  const href = link.kind === "text" ? value : absoluteHref(link.href);
  return (
    <div
      data-testid={testid}
      className={`group/urlcell flex items-center gap-1 px-2 ${variant === "page" ? "py-1.5" : "py-1"}`}
    >
      <div className="min-w-0 flex-1">
        <UrlValue value={value} variant={variant} testid={testid} />
      </div>
      {/* hover actions: open in new tab + copy */}
      <button
        data-testid={`db-url-copy-${testid}`}
        onClick={async (e) => {
          e.stopPropagation();
          const el = e.currentTarget;
          if (await copyText(href)) {
            el.textContent = "✓";
            setTimeout(() => {
              el.textContent = "⧉";
            }, 1200);
          }
        }}
        aria-label={t("Copy URL")}
        data-tip={t("Copy link")}
        className="shrink-0 rounded px-1 text-xs text-neutral-400 touch-reveal opacity-0 transition-opacity hover:text-neutral-600 group-hover/urlcell:opacity-100"
      >
        ⧉
      </button>
      <button
        data-testid={`db-url-edit-${testid}`}
        onClick={() => setEditing(true)}
        aria-label={t("Edit URL")}
        className="ml-auto shrink-0 px-1 text-xs text-neutral-400 hover:text-neutral-600"
      >
        ✎
      </button>
    </div>
  );
}

function SelectCell({
  testid,
  prop,
  value,
  onSet,
}: {
  testid: string;
  prop: DbProperty;
  value: unknown;
  onSet: (v: unknown) => void;
}) {
  const db = useDb();
  const t = useT();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const cellRef = useRef<HTMLElement | null>(null);
  const current = findOption(prop, value);
  const options = prop.config.options ?? [];

  const popRef = useRef<HTMLDivElement>(null);
 // A status property gets its own menu (StatusPicker), which anchors and
 // dismisses itself. Leaving these two running would close it on the first
 // mousedown INSIDE it — its portal is outside both refs below — and the click
 // would never reach the option. That is the person-picker bug, again.
  const plainOpen = open && prop.type !== "status";
 // portalled to the body, so the cell's one-line clipping cannot cut it and it
 // flips above the cell near the bottom of the window
  // covers the cell (the original's box starts 1px up and left of it), not
  // the padded box inside — measured 2026-08-27 on a table cell AND on a page
  // value cell: 300 wide, radius 6, one 28×292 row per option.
  useAnchored(plainOpen, cellRef, popRef, { cover: true });
  useDismiss(plainOpen, () => setOpen(false), ref, popRef);

 // A STABLE callback: an inline arrow gets a new identity every render, so
 // React detaches the old ref (nulling cellRef) and re-attaches on every
 // commit — including the commit that mounts StatusPicker, whose layout
 // effect then reads cellRef mid-detach and the menu never gets placed.
 // Dev's StrictMode re-runs the effect and hid this; production did not.
  const attachRef = useCallback((el: HTMLDivElement | null) => {
    ref.current = el;
 // the menu covers the CELL, not this padded box inside it
    cellRef.current =
      (el?.closest("[data-cellnav], [data-role='value']") as HTMLElement | null) ?? el;
  }, []);

  return (
    <div
      ref={attachRef}
      className="relative min-w-0 py-1 pl-[7px] pr-1.5"
    >
      <button
        data-testid={testid}
        onClick={() => setOpen((v) => !v)}
        className="flex min-h-[1.5rem] w-full items-center overflow-hidden"
      >
        {current ? (
          <OptionChip color={current.color} title={current.name} dot={prop.type === "status"}>
            {current.name}
          </OptionChip>
        ) : (
          <span className="inline-block h-5 w-full" aria-hidden="true" />
        )}
      </button>
      {open && prop.type === "status" && (
        <StatusPicker
          prop={prop}
          value={value}
          slug={testid.replace("db-cell-", "")}
          anchorRef={cellRef}
          onSet={onSet}
          onClose={() => setOpen(false)}
        />
      )}
      {plainOpen &&
        createPortal(
          <div
            ref={popRef}
            data-testid="db-select-menu"
            style={{ visibility: "hidden", width: 300, boxShadow: PICKER_SHADOW, transform: "translate(-1px, -1px)" }}
            className="popover-anim fixed z-50 flex flex-col overflow-auto rounded-[6px] bg-white p-1 dark:bg-neutral-800"
          >
          {/* search bar: the chosen value as a chip, then the caret — the
              Status menu's bar, in the same box */}
          <div className="mb-1 shrink-0 rounded-[6px] bg-[rgba(242,241,238,0.6)] dark:bg-neutral-700/40">
            <div className="flex max-h-[240px] flex-wrap items-center gap-1.5 overflow-y-auto px-2 pb-[6px] pt-[5px]">
              {current && (
                <OptionChip color={current.color} title={current.name}>
                  {current.name}
                </OptionChip>
              )}
              <input
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={current ? "" : t("Select or create an option")}
                className="h-5 min-w-[40px] flex-1 bg-transparent text-[14px] leading-5 text-[rgb(44,44,43)] outline-none placeholder:text-[rgb(161,158,153)] dark:text-neutral-200"
              />
            </div>
          </div>
          {!!value && (
            <button
              data-testid={`db-option-${prop.id}-none`}
              onClick={() => {
                onSet(null);
                setOpen(false);
              }}
              className="flex h-7 w-full items-center rounded-[6px] px-2 text-left text-[14px] text-neutral-500 hover:bg-[rgba(33,27,23,0.051)] dark:hover:bg-neutral-700"
            >
              {t("Clear")}
            </button>
          )}
          {options
            .filter((o) => o.name.toLowerCase().includes(q.toLowerCase()))
            .map((o) => (
              <div key={o.id}>
                <button
                  data-testid={`db-option-${prop.id}-${o.id}`}
                  onClick={() => {
                    onSet(o.id);
                    setOpen(false);
                  }}
                  className="flex h-7 w-full min-w-0 items-center rounded-[6px] px-2 text-left hover:bg-[rgba(33,27,23,0.051)] dark:hover:bg-neutral-700"
                >
                  <OptionChip color={o.color} title={o.name} dot={prop.type === "status"}>
                    {o.name}
                  </OptionChip>
                </button>
              </div>
            ))}
          {q && !options.some((o) => o.name.toLowerCase() === q.toLowerCase()) && (
            <button
              data-testid={`db-option-create`}
              onClick={async () => {
                const opt = await db.addSelectOption(prop, q);
                onSet(opt.id);
                setQ("");
                setOpen(false);
              }}
              className="block w-full rounded px-2 py-1 text-left text-xs text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-700"
            >
              {t("Create “{q}”", { q })}
            </button>
          )}
          </div>,
          document.body
        )}
    </div>
  );
}

/** Files & media: an ordered list of URLs. Renders each as an opening link and
 * offers an input to append another. Stored as a string[] in the row value. */
function FilesCell({
  testid,
  value,
  onSet,
}: {
  testid: string;
  value: unknown;
  onSet: (v: unknown) => void;
}) {
  const t = useT();
  const urls: string[] = Array.isArray(value) ? (value as string[]).filter((u) => typeof u === "string") : [];
  const [draft, setDraft] = useState("");
  const add = () => {
    const u = draft.trim();
    if (!u) return;
    onSet([...urls, u]);
    setDraft("");
  };
  const removeAt = (i: number) => onSet(urls.filter((_, j) => j !== i));
  return (
    <div data-testid={testid} className="flex flex-wrap items-center gap-1 px-1.5 py-1">
      {urls.map((u, i) => (
        <span
          key={`${u}-${i}`}
          data-testid={`db-file-chip-${i}`}
          className="flex items-center gap-1 rounded bg-neutral-100 px-1.5 py-0.5 text-xs text-neutral-700 dark:bg-neutral-700 dark:text-neutral-200"
        >
          <a href={u} target="_blank" rel="noopener noreferrer" className="max-w-[10rem] truncate underline">
            {u.split("/").pop() || u}
          </a>
          <button
            data-testid={`db-file-remove-${i}`}
            onClick={() => removeAt(i)}
            className="text-neutral-400 hover:text-red-500"
            aria-label={t("Remove file")}
          >
            ×
          </button>
        </span>
      ))}
      <label className="cursor-pointer text-xs text-neutral-400 hover:text-neutral-600" title={t("Upload file")}>
        ⬆
        <input
          data-testid={`${testid}-upload`}
          type="file"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            void (async () => {
              const up = await uploadBlob(f, "file");
              if (up) onSet([...urls, up.url]);
            })();
          }}
        />
      </label>
      <input
        data-testid={`${testid}-input`}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (!isImeComposing(e) && e.key === "Enter") add();
        }}
        onBlur={add}
        placeholder={t("Add file URL…")}
        className="min-w-[6rem] flex-1 bg-transparent px-1 py-0.5 text-xs outline-none dark:text-neutral-200"
      />
    </div>
  );
}

function PersonCell({
  testid,
  value,
  onSet,
  collapse,
}: {
  testid: string;
  value: unknown;
  onSet: (v: unknown) => void;
  /** the pinned band's rule: one chip, then `+ N` */
  collapse?: boolean;
}) {
  const db = useDb();
  const t = useT();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
 // several people per cell (the capture's `Assignee` holds two); the popover
 // toggles them rather than replacing the value
  const picked = personIds(value);
  const people = personLabels(db.members, value, t);
  const slug = testid.split("db-cell-")[1];
  const [query, setQuery] = useState("");
  const [anchor, setAnchor] = useState({ left: 0, top: 0, width: 235 });

 // people not already in the cell, filtered by the search box — the original
 // lists only the ones you could still add
  const q = query.trim().toLowerCase();
  const candidates = db.members.filter(
    (m) =>
      !picked.includes(m.id) &&
      (!q ||
        (m.displayName ?? "").toLowerCase().includes(q) ||
        (m.email ?? "").toLowerCase().includes(q))
  );

  const openAt = () => {
 // Anchored to the CELL and covering it, the original's way: box.left−1,
 // box.top−1, width max(240, cell), height a fixed 333 with the list scrolling
 // inside (e2e/fixtures/notion-person-picker.json). A 117px cell still gets
 // 240 — the width follows the cell only once the cell is wider than that.
    const cell = (ref.current?.closest("[data-cellnav]") as HTMLElement | null) ?? ref.current;
    const box = cell?.getBoundingClientRect();
    if (box) {
      const width = Math.max(PICKER_MIN_W, Math.round(box.width));
      setAnchor({
        left: Math.round(Math.min(box.left - 1, window.innerWidth - width - 8)),
        top: Math.round(Math.min(box.top - 1, window.innerHeight - POPOVER_MAX_H - 8)),
        width,
      });
    }
    setQuery("");
    setOpen((v) => !v);
  };

  useDismiss(open, () => setOpen(false), ref, popRef);

  function toggle(id: string) {
    const next = picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id];
    onSet(next.length ? next : null);
  }

 // However many people a cell holds it stays one line and is simply clipped by
 // the column — the real table has no "N more" in a cell (that pill is a
 // filter chip in the toolbar, which is where `target.html` has it).
  return (
    <div ref={ref} className="relative h-full w-full">
      <button
        data-testid={testid}
        onClick={openAt}
 // the whole cell opens the picker, as the original's does — its cell carries
 // `cursor: pointer` across its full width, not just over the names
        className="flex h-full min-h-[1.5rem] w-full cursor-pointer items-center gap-1 overflow-hidden px-1.5 py-1"
      >
        {people.length ? (
          <>
            {/* avatar → name is 6px in the original (margin-inline-end: 6px on the
                avatar), in the table's cells as well as the page's band */}
            {(collapse ? people.slice(0, 1) : people).map((p) => (
              <span key={p.id} className="flex shrink-0 items-center gap-1.5">
                <UserAvatar user={{ displayName: p.label, avatarUrl: p.avatarUrl }} size={20} />
                <span className="whitespace-nowrap text-sm text-neutral-700 dark:text-neutral-200">
                  {p.label}
                </span>
              </span>
            ))}
            {collapse && people.length > 1 && (
              /* 4px after the chip, 21px tall — which is what makes the band's
                 person value 31 rather than 30 */
              <span
                data-role="person-overflow"
                className="flex h-[21px] shrink-0 items-center whitespace-nowrap text-sm leading-[21px] text-neutral-700 dark:text-neutral-200"
              >
                + {people.length - 1}
              </span>
            )}
          </>
        ) : (
          <span className="inline-block h-5 w-full" aria-hidden="true" />
        )}
      </button>
      {open &&
        createPortal(
 // In a portal, positioned against the cell: the table's cells clip their
 // content to one line, and a popover rendered inside one was cut off.
          <div
            ref={popRef}
            data-testid={`db-person-popover-${slug}`}
            style={{
              left: anchor.left,
              top: anchor.top,
              width: anchor.width,
              height: POPOVER_MAX_H,
              boxShadow: PICKER_SHADOW,
            }}
            className="popover-anim fixed z-50 flex flex-col overflow-hidden rounded-[6px] bg-white dark:bg-neutral-800"
          >
            {/* The bar: whoever is already in the cell, then the caret. The
                original draws them as avatar + name + a Remove item button, with
                no pill behind them, and lets the input take what is left of
                the line. Rows are 24 apart, the first at y=9, 10px at the
                bottom — an empty bar is exactly 39 tall. */}
            <div
              className="shrink-0 overflow-y-auto rounded-[6px] bg-[rgba(242,241,238,0.6)] px-3 pb-[10px] pt-[9px] dark:bg-neutral-700/40"
              style={{ maxHeight: 240 }}
            >
              <div className="flex flex-wrap items-center gap-x-[6px] gap-y-1">
                {people.map((p) => (
                  <span key={p.id} className="flex h-5 items-center">
                    <UserAvatar user={{ displayName: p.label, avatarUrl: p.avatarUrl }} size={20} />
                    <span className="ml-[6px] max-w-[12rem] truncate text-[14px] leading-5 text-[rgb(44,44,43)] dark:text-neutral-200">
                      {p.label}
                    </span>
                    <button
                      data-testid={`db-person-${slug}-remove-${p.id}`}
                      aria-label={t("Remove item")}
                      onClick={() => toggle(p.id)}
                      className="ml-[2px] flex h-5 w-5 items-center justify-center text-neutral-400 transition-colors hover:text-neutral-700 dark:hover:text-neutral-200"
                    >
                      <X size={12} />
                    </button>
                  </span>
                ))}
                <input
                  data-testid={`db-person-${slug}-search`}
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="h-5 min-w-[40px] flex-1 bg-transparent text-[14px] leading-5 text-[rgb(44,44,43)] outline-none dark:text-neutral-100"
                />
              </div>
            </div>
            {/* the padding lives on the wrapper: in the original the label's own
                box starts 10px under the bar and 12px in, so the text element —
                not its padding — is what has to land there */}
            <div className="shrink-0 px-3 pt-[10px] text-[12px] leading-[14px]">
              <span className="font-medium text-[rgb(125,122,117)]">{t("Select as many as you like")}</span>
            </div>
            <div className="mt-[9px] min-h-0 flex-1 overflow-y-auto">
            {candidates.map((m) => (
              <button
                key={m.id}
                data-testid={`db-person-${slug}-${m.id}`}
                onClick={() => toggle(m.id)}
                className="mx-1 flex h-7 items-center gap-2 rounded-[6px] px-2 text-left transition-colors hover:bg-[rgba(33,27,23,0.051)] dark:hover:bg-neutral-700"
                style={{ width: "calc(100% - 8px)" }}
              >
                <UserAvatar user={m} size={20} />
                <span className="flex-1 truncate text-[14px] leading-5 text-[rgb(44,44,43)] dark:text-neutral-200">
                  {m.displayName || m.email || t("Unnamed")}
                  {m.id === db.me && <span className="text-[rgb(125,122,117)]">{t("(You)")}</span>}
                </span>
              </button>
            ))}
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}

