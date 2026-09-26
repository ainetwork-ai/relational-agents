"use client";

import { useState } from "react";
import { Gift, Lock } from "lucide-react";
import { useMe } from "@/stores/me";
import { useAindriveInfo } from "@/lib/aindrive-client";
import { aindriveRawUrl, parseAindriveUrl } from "@/lib/aindrive-url";
import { useT } from "@/i18n/provider";
import type { T } from "@/i18n";
import type { AgUiEvent, PayStep } from "@/lib/x402/agui";
import { giftPrice } from "@/lib/gift-price";
import { payX402WithWallet } from "@/lib/wallet/x402";
import { WalletSignatureError } from "@/lib/wallet/provider";

interface GiftView {
  spec: {
    id: string;
    title: string;
    recipientUserId: string;
    recipientName: string;
    amountKrw: number;
    amount: string;
    previewUrl?: string;
    /** sold as an aindrive paid share — paid from the viewer's own wallet */
    sale?: { price: number; currency: string };
  };
  unlock?: { at: string; byName: string; receipt: string };
}

const won = (t: T, spec: GiftView["spec"]) => giftPrice(spec, (n) => t("{n} won", { n: n.toLocaleString("ko-KR") }));

/** The AG-UI steps of a payment run, in order, as the button narrates them. */
const STEP_LABEL: Record<PayStep, string> = {
  quote: "402 · checking the price…",
  sign: "Signing in the wallet…",
  settle: "Settling…",
  unlock: "Opening…",
};

/** The same run when the viewer's own wallet pays (a gift sold through aindrive). */
type WalletStep = "quote" | "wallet" | "settle";
const WALLET_STEP_LABEL: Record<WalletStep, string> = {
  quote: "402 · checking the price…",
  wallet: "Approve it in MetaMask…",
  settle: "Settling USDC on Base…",
};

const isTx = (s: string) => /^0x[0-9a-fA-F]{64}$/.test(s);

/**
 * A gift on a page: a file its maker keeps unshared on their own device,
 * offered behind x402. Locked, it shows a blurred preview and "Open with pocket money";
 * paying sends the pocket money to the maker and opens it for the family.
 *
 * The payment is followed as an AG-UI run (POST …/pay with
 * Accept: text/event-stream): each STEP_STARTED changes the button's words,
 * the final STATE_SNAPSHOT carries the unlock, RUN_ERROR the reason.
 */
