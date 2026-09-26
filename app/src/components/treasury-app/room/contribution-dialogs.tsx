"use client";

/**
 * Starting and stopping a member's recurring contribution, from the member's own wallet on Base.
 * Start: pick the amount, the period and how many collections, then three calls — USDC lets Permit2
 * use the plan's total, Permit2 lets the contract draw it until the plan ends, the contract starts
 * the plan — and the agent collects the first period right away. Stop: the plan's own stop, and by
 * default the Permit2 allowance back to 0. Every amount is the plan's own; nothing is unlimited.
 */

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Check, CircleAlert, ExternalLink, Loader2, Minus, Plus, Wallet, X } from "lucide-react";
import { BaseError, ContractFunctionRevertedError, type Hex } from "viem";
import { useIntlLocale, useT } from "@/i18n/provider";
import type { T } from "@/i18n/translate";
import {
  CONTRIBUTION_CHAIN as C,
  contributionAbi,
  contributionPlanId,
  contributionSalt,
  permit2Abi,
  SALTS_PER_MEMBER,
  usdcAbi,
  type ContributionPlanView,
} from "@/lib/agent/treasury/contribution-plan";
import { ContributionWalletError, connectBase, failureText, mined, walletFailure, type BaseWallet } from "./contribution-wallet";
import { PERIODS, type PeriodKey } from "./contributions-model";
import { dateOnly, shortAddress, tokenAmount, usd } from "./room-model";
import styles from "./treasury-room.module.css";
import c from "./contributions.module.css";

const UINT160_MAX = (BigInt(1) << BigInt(160)) - BigInt(1);
/** an ERC-20 allowance this large was given without a limit, by another app — nothing to add for this plan */
const UNLIMITED = BigInt(1) << BigInt(255);
const AMOUNTS_USD = [10, 20, 50];
const MAX_COLLECTIONS = 52;

// ── the dialog frame ────────────────────────────────────────────────────────

function Dialog({ title, onClose, busy, children, footer, testId }: { title: string; onClose: () => void; busy: boolean; children: ReactNode; footer?: ReactNode; testId: string }) {
  const t = useT();
  const titleId = useId();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);
  return (
    <div
      className={c.overlay}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div className={c.dialog} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} ref={ref} data-testid={testId}>
        <div className={c.dialogHead}>
          <h2 className={c.dialogTitle} id={titleId}>
            {title}
          </h2>
          <button type="button" className={styles.iconButton} onClick={onClose} disabled={busy} aria-label={t("Close")}>
            <X size={16} aria-hidden />
          </button>
        </div>
        <div className={c.dialogBody}>{children}</div>
        {footer && <div className={c.dialogFoot}>{footer}</div>}
      </div>
    </div>
  );
}

// ── one wallet call, as a fixed-height row ──────────────────────────────────

type RowState = { kind: "idle" } | { kind: "wallet" } | { kind: "mining"; hash: Hex } | { kind: "done"; hash: Hex | null } | { kind: "failed"; why: string };

function StepRow({ n, title, state, onRetry, skippedNote }: { n: number; title: string; state: RowState; onRetry?: () => void; skippedNote: string }) {
  const t = useT();
  const icon =
    state.kind === "done" ? (
      <Check size={16} aria-hidden />
    ) : state.kind === "failed" ? (
      <CircleAlert size={16} aria-hidden />
    ) : state.kind === "wallet" || state.kind === "mining" ? (
      <Loader2 size={16} className={c.spin} aria-hidden />
    ) : (
      <span className={styles.num}>{n}</span>
    );
  const sub =
    state.kind === "wallet"
      ? t("Waiting for your wallet")
      : state.kind === "mining"
        ? t("Confirming on Base…")
        : state.kind === "done"
          ? state.hash
            ? null
            : skippedNote
          : state.kind === "failed"
            ? state.why
            : t("Not started");
  const hash = state.kind === "done" || state.kind === "mining" ? state.hash : null;
  return (
    <li className={`${c.step} ${c[`step_${state.kind}`] ?? ""}`} aria-live="polite">
      <span className={c.stepIcon}>{icon}</span>
      <span className={c.stepText}>
        <span className={c.stepTitle}>{title}</span>
        <span className={c.stepSub}>
          {hash ? (
            <a className={styles.explorerLink} href={`${C.explorer}/tx/${hash}`} target="_blank" rel="noreferrer">
              {state.kind === "mining" ? t("Confirming on Base…") : shortAddress(hash)}
              <ExternalLink size={12} aria-hidden />
            </a>
          ) : (
            sub
          )}
        </span>
      </span>
      {state.kind === "failed" && onRetry && (
        <button type="button" className={styles.btnGhost} onClick={onRetry}>
          {t("Try again")}
        </button>
      )}
    </li>
  );
}

