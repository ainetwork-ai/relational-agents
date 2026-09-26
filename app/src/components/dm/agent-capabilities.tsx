"use client";

/**
 * What a relation's agent may do with its treasury, read out at the top of the
 * agent drawer: the adopted Treasury Rules grouped by who decides (the agent
 * alone · verified humans with World ID · nobody), the wallets it holds, and
 * the authority it runs now with the stop anyone may use. Rules change in the
 * relation's doc and by adoption, never here; the rule lines are parsed by the
 * same grammar the agent enforces (policy.ts).
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Ban, Check } from "lucide-react";
import { useT } from "@/i18n/provider";
import type { TreasuryStatus } from "@/lib/agent/treasury/types";
import { parseTreasuryPolicy } from "@/lib/agent/treasury/policy";
import { exposureUsd, relationDay } from "@/lib/agent/treasury/recurring-record";
import { ChainBadge, UniswapBadge, explorerAddressUrl } from "@/components/chain/chain-badge";

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400 focus-visible:ring-offset-1 dark:focus-visible:ring-offset-neutral-900";
const HEAD = "mb-1.5 mt-4 flex items-center justify-between text-xs font-medium text-neutral-500 dark:text-neutral-400";

function usd(n: number, cents = false): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: cents ? 2 : Number.isInteger(n) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(n);
}
function short(hex: string): string {
  return hex.length > 12 ? `${hex.slice(0, 6)}…${hex.slice(-4)}` : hex;
}
/** A rule's subject as the relation wrote it: "Shared expenses under $50". */
function subjectOf(text: string): string {
  const colon = text.indexOf(":");
  return (colon > 0 ? text.slice(0, colon) : text).trim();
}

