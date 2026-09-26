"use client";

/**
 * "Needs approval": every request still waiting, a pending recurring buy
 * included. Approving is the existing World ID step-up
 * (/api/auth/world/connect), which comes back to this page.
 */

import { ShieldCheck } from "lucide-react";
import { useT } from "@/i18n/provider";
import type { T } from "@/i18n/translate";
import type { TreasuryStatus } from "@/lib/agent/treasury/types";
import { approvalUrl, expiresIn, requestTitle, treasuryPath, usd } from "./room-model";
import type { TreasuryAction } from "./room-types";
import styles from "./treasury-room.module.css";

/** Why the viewer has no Approve button on a waiting request. */
function waitingLine(t: T, a: TreasuryAction, status: TreasuryStatus, meId: string): string {
  if (a.approvals.some((p) => p.userId === meId)) return t("You approved — waiting for other verified members.");
  if (!status.mySeated) return t("Claim your vote in the room to approve.");
  if (!status.members.find((m) => m.userId === meId)?.voting) return t("You joined after our rules were adopted — your approval counts once the relation re-adopts.");
  return t("Waiting for other verified members.");
}

function RequestRow({ a, status, roomId, meId, now }: { a: TreasuryAction; status: TreasuryStatus; roomId: string; meId: string; now: number }) {
  const t = useT();
  const got = a.approvals.length;
  const need = a.requiredApprovals;
  const pct = need > 0 ? Math.min(100, (got / need) * 100) : 0;
  const quorum = need > 0 && got >= need;
  const pending = status.recurring?.pending?.actionId === a.id ? status.recurring.pending : null;
  const expiry = expiresIn(t, a.expiresAt, now);

  return (
    <li className={styles.request} data-testid="treasury-room-request">
      <div className={styles.requestHead}>
        <span className={styles.requestTitle}>{requestTitle(t, a)}</span>
        <span className={`${styles.chip} ${styles.chipWait}`}>
          <span className={styles.chipDot} aria-hidden />
          {t("Waiting")}
        </span>
      </div>
      <p className={styles.requestMeta}>
        {t("Asked by {name}", { name: a.requestedBy.displayName })}
        {expiry && <> · {expiry}</>}
      </p>
      {pending && (
        <p className={styles.requestTerms}>
          {t("{weekly} of ETH every week for {weeks} weeks · at most {total} in all · Uniswap v3 on Base", {
            weekly: usd(pending.weeklyUsd),
            weeks: pending.weeks,
            total: usd(pending.exposureUsd),
          })}
        </p>
      )}
      {a.ruleText && <p className={styles.quote}>“{a.ruleText}”</p>}

      <div className={styles.progress} role="progressbar" aria-valuemin={0} aria-valuemax={need} aria-valuenow={got}>
        <div className={styles.progressFill} style={{ width: `${pct}%` }} />
      </div>
      <div className={styles.requestFoot}>
        <span className={styles.num}>
          {t("{got} of {need} verified humans", { got, need })}
          {got > 0 && <span className={styles.muted}> · {a.approvals.map((p) => p.displayName).join(", ")}</span>}
        </span>
        {quorum ? (
          <span className={styles.stateText}>{t("Approved — carrying it out…")}</span>
        ) : !status.idpMode ? (
          <span className={styles.stateText}>{t("World ID for Agents is not configured")}</span>
        ) : a.canApprove ? (
          <a className={styles.btnDark} href={approvalUrl(a.id, treasuryPath(roomId))} data-testid="treasury-room-approve">
            <ShieldCheck size={16} aria-hidden />
            {t("Approve with World ID")}
            {status.idpMode === "mock" && <span className={styles.btnNote}>{t("(mock)")}</span>}
          </a>
        ) : (
          <span className={styles.stateText}>{waitingLine(t, a, status, meId)}</span>
        )}
      </div>
    </li>
  );
}

export function ApprovalsCard({ status, roomId, meId, now }: { status: TreasuryStatus; roomId: string; meId: string; now: number }) {
  const t = useT();
  const waiting = status.actions.filter((a) => a.status === "pending").sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return (
    <section className={styles.card} data-testid="treasury-room-approvals">
      <div className={styles.cardHead}>
        <h2 className={styles.cardTitle}>
          {t("Needs approval")}
          {waiting.length > 0 && <span className={styles.count}>{waiting.length}</span>}
        </h2>
      </div>
      {waiting.length === 0 ? (
        <p className={styles.emptyLine}>{t("Nothing is waiting for approval.")}</p>
      ) : (
        <ul className={styles.list}>
          {waiting.map((a) => (
            <RequestRow key={a.id} a={a} status={status} roomId={roomId} meId={meId} now={now} />
          ))}
        </ul>
      )}
    </section>
  );
}
