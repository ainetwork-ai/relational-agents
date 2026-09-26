"use client";

// Settings › Family names: the wallet check. The account's proven wallet (GET …/ens `me.address`,
// users.wallet_verified_at) is compared with the account MetaMask is on right now, on load and on
// every accountsChanged / chainChanged, and only when they match on Sepolia does the panel get a
// wallet to act as. Every write still re-checks in familyContext (lib/wallet/ens-issue.ts).
import { useEffect, useState, type ReactNode } from "react";
import { formatEther, getAddress, type Address } from "viem";
import { AlertTriangle, ExternalLink } from "lucide-react";
import { useT } from "@/i18n/provider";
import { SEPOLIA_CHAIN_ID } from "@/lib/ens-family/config";
import { linkMetaMask, type LinkResult } from "@/lib/wallet/metamask-login";
import { connectWallet, ensureChain } from "@/lib/wallet/sign";
import { sepoliaBalance } from "@/lib/wallet/ens-issue";
import type { InjectedAccount } from "@/lib/wallet/use-injected-account";
import { SettingsRow, SettingsSection } from "./settings-layout";
import { BTN, MUTED, PRIMARY, linkFailureText, short as shortRaw } from "./family-ui";

/** 0x591d…0cB3: short, in the checksum spelling MetaMask shows. */
export const shortAddress = (a: string) => {
  try {
    return shortRaw(getAddress(a));
  } catch {
    return shortRaw(a);
  }
};
const short = shortAddress;

const INSTALL_URL = "https://metamask.io/download/";

export type WalletGate =
  | { kind: "loading" }
  | { kind: "no-provider" }
  /** no proven wallet: `linked` is the unproven address the account lists (if any), `live` MetaMask's */
  | { kind: "unproven"; linked: string | null; live: string | null }
  | { kind: "not-connected"; wallet: Address }
  | { kind: "mismatch"; wallet: Address; live: Address }
  | { kind: "wrong-chain"; wallet: Address }
  | { kind: "ok"; wallet: Address };

/** Where the wallet check stands, in the order the panel asks for things. */
export function walletGate(me: { address: string | null; linked?: string | null }, live: InjectedAccount): WalletGate {
  if (live.status === "loading") return { kind: "loading" };
  if (live.status === "no-provider") return { kind: "no-provider" };
  const wallet = me.address?.toLowerCase() as Address | undefined;
  if (!wallet) return { kind: "unproven", linked: me.linked?.toLowerCase() ?? null, live: live.account };
  if (!live.account) return { kind: "not-connected", wallet };
  if (live.account !== wallet) return { kind: "mismatch", wallet, live: live.account };
  if (live.chainId !== SEPOLIA_CHAIN_ID) return { kind: "wrong-chain", wallet };
  return { kind: "ok", wallet };
}

const WARN =
  "flex flex-col gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300";

export function WalletSection({ gate, onLinked, refresh }: { gate: WalletGate; onLinked: () => Promise<void>; refresh: () => void }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Sign the challenge (picker, or MetaMask's current account) and prove it for this account. */
  async function prove(opts: { pick: boolean; replace?: boolean }): Promise<LinkResult> {
    setBusy(true);
    setError(null);
    const r = await linkMetaMask(opts);
    setBusy(false);
    if (r.ok) await onLinked();
    else if (r.reason !== "owns-family") setError(linkFailureText(r.reason, t, r.error));
    return r;
  }

  const errorLine = error && (
    <span className="mt-1 text-xs text-red-500" data-testid="family-wallet-error">
      {error}
    </span>
  );

  switch (gate.kind) {
    case "loading":
      return (
        <SettingsSection title={t("Wallet")}>
          <span className={MUTED}>{t("Checking MetaMask…")}</span>
        </SettingsSection>
      );

    case "no-provider":
      return (
        <SettingsSection title={t("Wallet")}>
          <SettingsRow
            label={t("MetaMask is not installed")}
            description={t("Family names live on Ethereum (Sepolia ENS). Install MetaMask in this browser, then reload this page.")}
          >
            <a href={INSTALL_URL} target="_blank" rel="noreferrer" className={BTN} data-testid="family-install-metamask">
              {t("Install MetaMask")} <ExternalLink size={12} />
            </a>
          </SettingsRow>
        </SettingsSection>
      );

    case "unproven": {
      const { linked, live } = gate;
      return (
        <SettingsSection title={t("Wallet")}>
          <SettingsRow
            label={t("Connect MetaMask to prove this wallet is yours")}
            description={
              linked
                ? t("This account lists {addr}, but no signature ever proved it is yours. Sign once in MetaMask with the wallet you use.", { addr: short(linked) })
                : t("Family names are created and managed with your wallet. Sign once in MetaMask to prove it is yours.")
            }
          >
            <div data-testid="family-wallet-unproven" data-linked={linked ?? ""} data-live={live ?? ""} className="flex flex-wrap justify-end gap-2">
              {live ? (
                <button data-testid="family-wallet-use" className={PRIMARY} disabled={busy} onClick={() => void prove({ pick: false })}>
                  {busy
                    ? t("Waiting for MetaMask…")
                    : linked === live
                      ? t("Prove {addr}", { addr: short(live) })
                      : linked
                        ? t("Use {addr} instead", { addr: short(live) })
                        : t("Use {addr}", { addr: short(live) })}
                </button>
              ) : (
                <button data-testid="family-connect" className={BTN} disabled={busy} onClick={() => void prove({ pick: true })}>
                  {busy ? t("Waiting for MetaMask…") : t("Connect MetaMask")}
                </button>
              )}
            </div>
            {errorLine}
          </SettingsRow>
        </SettingsSection>
      );
    }

    case "not-connected":
      return (
        <SettingsSection title={t("Wallet")}>
          <SettingsRow label={t("MetaMask is not connected")} description={t("This account uses {addr}. Connect MetaMask on that account.", { addr: short(gate.wallet) })}>
            <button
              data-testid="family-connect"
              className={BTN}
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError(null);
                try {
                  await connectWallet();
                } catch {
                  setError(t("You cancelled the request in MetaMask."));
                }
                setBusy(false);
                refresh();
              }}
            >
              {busy ? t("Waiting for MetaMask…") : t("Connect MetaMask")}
            </button>
            {errorLine}
          </SettingsRow>
        </SettingsSection>
      );

    case "mismatch":
      return <MismatchSection key={gate.live} wallet={gate.wallet} live={gate.live} prove={prove} busy={busy} errorLine={errorLine} />;

    case "wrong-chain":
      return (
        <SettingsSection title={t("Wallet")}>
          <SettingsRow label={t("MetaMask is on another network")} description={t("Family names are on Sepolia. Switch MetaMask to Sepolia to continue.")}>
            <button
              data-testid="family-switch-chain"
              className={PRIMARY}
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError(null);
                try {
                  await ensureChain(SEPOLIA_CHAIN_ID);
                } catch {
                  setError(t("MetaMask did not switch to Sepolia. Switch it there, then come back."));
                }
                setBusy(false);
                refresh();
              }}
            >
              {t("Switch to Sepolia")}
            </button>
            {errorLine}
          </SettingsRow>
        </SettingsSection>
      );

    case "ok":
      return <ConnectedRow wallet={gate.wallet} />;
  }
}

