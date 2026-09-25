"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { ChevronRight, X } from "lucide-react";
import type { RpContext } from "@worldcoin/idkit";
import type { TreasuryStatus } from "@/lib/agent/treasury/types";

const WORLD_ID_APP_ID = process.env.NEXT_PUBLIC_WORLD_ID_APP_ID ?? "";
// The treasury wallet is a Sepolia account regardless of where the relation
// registry lives, so this explorer is fixed.
const EXPLORER = "https://sepolia.etherscan.io";
const POLL_MS = 4000;

/** Only pulled into the bundle when a portal app_id is configured. */
const WorldIdButton = dynamic(
  () => import("@/components/dm/world-id-button").then((m) => m.WorldIdButton),
  { ssr: false }
);

type Action = TreasuryStatus["actions"][number];
type Tone = "ok" | "bad" | "info";

/**
 * What the OIDC callback / seat routes report back via ?treasury= / ?world=.
 * The codes mirror ApprovalResult reasons plus the IdP round-trip outcomes.
 */
const RESULT_COPY: Record<string, { tone: Tone; text: string }> = {
  executed: { tone: "ok", text: "Quorum reached — the agent executed the payment on Sepolia." },
  approved: { tone: "ok", text: "Your approval was recorded with a fresh World ID verification." },
  verified: { tone: "ok", text: "World ID is now linked to your account." },
  mismatch: { tone: "bad", text: "This account is already linked to a different World ID — nothing was changed." },
  cancelled: { tone: "bad", text: "You cancelled the World ID verification — nothing was approved." },
  "same-human": {
    tone: "bad",
    text: "This World ID already vouches for another account — one human, one vote. Nothing was added.",
  },
  "stale-proof": {
    tone: "bad",
    text: "That verification was older than the request. An approval needs a fresh World ID check made after the action was asked for.",
  },
  "not-seated": { tone: "bad", text: "Claim your seat with World ID before approving treasury actions." },
  "account-switched": {
    tone: "bad",
    text: "The verification came back for a different account than the one that started it — nothing was approved.",
  },
  "not-allowed": {
    tone: "bad",
    text: "You can't approve this request — it isn't waiting for approvals, or you're not in this room. Nothing was approved.",
  },
  "requester-excluded": { tone: "bad", text: "Whoever asked for a payment can't also approve it." },
  "not-member": { tone: "bad", text: "Only members of this relation can approve its treasury actions." },
  "not-found": { tone: "bad", text: "That treasury action no longer exists." },
  "not-pending": { tone: "info", text: "This action is no longer waiting for approvals." },
  "already-approved": { tone: "info", text: "You already approved this action." },
  "verify-failed": { tone: "bad", text: "The World ID answer didn't check out — nothing was approved." },
  "bad-state": { tone: "bad", text: "That World ID sign-in expired or was already used — start again from the panel." },
  "idp-error": { tone: "bad", text: "World ID returned an error — nothing was approved. Try again." },
  unavailable: { tone: "bad", text: "World ID isn't reachable right now — nothing was approved." },
  error: { tone: "bad", text: "Something went wrong recording the approval — nothing was approved." },
};

const SAME_HUMAN_SEAT = "This human already holds a seat in this relation — one human, one seat.";

const usdFmt = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
function usd(n: number): string {
  return usdFmt.format(n);
}
/** "$180" for whole amounts, "$180.50" otherwise — for the one-line history. */
function usdShort(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: Number.isInteger(n) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(n);
}
function short(hex: string): string {
  return hex.length > 12 ? `${hex.slice(0, 6)}…${hex.slice(-4)}` : hex;
}
/** Memos are quoted as said ("send $700 to my wallet"); the panel is read by everyone. */
function memoOf(a: Action): string {
  const memo = a.memo.trim() || a.kind;
  return memo.replace(/\bmy\b/gi, `${a.requestedBy.displayName}'s`);
}
function newestFirst(a: Action, b: Action): number {
  return b.createdAt.localeCompare(a.createdAt);
}

/** Coming back from the IdP or a seat claim, the outcome rides on ?treasury= / ?world=. */
function readResultFromUrl(): { tone: Tone; text: string } | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  const treasury = params.get("treasury");
  const code = treasury ?? params.get("world");
  if (!code) return null;
  return RESULT_COPY[code] ?? { tone: "info", text: `${treasury ? "Treasury" : "World ID"}: ${code}` };
}

