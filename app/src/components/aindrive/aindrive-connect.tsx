"use client";

import { useState } from "react";
import { HardDrive, LogOut } from "lucide-react";
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
 * "aindrive에 로그인된 세션으로 연결": the step before any drive can be listed.
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

  return (
    <div
      data-testid="aindrive-connect"
      className={`flex flex-col items-center gap-2 text-center ${compact ? "py-3" : "rounded-lg border border-dashed border-neutral-300 px-4 py-6 dark:border-neutral-700"}`}
    >
      <HardDrive size={compact ? 18 : 24} className="text-neutral-400" />
      <p className="text-sm text-neutral-700 dark:text-neutral-200">
        {t("{host} 계정을 연결하면 내 드라이브가 여기에 나옵니다.", { host })}
      </p>
      <p className="text-xs text-neutral-500">
        {t("브라우저에서 {host}에 이미 로그인돼 있으면 승인만 누르면 됩니다.", { host })}
      </p>
      <button
        type="button"
        data-testid="aindrive-connect-button"
        onClick={() => void go()}
        disabled={status === "opening" || status === "waiting"}
        className="mt-1 flex items-center gap-1.5 rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60 dark:bg-neutral-100 dark:text-neutral-900"
      >
        <HardDrive size={14} />
        {status === "waiting"
          ? t("aindrive 창에서 승인해 주세요…")
          : status === "opening"
            ? t("여는 중…")
            : t("{host}로 연결", { host })}
      </button>
      {status === "failed" && (
        <p className="text-xs text-red-600">{t("연결되지 않았습니다. 다시 시도해 주세요.")}</p>
      )}
    </div>
  );
}

/** "email · 연결 해제" — which aindrive account is in use. */
export function AindriveAccountBadge() {
  const t = useT();
  const info = useAindriveInfo();
  if (!info?.connected) return null;
  return (
    <span data-testid="aindrive-account-badge" className="flex min-w-0 items-center gap-1.5 text-[11px] text-neutral-500">
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
      <span className="truncate">
        {hostOf(info.base)} · {info.account?.email ?? info.account?.name ?? t("연결됨")}
      </span>
      <button
        type="button"
        data-testid="aindrive-disconnect"
        onClick={() => {
          if (window.confirm(t("aindrive 계정 연결을 해제할까요? 내가 연결한 폴더는 다시 연결할 때까지 열리지 않습니다.")))
            void disconnectAindrive();
        }}
        title={t("연결 해제")}
        className="shrink-0 rounded p-0.5 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600 dark:hover:bg-neutral-800"
      >
        <LogOut size={11} />
      </button>
    </span>
  );
}
