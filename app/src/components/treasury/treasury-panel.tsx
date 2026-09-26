"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { ChevronRight, X } from "lucide-react";
import type { RpContext } from "@worldcoin/idkit";
import type { TreasuryStatus } from "@/lib/agent/treasury/types";
import type { SeatClaimError, SeatEnvironment } from "@/components/treasury/seat-button";

const WORLD_ID_APP_ID = process.env.NEXT_PUBLIC_WORLD_ID_APP_ID ?? "";
// Until the status reports seatEnvironment, fall back to the same variable the
// server reads; "staging" is what simulator.worldcoin.org answers.
const WORLD_ID_ENV: SeatEnvironment = (["production", "staging", "sandbox"] as const).find(
  (e) => e === process.env.NEXT_PUBLIC_WORLD_ID_ENV
) ?? "staging";
// The treasury wallet is a Sepolia account regardless of where the relation
// registry lives, so this explorer is fixed.
const EXPLORER = "https://sepolia.etherscan.io";
const POLL_MS = 4000;

/** Only pulled into the bundle when a portal app_id is configured. */
const WorldIdButton = dynamic(
  () => import("@/components/dm/world-id-button").then((m) => m.WorldIdButton),
  { ssr: false }
);
/** World ID 4.0 seat claim — likewise only loaded when the server runs it. */
const SeatButton = dynamic(() => import("@/components/treasury/seat-button").then((m) => m.SeatButton), {
  ssr: false,
});

type Action = TreasuryStatus["actions"][number];
type Tone = "ok" | "bad" | "info";

/**
 * What the OIDC callback / seat routes report back via ?treasury= / ?world=.
 * The codes mirror ApprovalResult reasons plus the IdP round-trip outcomes.
 */
