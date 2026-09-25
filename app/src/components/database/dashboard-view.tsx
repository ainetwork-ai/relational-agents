"use client";

import { useState } from "react";
import { Plus, X, ChevronLeft, ChevronRight, Pencil, Check } from "lucide-react";
import type { DashWidget, DbProperty, DbRow, DbView } from "@/lib/db/schema";
import { applyView, groupRowsBy, optionClass, isGroupable } from "@/lib/db-values";
import type { PublicUser } from "@/lib/auth/public-user";
import type { T } from "@/i18n/translate";
import { useT } from "@/i18n/provider";
import { useDb } from "./database-block";
import { BoardView } from "./board-view";
import { UrlValue } from "./url-value";

// ===========================================================================
// Dashboard view — per .com/help/dashboards: a widget canvas over one
// database. Up to 12 widgets, up to 4 per row (width = quarters of a row);
// each widget carries its own data config (group-by, aggregate, row cap).
// EDIT mode arranges/configures widgets; VIEW mode is for reading and
// clicking through. The view's own filters/sorts act as the global filter.
// ===========================================================================

const MAX_WIDGETS = 12;

const KINDS: { kind: DashWidget["kind"]; label: string }[] = [
  { kind: "counter", label: "카운터" },
  { kind: "bar", label: "막대 차트" },
  { kind: "donut", label: "도넛 차트" },
  { kind: "chart", label: "차트" },
  { kind: "depth", label: "깊이" },
  { kind: "table", label: "표" },
  { kind: "board", label: "보드" },
  { kind: "list", label: "리스트" },
];

const BUCKET_MS: Record<NonNullable<DashWidget["bucket"]>, number> = {
  hour: 3_600_000,
  day: 86_400_000,
  week: 7 * 86_400_000,
};

// svg viewBox width per widget width — keeps text at a readable rendered size
const PLOT_W: Record<DashWidget["width"], number> = { 1: 260, 2: 420, 3: 560, 4: 700 };

// SVG needs literal colors; these mirror the option-chip palette
const OPTION_HEX: Record<string, string> = {
  gray: "#9ca3af", blue: "#60a5fa", green: "#4ade80", red: "#f87171",
  yellow: "#facc15", purple: "#c084fc", orange: "#fb923c", pink: "#f472b6",
};

function newId() {
  return Math.random().toString(36).slice(2, 10);
}

/** Group rows and aggregate a value per group (count, or sum of a number). */
function seriesFor(
  rows: DbRow[],
  prop: DbProperty | undefined,
  w: DashWidget,
  members: PublicUser[] = []
) {
  const groups = groupRowsBy(rows, prop, members) ?? [];
  const colorOf = (key: string) => prop?.config.options?.find((o) => o.id === key)?.color ?? "gray";
  return groups
    .map((g) => ({
      key: g.key,
      label: g.label,
      color: colorOf(g.key),
      value:
        w.aggregate === "sum" && w.aggregatePropertyId
          ? g.rows.reduce((a, r) => a + (Number(r.values[w.aggregatePropertyId!]) || 0), 0)
          : g.rows.length,
    }))
    .filter((s) => s.value > 0);
}

/** Counter value → display string: grouping + decimals + literal prefix/suffix. */
function formatCounter(value: number, w: DashWidget) {
  const opts: Intl.NumberFormatOptions =
    w.decimals != null
      ? { minimumFractionDigits: w.decimals, maximumFractionDigits: w.decimals }
      : { maximumFractionDigits: 2 };
  // sign sits before the prefix ("-$120.50", "+$1,204.55"), never inside it
  const sign = value < 0 ? "-" : w.colorBySign && value > 0 ? "+" : "";
  return `${sign}${w.prefix ?? ""}${Math.abs(value).toLocaleString("en-US", opts)}${w.suffix ?? ""}`;
}

function aggLabel(t: T, w: DashWidget, props: DbProperty[]) {
  if (w.aggregate === "sum") {
    const p = props.find((x) => x.id === w.aggregatePropertyId);
    return p ? t("{name} 합계", { name: p.name }) : t("합계");
  }
  return t("개수");
}

