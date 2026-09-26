"use client";

/**
 * The room's recurring buy in the swap idiom — You pay USDC / You receive WETH
 * through Uniswap v3 on Base — where in its weeks we are, what it has bought,
 * and the stop button any member may press (stopping only narrows what the
 * agent may do, so it needs no vote). A request still waiting shows the same
 * swap and can be cancelled the same way; its votes are in Needs approval.
 */

import { useState, type ReactNode } from "react";
import { ArrowDown } from "lucide-react";
import { useIntlLocale, useT } from "@/i18n/provider";
import type { TreasuryStatus } from "@/lib/agent/treasury/types";
import { ChainBadge, UniswapBadge } from "@/components/chain/chain-badge";
import { TokenPill } from "./chain-marks";
import { useTreasuryRoomData } from "./room-data";
import { dateOnly, tokenAmount, usd, weekdayDate } from "./room-model";
import type { RecurringLive, RecurringPending, TreasuryWallet } from "./room-types";
import styles from "./treasury-room.module.css";

// up to this many weeks read as one segment each; a longer window reads as a bar
const MAX_SEGMENTS = 26;

function useStop(): { stop: () => Promise<boolean>; busy: boolean; error: string | null } {
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
      return res.ok;
    } catch {
      setError(t("Couldn't stop it — try again."));
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { stop, busy, error };
}

