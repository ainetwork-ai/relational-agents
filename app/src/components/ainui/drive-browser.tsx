"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { DriveSurface as Surface, AinuiButton } from "./surface";
import type { A2uiAction, A2uiMessage } from "ain-ui";
import "ain-ui/styles.css";

type Props = { source: string; onPick?: (file: { driveId: string; path: string }) => void };
export function AinuiDriveBrowser({ source, onPick }: Props) {
  return <DriveSurface key={source} source={source} onPick={onPick} />;
}

function DriveSurface({ source, onPick }: Props) {
  const [messages, setMessages] = useState<A2uiMessage[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const picker = useRef(onPick);
  useEffect(() => { picker.current = onPick; }, [onPick]);
  const isPicker = !!onPick;
  const pending = useRef(false);
  const generation = useRef(0);
  const run = useCallback(async (action?: A2uiAction) => {
    if (pending.current) return;
    if (picker.current && action?.name === "aindrive.open" && action.context?.is_dir !== true && action.context?.is_dir !== "true") {
      const { drive_id, path } = action.context ?? {};
      if (typeof drive_id === "string" && typeof path === "string") picker.current({ driveId: drive_id, path });
      return;
    }
    pending.current = true; setBusy(true); setError("");
    const current = generation.current;
    try {
      const r = await fetch("/api/ainui/aindrive", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ source, action, mode: isPicker ? "pick" : "browse" }) });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Could not open the folder");
      if (current === generation.current) setMessages(data.messages);
    } catch (e) { if (current === generation.current) setError((e as Error).message); }
    finally { if (current === generation.current) { pending.current = false; setBusy(false); } }
  }, [source, isPicker]);
  useEffect(() => {
    const current = ++generation.current;
    let cancelled = false;
    Promise.resolve().then(() => { if (!cancelled) void run(); });
    return () => { cancelled = true; generation.current = current + 1; };
  }, [run]);
  return <div className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-700">
    <fieldset disabled={busy} className="min-w-0">
      <Surface messages={messages} onAction={run} />
    </fieldset>
    {busy && <p role="status" className="mt-2 text-xs text-neutral-500">Loading…</p>}
    {error && <p role="alert" className="mt-2 text-sm text-red-600">{error}</p>}
    <AinuiButton label="Refresh" disabled={busy} onClick={() => run()} />
  </div>;
}
