"use client";

/** Holdings: what the agent's address holds on each chain, one card per chain — Ethereum Sepolia (the pot) and Base (swaps). */

import { CircleSlash } from "lucide-react";
import { useT } from "@/i18n/provider";
import type { TreasuryStatus } from "@/lib/agent/treasury/types";
import { ChainBadge, UniswapBadge } from "@/components/chain/chain-badge";
import { TokenIcon } from "./chain-marks";
import { tokenAmount, usd } from "./room-model";
import type { TreasuryWallet } from "./room-types";
import { walletHoldings, type ChainHoldings } from "./wallet-model";
import styles from "./treasury-room.module.css";

function ChainCard({ holdings }: { holdings: ChainHoldings }) {
  const t = useT();
  const { chain, state, rows } = holdings;
  return (
    <section className={`${styles.card} ${styles.chainCard}`} data-testid={`treasury-room-chain-${chain}`}>
      <div className={styles.chainHead}>
        <ChainBadge chain={chain} />
        {chain === "sepolia" && <span className={styles.testnet}>{t("testnet")}</span>}
      </div>
      <p className={styles.chainRole}>{chain === "sepolia" ? t("Shared pot · payments") : t("Swaps · Uniswap v3")}</p>
      {state === "ready" ? (
        <ul className={styles.list}>
          {rows.map((row) => (
            <li key={row.token} className={styles.holding}>
              <TokenIcon token={row.token} />
              <span className={styles.holdingText}>
                <span className={styles.holdingToken}>
                  {row.token}
                  {row.uniswap && <UniswapBadge />}
                </span>
                <span className={`${styles.holdingAmount} ${styles.num}`} title={row.amount}>
                  {tokenAmount(row.amount)}
                </span>
              </span>
              <span className={`${styles.holdingUsd} ${styles.num}`}>{row.usd === null ? "—" : usd(row.usd)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles.chainOff}>
          <CircleSlash size={20} aria-hidden />
          {state === "off" ? t("Not connected on this server") : t("Can't be read right now")}
        </p>
      )}
    </section>
  );
}

export function Holdings({ status, wallet }: { status: TreasuryStatus; wallet: TreasuryWallet }) {
  const t = useT();
  return (
    <section className={styles.holdings} data-testid="treasury-room-holdings">
      <h2 className={styles.sectionTitle}>{t("Holdings")}</h2>
      <div className={styles.chains}>
        {walletHoldings(status, wallet).map((h) => (
          <ChainCard key={h.chain} holdings={h} />
        ))}
      </div>
    </section>
  );
}
