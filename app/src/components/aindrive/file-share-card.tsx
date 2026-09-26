"use client";

import { useRef, useState } from "react";
import { AinuiSurface } from "ain-ui/react";
import { X402_PAY_ACTION, type A2uiAction, type A2uiMessage } from "ain-ui";
import "ain-ui/styles.css";
import { Download, FileAudio, FileIcon, Lock } from "lucide-react";
import { aindriveRawUrl } from "@/lib/aindrive-url";
import { payX402WithWallet } from "@/lib/wallet/x402";
import { WalletSignatureError } from "@/lib/wallet/provider";
import { useT } from "@/i18n/provider";

export interface FileShareInfo {
  kind: "file";
  file: { name: string; size: number | null };
  sale: { price: number; currency: string } | null;
  owner: boolean;
  unlocked: boolean;
  needsAccount: boolean;
  messages?: A2uiMessage[];
  error?: string;
}

const ext = (n: string) => (n.includes(".") ? n.slice(n.lastIndexOf(".") + 1).toLowerCase() : "");
const AUDIO = new Set(["mp3", "m4a", "wav", "ogg", "oga", "opus", "aac", "flac", "weba"]);
const VIDEO = new Set(["mp4", "m4v", "webm", "mov", "ogv"]);
const IMAGE = new Set(["png", "jpg", "jpeg", "gif", "webp", "avif", "bmp"]);

function size(n: number | null) {
  if (n === null) return "";
  return n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * A single file shared into a teamspace. Open → it plays or shows, with a
 * download. On sale in aindrive and not yet the viewer's → locked, with
 * "Buy for N USDC": aindrive quotes (402), MetaMask signs the USDC transfer on
 * Base, aindrive settles as the viewer's own account (lib/aindrive-file-sale).
 */
export function FileShareCard({ linkId, driveId, path, info, onUnlocked }: {
  linkId: string;
  driveId: string;
  path: string;
  info: FileShareInfo;
  onUnlocked: () => void;
}) {
  const t = useT();
  const [step, setStep] = useState<"quote" | "wallet" | "settle" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tx, setTx] = useState<string | null>(null);
  const { file, sale } = info;
  const e = ext(file.name);
  const src = aindriveRawUrl({ driveId, path });

  const paying = useRef(false);

  async function buy(action: A2uiAction) {
    if (action.name !== X402_PAY_ACTION || paying.current) return;
    const paymentRequired = action.context?.paymentRequired;
    if (typeof paymentRequired !== "string") throw new Error("Missing AIN-UI payment quote");
    paying.current = true;
    const url = `/api/aindrive/links/${linkId}/sale`;
    const post = (body: object) => fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    setError(null);
    try {
      setStep("wallet");
      const { header } = await payX402WithWallet(paymentRequired);
      setStep("settle");
      const r = await post({ paymentSignature: header });
      const d = (await r.json().catch(() => ({}))) as { unlocked?: boolean; txHash?: string | null; error?: string };
      if (!r.ok || !d.unlocked) throw new Error(d.error ?? t("Payment failed. Please try again."));
      setTx(d.txHash ?? null);
      onUnlocked();
    } catch (err) {
      const reason = err instanceof WalletSignatureError ? err.reason : null;
      setError(
        reason === "no-provider"
          ? t("MetaMask is needed to pay. Install it and try again.")
          : reason === "rejected"
            ? t("Payment cancelled in MetaMask.")
            : (err as Error).message || t("Payment failed. Please try again.")
      );
    } finally {
      paying.current = false;
      setStep(null);
    }
  }

  return (
    <div data-testid="file-share" data-unlocked={info.unlocked ? "true" : "false"} className="max-w-xl overflow-hidden rounded-xl border border-neutral-200 dark:border-neutral-700">
      <div className="flex items-center gap-2 border-b border-neutral-100 px-4 py-3 dark:border-neutral-800">
        {AUDIO.has(e) ? <FileAudio size={18} className="text-neutral-400" /> : <FileIcon size={18} className="text-neutral-400" />}
        <span className="truncate font-medium text-neutral-800 dark:text-neutral-100">{file.name}</span>
        <span className="ml-auto shrink-0 text-xs text-neutral-400">{size(file.size)}</span>
        {sale && (
          <span className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 dark:bg-amber-900/50 dark:text-amber-200">
            {t("On sale · {price}", { price: `${sale.price} ${sale.currency}` })}
          </span>
        )}
      </div>
      {info.unlocked ? (
        <div className="p-4">
          {AUDIO.has(e) ? (
            <audio data-testid="file-share-audio" src={src} controls className="w-full" />
          ) : VIDEO.has(e) ? (
            <video src={src} controls playsInline className="max-h-[420px] w-full bg-black" />
          ) : IMAGE.has(e) ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={src} alt={file.name} className="max-h-[420px] w-full object-contain" />
          ) : null}
          <div className="mt-3 flex items-center gap-3 text-xs text-neutral-500">
            <a href={aindriveRawUrl({ driveId, path }, true)} className="flex items-center gap-1 hover:underline">
              <Download size={13} /> {t("Download")}
            </a>
            {sale && info.owner && <span>{t("You're selling this in aindrive — family members buy it here with MetaMask.")}</span>}
            {tx && (
              <a href={`https://basescan.org/tx/${tx}`} target="_blank" rel="noreferrer" className="underline">
                {t("Receipt")} {tx.slice(0, 10)}…
              </a>
            )}
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
          <Lock size={22} className="text-neutral-400" />
          <p className="text-sm text-neutral-600 dark:text-neutral-300">{t("This file is on sale in aindrive. Buy it to open it.")}</p>
          {info.needsAccount ? (
            <p className="text-xs text-neutral-500">{t("Connect your aindrive to buy this file")}</p>
          ) : (
            info.messages ? <fieldset disabled={step !== null} className="w-full min-w-0 text-left">
              <AinuiSurface messages={info.messages} onAction={buy} />
            </fieldset> : <p role="alert">{info.error ?? "Payment screen is unavailable. Refresh after updating aindrive."}</p>
          )}
          {step === "settle" && <p role="status">{t("Settling USDC on Base…")}</p>}
          {error && <span className="rounded bg-red-600/90 px-2 py-0.5 text-[11px] text-white">{error}</span>}
        </div>
      )}
    </div>
  );
}
