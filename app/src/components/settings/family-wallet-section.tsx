"use client";

// Settings › Family names: the wallet check. The account's proven wallet (GET …/ens `me.address`,
// users.wallet_verified_at) is compared with the account MetaMask is on right now, on load and on
// every accountsChanged / chainChanged, and only when they match on Sepolia does the panel get a
// wallet to act as. Every write still re-checks in familyContext (lib/wallet/ens-issue.ts).
// The words are for people, not developers: no addresses, just "log in with your wallet",
// "this wallet doesn't have permission", "switch to Sepolia".
import { useEffect, useState } from "react";
import { formatEther, type Address } from "viem";
import { AlertTriangle, ExternalLink } from "lucide-react";
import { useT } from "@/i18n/provider";
import { SEPOLIA_CHAIN_ID } from "@/lib/ens-family/config";
import { linkMetaMask } from "@/lib/wallet/metamask-login";
import { ensureChain } from "@/lib/wallet/sign";
import { sepoliaBalance } from "@/lib/wallet/ens-issue";
import type { InjectedAccount } from "@/lib/wallet/use-injected-account";
import { SettingsRow, SettingsSection } from "./settings-layout";
import { BTN, MUTED, PRIMARY, linkFailureText } from "./family-ui";

const INSTALL_URL = "https://metamask.io/download/";

export type WalletGate =
  | { kind: "loading" }
  | { kind: "no-provider" }
  /** no proven wallet, or MetaMask has not connected this site: log in with the wallet (connect + sign) */
  | { kind: "login"; live: Address | null; proven: boolean }
  /** MetaMask is on a wallet that is not this account's proven one */
  | { kind: "mismatch" }
  | { kind: "wrong-chain"; wallet: Address }
  | { kind: "ok"; wallet: Address };

/** Where the wallet check stands, in the order the panel asks for things. */
export function walletGate(me: { address: string | null }, live: InjectedAccount): WalletGate {
  if (live.status === "loading") return { kind: "loading" };
  if (live.status === "no-provider") return { kind: "no-provider" };
  const wallet = me.address?.toLowerCase() as Address | undefined;
  if (!wallet || !live.account) return { kind: "login", live: live.account, proven: !!wallet };
  if (live.account !== wallet) return { kind: "mismatch" };
  if (live.chainId !== SEPOLIA_CHAIN_ID) return { kind: "wrong-chain", wallet };
  return { kind: "ok", wallet };
}

const WARN =
  "flex flex-col gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300";

/** Connect MetaMask and sign the server's challenge; on success the account's wallet is proven. */
function LoginButton({ onLinked, refresh, onError }: { onLinked: () => Promise<void>; refresh: () => void; onError: (msg: string | null) => void }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  return (
    <button
      data-testid="family-wallet-login"
      className={PRIMARY}
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        onError(null);
        // Always open MetaMask's account picker: the account this site was authorized for earlier is
        // not necessarily the one the person chooses now, and signing must use the one they choose.
        const r = await linkMetaMask();
        setBusy(false);
        refresh();
        if (r.ok) await onLinked();
        else onError(linkFailureText(r.reason, t, r.error));
      }}
    >
      {busy ? t("Waiting for MetaMask…") : t("Log in with your wallet")}
    </button>
  );
}

function ErrorLine({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <span className="mt-1 text-xs text-red-500" data-testid="family-wallet-error">
      {error}
    </span>
  );
}

export function WalletSection({
  gate,
  canEdit,
  onLinked,
  refresh,
}: {
  gate: WalletGate;
  canEdit: boolean;
  onLinked: () => Promise<void>;
  refresh: () => void;
}) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Members who are not admins never act as a wallet here; they only log in once, so that an
  // admin can add them to the family.
  if (!canEdit) {
    if (gate.kind !== "login" || gate.proven) return null;
    return (
      <SettingsSection title={t("Wallet")}>
        <SettingsRow label={t("Log in with your wallet")} description={t("Then a workspace admin can add you to the family.")}>
          <LoginButton onLinked={onLinked} refresh={refresh} onError={setError} />
          <ErrorLine error={error} />
        </SettingsRow>
      </SettingsSection>
    );
  }

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
          <SettingsRow label={t("Install MetaMask to manage family names.")}>
            <a href={INSTALL_URL} target="_blank" rel="noreferrer" className={BTN} data-testid="family-install-metamask">
              {t("Install MetaMask")} <ExternalLink size={12} />
            </a>
          </SettingsRow>
        </SettingsSection>
      );

    case "login":
      return (
        <SettingsSection title={t("Wallet")}>
          <SettingsRow label={t("Log in with your wallet")} description={t("Family names are created and managed with your wallet.")}>
            <div data-testid="family-wallet-unproven" className="flex flex-wrap justify-end gap-2">
              <LoginButton onLinked={onLinked} refresh={refresh} onError={setError} />
            </div>
            <ErrorLine error={error} />
          </SettingsRow>
        </SettingsSection>
      );

    case "mismatch":
      return (
        <SettingsSection title={t("Wallet")}>
          <div className={WARN} data-testid="family-wallet-mismatch">
            <span className="flex items-center gap-1.5 font-medium">
              <AlertTriangle size={14} /> {t("This wallet doesn't have permission to manage this family.")}
            </span>
            <span className="text-xs">{t("Choose your wallet in MetaMask.")}</span>
          </div>
        </SettingsSection>
      );

    case "wrong-chain":
      return (
        <SettingsSection title={t("Wallet")}>
          <SettingsRow label={t("MetaMask is on another network.")}>
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
            <ErrorLine error={error} />
          </SettingsRow>
        </SettingsSection>
      );

    case "ok":
      return <ConnectedRow wallet={gate.wallet} />;
  }
}

/** MetaMask is on this account's proven wallet, on Sepolia: its balance. */
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
      <SettingsRow label={t("Logged in with your wallet")} description={t("Family names are created and managed with this wallet.")}>
        <span className={MUTED} data-testid="family-wallet-ok">
          {shown !== null ? t("Balance: {eth} Sepolia ETH", { eth: shown }) : t("Checking…")}
        </span>
      </SettingsRow>
    </SettingsSection>
  );
}
