"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { ChevronRight, X } from "lucide-react";
import type { RpContext } from "@worldcoin/idkit";
import type { TreasuryStatus } from "@/lib/agent/treasury/types";
import type { SeatClaimError, SeatEnvironment } from "@/components/treasury/seat-button";
import { RecurringBuyPanel } from "@/components/treasury/recurring-buy-panel";
import { UserAvatar } from "@/components/user-avatar";
import { ADOPTED_RESULT, TREASURY_RESULT, countedLine, isResultCode, resultCopy, type ResultCopy, type ResultTone } from "@/components/treasury/world-result-copy";
import { useT } from "@/i18n/provider";

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
type Member = TreasuryStatus["members"][number];
type Copy = ResultCopy;

/**
 * Who is looking and the members' faces. The status gains these for the demo;
 * until every server sends them the panel reads them as optional.
 */
type StatusView = TreasuryStatus & { viewerId?: string; roomName?: string };
function avatarOf(m: Member): string | null {
  return (m as Member & { avatarUrl?: string | null }).avatarUrl ?? null;
}

/**
 * What the OIDC callback / seat routes report back via ?treasury= / ?world=
 * lives in world-result-copy.ts — the /treasury page reads the same table.
 */
/** Said only by this panel after the server answered — never read from the URL. */
const LOCAL_COPY: Record<string, Copy> = {
  "vote-claimed": {
    tone: "ok",
    text: "🌍 Vote claimed — World ID confirmed you're a unique human. One human, one vote.",
  },
  "vote-claimed-dev": { tone: "info", text: "Vote claimed with the dev simulator — not a World ID proof." },
};
/**
 * A banner is kept as its code, not its text: "executing" becomes "executed"
 * once the action it is about (actionId, found from the status) is paid, and
 * goes away if that payment failed — the history line then says what happened.
 */
type Result = { key: "treasury" | "world" | "local"; code: string; actionId?: string };

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
/** Approval times are shown where the group is: the trip is in Tokyo. */
const tokyoClock = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Tokyo",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
function clock(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : tokyoClock.format(d);
}
function short(hex: string): string {
  return hex.length > 12 ? `${hex.slice(0, 6)}…${hex.slice(-4)}` : hex;
}
/** Memos are quoted as said ("send $700 to my wallet"); the panel is read by everyone. */
function memoOf(a: Action): string {
  const memo = a.memo.trim() || a.kind;
  return memo.replace(/\bmy\b/gi, `${a.requestedBy.displayName}'s`);
}
/** The history line's headline: a payment's amount and memo, or what a ratification adopts. */
function titleOf(a: Action, amount: (n: number) => string): string {
  if (a.kind === "recurring-buy") return `🔁 ${a.memo.replace(/^recurring buy/, "Recurring buy")}`;
  return a.kind === "ratify" ? `📜 Adopt ${a.memo}` : `${amount(a.amountUsd)} · ${memoOf(a)}`;
}
const FILLER = new Set(["the", "a", "an", "for", "to", "of", "our", "and", "pay", "send", "book"]);
function words(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^a-z0-9$']+/)
    .filter((w) => /[a-z]/.test(w) && !FILLER.has(w));
}
/**
 * A pending card's headline: "$150.00 to Hotel Gracery Shinjuku", with the
 * memo only when it says more than the payee's name ("(hotel deposit)").
 */