/** A simulated call's revert, by the contract's error name. */
function revertName(err: unknown): string | null {
  if (!(err instanceof BaseError)) return null;
  const reverted = err.walk((e) => e instanceof ContractFunctionRevertedError);
  return reverted instanceof ContractFunctionRevertedError ? (reverted.data?.errorName ?? null) : null;
}

function startRefusal(t: T, name: string | null): string {
  if (name === "PlanExists") return t("You already started a plan in this relation from this wallet.");
  if (name === "BadPlan") return t("The contract refused this plan — check the amount and the end.");
  return t("The contract would refuse this plan.");
}

// ── start ───────────────────────────────────────────────────────────────────

const periodLabel = (t: T, key: PeriodKey) => (key === "weekly" ? t("Weekly") : key === "fortnightly" ? t("Every 2 weeks") : t("Monthly"));
const everyPhrase = (t: T, key: PeriodKey) => (key === "weekly" ? t("each week") : key === "fortnightly" ? t("every two weeks") : t("each month"));

const units = (usdAmount: number, usdcPerUsd: number) => BigInt(Math.round(usdAmount * usdcPerUsd * 1e6));
const whole = (u: bigint) => tokenAmount(Number(u) / 1e6);

interface Terms {
  amount: bigint;
  total: bigint;
  period: number;
  until: number;
  periodKey: PeriodKey;
}

