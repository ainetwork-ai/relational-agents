"use client";

/**
 * The Wallet tab's Contributions card: what came in this month from members' recurring contributions
 * (at demo scale), who contributes, and the way to start one or to see the Contributions tab. Hidden
 * on a server that does not use Base.
 */

import { useState } from "react";
import Link from "next/link";
import { KeyRound } from "lucide-react";
import { useT } from "@/i18n/provider";
import { StartContributionDialog } from "./contribution-dialogs";
import { contributingIds, isRunning, monthKey, monthTotals, myPlan } from "./contributions-model";
import { useTreasuryRoomData } from "./room-data";
import { treasuryPath, usd } from "./room-model";
import type { TreasuryRoomPerson } from "./room-types";
import styles from "./treasury-room.module.css";
import c from "./contributions.module.css";

export function RouteChip() {
  const t = useT();
  return (
    <span className={`${styles.chip} ${styles.chipMuted}`} title={t("Recurring contributions through Uniswap's Permit2, on Base")}>
      <KeyRound size={12} aria-hidden />
      Permit2 · Base
    </span>
  );
}

/** The room's humans as initials; the ones with a running plan in colour. */
export function MemberDots({ people, on }: { people: TreasuryRoomPerson[]; on: Set<string> }) {
  return (
    <span className={c.dots}>
      {people.map((p) =>
        p.avatarUrl ? (
          <img key={p.id} src={p.avatarUrl} alt={p.displayName} title={p.displayName} className={`${c.dot} ${on.has(p.id) ? "" : c.dotOff}`} />
        ) : (
          <span key={p.id} title={p.displayName} className={`${c.dot} ${on.has(p.id) ? "" : c.dotOff}`}>
            {p.displayName.slice(0, 1).toUpperCase()}
          </span>
        )
      )}
    </span>
  );
}

export function ContributionsCard() {
  const t = useT();
  const { roomId, data, at, reload } = useTreasuryRoomData();
  const { contributions, usdcPerUsd } = data.wallet;
  const [starting, setStarting] = useState(false);
  if (contributions.state === "off") return null;

  const humans = data.room.members.filter((p) => !p.isAgent);
  const plans = contributions.plans;
  const month = monthTotals(plans, monthKey(at));
  const paying = contributingIds(humans, plans, at);
  const mine = myPlan(plans, data.me.id, at);
  const pot = contributions.pot;
  const canStart = contributions.state === "ready" && pot !== null && !(mine && isRunning(mine, at));
  const share = month.expectedUsd > 0 ? Math.min(100, (month.collectedUsd / month.expectedUsd) * 100) : 0;

  return (
    <section className={styles.card} data-testid="treasury-room-contributions">
      <div className={styles.cardHead}>
        <h2 className={styles.cardTitle}>{t("Contributions")}</h2>
        <RouteChip />
      </div>
      {contributions.state === "unavailable" ? (
        <p className={c.quiet}>{t("Can't be read right now")}</p>
      ) : (
        <>
          <p className={c.big}>
            {month.expectedUsd > 0 ? (
              <>
                <span className={`${c.bigValue} ${styles.num}`}>{usd(month.collectedUsd)}</span>
                <span className={c.bigSub}>{t("of {expected} collected this month", { expected: usd(month.expectedUsd) })}</span>
              </>
            ) : (
              <span className={c.bigSub}>{plans.length ? t("Nothing due this month") : t("Nobody contributes on a schedule yet")}</span>
            )}
          </p>
          <div className={styles.progress} aria-hidden>
            <div className={styles.progressFill} style={{ width: `${share}%` }} />
          </div>
          <div className={c.whoRow}>
            <MemberDots people={humans} on={paying} />
            <span className={c.quiet}>{t("{n} of {m} members", { n: paying.size, m: humans.length })}</span>
          </div>
        </>
      )}
      <div className={c.actions}>
        {canStart && (
          <button type="button" className={styles.btnDark} onClick={() => setStarting(true)} data-testid="contribution-start-open">
            {t("Start recurring contribution")}
          </button>
        )}
        <Link href={treasuryPath(roomId, "contributions")} className={styles.btnGhost}>
          {t("View")}
        </Link>
      </div>
      {starting && pot && (
        <StartContributionDialog
          roomId={roomId}
          roomName={data.room.name}
          meId={data.me.id}
          pot={pot}
          usdcPerUsd={usdcPerUsd}
          now={at}
          onClose={() => setStarting(false)}
          onChanged={reload}
        />
      )}
    </section>
  );
}
