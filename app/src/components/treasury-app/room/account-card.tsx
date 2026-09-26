"use client";

/**
 * The coral account card (pot balance, demo scale, the agent's one address)
 * and the four action buttons under it. The pot moves only through the
 * treasurer and the relation's approvals, so Deposit · Send · Swap explain
 * what to ask instead of moving money themselves.
 */

import { useState } from "react";
import Link from "next/link";
import { ArrowDownToLine, ArrowLeftRight, ExternalLink, Info, ScrollText, Send } from "lucide-react";
import { useT } from "@/i18n/provider";
import type { TreasuryStatus } from "@/lib/agent/treasury/types";
import { BASE_EXPLORER, SEPOLIA_EXPLORER, shortAddress, tokenAmount, treasuryPath, usd } from "./room-model";
import type { TreasuryRoomPerson } from "./room-types";
import styles from "./treasury-room.module.css";

type Hint = "deposit" | "send" | "swap";

function Avatars({ people }: { people: TreasuryRoomPerson[] }) {
  const shown = people.slice(0, 5);
  return (
    <span className={styles.avatars}>
      {shown.map((p) =>
        p.avatarUrl ? (
          <img key={p.id} src={p.avatarUrl} alt={p.displayName} title={p.displayName} className={styles.avatar} />
        ) : (
          <span key={p.id} className={styles.avatar} title={p.displayName}>
            {p.displayName.slice(0, 1).toUpperCase()}
          </span>
        )
      )}
      {people.length > shown.length && <span className={`${styles.avatar} ${styles.avatarMore}`}>+{people.length - shown.length}</span>}
    </span>
  );
}

export function AccountCard({ status, roomName, people }: { status: TreasuryStatus; roomName: string; people: TreasuryRoomPerson[] }) {
  const t = useT();
  const [tip, setTip] = useState(false);
  const humans = people.filter((p) => !p.isAgent);
  const ethPerUsd = status.usdPerEth > 0 ? 1 / status.usdPerEth : 0;

  return (
    <section className={styles.account} data-testid="treasury-room-account">
      <div className={styles.accountTop}>
        <div className={styles.accountWho}>
          <span className={styles.accountName}>{roomName}</span>
          <span className={styles.accountMembers}>{t("{n} members", { n: humans.length })}</span>
        </div>
        <Avatars people={humans} />
      </div>

      <p className={styles.accountLabel}>{t("Shared pot")}</p>
      <p className={`${styles.accountBalance} ${styles.num}`} data-testid="treasury-room-balance">
        {status.balanceUsd === null ? "—" : usd(status.balanceUsd)}
      </p>
      <div className={styles.accountScale}>
        <span className={styles.num}>
          {status.balanceEth ? `${tokenAmount(status.balanceEth)} SepETH` : "SepETH"} · Sepolia · {t("Demo scale")}
        </span>
        <button
          type="button"
          className={styles.tipButton}
          aria-expanded={tip}
          aria-label={t("What is demo scale?")}
          onClick={() => setTip(!tip)}
        >
          <Info size={14} aria-hidden />
        </button>
      </div>
      {tip && (
        <p className={styles.tip} role="note">
          {t("Demo scale: the pot holds testnet ETH, counted at {rate} per ETH so small testnet amounts read as trip-size dollars — $1 is {eth} SepETH.", {
            rate: usd(status.usdPerEth),
            eth: tokenAmount(ethPerUsd),
          })}
        </p>
      )}
      {status.invested && Number(status.invested.weth) > 0 && (
        <p className={styles.accountInvested}>
          {t("+ {amount} invested · {weth} WETH on Base", { amount: usd(status.invested.storyUsd), weth: tokenAmount(status.invested.weth) })}
        </p>
      )}

      {status.address && (
        <div className={styles.accountAddress}>
          <a
            href={`${SEPOLIA_EXPLORER}/address/${status.address}`}
            target="_blank"
            rel="noreferrer"
            className={styles.addressChip}
            title={status.address}
            data-testid="treasury-room-address"
          >
            <span className={styles.addressDot} aria-hidden />
            {t("Agent wallet")} <span className={styles.mono}>{shortAddress(status.address)}</span>
            <ExternalLink size={12} aria-hidden />
          </a>
          <a href={`${BASE_EXPLORER}/address/${status.address}`} target="_blank" rel="noreferrer" className={styles.accountBase}>
            {t("Recurring buys run on Base from the same address")}
            <ExternalLink size={12} aria-hidden />
          </a>
        </div>
      )}
    </section>
  );
}

export function ActionRow({ roomId }: { roomId: string }) {
  const t = useT();
  const [hint, setHint] = useState<Hint | null>(null);
  const hints: Record<Hint, string> = {
    deposit: t("Deposits land on the agent wallet above — ask your treasurer for the address and today's balance."),
    send: t("Ask your treasurer, e.g. “pay the hotel deposit, $180”. Our rules decide whether it pays or asks for approvals."),
    swap: t("Ask your treasurer, e.g. “buy $20 of ETH every week for 26 weeks”. It queues a recurring buy for approval."),
  };
  const toggle = (h: Hint) => setHint(hint === h ? null : h);

  return (
    <div>
      <div className={styles.actions}>
        <button type="button" className={styles.action} aria-pressed={hint === "deposit"} onClick={() => toggle("deposit")}>
          <span className={styles.actionIcon}>
            <ArrowDownToLine size={20} aria-hidden />
          </span>
          {t("Deposit")}
        </button>
        <button type="button" className={styles.action} aria-pressed={hint === "send"} onClick={() => toggle("send")}>
          <span className={styles.actionIcon}>
            <Send size={20} aria-hidden />
          </span>
          {t("Send")}
        </button>
        <button type="button" className={styles.action} aria-pressed={hint === "swap"} onClick={() => toggle("swap")}>
          <span className={styles.actionIcon}>
            <ArrowLeftRight size={20} aria-hidden />
          </span>
          {t("Swap")}
        </button>
        <Link href={treasuryPath(roomId, "rules")} className={styles.action}>
          <span className={styles.actionIcon}>
            <ScrollText size={20} aria-hidden />
          </span>
          {t("Rules")}
        </Link>
      </div>
      {hint && (
        <p className={styles.actionHint} role="note">
          {hints[hint]}
        </p>
      )}
    </div>
  );
}
