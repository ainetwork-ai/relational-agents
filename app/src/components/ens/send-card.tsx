"use client";

import { useState, useSyncExternalStore } from "react";
import type { Address, Hex } from "viem";
import { useT } from "@/i18n/provider";
import { formatUsdc } from "@/lib/ens-family/send-request";
import { SEPOLIA_EXPLORER } from "@/lib/ens-family/config";
import { sendUsdcTransfer } from "@/lib/wallet/send";
import { WalletSignatureError } from "@/lib/wallet/provider";

interface Props {
  token: string;
  name: string;
  display: string;
  avatar: string | null;
  from: Address;
  to: Address;
  amountMicro: string;
  usdcMicro: string;
  ethWei: string;
  sentTx: string | null;
  /** the server found the Transfer and announced it */
  confirmed: boolean;
  /** past the 10 minutes: no new payment, only a check of one already made */
  expired: boolean;
}

// another tab that paid with this link hides Send here too
const onStorage = (cb: () => void) => {
  window.addEventListener("storage", cb);
  return () => window.removeEventListener("storage", cb);
};

// the hash also lives in this browser, so a reload shows it even if the server never saw it
const txKey = (token: string) => `ens-send:${token}`;
function storedTx(token: string): string | null {
  try {
    return localStorage.getItem(txKey(token));
  } catch {
    return null;
  }
}
function storeTx(token: string, hash: string) {
  try {
    localStorage.setItem(txKey(token), hash);
  } catch {
    // private mode or blocked storage: the server copy is recorded on confirm
  }
}
// only the hash the server freed: another tab may have stored a real one since
function dropTx(token: string, hash: string) {
  try {
    if (localStorage.getItem(txKey(token)) === hash) localStorage.removeItem(txKey(token));
  } catch {
    // nothing stored to drop
  }
}

