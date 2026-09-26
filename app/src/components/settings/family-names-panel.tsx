"use client";

// Settings › Workspace › Family names (docs/superpowers/plans/2026-09-26-ens-family-settings.md, Tasks 7, 7b).
// 1 the wallet check (family-wallet-section.tsx): a proven wallet that MetaMask is on, on Sepolia —
// nothing below acts as a wallet otherwise · 2 admin, no family → create form · 3 the create run's
// step list (resumable) · 4 the family: expiry banners, Renew, the tree canvas (members are added
// there) · 5 non-admins read only (the canvas without ghost cards).
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { formatEther, formatUnits, type Address } from "viem";
import { Check, ExternalLink, Loader2 } from "lucide-react";
import { useT } from "@/i18n/provider";
import type { T } from "@/i18n/translate";
import { useMe } from "@/stores/me";
import { USDC_DECIMALS } from "@/lib/ens-family/config";
import { checkLabel } from "@/lib/ens-family/labels";
import { NameTakenError, NotRenewableError, type TxStep } from "@/lib/ens-family/issue";
import { useInjectedAccount } from "@/lib/wallet/use-injected-account";
import {
  FamilyApiError,
  HOLD_KEY,
  LINK_KEY,
  clearRun,
  createStepKeys,
  graceSecondsLeft,
  loadRun,
  registerPrice,
  releaseHold,
  renewPrice,
  renewStepKeys,
  runCreateFamily,
  runRenew,
  sepoliaBalance,
  sepoliaReader,
  type CreateInput,
  type SavedRun,
} from "@/lib/wallet/ens-issue";
import { SettingsHeader, SettingsRow, SettingsSection } from "./settings-layout";
import {
  BTN,
  ENS_APP,
  INPUT,
  MUTED,
  PRIMARY,
  explain,
  short,
  txUrl,
  usdcText,
  useDebounced,
  yearsText,
  type Candidate,
  type TreeNode,
} from "./family-ui";
import { FamilyTreeCanvas } from "./family-tree-canvas";
import { WalletSection, shortAddress, walletGate } from "./family-wallet-section";

// ── shapes of GET /api/workspaces/[id]/ens ───────────────────────────────────────────────────────

interface Family {
  root: string;
  registry: string | null;
  expiresAt: string | null;
  inGrace: boolean;
  tree: TreeNode;
}
interface FamilyState {
  /** address: the proven wallet (null until a signature proves one); linked: the 0x address the account lists */
  me: { address: string | null; linked?: string | null; canEdit: boolean };
  family: Family | null;
  /** admins only: workspace members with a linked wallet who are not in the tree */
  candidates: Candidate[];
}
interface LabelAnswer {
  label: string;
  status: "free" | "taken" | "reserved" | "invalid";
  reason?: "empty" | "too-short" | "too-long" | "invalid";
  price?: { usdc: string; premiumUsdc: string };
  suggestions: string[];
}

const PERIODS = [1, 2, 5] as const;
const FAUCET = "https://cloud.google.com/application/web3/faucet/ethereum/sepolia";
/** Rough gas for the whole create run (3 proxy deploys, mint, approve, commit, register, a subname), with room to spare. */
const CREATE_GAS = BigInt(2_500_000);
const CREATE_APPROVALS = 8;
const DAY_MS = 86_400_000;
const BANNER_DAYS = 30;

const usdc = (micro: bigint, premium = BigInt(0)) => usdcText(formatUnits(micro, USDC_DECIMALS), formatUnits(premium, USDC_DECIMALS));
const ethLabelOf = (root: string) => /^([a-z0-9-]+)\.eth$/.exec(root)?.[1] ?? null;
const dateOf = (iso: string) => iso.slice(0, 10);

