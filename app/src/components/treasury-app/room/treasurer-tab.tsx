"use client";

/**
 * /treasury/[roomId]/treasurer — the room's agent as the relation's
 * Treasurer: what it is running now, what it did lately, its one wallet on
 * both chains, the adopted rules it follows, and what it never does.
 */

import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { useIntlLocale, useT } from "@/i18n/provider";
import { ActivityFeed } from "./activity-feed";
import { useTreasuryRoomData } from "./room-data";
import { BASE_EXPLORER, SEPOLIA_EXPLORER, dateOnly, dateTime, ruleBars, shortAddress, treasuryPath, usd, weekdayDate } from "./room-model";
import styles from "./treasury-room.module.css";

const BAR_TONE = { ok: styles.chipOk, wait: styles.chipWait, bad: styles.chipBad, info: styles.chipMuted } as const;

export function TreasurerTab() {
  const t = useT();
  const intlLocale = useIntlLocale();
  const { roomId, data, at } = useTreasuryRoomData();
  const { status, room } = data;
  const agent = room.members.find((p) => p.isAgent) ?? null;
  const live = status.recurring?.live ?? null;
  const pendingBuy = status.recurring?.pending ?? null;
  const waiting = status.actions.filter((a) => a.status === "pending").length;
  const bars = ruleBars(t, status.rules);

  const never = [
    t("Decides to move money on its own judgement — money sentences are matched by shape and our rules set the bar."),
    t("Spends beyond what our rules let it do alone, or beyond an authority the members approved."),
    t("Changes its own rules — only the members adopt them, with World ID."),
    t("Buys more than once a week under a recurring buy, or after anyone stops it."),
    t("Uses a second wallet — one address holds the pot on Sepolia and buys on Base."),
  ];

  return (
    <div className={styles.stack}>
      <section className={styles.card}>
        <div className={styles.treasurerHero}>
          {agent?.avatarUrl ? (
            <img src={agent.avatarUrl} alt="" className={styles.heroAvatar} />
          ) : (
            <span className={`${styles.heroAvatar} ${styles.agentMark}`} aria-hidden>
              ✦
            </span>
          )}
          <div>
            <h2 className={styles.cardTitle}>{agent?.displayName ?? t("Your treasurer")}</h2>
            <p className={styles.cardSub}>{t("Treasurer of {room}", { room: room.name })}</p>
          </div>
        </div>
      </section>

      <section className={styles.card} data-testid="treasury-room-running">
        <div className={styles.cardHead}>
          <h2 className={styles.cardTitle}>{t("Running now")}</h2>
        </div>
        <ul className={styles.bullets}>
          {live && (
            <li>
              {t("A recurring buy: {weekly} of ETH weekly, week {k} of {n}. Next buy {when}.", {
                weekly: usd(live.weeklyUsd),
                k: live.weekIndex,
                n: live.weeks,
                when: live.nextRunAt ? weekdayDate(live.nextRunAt, intlLocale) : "—",
              })}
            </li>
          )}
          {pendingBuy && (
            <li>
              {t("A recurring buy waiting for approval: {weekly} weekly for {weeks} weeks ({got} of {need}).", {
                weekly: usd(pendingBuy.weeklyUsd),
                weeks: pendingBuy.weeks,
                got: pendingBuy.approvals,
                need: pendingBuy.required,
              })}
            </li>
          )}
          {waiting > 0 && (
            <li>
              <Link href={treasuryPath(roomId)} className={styles.inlineLink}>
                {waiting === 1 ? t("1 request waiting for approval") : t("{n} requests waiting for approval", { n: waiting })}
              </Link>
            </li>
          )}
          {!live && !pendingBuy && waiting === 0 && <li>{t("Nothing — no recurring buy and no request waiting.")}</li>}
        </ul>
      </section>

      <section className={styles.card} data-testid="treasury-room-wallets">
        <div className={styles.cardHead}>
          <div>
            <h2 className={styles.cardTitle}>{t("Wallets")}</h2>
            <p className={styles.cardSub}>{t("One agent address on two chains")}</p>
          </div>
        </div>
        {status.address ? (
          <ul className={styles.list}>
            <li className={styles.walletRow}>
              <span className={styles.walletChain}>Sepolia</span>
              <span className={styles.walletText}>
                <span>{t("The shared pot")}</span>
                <span className={styles.mono}>{shortAddress(status.address)}</span>
              </span>
              <a href={`${SEPOLIA_EXPLORER}/address/${status.address}`} target="_blank" rel="noreferrer" className={styles.pillLink}>
                Etherscan <ExternalLink size={12} aria-hidden />
              </a>
            </li>
            <li className={styles.walletRow}>
              <span className={`${styles.walletChain} ${styles.walletBase}`}>Base</span>
              <span className={styles.walletText}>
                <span>{t("Recurring buys and investments")}</span>
                <span className={styles.mono}>{shortAddress(status.address)}</span>
              </span>
              <a href={`${BASE_EXPLORER}/address/${status.address}`} target="_blank" rel="noreferrer" className={styles.pillLink}>
                Basescan <ExternalLink size={12} aria-hidden />
              </a>
            </li>
          </ul>
        ) : (
          <p className={styles.emptyLine}>{t("The wallet can't be read right now.")}</p>
        )}
      </section>

      <section className={styles.card} data-testid="treasury-room-follows">
        <div className={styles.cardHead}>
          <div>
            <h2 className={styles.cardTitle}>{t("Rules it follows")}</h2>
            <p className={styles.cardSub}>
              {status.adoptedAt
                ? t("As adopted on {date}", { date: dateOnly(status.adoptedAt, intlLocale) })
                : t("Not adopted yet — until they are, it moves no money")}
            </p>
          </div>
          <Link href={treasuryPath(roomId, "rules")} className={styles.pillLink}>
            {t("Rules")}
          </Link>
        </div>
        <ul className={styles.list}>
          {bars.map((r) => (
            <li key={r.text} className={styles.ruleRow}>
              <span className={styles.ruleText}>{r.text}</span>
              {r.bar && <span className={`${styles.chip} ${BAR_TONE[r.tone]}`}>{r.bar}</span>}
            </li>
          ))}
        </ul>
      </section>

      <section className={styles.card} data-testid="treasury-room-never">
        <div className={styles.cardHead}>
          <h2 className={styles.cardTitle}>{t("Never does")}</h2>
        </div>
        <ul className={styles.bullets}>
          {never.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </section>

      <ActivityFeed status={status} roomId={roomId} now={at} limit={5} />
    </div>
  );
}
