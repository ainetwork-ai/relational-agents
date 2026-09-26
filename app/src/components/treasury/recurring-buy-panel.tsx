"use client";

import { useState, type ReactNode } from "react";
import type { TreasuryStatus } from "@/lib/agent/treasury/types";
import { SKIP_REASON_TEXT } from "@/lib/agent/treasury/recurring-record";
import type { RecurringRunResult } from "@/lib/agent/treasury/recurring";

type Tone = "ok" | "bad" | "info";
type Recurring = NonNullable<TreasuryStatus["recurring"]>;

const THIS_WEEK_COPY: Record<NonNullable<Recurring["live"]>["thisWeek"], string> = {
  bought: "this week: bought",
  open: "this week: not bought yet",
  skipped: "this week: skipped",
};

const toneClass: Record<Tone, string> = {
  ok: "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200",
  bad: "border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200",
  info: "border-neutral-200 bg-neutral-50 text-neutral-700 dark:border-neutral-700 dark:bg-neutral-800/60 dark:text-neutral-200",
};

function usd(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: Number.isInteger(n) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(n);
}
/** Whole-token decimal strings ("0.0000254") to at most 6 significant digits. */
function tokens(amount: string): string {
  const n = Number(amount);
  return Number.isFinite(n) ? new Intl.NumberFormat("en-US", { maximumSignificantDigits: 6 }).format(n) : amount;
}
/** "Mon 12 Oct" — the window is in UTC weeks, so is the date. */
function day(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })
    .format(new Date(iso))
    .replace(",", "");
}
function hoursLeft(iso: string): string {
  const h = (new Date(iso).getTime() - Date.now()) / 3_600_000;
  if (h <= 0) return "expiring";
  return h < 1 ? `expires in ${Math.max(1, Math.round(h * 60))} min` : `expires in ${Math.round(h)} h`;
}
function short(hex: string): string {
  return hex.length > 12 ? `${hex.slice(0, 6)}…${hex.slice(-4)}` : hex;
}
/** A basescan link's last path segment is the transaction hash. */
function txOf(url: string): string {
  return short(url.split("/").pop() ?? url);
}

function runMessage(r: RecurringRunResult): { tone: Tone; text: string; txUrl?: string } {
  switch (r.outcome) {
    case "bought":
      return {
        tone: "ok",
        text: `Bought ${tokens(r.wethOut)} WETH for ${tokens(r.usdcIn)} USDC on Base (week ${r.isoWeek}).`,
        txUrl: r.txUrl,
      };
    case "skipped":
      return { tone: "info", text: `Skipped ${r.isoWeek}: ${SKIP_REASON_TEXT[r.reason]}. Nothing was bought.` };
    case "rehearsal":
      return {
        tone: "info",
        text: `Rehearsal: the agent would buy ${usd(r.wouldBuyUsd)} of ETH for ${r.isoWeek} — real buys are off on this server, so nothing moved.`,
      };
    case "none":
      return { tone: "info", text: "There's no recurring buy running — nothing was bought." };
  }
}

const buttonClass =
  "rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-neutral-700 disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-white";
const linkClass =
  "font-mono underline decoration-dotted underline-offset-2 hover:text-neutral-800 dark:hover:text-neutral-200";

/**
 * The room's recurring buy inside the treasury panel: a request waiting for
 * World ID approvals, or the adopted authority with its weekly runs. Numbers
 * and permissions come from the server (status.recurring, the recurring
 * route); the buttons only ask. Mount it keyed by roomId.
 */
