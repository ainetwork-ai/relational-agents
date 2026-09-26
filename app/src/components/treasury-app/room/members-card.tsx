"use client";

/** Members: who is in the relation, whose vote counts, and who asked for and approved what lately. */

import { BadgeCheck } from "lucide-react";
import { useT } from "@/i18n/provider";
import type { TreasuryStatus } from "@/lib/agent/treasury/types";
import { memberContributions } from "./room-model";
import type { TreasuryRoomPerson } from "./room-types";
import styles from "./treasury-room.module.css";

export function MembersCard({ status, people, meId }: { status: TreasuryStatus; people: TreasuryRoomPerson[]; meId: string }) {
  const t = useT();
  const avatarOf = new Map(people.map((p) => [p.id, p.avatarUrl]));
  const rows = memberContributions(status);
  return (
    <section className={styles.card} data-testid="treasury-room-members">
      <div className={styles.cardHead}>
        <h2 className={styles.cardTitle}>{t("Members")}</h2>
      </div>
      <ul className={styles.list}>
        {rows.map((m) => {
          const avatar = avatarOf.get(m.userId);
          return (
            <li key={m.userId} className={styles.member}>
              {avatar ? (
                <img src={avatar} alt="" className={styles.memberAvatar} />
              ) : (
                <span className={styles.memberAvatar} aria-hidden>
                  {m.displayName.slice(0, 1).toUpperCase()}
                </span>
              )}
              <span className={styles.memberText}>
                <span className={styles.memberName}>
                  {m.displayName}
                  {m.userId === meId && <span className={styles.muted}> · {t("you")}</span>}
                </span>
                <span className={styles.memberBadges}>
                  {m.seated ? (
                    <span className={`${styles.chip} ${styles.chipOk}`}>
                      <BadgeCheck size={12} aria-hidden />
                      {t("Verified human")}
                    </span>
                  ) : (
                    <span className={`${styles.chip} ${styles.chipMuted}`}>{t("No vote claimed")}</span>
                  )}
                  {!m.voting && <span className={`${styles.chip} ${styles.chipWait}`}>{t("Votes after re-adoption")}</span>}
                </span>
              </span>
              <span className={`${styles.memberStats} ${styles.num}`}>
                <span>
                  <strong>{m.approvals}</strong> {m.approvals === 1 ? t("approval") : t("approvals")}
                </span>
                <span>
                  <strong>{m.requests}</strong> {m.requests === 1 ? t("request") : t("requests")}
                </span>
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