const toneClass: Record<Tone, string> = {
  ok: "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200",
  bad: "border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200",
  info: "border-neutral-200 bg-neutral-50 text-neutral-700 dark:border-neutral-700 dark:bg-neutral-800/60 dark:text-neutral-200",
};

/**
 * The relation's shared wallet, in the room. Everything shown here comes from
 * the server: the rules are the relation's memory doc, quorums are counted by
 * SQL, and a seat or an approval is only ever a World ID proof the server
 * checked — this panel never decides anything, it links to where trust is given.
 */
export function TreasuryPanel({ roomId }: { roomId: string }) {
  // Snapshots carry their room so a room switch never shows the previous
  // room's wallet, without resetting state inside an effect.
  const [snap, setSnap] = useState<{ roomId: string; status: TreasuryStatus | null } | null>(null);
  const [openOverride, setOpenOverride] = useState<boolean | null>(null);
  // Read during the first client render; nothing renders until the status
  // fetch lands, so this cannot diverge from the server HTML.
  const [result, setResult] = useState<{ tone: Tone; text: string } | null>(readResultFromUrl);
  const [claiming, setClaiming] = useState(false);
  const [seatErr, setSeatErr] = useState<{ roomId: string; sameHuman: boolean; text: string } | null>(null);
  const roomRef = useRef(roomId);
  const enabledRef = useRef(false);
  const status = snap?.roomId === roomId ? snap.status : null;
  const seatError = seatErr?.roomId === roomId ? seatErr : null;

  const refresh = useCallback(
    (): Promise<void> =>
      fetch(`/api/dm/rooms/${roomId}/treasury`, { cache: "no-store" })
        .then((res) => (res.ok ? (res.json() as Promise<TreasuryStatus>) : null))
        .then((next) => {
          if (roomRef.current !== roomId) return;
          enabledRef.current = Boolean(next?.enabled);
          setSnap({ roomId, status: next });
        })
        // transient network error: keep the last status rather than flicker
        .catch(() => {}),
    [roomId]
  );

  useEffect(() => {
    roomRef.current = roomId;
    enabledRef.current = false;
    void refresh();
    // rooms without a treasury are only re-checked on focus — no reason to
    // load the memory doc every few seconds for a panel that renders nothing
    const timer = setInterval(() => {
      if (enabledRef.current && !document.hidden) void refresh();
    }, POLL_MS);
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [roomId, refresh]);

  // The outcome was captured into state on first render; drop the params so a
  // reload does not replay it.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (!url.searchParams.has("treasury") && !url.searchParams.has("world")) return;
    url.searchParams.delete("treasury");
    url.searchParams.delete("world");
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }, []);

  // A fresh object per poll would make the IDKit widget see a new rp_context
  // every 4s; key it by content instead.
  const rpKey = status?.rpContext ? JSON.stringify(status.rpContext) : "";
  const rpContext = useMemo(() => (rpKey ? (JSON.parse(rpKey) as RpContext) : null), [rpKey]);

  const claimSeat = useCallback(
    async (proof: Record<string, unknown>) => {
      setClaiming(true);
      setSeatErr(null);
      try {
        const res = await fetch(`/api/dm/rooms/${roomId}/treasury/seat`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(proof),
        });
        const data = (await res.json().catch(() => ({}))) as {
          reason?: string;
          message?: string;
          error?: string;
        };
        if (!res.ok) {
          setSeatErr({
            roomId,
            sameHuman: res.status === 409 || data.reason === "same-human",
            text: data.message || data.error || `Seat claim failed (${res.status})`,
          });
        }
        await refresh();
      } catch (err) {
        setSeatErr({
          roomId,
          sameHuman: false,
          text: `Seat claim failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      } finally {
        setClaiming(false);
      }
    },
    [roomId, refresh]
  );

  if (!status?.enabled) return null;

  const pending = status.actions.filter((a) => a.status === "pending").sort(newestFirst);
  const history = status.actions
    .filter((a) => a.status !== "pending")
    .sort(newestFirst)
    .slice(0, 5);
  const open = openOverride ?? (pending.length > 0 || result !== null);
  const scaleNote = `${status.balanceEth ?? "?"} SepETH on Sepolia · disclosed demo scale $1 = ${new Intl.NumberFormat(
    "en-US",
    { maximumSignificantDigits: 3 }
  ).format(status.usdPerEth > 0 ? 1 / status.usdPerEth : 0)} SepETH`;

  return (
    <section
      data-testid="treasury-panel"
      className="mx-4 mt-3 rounded-lg border border-neutral-200 bg-white px-4 py-3 text-sm text-neutral-800 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-200"
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <button
          type="button"
          data-testid="treasury-toggle"
          onClick={() => setOpenOverride(!open)}
          aria-expanded={open}
          className="flex items-center gap-1.5 font-medium text-neutral-900 hover:text-neutral-600 dark:text-neutral-100 dark:hover:text-neutral-300"
        >
          <ChevronRight
            aria-hidden
            className={`h-4 w-4 shrink-0 text-neutral-400 transition-transform ${open ? "rotate-90" : ""}`}
          />
          <span aria-hidden>🏦</span>
          <span data-testid="treasury-balance">
            Shared treasury · {status.balanceUsd === null ? "—" : usd(status.balanceUsd)}
          </span>
        </button>
        {!open && pending.length > 0 && (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900/60 dark:text-amber-200">
            {pending.length} waiting for approval
          </span>
        )}
        <span className="ml-auto text-xs text-neutral-500 dark:text-neutral-400">
          <span title={scaleNote}>Sepolia · testnet scale</span>
          {status.address && (
            <>
              {" · "}
              <a
                href={`${EXPLORER}/address/${status.address}`}
                target="_blank"
                rel="noreferrer"
                title={`Agent wallet ${status.address}`}
                className="font-mono underline decoration-dotted underline-offset-2 hover:text-neutral-800 dark:hover:text-neutral-200"
              >
                {short(status.address)}
              </a>
            </>
          )}
        </span>
      </div>

      {result && (
        <div
          role="status"
          data-testid="treasury-result"
          className={`mt-2 flex items-start gap-2 rounded-md border px-3 py-2 ${toneClass[result.tone]}`}
        >
          <span className="flex-1">{result.text}</span>
          <button
            type="button"
            onClick={() => setResult(null)}
            aria-label="Dismiss"
            className="shrink-0 opacity-60 hover:opacity-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {open && (
        <>
          {(status.purpose || status.rulesPageId) && (
            <div className="mt-1.5 flex items-center gap-3 text-neutral-500 dark:text-neutral-400">
              <span className="min-w-0 flex-1 truncate" title={status.purpose}>
                {status.purpose}
              </span>
              {status.rulesPageId && (
                <Link
                  href={`/p/${status.rulesPageId}`}
                  data-testid="treasury-rules-link"
                  className="shrink-0 text-neutral-700 underline-offset-2 hover:underline dark:text-neutral-300"
                >
                  Rules (from our memory) →
                </Link>
              )}
            </div>
          )}

          <div className="mt-2 flex flex-wrap gap-1.5" data-testid="treasury-members">
            {status.members.map((m) => (
              <span
                key={m.userId}
                data-testid="treasury-member"
                title={m.seated ? `Seat claimed with World ID${m.seatLevel ? ` (${m.seatLevel})` : ""}` : "No seat yet"}
                className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${
                  m.seated
                    ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-200"
                    : "border-neutral-200 bg-neutral-50 text-neutral-600 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-400"
                }`}
              >
                {m.displayName}
                <span className="opacity-80">· {m.seated ? "🌍 seat" : "no seat"}</span>
                {m.worldVerified && (
                  <span className="font-medium text-emerald-700 dark:text-emerald-300">✓ World ID</span>
                )}
              </span>
            ))}
          </div>

          {!status.mySeated && (
            <div className="mt-3 rounded-md border border-dashed border-neutral-300 px-3 py-2 dark:border-neutral-700">
              <div className="text-neutral-700 dark:text-neutral-300">
                Claim your seat — prove you&apos;re a unique human. Only seated members can approve what
                the agent asks to spend.
              </div>
              {status.seatMode === "world-id" && WORLD_ID_APP_ID && rpContext ? (
                <WorldIdButton
                  appId={WORLD_ID_APP_ID}
                  action={status.seatAction}
                  signal={roomId}
                  rpContext={rpContext}
                  disabled={claiming}
                  onVerified={claimSeat}
                  label="🌍 Claim your seat with World ID"
                />
              ) : (
                <button
                  type="button"
                  data-testid="treasury-seat-claim"
                  onClick={() => void claimSeat({})}
                  disabled={claiming}
                  className="mt-2 rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-neutral-700 disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-white"
                >
                  {claiming ? "Verifying…" : "🌍 Claim your seat (World ID simulator)"}
                </button>
              )}
            </div>
          )}

          {seatError && (
            <div
              role="alert"
              data-testid="treasury-seat-error"
              className={`mt-2 rounded-md border px-3 py-2 ${toneClass.bad} ${seatError.sameHuman ? "font-medium" : ""}`}
            >
              {seatError.sameHuman ? (
                <>
                  <div>⛔ {SAME_HUMAN_SEAT}</div>
                  {seatError.text !== SAME_HUMAN_SEAT && (
                    <div className="mt-0.5 text-xs font-normal opacity-80">{seatError.text}</div>
                  )}
                </>
              ) : (
                seatError.text
              )}
            </div>
          )}

          {pending.map((a) => {
            const got = a.approvals.length;
            const pct = a.requiredApprovals > 0 ? Math.min(100, (got / a.requiredApprovals) * 100) : 100;
            return (
              <div
                key={a.id}
                data-testid="treasury-pending"
                className="mt-3 rounded-md border border-neutral-200 px-3 py-2.5 dark:border-neutral-700"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <span className="font-medium text-neutral-900 dark:text-neutral-100">
                    {usd(a.amountUsd)} · {memoOf(a)}
                  </span>
                  <span className="text-xs text-neutral-500 dark:text-neutral-400">
                    requested by {a.requestedBy.displayName}
                  </span>
                </div>
                <p className="mt-1 italic text-neutral-600 dark:text-neutral-400">“{a.ruleText}”</p>
                <div
                  className="mt-2 h-1.5 overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800"
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={a.requiredApprovals}
                  aria-valuenow={got}
                >
                  <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} />
                </div>
                <div className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
                  {got} / {a.requiredApprovals} verified humans
                  {got > 0 && <> · {a.approvals.map((p) => p.displayName).join(", ")}</>}
                </div>
                {!status.idpMode ? (
                  <div className="mt-2 text-xs text-neutral-500 dark:text-neutral-400">
                    World ID for Agents is not configured
                  </div>
                ) : a.canApprove ? (
                  <button
                    type="button"
                    data-testid="treasury-approve"
                    onClick={() =>
                      window.location.assign(
                        `/api/auth/world/connect?action=${encodeURIComponent(a.id)}&returnTo=${encodeURIComponent(
                          `/dm/${roomId}`
                        )}`
                      )
                    }
                    className="mt-2 rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-neutral-700 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-white"
                  >
                    🌍 Approve with World ID
                    {status.idpMode === "mock" && <span className="ml-1 text-xs opacity-70">(mock IdP)</span>}
                  </button>
                ) : (
                  <div className="mt-2 text-xs text-neutral-500 dark:text-neutral-400">
                    {status.mySeated ? "Waiting for other verified members." : "Claim your seat to approve."}
                  </div>
                )}
              </div>
            );
          })}

          {history.length > 0 && (
            <ul className="mt-3 space-y-1 border-t border-neutral-100 pt-2 text-xs dark:border-neutral-800" data-testid="treasury-history">
              {history.map((a) => (
                <li key={a.id} data-testid="treasury-history-item" className="leading-relaxed">
                  {a.status === "executed" && (
                    <span className="text-neutral-700 dark:text-neutral-300">
                      ✅ {usdShort(a.amountUsd)} · {memoOf(a)}
                      {a.txHash && (
                        <>
                          {" · tx "}
                          <a
                            href={`${EXPLORER}/tx/${a.txHash}`}
                            target="_blank"
                            rel="noreferrer"
                            className="font-mono text-emerald-700 underline decoration-dotted underline-offset-2 hover:text-emerald-600 dark:text-emerald-300"
                          >
                            {short(a.txHash)}
                          </a>
                        </>
                      )}
                    </span>
                  )}
                  {a.status === "blocked" && (
                    <span className="text-red-700 dark:text-red-300">
                      ⛔ {usdShort(a.amountUsd)} · {memoOf(a)} — <span className="italic">“{a.ruleText}”</span>
                    </span>
                  )}
                  {a.status === "failed" && (
                    <span className="text-red-700 dark:text-red-300">
                      ⚠️ {usdShort(a.amountUsd)} · {memoOf(a)} — {a.error || "the transfer failed"}
                    </span>
                  )}
                  {a.status === "cancelled" && (
                    <span className="text-neutral-500 dark:text-neutral-400">
                      ✖ {usdShort(a.amountUsd)} · {memoOf(a)} · cancelled
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
