"use client";

/**
 * The coral card that opens the Treasury: the agent's wallet — whose it is,
 * its one address (copyable, the same on Ethereum Sepolia and Base) and the
 * shared pot it holds, at demo scale. What else it holds is in Holdings below.
 */

import { useId, useState } from "react";
import { Check, Copy, Info } from "lucide-react";
import { chainLabel } from "@/components/chain/chain-badge";
import { useT } from "@/i18n/provider";
import type { TreasuryStatus } from "@/lib/agent/treasury/types";
import { BaseGlyph, EthGlyph } from "./chain-marks";
import { shortAddress, usd } from "./room-model";
import type { TreasuryRoomPerson, TreasuryWallet } from "./room-types";
import { useCopy } from "./use-copy";
import { dollarAtDemoScale } from "./wallet-model";
import styles from "./treasury-room.module.css";

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

function AddressPill({ address }: { address: string }) {
  const t = useT();
  const [state, copy] = useCopy(address);

  return (
    <div className={styles.addr}>
      <span className={`${styles.mono} ${styles.addrFull}`}>{address}</span>
      <span className={`${styles.mono} ${styles.addrShort}`} aria-hidden>
        {shortAddress(address)}
      </span>
      <span className={styles.addrChains} title={t("Same address on Ethereum Sepolia and Base")}>
        <span className={styles.addrChain}>
          <EthGlyph size={11} />
        </span>
        <span className={styles.addrChain}>
          <BaseGlyph size={10} />
        </span>
      </span>
      <button
        type="button"
        className={`${styles.copy} ${state === "copied" ? styles.copyDone : ""}`}
        onClick={copy}
        aria-label={t("Copy address")}
        data-testid="treasury-room-copy"
      >
        {state === "copied" ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
        <span>{state === "copied" ? t("Copied") : state === "failed" ? t("Copy failed") : t("Copy")}</span>
      </button>
      <span className={styles.srOnly} role="status">
        {state === "copied" ? t("Address copied") : ""}
      </span>
    </div>
  );
}

/** "Demo scale" opens a one-line note of what a dollar is on each chain; it floats, so nothing below moves. */
function DemoScale({ line }: { line: string }) {
  const t = useT();
  const id = useId();
  const [open, setOpen] = useState(false);
  return (
    <span className={styles.demoWrap}>
      <button
        type="button"
        className={styles.demo}
        aria-expanded={open}
        aria-describedby={open ? id : undefined}
        onClick={() => setOpen(!open)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
        }}
      >
        <Info size={13} aria-hidden />
        {t("Demo scale")}
      </button>
      {open && (
        <span id={id} role="tooltip" className={`${styles.demoTip} ${styles.num}`}>
          $1 = {line}
        </span>
      )}
    </span>
  );
}

export function WalletCard({
  status,
  wallet,
  people,
}: {
  status: TreasuryStatus;
  wallet: TreasuryWallet;
  people: TreasuryRoomPerson[];
}) {
  const t = useT();
  const agent = people.find((p) => p.isAgent);
  const scale = dollarAtDemoScale(status, wallet);

  return (
    <section className={styles.wallet} data-testid="treasury-room-wallet" aria-label={t("Agent wallet")}>
      <div className={styles.walletTop}>
        <div className={styles.walletWho}>
          <span className={styles.walletLabel}>{t("Agent wallet")}</span>
          <span className={styles.walletName}>{agent?.displayName ?? t("Your treasurer")}</span>
        </div>
        <Avatars people={people.filter((p) => !p.isAgent)} />
      </div>

      {status.address ? (
        <AddressPill address={status.address} />
      ) : (
        <div className={styles.addr}>
          <span className={styles.addrMissing}>{t("The wallet can't be read right now.")}</span>
        </div>
      )}

      <p className={`${styles.pot} ${styles.num}`} data-testid="treasury-room-balance">
        {status.balanceUsd === null ? "—" : usd(status.balanceUsd)}
      </p>
      <div className={styles.potSub}>
        <span>
          {t("Shared pot")} · {chainLabel("sepolia")}
        </span>
        {scale && <DemoScale line={scale} />}
      </div>
    </section>
  );
}
