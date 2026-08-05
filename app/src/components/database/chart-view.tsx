"use client";

import { useState } from "react";
import { Settings2, X } from "lucide-react";
import type { ChartConfig, DbProperty, DbRow, DbView } from "@/lib/db/schema";
import { applyView, buildGroups, isGroupable, optionClass } from "@/lib/db-values";
import { useDb } from "./database-block";

// ===========================================================================
// Chart view — its own view type, not a dashboard widget. Modelled on the
// original's `TL Chart` (docs/notion-projects-spec.md):
//   column chart, grouped by the person property TL, summing Effort,
//   stacked by title, data labels on, caption shown under the plot.
// ===========================================================================

const HEIGHTS: Record<NonNullable<ChartConfig["height"]>, number> = {
  small: 180,
  medium: 280,
  large: 420,
};

// SVG needs literal colors; these mirror the option-chip palette
const HEX: Record<string, string> = {
  gray: "#9ca3af",
  blue: "#60a5fa",
  green: "#4ade80",
  red: "#f87171",
  yellow: "#facc15",
  purple: "#c084fc",
  orange: "#fb923c",
  pink: "#f472b6",
};
const SERIES_HEX = [HEX.blue, HEX.green, HEX.orange, HEX.purple, HEX.pink, HEX.yellow, HEX.red, HEX.gray];

interface Segment {
  key: string;
  label: string;
  value: number;
  color: string;
}
interface Bar {
  key: string;
  label: string;
  total: number;
  segments: Segment[];
}