export function DashboardView({ view }: { view: DbView }) {
  const db = useDb();
  const t = useT();
  const rows = applyView(db.rows, db.properties, view.config, db.me, db.related);
  const titleProp = db.properties.find((p) => p.type === "title");
  const groupable = db.properties.filter(isGroupable);
  const numberProps = db.properties.filter((p) => p.type === "number");
  const dateProps = db.properties.filter((p) => p.type === "date");
  const [editing, setEditing] = useState(false);
  const [addOpen, setAddOpen] = useState(false);

 // an unconfigured dashboard gets a sensible starter layout (not persisted
 // until the user edits — also auto-suggests the first arrangement)
  const widgets: DashWidget[] =
    view.config.widgets ??
    ([
      { id: "w-count", kind: "counter", width: 1, aggregate: "count" },
      groupable[0] && { id: "w-donut", kind: "donut", width: 1, groupByPropertyId: groupable[0].id, aggregate: "count" },
      groupable[0] && { id: "w-bar", kind: "bar", width: 2, groupByPropertyId: groupable[0].id, aggregate: "count" },
      { id: "w-table", kind: "table", width: 4, limit: 5 },
    ].filter(Boolean) as DashWidget[]);

  const save = (next: DashWidget[]) => db.patchView({ ...view.config, widgets: next });
  const patchWidget = (id: string, patch: Partial<DashWidget>) =>
    save(widgets.map((w) => (w.id === id ? { ...w, ...patch } : w)));
  const move = (id: string, dir: -1 | 1) => {
    const i = widgets.findIndex((w) => w.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= widgets.length) return;
    const next = [...widgets];
    [next[i], next[j]] = [next[j], next[i]];
    save(next);
  };
  const addWidget = (kind: DashWidget["kind"]) => {
    if (widgets.length >= MAX_WIDGETS) return;
    const w: DashWidget = {
      id: newId(),
      kind,
      width: kind === "table" || kind === "board" ? 4 : kind === "chart" ? 2 : 1,
      aggregate: "count",
      groupByPropertyId: groupable[0]?.id,
      limit: 5,
      ...(kind === "chart" && {
        chartType: "line" as const,
        xPropertyId: dateProps[0]?.id,
        yPropertyId: numberProps[0]?.id,
      }),
      ...(kind === "depth" && { xPropertyId: numberProps[0]?.id }),
    };
    save([...widgets, w]);
  };

  const rowTitle = (r: DbRow) => (titleProp && (r.values[titleProp.id] as string)) || t("제목 없음");

 // ---- per-kind bodies -------------------------------------------------------

  const renderCounter = (w: DashWidget) => {
    const value =
      w.aggregate === "sum" && w.aggregatePropertyId
        ? rows.reduce((a, r) => a + (Number(r.values[w.aggregatePropertyId!]) || 0), 0)
        : rows.length;
    const signCls =
      w.colorBySign && value > 0
        ? "text-green-600 dark:text-green-400"
        : w.colorBySign && value < 0
          ? "text-red-500 dark:text-red-400"
          : "text-neutral-800 dark:text-neutral-100";
    return (
      <div className="flex h-full flex-col justify-center py-2">
        <div data-testid={`db-dashw-value-${w.id}`} className={`text-2xl font-bold tracking-tight ${signCls}`}>
          {formatCounter(value, w)}
        </div>
        <div className="mt-0.5 text-[11px] font-medium text-neutral-400">{aggLabel(t, w, db.properties)}</div>
      </div>
    );
  };

  const renderBar = (w: DashWidget) => {
    const prop = db.properties.find((p) => p.id === w.groupByPropertyId) ?? groupable[0];
    const series = seriesFor(rows, prop, w, db.members);
    const max = Math.max(1, ...series.map((s) => s.value));
    if (!prop) return <p className="text-xs text-neutral-400">{t("선택 또는 상태 속성을 고르세요.")}</p>;
    return (
      <div className="flex flex-col gap-1.5 py-1">
        {series.map((s) => (
          <div key={s.key} className="flex items-center gap-2">
            <span className={`w-24 shrink-0 truncate rounded px-1.5 py-0.5 text-[11px] font-medium ${optionClass(s.color)}`}>{s.label}</span>
            <div className="h-3.5 flex-1 overflow-hidden rounded-sm bg-neutral-100 dark:bg-neutral-700/60">
              <div className={`h-full rounded-sm ${optionClass(s.color)}`} style={{ width: `${Math.round((s.value / max) * 100)}%` }} />
            </div>
            <span className="w-9 shrink-0 text-right text-xs tabular-nums text-neutral-500">{s.value}</span>
          </div>
        ))}
        {series.length === 0 && <p className="text-xs text-neutral-400">{t("표시할 값이 없습니다")}</p>}
      </div>
    );
  };

  const renderDonut = (w: DashWidget) => {
    const prop = db.properties.find((p) => p.id === w.groupByPropertyId) ?? groupable[0];
    const series = seriesFor(rows, prop, w, db.members);
    const total = series.reduce((a, s) => a + s.value, 0);
    const R = 34, C = 2 * Math.PI * R, GAP = series.length > 1 ? 2 : 0;
    let acc = 0;
    return (
      <div className="flex items-center gap-3 py-1">
        <svg width="88" height="88" viewBox="0 0 88 88" className="shrink-0 -rotate-90">
          {series.map((s) => {
            const len = total ? (s.value / total) * C : 0;
            const el = (
              <circle
                key={s.key}
                cx="44" cy="44" r={R} fill="none"
                stroke={OPTION_HEX[s.color] ?? OPTION_HEX.gray}
                strokeWidth="11"
                strokeDasharray={`${Math.max(len - GAP, 0.5)} ${C - Math.max(len - GAP, 0.5)}`}
                strokeDashoffset={-acc}
              />
            );
            acc += len;
            return el;
          })}
          <text x="44" y="44" transform="rotate(90 44 44)" textAnchor="middle" dominantBaseline="central" className="fill-neutral-800 text-base font-bold dark:fill-neutral-100">
            {total}
          </text>
        </svg>
        <div className="flex min-w-0 flex-col gap-1">
          {series.map((s) => (
            <div key={s.key} className="flex items-center gap-1.5 text-[11px] text-neutral-600 dark:text-neutral-300">
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: OPTION_HEX[s.color] ?? OPTION_HEX.gray }} />
              <span className="truncate">{s.label}</span>
              <span className="ml-auto pl-2 tabular-nums text-neutral-400">{s.value}</span>
            </div>
          ))}
          {series.length === 0 && <p className="text-xs text-neutral-400">{t("표시할 값이 없습니다")}</p>}
        </div>
      </div>
    );
  };

  const renderChart = (w: DashWidget) => {
    const xProp = db.properties.find((p) => p.id === w.xPropertyId) ?? db.properties.find((p) => p.type === "date");
    const yProp = db.properties.find((p) => p.id === w.yPropertyId) ?? numberProps[0];
    const markerProp = db.properties.find((p) => p.id === w.markerPropertyId);
    if (!xProp || !yProp)
      return <p className="text-xs text-neutral-400">{t("날짜 속성과 숫자 속성이 필요합니다.")}</p>;

    const pts = rows
      .map((r) => ({ row: r, t: Date.parse(String(r.values[xProp.id] ?? "")), v: Number(r.values[yProp.id]) }))
      .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.v))
      .sort((a, b) => a.t - b.t);
    if (pts.length === 0) return <p className="text-xs text-neutral-400">{t("표시할 값이 없습니다")}</p>;

    // plot geometry — viewBox sized to the widget width, scales responsively
    const W = PLOT_W[w.width] ?? 560, H = 170, L = W < 300 ? 48 : 62, R = 10, T = 10, B = 20;
    const plotW = W - L - R, plotH = H - T - B;
    // candles sit at bucket centers, so the x domain must span whole buckets —
    // otherwise a candle for a short burst of rows lands outside the canvas
    const bucketMs = BUCKET_MS[w.bucket ?? "day"];
    const t0 = w.chartType === "candles" ? Math.floor(pts[0].t / bucketMs) * bucketMs : pts[0].t;
    const t1 = w.chartType === "candles" ? (Math.floor(pts[pts.length - 1].t / bucketMs) + 1) * bucketMs : pts[pts.length - 1].t;
    let vMin = Math.min(...pts.map((p) => p.v)), vMax = Math.max(...pts.map((p) => p.v));
    if (vMin === vMax) { vMin -= 1; vMax += 1; }
    const pad = (vMax - vMin) * 0.08;
    vMin -= pad; vMax += pad;
    const x = (tm: number) => L + (t1 === t0 ? plotW / 2 : ((tm - t0) / (t1 - t0)) * plotW);
    const y = (v: number) => T + plotH - ((v - vMin) / (vMax - vMin)) * plotH;
    const fmtV = (v: number) => v.toLocaleString("en-US", { notation: Math.abs(v) >= 10_000 ? "compact" : "standard", maximumFractionDigits: 2 });
    const fmtT = (tm: number) => {
      const d = new Date(tm);
      return t1 - t0 < 2 * 86_400_000
        ? `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
        : `${d.getMonth() + 1}/${d.getDate()}`;
    };

    // candles: open/high/low/close of the y values inside each time bucket
    const candles: { t: number; o: number; h: number; l: number; c: number }[] = [];
    if (w.chartType === "candles") {
      const byBucket = new Map<number, { t: number; o: number; h: number; l: number; c: number }>();
      for (const p of pts) {
        const k = Math.floor(p.t / bucketMs);
        const b = byBucket.get(k);
        if (!b) byBucket.set(k, { t: k * bucketMs + bucketMs / 2, o: p.v, h: p.v, l: p.v, c: p.v });
        else { b.h = Math.max(b.h, p.v); b.l = Math.min(b.l, p.v); b.c = p.v; }
      }
      candles.push(...[...byBucket.values()].sort((a, b) => a.t - b.t));
    }
    const candleW = Math.max(2, Math.min(14, (plotW / Math.max(candles.length, 1)) * 0.68));

    const gridV = [vMin + pad, (vMin + vMax) / 2, vMax - pad];
    return (
      <div className="py-1">
        <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" data-testid={`db-dashw-chart-${w.id}`}>
          {gridV.map((v) => (
            <g key={v}>
              <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} className="stroke-neutral-100 dark:stroke-neutral-700/60" strokeWidth="1" />
              <text x={L - 6} y={y(v)} textAnchor="end" dominantBaseline="central" className="fill-neutral-400 text-[10px] tabular-nums">{fmtV(v)}</text>
            </g>
          ))}
          <text x={L} y={H - 4} className="fill-neutral-400 text-[10px]">{fmtT(t0)}</text>
          <text x={W - R} y={H - 4} textAnchor="end" className="fill-neutral-400 text-[10px]">{fmtT(t1)}</text>

          {w.chartType === "candles" ? (
            candles.map((c, i) => {
              const up = c.c >= c.o;
              const color = up ? OPTION_HEX.green : OPTION_HEX.red;
              const bodyTop = y(Math.max(c.o, c.c));
              const bodyH = Math.max(1.5, Math.abs(y(c.o) - y(c.c)));
              return (
                <g key={i} data-chart-candle>
                  <title>{`${fmtT(c.t)}  O ${fmtV(c.o)} · H ${fmtV(c.h)} · L ${fmtV(c.l)} · C ${fmtV(c.c)}`}</title>
                  <line x1={x(c.t)} x2={x(c.t)} y1={y(c.h)} y2={y(c.l)} stroke={color} strokeWidth="1.5" />
                  <rect x={x(c.t) - candleW / 2} y={bodyTop} width={candleW} height={bodyH} rx="1" fill={color} />
                </g>
              );
            })
          ) : (
            <path
              data-chart-line
              d={pts.map((p, i) => `${i === 0 ? "M" : "L"}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join("")}
              fill="none" stroke={OPTION_HEX.blue} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round"
            />
          )}

          {markerProp &&
            pts.map((p) => {
              const opt = markerProp.config.options?.find((o) => o.id === p.row.values[markerProp.id]);
              if (!opt) return null;
              return (
                <circle
                  key={p.row.id}
                  data-chart-marker
                  cx={x(p.t)} cy={y(p.v)} r="3.5"
                  fill={OPTION_HEX[opt.color] ?? OPTION_HEX.gray}
                  className="stroke-white dark:stroke-neutral-800"
                  strokeWidth="1.5"
                >
                  <title>{`${opt.name} · ${fmtV(p.v)} · ${fmtT(p.t)}`}</title>
                </circle>
              );
            })}
        </svg>
        {markerProp && (
          <div className="mt-1 flex flex-wrap gap-2">
            {(markerProp.config.options ?? []).map((o) => (
              <span key={o.id} className="flex items-center gap-1 text-[10px] text-neutral-500">
                <span className="h-2 w-2 rounded-full" style={{ background: OPTION_HEX[o.color] ?? OPTION_HEX.gray }} />
                {o.name}
              </span>
            ))}
          </div>
        )}
      </div>
    );
  };

  // two-sided cumulative step area: rows split by a select property's first two
  // options, accumulated along a number property (order-book style)
  const renderDepth = (w: DashWidget) => {
    const levelProp = db.properties.find((p) => p.id === w.xPropertyId) ?? numberProps[0];
    const sizeProp = db.properties.find((p) => p.id === w.aggregatePropertyId);
    const sideProp = db.properties.find((p) => p.id === w.groupByPropertyId) ?? groupable[0];
    const sides = (sideProp?.config.options ?? []).slice(0, 2);
    if (!levelProp || !sideProp || sides.length < 2)
      return <p className="text-xs text-neutral-400">{t("숫자 속성과 옵션 2개 이상의 선택 속성이 필요합니다.")}</p>;

    const levels = (optId: string) => {
      const byLevel = new Map<number, number>();
      for (const r of rows) {
        if (r.values[sideProp.id] !== optId) continue;
        const lv = Number(r.values[levelProp.id]);
        if (!Number.isFinite(lv)) continue;
        const sz = sizeProp ? Number(r.values[sizeProp.id]) || 0 : 1;
        byLevel.set(lv, (byLevel.get(lv) ?? 0) + sz);
      }
      return [...byLevel.entries()].map(([level, size]) => ({ level, size }));
    };
    // left side accumulates from its best (highest) level outward; right side
    // from its best (lowest) level outward — classic bid/ask reading
    const left = levels(sides[0].id).sort((a, b) => b.level - a.level);
    const right = levels(sides[1].id).sort((a, b) => a.level - b.level);
    let acc = 0;
    const leftCum = left.map((l) => ({ ...l, cum: (acc += l.size) }));
    acc = 0;
    const rightCum = right.map((l) => ({ ...l, cum: (acc += l.size) }));
    if (leftCum.length === 0 && rightCum.length === 0)
      return <p className="text-xs text-neutral-400">{t("표시할 값이 없습니다")}</p>;

    const W = PLOT_W[w.width] ?? 560, H = 170, L = W < 300 ? 36 : 46, R = 10, T = 10, B = 20;
    const plotW = W - L - R, plotH = H - T - B;
    const allLv = [...leftCum, ...rightCum].map((l) => l.level);
    let lv0 = Math.min(...allLv), lv1 = Math.max(...allLv);
    if (lv0 === lv1) { lv0 -= 1; lv1 += 1; }
    const cumMax = Math.max(...leftCum.map((l) => l.cum), ...rightCum.map((l) => l.cum), 1);
    const x = (lv: number) => L + ((lv - lv0) / (lv1 - lv0)) * plotW;
    const y = (c: number) => T + plotH - (c / cumMax) * plotH;
    const fmt = (v: number) => v.toLocaleString("en-US", { notation: Math.abs(v) >= 10_000 ? "compact" : "standard", maximumFractionDigits: 2 });

    // step path: horizontal run at each cumulative level, then rise at the next
    const stepPath = (cum: { level: number; cum: number }[]) => {
      if (!cum.length) return null;
      let d = `M${x(cum[0].level).toFixed(1)},${y(0).toFixed(1)}`;
      let prev = cum[0].level;
      for (const p of cum) {
        d += `L${x(prev).toFixed(1)},${y(p.cum).toFixed(1)}L${x(p.level).toFixed(1)},${y(p.cum).toFixed(1)}`;
        prev = p.level;
      }
      d += `L${x(prev).toFixed(1)},${y(0).toFixed(1)}Z`;
      return d;
    };

    return (
      <div className="py-1">
        <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" data-testid={`db-dashw-depth-${w.id}`}>
          {[cumMax / 2, cumMax].map((v) => (
            <g key={v}>
              <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} className="stroke-neutral-100 dark:stroke-neutral-700/60" strokeWidth="1" />
              <text x={L - 6} y={y(v)} textAnchor="end" dominantBaseline="central" className="fill-neutral-400 text-[10px] tabular-nums">{fmt(v)}</text>
            </g>
          ))}
          <text x={L} y={H - 4} className="fill-neutral-400 text-[10px] tabular-nums">{fmt(lv0)}</text>
          <text x={W - R} y={H - 4} textAnchor="end" className="fill-neutral-400 text-[10px] tabular-nums">{fmt(lv1)}</text>
          {[
            { cum: leftCum, opt: sides[0] },
            { cum: rightCum, opt: sides[1] },
          ].map(({ cum, opt }) => {
            const d = stepPath(cum);
            if (!d) return null;
            const color = OPTION_HEX[opt.color] ?? OPTION_HEX.gray;
            return (
              <g key={opt.id} data-depth-side={opt.id}>
                <title>{`${opt.name} · ${fmt(cum[cum.length - 1].cum)}`}</title>
                <path d={d} fill={color} fillOpacity="0.22" stroke={color} strokeWidth="2" strokeLinejoin="round" />
              </g>
            );
          })}
        </svg>
        <div className="mt-1 flex flex-wrap gap-3">
          {[
            { cum: leftCum, opt: sides[0] },
            { cum: rightCum, opt: sides[1] },
          ].map(({ cum, opt }) => (
            <span key={opt.id} className="flex items-center gap-1 text-[10px] text-neutral-500">
              <span className="h-2 w-2 rounded-full" style={{ background: OPTION_HEX[opt.color] ?? OPTION_HEX.gray }} />
              {opt.name}
              <span className="tabular-nums text-neutral-400">{cum.length ? fmt(cum[cum.length - 1].cum) : 0}</span>
            </span>
          ))}
        </div>
      </div>
    );
  };

  const renderTable = (w: DashWidget) => {
    const hidden = new Set(view.config.hiddenProperties ?? []);
    const cols = db.properties.filter((p) => p.type !== "title" && !hidden.has(p.id)).slice(0, 3);
    const list = rows.slice(0, w.limit ?? 5);
    return (
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="text-[10px] uppercase tracking-wide text-neutral-400">
              <th className="py-1 pr-2 font-medium">{titleProp?.name ?? t("이름")}</th>
              {cols.map((c) => (
                <th key={c.id} className="py-1 pr-2 font-medium">{c.name}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {list.map((r) => (
              <tr
                key={r.id}
                data-testid={`db-dashw-row-${r.id}`}
                onClick={() => db.openRow(r.id)}
                className="cursor-pointer border-t border-neutral-100 hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-800/60"
              >
                <td className="max-w-[220px] truncate py-1.5 pr-2 font-medium text-neutral-800 dark:text-neutral-100">{rowTitle(r)}</td>
                {cols.map((c) => {
                  const v = r.values[c.id];
                  const opt = c.config.options?.find((o) => o.id === v);
                  return (
                    <td key={c.id} className="max-w-[160px] truncate py-1.5 pr-2 text-neutral-500">
                      {opt ? (
                        <span className={`rounded px-1.5 py-0.5 text-[11px] ${optionClass(opt.color)}`}>{opt.name}</span>
                      ) : c.type === "url" && typeof v === "string" && v ? (
                       // a widget is still the database: a link shows what it
                       // points at here too, not the id it is stored under
                        <UrlValue value={v} testid={`${r.id}-${c.id}`} />
                      ) : (
                        String(v ?? "")
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        {list.length === 0 && <p className="py-2 text-xs text-neutral-400">{t("항목이 없습니다")}</p>}
      </div>
    );
  };

  const renderList = (w: DashWidget) => (
    <div className="flex flex-col">
      {rows.slice(0, w.limit ?? 5).map((r) => (
        <button
          key={r.id}
          data-testid={`db-dashw-row-${r.id}`}
          onClick={() => db.openRow(r.id)}
          className="truncate rounded px-1.5 py-1 text-left text-sm text-neutral-700 hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-700/60"
        >
          {rowTitle(r)}
        </button>
      ))}
      {rows.length === 0 && <p className="text-xs text-neutral-400">{t("항목이 없습니다")}</p>}
    </div>
  );

  const renderBoard = (w: DashWidget) => (
    <div className="overflow-x-auto">
      <BoardView view={{ ...view, type: "board", config: { ...view.config, groupByPropertyId: w.groupByPropertyId ?? groupable[0]?.id } }} />
    </div>
  );

  const BODY: Record<DashWidget["kind"], (w: DashWidget) => React.ReactNode> = {
    counter: renderCounter,
    bar: renderBar,
    donut: renderDonut,
    chart: renderChart,
    depth: renderDepth,
    table: renderTable,
    board: renderBoard,
    list: renderList,
  };

  const widgetTitle = (w: DashWidget) => {
    if (w.title) return w.title;
    const g = db.properties.find((p) => p.id === w.groupByPropertyId);
    if (w.kind === "counter") return aggLabel(t, w, db.properties);
    if (w.kind === "chart") {
      const yName = db.properties.find((p) => p.id === w.yPropertyId)?.name ?? numberProps[0]?.name;
      return yName ? t("{name} 차트", { name: yName }) : t("차트");
    }
    if (w.kind === "bar" || w.kind === "donut") return g ? t("{prop}별 {agg}", { prop: g.name, agg: aggLabel(t, w, db.properties) }) : t(KINDS.find((k) => k.kind === w.kind)!.label);
    return t(KINDS.find((k) => k.kind === w.kind)!.label);
  };

  return (
    <div data-testid="db-dashboard-view" className="flex flex-col gap-2 py-1">
      <div className="flex items-center gap-2">
        <span className="text-[11px] text-neutral-400">
          {t("위젯 {n}/{max}개", { n: widgets.length, max: MAX_WIDGETS })}
        </span>
        <div className="ml-auto flex items-center gap-1">
          {editing && (
            <div className="relative">
              <button
                data-testid="db-dashw-add"
                onClick={() => setAddOpen((v) => !v)}
                disabled={widgets.length >= MAX_WIDGETS}
                className="flex items-center gap-1 rounded border border-neutral-200 px-2 py-1 text-xs text-neutral-600 hover:bg-neutral-100 disabled:opacity-40 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
              >
                <Plus size={12} /> {t("위젯 추가")}
              </button>
              {addOpen && (
                <div className="popover-anim absolute right-0 top-8 z-40 w-36 rounded-lg border border-neutral-200 bg-white py-1 shadow-xl dark:border-neutral-700 dark:bg-neutral-800">
                  {KINDS.map((k) => (
                    <button
                      key={k.kind}
                      data-testid={`db-dashw-add-${k.kind}`}
                      onClick={() => {
                        setAddOpen(false);
                        addWidget(k.kind);
                      }}
                      className="block w-full px-3 py-1.5 text-left text-sm text-neutral-700 hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-700"
                    >
                      {t(k.label)}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          <button
            data-testid="db-dash-edit"
            onClick={() => setEditing((v) => !v)}
            className={`flex items-center gap-1 rounded px-2 py-1 text-xs transition-colors ${
              editing
                ? "bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-200"
                : "text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
            }`}
          >
            {editing ? <Check size={12} /> : <Pencil size={12} />}
            {editing ? t("완료") : t("위젯 편집")}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-3">
        {widgets.map((w) => (
          <div
            key={w.id}
            data-testid={`db-dashw-${w.id}`}
            style={{ gridColumn: `span ${Math.min(w.width, 4)} / span ${Math.min(w.width, 4)}` }}
            className="min-w-0 rounded-lg border border-neutral-200 bg-white p-3 dark:border-neutral-700 dark:bg-neutral-800/60"
          >
            <div className="mb-1.5 flex items-center gap-1">
              <span className="truncate text-[11px] font-semibold uppercase tracking-wide text-neutral-400">{widgetTitle(w)}</span>
              {editing && (
                <span className="ml-auto flex shrink-0 items-center gap-0.5">
                  <button data-testid={`db-dashw-left-${w.id}`} onClick={() => move(w.id, -1)} aria-label={t("왼쪽으로 이동")} className="rounded p-0.5 text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-700"><ChevronLeft size={12} /></button>
                  <button data-testid={`db-dashw-right-${w.id}`} onClick={() => move(w.id, 1)} aria-label={t("오른쪽으로 이동")} className="rounded p-0.5 text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-700"><ChevronRight size={12} /></button>
                  <button data-testid={`db-dashw-remove-${w.id}`} onClick={() => save(widgets.filter((x) => x.id !== w.id))} aria-label={t("위젯 삭제")} className="rounded p-0.5 text-neutral-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/30"><X size={12} /></button>
                </span>
              )}
            </div>

            {editing && (
              <div className="mb-2 flex flex-wrap items-center gap-1">
                <select
                  data-testid={`db-dashw-kind-${w.id}`}
                  value={w.kind}
                  onChange={(e) => patchWidget(w.id, { kind: e.target.value as DashWidget["kind"] })}
                  className="rounded border border-neutral-200 bg-white px-1 py-0.5 text-[11px] outline-none dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-200"
                >
                  {KINDS.map((k) => (
                    <option key={k.kind} value={k.kind}>{t(k.label)}</option>
                  ))}
                </select>
                {(w.kind === "bar" || w.kind === "donut" || w.kind === "board" || w.kind === "depth") && (
                  <select
                    data-testid={`db-dashw-group-${w.id}`}
                    value={w.groupByPropertyId ?? ""}
                    onChange={(e) => patchWidget(w.id, { groupByPropertyId: e.target.value || undefined })}
                    className="rounded border border-neutral-200 bg-white px-1 py-0.5 text-[11px] outline-none dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-200"
                  >
                    {groupable.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                )}
                {w.kind === "depth" && (
                  <select
                    data-testid={`db-dashw-x-${w.id}`}
                    value={w.xPropertyId ?? numberProps[0]?.id ?? ""}
                    onChange={(e) => patchWidget(w.id, { xPropertyId: e.target.value || undefined })}
                    className="rounded border border-neutral-200 bg-white px-1 py-0.5 text-[11px] outline-none dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-200"
                  >
                    {numberProps.map((p) => (
                      <option key={p.id} value={p.id}>{t("{name} 축", { name: p.name })}</option>
                    ))}
                  </select>
                )}
                {(w.kind === "counter" || w.kind === "bar" || w.kind === "donut" || w.kind === "depth") && (
                  <select
                    data-testid={`db-dashw-agg-${w.id}`}
                    value={w.aggregate === "sum" ? w.aggregatePropertyId ?? "" : "count"}
                    onChange={(e) =>
                      patchWidget(
                        w.id,
                        e.target.value === "count"
                          ? { aggregate: "count", aggregatePropertyId: undefined }
                          : { aggregate: "sum", aggregatePropertyId: e.target.value }
                      )
                    }
                    className="rounded border border-neutral-200 bg-white px-1 py-0.5 text-[11px] outline-none dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-200"
                  >
                    <option value="count">{t("개수")}</option>
                    {numberProps.map((p) => (
                      <option key={p.id} value={p.id}>{t("{name} 합계", { name: p.name })}</option>
                    ))}
                  </select>
                )}
                {w.kind === "chart" && (
                  <>
                    <select
                      data-testid={`db-dashw-charttype-${w.id}`}
                      value={w.chartType ?? "line"}
                      onChange={(e) => patchWidget(w.id, { chartType: e.target.value as DashWidget["chartType"] })}
                      className="rounded border border-neutral-200 bg-white px-1 py-0.5 text-[11px] outline-none dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-200"
                    >
                      <option value="line">{t("선")}</option>
                      <option value="candles">{t("캔들")}</option>
                    </select>
                    <select
                      data-testid={`db-dashw-x-${w.id}`}
                      value={w.xPropertyId ?? dateProps[0]?.id ?? ""}
                      onChange={(e) => patchWidget(w.id, { xPropertyId: e.target.value || undefined })}
                      className="rounded border border-neutral-200 bg-white px-1 py-0.5 text-[11px] outline-none dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-200"
                    >
                      {dateProps.map((p) => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                    <select
                      data-testid={`db-dashw-y-${w.id}`}
                      value={w.yPropertyId ?? numberProps[0]?.id ?? ""}
                      onChange={(e) => patchWidget(w.id, { yPropertyId: e.target.value || undefined })}
                      className="rounded border border-neutral-200 bg-white px-1 py-0.5 text-[11px] outline-none dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-200"
                    >
                      {numberProps.map((p) => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                    {w.chartType === "candles" && (
                      <select
                        data-testid={`db-dashw-bucket-${w.id}`}
                        value={w.bucket ?? "day"}
                        onChange={(e) => patchWidget(w.id, { bucket: e.target.value as DashWidget["bucket"] })}
                        className="rounded border border-neutral-200 bg-white px-1 py-0.5 text-[11px] outline-none dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-200"
                      >
                        <option value="hour">{t("시간별")}</option>
                        <option value="day">{t("일별")}</option>
                        <option value="week">{t("주별")}</option>
                      </select>
                    )}
                    <select
                      data-testid={`db-dashw-marker-${w.id}`}
                      value={w.markerPropertyId ?? ""}
                      onChange={(e) => patchWidget(w.id, { markerPropertyId: e.target.value || undefined })}
                      className="rounded border border-neutral-200 bg-white px-1 py-0.5 text-[11px] outline-none dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-200"
                    >
                      <option value="">{t("마커 없음")}</option>
                      {groupable.map((p) => (
                        <option key={p.id} value={p.id}>{t("{name} 마커", { name: p.name })}</option>
                      ))}
                    </select>
                  </>
                )}
                {w.kind === "counter" && (
                  <>
                    <select
                      data-testid={`db-dashw-decimals-${w.id}`}
                      value={w.decimals ?? "auto"}
                      onChange={(e) => patchWidget(w.id, { decimals: e.target.value === "auto" ? undefined : Number(e.target.value) })}
                      className="rounded border border-neutral-200 bg-white px-1 py-0.5 text-[11px] outline-none dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-200"
                    >
                      <option value="auto">{t("소수 자동")}</option>
                      {[0, 1, 2, 3, 4].map((n) => (
                        <option key={n} value={n}>{t("소수 {n}자리", { n })}</option>
                      ))}
                    </select>
                    <input
                      data-testid={`db-dashw-prefix-${w.id}`}
                      defaultValue={w.prefix ?? ""}
                      placeholder={t("접두어")}
                      onBlur={(e) => patchWidget(w.id, { prefix: e.target.value || undefined })}
                      className="w-14 rounded border border-neutral-200 bg-white px-1 py-0.5 text-[11px] outline-none dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-200"
                    />
                    <input
                      data-testid={`db-dashw-suffix-${w.id}`}
                      defaultValue={w.suffix ?? ""}
                      placeholder={t("접미어")}
                      onBlur={(e) => patchWidget(w.id, { suffix: e.target.value || undefined })}
                      className="w-14 rounded border border-neutral-200 bg-white px-1 py-0.5 text-[11px] outline-none dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-200"
                    />
                    <button
                      data-testid={`db-dashw-sign-${w.id}`}
                      onClick={() => patchWidget(w.id, { colorBySign: !w.colorBySign })}
                      className={`rounded border px-1 py-0.5 text-[11px] ${
                        w.colorBySign
                          ? "border-green-300 bg-green-50 text-green-700 dark:border-green-700 dark:bg-green-900/30 dark:text-green-300"
                          : "border-neutral-200 bg-white text-neutral-500 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-300"
                      }`}
                    >
                      {t("±부호색")}
                    </button>
                  </>
                )}
                {(w.kind === "table" || w.kind === "list") && (
                  <select
                    data-testid={`db-dashw-limit-${w.id}`}
                    value={w.limit ?? 5}
                    onChange={(e) => patchWidget(w.id, { limit: Number(e.target.value) })}
                    className="rounded border border-neutral-200 bg-white px-1 py-0.5 text-[11px] outline-none dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-200"
                  >
                    {[5, 10, 25, 50, 100].map((n) => (
                      <option key={n} value={n}>{t("{n}개 항목", { n })}</option>
                    ))}
                  </select>
                )}
                <select
                  data-testid={`db-dashw-width-${w.id}`}
                  value={w.width}
                  onChange={(e) => patchWidget(w.id, { width: Number(e.target.value) as DashWidget["width"] })}
                  className="rounded border border-neutral-200 bg-white px-1 py-0.5 text-[11px] outline-none dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-200"
                >
                  {[1, 2, 3, 4].map((n) => (
                    <option key={n} value={n}>{t("너비 {n}/4", { n })}</option>
                  ))}
                </select>
              </div>
            )}

            {BODY[w.kind](w)}
          </div>
        ))}
      </div>
    </div>
  );
}