function pendingTitle(a: Action): string {
  if (a.kind === "ratify" || a.kind === "recurring-buy") return titleOf(a, usd);
  const label = a.recipient?.label;
  const memo = memoOf(a);
  if (!label) return `${usd(a.amountUsd)} · ${memo}`;
  const named = new Set(words(label));
  return words(memo).some((w) => !named.has(w))
    ? `${usd(a.amountUsd)} to ${label} (${memo})`
    : `${usd(a.amountUsd)} to ${label}`;
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
function humans(n: number): string {
  return `${n} more ${n === 1 ? "human" : "humans"}`;
}

/**
 * Coming back from the IdP or a seat claim, the outcome rides on ?treasury= /
 * ?world=. Only codes this panel knows are shown: the query string is anyone's
 * to write, and text echoed from it would read as the treasury speaking.
 */
function readResultFromUrl(): Result | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  const key = params.has("treasury") ? "treasury" : params.has("world") ? "world" : null;
  const code = key && params.get(key);
  return key && code && isResultCode(key, code) ? { key, code } : null;
}

/**
 * The action an "the agent is paying now" banner is about: the one holding the
 * newest approval by the viewer (by anyone, until the status names the viewer).
 */
function payingActionId(s: StatusView): string | undefined {
  let best: { id: string; at: string } | undefined;
  for (const a of s.actions) {
    if (a.requiredApprovals <= 0) continue;
    for (const p of a.approvals) {
      if (s.viewerId && p.userId !== s.viewerId) continue;
      if (!best || p.at > best.at) best = { id: a.id, at: p.at };
    }
  }
  return best?.id;
}

function bannerOf(r: Result | null, s: StatusView): Copy | null {
  if (!r) return null;
  if (r.key === "local") return LOCAL_COPY[r.code] ?? null;
  // an approval that counted: say where the request stands now
  if (r.code === "approved" && r.actionId) {
    const a = s.actions.find((x) => x.id === r.actionId);
    if (a && a.status === "pending" && a.approvals.length < a.requiredApprovals)
      return { tone: "ok", text: `${TREASURY_RESULT.approved.text} ${countedLine(a.approvals.length, a.requiredApprovals)}` };
  }
  const target = r.code === "executing" && r.actionId ? s.actions.find((a) => a.id === r.actionId) : undefined;
  if (target) {
    // the history line says how it ended; a green "paying now" above it would contradict it
    if (target.status === "failed" || target.status === "blocked" || target.status === "cancelled") return null;
    const done = target.status === "executed";
    if (target.kind === "ratify" || target.kind === "recurring-buy")
      return { tone: "ok", text: ADOPTED_RESULT[target.kind][done ? "executed" : "executing"] };
    if (done) return TREASURY_RESULT.executed;
  }
  return resultCopy(r.key, r.code);
}

/** "Bea (you)", and "Alex (2nd account, you)" rather than two brackets in a row. */
function youName(name: string): string {
  return /\)\s*$/.test(name) ? `${name.replace(/\)\s*$/, "")}, you)` : `${name} (you)`;
}

function chipTitle(m: Member): string {
  const lines = [
    !m.seated
      ? "No vote — a vote is claimed by proving you're a unique human with World ID"
      : m.seatLevel === "dev-simulator"
        ? "Vote claimed with the dev simulator — not a World ID proof"
        : `Vote claimed with World ID${m.seatLevel ? ` (${m.seatLevel})` : ""} — a unique human`,
  ];
  if (m.worldVerified) lines.push("✓ World ID — this account has passed a fresh World ID check");
  if (!m.voting) lines.push("Joined after our rules were adopted — votes once the group adopts them again");
  return lines.join("\n");
}

