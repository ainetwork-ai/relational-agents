"use client";

/**
 * The room's recurring buy in the swap idiom: You pay / You receive, rate and
 * route, where in its window we are, what it has bought, who approved it —
 * and the stop button any member may press (stopping only narrows what the
 * agent may do, so it needs no vote). A request still waiting shows the same
 * swap with its approval count, and can be withdrawn the same way.
 */

import { useState } from "react";
import { ArrowDown, Repeat } from "lucide-react";
import { useIntlLocale, useT } from "@/i18n/provider";
import type { TreasuryStatus } from "@/lib/agent/treasury/types";
import { useTreasuryRoomData } from "./room-data";
import { dateOnly, dateTime, tokenAmount, usd } from "./room-model";
import type { RecurringLive, RecurringPending } from "./room-types";
import styles from "./treasury-room.module.css";

function useStop(): { stop: () => Promise<void>; busy: boolean; error: string | null } {
  const { roomId, reload } = useTreasuryRoomData();
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const stop = async () => {
    setBusy(true);
    setError(null);
    try {
      // the room panel's recurring-buy route: recurring.ts checks membership and writes the activity line
      const res = await fetch(`/api/dm/rooms/${encodeURIComponent(roomId)}/treasury/recurring`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "stop" }),
      });
      // the server's refusal is a fixed English sentence (recurring.ts), safe to show
      if (!res.ok) setError(((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? t("Couldn't stop it — try again."));
      await reload();
    } catch {
      setError(t("Couldn't stop it — try again."));
    } finally {
      setBusy(false);
    }
  };
  return { stop, busy, error };
}

