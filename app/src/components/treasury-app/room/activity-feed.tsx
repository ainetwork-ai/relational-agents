"use client";

/**
 * The treasury's rows, grouped by day. The Wallet tab lists the wallet's
 * transactions (rows that moved on a chain); the Activity tab lists every row.
 * A transaction opens in place — from, to, and its hash to copy — so nobody has
 * to leave for a block explorer; the explorer is one small link inside.
 */

import { useId, useState } from "react";
import Link from "next/link";
import { ArrowLeftRight, ArrowUpRight, Check, ChevronDown, CircleMinus, Clock, Copy, Repeat, ScrollText, Wallet } from "lucide-react";
import { useIntlLocale, useT } from "@/i18n/provider";
import type { TreasuryStatus } from "@/lib/agent/treasury/types";
import { buildActivity, groupByDay, onChainOnly, type ActivityItem } from "./activity-model";
import { ChainBadge, UniswapBadge } from "@/components/chain/chain-badge";
import { shortAddress, timeOnly, treasuryPath } from "./room-model";
import type { TreasuryWallet } from "./room-types";
import { useCopy } from "./use-copy";
import styles from "./treasury-room.module.css";

const ICONS: Record<ActivityItem["icon"], typeof Repeat> = {
  rules: ScrollText,
  recurring: Repeat,
  buy: Repeat,
  skip: CircleMinus,
  pay: ArrowUpRight,
  invest: ArrowLeftRight,
  withdraw: Wallet,
  wait: Clock,
};

const EXPLORER_NAME = { sepolia: "Etherscan", base: "Basescan" } as const;

/** The icon's colour: its state first, then the chain it moved on. */
function markClass(item: ActivityItem): string {
  if (item.tone === "wait") return styles.markWait;
  if (item.tone === "bad") return styles.markBad;
  if (item.chain === "base") return styles.markBase;
  if (item.chain === "sepolia") return styles.markCoral;
  if (item.icon === "skip") return styles.markMute;
  return item.tone === "ok" ? styles.markOk : styles.markInfo;
}

