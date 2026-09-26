"use client";

/**
 * /treasury/[roomId]/contributions — members' recurring contributions into the pot, through Permit2
 * on Base: this month at a glance, the viewer's own plan (start, stop, why a period can't be
 * collected), and every member's periods by month. The plans are contract state
 * (lib/agent/treasury/contributions.ts); a period's tx is not, so a cell links the member's USDC
 * transfers on BaseScan.
 */

import { useState } from "react";
import { ExternalLink, Wallet } from "lucide-react";
import { useIntlLocale, useT } from "@/i18n/provider";
import type { T } from "@/i18n/translate";
import { CONTRIBUTION_CHAIN as C, type ContributionPlanView, type PeriodState } from "@/lib/agent/treasury/contribution-plan";
import { TREASURY_TIME_ZONE } from "@/lib/agent/treasury/types";
import { StartContributionDialog, StopContributionDialog } from "./contribution-dialogs";
import { RouteChip } from "./contributions-card";
import {
  collectedCount,
  contributingIds,
  gridMonths,
  gridRows,
  isRunning,
  monthKey,
  monthTotals,
  myPlan,
  nextCollection,
  periodKeyOf,
  planStatus,
  type GridCell,
  type GridRow,
} from "./contributions-model";
import { useTreasuryRoomData } from "./room-data";
import { dateOnly, dateTime, shortAddress, tokenAmount, usd } from "./room-model";
import styles from "./treasury-room.module.css";
import c from "./contributions.module.css";

function planLine(t: T, plan: ContributionPlanView): string {
  const key = periodKeyOf(plan.periodSeconds);
  const every = key === "weekly" ? t("every week") : key === "fortnightly" ? t("every two weeks") : key === "monthly" ? t("every month") : t("every {n} days", { n: Math.round(plan.periodSeconds / 86400) });
  return t("{amount} USDC · {usd} {every}", { amount: tokenAmount(plan.amount), usd: usd(plan.amountUsd), every });
}

const STATE_CLASS: Record<PeriodState, string> = {
  collected: c.cellCollected,
  due: c.cellDue,
  missed: c.cellMissed,
  upcoming: c.cellUpcoming,
  stopped: c.cellStopped,
};

function stateWord(t: T, s: PeriodState): string {
  return s === "collected" ? t("Collected") : s === "due" ? t("Collecting now") : s === "missed" ? t("Missed") : s === "upcoming" ? t("Upcoming") : t("After stop");
}

function blockedText(t: T, plan: ContributionPlanView): string {
  if (plan.blocked === "wallet-short") return t("This period can't be collected: your wallet has {usdc} USDC on Base.", { usdc: tokenAmount(plan.walletUsdc ?? "0") });
  if (plan.blocked === "allowance-expired") return t("This period can't be collected: your Permit2 allowance has expired.");
  return t("This period can't be collected: your Permit2 allowance is used up.");
}

// ── the summary strip ───────────────────────────────────────────────────────

function Summary({ plans, now }: { plans: ContributionPlanView[]; now: number }) {
  const t = useT();
  const locale = useIntlLocale();
  const { data } = useTreasuryRoomData();
  const humans = data.room.members.filter((p) => !p.isAgent);
  const month = monthTotals(plans, monthKey(now));
  const paying = contributingIds(humans, plans, now);
  const next = plans
    .filter((p) => isRunning(p, now))
    .map(nextCollection)
    .filter((n): n is { at: string; now: boolean } => n !== null)
    .sort((a, b) => Number(b.now) - Number(a.now) || a.at.localeCompare(b.at))[0];
  return (
    <section className={`${styles.card} ${c.strip}`} data-testid="contributions-summary">
      <div className={c.stripItem}>
        <span className={c.stripLabel}>{t("This month")}</span>
        <span className={`${c.stripValue} ${styles.num}`}>{t("{collected} of {expected}", { collected: usd(month.collectedUsd), expected: usd(month.expectedUsd) })}</span>
      </div>
      <div className={c.stripItem}>
        <span className={c.stripLabel}>{t("Contributing")}</span>
        <span className={`${c.stripValue} ${styles.num}`}>{t("{n} of {m} members", { n: paying.size, m: humans.length })}</span>
      </div>
      <div className={c.stripItem}>
        <span className={c.stripLabel}>{t("Next collection")}</span>
        <span className={c.stripValue}>{next ? (next.now ? t("Now") : dateTime(next.at, locale)) : "—"}</span>
      </div>
      <div className={`${c.stripItem} ${c.stripRoute}`}>
        <RouteChip />
        <a className={styles.explorerLink} href={`${C.explorer}/address/${C.contract}`} target="_blank" rel="noreferrer">
          {t("The contract")}
          <ExternalLink size={12} aria-hidden />
        </a>
      </div>
    </section>
  );
}

// ── the viewer's own plan ───────────────────────────────────────────────────