function StopButton({ label, confirmText }: { label: string; confirmText: string }) {
  const t = useT();
  const { stop, busy, error } = useStop();
  const [asking, setAsking] = useState(false);
  return (
    <div className={styles.stopWrap}>
      {asking ? (
        <div className={styles.confirm} role="group" aria-label={label}>
          <span>{confirmText}</span>
          <div className={styles.confirmButtons}>
            <button type="button" className={styles.btnDanger} disabled={busy} onClick={() => void stop().then(() => setAsking(false))} data-testid="treasury-room-stop-confirm">
              {busy ? t("Stopping…") : t("Yes, stop")}
            </button>
            <button type="button" className={styles.btnGhost} disabled={busy} onClick={() => setAsking(false)}>
              {t("Keep it")}
            </button>
          </div>
        </div>
      ) : (
        <button type="button" className={styles.btnDangerOutline} onClick={() => setAsking(true)} data-testid="treasury-room-stop">
          {label}
        </button>
      )}
      {error && (
        <p className={styles.errorLine} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function SwapBox({ weeklyUsd, receive, rate }: { weeklyUsd: number; receive: string; rate: string | null }) {
  const t = useT();
  return (
    <div className={styles.swap}>
      <div className={styles.swapPanel}>
        <span className={styles.swapLabel}>{t("You pay")}</span>
        <div className={styles.swapRow}>
          <span className={`${styles.swapAmount} ${styles.num}`}>{usd(weeklyUsd)}</span>
          <span className={styles.token}>
            <span className={`${styles.tokenDot} ${styles.tokenUsdc}`} aria-hidden />
            USDC
          </span>
        </div>
        <span className={styles.swapSub}>{t("every week")}</span>
      </div>
      <span className={styles.swapArrow} aria-hidden>
        <ArrowDown size={16} />
      </span>
      <div className={styles.swapPanel}>
        <span className={styles.swapLabel}>{t("You receive")}</span>
        <div className={styles.swapRow}>
          <span className={`${styles.swapAmount} ${styles.num}`}>{receive}</span>
          <span className={styles.token}>
            <span className={`${styles.tokenDot} ${styles.tokenEth}`} aria-hidden />
            ETH
          </span>
        </div>
        <span className={styles.swapSub}>{rate ?? t("at the pool's price when it buys")}</span>
      </div>
      <div className={styles.route}>
        <span>{t("Route")}</span>
        <span>Uniswap v3 · 0.05% pool · Base</span>
      </div>
    </div>
  );
}

function LiveCard({ live, realRuns }: { live: RecurringLive; realRuns: boolean }) {
  const t = useT();
  const intlLocale = useIntlLocale();
  const perBuy = live.boughtWeeks > 0 ? Number(live.wethOut) / live.boughtWeeks : null;
  const rate = live.avgPriceUsdcPerEth ? t("1 ETH ≈ {price} USDC", { price: tokenAmount(Math.round(live.avgPriceUsdcPerEth)) }) : null;
  const thisWeek =
    live.thisWeek === "bought" ? t("Bought this week") : live.thisWeek === "skipped" ? t("Skipped this week") : t("Not bought yet this week");
  const pct = Math.min(100, (live.weekIndex / live.weeks) * 100);

  return (
    <>
      <div className={styles.recurringStatus}>
        <span className={`${styles.chip} ${styles.chipOk}`}>
          <span className={styles.liveDot} aria-hidden />
          {t("Running")}
        </span>
        {!realRuns && <span className={`${styles.chip} ${styles.chipInfo}`}>{t("Rehearsal — real buys are off on this server")}</span>}
      </div>

      <SwapBox weeklyUsd={live.weeklyUsd} receive={perBuy === null ? "—" : `≈ ${tokenAmount(perBuy)}`} rate={rate} />

      <div className={styles.week}>
        <div className={styles.weekHead}>
          <strong className={styles.num}>{t("Week {k} of {n}", { k: live.weekIndex, n: live.weeks })}</strong>
          <span className={styles.muted}>{thisWeek}</span>
        </div>
        <div className={styles.progress} role="progressbar" aria-valuemin={0} aria-valuemax={live.weeks} aria-valuenow={live.weekIndex}>
          <div className={`${styles.progressFill} ${styles.progressCoral}`} style={{ width: `${pct}%` }} />
        </div>
        <p className={styles.weekNext}>
          {live.nextRunAt ? t("Next buy: {when}", { when: dateTime(live.nextRunAt, intlLocale) }) : t("No buys left in its window")}
          <span className={styles.muted}> · {t("until {date}", { date: dateOnly(live.expiresAt, intlLocale) })}</span>
        </p>
      </div>

      <dl className={styles.stats3}>
        <div>
          <dt>{t("Invested")}</dt>
          <dd className={styles.num}>{usd(live.investedUsd)}</dd>
          <span className={styles.statHint}>{t("{n} buys", { n: live.boughtWeeks })}</span>
        </div>
        <div>
          <dt>{t("ETH accumulated")}</dt>
          <dd className={styles.num}>{tokenAmount(live.wethOut)}</dd>
          <span className={styles.statHint}>WETH</span>
        </div>
        <div>
          <dt>{t("Avg. entry price")}</dt>
          <dd className={styles.num}>{live.avgPriceUsdcPerEth ? tokenAmount(Math.round(live.avgPriceUsdcPerEth)) : "—"}</dd>
          <span className={styles.statHint}>{t("USDC per ETH")}</span>
        </div>
      </dl>

      <div className={styles.approvedBy}>
        <p>
          {t("Approved by {names}", { names: live.approvedBy.join(", ") || "—" })}{" "}
          <span className={styles.muted}>{t("({got} of {need} verified humans)", { got: live.approvals, need: live.required })}</span>
        </p>
        {live.rule && <p className={styles.quote}>“{live.rule}”</p>}
        <p className={styles.muted}>
          {t("Terms")} <span className={styles.mono}>{live.digestShort}</span>
        </p>
      </div>

      <StopButton label={t("Stop recurring buy")} confirmText={t("Stop it for everyone? The treasurer won't buy again under it.")} />
    </>
  );
}

function PendingCard({ pending }: { pending: RecurringPending }) {
  const t = useT();
  return (
    <>
      <div className={styles.recurringStatus}>
        <span className={`${styles.chip} ${styles.chipWait}`}>
          <span className={styles.chipDot} aria-hidden />
          {t("Waiting for approval · {got} of {need}", { got: pending.approvals, need: pending.required })}
        </span>
      </div>
      <SwapBox weeklyUsd={pending.weeklyUsd} receive="—" rate={null} />
      <p className={styles.weekNext}>
        {t("{weeks} weeks · at most {total} in all", { weeks: pending.weeks, total: usd(pending.exposureUsd) })}
      </p>
      {pending.rule && <p className={styles.quote}>“{pending.rule}”</p>}
      <StopButton label={t("Withdraw request")} confirmText={t("Withdraw this request? Nobody can approve it afterwards.")} />
    </>
  );
}

export function RecurringCard({ status }: { status: TreasuryStatus }) {
  const t = useT();
  const rec = status.recurring;
  return (
    <section className={styles.card} data-testid="treasury-room-recurring">
      <div className={styles.cardHead}>
        <h2 className={styles.cardTitle}>
          <Repeat size={18} aria-hidden className={styles.titleIcon} />
          {t("Recurring buy")}
        </h2>
      </div>
      {rec === null || rec === undefined ? (
        <p className={styles.emptyLine}>{t("The recurring buy can't be read right now.")}</p>
      ) : rec.live ? (
        <LiveCard live={rec.live} realRuns={rec.realRuns} />
      ) : rec.pending ? (
        <PendingCard pending={rec.pending} />
      ) : (
        <p className={styles.emptyLine}>
          {t("No recurring buy yet. Ask your treasurer: “buy $20 of ETH every week for 26 weeks”.")}
        </p>
      )}
    </section>
  );
}