export function GiftBlock({ blockId, gift }: { blockId: string; gift: GiftView }) {
  const t = useT();
  const me = useMe();
  const info = useAindriveInfo();
  const [unlock, setUnlock] = useState(gift.unlock ?? null);
  const [step, setStep] = useState<PayStep | null>(null);
  const [walletStep, setWalletStep] = useState<WalletStep | null>(null);
  const [settlement, setSettlement] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { spec } = gift;
  const mine = me?.id === spec.recipientUserId;
  const previewRef = spec.previewUrl ? parseAindriveUrl(spec.previewUrl, info?.base) : null;
  const video = `/api/gift/${encodeURIComponent(spec.id)}/video`;
  const usdc = (Number(spec.amount) / 1e6).toFixed(2);
  const busy = step !== null || walletStep !== null;

  /** aindrive quotes (402) → MetaMask signs the USDC transfer → aindrive settles on chain. */
  async function payWithWallet() {
    const url = `/api/gift/${encodeURIComponent(spec.id)}/wallet`;
    setError(null);
    try {
      setWalletStep("quote");
      const q = await fetch(url, { cache: "no-store" });
      const quote = (await q.json().catch(() => ({}))) as { paymentRequired?: string; unlock?: GiftView["unlock"]; error?: string };
      if (quote.unlock) return setUnlock(quote.unlock);
      if (!q.ok || !quote.paymentRequired) throw new Error(quote.error ?? t("Payment failed. Please try again."));
      setWalletStep("wallet");
      const { header } = await payX402WithWallet(quote.paymentRequired);
      setWalletStep("settle");
      const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ paymentSignature: header }) });
      const d = (await r.json().catch(() => ({}))) as { unlock?: GiftView["unlock"]; error?: string };
      if (!r.ok || !d.unlock) throw new Error(d.error ?? t("Payment failed. Please try again."));
      setSettlement("aindrive");
      setUnlock(d.unlock);
    } catch (e) {
      const reason = e instanceof WalletSignatureError ? e.reason : null;
      setError(
        reason === "no-provider"
          ? t("MetaMask is needed to pay. Install it and try again.")
          : reason === "rejected"
            ? t("Payment cancelled in MetaMask.")
            : (e as Error).message || t("Payment failed. Please try again.")
      );
    } finally {
      setWalletStep(null);
    }
  }

  async function pay() {
    setStep("quote");
    setError(null);
    let r: Response | null = null;
    try {
      r = await fetch(`/api/gift/${encodeURIComponent(spec.id)}/pay`, { method: "POST", headers: { accept: "text/event-stream" } });
    } catch {
      r = null;
    }
    if (!r?.ok || !r.body) {
      const d = (await r?.json().catch(() => ({}))) as { error?: string } | undefined;
      setStep(null);
      return setError(d?.error ?? t("Payment failed. Please try again."));
    }
    // AG-UI over SSE: one JSON event per `data:` line
    const reader = r.body.pipeThrough(new TextDecoderStream()).getReader();
    let buf = "";
    let done: GiftView["unlock"] | null = null;
    let failed: string | null = null;
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buf += chunk.value;
      let nl;
      while ((nl = buf.indexOf("\n\n")) >= 0) {
        const frame = buf.slice(0, nl);
        buf = buf.slice(nl + 2);
        const line = frame.split("\n").find((l) => l.startsWith("data:"));
        if (!line) continue;
        let e: AgUiEvent;
        try {
          e = JSON.parse(line.slice(5));
        } catch {
          continue;
        }
        if (e.type === "STEP_STARTED") setStep(e.stepName);
        else if (e.type === "STATE_SNAPSHOT") {
          if (e.snapshot.settlement) setSettlement(e.snapshot.settlement);
          if (e.snapshot.unlock) done = e.snapshot.unlock as GiftView["unlock"];
        } else if (e.type === "RUN_ERROR") failed = e.message;
      }
    }
    setStep(null);
    if (done) return setUnlock(done);
    setError(failed ?? t("Payment failed. Please try again."));
  }

  return (
    <div
      data-testid={`gift-block-${blockId}`}
      data-unlocked={unlock ? "true" : "false"}
      data-settlement={settlement ?? undefined}
      contentEditable={false}
      className="my-1 overflow-hidden rounded-lg border border-amber-200 bg-amber-50/40 dark:border-amber-900/60 dark:bg-amber-950/20"
    >
      <div className="flex items-center gap-2 px-3 py-2 text-sm">
        <Gift size={15} className="shrink-0 text-amber-600" />
        <span className="font-medium text-neutral-800 dark:text-neutral-100">{spec.title}</span>
        <span className="text-xs text-neutral-500">· {t("a video by {name}", { name: spec.recipientName })}</span>
        <span className="ml-auto rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 dark:bg-amber-900/50 dark:text-amber-200">
          x402{settlement === "aindrive" || spec.sale ? " · aindrive" : ""}
        </span>
      </div>
      {unlock || mine ? (
        <div>
          <video data-testid={`gift-video-${blockId}`} src={video} controls playsInline className="block max-h-[420px] w-full bg-black" />
          <p className="px-3 py-2 text-xs text-neutral-500">
            {unlock
              ? t("🎁 {by} opened it with {krw} of pocket money · receipt {receipt}", { by: unlock.byName, krw: won(t, spec), receipt: "" })
              : t("Your video. Family members see a gift that opens with {krw} of pocket money.", { krw: won(t, spec) })}
            {unlock &&
              (isTx(unlock.receipt) ? (
                <a href={`https://basescan.org/tx/${unlock.receipt}`} target="_blank" rel="noreferrer" className="underline">
                  {unlock.receipt.slice(0, 10)}…{unlock.receipt.slice(-6)}
                </a>
              ) : (
                unlock.receipt
              ))}
          </p>
        </div>
      ) : (
        <div className="relative">
          {previewRef ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={aindriveRawUrl(previewRef)} alt="" className="block max-h-[420px] w-full object-cover" />
          ) : (
            <div className="h-48 bg-neutral-800" />
          )}
          <div className="absolute inset-0 flex flex-col items-center justify-end gap-2 bg-gradient-to-t from-black/60 to-transparent p-4">
            <button
              data-testid={`gift-pay-${blockId}`}
              data-step={step ?? walletStep ?? undefined}
              onClick={() => void (spec.sale ? payWithWallet() : pay())}
              disabled={busy}
              className="flex items-center gap-1.5 rounded-full bg-white px-4 py-2 text-sm font-semibold text-neutral-900 shadow disabled:opacity-60"
            >
              <Lock size={14} />
              {walletStep
                ? t(WALLET_STEP_LABEL[walletStep])
                : step
                  ? t(STEP_LABEL[step])
                  : t("Open with {krw} of pocket money", { krw: won(t, spec) })}
            </button>
            <span className="text-[11px] text-white/85">
              {spec.sale
                ? t("x402 · {usdc} USDC on Base, from your MetaMask → {name}'s wallet", { usdc, name: spec.recipientName })
                : t("x402 · {usdc} USDC → {name}'s wallet", { usdc, name: spec.recipientName })}
            </span>
            {error && <span className="rounded bg-red-600/90 px-2 py-0.5 text-[11px] text-white">{error}</span>}
          </div>
        </div>
      )}
    </div>
  );
}
