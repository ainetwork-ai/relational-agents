"use client";

import { useState } from "react";
import { AinuiButton, AinuiText } from "@/components/ainui/surface";
import { connectAindrive, disconnectAindrive, useAindriveInfo } from "@/lib/aindrive-client";
import { useT } from "@/i18n/provider";

function hostOf(base: string | null | undefined): string {
  try {
    return base ? new URL(base).host : "aindrive";
  } catch {
    return "aindrive";
  }
}

/**
 * "Connect with your signed-in aindrive session": the step before any drive can be listed.
 * Opens aindrive's approval page — signed in there already, the person only
 * approves — and this person's own aindrive account is connected.
 */
export function AindriveConnect({ onConnected, compact = false }: { onConnected?: () => void; compact?: boolean }) {
  const t = useT();
  const info = useAindriveInfo();
  const [status, setStatus] = useState<"idle" | "opening" | "waiting" | "failed">("idle");
  const host = hostOf(info?.base);

  async function go() {
    setStatus("opening");
    const ok = await connectAindrive((s) => setStatus(s));
    setStatus(ok ? "idle" : "failed");
    if (ok) onConnected?.();
  }

  return <div data-testid="aindrive-connect" className={compact ? "p-2" : "rounded-lg border p-4"}>
    <AinuiText text={t("Connect your {host} account to see your drives here.", { host })} />
    <AinuiText text={t("If you're already signed in to {host} in this browser, just approve.", { host })} />
    <AinuiButton testId="aindrive-connect-button" disabled={status === "opening" || status === "waiting"} onClick={go}
      label={status === "waiting" ? t("Approve in the aindrive window…") : status === "opening" ? t("Opening…") : t("Connect {host}", { host })} />
    {status === "failed" && <AinuiText text={t("Not connected. Please try again.")} />}
  </div>;
}

/** "email · Disconnect" — which aindrive account is in use. */
export function AindriveAccountBadge() {
  const t = useT();
  const info = useAindriveInfo();
  if (!info?.connected) return null;
  return <div data-testid="aindrive-account-badge" className="flex flex-wrap items-center gap-2 text-xs">
    <AinuiText text={`${hostOf(info.base)} · ${info.account?.email ?? info.account?.name ?? t("Connected")}`} />
    <AinuiButton testId="aindrive-disconnect" label={t("Disconnect")} confirm={t("Disconnect your aindrive account? Folders you linked won't open until you connect again.")} onClick={disconnectAindrive} />
  </div>;
}
