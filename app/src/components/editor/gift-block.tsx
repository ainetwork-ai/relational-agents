"use client";

import { AinuiGiftSale } from "@/components/ainui/gift-sale";
import { useAindriveInfo } from "@/lib/aindrive-client";
import { fileBytesUrl } from "@/lib/aindrive-url";
import { useState } from "react";
import { useMe } from "@/stores/me";
import { useT } from "@/i18n/provider";
import type { T } from "@/i18n";
import type { AgUiEvent, PayStep } from "@/lib/x402/agui";
import { giftPrice } from "@/lib/gift-price";
import { AinuiButton, AinuiFile, AinuiText, AinuiImage } from "@/components/ainui/surface";

interface GiftView {
  spec: {
    id: string;
    title: string;
    recipientUserId: string;
    recipientName: string;
    amountKrw: number;
    amount: string;
    previewUrl?: string;
    /** the locked file — a video plays; anything else opens in the file preview */
    file?: { path: string; mime: string };
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
  const [settlement, setSettlement] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { spec } = gift;
  const mine = me?.id === spec.recipientUserId;
  const video = `/api/gift/${encodeURIComponent(spec.id)}/video`;
  // gifts made before `file` reached the client are all videos
  const fileName = spec.file?.path.split("/").pop() ?? "";
  const usdc = (Number(spec.amount) / 1e6).toFixed(2);
  const busy = step !== null;

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

  if (spec.sale) return <div data-testid={`gift-block-${blockId}`} contentEditable={false}>
    <AinuiGiftSale key={spec.id} giftId={spec.id} title={spec.title} name={fileName || "gift.mp4"} mine={mine} initialUnlock={gift.unlock} preview={spec.previewUrl ? fileBytesUrl(spec.previewUrl, info?.base) : undefined} />
  </div>;

  return <div data-testid={`gift-block-${blockId}`} data-unlocked={!!unlock} data-settlement={settlement ?? undefined} contentEditable={false} className="my-1 rounded-lg border p-3">
    <AinuiText text={`${spec.title} · ${spec.recipientName}`} />
    {unlock || mine ? <>
      <AinuiFile url={video} name={fileName || "gift.mp4"} />
      <AinuiText text={unlock ? `${unlock.byName} · ${unlock.receipt}` : t("Yours. Family members see a gift that opens with {krw}.", { krw: won(t, spec) })} />
    </> : <>
      {spec.previewUrl && <AinuiImage url={fileBytesUrl(spec.previewUrl, info?.base)} />}
      <AinuiButton testId={`gift-pay-${blockId}`} disabled={busy} onClick={pay} label={step ? t(STEP_LABEL[step]) : t("Open with {krw} of pocket money", { krw: won(t, spec) })} />
      <AinuiText text={t("x402 · {usdc} USDC → {name}'s wallet", { usdc, name: spec.recipientName })} />
      {error && <p role="alert">{error}</p>}
    </>}
  </div>;
}