const toneClass: Record<ResultTone, string> = {
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
/** The room's agent, as the room lists it: the panel is that agent's, and says so in its header. */
export interface TreasuryPanelAgent {
  name: string;
  avatarUrl?: string | null;
}

export function TreasuryPanel({ roomId, agent = null }: { roomId: string; agent?: TreasuryPanelAgent | null }) {
  // Snapshots carry their room so a room switch never shows the previous
  // room's wallet, without resetting state inside an effect.
  const [snap, setSnap] = useState<{ roomId: string; status: StatusView | null } | null>(null);
  const [openOverride, setOpenOverride] = useState<boolean | null>(null);
  const t = useT();
  // Read during the first client render; nothing renders until the status
  // fetch lands, so this cannot diverge from the server HTML.
  const [result, setResult] = useState<Result | null>(readResultFromUrl);
  // the request a return from World ID is about, outlined for a moment and brought into view
  const [flashId, setFlashId] = useState<string | null>(null);
  const flashedRef = useRef<string | null>(null);
  const resultActionId = result?.key === "treasury" ? result.actionId : undefined;
  useEffect(() => {
    if (!resultActionId || flashedRef.current === resultActionId) return;
    flashedRef.current = resultActionId;
    setFlashId(resultActionId);
    document.querySelector(`[data-action-id="${CSS.escape(resultActionId)}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    const timer = window.setTimeout(() => setFlashId(null), 4000);
    return () => window.clearTimeout(timer);
  }, [resultActionId]);
  const [claiming, setClaiming] = useState(false);
  const [seatErr, setSeatErr] = useState<{ roomId: string; sameHuman: boolean; text: string } | null>(null);
  // IDKit's success screen outlives the claim: the claim box (and the widget
  // inside it) stays mounted until it closes, even though we are seated now
  const [holdClaim, setHoldClaim] = useState<string | null>(null);
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
      .then((res) => {
        if (res.ok) return res.json() as Promise<StatusView>;
        // a 5xx is the server mid-restart (a deploy swaps the container): keep
        // the last status and keep polling, rather than blank the panel until
        // the next successful read. A 4xx is an answer — no treasury, no access.
        if (res.status >= 500) throw new Error(`treasury status ${res.status}`);
        return null;
      })
      .then((next) => {
        if (roomRef.current !== roomId || seq < appliedRef.current) return;
        appliedRef.current = seq;
        enabledRef.current = Boolean(next?.enabled);
        setSnap({ roomId, status: next });
        // pin an "approved" / "paying now" banner to the action it is about, once it can be found
        if (next)
          setResult((r) => {
            if (!r || (r.code !== "executing" && r.code !== "approved") || r.key !== "treasury" || r.actionId) return r;
            const actionId = payingActionId(next);
            return actionId ? { ...r, actionId } : r;
          });
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
          level?: string;
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
        } else {
          // the chip turning into a vote must not fold the panel away on camera
          setOpenOverride(true);
          setResult({ key: "local", code: data.level === "dev-simulator" ? "vote-claimed-dev" : "vote-claimed" });
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
  // World ID 4.0: the server seated us while IDKit still shows its success screen
  const onSeated = useCallback(() => {
    setOpenOverride(true);
    setHoldClaim(roomId);
    setResult({ key: "local", code: "vote-claimed" });
    void refresh();
  }, [roomId, refresh]);
  const onClaimed = useCallback(() => {
    setHoldClaim(null);
    return refresh();
  }, [refresh]);

  if (!status?.enabled) return null;
  // The server reads NEXT_PUBLIC_WORLD_ID_APP_ID at runtime; this bundle has it
  // only if the image was built with it (deployment.md §4.9). Prefer the server's.
  const worldIdAppId = status.seatAppId ?? WORLD_ID_APP_ID;
  const viewerId = status.viewerId;
  const me = viewerId ? status.members.find((m) => m.userId === viewerId) : undefined;

  const pending = status.actions.filter((a) => a.status === "pending").sort(newestFirst);
  const history = status.actions
    .filter((a) => a.status !== "pending")
    .sort(newestFirst)
    .slice(0, 5);
  const banner = bannerOf(result, status);
  // someone without a vote sees how to get one without looking for it
  const open = openOverride ?? (pending.length > 0 || banner !== null || !status.mySeated);
  const showClaim = !status.mySeated || holdClaim === roomId;

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
          className="group flex items-center gap-1.5 text-neutral-900 dark:text-neutral-100"
        >
          <ChevronRight
            aria-hidden
            className={`h-4 w-4 shrink-0 text-neutral-400 transition-transform group-hover:text-neutral-600 ${open ? "rotate-90" : ""}`}
          />
          {agent ? (
            <span data-testid="treasury-agent" className="flex items-center gap-1.5" title={`${agent.name} holds this treasury and follows the rules the group adopted`}>
              <UserAvatar user={{ displayName: agent.name, avatarUrl: agent.avatarUrl ?? null }} size={20} />
              <span className="font-medium">{agent.name}</span>
              <span aria-hidden className="text-neutral-400">·</span>
            </span>
          ) : (
            <span aria-hidden>🏦</span>
          )}
          <span data-testid="treasury-balance" className="flex items-baseline gap-1.5">
            <span className="text-neutral-500 dark:text-neutral-400">Shared treasury</span>
            <span className="text-base font-semibold tabular-nums">
              {status.balanceUsd === null ? "—" : usd(status.balanceUsd)}
            </span>
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
        {/* the one way from the room to its Treasury page, beside the balance it opens */}
        <Link
          href={`/treasury/${roomId}`}
          data-testid="treasury-open-page"
          className="inline-flex h-7 shrink-0 items-center gap-0.5 whitespace-nowrap rounded-md border border-neutral-200 bg-white pl-2 pr-1 text-xs font-medium text-neutral-700 transition-colors hover:bg-neutral-50 hover:text-neutral-900 active:bg-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800 dark:hover:text-neutral-100 dark:active:bg-neutral-700"
        >
          {t("Open treasury")}
          <ChevronRight aria-hidden className="h-3.5 w-3.5 text-neutral-400" />
        </Link>
        {!open && pending.length > 0 && (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900/60 dark:text-amber-200">
            {pending.length} waiting for approval
          </span>
        )}
      </div>

      {banner && (
        <div
          role="status"
          data-testid="treasury-result"
          className={`mt-2 flex items-start gap-2 rounded-md border px-3 py-2 ${toneClass[banner.tone]}`}
        >
          <span className="flex-1">{banner.text}</span>
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
        // on a phone the open panel keeps to half the screen and scrolls inside, so the conversation stays in view
        // the wallet, its chain and the rules page live on the Treasury page; here
        // the room sees the agent, the pot, the votes and what waits for them
        <div data-testid="treasury-body" className="max-md:max-h-[50vh] max-md:overflow-y-auto max-md:overscroll-contain">
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

          <div className="mt-2.5 flex flex-wrap items-center gap-x-2.5 gap-y-2" data-testid="treasury-members">
            <span
              data-testid="treasury-votes-count"
              title="Members whose World ID vote counts, of everyone in the relation"
              className="mr-0.5 text-xs font-medium tabular-nums text-neutral-500 dark:text-neutral-400"
            >
              {status.members.filter((m) => m.seated && m.seatLevel !== "dev-simulator" && m.voting).length}/
              {status.members.length} votes
            </span>
            {status.members.map((m) => {
              // The ring around the face says where this member stands, by the
              // seat's own proof whatever mode the server runs: green, a World
              // ID vote that counts; red, a vote that does not count (a dev
              // simulator seat is not a World ID proof; a member who joined
              // after the adoption votes only once the group adopts them);
              // grey, no vote yet.
              const state = !m.seated ? "none" : m.seatLevel === "dev-simulator" || !m.voting ? "off" : "vote";
              const ring =
                state === "vote"
                  ? "ring-emerald-500"
                  : state === "off"
                    ? "ring-red-500"
                    : "ring-neutral-300 dark:ring-neutral-600";
              // the face is the whole chip; the name and the reason are the tooltip
              const name = m.userId === viewerId ? youName(m.displayName) : m.displayName;
              return (
                <span
                  key={m.userId}
                  data-testid="treasury-member"
                  data-vote={state}
                  title={`${name}\n${chipTitle(m)}`}
                  aria-label={name}
                  className={`inline-flex rounded-full ring-2 ring-offset-1 ring-offset-white dark:ring-offset-neutral-900 ${ring}`}
                >
                  <UserAvatar user={{ displayName: m.displayName, avatarUrl: avatarOf(m) }} size={24} />
                </span>
              );
            })}
          </div>

          {showClaim && (
            <div className="mt-3 rounded-md border border-dashed border-neutral-300 px-3 py-2 dark:border-neutral-700">
              <div className="text-neutral-700 dark:text-neutral-300">
                <span className="font-medium">Claim your vote</span>
                {" — once per member: World ID proves "}
                you&apos;re a unique human, so one person can&apos;t hold two votes. Only members with a vote can
                approve what the agent asks to spend.
              </div>
              {status.seatMode === "world-id-v4" ? (
                worldIdAppId.startsWith("app_") ? (
                  <SeatButton
                    roomId={roomId}
                    appId={worldIdAppId as `app_${string}`}
                    action={status.seatAction}
                    environment={status.seatEnvironment ?? WORLD_ID_ENV}
                    onSeated={onSeated}
                    onClaimed={onClaimed}
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

          {pending.filter((a) => a.id !== status.recurring?.pending?.actionId).map((a) => {
            const got = a.approvals.length;
            const need = a.requiredApprovals;
            // quorum met but still pending: the transfer and its gas refund are
            // in flight (tens of seconds), and nobody can approve it any more
            const paying = got >= need;
            const iApproved = Boolean(viewerId && a.approvals.some((p) => p.userId === viewerId));
            const left = hoursLeft(a.expiresAt);
            const progress = `${got} of ${need} verified humans`;
            return (
              <div
                key={a.id}
                data-testid="treasury-pending"
                data-action-id={a.id}
                className={`mt-3 rounded-lg border bg-white p-4 shadow-sm transition-shadow duration-500 dark:bg-neutral-900 ${
                  flashId === a.id
                    ? "border-emerald-300 ring-2 ring-emerald-300 dark:border-emerald-700 dark:ring-emerald-700"
                    : "border-neutral-200 dark:border-neutral-700"
                }`}
              >
                <div className="text-xl font-semibold tabular-nums text-neutral-900 dark:text-neutral-100">
                  {pendingTitle(a)}
                </div>
                <div className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
                  requested by {a.requestedBy.displayName}
                  {left && <> · {left}</>}
                  {a.recipient?.address && (
                    // approvers see where the money lands, not only the name it goes by
                    <>
                      {" · "}
                      {!a.recipient.label && "to "}
                      <a
                        data-testid="treasury-recipient"
                        href={`${EXPLORER}/address/${a.recipient.address}`}
                        target="_blank"
                        rel="noreferrer"
                        title={`${a.recipient.label ?? "Recipient"}: ${a.recipient.address}`}
                        className="font-mono underline decoration-dotted underline-offset-2 hover:text-neutral-800 dark:hover:text-neutral-200"
                      >
                        {short(a.recipient.address)}
                      </a>
                    </>
                  )}
                </div>
                {a.changes && (a.changes.added.length > 0 || a.changes.removed.length > 0 || a.changes.joined.length > 0) && (
                  <ul className="mt-2 space-y-0.5 font-mono text-xs text-neutral-600 dark:text-neutral-400">
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
                {a.ruleText && (
                  <p className="mt-3 border-l-2 border-neutral-300 pl-3 italic text-neutral-600 dark:border-neutral-600 dark:text-neutral-400">
                    “{a.ruleText}”
                  </p>
                )}
                {need > 0 && (
                  <div
                    data-testid="treasury-slots"
                    className="mt-3 flex flex-wrap items-center gap-2"
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={need}
                    aria-valuenow={Math.min(got, need)}
                    aria-valuetext={`${progress}${
                      got ? `: ${a.approvals.map((p) => `${p.displayName} at ${clock(p.at)}`).join(", ")}` : ""
                    }`}
                  >
                    {Array.from({ length: Math.max(need, got) }, (_, i) => {
                      const p = a.approvals[i];
                      return p ? (
                        <span
                          key={p.userId}
                          data-testid="treasury-slot-filled"
                          title={`${p.displayName} approved with a fresh World ID check at ${clock(p.at)} (Tokyo)`}
                          className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-sm font-medium text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-200"
                        >
                          ✓ {p.displayName} · <span className="tabular-nums">{clock(p.at)}</span>
                        </span>
                      ) : (
                        <span
                          key={`open-${i}`}
                          data-testid="treasury-slot-empty"
                          className="inline-flex items-center rounded-md border border-dashed border-neutral-300 px-2.5 py-1 text-sm text-neutral-400 dark:border-neutral-600 dark:text-neutral-500"
                        >
                          verified human
                        </span>
                      );
                    })}
                    <span className="ml-auto text-sm tabular-nums text-neutral-500 dark:text-neutral-400">{progress}</span>
                  </div>
                )}
                {paying ? (
                  <div
                    data-testid="treasury-paying"
                    className="mt-3 text-sm font-medium text-emerald-700 dark:text-emerald-300"
                  >
                    {a.kind === "ratify" || a.kind === "recurring-buy"
                      ? "Adopting… this updates in a moment."
                      : "Paying on Sepolia — usually about 40 seconds. This updates when the payment confirms."}
                  </div>
                ) : iApproved ? (
                  <div data-testid="treasury-you-approved" className="mt-3 text-sm text-emerald-700 dark:text-emerald-300">
                    ✓ You approved — waiting for {humans(need - got)}.
                  </div>
                ) : !status.mySeated ? (
                  <div data-testid="treasury-no-vote" className="mt-3 text-sm text-neutral-500 dark:text-neutral-400">
                    No vote on this account — only verified humans can approve.
                    {showClaim && " Claim your vote above first."}
                  </div>
                ) : me && !me.voting ? (
                  <div className="mt-3 text-sm text-neutral-500 dark:text-neutral-400">
                    You joined after our rules were adopted — your vote counts once the group adopts them again.
                  </div>
                ) : !status.idpMode ? (
                  <div className="mt-3 text-sm text-neutral-500 dark:text-neutral-400">
                    World ID for Agents is not configured
                  </div>
                ) : a.canApprove ? (
                  <div className="mt-3">
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
                      className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-neutral-700 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-white"
                    >
                      🌍 Approve with World ID
                    </button>
                    <div className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
                      Every approval gets its own check: World ID confirms a human is approving, right now.
                    </div>
                    {status.idpMode === "mock" && (
                      <div data-testid="treasury-mock-idp" className="mt-1 text-xs text-neutral-400 dark:text-neutral-500">
                        local mock IdP
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="mt-3 text-sm text-neutral-500 dark:text-neutral-400">
                    Waiting for other verified humans.
                  </div>
                )}
              </div>
            );
          })}

          <RecurringBuyPanel key={roomId} roomId={roomId} status={status} onChanged={refresh} />

          {history.length > 0 && (
            <ul className="mt-3 space-y-1 border-t border-neutral-100 pt-2 text-xs dark:border-neutral-800" data-testid="treasury-history">
              {history.map((a) => (
                <li key={a.id} data-testid="treasury-history-item" className="leading-relaxed">
                  {a.status === "executed" && a.kind === "ratify" && (
                    <span className="text-neutral-700 dark:text-neutral-300">📜 Adopted {a.memo}</span>
                  )}
                  {a.status === "executed" && a.kind === "recurring-buy" && (
                    <span className="text-neutral-700 dark:text-neutral-300">📌 Adopted {a.memo}</span>
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
                  {a.status === "executed" && a.kind !== "ratify" && a.kind !== "recurring-buy" && (
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
        </div>
      )}
    </section>
  );
}