function YourContribution({ plan, now, onStart, onStop }: { plan: ContributionPlanView | null; now: number; onStart: (() => void) | null; onStop: () => void }) {
  const t = useT();
  const locale = useIntlLocale();
  const status = plan ? planStatus(plan, now) : null;
  const done = plan ? collectedCount(plan) : 0;
  const next = plan ? nextCollection(plan) : null;
  return (
    <section className={styles.card} data-testid="contribution-mine">
      <div className={styles.cardHead}>
        <h2 className={styles.cardTitle}>{t("Your contribution")}</h2>
        {status && (
          <span className={`${styles.chip} ${status === "active" ? styles.chipOk : status === "blocked" ? styles.chipBad : styles.chipMuted}`}>
            {status === "active" ? t("Active") : status === "blocked" ? t("Can't collect") : status === "stopped" ? t("Stopped") : t("Ended")}
          </span>
        )}
      </div>
      {!plan ? (
        <div className={c.mineEmpty}>
          <p className={c.quiet}>{t("You don't contribute on a schedule yet. Pick an amount and how often; your wallet allows exactly that, and the agent collects it.")}</p>
          {onStart && (
            <button type="button" className={styles.btnDark} onClick={onStart} data-testid="contribution-start-open">
              {t("Start recurring contribution")}
            </button>
          )}
        </div>
      ) : (
        <>
          <p className={c.mineLine}>
            {planLine(t, plan)}
            <span className={c.quiet}> · {t("until {date}", { date: dateOnly(plan.until, locale) })}</span>
          </p>
          <div className={styles.progress} aria-hidden>
            <div className={styles.progressFill} style={{ width: `${(done / Math.max(1, plan.periods.length)) * 100}%` }} />
          </div>
          <dl className={c.facts}>
            <div>
              <dt>{t("Collected")}</dt>
              <dd className={styles.num}>{t("{k} of {n}", { k: done, n: plan.periods.length })}</dd>
            </div>
            <div>
              <dt>{t("Still allowed")}</dt>
              <dd className={styles.num}>{plan.allowance ? `${tokenAmount(plan.allowance.amount)} USDC` : "—"}</dd>
            </div>
            <div>
              <dt>{status === "stopped" ? t("Stopped") : status === "ended" ? t("Ended") : t("Next collection")}</dt>
              <dd>
                {status === "stopped" && plan.stoppedAt
                  ? dateOnly(plan.stoppedAt, locale)
                  : status === "ended"
                    ? dateOnly(plan.until, locale)
                    : next
                      ? next.now
                        ? t("Now")
                        : dateTime(next.at, locale)
                      : "—"}
              </dd>
            </div>
          </dl>
          <p className={`${c.blockedLine} ${status === "blocked" ? "" : c.blockedHidden}`} role={status === "blocked" ? "alert" : undefined}>
            {status === "blocked" ? blockedText(t, plan) : " "}
          </p>
          <div className={c.actions}>
            {status === "active" || status === "blocked" ? (
              <button type="button" className={styles.btnDangerLine} onClick={onStop} data-testid="contribution-stop-open">
                {t("Stop")}
              </button>
            ) : (
              onStart && (
                <button type="button" className={styles.btnDark} onClick={onStart}>
                  {t("Start again")}
                </button>
              )
            )}
            <a className={styles.explorerLink} href={`${C.explorer}/token/${C.usdc}?a=${plan.member}`} target="_blank" rel="noreferrer">
              {t("Your wallet's USDC on BaseScan")}
              <ExternalLink size={12} aria-hidden />
            </a>
          </div>
        </>
      )}
    </section>
  );
}

// ── the grid ────────────────────────────────────────────────────────────────

function Cell({ cell, member }: { cell: GridCell; member: string }) {
  const t = useT();
  const locale = useIntlLocale();
  const label = `${dateOnly(cell.startsAt, locale)} · ${tokenAmount(cell.amount)} USDC (${usd(cell.amountUsd)}) · ${stateWord(t, cell.state)}`;
  return (
    <a
      className={`${c.cell} ${STATE_CLASS[cell.state]} ${cell.wide ? c.cellWide : ""}`}
      href={`${C.explorer}/token/${C.usdc}?a=${member}`}
      target="_blank"
      rel="noreferrer"
      aria-label={label}
      data-tip={label}
    />
  );
}

function monthName(key: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { month: "short", timeZone: TREASURY_TIME_ZONE }).format(new Date(`${key}-15T12:00:00Z`));
}

