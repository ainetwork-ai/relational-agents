"use client";

/** The treasury's activity, grouped by day — the Home preview and the full Activity tab share it. */

import Link from "next/link";
import { ArrowUpRight, Banknote, CircleSlash, Coins, Repeat, ScrollText, TrendingUp, Wallet } from "lucide-react";
import { useIntlLocale, useT } from "@/i18n/provider";
import type { TreasuryStatus } from "@/lib/agent/treasury/types";
import { buildActivity, groupByDay, timeOnly, treasuryPath, type ActivityItem } from "./room-model";
import styles from "./treasury-room.module.css";

const ICONS: Record<ActivityItem["icon"], typeof Banknote> = {
  rules: ScrollText,
  recurring: Repeat,
  buy: Coins,
  skip: CircleSlash,
  pay: Banknote,
  invest: TrendingUp,
  withdraw: Wallet,
};

const TONE_CLASS: Record<ActivityItem["tone"], string> = {
  ok: styles.toneOk,
  wait: styles.toneWait,
  bad: styles.toneBad,
  info: styles.toneInfo,
};

function Row({ item, intlLocale }: { item: ActivityItem; intlLocale: string }) {
  const Icon = ICONS[item.icon];
  const body = (
    <>
      <span className={`${styles.feedIcon} ${TONE_CLASS[item.tone]}`} aria-hidden>
        <Icon size={16} />
      </span>
      <span className={styles.feedText}>
        <span className={styles.feedTitle}>{item.title}</span>
        {item.detail && <span className={styles.feedDetail}>{item.detail}</span>}
      </span>
      <span className={styles.feedRight}>
        {item.amount && <span className={`${styles.feedAmount} ${styles.num}`}>{item.amount}</span>}
        <span className={`${styles.feedTime} ${styles.num}`}>
          {timeOnly(item.at, intlLocale)}
          {item.href && <ArrowUpRight size={12} aria-hidden />}
        </span>
      </span>
    </>
  );
  return (
    <li>
      {item.href ? (
        <a href={item.href} target="_blank" rel="noreferrer" className={`${styles.feedRow} ${styles.feedLink}`}>
          {body}
        </a>
      ) : (
        <div className={styles.feedRow}>{body}</div>
      )}
    </li>
  );
}

export function ActivityFeed({ status, roomId, now, limit }: { status: TreasuryStatus; roomId: string; now: number; limit?: number }) {
  const t = useT();
  const intlLocale = useIntlLocale();
  const all = buildActivity(t, status);
  const shown = limit ? all.slice(0, limit) : all;
  const days = groupByDay(t, shown, intlLocale, new Date(now));

  return (
    <section className={styles.card} data-testid="treasury-room-activity">
      <div className={styles.cardHead}>
        <h2 className={styles.cardTitle}>{t("Activity")}</h2>
        {limit && all.length > limit && (
          <Link href={treasuryPath(roomId, "activity")} className={styles.pillLink}>
            {t("See all")}
          </Link>
        )}
      </div>
      {days.length === 0 ? (
        <p className={styles.emptyLine}>{t("No treasury activity yet.")}</p>
      ) : (
        days.map((day) => (
          <div key={day.key} className={styles.feedDay}>
            <h3 className={styles.feedDayLabel}>{day.label}</h3>
            <ul className={styles.list}>
              {day.items.map((item) => (
                <Row key={item.id} item={item} intlLocale={intlLocale} />
              ))}
            </ul>
          </div>
        ))
      )}
      {!limit && (
        <p className={styles.footnote}>
          {t("Shows the 20 most recent requests and the last 26 recurring buy runs. The relation's memory doc keeps the full Treasury Activity log.")}
        </p>
      )}
    </section>
  );
}