export function AgentCapabilities({ roomId, agentName }: { roomId: string; agentName: string }) {
  const t = useT();
  const [status, setStatus] = useState<TreasuryStatus | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [stopResult, setStopResult] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/dm/rooms/${roomId}/treasury`, { cache: "no-store" }).catch(() => null);
    setStatus(res?.ok ? ((await res.json()) as TreasuryStatus) : null);
    setLoaded(true);
  }, [roomId]);

  useEffect(() => {
 // fetch-on-mount: the status is set when the answer lands, not in this body
 // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function stop() {
    setStopping(true);
    try {
      const res = await fetch(`/api/dm/rooms/${roomId}/treasury/recurring`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "stop" }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setStopResult(res.ok ? { ok: true, text: t("Stopped. No more buys.") } : { ok: false, text: data.error || t("Couldn't stop it.") });
      await load();
    } catch {
      setStopResult({ ok: false, text: t("Couldn't reach the server — nothing changed.") });
    } finally {
      setStopping(false);
      setConfirmStop(false);
    }
  }

  // held at a steady height while the status loads, so the settings below don't jump
  if (!loaded) return <div className="h-40 animate-pulse rounded-lg bg-neutral-100 dark:bg-neutral-800" aria-label={t("Loading…")} />;
  if (!status?.enabled) return null;

  const policy = parseTreasuryPolicy(status.rules.map((r) => `- ${r}`).join("\n"));
  const alone = policy.rules.filter((r) => !r.forbidden && r.approvals === 0);
  const approved = policy.rules.filter((r) => !r.forbidden && r.approvals > 0);
  const never = policy.rules.filter((r) => r.forbidden);
  const live = status.recurring?.live ?? null;
  const baseAddress = status.invested?.address ?? status.address;

  return (
    <section data-testid="agent-capabilities" className="text-sm text-neutral-800 dark:text-neutral-200">
      <div className="flex items-center justify-between gap-3 rounded-lg bg-neutral-50 px-3 py-2.5 dark:bg-neutral-800/60">
        <span className="min-w-0">
          <span className="block truncate font-medium">{agentName}</span>
          <span className="block text-xs text-neutral-500 dark:text-neutral-400">
            {status.adoptedAt ? t("Follows our adopted Treasury Rules") : t("No rules adopted yet — it moves no money")}
          </span>
        </span>
        {status.rulesPageId && (
          <Link
            href={`/p/${status.rulesPageId}`}
            className={`shrink-0 rounded px-1 text-xs font-medium text-[#2383e2] hover:underline dark:text-blue-400 ${FOCUS}`}
          >
            {t("Rules")} →
          </Link>
        )}
      </div>

      <h3 className={HEAD}>{t("On its own")}</h3>
      <ul className="space-y-1">
        {alone.map((r) => (
          <li key={r.text} className="flex items-start gap-2">
            <Check size={14} className="mt-0.5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
            {subjectOf(r.text)}
          </li>
        ))}
        {live && (
          <li className="flex items-start gap-2">
            <Check size={14} className="mt-0.5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
            {t("Run the adopted recurring buy, once a week")}
          </li>
        )}
        <li className="flex items-start gap-2">
          <Check size={14} className="mt-0.5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
          {t("Stop a recurring buy when anyone asks")}
        </li>
      </ul>

      {approved.length > 0 && (
        <>
          <h3 className={HEAD}>
            <span>{t("Needs verified humans")}</span>
            <span className="font-normal">World ID</span>
          </h3>
          <ul className="space-y-1">
            {approved.map((r) => (
              <li key={r.text} className="flex items-center justify-between gap-3">
                <span className="min-w-0">{subjectOf(r.text)}</span>
                <span
                  className="shrink-0 rounded bg-amber-50 px-1.5 text-xs font-medium tabular-nums text-amber-800 ring-1 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-200 dark:ring-amber-900"
                  title={r.approvals === 1 ? t("1 verified human") : t("{n} verified humans", { n: r.approvals })}
                >
                  {r.approvals}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}

      <h3 className={HEAD}>{t("Never")}</h3>
      <ul className="space-y-1 text-neutral-500 dark:text-neutral-400">
        {never.map((r) => (
          <li key={r.text} className="flex items-start gap-2">
            <Ban size={14} className="mt-0.5 shrink-0" aria-hidden />
            {subjectOf(r.text)}
          </li>
        ))}
        <li className="flex items-start gap-2">
          <Ban size={14} className="mt-0.5 shrink-0" aria-hidden />
          {t("Give itself new authority")}
        </li>
      </ul>
      {policy.unparsed.length > 0 && (
        <p className="mt-2 text-xs text-red-700 dark:text-red-300">
          {t("Can't read: {lines} — it moves no money until this is fixed.", { lines: policy.unparsed.join("; ") })}
        </p>
      )}

      <h3 className={HEAD}>{t("Wallets")}</h3>
      <ul className="space-y-2">
        <li className="flex items-center justify-between gap-3">
          <span className="flex min-w-0 flex-wrap items-center gap-1.5">
            {t("Shared pot")}
            <ChainBadge chain="sepolia" />
            {status.address && (
              <a href={explorerAddressUrl("sepolia", status.address)} target="_blank" rel="noreferrer" title={status.address} className={`font-mono text-xs text-neutral-500 underline decoration-dotted underline-offset-2 ${FOCUS}`}>
                {short(status.address)}
              </a>
            )}
          </span>
          <span className="shrink-0 tabular-nums">{status.balanceUsd === null ? "—" : usd(status.balanceUsd, true)}</span>
        </li>
        <li className="flex items-center justify-between gap-3">
          <span className="flex min-w-0 flex-wrap items-center gap-1.5">
            {t("Buying wallet")}
            <ChainBadge chain="base" />
            {baseAddress && (
              <a href={explorerAddressUrl("base", baseAddress)} target="_blank" rel="noreferrer" title={baseAddress} className={`font-mono text-xs text-neutral-500 underline decoration-dotted underline-offset-2 ${FOCUS}`}>
                {short(baseAddress)}
              </a>
            )}
          </span>
          <span className="shrink-0 tabular-nums">{status.invested ? `${Number(status.invested.usdcIdle).toLocaleString("en-US", { maximumFractionDigits: 2 })} USDC` : "—"}</span>
        </li>
      </ul>

      {(live || stopResult) && (
        <>
          <h3 className={HEAD}>{t("Running")}</h3>
          {live ? (
            <div data-testid="agent-running" className="rounded-lg border border-neutral-200 px-3 py-2.5 dark:border-neutral-700">
              <div className="flex items-center justify-between gap-3">
                <span className="flex min-w-0 flex-wrap items-center gap-1.5">
                  <span className="inline-flex h-5 items-center rounded-full bg-emerald-50 px-2 text-[11px] font-medium text-emerald-800 ring-1 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-200 dark:ring-emerald-900">
                    {t("Running")}
                  </span>
                  <span className="font-medium">{t("Recurring buy")}</span>
                  <UniswapBadge />
                  <ChainBadge chain="base" />
                </span>
                {confirmStop ? (
                  <span className="flex shrink-0 items-center gap-2 text-xs">
                    <button
                      type="button"
                      data-testid="agent-running-stop-yes"
                      onClick={() => void stop()}
                      disabled={stopping}
                      className={`rounded px-1 font-medium text-red-700 transition-colors hover:text-red-600 disabled:opacity-50 dark:text-red-300 ${FOCUS}`}
                    >
                      {stopping ? t("Stopping…") : t("Yes, stop")}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmStop(false)}
                      disabled={stopping}
                      className={`rounded px-1 text-neutral-500 transition-colors hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200 ${FOCUS}`}
                    >
                      {t("Keep it")}
                    </button>
                  </span>
                ) : (
                  <button
                    type="button"
                    data-testid="agent-running-stop"
                    onClick={() => setConfirmStop(true)}
                    className={`shrink-0 rounded-md px-2 py-0.5 text-xs font-medium text-red-600 ring-1 ring-red-200 transition-colors hover:bg-red-50 active:bg-red-100 dark:text-red-400 dark:ring-red-900 dark:hover:bg-red-950/40 ${FOCUS}`}
                  >
                    {t("Stop")}
                  </button>
                )}
              </div>
              <p className="mt-1.5 text-xs tabular-nums text-neutral-600 dark:text-neutral-300">
                {t("{amount} a week · week {k} of {n} · {spent} of {total} · through {day}", {
                  amount: usd(live.weeklyUsd),
                  k: live.weekIndex,
                  n: live.weeks,
                  spent: usd(live.investedUsd),
                  total: usd(exposureUsd(live.weeklyUsd, live.weeks)),
                  day: relationDay(Date.parse(live.expiresAt) - 1000),
                })}
              </p>
              <p className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
                {t("Approved by {names} · anyone can stop it, no vote", { names: live.approvedBy.join(", ") || "—" })}
              </p>
            </div>
          ) : null}
          {stopResult && (
            <p role="status" className={`mt-1.5 text-xs ${stopResult.ok ? "text-emerald-700 dark:text-emerald-300" : "text-red-700 dark:text-red-300"}`}>
              {stopResult.text}
            </p>
          )}
        </>
      )}
    </section>
  );
}