function Grid({ rows, months, plans }: { rows: GridRow[]; months: string[]; plans: ContributionPlanView[] }) {
  const t = useT();
  const locale = useIntlLocale();
  return (
    <section className={styles.card} data-testid="contributions-grid">
      <div className={styles.cardHead}>
        <h2 className={styles.cardTitle}>{t("By person")}</h2>
      </div>
      <div className={c.grid} style={{ ["--months" as string]: months.length }}>
        <div className={`${c.gridRow} ${c.gridHead}`}>
          <span className={c.gridWho}>{t("Member")}</span>
          {months.map((m) => (
            <span key={m} className={c.gridMonth}>
              {monthName(m, locale)}
            </span>
          ))}
          <span className={c.gridTotal}>{t("Total")}</span>
        </div>
        {rows.map((row) => {
          const name = row.person?.displayName ?? shortAddress(row.wallet ?? "");
          const plan = row.plans[0];
          return (
            <div key={row.key} className={c.gridRow} data-testid="contributions-row">
              <span className={c.gridWho}>
                {row.person?.avatarUrl ? (
                  <img src={row.person.avatarUrl} alt="" className={c.dot} />
                ) : (
                  <span className={c.dot}>{row.person ? name.slice(0, 1).toUpperCase() : <Wallet size={13} aria-hidden />}</span>
                )}
                <span className={c.whoText}>
                  <span className={c.whoName}>{name}</span>
                  <span className={c.whoPlan}>{plan ? planLine(t, plan) : t("No plan")}</span>
                </span>
              </span>
              {months.map((m) => {
                const cells = row.byMonth[m] ?? [];
                return (
                  <span key={m} className={c.cells} aria-label={monthName(m, locale)}>
                    {cells.length ? cells.map((cell) => <Cell key={`${cell.planId}:${cell.index}`} cell={cell} member={row.plans.find((p) => p.id === cell.planId)?.member ?? ""} />) : <span className={c.none}>—</span>}
                  </span>
                );
              })}
              <span className={`${c.gridTotal} ${styles.num}`}>{usd(row.collectedUsd)}</span>
            </div>
          );
        })}
        <div className={`${c.gridRow} ${c.gridFoot}`}>
          <span className={c.gridWho}>{t("Collected")}</span>
          {months.map((m) => (
            <span key={m} className={`${c.gridMonth} ${styles.num}`}>
              {usd(monthTotals(plans, m).collectedUsd)}
            </span>
          ))}
          <span className={`${c.gridTotal} ${styles.num}`}>{usd(rows.reduce((s, r) => s + r.collectedUsd, 0))}</span>
        </div>
      </div>
      <ul className={c.legend}>
        {(["collected", "due", "missed", "upcoming", "stopped"] as PeriodState[]).map((s) => (
          <li key={s}>
            <span className={`${c.cell} ${c.legendCell} ${STATE_CLASS[s]}`} aria-hidden />
            {stateWord(t, s)}
          </li>
        ))}
        <li>
          <span className={c.none}>—</span>
          {t("No plan")}
        </li>
      </ul>
    </section>
  );
}

// ── the tab ─────────────────────────────────────────────────────────────────

export function ContributionsTab() {
  const t = useT();
  const { roomId, data, at, reload } = useTreasuryRoomData();
  const { contributions, usdcPerUsd } = data.wallet;
  const [dialog, setDialog] = useState<"start" | "stop" | null>(null);

  if (contributions.state === "off")
    return (
      <div className={`${styles.card} ${styles.empty}`}>
        <p className={styles.emptyTitle}>{t("Recurring contributions aren't on for this server")}</p>
      </div>
    );

  const plans = contributions.plans;
  const mine = myPlan(plans, data.me.id, at);
  const pot = contributions.pot;
  const canStart = contributions.state === "ready" && pot !== null && !(mine && isRunning(mine, at));
  const collectedUsd = mine ? collectedCount(mine) * mine.amountUsd : 0;

  return (
    <div className={styles.stack} data-testid="treasury-room-contributions-tab">
      <Summary plans={plans} now={at} />
      {contributions.state === "unavailable" && <p className={`${styles.banner} ${styles.bannerInfo}`}>{t("Base can't be read right now — this shows the last plans it read.")}</p>}
      <YourContribution plan={mine} now={at} onStart={canStart ? () => setDialog("start") : null} onStop={() => setDialog("stop")} />
      <Grid rows={gridRows(data.room.members, plans)} months={gridMonths(plans, at)} plans={plans} />
      {dialog === "start" && pot && (
        <StartContributionDialog roomId={roomId} roomName={data.room.name} meId={data.me.id} pot={pot} usdcPerUsd={usdcPerUsd} now={at} onClose={() => setDialog(null)} onChanged={reload} />
      )}
      {dialog === "stop" && mine && <StopContributionDialog plan={mine} collectedUsd={collectedUsd} onClose={() => setDialog(null)} onChanged={reload} />}
      <p className={c.footnote}>
        {t("Each member's wallet allows the contribution contract exactly their plan's total through Permit2. The agent collects one period at a time, only into this pot; a missed period doesn't add up.")}
      </p>
    </div>
  );
}