/** One row's text, from its stable key (issue.ts step keys + the two app steps). */
function stepLabel(key: string, t: T, years?: number): string {
  let m: RegExpExecArray | null;
  if (key === HOLD_KEY) return t("Hold the name in this app for 30 minutes");
  if (key === LINK_KEY) return t("Link the name to this workspace");
  if ((m = /^deploy-registry:(.+)$/.exec(key))) return t("Deploy the registry for names under {name}", { name: m[1] });
  if ((m = /^deploy-resolver:([^.]+)\.([^.]+)\.eth$/.exec(key))) return t("Deploy the records of {name}", { name: `${m[1]}.${m[2]}.eth` });
  if ((m = /^deploy-resolver:(.+)$/.exec(key))) return t("Deploy the family resolver for {name}", { name: m[1] });
  if (/:fee:mint$/.test(key)) return t("Get test USDC for the fee");
  if (/:fee:approve$/.test(key)) return t("Allow the fee");
  if ((m = /^eth:(.+):commit$/.exec(key))) return t("Reserve {name} (commit)", { name: `${m[1]}.eth` });
  if (/^eth:.+:wait$/.test(key)) return t("Wait a minute so nobody can snipe the name");
  if ((m = /^eth:(.+):register$/.exec(key))) return t("Register {name}", { name: `${m[1]}.eth` });
  if ((m = /^register:(.+)$/.exec(key))) return t("Register {name}", { name: m[1] });
  if ((m = /^renew:([^:]+)$/.exec(key))) return t("Renew {name} for {period}", { name: `${m[1]}.eth`, period: yearsText(years ?? 1, t) });
  return key;
}

/** fresh: re-read the tree from the chain (after an add), not the server's cached copy. */
async function fetchFamilyState(workspaceId: string, fresh = false): Promise<{ state: FamilyState } | { reason?: string; raw?: string }> {
  try {
    const res = await fetch(`/api/workspaces/${workspaceId}/ens${fresh ? "?fresh=1" : ""}`, { cache: "no-store" });
    const d = await res.json().catch(() => ({}));
    return res.ok ? { state: d as FamilyState } : { reason: d.reason, raw: typeof d.error === "string" ? d.error : `http-${res.status}` };
  } catch (err) {
    return { reason: "network", raw: String(err) };
  }
}

/** The load error as text: Sepolia or the server being unreachable is worth saying; anything else
 *  is a generic line (the server's English text goes to the console). */
function loadErrorText(r: { reason?: string; raw?: string }, t: T): string {
  if (r.reason === "chain-unavailable") return t("Could not reach Sepolia right now. Try again in a moment.");
  if (r.reason === "network") return t("Could not reach the server. Check your connection and try again.");
  console.warn("[family names] load failed:", r.reason, r.raw);
  return t("Couldn't load family names");
}

// ── the panel ────────────────────────────────────────────────────────────────────────────────────

export function FamilyNamesPanel({ workspaceId }: { workspaceId: string }) {
  const t = useT();
  const [state, setState] = useState<FamilyState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const apply = useCallback(
    (r: Awaited<ReturnType<typeof fetchFamilyState>>) => {
      if ("state" in r) {
        setLoadError(null);
        setState(r.state);
      } else setLoadError(loadErrorText(r, t));
    },
    [t]
  );
  const load = useCallback(async (fresh = false) => apply(await fetchFamilyState(workspaceId, fresh)), [apply, workspaceId]);

  useEffect(() => {
    let alive = true;
    fetchFamilyState(workspaceId).then((r) => alive && apply(r));
    return () => {
      alive = false;
    };
  }, [apply, workspaceId]);

  return (
    <>
      <SettingsHeader title={t("Family names")} subtitle={t("Names for your family on Ethereum (Sepolia ENS), like grandma.lee.eth")} />
      {!state && !loadError && (
        <div className={`flex items-center gap-2 ${MUTED}`}>
          <Loader2 size={14} className="animate-spin" /> {t("Loading…")}
        </div>
      )}
      {loadError && (
        <div className="flex items-center gap-2" data-testid="family-load-error">
          <span className="text-xs text-red-500">{loadError}</span>
          <button
            className={BTN}
            onClick={() => {
              setLoadError(null);
              void load();
            }}
          >
            {t("Try again")}
          </button>
        </div>
      )}
      {state && <PanelBody workspaceId={workspaceId} state={state} reload={load} />}
    </>
  );
}

