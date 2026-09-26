"use client";

/**
 * "Your treasuries" — money across every relation the viewer belongs to.
 * Rendered only when the per-browser Treasury switch is on; otherwise a short
 * note points at the switch URL. Data comes from GET /api/treasury/summary,
 * refreshed while the tab is visible.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useT } from "@/i18n/provider";
import { filterRooms, overviewStats, parseSummary, sortRooms, type OverviewFilter } from "./overview-model";
import { OverviewList, OverviewListSkeleton } from "./overview-list";
import { OverviewStatStrip } from "./overview-stats";
import type { TreasurySummaryRoom } from "@/lib/agent/treasury/summary";
import styles from "./treasury-overview.module.css";

// the overview asks for each pot; the sidebar's poll of the same route stays chain-free
const SUMMARY_URL = "/api/treasury/summary?balances=1";
// Same cadence as the sidebar's poll of this route (components/sidebar/use-treasury-summary.ts).
const POLL_MS = 30_000;
const PRETENDARD_CSS =
  "https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css";

type Load =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "ready"; rooms: TreasurySummaryRoom[]; at: number };

function useTreasurySummary(): { load: Load; retry: () => void } {
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const inFlight = useRef(false);

  const fetchSummary = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const res = await fetch(SUMMARY_URL, { cache: "no-store" });
      const parsed = res.ok ? parseSummary(await res.json()) : null;
      // a failed refresh keeps the last good list on screen
      setLoad((prev) => (parsed ? { kind: "ready", rooms: parsed.rooms, at: Date.now() } : prev.kind === "ready" ? prev : { kind: "error" }));
    } catch {
      setLoad((prev) => (prev.kind === "ready" ? prev : { kind: "error" }));
    } finally {
      inFlight.current = false;
    }
  }, []);

  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === "visible") void fetchSummary();
    };
    tick();
    const timer = window.setInterval(tick, POLL_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [fetchSummary]);

  const retry = useCallback(() => {
    setLoad({ kind: "loading" });
    void fetchSummary();
  }, [fetchSummary]);

  return { load, retry };
}

function EmptyState() {
  const t = useT();
  return (
    <div className={styles.empty} data-testid="treasury-overview-empty">
      <div className={styles.agentMark} aria-hidden>
        ✦
      </div>
      <p className={styles.emptyTitle}>{t("No treasuries yet")}</p>
    </div>
  );
}

function ErrorState({ onRetry }: { onRetry: () => void }) {
  const t = useT();
  return (
    <div className={styles.empty} role="alert">
      <p className={styles.emptyTitle}>{t("Couldn't load your treasuries")}</p>
      <button type="button" className={styles.btnDark} onClick={onRetry}>
        {t("Try again")}
      </button>
    </div>
  );
}

function FilteredEmpty({ onClear }: { onClear: () => void }) {
  const t = useT();
  return (
    <div className={styles.empty}>
      <p className={styles.emptyText}>{t("Nothing matches this filter right now.")}</p>
      <button type="button" className={styles.btnDark} onClick={onClear}>
        {t("Show all")}
      </button>
    </div>
  );
}

function Overview() {
  const t = useT();
  const { load, retry } = useTreasurySummary();
  const [filter, setFilter] = useState<OverviewFilter>("all");

  const rooms = useMemo(() => (load.kind === "ready" ? sortRooms(load.rooms) : []), [load]);
  const stats = useMemo(() => overviewStats(rooms), [rooms]);
  const shown = useMemo(() => filterRooms(rooms, filter), [rooms, filter]);
  const hasRooms = load.kind === "ready" && rooms.length > 0;

  const listTitle: Record<OverviewFilter, string> = {
    all: t("All relations"),
    "needs-approval": t("Needs your approval"),
    "recurring-running": t("Recurring buys running"),
    "bought-this-week": t("Buys this week"),
  };

  return (
    <div className={styles.root} data-testid="treasury-overview">
      {/* React hoists and dedupes this stylesheet; the font stack falls back to system fonts until it lands */}
      <link rel="stylesheet" href={PRETENDARD_CSS} precedence="default" />
      <div className={styles.page}>
        <h1 className={styles.title}>{t("Your treasuries")}</h1>

        {hasRooms && <OverviewStatStrip stats={stats} filter={filter} onFilter={setFilter} />}

        <section className={styles.card} style={hasRooms ? undefined : { marginTop: 28 }} aria-live="polite">
          {load.kind === "loading" && <OverviewListSkeleton />}
          {load.kind === "error" && <ErrorState onRetry={retry} />}
          {load.kind === "ready" && rooms.length === 0 && <EmptyState />}
          {hasRooms && (
            <>
              <div className={styles.cardHead}>
                <h2 className={styles.cardTitle}>{listTitle[filter]}</h2>
                {filter !== "all" && (
                  <button type="button" className={styles.clear} onClick={() => setFilter("all")}>
                    {t("Show all")}
                  </button>
                )}
              </div>
              {shown.length > 0 ? (
                <OverviewList rooms={shown} now={load.at} />
              ) : (
                <FilteredEmpty onClear={() => setFilter("all")} />
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}

export function TreasuryOverview() {
  return <Overview />;
}