export function StartContributionDialog({
  roomId,
  roomName,
  meId,
  pot,
  usdcPerUsd,
  now,
  onClose,
  onChanged,
}: {
  roomId: string;
  roomName: string;
  meId: string;
  pot: `0x${string}`;
  usdcPerUsd: number;
  /** when the page last read the treasury — the plan step's "Ends …" counts from it */
  now: number;
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const t = useT();
  const locale = useIntlLocale();
  const [step, setStep] = useState<"plan" | "wallet" | "done">("plan");
  const [amountUsd, setAmountUsd] = useState(20);
  const [custom, setCustom] = useState("");
  const [periodKey, setPeriodKey] = useState<PeriodKey>("weekly");
  const [count, setCount] = useState(3);
  const [terms, setTerms] = useState<Terms | null>(null);
  const [wallet, setWallet] = useState<BaseWallet | null>(null);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [rows, setRows] = useState<RowState[]>([{ kind: "idle" }, { kind: "idle" }, { kind: "idle" }]);
  const [running, setRunning] = useState(false);
  const [outcome, setOutcome] = useState<string | null>(null);
  /** the salt this plan starts with — chosen once connected, so the simulation, start and first collection agree */
  const saltRef = useRef<Hex | null>(null);

  const period = PERIODS.find((p) => p.key === periodKey)!.seconds;
  const customUsd = Number(custom);
  const chosenUsd = custom.trim() ? customUsd : amountUsd;
  const amount = Number.isFinite(chosenUsd) && chosenUsd > 0 ? units(chosenUsd, usdcPerUsd) : BigInt(0);
  const total = amount * BigInt(count);
  const endsAt = now + count * period * 1000;
  const setRow = (i: number, s: RowState) => setRows((prev) => prev.map((r, k) => (k === i ? s : r)));

  /** One of the three calls, from the member's wallet; null when the wallet already allows it. */
  const send = async (i: number, w: BaseWallet, x: Terms): Promise<Hex | null> => {
    if (i === 0) {
      // what Permit2 must be able to move for this contract: its live allowance here plus this plan's total
      const [held, expiration] = await w.client.readContract({ address: C.permit2, abi: permit2Abi, functionName: "allowance", args: [w.address, C.usdc, C.contract] });
      const needed = (expiration > Math.floor(Date.now() / 1000) ? held : BigInt(0)) + x.total;
      const now = await w.client.readContract({ address: C.usdc, abi: usdcAbi, functionName: "allowance", args: [w.address, C.permit2] });
      // already enough (or unlimited, from another app): nothing to send; else exactly what's needed, never more
      if (now >= needed || now >= UNLIMITED) return null;
      return w.wallet.writeContract({ address: C.usdc, abi: usdcAbi, functionName: "approve", args: [C.permit2, needed] });
    }
    if (i === 1) {
      const [held, expiration] = await w.client.readContract({ address: C.permit2, abi: permit2Abi, functionName: "allowance", args: [w.address, C.usdc, C.contract] });
      const live = expiration > Math.floor(Date.now() / 1000) ? held : BigInt(0);
      const amountAllowed = live + x.total > UINT160_MAX ? UINT160_MAX : live + x.total;
      return w.wallet.writeContract({ address: C.permit2, abi: permit2Abi, functionName: "approve", args: [C.usdc, C.contract, amountAllowed, Math.max(expiration, x.until)] });
    }
    await refusalOf(w, x);
    return w.wallet.writeContract({ address: C.contract, abi: contributionAbi, functionName: "start", args: startArgs(x) });
  };

  const saltOf = () => saltRef.current ?? contributionSalt(roomId, meId);
  const startArgs = (x: Terms) => [pot, C.usdc, x.amount, x.period, x.until, saltOf()] as const;

  /** The first of this member's salts that no plan into this pot uses: a stopped plan keeps its id, so starting again takes the next. */
  const freeSalt = async (w: BaseWallet): Promise<Hex> => {
    const [ids] = await w.client.readContract({ address: C.contract, abi: contributionAbi, functionName: "plansOf", args: [pot] });
    const taken = new Set(ids.map((id) => id.toLowerCase()));
    for (let n = 0; n < SALTS_PER_MEMBER; n++) {
      const salt = contributionSalt(roomId, meId, n);
      if (!taken.has(contributionPlanId(w.address, pot, C.usdc, salt).toLowerCase())) return salt;
    }
    throw new ContributionWalletError("other", t("This wallet has started {n} plans here already — start from another wallet.", { n: SALTS_PER_MEMBER }));
  };

  /** start() simulated from the member's wallet: it touches no tokens, so it can run before either approval. */
  const refusalOf = async (w: BaseWallet, x: Terms) => {
    try {
      await w.client.simulateContract({ account: w.address, address: C.contract, abi: contributionAbi, functionName: "start", args: startArgs(x) });
    } catch (err) {
      throw new ContributionWalletError("other", startRefusal(t, revertName(err)));
    }
  };

  const runFrom = async (from: number, w: BaseWallet, x: Terms) => {
    setRunning(true);
    try {
      for (let i = from; i < 3; i++) {
        setRow(i, { kind: "wallet" });
        try {
          const hash = await send(i, w, x);
          if (hash) {
            setRow(i, { kind: "mining", hash });
            await mined(w, hash);
          }
          setRow(i, { kind: "done", hash });
        } catch (err) {
          const f = err instanceof ContributionWalletError && err.kind === "other" && i === 2 ? err : walletFailure(err);
          setRow(i, { kind: "failed", why: f.kind === "other" && i === 2 ? f.message : failureText(t, f) });
          return;
        }
      }
      setStep("done");
      await collectFirst(w, x);
    } finally {
      setRunning(false);
    }
  };

  /** The agent collects the first period now; the page then shows it. */
  const collectFirst = async (w: BaseWallet, x: Terms) => {
    const id = contributionPlanId(w.address, pot, C.usdc, saltOf()).toLowerCase();
    try {
      // the plan's id: the server waits until its RPC sees the plan that was just started
      const res = await fetch(`/api/treasury/${encodeURIComponent(roomId)}/contributions/collect`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ planId: id }),
      });
      const body = (await res.json().catch(() => null)) as { collected?: { id: string }[]; notCollected?: { id: string; reason: string }[] } | null;
      const mine = body?.collected?.some((r) => r.id.toLowerCase() === id);
      const refused = body?.notCollected?.find((r) => r.id.toLowerCase() === id);
      setOutcome(
        mine
          ? t("Your first {amount} USDC is in the pot.", { amount: whole(x.amount) })
          : refused
            ? t("The first collection didn't go through: {why}", { why: refused.reason })
            : t("The agent collects it with the next run.")
      );
    } catch {
      setOutcome(t("The agent collects it with the next run."));
    }
    await onChanged();
  };

  /**
   * Connect (once), check the contract would take this plan, then send from the first call not done.
   * Both the first press and every Try again come here, so a retry never skips an approval.
   */
  const connectAndRun = async () => {
    if (!terms) return;
    setConnectError(null);
    setRows((prev) => prev.map((r) => (r.kind === "failed" ? { kind: "idle" } : r)));
    let w: BaseWallet;
    try {
      w = wallet ?? (await connectBase());
      setWallet(w);
    } catch (err) {
      setConnectError(failureText(t, walletFailure(err)));
      return;
    }
    // a plan the contract would refuse is named before either approval goes out
    try {
      saltRef.current ??= await freeSalt(w);
      await refusalOf(w, terms);
    } catch (err) {
      setRow(2, { kind: "failed", why: (err as Error).message });
      return;
    }
    const from = rows.findIndex((r) => r.kind !== "done");
    await runFrom(from < 0 ? 0 : from, w, terms);
  };

  const toWallet = () => {
    const until = Math.floor(Date.now() / 1000) + count * period;
    setTerms({ amount, total, period, until, periodKey });
    setStep("wallet");
  };

  const close = useCallback(() => {
    if (!running) onClose();
  }, [running, onClose]);

  const untilLabel = dateOnly(new Date(terms ? terms.until * 1000 : endsAt).toISOString(), locale);
  const titles = [
    t("Let Permit2 use {total} USDC", { total: whole(terms?.total ?? total) }),
    t("Let the contract draw up to {total} USDC until {date}", { total: whole(terms?.total ?? total), date: untilLabel }),
    t("Start the plan"),
  ];
  const failedAt = rows.findIndex((r) => r.kind === "failed");

  return (
    <Dialog
      title={step === "done" ? t("You're in") : t("Start recurring contribution")}
      onClose={close}
      busy={running}
      testId="contribution-start"
      footer={
        step === "plan" ? (
          <>
            <button type="button" className={styles.btnGhost} onClick={close}>
              {t("Cancel")}
            </button>
            <button type="button" className={styles.btnDark} onClick={toWallet} disabled={amount <= BigInt(0)} data-testid="contribution-continue">
              {t("Continue")}
            </button>
          </>
        ) : step === "wallet" ? (
          <>
            <button type="button" className={styles.btnGhost} onClick={() => setStep("plan")} disabled={running || rows.some((r) => r.kind === "done")}>
              {t("Back")}
            </button>
            <button type="button" className={styles.btnDark} onClick={() => void connectAndRun()} disabled={running || rows.some((r) => r.kind !== "idle")} aria-busy={running} data-testid="contribution-connect">
              <Wallet size={16} aria-hidden />
              {wallet ? t("Confirm in your wallet") : t("Connect wallet")}
            </button>
          </>
        ) : (
          <button type="button" className={styles.btnDark} onClick={onClose}>
            {t("Done")}
          </button>
        )
      }
    >
      {step === "plan" && (
        <div className={c.form}>
          <fieldset className={c.field}>
            <legend className={c.label}>{t("Amount each time")}</legend>
            <div className={c.chips}>
              {AMOUNTS_USD.map((v) => {
                const on = !custom.trim() && amountUsd === v;
                return (
                  <button key={v} type="button" className={`${c.amountChip} ${on ? c.amountChipOn : ""}`} aria-pressed={on} onClick={() => (setAmountUsd(v), setCustom(""))}>
                    <span className={styles.num}>{usd(v)}</span>
                    <span className={`${c.amountUsdc} ${styles.num}`}>{whole(units(v, usdcPerUsd))} USDC</span>
                  </button>
                );
              })}
              <label className={`${c.amountChip} ${custom.trim() ? c.amountChipOn : ""}`}>
                <span className={c.customRow}>
                  $
                  <input
                    className={`${c.customInput} ${styles.num}`}
                    inputMode="decimal"
                    placeholder={t("Other")}
                    value={custom}
                    onChange={(e) => setCustom(e.target.value.replace(/[^\d.]/g, ""))}
                    aria-label={t("Another amount, in dollars")}
                  />
                </span>
                <span className={`${c.amountUsdc} ${styles.num}`}>{custom.trim() && amount > BigInt(0) ? `${whole(amount)} USDC` : "USDC"}</span>
              </label>
            </div>
          </fieldset>
          <fieldset className={c.field}>
            <legend className={c.label}>{t("How often")}</legend>
            <div className={c.segmented} role="radiogroup">
              {PERIODS.map((p) => (
                <button key={p.key} type="button" role="radio" aria-checked={periodKey === p.key} className={`${c.segment} ${periodKey === p.key ? c.segmentOn : ""}`} onClick={() => setPeriodKey(p.key)}>
                  {periodLabel(t, p.key)}
                </button>
              ))}
            </div>
          </fieldset>
          <div className={c.field}>
            <span className={c.label} id="contribution-count">
              {t("How many times")}
            </span>
            <div className={c.stepperRow}>
              <div className={c.stepper} role="group" aria-labelledby="contribution-count">
                <button type="button" className={c.stepperBtn} onClick={() => setCount((n) => Math.max(1, n - 1))} disabled={count <= 1} aria-label={t("Fewer")}>
                  <Minus size={16} aria-hidden />
                </button>
                <span className={`${c.stepperValue} ${styles.num}`} aria-live="polite">
                  {count}
                </span>
                <button type="button" className={c.stepperBtn} onClick={() => setCount((n) => Math.min(MAX_COLLECTIONS, n + 1))} disabled={count >= MAX_COLLECTIONS} aria-label={t("More")}>
                  <Plus size={16} aria-hidden />
                </button>
              </div>
              <span className={c.stepperNote}>{t("Ends {date}", { date: dateOnly(new Date(endsAt).toISOString(), locale) })}</span>
            </div>
          </div>
          <p className={c.summary} data-testid="contribution-summary">
            {amount > BigInt(0)
              ? t("You allow exactly {total} USDC ({totalUsd}) in total — never more. The agent can collect at most {amount} USDC {every}, only into {room}'s pot, only until {date}. You can stop any time.", {
                  total: whole(total),
                  totalUsd: usd(chosenUsd * count),
                  amount: whole(amount),
                  every: everyPhrase(t, periodKey),
                  room: roomName,
                  date: dateOnly(new Date(endsAt).toISOString(), locale),
                })
              : t("Pick an amount.")}
          </p>
        </div>
      )}

      {step === "wallet" && (
        <div className={c.form}>
          <p className={c.walletLead}>
            {wallet
              ? t("Connected {wallet} · Base", { wallet: shortAddress(wallet.address) })
              : t("Three confirmations in your wallet on Base. Your wallet pays their gas, in ETH.")}
          </p>
          <ol className={c.steps}>
            {titles.map((title, i) => (
              <StepRow
                key={i}
                n={i + 1}
                title={title}
                state={rows[i]}
                skippedNote={t("Already allowed")}
                onRetry={i === failedAt && !running ? () => void connectAndRun() : undefined}
              />
            ))}
          </ol>
          <p className={styles.errorLine} role="alert">
            {connectError ?? " "}
          </p>
        </div>
      )}

      {step === "done" && (
        <div className={c.form}>
          <p className={c.doneLine}>
            <span className={c.doneIcon}>
              <Check size={18} aria-hidden />
            </span>
            {terms && t("{amount} USDC {every} until {date}, from your wallet into {room}'s pot.", { amount: whole(terms.amount), every: everyPhrase(t, terms.periodKey), date: untilLabel, room: roomName })}
          </p>
          <p className={c.walletLead} aria-live="polite">
            {outcome ?? (
              <span className={c.pendingLine}>
                <Loader2 size={14} className={c.spin} aria-hidden />
                {t("Collecting the first one…")}
              </span>
            )}
          </p>
        </div>
      )}
    </Dialog>
  );
}