function PanelBody({ workspaceId, state, reload }: { workspaceId: string; state: FamilyState; reload: (fresh?: boolean) => Promise<void> }) {
  const t = useT();
  const { me, family } = state;
  const live = useInjectedAccount();
  const gate = walletGate(me, live);
  // only a proven wallet that MetaMask is on, on Sepolia, is acted as (create, renew, add)
  const wallet = gate.kind === "ok" ? gate.wallet : null;
  return (
    <>
      <WalletSection gate={gate} onLinked={() => reload()} refresh={live.refresh} />
      {!family && wallet && me.canEdit && <CreateSection workspaceId={workspaceId} account={wallet} onCreated={() => reload()} />}
      {family && (
        <FamilySection
          workspaceId={workspaceId}
          family={family}
          wallet={wallet}
          canEdit={me.canEdit}
          candidates={state.candidates ?? []}
          onRenewed={() => reload()}
          onTreeChanged={() => reload(true)}
        />
      )}
      {!family && !me.canEdit && (
        <p className={MUTED} data-testid="family-none">
          {t("This workspace has no family name yet.")}
        </p>
      )}
      {!me.canEdit && (
        <p className={MUTED} data-testid="family-admin-only">
          {t("Only workspace admins can change family names.")}
        </p>
      )}
    </>
  );
}

// ── 2 + 3. create ────────────────────────────────────────────────────────────────────────────────

type Phase = "form" | "running" | "paused" | "taken";

function CreateSection({ workspaceId, account, onCreated }: { workspaceId: string; account: Address; onCreated: () => Promise<void> }) {
  const t = useT();
  const [saved] = useState<SavedRun | null>(() => loadRun(workspaceId));
  const [phase, setPhase] = useState<Phase>(saved ? "paused" : "form");
  const [input, setInput] = useState<CreateInput | null>(saved);
  const [steps, setSteps] = useState<Record<string, TxStep>>(() => Object.fromEntries((saved?.steps ?? []).map((s) => [s.key, s])));
  const [stopped, setStopped] = useState<string | null>(null);
  const [takenName, setTakenName] = useState<string | null>(null);
  const [heldElsewhere, setHeldElsewhere] = useState(false);
  const [waitUntil, setWaitUntil] = useState<number | null>(null);
  const [prefill, setPrefill] = useState<string>("");

  async function start(next: CreateInput) {
    setInput(next);
    setPhase("running");
    setStopped(null);
    try {
      await runCreateFamily({
        workspaceId,
        account,
        input: next,
        saved: loadRun(workspaceId),
        onStep: (s) => setSteps((prev) => ({ ...prev, [s.key]: s })),
        onWait: setWaitUntil,
      });
      await onCreated();
    } catch (err) {
      setWaitUntil(null);
      if (err instanceof FamilyApiError && err.reason === "exists") {
        // another session linked a family meanwhile: show it
        clearRun(workspaceId);
        await onCreated();
        return;
      }
      const reserveConflict = err instanceof FamilyApiError && (err.reason === "taken" || err.reason === "reserved");
      if (err instanceof NameTakenError || reserveConflict) {
        // nothing more is charged: the next paid step never ran
        clearRun(workspaceId);
        void releaseHold(workspaceId, next.label);
        setTakenName(`${next.label}.eth`);
        setHeldElsewhere(err instanceof FamilyApiError && err.reason === "reserved");
        setPrefill(next.label);
        setPhase("taken");
        return;
      }
      setStopped(explain(err, t, account).message);
      setPhase("paused");
    }
  }

  function cancel() {
    if (input) void releaseHold(workspaceId, input.label);
    clearRun(workspaceId);
    setSteps({});
    setStopped(null);
    setPrefill(input?.label ?? "");
    setPhase("form");
  }

  if (phase === "form" || phase === "taken") {
    return (
      <CreateForm
        key={prefill}
        workspaceId={workspaceId}
        account={account}
        initialLabel={prefill}
        takenName={phase === "taken" ? takenName : null}
        heldElsewhere={heldElsewhere}
        onCreate={(i) => void start(i)}
      />
    );
  }
  if (!input) return null;
  return (
    <SettingsSection title={t("Creating {name}", { name: `${input.label}.eth` })}>
      <StepList keys={createStepKeys(input)} steps={steps} running={phase === "running"} waitUntil={waitUntil} />
      {phase === "paused" && (
        <div className="flex flex-col gap-2" data-testid="family-run-paused">
          <span className={stopped ? "text-xs text-red-500" : MUTED} data-testid="family-run-message">
            {stopped ?? t("This run was interrupted. Press Continue to pick up where you left off.")}
          </span>
          <div className="flex items-center gap-2">
            <button data-testid="family-run-continue" className={PRIMARY} onClick={() => void start(input)}>
              {t("Continue")}
            </button>
            <button data-testid="family-run-cancel" className={BTN} onClick={cancel}>
              {t("Cancel")}
            </button>
          </div>
        </div>
      )}
    </SettingsSection>
  );
}