export function ChartView({ view }: { view: DbView }) {
  const db = useDb();
  const rows = applyView(db.rows, db.properties, view.config, db.me, db.related);
  const cfg: ChartConfig = view.config.chart ?? {};
  const groupable = db.properties.filter(isGroupable);
  const numberProps = db.properties.filter((p) => p.type === "number");
  const [editing, setEditing] = useState(false);

  const groupProp = db.properties.find((p) => p.id === cfg.groupByPropertyId) ?? groupable[0];
  const stackProp = db.properties.find((p) => p.id === cfg.stackByPropertyId);
  const sumProp = db.properties.find((p) => p.id === cfg.aggregatePropertyId);
  const aggregate = cfg.aggregate ?? "count";
  const kind = cfg.type ?? "column";
  const height = HEIGHTS[cfg.height ?? "medium"];

  const measure = (rs: DbRow[]): number =>
    aggregate === "sum" && sumProp
      ? rs.reduce((a, r) => a + (Number(r.values[sumProp.id]) || 0), 0)
      : rs.length;

  const patch = (next: Partial<ChartConfig>) =>
    db.patchView({ ...view.config, chart: { ...cfg, ...next } });

  const groups = buildGroups(rows, groupProp, db.members) ?? [];
 // series colours are assigned across the whole chart, not per bar, so the same
 // stack value keeps one colour everywhere it appears
  const seriesColor = new Map<string, string>();
  if (stackProp)
    for (const s of buildGroups(rows, stackProp, db.members) ?? [])
      seriesColor.set(s.key, colorOf(stackProp, s.key) ?? SERIES_HEX[seriesColor.size % SERIES_HEX.length]);

  const bars: Bar[] = groups
    .filter((g) => (cfg.hideEmptyGroups ?? false ? g.rows.length > 0 : true))
    .map((g) => {
      const total = measure(g.rows);
      const segments: Segment[] = [];
      if (stackProp) {
 // stack each bar by a second property (the original stacks by title)
        for (const s of buildGroups(g.rows, stackProp, db.members) ?? []) {
          const value = measure(s.rows);
          if (value > 0)
            segments.push({ key: s.key, label: s.label, value, color: seriesColor.get(s.key) ?? HEX.blue });
        }
      }
      return {
        key: g.key,
        label: g.label,
        total,
        segments:
          segments.length || total === 0
            ? segments
            : [{ key: g.key, label: g.label, value: total, color: colorOf(groupProp, g.key) ?? HEX.blue }],
      };
    })
    .filter((b) => b.total > 0 || !(cfg.hideEmptyGroups ?? false));

  const max = Math.max(1, ...bars.map((b) => b.total));
 // legend lists the stack series actually plotted (empty bars contribute none)
  const legend = stackProp
    ? Array.from(new Map(bars.flatMap((b) => b.segments).map((s) => [s.key, s])).values())
        .filter((s) => s.value > 0)
        .slice(0, 12)
    : [];

  return (
    <div data-testid="db-chart-view" className="w-full">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-[11px] font-medium text-neutral-400">
          {aggregate === "sum" && sumProp ? `Sum of ${sumProp.name}` : "Count"}
          {groupProp ? ` · ${groupProp.name}` : ""}
          {stackProp ? ` · stacked by ${stackProp.name}` : ""}
        </p>
        <button
          data-testid="db-chart-settings"
          onClick={() => setEditing((v) => !v)}
          className="flex items-center gap-1 rounded px-2 py-1 text-xs text-neutral-500 transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-800"
        >
          {editing ? <X size={13} /> : <Settings2 size={13} />}
        </button>
      </div>

      {editing && (
        <div
          data-testid="db-chart-config"
          className="mb-3 grid gap-2 rounded-lg border border-neutral-200 bg-neutral-50/60 p-3 text-xs sm:grid-cols-2 lg:grid-cols-3 dark:border-neutral-700 dark:bg-neutral-800/40"
        >
          <Field label="차트 종류">
            <Select
              testid="db-chart-type"
              value={kind}
              onChange={(v) => patch({ type: v as ChartConfig["type"] })}
              options={[
                ["column", "세로 막대"],
                ["bar", "가로 막대"],
                ["line", "선"],
                ["donut", "도넛"],
              ]}
            />
          </Field>
          <Field label="그룹 기준">
            <Select
              testid="db-chart-groupby"
              value={groupProp?.id ?? ""}
              onChange={(v) => patch({ groupByPropertyId: v || undefined })}
              options={groupable.map((p) => [p.id, p.name])}
            />
          </Field>
          <Field label="값">
            <Select
              testid="db-chart-aggregate"
              value={aggregate}
              onChange={(v) => patch({ aggregate: v as ChartConfig["aggregate"] })}
              options={[
                ["count", "개수"],
                ["sum", "합계"],
              ]}
            />
          </Field>
          {aggregate === "sum" && (
            <Field label="합계 속성">
              <Select
                testid="db-chart-sumprop"
                value={sumProp?.id ?? ""}
                onChange={(v) => patch({ aggregatePropertyId: v || undefined })}
                options={numberProps.map((p) => [p.id, p.name])}
              />
            </Field>
          )}
          <Field label="쌓기 기준">
            <Select
              testid="db-chart-stackby"
              value={stackProp?.id ?? ""}
              onChange={(v) => patch({ stackByPropertyId: v || undefined })}
              options={[["", "없음"], ...db.properties.filter((p) => isGroupable(p) || p.type === "title").map((p): [string, string] => [p.id, p.name])]}
            />
          </Field>
          <Field label="높이">
            <Select
              testid="db-chart-height"
              value={cfg.height ?? "medium"}
              onChange={(v) => patch({ height: v as ChartConfig["height"] })}
              options={[
                ["small", "작게"],
                ["medium", "보통"],
                ["large", "크게"],
              ]}
            />
          </Field>
          <label className="flex items-center gap-1.5 text-neutral-600 dark:text-neutral-300">
            <input
              type="checkbox"
              data-testid="db-chart-labels"
              checked={cfg.showDataLabels ?? true}
              onChange={(e) => patch({ showDataLabels: e.target.checked })}
              className="h-3.5 w-3.5 accent-blue-500"
            />
            데이터 라벨 표시
          </label>
          <label className="flex items-center gap-1.5 text-neutral-600 dark:text-neutral-300">
            <input
              type="checkbox"
              data-testid="db-chart-hide-empty"
              checked={cfg.hideEmptyGroups ?? false}
              onChange={(e) => patch({ hideEmptyGroups: e.target.checked })}
              className="h-3.5 w-3.5 accent-blue-500"
            />
            빈 그룹 숨기기
          </label>
          <Field label="캡션">
            <input
              data-testid="db-chart-caption"
              value={cfg.caption ?? ""}
              onChange={(e) => patch({ caption: e.target.value, showCaption: true })}
              placeholder="[ in-progress 상태인 것만 표시됨 ]"
              className="w-full rounded border border-neutral-200 bg-transparent px-1.5 py-1 outline-none dark:border-neutral-600"
            />
          </Field>
        </div>
      )}

      {bars.length === 0 ? (
        <p className="py-8 text-center text-xs text-neutral-400">표시할 값이 없습니다</p>
      ) : kind === "donut" ? (
        <Donut bars={bars} height={height} showLabels={cfg.showDataLabels ?? true} />
      ) : kind === "bar" ? (
        <HorizontalBars bars={bars} max={max} showLabels={cfg.showDataLabels ?? true} />
      ) : (
        <ColumnBars bars={bars} max={max} height={height} line={kind === "line"} showLabels={cfg.showDataLabels ?? true} />
      )}

      {legend.length > 0 && (
        <div data-testid="db-chart-legend" className="mt-3 flex flex-wrap gap-x-3 gap-y-1">
          {legend.map((s) => (
            <span key={s.key} className="flex items-center gap-1 text-[11px] text-neutral-500">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} />
              {s.label || "없음"}
            </span>
          ))}
        </div>
      )}

      {(cfg.showCaption ?? !!cfg.caption) && cfg.caption && (
        <p data-testid="db-chart-caption-text" className="mt-2 text-center text-[11px] text-neutral-400">
          {cfg.caption}
        </p>
      )}
    </div>
  );
}

