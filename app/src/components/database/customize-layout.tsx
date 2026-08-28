"use client";

import type { DbProperty } from "@/lib/db/schema";
import { useDb } from "./database-block";
import { useT } from "@/i18n/provider";
import { PINNED_COUNT, splitPinned } from "./pinned";

/**
 * 레이아웃 사용자 지정 — which properties sit above the body (the pinned band)
 * and which go in the 속성 panel, and in what order the band reads.
 *
 * The original reaches the same choice through a fuller layout editor (drag a
 * property between the 제목 block and the 속성 그룹, then 모든 페이지에 적용);
 * this is the part of it the row page actually depends on. It exists so the
 * original's own arrangement (TL · Assignee · End date · Evaluation, in that
 * order) is something you can produce here rather than something we hardcode.
 *
 * Stored per property — `config.pinned` and `config.pinnedOrder`; `config` is
 * already jsonb, so this needed no column and no migration.
 */
export function CustomizeLayoutList() {
  const t = useT();
  const db = useDb();
  const nonTitle = db.properties.filter((p) => p.type !== "title");
  const chosen = nonTitle.some((p) => p.config?.pinned !== undefined);
  const isOn = (p: DbProperty, i: number) => (chosen ? !!p.config?.pinned : i < PINNED_COUNT);
  const { pinned } = splitPinned(db.properties);
  const nextOrder = () =>
    pinned.reduce(
      (m, q) => Math.max(m, typeof q.config?.pinnedOrder === "number" ? q.config.pinnedOrder : -1),
      -1
    ) + 1;

  const toggle = (p: DbProperty, i: number) => {
    const now = isOn(p, i);
 // the first change writes an explicit value for EVERY property, so the
 // "nobody has chosen yet" fallback stops applying all at once rather than
 // half the list following the default and half the choice
    if (!chosen) {
      let order = 0;
      nonTitle.forEach((q, qi) => {
        const want = q.id === p.id ? !now : qi < PINNED_COUNT;
        db.updateProperty(q.id, {
          config: { ...q.config, pinned: want, pinnedOrder: want ? order++ : undefined },
        });
      });
      return;
    }
    db.updateProperty(p.id, {
      config: { ...p.config, pinned: !now, pinnedOrder: !now ? nextOrder() : undefined },
    });
  };

 // move a pinned property one place along the band. The original reorders by
 // dragging inside its layout editor; the order it produces is what matters,
 // so this list moves one step at a time.
  const move = (p: DbProperty, dir: -1 | 1) => {
    const at = pinned.findIndex((q) => q.id === p.id);
    const to = at + dir;
    if (at < 0 || to < 0 || to >= pinned.length) return;
    const next = [...pinned];
    next.splice(to, 0, ...next.splice(at, 1));
    next.forEach((q, qi) => {
      if (q.config?.pinnedOrder !== qi)
        db.updateProperty(q.id, { config: { ...q.config, pinnedOrder: qi } });
    });
  };

 // pinned first, in the band's order, then the rest
  const ordered = [
    ...nonTitle
      .map((p, i) => ({ p, i }))
      .filter(({ p, i }) => isOn(p, i))
      .sort(
        (a, b) =>
          pinned.findIndex((q) => q.id === a.p.id) - pinned.findIndex((q) => q.id === b.p.id)
      ),
    ...nonTitle.map((p, i) => ({ p, i })).filter(({ p, i }) => !isOn(p, i)),
  ];

  return (
    <>
      <div className="px-3 pb-1 pt-1.5 text-[11px] font-medium text-neutral-400">
        {t("페이지 상단에 표시할 속성")}
      </div>
      {ordered.map(({ p, i }) => {
        const on = isOn(p, i);
        const rank = on ? pinned.findIndex((q) => q.id === p.id) : -1;
        return (
          <div key={p.id} className="flex w-full items-center">
            <button
              data-testid={`db-peek-pin-${p.id}`}
              aria-pressed={on}
              onClick={() => toggle(p, i)}
              className="flex min-w-0 flex-1 items-center justify-between gap-2 px-3 py-1.5 text-left text-sm text-neutral-700 transition-colors hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-700"
            >
              <span className="truncate">{p.name}</span>
              <span
                className={`h-3.5 w-3.5 shrink-0 rounded-sm border ${
                  on ? "border-blue-500 bg-blue-500" : "border-neutral-300 dark:border-neutral-600"
                }`}
              />
            </button>
            {on && (
              <span className="flex shrink-0 items-center pr-2">
                {([-1, 1] as const).map((dir) => (
                  <button
                    key={dir}
                    data-testid={`db-peek-pin-${dir < 0 ? "up" : "down"}-${p.id}`}
                    aria-label={dir < 0 ? t("왼쪽으로 이동") : t("오른쪽으로 이동")}
                    disabled={dir < 0 ? rank <= 0 : rank >= pinned.length - 1}
                    onClick={() => move(p, dir)}
                    className="flex h-5 w-5 items-center justify-center rounded text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-600 disabled:opacity-30 dark:hover:bg-neutral-700"
                  >
                    {dir < 0 ? "↑" : "↓"}
                  </button>
                ))}
              </span>
            )}
          </div>
        );
      })}
    </>
  );
}
