"use client";

/** /treasury/[roomId] — the main column of Home; the shell adds the treasurer column beside it. */

import { useT } from "@/i18n/provider";
import { AccountCard, ActionRow } from "./account-card";
import { ActivityFeed } from "./activity-feed";
import { ApprovalsCard } from "./approvals-card";
import { MembersCard } from "./members-card";
import { RecurringCard } from "./recurring-card";
import { useTreasuryRoomData } from "./room-data";
import styles from "./treasury-room.module.css";

export function TreasuryHome() {
  const t = useT();
  const { roomId, data, at } = useTreasuryRoomData();
  const { status, room, me } = data;

  if (!status.enabled)
    return (
      <div className={`${styles.card} ${styles.empty}`}>
        <p className={styles.emptyTitle}>{t("This relation has no treasury yet")}</p>
        <p className={styles.emptyText}>
          {t("A treasury starts when the relation's memory doc has Treasury Rules and the room has its agent.")}
        </p>
      </div>
    );

  return (
    <div className={styles.stack}>
      <AccountCard status={status} roomName={room.name} people={room.members} />
      <ActionRow roomId={roomId} />
      {!status.adoptedAt && (
        <p className={`${styles.banner} ${styles.bannerInfo}`}>
          {t("Our rules haven't been adopted yet, so the treasurer moves no money. Ask it to adopt the rules.")}
        </p>
      )}
      <ApprovalsCard status={status} roomId={roomId} meId={me.id} now={at} />
      <RecurringCard status={status} />
      <MembersCard status={status} people={room.members} meId={me.id} />
      <ActivityFeed status={status} roomId={roomId} now={at} limit={8} />
    </div>
  );
}

export function TreasuryActivityTab() {
  const { roomId, data, at } = useTreasuryRoomData();
  return <ActivityFeed status={data.status} roomId={roomId} now={at} />;
}
