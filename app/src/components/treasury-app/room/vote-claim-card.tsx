"use client";

/**
 * Claiming a vote from the treasury page — the room panel's IDKit claim
 * (SeatButton), so someone who opened the treasury needn't go back to the room
 * before they can approve. Shown only to a member without a vote; the page
 * re-reads the status once the server has seated them.
 */

import { useState } from "react";
import dynamic from "next/dynamic";
import { useT } from "@/i18n/provider";
import type { SeatClaimError, SeatEnvironment } from "@/components/treasury/seat-button";
import { STAGING_HINT } from "@/components/treasury/world-result-copy";
import type { TreasuryStatus } from "@/lib/agent/treasury/types";
import styles from "./treasury-room.module.css";

/** IDKit is heavy; only a member who can claim pulls it in. */
const SeatButton = dynamic(() => import("@/components/treasury/seat-button").then((m) => m.SeatButton), { ssr: false });

const APP_ID = process.env.NEXT_PUBLIC_WORLD_ID_APP_ID ?? "";
const ENV: SeatEnvironment =
  (["production", "staging", "sandbox"] as const).find((e) => e === process.env.NEXT_PUBLIC_WORLD_ID_ENV) ?? "staging";

const SAME_HUMAN = "This human already has a vote in this relation — one human, one vote.";

export function VoteClaimCard({ status, roomId, onSeated }: { status: TreasuryStatus; roomId: string; onSeated: () => void | Promise<void> }) {
  const t = useT();
  const [error, setError] = useState<SeatClaimError | null>(null);
  const [claimed, setClaimed] = useState(false);
  const [devBusy, setDevBusy] = useState(false);

  if (claimed)
    return (
      <p className={`${styles.banner} ${styles.bannerOk}`} role="status" data-testid="treasury-room-vote-claimed">
        {t("🌍 Vote claimed — World ID confirmed you're a unique human. One human, one vote.")}
      </p>
    );
  if (status.mySeated) return null;

  const appId = status.seatAppId ?? APP_ID;
  // the dev simulator seats without a proof: only where the server runs it
  const claimDev = async () => {
    setDevBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/dm/rooms/${encodeURIComponent(roomId)}/treasury/seat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      const data = (await res.json().catch(() => ({}))) as { reason?: string; message?: string; error?: string };
      if (!res.ok) {
        setError({ sameHuman: res.status === 409 || data.reason === "same-human", text: data.message || data.error || `Claiming your vote failed (${res.status})` });
        return;
      }
      setClaimed(true);
      await onSeated();
    } finally {
      setDevBusy(false);
    }
  };

  return (
    <section className={styles.card} data-testid="treasury-room-vote-claim">
      <div className={styles.cardHead}>
        <div>
          <h2 className={styles.cardTitle}>{t("Claim your vote")}</h2>
          <p className={styles.cardSub}>
            {t("Once per member: World ID proves you're a unique human, so one person can't hold two votes. Only members with a vote can approve what the agent asks to spend.")}
          </p>
        </div>
      </div>
      {status.seatMode === "world-id-v4" ? (
        appId.startsWith("app_") ? (
          <SeatButton
            roomId={roomId}
            appId={appId as `app_${string}`}
            action={status.seatAction}
            environment={status.seatEnvironment ?? ENV}
            className={styles.btnDark}
            labels={{ idle: t("🌍 Claim your vote with World ID"), starting: t("Starting World ID…"), stagingHint: t(STAGING_HINT) }}
            hintClassName={styles.cardSub}
            onSeated={() => setClaimed(true)}
            onClaimed={onSeated}
            onError={setError}
          />
        ) : (
          <p className={styles.stateText}>{t("World ID isn't available in this build (NEXT_PUBLIC_WORLD_ID_APP_ID is missing).")}</p>
        )
      ) : status.seatMode === "dev-simulator" ? (
        <button type="button" className={styles.btnDark} onClick={() => void claimDev()} disabled={devBusy} data-testid="treasury-seat-claim">
          {devBusy ? t("Verifying…") : t("Claim your vote (dev simulator)")}
        </button>
      ) : (
        // the World ID 3.0 widget needs the room's signed context — it lives in the room panel
        <p className={styles.stateText}>{t("Claim your vote in the room to approve.")}</p>
      )}
      {error && (
        <p className={`${styles.banner} ${styles.bannerBad}`} role="alert" data-testid="treasury-room-vote-error">
          {error.sameHuman ? `⛔ ${t(SAME_HUMAN)}` : error.text}
        </p>
      )}
    </section>
  );
}
