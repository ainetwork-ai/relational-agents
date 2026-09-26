"use client";

/**
 * /treasury/[roomId]/treasurer — the room's agent as the relation's
 * Treasurer: what it is running now, what it did lately, the adopted rules
 * it follows, and what it never does. Its wallet is the Wallet tab.
 */

import Link from "next/link";
import { Bot } from "lucide-react";
import { useIntlLocale, useT } from "@/i18n/provider";
import { ActivityFeed } from "./activity-feed";
import { useTreasuryRoomData } from "./room-data";
import { dateOnly, ruleBars, treasuryPath, usd, weekdayDate } from "./room-model";
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
    t("Moves money on its own judgement"),
    t("Spends beyond our rules or an approved authority"),
    t("Changes its own rules"),
    t("Buys twice in one week, or after a stop"),
    t("Uses a second wallet"),
  ];

  return (
    <div className={styles.stack}>
      <section className={styles.card}>
        <div className={styles.treasurerHero}>
          {agent?.avatarUrl ? (
            <img src={agent.avatarUrl} alt="" className={styles.heroAvatar} />
          ) : (
            <span className={`${styles.heroAvatar} ${styles.agentMark}`} aria-hidden>
              <Bot size={18} strokeWidth={1.75} />
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

      <ActivityFeed status={status} wallet={data.wallet} roomId={roomId} now={at} variant="all" limit={5} />
    </div>
  );
}