// ── stop ────────────────────────────────────────────────────────────────────

export function StopContributionDialog({ plan, collectedUsd, onClose, onChanged }: { plan: ContributionPlanView; collectedUsd: number; onClose: () => void; onChanged: () => Promise<void> }) {
  const t = useT();
  const [revoke, setRevoke] = useState(true);
  const [rows, setRows] = useState<RowState[]>([{ kind: "idle" }, { kind: "idle" }]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const setRow = (i: number, s: RowState) => setRows((prev) => prev.map((r, k) => (k === i ? s : r)));
  const done = rows[0].kind === "done" && (!revoke || rows[1].kind === "done");

  const run = async () => {
    setError(null);
    setRunning(true);
    try {
      const w = await connectBase();
      if (w.address.toLowerCase() !== plan.member.toLowerCase()) {
        setError(t("Connect the wallet that started this plan ({wallet}).", { wallet: shortAddress(plan.member) }));
        return;
      }
      const calls: (() => Promise<Hex>)[] = [
        () => w.wallet.writeContract({ address: C.contract, abi: contributionAbi, functionName: "stop", args: [plan.id] }),
        () => w.wallet.writeContract({ address: C.permit2, abi: permit2Abi, functionName: "approve", args: [C.usdc, C.contract, BigInt(0), 0] }),
      ];
      for (let i = 0; i < (revoke ? 2 : 1); i++) {
        if (rows[i].kind === "done") continue;
        setRow(i, { kind: "wallet" });
        try {
          const hash = await calls[i]();
          setRow(i, { kind: "mining", hash });
          await mined(w, hash);
          setRow(i, { kind: "done", hash });
        } catch (err) {
          setRow(i, { kind: "failed", why: failureText(t, walletFailure(err)) });
          return;
        }
      }
      await onChanged();
    } catch (err) {
      setError(failureText(t, walletFailure(err)));
    } finally {
      setRunning(false);
    }
  };

  const started = rows.some((r) => r.kind !== "idle");
  return (
    <Dialog
      title={done ? t("Stopped") : t("Stop your recurring contribution?")}
      onClose={() => !running && onClose()}
      busy={running}
      testId="contribution-stop"
      footer={
        done ? (
          <button type="button" className={styles.btnDark} onClick={onClose}>
            {t("Done")}
          </button>
        ) : (
          <>
            <button type="button" className={styles.btnGhost} onClick={onClose} disabled={running}>
              {t("Keep contributing")}
            </button>
            <button type="button" className={styles.btnDanger} onClick={() => void run()} disabled={running} aria-busy={running} data-testid="contribution-stop-confirm">
              {running ? t("Stopping…") : started ? t("Try again") : t("Stop contribution")}
            </button>
          </>
        )
      }
    >
      <div className={c.form}>
        <p className={c.walletLead}>
          {done
            ? t("Nothing more will be collected. What came in stays in the pot.")
            : t("The agent won't collect again. The {amount} already collected stays in the pot.", { amount: usd(collectedUsd) })}
        </p>
        {!started && (
          <label className={c.check}>
            <input type="checkbox" checked={revoke} onChange={(e) => setRevoke(e.target.checked)} />
            <span>{t("Also set my Permit2 allowance to 0")}</span>
          </label>
        )}
        {started && (
          <ol className={c.steps}>
            <StepRow n={1} title={t("Stop the plan")} state={rows[0]} skippedNote="" />
            {revoke && <StepRow n={2} title={t("Set the Permit2 allowance to 0")} state={rows[1]} skippedNote="" />}
          </ol>
        )}
        <p className={styles.errorLine} role="alert">
          {error ?? " "}
        </p>
      </div>
    </Dialog>
  );
}