/** MetaMask is on a different account than this account's proven wallet. */
function MismatchSection({
  wallet,
  live,
  prove,
  busy,
  errorLine,
}: {
  wallet: Address;
  live: Address;
  prove: (opts: { pick: boolean; replace?: boolean }) => Promise<LinkResult>;
  busy: boolean;
  errorLine: ReactNode;
}) {
  const t = useT();
  const [help, setHelp] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [ownsFamily, setOwnsFamily] = useState<string | null>(null);
  return (
    <SettingsSection title={t("Wallet")}>
      <div className={WARN} data-testid="family-wallet-mismatch" data-wallet={wallet} data-live={live}>
        <span className="flex items-center gap-1.5 font-medium">
          <AlertTriangle size={14} /> {t("MetaMask is on a different wallet")}
        </span>
        <span>{t("This account uses {mine}; MetaMask is on {live}.", { mine: short(wallet), live: short(live) })}</span>
        {!confirming && (
          <div className="flex flex-wrap gap-2">
            <button data-testid="family-wallet-switch-help" className={BTN} onClick={() => setHelp((h) => !h)}>
              {t("Switch account in MetaMask")}
            </button>
            <button data-testid="family-wallet-use" className={BTN} disabled={busy} onClick={() => setConfirming(true)}>
              {t("Use {addr} instead", { addr: short(live) })}
            </button>
          </div>
        )}
        {help && !confirming && (
          <span className="text-xs" data-testid="family-wallet-switch-steps">
            {t("Open MetaMask, pick the account {mine} in its account list, and connect it to this site. This page follows by itself.", { mine: short(wallet) })}
          </span>
        )}
        {confirming && (
          <div className="flex flex-col gap-2" data-testid="family-wallet-replace-confirm">
            <span className="text-xs">
              {t("From now on this account uses {live}. Names on Sepolia stay with the wallet that owns them, and signing in with {mine} will no longer open this account.", {
                live: short(live),
                mine: short(wallet),
              })}
            </span>
            {ownsFamily && (
              <span className="text-xs text-red-600 dark:text-red-400" data-testid="family-wallet-owns-family">
                {t("{mine} owns {name}, this workspace's family name, and keeps control of it: ENS names don't move with the account. Switch MetaMask back to {mine} to manage the family.", {
                  mine: short(wallet),
                  name: ownsFamily,
                })}
              </span>
            )}
            <div className="flex flex-wrap gap-2">
              {!ownsFamily && (
                <button
                  data-testid="family-wallet-replace"
                  className={PRIMARY}
                  disabled={busy}
                  onClick={async () => {
                    const r = await prove({ pick: false, replace: true });
                    if (!r.ok && r.reason === "owns-family") setOwnsFamily(r.name ?? "");
                  }}
                >
                  {busy ? t("Waiting for MetaMask…") : t("Sign with {addr}", { addr: short(live) })}
                </button>
              )}
              <button className={BTN} disabled={busy} onClick={() => setConfirming(false)}>
                {t("Cancel")}
              </button>
            </div>
          </div>
        )}
        {errorLine}
      </div>
    </SettingsSection>
  );
}

/** MetaMask is on this account's proven wallet, on Sepolia: its balance, and which address it is for. */
function ConnectedRow({ wallet }: { wallet: Address }) {
  const t = useT();
  const [balance, setBalance] = useState<{ of: Address; wei: bigint } | null>(null);
  useEffect(() => {
    let alive = true;
    sepoliaBalance(wallet)
      .then((wei) => alive && setBalance({ of: wallet, wei }))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [wallet]);
  const shown = balance?.of === wallet ? Number(formatEther(balance.wei)).toFixed(4) : null;
  return (
    <SettingsSection title={t("Wallet")}>
      <SettingsRow label={t("MetaMask connected")} description={t("Family names are created and managed with this wallet.")}>
        <span className={MUTED} data-testid="family-wallet-ok" data-address={wallet}>
          {shown !== null
            ? t("{addr} on Sepolia · {eth} ETH", { addr: short(wallet), eth: shown })
            : t("{addr} on Sepolia", { addr: short(wallet) })}
        </span>
      </SettingsRow>
    </SettingsSection>
  );
}
