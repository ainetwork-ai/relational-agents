"use client";
import { useEffect, useRef, useState } from "react";
import { X402_PAY_ACTION, type A2uiMessage, type A2uiAction } from "ain-ui";
import { AinuiButton, AinuiFile, AinuiText, AinuiImage, DriveSurface } from "./surface";
import { payX402WithWallet } from "@/lib/wallet/x402";

type Unlock = { at: string; byName: string; receipt: string };
export function AinuiGiftSale({ giftId, title, name, mine, initialUnlock, preview }: {
  giftId: string; title: string; name: string; mine: boolean; initialUnlock?: Unlock; preview?: string;
}) {
  const [unlock, setUnlock] = useState(initialUnlock);
  const [messages, setMessages] = useState<A2uiMessage[]>([]);
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const endpoint = `/api/gift/${encodeURIComponent(giftId)}/wallet`;
  useEffect(() => {
    if (mine || unlock) return;
    const abort = new AbortController();
    fetch(endpoint, { cache: "no-store", signal: abort.signal }).then(async (r) => {
      const data = await r.json();
      if (abort.signal.aborted) return;
      if (!r.ok) throw new Error(data.error || "Could not load the payment screen");
      if (data.unlock) setUnlock(data.unlock);
      else if (!Array.isArray(data.messages) || !data.messages.length) throw new Error("Missing AIN-UI payment screen");
      else { setMessages(data.messages); setError(""); }
    }).catch((e) => { if (!abort.signal.aborted) setError(e.message); });
    return () => abort.abort();
  }, [endpoint, mine, unlock, version]);

  async function pay(action: A2uiAction) {
    if (action.name !== X402_PAY_ACTION || pending.current) return;
    const header = action.context?.paymentRequired;
    if (typeof header !== "string") throw new Error("Missing payment quote");
    pending.current = true; setBusy(true); setError("");
    try {
      const signed = await payX402WithWallet(header);
      const r = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ paymentSignature: signed.header }) });
      const data = await r.json();
      if (!r.ok || !data.unlock) throw new Error(data.error || "Payment failed");
      setUnlock(data.unlock);
    } catch (e) { setError((e as Error).message); }
    finally { pending.current = false; setBusy(false); }
  }
  return <div data-ainui="gift" data-unlocked={mine || !!unlock} className="p-3">
    <AinuiText text={title} />
    {mine || unlock ? <>
      <AinuiFile url={`/api/gift/${encodeURIComponent(giftId)}/video`} name={name || "gift.mp4"} />
      {unlock && <>
        <AinuiText text={`${unlock.byName} · ${unlock.receipt}`} />
        {/^0x[0-9a-f]{64}$/i.test(unlock.receipt) && <AinuiButton label="Receipt" onClick={() => { window.open(`https://basescan.org/tx/${unlock.receipt}`, "_blank", "noopener,noreferrer"); }} />}
      </>}
    </> : <fieldset disabled={busy} className="min-w-0">
      {preview && <AinuiImage url={preview} />}
      <DriveSurface messages={messages} onAction={pay} />
      {error && <p role="alert">{error}</p>}
      <AinuiButton label="Refresh payment quote" onClick={() => setVersion((v) => v + 1)} />
    </fieldset>}
  </div>;
}
