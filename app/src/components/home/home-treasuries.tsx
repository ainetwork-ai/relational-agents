"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ChevronRight, Landmark } from "lucide-react";
import { useTreasurySummary, type TreasurySummaryRoom } from "@/components/sidebar/use-treasury-summary";
import { useTreasuryV2 } from "@/components/treasury-app/use-treasury-ui";
import { useIntlLocale, useT } from "@/i18n/provider";
import type { T } from "@/i18n/translate";

/** One state per relation, by priority: my vote is owed › a recurring buy › what is waiting on others. */
function stateOf(room: TreasurySummaryRoom, t: T, usd: (n: number) => string): { text: string; tone: "owed" | "live" | "quiet" } | null {
  if (room.pendingForMe > 0) return { text: t("{n} waiting for your approval", { n: room.pendingForMe }), tone: "owed" };
  if (room.recurring?.state === "live") return { text: t("Buying {amount} weekly", { amount: usd(room.recurring.weeklyUsd) }), tone: "live" };
  if (room.pendingTotal > 0) return { text: t("{n} waiting on others", { n: room.pendingTotal }), tone: "quiet" };
  return null;
}

const TONE = {
  owed: "bg-orange-100 text-orange-800 dark:bg-orange-900/50 dark:text-orange-200",
  live: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200",
  quiet: "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300",
} as const;

/** Money across the viewer's relations, on Home — each row opens that relation's treasury. */
export function HomeTreasuries() {
  const t = useT();
  const locale = useIntlLocale();
  const on = useTreasuryV2();
  const rooms = [...useTreasurySummary(on).values()];
  // the sidebar's poll reads no chain; Home asks once for the pots, as the overview does
  const [pots, setPots] = useState<ReadonlyMap<string, number | null>>(new Map());
  useEffect(() => {
    if (!on) return;
    let alive = true;
    fetch("/api/treasury/summary?balances=1", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((body: { rooms?: TreasurySummaryRoom[] } | null) => {
        if (alive && body?.rooms) setPots(new Map(body.rooms.map((r) => [r.roomId, r.balanceUsd])));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [on]);
  if (!rooms.length) return null;
  const usd = (n: number) => `$${n.toLocaleString(locale, { maximumFractionDigits: 2 })}`;
  return (
    <section data-testid="home-treasuries" className="mb-10">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-neutral-400">
          <Landmark size={12} aria-hidden /> {t("Treasuries")}
        </h2>
        <Link
          href="/treasury"
          className="rounded px-1.5 py-0.5 text-xs text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
        >
          {t("See all")}
        </Link>
      </div>
      <ul className="divide-y divide-neutral-100 overflow-hidden rounded-xl border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
        {rooms.map((room) => {
          const state = stateOf(room, t, usd);
          const pot = room.balanceUsd ?? pots.get(room.roomId) ?? null;
          return (
            <li key={room.roomId}>
              <Link
                href={`/treasury/${room.roomId}`}
                data-testid={`home-treasury-${room.roomId}`}
                className="flex min-h-12 items-center gap-3 px-4 py-2.5 transition-colors hover:bg-neutral-50 active:bg-neutral-100 focus-visible:bg-neutral-50 focus-visible:outline-none dark:hover:bg-neutral-800/60"
              >
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-neutral-800 dark:text-neutral-100">{room.roomName}</span>
                {state && <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${TONE[state.tone]}`}>{state.text}</span>}
                <span className="w-20 shrink-0 text-right text-sm tabular-nums text-neutral-600 dark:text-neutral-300">
                  {pot === null ? "" : usd(pot)}
                </span>
                <ChevronRight size={14} aria-hidden className="shrink-0 text-neutral-300 dark:text-neutral-600" />
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