function colorOf(prop: DbProperty | undefined, key: string): string | null {
  const opt = prop?.config.options?.find((o) => o.id === key);
  return opt ? HEX[opt.color] ?? HEX.gray : null;
}

/** Vertical bars (the original's "column"), optionally with a line on top of
 * the totals instead of filled bars. */
function ColumnBars({
  bars,
  max,
  height,
  line,
  showLabels,
}: {
  bars: Bar[];
  max: number;
  height: number;
  line: boolean;
  showLabels: boolean;
}) {
  const W = Math.max(bars.length * 72, 320);
  const pad = { l: 8, r: 8, t: 18, b: 34 };
  const plot = height - pad.t - pad.b;
  const step = (W - pad.l - pad.r) / bars.length;
  const barW = Math.min(44, step * 0.6);
  const y = (v: number) => pad.t + plot - (v / max) * plot;

  return (
    <div className="overflow-x-auto">
      <svg width={W} height={height} className="block">
        {/* baseline */}
        <line x1={pad.l} y1={pad.t + plot} x2={W - pad.r} y2={pad.t + plot} stroke="currentColor" className="text-neutral-200 dark:text-neutral-700" />
        {bars.map((b, i) => {
          const cx = pad.l + step * i + step / 2;
          let acc = 0;
          return (
            <g key={b.key} data-testid={`db-chart-bar-${b.key}`}>
              {!line &&
                b.segments.map((s) => {
                  const h = (s.value / max) * plot;
                  const yy = pad.t + plot - acc - h;
                  acc += h;
                  return <rect key={s.key} x={cx - barW / 2} y={yy} width={barW} height={Math.max(h, 1)} fill={s.color} rx="2" />;
                })}
              {showLabels && b.total > 0 && (
                <text x={cx} y={y(b.total) - 5} textAnchor="middle" className="fill-neutral-500 text-[10px]">
                  {round(b.total)}
                </text>
              )}
              <text x={cx} y={height - 12} textAnchor="middle" className="fill-neutral-500 text-[10px]">
                {b.label.length > 10 ? b.label.slice(0, 9) + "…" : b.label || "없음"}
              </text>
            </g>
          );
        })}
        {line && (
          <polyline
            fill="none"
            stroke={HEX.blue}
            strokeWidth="2"
            points={bars.map((b, i) => `${pad.l + step * i + step / 2},${y(b.total)}`).join(" ")}
          />
        )}
      </svg>
    </div>
  );
}