const RESULT_COPY: Record<string, { tone: Tone; text: string }> = {
  executing: {
    tone: "ok",
    text: "Quorum reached — the agent is paying on Sepolia now. This updates when the payment confirms.",
  },
  executed: { tone: "ok", text: "Quorum reached — the agent executed the payment on Sepolia." },
  approved: { tone: "ok", text: "Your approval was recorded with a fresh World ID verification." },
  verified: { tone: "ok", text: "World ID is now linked to your account." },
  mismatch: { tone: "bad", text: "This account is already linked to a different World ID — nothing was changed." },
  cancelled: { tone: "bad", text: "You cancelled the World ID verification — nothing was approved." },
  "same-human": {
    tone: "bad",
    text: "This World ID already vouches for another account — one human, one vote. Nothing was added.",
  },
  "world-id-mismatch": {
    tone: "bad",
    text: "This account is already bound to a different World ID — verify with that one. Nothing was approved.",
  },
  "stale-proof": {
    tone: "bad",
    text: "That verification didn't show a fresh World ID sign-in made after the request was asked for. Nothing was approved.",
  },
  expired: { tone: "bad", text: "This request expired before enough verified members approved it — nothing was approved." },
  "not-electorate": {
    tone: "bad",
    text: "You joined after our rules were adopted — the relation has to adopt its new membership before your approval counts.",
  },
  "not-seated": { tone: "bad", text: "Claim your vote with World ID before approving treasury actions." },
  "account-switched": {
    tone: "bad",
    text: "The verification came back for a different account than the one that started it — nothing was approved.",
  },
  "not-allowed": {
    tone: "bad",
    text: "You can't approve this request — it isn't waiting for approvals, or you're not in this room. Nothing was approved.",
  },
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

const SAME_HUMAN_SEAT = "This human already has a vote in this relation — one human, one vote.";

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
/** The card's headline: a payment's amount and memo, or what a ratification adopts. */
function titleOf(a: Action, amount: (n: number) => string): string {
  return a.kind === "ratify" ? `📜 Adopt ${a.memo}` : `${amount(a.amountUsd)} · ${memoOf(a)}`;
}
function hoursLeft(iso: string | null): string | null {
  if (!iso) return null;
  const h = (new Date(iso).getTime() - Date.now()) / 3_600_000;
  if (h <= 0) return "expiring";
  return h < 1 ? `expires in ${Math.max(1, Math.round(h * 60))} min` : `expires in ${Math.round(h)} h`;
}
function newestFirst(a: Action, b: Action): number {
  return b.createdAt.localeCompare(a.createdAt);
}

/**
 * Coming back from the IdP or a seat claim, the outcome rides on ?treasury= /
 * ?world=. Only codes this panel knows are shown: the query string is anyone's
 * to write, and text echoed from it would read as the treasury speaking.
 */
function readResultFromUrl(): { tone: Tone; text: string } | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  const code = params.get("treasury") ?? params.get("world");
  return code && Object.prototype.hasOwnProperty.call(RESULT_COPY, code) ? RESULT_COPY[code] : null;
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
  // a slow status call must not pile up behind the timer, and an older
  // answer that lands late must not undo a newer one (a paid card flipping
  // back to "Paying…")
  const inFlightRef = useRef(false);
  const seqRef = useRef(0);
  const appliedRef = useRef(0);
  const status = snap?.roomId === roomId ? snap.status : null;
  const seatError = seatErr?.roomId === roomId ? seatErr : null;

  const refresh = useCallback((): Promise<void> => {
    const seq = ++seqRef.current;
    inFlightRef.current = true;
    return fetch(`/api/dm/rooms/${roomId}/treasury`, { cache: "no-store" })
      .then((res) => (res.ok ? (res.json() as Promise<TreasuryStatus>) : null))
      .then((next) => {
        if (roomRef.current !== roomId || seq < appliedRef.current) return;
        appliedRef.current = seq;
        enabledRef.current = Boolean(next?.enabled);
        setSnap({ roomId, status: next });
      })
      // transient network error: keep the last status rather than flicker
      .catch(() => {})
      .finally(() => {
        if (seq === seqRef.current) inFlightRef.current = false;
      });
  }, [roomId]);

  useEffect(() => {
    roomRef.current = roomId;
    enabledRef.current = false;
    void refresh();
    // rooms without a treasury are only re-checked on focus — no reason to
    // load the memory doc every few seconds for a panel that renders nothing
    const timer = setInterval(() => {
      if (enabledRef.current && !document.hidden && !inFlightRef.current) void refresh();
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
            text: data.message || data.error || `Claiming your vote failed (${res.status})`,
          });
        }
        await refresh();
      } catch (err) {
        setSeatErr({
          roomId,
          sameHuman: false,
          text: `Claiming your vote failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      } finally {
        setClaiming(false);
      }
    },
    [roomId, refresh]
  );

  const onSeatError = useCallback(
    (err: SeatClaimError | null) => setSeatErr(err && { roomId, ...err }),
    [roomId]
  );

  if (!status?.enabled) return null;
  // The server reads NEXT_PUBLIC_WORLD_ID_APP_ID at runtime; this bundle has it
  // only if the image was built with it (deployment.md §4.9). Prefer the server's.
  const worldIdAppId = status.seatAppId ?? WORLD_ID_APP_ID;

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
          {status.invested && Number(status.invested.weth) > 0 && (
            <span
              data-testid="treasury-invested"
              className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-200"
              title={`${status.invested.weth} WETH on Base, bought with idle funds on Uniswap v3 — priced through the same pool now`}
            >
              + {usd(status.invested.storyUsd)} invested
            </span>
          )}
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
          {!status.adoptedAt ? (
            <div data-testid="treasury-unadopted" className={`mt-2 rounded-md border px-3 py-2 text-xs ${toneClass.bad}`}>
              These rules were never adopted, so the agent moves no money yet. Ask it “@agent adopt the rules” to put
              them to a vote.
            </div>
          ) : (
            status.proposal && (
              <div data-testid="treasury-proposal" className={`mt-2 rounded-md border px-3 py-2 text-xs ${toneClass.info}`}>
                <div>
                  {status.proposal.added.length || status.proposal.removed.length || status.proposal.reordered
                    ? "Our memory doc has edits to the rules or payees nobody has adopted yet — the agent keeps following the adopted version."
                    : "New members don't vote until the relation adopts its membership."}{" "}
                  “@agent adopt the new rules” puts it to a vote.
                </div>
                {(status.proposal.added.length > 0 || status.proposal.removed.length > 0 || status.proposal.joined.length > 0) && (
                  <ul className="mt-1 space-y-0.5 font-mono">
                    {status.proposal.added.map((l) => (
                      <li key={`+${l}`}>+ {l}</li>
                    ))}
                    {status.proposal.removed.map((l) => (
                      <li key={`-${l}`}>− {l}</li>
                    ))}
                    {status.proposal.joined.map((n) => (
                      <li key={`j${n}`}>+ {n} (would vote)</li>
                    ))}
                  </ul>
                )}
              </div>
            )
          )}

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
                title={
                  !m.seated
                    ? "No vote yet"
                    : m.seatLevel === "dev-simulator"
                      ? "Vote claimed with the dev simulator — not a World ID proof"
                      : `Vote claimed with World ID${m.seatLevel ? ` (${m.seatLevel})` : ""}`
                }
                className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${
                  m.seated
                    ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-200"
                    : "border-neutral-200 bg-neutral-50 text-neutral-600 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-400"
                }`}
              >
                {m.displayName}
                {/* by the seat's own proof, whatever mode the server runs: a
                    simulator seat never shows as a World ID one on camera */}
                <span className="opacity-80">
                  · {!m.seated ? "no vote" : m.seatLevel === "dev-simulator" ? "dev vote" : "🌍 vote"}
                </span>
                {!m.voting && <span className="opacity-80">· joins at next adoption</span>}
                {m.worldVerified && (
                  <span className="font-medium text-emerald-700 dark:text-emerald-300">✓ World ID</span>
                )}
              </span>
            ))}
          </div>
          {(status.seatMode === "dev-simulator" || status.members.some((m) => m.seatLevel === "dev-simulator")) && (
            // on stage a seat chip must not pass for a World ID proof
            <div data-testid="treasury-seat-dev-note" className="mt-1 text-xs text-neutral-400 dark:text-neutral-500">
              “dev vote” = claimed with the dev simulator — not a World ID proof
            </div>
          )}

          {!status.mySeated && (
            <div className="mt-3 rounded-md border border-dashed border-neutral-300 px-3 py-2 dark:border-neutral-700">
              <div className="text-neutral-700 dark:text-neutral-300">
                Claim your vote — prove you&apos;re a unique human. Only members with a vote can approve
                what the agent asks to spend.
              </div>
              {status.seatMode === "world-id-v4" ? (
                worldIdAppId.startsWith("app_") ? (
                  <SeatButton
                    roomId={roomId}
                    appId={worldIdAppId as `app_${string}`}
                    action={status.seatAction}
                    environment={status.seatEnvironment ?? WORLD_ID_ENV}
                    onClaimed={refresh}
                    onError={onSeatError}
                  />
                ) : (
                  // NEXT_PUBLIC_* is inlined at build time: the server can have
                  // it while this bundle was built without it
                  <div className="mt-2 text-xs text-red-700 dark:text-red-300">
                    World ID isn&apos;t available in this build (NEXT_PUBLIC_WORLD_ID_APP_ID is missing).
                  </div>
                )
              ) : status.seatMode === "world-id" && worldIdAppId && rpContext ? (
                <WorldIdButton
                  appId={worldIdAppId}
                  action={status.seatAction}
                  signal={roomId}
                  rpContext={rpContext}
                  disabled={claiming}
                  onVerified={claimSeat}
                  label="🌍 Claim your vote with World ID"
                />
              ) : (
                <button
                  type="button"
                  data-testid="treasury-seat-claim"
                  onClick={() => void claimSeat({})}
                  disabled={claiming}
                  className="mt-2 rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-neutral-700 disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-white"
                >
                  {claiming ? "Verifying…" : "🌍 Claim your vote (dev simulator)"}
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
            // quorum met but still pending: the transfer and its gas refund are
            // in flight (tens of seconds), and nobody can approve it any more
            const paying = got >= a.requiredApprovals;
            return (
              <div
                key={a.id}
                data-testid="treasury-pending"
                className="mt-3 rounded-md border border-neutral-200 px-3 py-2.5 dark:border-neutral-700"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <span className="font-medium text-neutral-900 dark:text-neutral-100">{titleOf(a, usd)}</span>
                  <span className="text-xs text-neutral-500 dark:text-neutral-400">
                    requested by {a.requestedBy.displayName}
                    {hoursLeft(a.expiresAt) && <> · {hoursLeft(a.expiresAt)}</>}
                  </span>
                </div>
                {a.recipient?.address && (
                  // approvers see where the money lands, not only the name it goes by
                  <div data-testid="treasury-recipient" className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
                    to {a.recipient.label ?? "an address"} ·{" "}
                    <a
                      href={`${EXPLORER}/address/${a.recipient.address}`}
                      target="_blank"
                      rel="noreferrer"
                      title={a.recipient.address}
                      className="font-mono underline decoration-dotted underline-offset-2 hover:text-neutral-800 dark:hover:text-neutral-200"
                    >
                      {short(a.recipient.address)}
                    </a>
                  </div>
                )}
                {a.changes && (a.changes.added.length > 0 || a.changes.removed.length > 0 || a.changes.joined.length > 0) && (
                  <ul className="mt-1 space-y-0.5 font-mono text-xs text-neutral-600 dark:text-neutral-400">
                    {a.changes.added.map((l) => (
                      <li key={`+${l}`}>+ {l}</li>
                    ))}
                    {a.changes.removed.map((l) => (
                      <li key={`-${l}`}>− {l}</li>
                    ))}
                    {a.changes.joined.map((n) => (
                      <li key={`j${n}`}>+ {n} votes</li>
                    ))}
                  </ul>
                )}
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
                {paying ? (
                  <div
                    data-testid="treasury-paying"
                    className="mt-2 text-xs font-medium text-emerald-700 dark:text-emerald-300"
                  >
                    {a.kind === "ratify"
                      ? "Adopting… this updates in a moment."
                      : "Paying on Sepolia… this updates when the payment confirms."}
                  </div>
                ) : !status.idpMode ? (
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
                    {status.mySeated ? "Waiting for other verified members." : "Claim your vote to approve."}
                  </div>
                )}
              </div>
            );
          })}

          {history.length > 0 && (
            <ul className="mt-3 space-y-1 border-t border-neutral-100 pt-2 text-xs dark:border-neutral-800" data-testid="treasury-history">
              {history.map((a) => (
                <li key={a.id} data-testid="treasury-history-item" className="leading-relaxed">
                  {a.status === "executed" && a.kind === "ratify" && (
                    <span className="text-neutral-700 dark:text-neutral-300">📜 Adopted {a.memo}</span>
                  )}
                  {a.status === "unconfirmed" && (
                    <span className="text-amber-700 dark:text-amber-300">
                      ⏳ {usdShort(a.amountUsd)} · {memoOf(a)} — sent, not confirmed yet
                      {a.txHash && (
                        <>
                          {" · tx "}
                          <a
                            href={a.txUrl ?? `${EXPLORER}/tx/${a.txHash}`}
                            target="_blank"
                            rel="noreferrer"
                            className="font-mono underline decoration-dotted underline-offset-2"
                          >
                            {short(a.txHash)}
                          </a>
                        </>
                      )}{" "}
                      · don&apos;t ask again until it settles
                    </span>
                  )}
                  {a.status === "executed" && a.kind !== "ratify" && (
                    <span className="text-neutral-700 dark:text-neutral-300">
                      ✅ {usdShort(a.amountUsd)} · {memoOf(a)}
                      {a.txHash && (
                        <>
                          {" · tx "}
                          <a
                            href={a.txUrl ?? `${EXPLORER}/tx/${a.txHash}`}
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
                      ⛔ {titleOf(a, usdShort)} — <span className="italic">“{a.ruleText}”</span>
                    </span>
                  )}
                  {a.status === "failed" && (
                    <span className="text-red-700 dark:text-red-300">
                      ⚠️ {titleOf(a, usdShort)} — {a.error || "the transfer failed"}
                    </span>
                  )}
                  {a.status === "cancelled" && (
                    <span className="text-neutral-500 dark:text-neutral-400">
                      ✖ {titleOf(a, usdShort)} · {a.error || "cancelled"}
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