export function SendCard(p: Props) {
  const t = useT();
  const amount = BigInt(p.amountMicro);
  const [state, setState] = useState<"idle" | "sending" | "confirming" | "done" | "error">(p.confirmed ? "done" : "idle");
  const [tx, setTx] = useState<string | null>(p.sentTx);
  const [error, setError] = useState<string | null>(null);
  // "not yet" is not an error: the card says so in its normal colour
  const [waiting, setWaiting] = useState(false);
  const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
  const lowUsdc = BigInt(p.usdcMicro) < amount;
  const noGas = BigInt(p.ethWei) === BigInt(0);

  // null until hydrated (Send stays off until this browser's copy was looked at), "" = none
  const saved = useSyncExternalStore(onStorage, () => storedTx(p.token) ?? "", () => null);
  const restored = saved !== null;
  const knownTx = tx ?? (saved || null);

  // the confirm call only records what already happened on chain; a failure here is
  // retried as a confirm, never as a second transfer
  async function confirm(hash: string) {
    setError(null);
    setWaiting(false);
    setState("confirming");
    // 200 found and announced · 202 no receipt yet · 422 mismatch: no USDC left the wallet ·
    // 422 different: USDC left it, but not as prepared
    const outcome = await fetch("/api/ens/send/confirm", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ t: p.token, txHash: hash }) })
      .then(async (r) => (r.status === 200 ? "match" : (((await r.json().catch(() => ({}))) as { reason?: string }).reason ?? "error")))
      .catch(() => "error");
    if (outcome === "match") return setState("done");
    if (outcome === "mismatch") {
      // the server released the link: this hash paid nothing, so Send comes back
      dropTx(p.token, hash);
      setTx(null);
      setState("idle");
      return setError(t("That transaction didn't move any USDC, so nothing was paid. You can send again."));
    }
    setState("error");
    if (outcome === "pending") return setWaiting(true);
    setError(
      outcome === "different"
        ? t("That transaction moved USDC, but not as prepared here. Check the explorer link.")
        : t("It was sent, but I couldn't confirm it yet. Check the explorer link.")
    );
  }

  async function send() {
    setError(null);
    setState("sending");
    let hash: Hex;
    try {
      hash = await sendUsdcTransfer({ from: p.from, to: p.to, amountMicro: amount });
    } catch (e) {
      const reason = e instanceof WalletSignatureError ? e.reason : "failed";
      setState("error");
      setError(
        e instanceof WalletSignatureError && e.message === "wrong-account"
          ? t("Your wallet has a different account open. Switch to {addr} and try again.", { addr: short(p.from) })
          : reason === "rejected"
            ? t("You cancelled it in the wallet. Nothing was sent.")
            : reason === "no-provider"
              ? t("Open this page in the browser with your wallet.")
              : t("The wallet couldn't send it: {msg}", { msg: (e as Error).message })
      );
      return;
    }
    storeTx(p.token, hash);
    setTx(hash);
    await confirm(hash);
  }

  return (
    <main className="flex min-h-[70vh] items-center justify-center p-6">
      <div data-testid="send-card" className="w-full max-w-sm rounded-2xl border border-neutral-200 bg-white p-6 text-center shadow-sm dark:border-neutral-700 dark:bg-neutral-900">
        <p className="text-sm text-neutral-500">{t("Send to {who}", { who: p.display })}</p>
        <p className="mt-3 text-5xl font-bold tracking-tight text-neutral-900 dark:text-neutral-100" data-testid="send-amount">
          {formatUsdc(amount)} <span className="text-2xl font-semibold">USDC</span>
        </p>
        <div className="mt-6 flex items-center justify-center gap-3">
          {p.avatar ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={p.avatar} alt="" className="h-12 w-12 rounded-full object-cover" />
          ) : (
            <div className="h-12 w-12 rounded-full bg-neutral-200 dark:bg-neutral-700" />
          )}
          <div className="text-left">
            <p className="font-medium text-neutral-800 dark:text-neutral-100">{p.display}</p>
            <p className="text-xs text-neutral-500" data-testid="send-name">{p.name}</p>
            <p className="text-xs text-neutral-400" data-testid="send-to">{short(p.to)}</p>
          </div>
        </div>
        {state === "done" ? (
          <p className="mt-8 text-sm text-green-700 dark:text-green-400" data-testid="send-done">
            {t("Sent.")}{" "}
            {knownTx && (
              <a className="underline" href={`${SEPOLIA_EXPLORER}/tx/${knownTx}`} target="_blank" rel="noreferrer">
                {t("View on the explorer")}
              </a>
            )}
          </p>
        ) : knownTx ? (
          // the wallet already sent it: from here on only the confirmation can be retried
          <div className="mt-8 text-sm text-neutral-600 dark:text-neutral-300" data-testid="send-pending">
            <p>
              {t("Sent from your wallet.")}{" "}
              <a className="underline" href={`${SEPOLIA_EXPLORER}/tx/${knownTx}`} target="_blank" rel="noreferrer">
                {t("View on the explorer")}
              </a>
            </p>
            {waiting && state !== "confirming" && <p className="mt-3" data-testid="send-waiting">{t("Waiting for the network to confirm it…")}</p>}
            <button
              data-testid="send-confirm-retry"
              onClick={() => void confirm(knownTx)}
              disabled={state === "confirming"}
              className="mt-4 w-full rounded-xl border border-neutral-300 py-3 font-medium disabled:opacity-50 dark:border-neutral-600"
            >
              {state === "confirming" ? t("Checking…") : t("Check again")}
            </button>
          </div>
        ) : p.expired ? (
          <p className="mt-8 text-sm text-neutral-600 dark:text-neutral-300" data-testid="send-expired">
            {t("This link has expired. Ask the agent again.")}
          </p>
        ) : (
          <>
            {lowUsdc && <p className="mt-6 text-sm text-amber-700">{t("Your wallet has {have} USDC, less than this.", { have: formatUsdc(BigInt(p.usdcMicro)) })}</p>}
            {noGas && <p className="mt-6 text-sm text-amber-700">{t("Your wallet needs a little Sepolia ETH for the fee.")}</p>}
            <button
              data-testid="send-button"
              onClick={() => void send()}
              disabled={!restored || state === "sending" || lowUsdc || noGas}
              className="mt-8 w-full rounded-xl bg-neutral-900 py-4 text-lg font-semibold text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
            >
              {state === "sending" ? t("Waiting for your wallet…") : t("Send")}
            </button>
          </>
        )}
        {error && <p className="mt-3 text-sm text-red-600" data-testid="send-error-inline">{error}</p>}
      </div>
    </main>
  );
}
