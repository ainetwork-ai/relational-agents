"use client";

/**
 * /treasury/[roomId] — the Wallet tab, the Treasury's default view: the
 * agent's wallet and what it holds on each chain, what waits for approval,
 * the wallet's transactions and the recurring buy. The shell adds the
 * treasurer column beside it. /activity lists every treasury row.
 */

import Link from "next/link";
import { FileText } from "lucide-react";
import { useT } from "@/i18n/provider";
import { ActivityFeed } from "./activity-feed";
import { ApprovalsCard } from "./approvals-card";
import { ContributionsCard } from "./contributions-card";
import { Holdings } from "./holdings";
import { RecurringCard } from "./recurring-card";
import { useTreasuryRoomData } from "./room-data";
import { VoteClaimCard } from "./vote-claim-card";
import { WalletCard } from "./wallet-card";
import styles from "./treasury-room.module.css";

function NoTreasury({ docPageId }: { docPageId: string | null }) {
  const t = useT();
  return (
    <div className={`${styles.card} ${styles.empty}`}>
      <p className={styles.emptyTitle}>{t("This relation has no treasury yet")}</p>
      {docPageId && (
        <Link href={`/p/${docPageId}`} className={styles.btnGhost}>
          <FileText size={16} aria-hidden />
          {t("Open relation doc")}
        </Link>
      )}
    </div>
  );
}

export function TreasuryHome() {
  const t = useT();
  const { roomId, data, at, reload } = useTreasuryRoomData();
  const { status, room, me, wallet } = data;

  if (!status.enabled) return <NoTreasury docPageId={room.docPageId} />;

  return (
    <div className={styles.stack}>
      <WalletCard status={status} wallet={wallet} people={room.members} />
      {!status.adoptedAt && <p className={`${styles.banner} ${styles.bannerInfo}`}>{t("Rules not adopted yet — no money moves")}</p>}
      <Holdings status={status} wallet={wallet} />
      <VoteClaimCard status={status} roomId={roomId} onSeated={reload} />
      <ApprovalsCard status={status} roomId={roomId} meId={me.id} now={at} />
      <ContributionsCard />
      <ActivityFeed status={status} wallet={wallet} roomId={roomId} now={at} variant="transactions" limit={6} />
      <RecurringCard status={status} wallet={wallet} />
    </div>
  );
}

export function TreasuryActivityTab() {
  const { roomId, data, at } = useTreasuryRoomData();
  return <ActivityFeed status={data.status} wallet={data.wallet} roomId={roomId} now={at} variant="all" />;
}
