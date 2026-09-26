"use client";

/**
 * One row per relation that holds a treasury: name + colour dot, pot,
 * recurring buy, the viewer's approvals and the newest treasury action.
 * A table on desktop, stacked cards under 768px; each row opens /treasury/<roomId>.
 */

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { useIntlLocale, useT } from "@/i18n/provider";
import type { T } from "@/i18n/translate";
import { agoPhrase, formatBalance, recurringPhrase, relationColor, type Phrase } from "./overview-model";
import type { TreasurySummaryRoom } from "@/lib/agent/treasury/summary";
import { TREASURY_TIME_ZONE } from "@/lib/agent/treasury/types";
import styles from "./treasury-overview.module.css";

function say(t: T, phrase: Phrase): string {
  return t(phrase.key, phrase.vars);
}

function nextRunLabel(iso: string, intlLocale: string): string | null {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  // the day the next week opens, on the relation's clock — a buy runs when a member asks, not at a set hour
  return new Intl.DateTimeFormat(intlLocale, { weekday: "short", month: "short", day: "numeric", timeZone: TREASURY_TIME_ZONE }).format(at);
}

function RecurringCell({ room }: { room: TreasurySummaryRoom }) {
  const t = useT();
  const intlLocale = useIntlLocale();
  const recurring = room.recurring;
  const phrase = recurringPhrase(recurring);
  if (!recurring || !phrase) {
    return (
      <div className={styles.recurring}>
        <span className={styles.muted}>—</span>
      </div>
    );
  }
  if (recurring.state === "pending") {
    return (
      <div className={styles.recurring}>
        <span className={`${styles.chip} ${styles.chipWait}`}>
          <i className={styles.chipDot} />
          {say(t, phrase)}
        </span>
      </div>
    );
  }
  const next = recurring.nextRunAt ? nextRunLabel(recurring.nextRunAt, intlLocale) : null;
  return (
    <div className={styles.recurring}>
      <span className={`${styles.recurringLine} ${styles.num}`}>
        <i className={styles.liveDot} aria-hidden />
        {say(t, phrase)}
      </span>
      {recurring.boughtThisWeek ? (
        <span className={`${styles.recurringSub} ${styles.recurringSubOk}`}>{t("Bought this week")}</span>
      ) : next ? (
        <span className={styles.recurringSub}>{t("Next buy {when}", { when: next })}</span>
      ) : null}
    </div>
  );
}

function ApprovalsCell({ room }: { room: TreasurySummaryRoom }) {
  const t = useT();
  if (room.pendingForMe > 0) {
    return (
      <div className={styles.approvals}>
        <span className={styles.cellLabel}>{t("Needs you")}</span>
        <span className={`${styles.count} ${styles.num}`} aria-label={t("{n} waiting on you", { n: room.pendingForMe })}>
          {room.pendingForMe}
        </span>
      </div>
    );
  }
  const others = room.pendingTotal - room.pendingForMe;
  return (
    <div className={`${styles.approvals} ${others > 0 ? "" : styles.approvalsNone}`}>
      {others > 0 ? (
        <span className={styles.others}>{t("{n} waiting on others", { n: others })}</span>
      ) : (
        <span className={styles.muted}>—</span>
      )}
    </div>
  );
}

function RelationRow({ room, now }: { room: TreasurySummaryRoom; now: number }) {
  const t = useT();
  const ago = room.latest ? agoPhrase(room.latest.at, now) : null;
  return (
    <li>
      <Link href={`/treasury/${encodeURIComponent(room.roomId)}`} className={styles.tr} data-testid="treasury-overview-row">
        <div className={styles.relation}>
          <i className={styles.dot} style={{ background: relationColor(room.roomId) }} aria-hidden />
          <span className={styles.relationName}>{room.roomName}</span>
        </div>
        <div className={`${styles.balance} ${styles.num}`}>
          {room.balanceUsd === null ? (
            <span className={styles.muted} aria-label={t("Balance unknown")}>—</span>
          ) : (
            formatBalance(room.balanceUsd)
          )}
        </div>
        <RecurringCell room={room} />
        <ApprovalsCell room={room} />
        <div className={styles.latest}>
          {room.latest ? (
            <>
              {/* the summary route writes this line in English; it is shown as given */}
              <span className={styles.latestLine}>{room.latest.line}</span>
              {ago && <span className={styles.latestAt}>{say(t, ago)}</span>}
            </>
          ) : (
            <span className={styles.muted}>{t("No activity yet")}</span>
          )}
        </div>
        <ChevronRight className={styles.chev} size={16} strokeWidth={2} aria-hidden />
      </Link>
    </li>
  );
}

export function OverviewList({ rooms, now }: { rooms: TreasurySummaryRoom[]; now: number }) {
  const t = useT();
  return (
    <>
      <div className={styles.th} aria-hidden>
        <span>{t("Relation")}</span>
        <span className={styles.thRight}>{t("Shared pot")}</span>
        <span className={styles.thIndent}>{t("Recurring buy")}</span>
        <span className={styles.thRight}>{t("Your approvals")}</span>
        <span>{t("Latest activity")}</span>
        <span />
      </div>
      <ul className={styles.list}>
        {rooms.map((room) => (
          <RelationRow key={room.roomId} room={room} now={now} />
        ))}
      </ul>
    </>
  );
}

export function OverviewListSkeleton() {
  return (
    <div aria-hidden>
      {[0, 1, 2].map((i) => (
        <div key={i} className={styles.skeleton}>
          <span className={styles.skeletonBar} style={{ width: 120 }} />
          <span className={styles.skeletonBar} style={{ width: 70, marginLeft: "auto" }} />
        </div>
      ))}
    </div>
  );
}
