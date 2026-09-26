"use client";

/**
 * "Needs approval": every request still waiting, a pending recurring buy
 * included — one row each, with its votes and the viewer's next step.
 * Approving is the existing World ID step-up (/api/auth/world/connect), which
 * comes back to this page. With nothing waiting, the card is not shown.
 */

import { useState } from "react";
import { ArrowUpRight, Repeat, ScrollText, ShieldCheck } from "lucide-react";
import { useT } from "@/i18n/provider";
import type { T } from "@/i18n/translate";
import type { TreasuryStatus } from "@/lib/agent/treasury/types";
import { ChainBadge, UniswapBadge } from "@/components/chain/chain-badge";
import { approvalUrl, expiresIn, requestTitle, shortAddress, treasuryPath, usd } from "./room-model";
import type { TreasuryAction } from "./room-types";
import styles from "./treasury-room.module.css";

// up to this many approvals read as one segment each; more read as a bar
const MAX_SEGMENTS = 8;

/** Why the viewer has no Approve button on a waiting request. */
function waitingLine(t: T, a: TreasuryAction, status: TreasuryStatus, meId: string): string {
  if (a.approvals.some((p) => p.userId === meId)) return t("You approved · waiting for others");
  // the Wallet tab draws the claim just above (vote-claim-card.tsx); a 3.0 seat is claimed in the room
  if (!status.mySeated) return status.seatMode === "world-id" ? t("Claim your vote in the room to approve.") : t("Claim your vote above to approve.");
  if (!status.members.find((m) => m.userId === meId)?.voting) return t("Your vote counts after re-adoption");
  return t("Waiting for others");
}

function Votes({ got, need }: { got: number; need: number }) {
  if (need > MAX_SEGMENTS)
    return (
      <span className={styles.voteBar} aria-hidden>
        <i style={{ width: `${Math.min(100, (got / need) * 100)}%` }} />
      </span>
    );
  return (
    <span className={styles.segments} aria-hidden>
      {Array.from({ length: need }, (_, i) => (
        <i key={i} className={i < got ? styles.segmentOn : undefined} />
      ))}
    </span>
  );
}

function ApproveLink({ href, mock }: { href: string; mock: boolean }) {
  const t = useT();
  const [going, setGoing] = useState(false);
  return (
    <a
      className={styles.btnDark}
      href={href}
      aria-busy={going}
      onClick={() => setGoing(true)}
      data-testid="treasury-room-approve"
    >
      <ShieldCheck size={16} aria-hidden />
      {going ? t("Opening World ID…") : t("Approve with World ID")}
      {mock && !going && <span className={styles.btnNote}>{t("(mock)")}</span>}
    </a>
  );
}

function RequestRow({ a, status, roomId, meId, now }: { a: TreasuryAction; status: TreasuryStatus; roomId: string; meId: string; now: number }) {
  const t = useT();
  const got = a.approvals.length;
  const need = a.requiredApprovals;
  const quorum = need > 0 && got >= need;
  const terms = status.recurring?.pending?.actionId === a.id ? status.recurring.pending : null;
  const expiry = expiresIn(t, a.expiresAt, now);
  const to = a.recipient?.label ?? (a.recipient?.address ? shortAddress(a.recipient.address) : null);
  const Icon = a.kind === "recurring-buy" ? Repeat : a.kind === "ratify" ? ScrollText : ArrowUpRight;
  // a recurring buy reads in the words of its card in the chat (lib/agent/treasurer/surfaces.ts)
  const meta = [
    terms
      ? `${t("{amount} a week", { amount: usd(terms.weeklyUsd) })} · ${t("For {weeks} weeks · at most {total} in total", { weeks: terms.weeks, total: usd(terms.exposureUsd) })}`
      : to
        ? t("to {who}", { who: to })
        : null,
    t("Asked by {name}", { name: a.requestedBy.displayName }),
    expiry,
  ].filter(Boolean);

  return (
    <li className={styles.request} data-testid="treasury-room-request">
      <span className={`${styles.txIcon} ${styles.markCoral}`} aria-hidden>
        <Icon size={18} />
      </span>
      <div className={styles.requestMain}>
        <p className={styles.requestTitle}>{a.kind === "recurring-buy" ? t("Recurring buy") : requestTitle(t, a)}</p>
        <p className={styles.requestMeta}>
          {meta.join(" · ")}
          {terms && (
            <>
              <UniswapBadge />
              <ChainBadge chain="base" />
            </>
          )}
        </p>
        <p className={`${styles.votes} ${styles.num}`} title={a.ruleText || undefined}>
          <Votes got={got} need={need} />
          {t("{got} of {need} verified humans", { got, need })}
          {got > 0 && <span className={styles.muted}> · {a.approvals.map((p) => p.displayName).join(", ")}</span>}
        </p>
      </div>
      <div className={styles.requestAction}>
        {quorum ? (
          <span className={styles.stateText}>{t("Approved — carrying it out…")}</span>
        ) : !status.idpMode ? (
          <span className={styles.stateText}>{t("World ID for Agents is not configured")}</span>
        ) : a.canApprove ? (
          <ApproveLink href={approvalUrl(a.id, treasuryPath(roomId))} mock={status.idpMode === "mock"} />
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
  if (waiting.length === 0) return null;
  return (
    <section className={styles.card} data-testid="treasury-room-approvals">
      <div className={styles.cardHead}>
        <div>
          <h2 className={styles.cardTitle}>
            {t("Needs approval")}
            <span className={styles.count}>{waiting.length}</span>
          </h2>
          <p className={styles.cardSub}>{t("Each approval is its own World ID check, made right then.")}</p>
        </div>
      </div>
      <ul className={styles.list}>
        {waiting.map((a) => (
          <RequestRow key={a.id} a={a} status={status} roomId={roomId} meId={meId} now={now} />
        ))}
      </ul>
    </section>
  );
}