function CreateForm({
  workspaceId,
  account,
  initialLabel,
  takenName,
  heldElsewhere,
  onCreate,
}: {
  workspaceId: string;
  account: Address;
  initialLabel: string;
  takenName: string | null;
  heldElsewhere: boolean;
  onCreate: (input: CreateInput) => void;
}) {
  const t = useT();
  const me = useMe();
  const [raw, setRaw] = useState(initialLabel);
  const [years, setYears] = useState<number>(1);
  const [familyAlias, setFamilyAlias] = useState("");
  const [myLabelRaw, setMyLabelRaw] = useState("");
  const [myAlias, setMyAlias] = useState(me?.displayName ?? "");
  const [answer, setAnswer] = useState<LabelAnswer | null>(null);
  const [checking, setChecking] = useState(false);
  const [price, setPrice] = useState<{ label: string; years: number; micro: bigint; premium: bigint } | null>(null);
  const [funds, setFunds] = useState<{ have: bigint; need: bigint } | null>(null);

  const local = useMemo(() => checkLabel(raw, { min: 3 }), [raw]);
  const debounced = useDebounced(raw, 400);

  // live availability (debounced 400 ms). Invalid labels are refused here without a request,
  // except too-short ones, whose suggestions come from the registry.
  useEffect(() => {
    const c = checkLabel(debounced, { min: 3 });
    if (!c.ok && c.reason !== "too-short") return;
    if (!debounced.trim()) return;
    let alive = true;
    const run = async () => {
      setChecking(true);
      try {
        const res = await fetch(`/api/workspaces/${workspaceId}/ens?label=${encodeURIComponent(debounced)}`, { cache: "no-store" });
        const d = await res.json();
        if (alive && res.ok) setAnswer(d as LabelAnswer);
      } catch {
        if (alive) setAnswer(null);
      } finally {
        if (alive) setChecking(false);
      }
    };
    void run();
    return () => {
      alive = false;
    };
  }, [debounced, workspaceId]);

  const current = answer?.label === (local.ok ? local.label : raw.trim().toLowerCase()) ? answer : null;
  const free = current?.status === "free";

  // the fee for the chosen period, read from the registrar
  useEffect(() => {
    if (!free || !local.ok) return;
    let alive = true;
    registerPrice(local.label, years)
      .then(({ total, premium }) => alive && setPrice({ label: local.label, years, micro: total, premium }))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [free, local, years]);

  // Sepolia ETH on the wallet vs a rough ceiling for the whole run
  useEffect(() => {
    let alive = true;
    Promise.all([sepoliaBalance(account), sepoliaReader().getGasPrice()])
      .then(([have, gasPrice]) => alive && setFunds({ have, need: (gasPrice * CREATE_GAS * BigInt(5)) / BigInt(4) }))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [account]);

  const myLabel = checkLabel(myLabelRaw);
  const shownPrice = price && local.ok && price.label === local.label && price.years === years ? usdc(price.micro, price.premium) : null;
  const short_ = funds ? funds.have < funds.need : false;
  const ready = free && myLabel.ok && familyAlias.trim() !== "" && myAlias.trim() !== "" && !short_;

  return (
    <SettingsSection title={t("Create your family name")}>
      {takenName && (
        <p className="text-xs text-red-500" data-testid="family-taken-during-run">
          {heldElsewhere
            ? t("Someone in this app is registering this name right now")
            : t("{name} was just registered by someone else. Nothing more will be charged.", { name: takenName })}
        </p>
      )}
      <SettingsRow label={t("Family name")} description={t("A .eth name in the global ENS registry, 3 to 32 characters.")}>
        <div className="flex items-center gap-1">
          <input
            data-testid="family-label-input"
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            placeholder="lee"
            className={`${INPUT} w-40`}
            aria-label={t("Family name")}
          />
          <span className="text-sm text-neutral-500">.eth</span>
        </div>
        <LabelStatus raw={raw} local={local} answer={current} checking={checking || (local.ok && debounced !== raw)} onPick={setRaw} />
      </SettingsRow>
      <SettingsRow label={t("Registration period")} description={t("A .eth name expires. Renew it from this tab before then, or every name below it stops working.")}>
        <div className="flex items-center gap-1" role="radiogroup" aria-label={t("Registration period")}>
          {PERIODS.map((y) => (
            <button
              key={y}
              role="radio"
              aria-checked={years === y}
              data-testid={`family-years-${y}`}
              onClick={() => setYears(y)}
              className={`${BTN} ${years === y ? "bg-neutral-200/60 dark:bg-neutral-700" : ""}`}
            >
              {yearsText(y, t)}
            </button>
          ))}
        </div>
      </SettingsRow>
      <SettingsRow label={t("Family display name")} description={t("How the family is shown, e.g. The Lees.")}>
        <input data-testid="family-alias-input" value={familyAlias} onChange={(e) => setFamilyAlias(e.target.value)} placeholder="The Lees" className={`${INPUT} w-56`} />
      </SettingsRow>
      <SettingsRow label={t("Your name in the family")} description={t("You become the first person in the tree, e.g. grandma.lee.eth.")}>
        <div className="flex items-center gap-1">
          <input data-testid="family-my-label-input" value={myLabelRaw} onChange={(e) => setMyLabelRaw(e.target.value)} placeholder="grandma" className={`${INPUT} w-32`} aria-label={t("Your name in the family")} />
          {local.ok && <span className="text-sm text-neutral-500" data-testid="family-my-label-suffix">.{local.label}.eth</span>}
        </div>
        <input data-testid="family-my-alias-input" value={myAlias} onChange={(e) => setMyAlias(e.target.value)} placeholder={t("Display name")} className={`${INPUT} mt-2 w-56`} aria-label={t("Display name")} />
      </SettingsRow>
      <div className="flex flex-col gap-1 rounded-md bg-neutral-50 px-3 py-2 dark:bg-neutral-900" data-testid="family-summary">
        <span className="text-sm text-neutral-800 dark:text-neutral-200">
          {shownPrice
            ? t("{price} USDC (test) for {period}, minted for you on Sepolia", { price: shownPrice, period: yearsText(years, t) })
            : t("The fee shows once the name is available")}
        </span>
        <span className={MUTED}>
          {funds
            ? t("About {n} approvals in MetaMask and a 1-minute wait · you need ≈ {need} Sepolia ETH ({addr} has {have})", {
                n: CREATE_APPROVALS,
                need: Number(formatEther(funds.need)).toFixed(4),
                addr: shortAddress(account),
                have: Number(formatEther(funds.have)).toFixed(4),
              })
            : t("About {n} approvals in MetaMask and a 1-minute wait", { n: CREATE_APPROVALS })}
        </span>
        {short_ && (
          <a href={FAUCET} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-xs text-blue-600 hover:underline" data-testid="family-faucet">
            {t("Not enough Sepolia ETH — get some from a faucet")} <ExternalLink size={12} />
          </a>
        )}
        <span className={MUTED}>{t("Renew before it expires: it is one approval in MetaMask plus the yearly fee.")}</span>
      </div>
      <div className="flex items-center gap-2">
        <button
          data-testid="family-create"
          className={PRIMARY}
          disabled={!ready}
          onClick={() =>
            local.ok &&
            myLabel.ok &&
            onCreate({ label: local.label, years, familyAlias: familyAlias.trim(), myLabel: myLabel.label, myAlias: myAlias.trim() })
          }
        >
          {t("Create {name}", { name: local.ok ? `${local.label}.eth` : ".eth" })}
        </button>
        <span className={MUTED}>{t("Wallet {addr}", { addr: short(account) })}</span>
      </div>
    </SettingsSection>
  );
}

function LabelStatus({
  raw,
  local,
  answer,
  checking,
  onPick,
}: {
  raw: string;
  local: ReturnType<typeof checkLabel>;
  answer: LabelAnswer | null;
  checking: boolean;
  onPick: (label: string) => void;
}) {
  const t = useT();
  if (!raw.trim()) return null;
  const chips = (list: string[]) =>
    list.length > 0 && (
      <div className="mt-1 flex w-full flex-wrap justify-end gap-1" data-testid="family-suggestions">
        {list.map((s) => (
          <button key={s} className={`${BTN} h-6 text-xs`} onClick={() => onPick(s)}>
            {s}.eth
          </button>
        ))}
      </div>
    );
  let line: ReactNode;
  let suggestions: string[] = [];
  if (!local.ok) {
    const why = {
      empty: t("Type a name"),
      "too-short": t("A .eth name needs at least 3 characters"),
      "too-long": t("At most 32 characters"),
      invalid: t("Only a–z, 0–9 and inner hyphens"),
    }[local.reason];
    line = <span className="text-xs text-red-500">{why}</span>;
    if (local.reason === "too-short" && answer?.status === "invalid") suggestions = answer.suggestions;
  } else if (checking || !answer) {
    line = <span className={MUTED}>{t("Checking…")}</span>;
  } else if (answer.status === "free") {
    line = (
      <span className="text-xs text-green-700 dark:text-green-400">
        {t("✓ {name} is available · {price} USDC (test) / year", {
          name: `${answer.label}.eth`,
          price: answer.price ? usdcText(answer.price.usdc, answer.price.premiumUsdc) : "?",
        })}
      </span>
    );
  } else if (answer.status === "reserved") {
    line = <span className="text-xs text-amber-600">{t("Someone in this app is registering this name right now")}</span>;
    suggestions = answer.suggestions;
  } else {
    line = <span className="text-xs text-red-500">{t("{name} is taken", { name: `${answer.label}.eth` })}</span>;
    suggestions = answer.suggestions;
  }
  return (
    <div className="mt-1 flex w-full flex-col items-end text-right" data-testid="family-label-status" data-status={local.ok ? answer?.status ?? "checking" : "invalid"}>
      {line}
      {chips(suggestions)}
    </div>
  );
}

// ── step list (create and renew) ─────────────────────────────────────────────────────────────────

const DONE = new Set<TxStep["status"]>(["confirmed", "skipped", "simulated"]);

function StepList({ keys, steps, running, waitUntil, years }: { keys: string[]; steps: Record<string, TxStep>; running: boolean; waitUntil: number | null; years?: number }) {
  const t = useT();
  const active = running ? keys.find((k) => !steps[k] || !DONE.has(steps[k].status)) : undefined;
  const now = useNow(active !== undefined && steps[active]?.status === "waiting");
  return (
    <ol className="flex flex-col gap-2" data-testid="family-steps">
      {keys.map((k) => {
        const s = steps[k];
        const isApp = k === HOLD_KEY || k === LINK_KEY;
        let icon: ReactNode = <span className="h-2 w-2 rounded-full bg-neutral-300 dark:bg-neutral-600" />;
        let note: ReactNode = null;
        if (s && DONE.has(s.status)) {
          icon = <Check size={14} className={s.status === "skipped" ? "text-neutral-400" : "text-green-600"} />;
          if (s.status === "skipped") note = <span className={MUTED}>{t("Already done")}</span>;
        } else if (s?.status === "waiting") {
          icon = <Loader2 size={14} className="animate-spin text-blue-500" />;
          const left = waitUntil ? Math.max(0, waitUntil - Math.floor(now / 1000)) : null;
          note = <span className={MUTED}>{left !== null ? t("{s} s left", { s: left }) : t("Waiting…")}</span>;
        } else if (s?.status === "sent") {
          icon = <Loader2 size={14} className="animate-spin text-blue-500" />;
          note = <span className={MUTED}>{isApp ? t("Working…") : t("Waiting for the network…")}</span>;
        } else if (k === active) {
          icon = <Loader2 size={14} className="animate-spin text-blue-500" />;
          note = <span className="text-xs text-blue-600">{isApp ? t("Working…") : t("Approve in MetaMask…")}</span>;
        }
        return (
          <li key={k} data-testid="family-step" data-key={k} data-status={s?.status ?? (k === active ? "active" : "pending")} className="flex items-center gap-2 text-sm">
            <span className="flex h-4 w-4 shrink-0 items-center justify-center">{icon}</span>
            <span className={s?.status === "skipped" ? "text-neutral-400" : "text-neutral-800 dark:text-neutral-200"}>{stepLabel(k, t, years)}</span>
            {note}
            {s?.hash && (
              <a href={txUrl(s.hash)} target="_blank" rel="noreferrer" className="flex items-center gap-0.5 text-xs text-blue-600 hover:underline">
                Etherscan <ExternalLink size={11} />
              </a>
            )}
          </li>
        );
      })}
    </ol>
  );
}

/** Date.now(), re-read every second while `ticking`. */
function useNow(ticking: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!ticking) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [ticking]);
  return now;
}