function HashCopy({ hash }: { hash: string }) {
  const t = useT();
  const [state, copy] = useCopy(hash);
  return (
    <button type="button" className={styles.iconButton} onClick={copy} aria-label={t("Copy transaction hash")}>
      {state === "copied" ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
      <span className={styles.srOnly} role="status">
        {state === "copied" ? t("Copied") : state === "failed" ? t("Copy failed") : ""}
      </span>
    </button>
  );
}

/** What an explorer would show for one transaction, in place. */
function TxFacts({ item, agentAddress }: { item: ActivityItem; agentAddress: string | null }) {
  const t = useT();
  const tx = item.tx;
  if (!tx || !item.chain) return null;
  return (
    <dl className={styles.txFacts}>
      {agentAddress && (
        <div>
          <dt>{t("From")}</dt>
          <dd>
            {t("Agent wallet")} <span className={styles.mono}>{shortAddress(agentAddress)}</span>
          </dd>
        </div>
      )}
      {item.uniswap ? (
        <div>
          <dt>{t("Route")}</dt>
          <dd>Uniswap v3 · USDC/WETH 0.05%</dd>
        </div>
      ) : (
        item.to && (
          <div>
            <dt>{t("To")}</dt>
            <dd>
              {item.to.label}
              {item.to.address && <span className={styles.mono}> {shortAddress(item.to.address)}</span>}
            </dd>
          </div>
        )
      )}
      <div>
        <dt>{t("Transaction")}</dt>
        <dd className={styles.txHashLine}>
          <span className={styles.mono} title={tx.hash}>
            {shortAddress(tx.hash)}
          </span>
          <HashCopy hash={tx.hash} />
          {tx.url && (
            <a href={tx.url} target="_blank" rel="noreferrer" className={styles.explorerLink}>
              {t("View on {explorer}", { explorer: EXPLORER_NAME[item.chain] })}
              <ArrowUpRight size={12} aria-hidden />
            </a>
          )}
        </dd>
      </div>
    </dl>
  );
}

function RowBody({ item, intlLocale, open }: { item: ActivityItem; intlLocale: string; open?: boolean }) {
  const Icon = ICONS[item.icon];
  const amountTone = item.tone === "wait" ? styles.amountWait : item.tone === "bad" ? styles.amountMuted : "";
  const text = item.detail || item.tokens;
  return (
    <>
      <span className={`${styles.txIcon} ${markClass(item)}`} aria-hidden>
        <Icon size={18} />
      </span>
      <span className={styles.txMain}>
        <span className={styles.txTitle}>{item.title}</span>
        {(item.chain || text) && (
          <span className={styles.txMeta}>
            {item.chain && <ChainBadge chain={item.chain} />}
            {item.uniswap && <UniswapBadge />}
            {text && (
              <span className={styles.txText}>
                {item.detail}
                {item.detail && item.tokens && " · "}
                {/* an amount never breaks across lines */}
                {item.tokens && <span className={styles.nowrap}>{item.tokens}</span>}
              </span>
            )}
          </span>
        )}
      </span>
      <span className={styles.txSide}>
        {item.amount && <span className={`${styles.txAmount} ${styles.num} ${amountTone}`}>{item.amount}</span>}
        <span className={`${styles.txTime} ${styles.num}`}>
          {timeOnly(item.at, intlLocale)}
          {open !== undefined && <ChevronDown size={14} aria-hidden className={`${styles.txChevron} ${open ? styles.txChevronOpen : ""}`} />}
        </span>
      </span>
    </>
  );
}

function Row({ item, intlLocale, agentAddress, open, onToggle }: { item: ActivityItem; intlLocale: string; agentAddress: string | null; open: boolean; onToggle: () => void }) {
  const detailId = useId();
  if (!item.tx) {
    return (
      <li className={`${styles.txRow} ${item.icon === "skip" && !item.chain ? styles.txQuiet : ""}`}>
        <RowBody item={item} intlLocale={intlLocale} />
      </li>
    );
  }
  return (
    <li className={styles.txItem}>
      <button type="button" className={`${styles.txRow} ${styles.txButton}`} aria-expanded={open} aria-controls={detailId} onClick={onToggle}>
        <RowBody item={item} intlLocale={intlLocale} open={open} />
      </button>
      {/* always rendered so it can open and close with motion; inert while closed */}
      <div id={detailId} className={`${styles.txDetail} ${open ? styles.txDetailOpen : ""}`} inert={!open}>
        <div className={styles.txDetailInner}>
          <TxFacts item={item} agentAddress={agentAddress} />
        </div>
      </div>
    </li>
  );
}

export function ActivityFeed({
  status,
  wallet,
  roomId,
  now,
  variant,
  limit,
}: {
  status: TreasuryStatus;
  wallet: TreasuryWallet;
  roomId: string;
  now: number;
  /** "transactions": the wallet's on-chain moves; "all": every treasury row */
  variant: "transactions" | "all";
  limit?: number;
}) {
  const t = useT();
  const intlLocale = useIntlLocale();
  const [openId, setOpenId] = useState<string | null>(null);
  const every = buildActivity(t, status, wallet);
  const all = variant === "transactions" ? onChainOnly(every) : every;
  const shown = limit ? all.slice(0, limit) : all;
  const days = groupByDay(t, shown, intlLocale, new Date(now));

  return (
    <section className={styles.card} data-testid={variant === "transactions" ? "treasury-room-transactions" : "treasury-room-activity"}>
      <div className={styles.cardHead}>
        <h2 className={styles.cardTitle}>{variant === "transactions" ? t("Transactions") : t("Activity")}</h2>
        {limit && all.length > limit && (
          <Link href={treasuryPath(roomId, "activity")} className={styles.pillLink}>
            {t("See all")}
          </Link>
        )}
      </div>
      {days.length === 0 ? (
        <p className={styles.emptyLine}>{variant === "transactions" ? t("No transactions yet") : t("No treasury activity yet.")}</p>
      ) : (
        days.map((day) => (
          <div key={day.key} className={styles.feedDay}>
            <h3 className={styles.feedDayLabel}>{day.label}</h3>
            <ul className={styles.list}>
              {day.items.map((item) => (
                <Row
                  key={item.id}
                  item={item}
                  intlLocale={intlLocale}
                  agentAddress={status.address}
                  open={openId === item.id}
                  onToggle={() => setOpenId(openId === item.id ? null : item.id)}
                />
              ))}
            </ul>
          </div>
        ))
      )}
    </section>
  );
}
