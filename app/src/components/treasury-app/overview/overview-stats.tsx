"use client";

/** The three headline numbers; each one is also a toggle that filters the list. */

import { useT } from "@/i18n/provider";
import type { OverviewFilter, OverviewStats } from "./overview-model";
import styles from "./treasury-overview.module.css";

interface StatSpec {
  filter: Exclude<OverviewFilter, "all">;
  label: string;
  value: number;
  /** the approval count reads orange while something waits on the viewer */
  waitTone: boolean;
}

export function OverviewStatStrip({
  stats,
  filter,
  onFilter,
}: {
  stats: OverviewStats;
  filter: OverviewFilter;
  onFilter: (next: OverviewFilter) => void;
}) {
  const t = useT();
  const specs: StatSpec[] = [
    {
      filter: "needs-approval",
      label: t("Needs your approval"),
      value: stats.needsYourApproval,
      waitTone: true,
    },
    {
      filter: "recurring-running",
      label: t("Recurring buys running"),
      value: stats.recurringRunning,
      waitTone: false,
    },
    {
      filter: "bought-this-week",
      label: t("Buys this week"),
      value: stats.boughtThisWeek,
      waitTone: false,
    },
  ];

  return (
    <div className={styles.stats} role="group" aria-label={t("Filter treasuries")}>
      {specs.map((spec) => {
        const on = filter === spec.filter;
        const valueClass =
          spec.value === 0 ? styles.statValueMuted : spec.waitTone ? styles.statValueWait : "";
        return (
          <button
            key={spec.filter}
            type="button"
            aria-pressed={on}
            className={`${styles.stat} ${on ? styles.statOn : ""}`}
            onClick={() => onFilter(on ? "all" : spec.filter)}
          >
            <span className={styles.statLabel}>{spec.label}</span>
            <span className={`${styles.statValue} ${styles.num} ${valueClass}`}>{spec.value}</span>
          </button>
        );
      })}
    </div>
  );
}