// ── 4 + 5. the family ────────────────────────────────────────────────────────────────────────────

function FamilySection({
  workspaceId,
  family,
  wallet,
  canEdit,
  candidates,
  onRenewed,
  onTreeChanged,
}: {
  workspaceId: string;
  family: Family;
  wallet: Address | null;
  canEdit: boolean;
  candidates: Candidate[];
  onRenewed: () => Promise<void>;
  onTreeChanged: () => Promise<void>;
}) {
  const t = useT();
  const label = ethLabelOf(family.root);
  const renewable = label !== null;
  const [renewing, setRenewing] = useState(false);
  return (
    <>
      <ExpiryBanner family={family} label={label} />
      <SettingsSection title={t("Family")}>
        <div className="flex flex-wrap items-start justify-between gap-3" data-testid="family-header">
          <div className="flex flex-col gap-1">
            <span className="font-mono text-lg text-neutral-900 dark:text-neutral-100" data-testid="family-root">
              {family.root}
            </span>
            {family.expiresAt && <span className={MUTED}>{t("Expires {date}", { date: dateOf(family.expiresAt) })}</span>}
          </div>
          <div className="flex items-center gap-2">
            {renewable && wallet && !renewing && (
              <button data-testid="family-renew" className={BTN} onClick={() => setRenewing(true)}>
                {t("Renew")}
              </button>
            )}
            <a href={`${ENS_APP}/${family.root}`} target="_blank" rel="noreferrer" className={BTN} data-testid="family-ens-app">
              {t("Open in ENS app")} <ExternalLink size={12} />
            </a>
          </div>
        </div>
        {renewing && label && wallet && (
          <RenewForm
            label={label}
            wallet={wallet}
            onClose={() => setRenewing(false)}
            onDone={async () => {
              setRenewing(false);
              await onRenewed();
            }}
          />
        )}
      </SettingsSection>
      <SettingsSection title={t("Family tree")}>
        <FamilyTreeCanvas
          workspaceId={workspaceId}
          tree={family.tree}
          wallet={wallet}
          canEdit={canEdit}
          candidates={candidates}
          onChanged={onTreeChanged}
        />
      </SettingsSection>
    </>
  );
}

