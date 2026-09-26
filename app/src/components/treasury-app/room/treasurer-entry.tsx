"use client";

/**
 * The treasurer, compactly, beside every tab but its own: what it is doing
 * now, and the way to ask it. The chat itself lives on the Treasurer tab, so
 * it is on screen once.
 */

import Link from "next/link";
import { Bot, ChevronRight } from "lucide-react";
import { useT } from "@/i18n/provider";
import type { TreasuryStatus } from "@/lib/agent/treasury/types";
import { treasuryPath } from "./room-model";
import type { TreasuryRoomPerson } from "./room-types";
import styles from "./treasury-room.module.css";

export function TreasurerEntry({ roomId, status, agent }: { roomId: string; status: TreasuryStatus; agent: TreasuryRoomPerson | null }) {
  const t = useT();
  const live = status.recurring?.live ?? null;
  const waiting = status.actions.filter((a) => a.status === "pending").length;

  return (
    <Link href={treasuryPath(roomId, "treasurer")} className={`${styles.card} ${styles.entry}`} data-testid="treasury-room-treasurer-entry">
      <span className={styles.entryHead}>
        {agent?.avatarUrl ? (
          <img src={agent.avatarUrl} alt="" className={styles.entryAvatar} />
        ) : (
          <span className={`${styles.entryAvatar} ${styles.agentMark}`} aria-hidden>
            <Bot size={18} strokeWidth={1.75} />
          </span>
        )}
        <span className={styles.entryWho}>
          <span className={styles.entryTitle}>{t("Your treasurer")}</span>
          <span className={styles.entrySub}>{agent?.displayName ?? ""}</span>
        </span>
      </span>
      <span className={styles.entryState}>
        {live && (
          <span className={`${styles.chip} ${styles.chipOk}`}>
            <span className={styles.chipDot} aria-hidden />
            {t("Recurring buy · week {k} of {n}", { k: live.weekIndex, n: live.weeks })}
          </span>
        )}
        {waiting > 0 && (
          <span className={`${styles.chip} ${styles.chipWait}`}>
            <span className={styles.chipDot} aria-hidden />
            {waiting === 1 ? t("1 request waiting for approval") : t("{n} requests waiting for approval", { n: waiting })}
          </span>
        )}
        {!live && waiting === 0 && <span className={`${styles.chip} ${styles.chipMuted}`}>{t("Nothing running")}</span>}
      </span>
      <span className={styles.entryCta}>
        {t("Ask your treasurer")}
        <ChevronRight size={16} aria-hidden />
      </span>
    </Link>
  );
}
