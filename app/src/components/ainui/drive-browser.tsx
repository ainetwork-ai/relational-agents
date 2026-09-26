"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { AinuiSurface } from "ain-ui/react";
import type { A2uiAction, A2uiMessage } from "ain-ui";
import "ain-ui/styles.css";

export function AinuiDriveBrowser({ source }: { source: string }) {
  return <DriveSurface key={source} source={source} />;
}

function DriveSurface({ source }: { source: string }) {
  const [messages, setMessages] = useState<A2uiMessage[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const generation = useRef(0);
  const run = useCallback(async (action?: A2uiAction) => {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError("");
    const current = generation.current;
    try {
      const r = await fetch("/api/ainui/aindrive", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ source, action }) });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Could not open the folder");
      if (current === generation.current) setMessages(data.messages);
    } catch (e) { if (current === generation.current) setError((e as Error).message); }
    finally { if (current === generation.current) { pending.current = false; setBusy(false); } }
  }, [source]);
  useEffect(() => {
    const current = ++generation.current;
    let cancelled = false;
    Promise.resolve().then(() => { if (!cancelled) void run(); });
    return () => { cancelled = true; generation.current = current + 1; };
  }, [run]);
  return <div className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-700">
    <fieldset disabled={busy} className="min-w-0">
      <AinuiSurface messages={messages} onAction={run} resolveAsset={(asset, opts) => {
        const q = new URLSearchParams({ drive: asset.drive_id, path: asset.path });
        if (opts?.download) q.set("download", "1");
        if (asset.v !== undefined) q.set("v", String(asset.v));
        return `/api/aindrive/${asset.variant === "thumb" && !opts?.download ? "thumb" : "raw"}?${q}`;
      }} />
    </fieldset>
    {busy && <p role="status" className="mt-2 text-xs text-neutral-500">Loading…</p>}
    {error && <p role="alert" className="mt-2 text-sm text-red-600">{error}</p>}
    <button className="mt-3 text-xs text-neutral-500" disabled={busy} onClick={() => void run()}>Refresh</button>
  </div>;
}