/** Review Focus 6: amber from 30 days before expiry, red in the grace period with the days left. */
function ExpiryBanner({ family, label }: { family: Family; label: string | null }) {
  const t = useT();
  const [graceDays, setGraceDays] = useState<number | null>(null);
  useEffect(() => {
    if (!family.inGrace || !label) return;
    let alive = true;
    graceSecondsLeft(label)
      .then((s) => alive && setGraceDays(Math.ceil(s / 86_400)))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [family.inGrace, label]);
  const [now] = useState(() => Date.now());
  // a mapped .eth root with no expiry is past its grace period: free again (Review Focus 6)
  if (!family.expiresAt && label) {
    return (
      <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300" data-testid="family-banner-free-again">
        {t("{name} is past its grace period and free again. Register it again to keep the family.", { name: family.root })}
      </div>
    );
  }
  if (!family.expiresAt) return null;
  if (family.inGrace) {
    return (
      <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300" data-testid="family-banner-grace">
        {graceDays !== null
          ? t("{name} has expired and names below it no longer resolve. Renew it within {n} days, or anyone can register it.", { name: family.root, n: graceDays })
          : t("{name} has expired and names below it no longer resolve. Renew it before the grace period ends.", { name: family.root })}
      </div>
    );
  }
  const days = (new Date(family.expiresAt).getTime() - now) / DAY_MS;
  if (days > BANNER_DAYS) return null;
  return (
    <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300" data-testid="family-banner-expiring">
      {t("{name} expires on {date} — renew it or every name below stops working.", { name: family.root, date: dateOf(family.expiresAt) })}
    </div>
  );
}

function RenewForm({ label, wallet, onClose, onDone }: { label: string; wallet: Address; onClose: () => void; onDone: () => Promise<void> }) {
  const t = useT();
  const [years, setYears] = useState<number>(1);
  const [price, setPrice] = useState<{ years: number; micro: bigint } | null>(null);
  const [running, setRunning] = useState(false);
  const [steps, setSteps] = useState<Record<string, TxStep>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [started, setStarted] = useState(false);

  useEffect(() => {
    let alive = true;
    renewPrice(label, years)
      .then((micro) => alive && setPrice({ years, micro }))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [label, years]);

  async function renew() {
    setStarted(true);
    setRunning(true);
    setMessage(null);
    try {
      await runRenew({ account: wallet, label, years, onStep: (s) => setSteps((p) => ({ ...p, [s.key]: s })) });
      await onDone();
    } catch (err) {
      if (err instanceof NotRenewableError) setMessage(t("{name} is past its grace period and free again. Register it again to keep the family.", { name: `${label}.eth` }));
      else setMessage(explain(err, t, wallet).message);
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border border-[rgba(28,19,1,0.11)] p-3 dark:border-neutral-600" data-testid="family-renew-form">
      <div className="flex flex-wrap items-center gap-2">
        {PERIODS.map((y) => (
          <button key={y} aria-pressed={years === y} disabled={running} onClick={() => setYears(y)} className={`${BTN} ${years === y ? "bg-neutral-200/60 dark:bg-neutral-700" : ""}`}>
            {yearsText(y, t)}
          </button>
        ))}
        <span className={MUTED}>
          {price && price.years === years ? t("{price} USDC (test)", { price: usdc(price.micro) }) : t("Checking…")} · {t("1–3 approvals in MetaMask")}
        </span>
      </div>
      {started && <StepList keys={renewStepKeys(label)} steps={steps} running={running} waitUntil={null} years={years} />}
      {message && <span className="text-xs text-red-500">{message}</span>}
      <div className="flex items-center gap-2">
        <button data-testid="family-renew-run" className={PRIMARY} disabled={running} onClick={() => void renew()}>
          {message ? t("Continue") : t("Renew {name}", { name: `${label}.eth` })}
        </button>
        <button className={BTN} disabled={running} onClick={onClose}>
          {t("Cancel")}
        </button>
      </div>
    </div>
  );
}
