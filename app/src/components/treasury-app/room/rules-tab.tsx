"use client";

/**
 * /treasury/[roomId]/rules — the rules the treasurer enforces (the adopted
 * version), the bar each one sets, who adopted them, doc edits nobody has
 * adopted yet, and the members whose approvals count.
 */

import Link from "next/link";
import { useIntlLocale, useT } from "@/i18n/provider";
import { MembersCard } from "./members-card";
import { useTreasuryRoomData } from "./room-data";
import { adoptionInForce, dateOnly, ruleBars } from "./room-model";
import styles from "./treasury-room.module.css";

const BAR_TONE = { ok: styles.chipOk, wait: styles.chipWait, bad: styles.chipBad, info: styles.chipMuted } as const;

export function RulesTab() {
  const t = useT();
  const intlLocale = useIntlLocale();
  const { data } = useTreasuryRoomData();
  const { status, room, me } = data;
  const bars = ruleBars(t, status.rules);
  const adoption = adoptionInForce(status);
  const proposal = status.proposal;
  const hasProposal = proposal && (proposal.added.length > 0 || proposal.removed.length > 0 || proposal.joined.length > 0 || proposal.reordered);

  return (
    <div className={styles.stack}>
      <section className={styles.card} data-testid="treasury-room-rules">
        <div className={styles.cardHead}>
          <div>
            <h2 className={styles.cardTitle}>{t("Rules in force")}</h2>
            <p className={styles.cardSub}>
              {status.adoptedAt
                ? t("Adopted on {date}", { date: dateOnly(status.adoptedAt, intlLocale) })
                : t("Not adopted yet — the treasurer moves no money until they are")}
            </p>
          </div>
          {status.rulesPageId && (
            <Link href={`/p/${status.rulesPageId}`} className={styles.pillLink}>
              {t("Open relation doc")}
            </Link>
          )}
        </div>

        {/* a founding adoption needs no votes: it carries only its own words */}
        {adoption && (adoption.requiredApprovals > 0 || adoption.ruleText) && (
          <p className={styles.adoption}>
            {adoption.requiredApprovals > 0 && (
              <>
                {t("Approved by {names}", { names: adoption.approvals.map((p) => p.displayName).join(", ") || "—" })}{" "}
                <span className={`${styles.muted} ${styles.num}`}>
                  {t("({got} of {need} verified humans)", { got: adoption.approvals.length, need: adoption.requiredApprovals })}
                </span>
              </>
            )}
            {adoption.ruleText && <span className={styles.quote}> “{adoption.ruleText}”</span>}
          </p>
        )}

        {bars.length === 0 ? (
          <p className={styles.emptyLine}>{t("No rules yet.")}</p>
        ) : (
          <ul className={styles.list}>
            {bars.map((r, i) => (
              <li key={r.text} className={styles.ruleRow}>
                <span className={`${styles.ruleIndex} ${styles.num}`}>{i + 1}</span>
                <span className={styles.ruleText}>{r.text}</span>
                <span className={`${styles.chip} ${BAR_TONE[r.tone]}`}>{r.bar ?? t("Unreadable — moves no money")}</span>
              </li>
            ))}
          </ul>
        )}
        <p className={styles.footnote}>{t("A forbidding rule wins, then the highest bar. A request no rule covers is refused.")}</p>
      </section>

      {hasProposal && proposal && (
        <section className={styles.card} data-testid="treasury-room-proposal">
          <div className={styles.cardHead}>
            <div>
              <h2 className={styles.cardTitle}>{t("Edits not adopted yet")}</h2>
              <p className={styles.cardSub}>{t("Applies once the relation adopts it.")}</p>
            </div>
          </div>
          <ul className={styles.diff}>
            {proposal.added.map((l) => (
              <li key={`+${l}`} className={styles.diffAdd}>
                + {l}
              </li>
            ))}
            {proposal.removed.map((l) => (
              <li key={`-${l}`} className={styles.diffDel}>
                − {l}
              </li>
            ))}
            {proposal.joined.map((n) => (
              <li key={`j${n}`} className={styles.diffAdd}>
                {t("+ {name} votes", { name: n })}
              </li>
            ))}
            {proposal.reordered && <li className={styles.muted}>{t("The order of the rules changed (it decides which rule is cited).")}</li>}
          </ul>
        </section>
      )}

      <MembersCard status={status} people={room.members} meId={me.id} />
    </div>
  );
}
