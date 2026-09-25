"use client";

import { useState } from "react";
import { Gift, Lock } from "lucide-react";
import { useMe } from "@/stores/me";
import { useAindriveInfo } from "@/lib/aindrive-client";
import { aindriveRawUrl, parseAindriveUrl } from "@/lib/aindrive-url";
import { useT } from "@/i18n/provider";

interface GiftView {
  spec: {
    id: string;
    title: string;
    recipientUserId: string;
    recipientName: string;
    amountKrw: number;
    amount: string;
    previewUrl?: string;
  };
  unlock?: { at: string; byName: string; receipt: string };
}

const won = (n: number) => `${n.toLocaleString("ko-KR")}원`;

/**
 * A gift on a page: a file its maker keeps unshared on their own device,
 * offered behind x402. Locked, it shows a blurred preview and "용돈으로 열기";
 * paying sends the pocket money to the maker and opens it for the family.
 */
export function GiftBlock({ blockId, gift }: { blockId: string; gift: GiftView }) {
  const t = useT();
  const me = useMe();
  const info = useAindriveInfo();
  const [unlock, setUnlock] = useState(gift.unlock ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { spec } = gift;
  const mine = me?.id === spec.recipientUserId;
  const previewRef = spec.previewUrl ? parseAindriveUrl(spec.previewUrl, info?.base) : null;
  const video = `/api/gift/${encodeURIComponent(spec.id)}/video`;
  const usdc = (Number(spec.amount) / 1e6).toFixed(2);

  async function pay() {
    setBusy(true);
    setError(null);
    const r = await fetch(`/api/gift/${encodeURIComponent(spec.id)}/pay`, { method: "POST" }).catch(() => null);
    const d = (await r?.json().catch(() => ({}))) as { unlock?: GiftView["unlock"]; error?: string } | undefined;
    setBusy(false);
    if (!r?.ok || !d?.unlock) return setError(d?.error ?? t("결제하지 못했어요. 다시 시도해 주세요."));
    setUnlock(d.unlock);
  }

  return (
    <div
      data-testid={`gift-block-${blockId}`}
      data-unlocked={unlock ? "true" : "false"}
      contentEditable={false}
      className="my-1 overflow-hidden rounded-lg border border-amber-200 bg-amber-50/40 dark:border-amber-900/60 dark:bg-amber-950/20"
    >
      <div className="flex items-center gap-2 px-3 py-2 text-sm">
        <Gift size={15} className="shrink-0 text-amber-600" />
        <span className="font-medium text-neutral-800 dark:text-neutral-100">{spec.title}</span>
        <span className="text-xs text-neutral-500">· {t("{name}이(가) 만든 영상", { name: spec.recipientName })}</span>
        <span className="ml-auto rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 dark:bg-amber-900/50 dark:text-amber-200">x402</span>
      </div>
      {unlock || mine ? (
        <div>
          <video data-testid={`gift-video-${blockId}`} src={video} controls playsInline className="block max-h-[420px] w-full bg-black" />
          <p className="px-3 py-2 text-xs text-neutral-500">
            {unlock
              ? t("🎁 {by}께서 용돈 {krw}으로 여셨어요 · 영수증 {receipt}", { by: unlock.byName, krw: won(spec.amountKrw), receipt: unlock.receipt })
              : t("내 영상이에요. 가족에게는 용돈 {krw}으로 열리는 선물로 보여요.", { krw: won(spec.amountKrw) })}
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
              onClick={() => void pay()}
              disabled={busy}
              className="flex items-center gap-1.5 rounded-full bg-white px-4 py-2 text-sm font-semibold text-neutral-900 shadow disabled:opacity-60"
            >
              <Lock size={14} />
              {busy ? t("용돈 보내는 중…") : t("용돈 {krw}으로 열기", { krw: won(spec.amountKrw) })}
            </button>
            <span className="text-[11px] text-white/85">
              {t("x402 · {usdc} USDC → {name} 지갑", { usdc, name: spec.recipientName })}
            </span>
            {error && <span className="rounded bg-red-600/90 px-2 py-0.5 text-[11px] text-white">{error}</span>}
          </div>
        </div>
      )}
    </div>
  );
}