function StopButton({ label, confirmText, lead }: { label: string; confirmText: string; lead: ReactNode }) {
  const t = useT();
  const { stop, busy, error } = useStop();
  const [asking, setAsking] = useState(false);
  return (
    <div className={styles.recFoot}>
      {asking ? (
        <div className={styles.confirm} role="group" aria-label={label}>
          <span>{confirmText}</span>
          <div className={styles.confirmButtons}>
            <button
              type="button"
              className={styles.btnDanger}
              disabled={busy}
              aria-busy={busy}
              onClick={() => void stop().then((ok) => ok && setAsking(false))}
              data-testid="treasury-room-stop-confirm"
            >
              {busy ? t("Stopping…") : t("Yes, stop")}
            </button>
            <button type="button" className={styles.btnGhost} disabled={busy} onClick={() => setAsking(false)}>
              {t("Keep it")}
            </button>
          </div>
        </div>
      ) : (
        <div className={styles.recFootRow}>
          <span className={styles.recFootLead}>{lead}</span>
          <button type="button" className={styles.btnDangerLine} onClick={() => setAsking(true)} data-testid="treasury-room-stop">
            {label}
          </button>
        </div>
      )}
      {error && (
        <p className={styles.errorLine} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/** What goes in and what comes out: the real USDC leads, its story dollars under it in the chat card's words ("$20 a week"). */
function SwapBox({ weeklyUsd, usdcPerUsd, receive, rate }: { weeklyUsd: number; usdcPerUsd: number; receive: string; rate: string | null }) {
  const t = useT();
  return (
    <div className={styles.swap}>
      <div className={styles.swapPanel}>
        <span className={styles.swapLabel}>{t("You pay")}</span>
        <div className={styles.swapRow}>
          <span className={`${styles.swapAmount} ${styles.num}`}>{tokenAmount(weeklyUsd * usdcPerUsd)}</span>
          <TokenPill token="USDC" />
        </div>
        <span className={`${styles.swapSub} ${styles.num}`}>{t("{amount} a week", { amount: usd(weeklyUsd) })}</span>
      </div>
      <span className={styles.swapArrow} aria-hidden>
        <ArrowDown size={16} />
      </span>
      <div className={styles.swapPanel}>
        <span className={styles.swapLabel}>{t("You receive")}</span>
        <div className={styles.swapRow}>
          <span className={`${styles.swapAmount} ${styles.num}`}>{receive}</span>
          <TokenPill token="WETH" />
        </div>
        <span className={`${styles.swapSub} ${styles.num}`}>{rate ?? t("at the pool's price when it buys")}</span>
      </div>
    </div>
  );
}

function WeekTrack({ done, weeks }: { done: number; weeks: number }) {
  if (weeks > MAX_SEGMENTS)
    return (
      <div className={styles.progress} role="progressbar" aria-valuemin={0} aria-valuemax={weeks} aria-valuenow={done}>
        <div className={`${styles.progressFill} ${styles.progressCoral}`} style={{ width: `${Math.min(100, (done / weeks) * 100)}%` }} />
      </div>
    );
  return (
    <div className={styles.weekSegments} style={{ gridTemplateColumns: `repeat(${weeks}, minmax(0, 1fr))` }} role="progressbar" aria-valuemin={0} aria-valuemax={weeks} aria-valuenow={done}>
      {Array.from({ length: weeks }, (_, i) => (
        <i key={i} className={i < done ? styles.segmentCoral : undefined} />
      ))}
    </div>
  );
}

function LiveCard({ live, realRuns, usdcPerUsd }: { live: RecurringLive; realRuns: boolean; usdcPerUsd: number }) {
  const t = useT();
  const intlLocale = useIntlLocale();
  const perBuy = live.boughtWeeks > 0 ? Number(live.wethOut) / live.boughtWeeks : null;
  const rate = live.avgPriceUsdcPerEth ? t("1 ETH ≈ {price} USDC", { price: tokenAmount(Math.round(live.avgPriceUsdcPerEth)) }) : null;
  const thisWeek =
    live.thisWeek === "bought" ? t("Bought this week") : live.thisWeek === "skipped" ? t("Skipped this week") : t("Not bought yet this week");
  const lastDay = dateOnly(new Date(Date.parse(live.expiresAt) - 1000).toISOString(), intlLocale);

  return (
    <>
      <div className={styles.recurringStatus}>
        <span className={`${styles.chip} ${styles.chipOk}`}>
          <span className={styles.liveDot} aria-hidden />
          {t("Running")}
        </span>
        {!realRuns && <span className={`${styles.chip} ${styles.chipInfo}`}>{t("Rehearsal — real buys are off on this server")}</span>}
      </div>

      <SwapBox weeklyUsd={live.weeklyUsd} usdcPerUsd={usdcPerUsd} receive={perBuy === null ? "—" : `≈ ${tokenAmount(perBuy)}`} rate={rate} />

      <div className={styles.week}>
        <div className={styles.weekHead}>
          <strong className={styles.num}>{t("Week {k} of {n}", { k: live.weekIndex, n: live.weeks })}</strong>
          <span className={styles.muted}>
            {live.nextRunAt ? t("Next buy {when}", { when: weekdayDate(live.nextRunAt, intlLocale) }) : t("No buys left in its window")}
          </span>
        </div>
        <WeekTrack done={live.weekIndex} weeks={live.weeks} />
        <p className={styles.weekNext}>
          {thisWeek}
          <span className={styles.muted}> · {t("until {date}", { date: lastDay })}</span>
        </p>
      </div>

      <dl className={styles.stats3}>
        <div>
          <dt>{t("Invested")}</dt>
          <dd className={styles.num}>{usd(live.investedUsd)}</dd>
          <span className={styles.statHint}>{t("{n} buys", { n: live.boughtWeeks })}</span>
        </div>
        <div>
          <dt>{t("WETH bought")}</dt>
          <dd className={styles.num}>{tokenAmount(live.wethOut)}</dd>
          <span className={styles.statHint}>WETH</span>
        </div>
        <div>
          <dt>{t("Avg. entry price")}</dt>
          <dd className={styles.num}>{live.avgPriceUsdcPerEth ? tokenAmount(Math.round(live.avgPriceUsdcPerEth)) : "—"}</dd>
          <span className={styles.statHint}>{t("USDC per ETH")}</span>
        </div>
      </dl>

      <StopButton
        label={t("Stop recurring buy")}
        confirmText={t("Stop it for everyone?")}
        lead={
          <span title={[live.rule, `${t("Terms")} ${live.digestShort}`].filter(Boolean).join(" · ")}>
            {t("Approved by {names}", { names: live.approvedBy.join(", ") || "—" })}
          </span>
        }
      />
    </>
  );
}

function PendingCard({ pending, usdcPerUsd }: { pending: RecurringPending; usdcPerUsd: number }) {
  const t = useT();
  return (
    <>
      <div className={styles.recurringStatus}>
        <span className={`${styles.chip} ${styles.chipWait}`}>
          <span className={styles.chipDot} aria-hidden />
          {t("Waiting for approval")}
        </span>
      </div>
      <SwapBox weeklyUsd={pending.weeklyUsd} usdcPerUsd={usdcPerUsd} receive="—" rate={null} />
      <StopButton
        label={t("Cancel request")}
        confirmText={t("Cancel this request?")}
        lead={<span className={styles.num}>{t("For {weeks} weeks · at most {total} in total", { weeks: pending.weeks, total: usd(pending.exposureUsd) })}</span>}
      />
    </>
  );
}

export function RecurringCard({ status, wallet }: { status: TreasuryStatus; wallet: TreasuryWallet }) {
  const t = useT();
  const rec = status.recurring;
  return (
    <section className={styles.card} data-testid="treasury-room-recurring">
      <div className={styles.cardHead}>
        <h2 className={styles.cardTitle}>{t("Recurring buy")}</h2>
        <span className={styles.badges}>
          <UniswapBadge />
          <ChainBadge chain="base" />
        </span>
      </div>
      {rec === null || rec === undefined ? (
        <p className={styles.emptyLine}>{t("The recurring buy can't be read right now.")}</p>
      ) : rec.live ? (
        <LiveCard live={rec.live} realRuns={rec.realRuns} usdcPerUsd={wallet.usdcPerUsd} />
      ) : rec.pending ? (
        <PendingCard pending={rec.pending} usdcPerUsd={wallet.usdcPerUsd} />
      ) : status.actions.some((a) => a.kind === "recurring-buy" && a.status === "executed") ? (
        // one was adopted and has since been stopped or run out: "yet" would be wrong
        <p className={styles.emptyLine}>{t("No recurring buy running")}</p>
      ) : (
        <p className={styles.emptyLine}>{t("No recurring buy yet. Ask your treasurer: “buy $20 of ETH every week for 26 weeks”.")}</p>
      )}
    </section>
  );
}