function HorizontalBars({ bars, max, showLabels }: { bars: Bar[]; max: number; showLabels: boolean }) {
  return (
    <div className="flex flex-col gap-1.5">
      {bars.map((b) => (
        <div key={b.key} data-testid={`db-chart-bar-${b.key}`} className="flex items-center gap-2">
          <span className="w-28 shrink-0 truncate text-[11px] text-neutral-500">{b.label || "없음"}</span>
          <div className="flex h-4 flex-1 overflow-hidden rounded-sm bg-neutral-100 dark:bg-neutral-700/60">
            {b.segments.map((s) => (
              <div key={s.key} style={{ width: `${(s.value / max) * 100}%`, background: s.color }} />
            ))}
          </div>
          {showLabels && (
            <span className="w-10 shrink-0 text-right text-xs tabular-nums text-neutral-500">{round(b.total)}</span>
          )}
        </div>
      ))}
    </div>
  );
}

function Donut({ bars, height, showLabels }: { bars: Bar[]; height: number; showLabels: boolean }) {
  const total = bars.reduce((a, b) => a + b.total, 0);
  const R = Math.min(height / 2 - 10, 70);
  const C = 2 * Math.PI * R;
  const size = R * 2 + 24;
 // offsets precomputed: a running total mutated inside the render map trips the
 // compiler's immutability rule
  const arcs = bars.reduce<{ b: Bar; len: number; offset: number }[]>((out, b) => {
    const prev = out[out.length - 1];
    const offset = prev ? prev.offset + prev.len : 0;
    out.push({ b, len: total ? (b.total / total) * C : 0, offset });
    return out;
  }, []);
  return (
    <div className="flex items-center gap-4">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0 -rotate-90">
        {arcs.map(({ b, len, offset }) => (
          <circle
            key={b.key}
            cx={size / 2}
            cy={size / 2}
            r={R}
            fill="none"
            stroke={b.segments[0]?.color ?? HEX.blue}
            strokeWidth={Math.max(10, R * 0.3)}
            strokeDasharray={`${Math.max(len - 2, 0.5)} ${C - Math.max(len - 2, 0.5)}`}
            strokeDashoffset={-offset}
          />
        ))}
      </svg>
      <div className="flex flex-col gap-1">
        {bars.slice(0, 10).map((b) => (
          <span key={b.key} className="flex items-center gap-1.5 text-[11px] text-neutral-500">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: b.segments[0]?.color ?? HEX.blue }} />
            {b.label || "없음"}
            {showLabels && <span className="tabular-nums text-neutral-400">{round(b.total)}</span>}
          </span>
        ))}
      </div>
    </div>
  );
}

function round(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-wide text-neutral-400">{label}</span>
      {children}
    </label>
  );
}

function Select({
  testid,
  value,
  onChange,
  options,
}: {
  testid: string;
  value: string;
  onChange: (v: string) => void;
  options: [string, string][];
}) {
  return (
    <select
      data-testid={testid}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded border border-neutral-200 bg-transparent px-1.5 py-1 text-xs outline-none dark:border-neutral-600"
    >
      {options.map(([v, l]) => (
        <option key={v} value={v}>
          {l}
        </option>
      ))}
    </select>
  );
}

export { optionClass };