export function RecurringBuyPanel({
  roomId,
  status,
  onChanged,
}: {
  roomId: string;
  status: TreasuryStatus;
  onChanged: () => Promise<void>;
}) {
  const [busy, setBusy] = useState<"run" | "stop" | null>(null);
  const [confirmStop, setConfirmStop] = useState(false);
  const [message, setMessage] = useState<{ tone: Tone; text: string; txUrl?: string } | null>(null);

  const recurring = status.recurring;
  if (!recurring || (!recurring.live && !recurring.pending)) return null;
  const { live, pending } = recurring;

  async function send(action: "run" | "stop") {
    setBusy(action);
    setMessage(null);
    try {
      const res = await fetch(`/api/dm/rooms/${roomId}/treasury/recurring`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; result?: RecurringRunResult };
      if (!res.ok) setMessage({ tone: "bad", text: data.error || `That didn't work (${res.status}).` });
      else if (action === "run" && data.result) setMessage(runMessage(data.result));
      // with an authority in force a stop hits that one; otherwise it withdrew the waiting request
      else if (action === "stop")
        setMessage({
          tone: "ok",
          text: live
            ? "Stopped the recurring buy — the agent won't buy again under it."
            : "Withdrew the recurring buy request — it will never run.",
        });
      await onChanged();
    } catch {
      setMessage({ tone: "bad", text: "Couldn't reach the server — nothing changed." });
    } finally {
      setBusy(null);
      setConfirmStop(false);
    }
  }

  const stopControl = confirmStop ? (
    <span data-testid="treasury-recurring-stop-confirm" className="flex flex-wrap items-center gap-2 text-xs">
      <span className="text-neutral-600 dark:text-neutral-400">
        {live ? "Stop it for good? Nobody votes on a stop." : "Withdraw this request?"}
      </span>
      <button
        type="button"
        data-testid="treasury-recurring-stop-yes"
        onClick={() => void send("stop")}
        disabled={busy !== null}
        className="font-medium text-red-700 hover:text-red-600 disabled:opacity-50 dark:text-red-300"
      >
        {busy === "stop" ? "Stopping…" : live ? "Yes, stop" : "Yes, withdraw"}
      </button>
      <button
        type="button"
        onClick={() => setConfirmStop(false)}
        disabled={busy !== null}
        className="text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200"
      >
        Keep it
      </button>
    </span>
  ) : (
    <button
      type="button"
      data-testid="treasury-recurring-stop"
      onClick={() => setConfirmStop(true)}
      disabled={busy !== null}
      className="text-xs text-neutral-500 underline-offset-2 hover:text-red-700 hover:underline disabled:opacity-50 dark:text-neutral-400 dark:hover:text-red-300"
    >
      {live ? "Stop recurring buy" : "Withdraw request"}
    </button>
  );

  const messageLine = message && (
    <div role="status" data-testid="treasury-recurring-result" className={`mt-2 rounded-md border px-3 py-2 text-xs ${toneClass[message.tone]}`}>
      {message.text}
      {message.txUrl && (
        <>
          {" · tx "}
          <a href={message.txUrl} target="_blank" rel="noreferrer" className="font-mono underline decoration-dotted underline-offset-2">
            {txOf(message.txUrl)}
          </a>
        </>
      )}
    </div>
  );

  return (
    <>
      {/* with an authority in force a stop hits that one first, so the waiting request offers none */}
      {pending && (
        <PendingCard roomId={roomId} status={status} pending={pending} stopControl={live ? null : stopControl} />
      )}

      {live && (
        <div data-testid="treasury-recurring-live" className="mt-3 rounded-md border border-neutral-200 px-3 py-2.5 dark:border-neutral-700">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3">
            <span className="font-medium text-neutral-900 dark:text-neutral-100">
              🔁 Recurring buy · {usd(live.weeklyUsd)} of ETH weekly · week {live.weekIndex} of {live.weeks}
            </span>
            <span
              data-testid="treasury-recurring-this-week"
              className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                live.thisWeek === "bought"
                  ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-200"
                  : "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"
              }`}
            >
              {THIS_WEEK_COPY[live.thisWeek]}
            </span>
          </div>
          <div className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
            USDC → WETH on Uniswap v3, Base · approved by {live.approvedBy.join(", ") || "—"} ({live.approvals} of{" "}
            {live.required} verified humans) · terms <span className="font-mono">{live.digestShort}</span>
          </div>
          <p className="mt-1 italic text-neutral-600 dark:text-neutral-400">“{live.rule}”</p>

          <div data-testid="treasury-recurring-totals" className="mt-2 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-neutral-700 dark:text-neutral-300">
            <span title={`${tokens(live.usdcIn)} USDC paid on Base`}>Invested {usd(live.investedUsd)}</span>
            <span>{tokens(live.wethOut)} WETH accumulated</span>
            <span>Avg. entry {live.avgPriceUsdcPerEth === null ? "—" : `${usd(live.avgPriceUsdcPerEth)} / ETH`}</span>
            {live.nextRunAt && <span className="text-neutral-500 dark:text-neutral-400">Next buy {day(live.nextRunAt)}</span>}
          </div>

          {recurring.history.length > 0 && (
            <ul data-testid="treasury-recurring-history" className="mt-2 space-y-0.5 text-xs">
              {recurring.history.slice(0, 3).map((h) => (
                <li
                  key={`${h.at}-${h.isoWeek}`}
                  className={h.outcome === "bought" ? "text-neutral-700 dark:text-neutral-300" : "text-neutral-400 dark:text-neutral-500"}
                >
                  {h.outcome === "bought"
                    ? `✅ ${h.isoWeek} · ${tokens(h.wethOut ?? "0")} WETH for ${tokens(h.usdcIn ?? "0")} USDC`
                    : `– ${h.isoWeek} skipped · ${h.reason ? SKIP_REASON_TEXT[h.reason] : "no reason recorded"}`}
                  {h.txUrl && (
                    <>
                      {" · tx "}
                      <a href={h.txUrl} target="_blank" rel="noreferrer" className={linkClass}>
                        {txOf(h.txUrl)}
                      </a>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}

          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <button
              type="button"
              data-testid="treasury-recurring-run"
              onClick={() => void send("run")}
              disabled={busy !== null || live.thisWeek === "bought"}
              className={buttonClass}
            >
              {busy === "run"
                ? recurring.realRuns
                  ? "Buying on Base…"
                  : "Rehearsing…"
                : live.thisWeek === "bought"
                  ? "Bought this week"
                  : "Buy this week's ETH"}
              {!recurring.realRuns && busy !== "run" && live.thisWeek !== "bought" && <span className="ml-1 text-xs opacity-70">(rehearsal)</span>}
            </button>
            {stopControl}
          </div>
          {messageLine}
        </div>
      )}
      {!live && messageLine}
    </>
  );
}

/**
 * A recurring buy waiting for approvals. Approving is the panel's own World ID
 * step-up for this action id; the card only states what is being authorised.
 */
function PendingCard({
  roomId,
  status,
  pending,
  stopControl,
}: {
  roomId: string;
  status: TreasuryStatus;
  pending: NonNullable<Recurring["pending"]>;
  stopControl: ReactNode | null;
}) {
  // the action row carries the viewer's canApprove and who approved; status.recurring carries the terms
  const action = status.actions.find((a) => a.id === pending.actionId);
  const got = pending.approvals;
  const pct = pending.required > 0 ? Math.min(100, (got / pending.required) * 100) : 100;
  const adopting = got >= pending.required;
  // the same key signs on Sepolia and Base; `invested` names it on Base when investing is on
  const agentAddress = status.invested?.address ?? status.address;
  return (
    <div data-testid="treasury-recurring-pending" className="mt-3 rounded-md border border-neutral-200 px-3 py-2.5 dark:border-neutral-700">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <span className="font-medium text-neutral-900 dark:text-neutral-100">
          🔁 Recurring buy · {usd(pending.weeklyUsd)} of ETH every week for {pending.weeks}{" "}
          {pending.weeks === 1 ? "week" : "weeks"}
        </span>
        <span className="text-xs text-neutral-500 dark:text-neutral-400">
          {action && <>requested by {action.requestedBy.displayName} · </>}
          {hoursLeft(pending.expiresAt)}
        </span>
      </div>
      <div className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
        A standing authority, not a payment: at most {usd(pending.exposureUsd)} in all · USDC → WETH on Uniswap v3,
        Base · from the agent&apos;s wallet
        {agentAddress && (
          <>
            {" "}
            <a
              href={`https://basescan.org/address/${agentAddress}`}
              target="_blank"
              rel="noreferrer"
              title={agentAddress}
              className={linkClass}
            >
              {short(agentAddress)}
            </a>
          </>
        )}
      </div>
      <p className="mt-1 italic text-neutral-600 dark:text-neutral-400">“{pending.rule}”</p>
      <div
        className="mt-2 h-1.5 overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={pending.required}
        aria-valuenow={got}
      >
        <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
        {got} of {pending.required} verified humans
        {action && action.approvals.length > 0 && <> · {action.approvals.map((p) => p.displayName).join(", ")}</>}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
        {adopting ? (
          <span className="text-xs font-medium text-emerald-700 dark:text-emerald-300">Adopting… this updates in a moment.</span>
        ) : !status.idpMode ? (
          <span className="text-xs text-neutral-500 dark:text-neutral-400">World ID for Agents is not configured</span>
        ) : action?.canApprove ? (
          <button
            type="button"
            data-testid="treasury-recurring-approve"
            onClick={() =>
              window.location.assign(
                `/api/auth/world/connect?action=${encodeURIComponent(pending.actionId)}&returnTo=${encodeURIComponent(
                  `/dm/${roomId}`
                )}`
              )
            }
            className={buttonClass}
          >
            🌍 Approve with World ID
            {status.idpMode === "mock" && <span className="ml-1 text-xs opacity-70">(mock IdP)</span>}
          </button>
        ) : (
          <span className="text-xs text-neutral-500 dark:text-neutral-400">
            {status.mySeated ? "Waiting for other verified members." : "Claim your vote to approve."}
          </span>
        )}
        {!adopting && stopControl}
      </div>
    </div>
  );
}
