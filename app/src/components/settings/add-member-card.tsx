"use client";

// The "+ Add a child" / "+ Add spouse" card of the family tree canvas
// (docs/superpowers/plans/2026-09-26-ens-family-settings.md, Task 7b, F8, F15). It opens into the form in
// place; after Add it stays where it is as a dotted pending card (ring n/N, the current step, the step
// list), turns solid when the last receipt is in and re-resolves its own name. A rejected approval
// leaves it dotted with "Cancelled · Continue"; a taken name goes back to the form with suggestions.
// A started add is kept in localStorage (ens-issue.ts loadAdd): after a reload it comes back dotted
// with "Interrupted · Continue", until it succeeds or is discarded.
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { isAddress, type Address } from "viem";
import { Check, ExternalLink, Loader2, Plus } from "lucide-react";
import { useT } from "@/i18n/provider";
import type { T } from "@/i18n/translate";
import { checkLabel } from "@/lib/ens-family/labels";
import { AddressInTreeError, NameTakenError, type TxStep } from "@/lib/ens-family/issue";
import { clearAdd, loadAdd, memberStepKeys, resolveName, runAddMember, type AddMemberInput, type SavedAdd } from "@/lib/wallet/ens-issue";
import { BTN, INPUT, MUTED, PRIMARY, displayOf, explain, short, txUrl, useDebounced, type Candidate, type TreeNode } from "./family-ui";
import { CARD_H, CARD_W, RelationBadge, WrappedName } from "./family-person-card";

export const FORM_W = 300;
/** How long the settled card shows its proof before the tree is re-read. */
const SETTLED_MS = 4000;

export type AddPhase = "ghost" | "form" | "running" | "stopped" | "settling" | "settled";

interface SubnameAnswer {
  label: string;
  status: "free" | "taken" | "invalid";
  suggestions: string[];
}

const DONE = new Set<TxStep["status"]>(["confirmed", "skipped", "simulated"]);

function stepText(key: string, t: T): string {
  let m: RegExpExecArray | null;
  if ((m = /^deploy-registry:(.+)$/.exec(key))) return t("Create the registry for names under {name}", { name: m[1] });
  if ((m = /^set-subregistry:(.+)$/.exec(key))) return t("Make room for names under {name}", { name: m[1] });
  if ((m = /^deploy-resolver:(.+)$/.exec(key))) return t("Create the records of {name}", { name: m[1] });
  if ((m = /^register:(.+)$/.exec(key))) return t("Register {name}", { name: m[1] });
  return key;
}

/** The line under the pending card's name: what is happening right now. */
function currentText(keys: string[], steps: Record<string, TxStep>, parentDisplay: string, t: T): string {
  const active = keys.find((k) => !steps[k] || !DONE.has(steps[k].status));
  if (!active) return t("Finishing…");
  const s = steps[active];
  if (s?.status === "sent") {
    if (/^(deploy-registry|set-subregistry):/.test(active)) return t("Creating {name}'s branch…", { name: parentDisplay });
    const m = /^(deploy-resolver|register):(.+)$/.exec(active);
    if (m?.[1] === "deploy-resolver") return t("Creating the records of {name}…", { name: m[2] });
    if (m) return t("Registering {name}…", { name: m[2] });
  }
  return t("Approve in MetaMask…");
}

export function AddMemberCard({
  workspaceId,
  account,
  kind,
  parent,
  parentRegistry,
  candidates,
  treeNodes,
  fluid,
  onPhase,
  onBranch,
  onDone,
}: {
  workspaceId: string;
  account: Address;
  kind: "child" | "spouse";
  /** the person the new member goes under */
  parent: TreeNode;
  /** the registry `parent` is registered in */
  parentRegistry: string;
  candidates: Candidate[];
  /** everyone in the tree (F15) */
  treeNodes: TreeNode[];
  /** list mode (< 640 px): take the row's width instead of a fixed card width */
  fluid?: boolean;
  onPhase: (phase: AddPhase) => void;
  /** the parent's card shows "branch" while its first child creates the branch */
  onBranch: (active: boolean) => void;
  /** the add went through: re-read the tree */
  onDone: () => Promise<void>;
}) {
  const t = useT();
  // an add this wallet started before a reload (a saved add from another account stays hidden)
  const [restored] = useState<SavedAdd | null>(() => {
    const saved = loadAdd(workspaceId, kind, parent.name);
    return saved && saved.account.toLowerCase() === account.toLowerCase() ? saved : null;
  });
  const [phase, setPhaseState] = useState<AddPhase>(restored ? "stopped" : "ghost");
  const [input, setInput] = useState<AddMemberInput | null>(restored?.input ?? null);
  const [steps, setSteps] = useState<Record<string, TxStep>>(() => Object.fromEntries((restored?.steps ?? []).map((x) => [x.key, x])));
  const [stop, setStop] = useState<{ message: string; rejected: boolean; interrupted?: boolean } | null>(
    restored ? { message: t("Interrupted"), rejected: false, interrupted: true } : null
  );
  const [takenLabel, setTakenLabel] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [resolved, setResolved] = useState<string | null>(null);
  const [showSteps, setShowSteps] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  // one run at a time: two quick clicks on Add/Continue must not open two MetaMask requests
  const busy = useRef(false);
  // tell the canvas about a restored pending card once (its edge turns blue and dashed); the canvas
  // makes a new onPhase every render, so the effect reads the latest one from a ref
  const onPhaseRef = useRef(onPhase);
  useEffect(() => {
    onPhaseRef.current = onPhase;
  });
  const announced = useRef(!restored);
  useEffect(() => {
    if (announced.current) return;
    announced.current = true;
    onPhaseRef.current("stopped");
  }, []);

  const setPhase = (p: AddPhase) => {
    setPhaseState(p);
    onPhase(p);
  };
  const parentDisplay = displayOf(parent);

  function reset() {
    clearAdd(workspaceId, kind, parent.name);
    setInput(null);
    setSteps({});
    setStop(null);
    setTakenLabel(null);
    setFormError(null);
    setResolved(null);
    setShowSteps(false);
    setPhase("ghost");
  }

  async function run(next: AddMemberInput) {
    if (busy.current) return;
    busy.current = true;
    setInput(next);
    setStop(null);
    setFormError(null);
    setShowSteps(false);
    setPhase("running");
    if (!next.parentHasRegistry) onBranch(true);
    const name = `${next.label}.${next.parentName}`;
    try {
      await runAddMember({
        account,
        input: next,
        saveAs: { workspaceId, kind, steps: next === input ? Object.values(steps) : [] },
        onStep: (s) => {
          setSteps((p) => ({ ...p, [s.key]: s }));
          if (s.key.startsWith("set-subregistry:") && DONE.has(s.status)) onBranch(false);
        },
      });
      onBranch(false);
      setPhase("settling");
      const addr = await resolveName(name);
      setResolved(addr);
      setPhase("settled");
      // a failed refetch still resets the card (the next load shows the new name)
      setTimeout(() => void onDone().catch(() => undefined).then(reset), SETTLED_MS);
    } catch (err) {
      onBranch(false);
      if (err instanceof NameTakenError || err instanceof AddressInTreeError) clearAdd(workspaceId, kind, parent.name);
      if (err instanceof NameTakenError) {
        // back to the form: the label is marked taken and the suggestions come with the re-check
        setTakenLabel(next.label);
        setPhase("form");
        return;
      }
      if (err instanceof AddressInTreeError) {
        setFormError(t("{addr} already has a name in this family.", { addr: short(err.address) }));
        setPhase("form");
        return;
      }
      setStop(explain(err, t, account));
      setPhase("stopped");
    } finally {
      busy.current = false;
    }
  }

  const width = fluid ? undefined : phase === "form" ? FORM_W : CARD_W;
  // in the list layout several ghosts stack, so each says whose child or spouse it adds
  const ghostLong = kind === "child" ? t("Add a child of {name}", { name: parentDisplay }) : t("Add a spouse for {name}", { name: parentDisplay });

  if (phase === "ghost") {
    return (
      <div ref={ref} style={fluid ? undefined : { width: CARD_W }}>
        <button
          type="button"
          data-testid="family-ghost"
          data-kind={kind}
          data-parent={parent.name}
          onClick={() => setPhase("form")}
          aria-label={ghostLong}
          className="flex w-full items-center justify-center gap-1 rounded-lg border border-dashed border-neutral-300 text-sm text-neutral-400 transition-colors hover:border-neutral-400 hover:text-neutral-600 dark:border-neutral-600 dark:hover:text-neutral-300"
          style={{ height: fluid ? 44 : CARD_H }}
        >
          <Plus size={14} /> {fluid ? ghostLong : kind === "child" ? t("Add a child") : t("Add spouse")}
        </button>
      </div>
    );
  }

  if (phase === "form") {
    return (
      <div ref={ref} style={{ width }}>
        <AddForm
          workspaceId={workspaceId}
          kind={kind}
          parent={parent}
          parentRegistry={parentRegistry}
          candidates={candidates}
          treeNodes={treeNodes}
          initial={input}
          takenLabel={takenLabel}
          formError={formError}
          onCancel={reset}
          onAdd={(next) => void run(next)}
        />
      </div>
    );
  }

  // running · stopped · settling · settled — the card keeps its place
  if (!input) return null;
  const keys = memberStepKeys(input);
  const done = keys.filter((k) => steps[k] && DONE.has(steps[k].status)).length;
  const solid = phase === "settling" || phase === "settled";
  const name = `${input.label}.${input.parentName}`;
  let line: ReactNode;
  if (phase === "running") line = <span className="text-xs text-blue-600" data-testid="family-add-current">{currentText(keys, steps, parentDisplay, t)}</span>;
  else if (phase === "stopped" && stop)
    line = (
      <span className="flex flex-wrap items-center gap-1 text-xs" data-testid="family-add-message">
        <span className={stop.rejected || stop.interrupted ? "text-neutral-600 dark:text-neutral-300" : "text-red-500"}>{stop.rejected ? t("Cancelled") : stop.message}</span>
        <span className="text-neutral-400">·</span>
        <button type="button" data-testid="family-add-continue" className="text-blue-600 hover:underline" onClick={() => void run(input)}>
          {t("Continue")}
        </button>
        <button type="button" data-testid="family-add-discard" className="text-neutral-400 hover:underline" onClick={reset}>
          {t("Discard")}
        </button>
      </span>
    );
  else if (phase === "settling")
    line = (
      <span className={`flex items-center gap-1 ${MUTED}`}>
        <Loader2 size={12} className="animate-spin" /> {t("Resolving…")}
      </span>
    );
  else
    line = resolved ? (
      <span className="text-xs text-green-700 dark:text-green-400" data-testid="family-add-resolved">
        {t("✓ resolves to {addr}", { addr: short(resolved) })}
      </span>
    ) : (
      <span className="text-xs text-amber-600">{t("Registered — the name will resolve in a moment")}</span>
    );

  return (
    <div ref={ref} className="relative" style={{ width }}>
      <div
        data-testid="family-add-pending"
        data-phase={phase}
        className={`flex w-full flex-col items-start gap-0.5 rounded-lg border bg-white px-2.5 py-2 dark:bg-neutral-800 ${
          solid ? "border-solid border-green-500 motion-safe:animate-[pulse_600ms_ease-out_1]" : "border-dashed border-blue-400"
        }`}
        style={{ minHeight: CARD_H }}
      >
        <span className="flex w-full items-center gap-1">
          <span className="truncate text-[15px] font-semibold text-neutral-900 dark:text-neutral-100">{input.alias}</span>
          {solid ? (
            <Check size={13} className="shrink-0 text-green-600" />
          ) : (
            <button
              type="button"
              data-testid="family-add-ring"
              aria-label={t("Show the steps")}
              aria-expanded={showSteps}
              onClick={() => setShowSteps((v) => !v)}
              className="ml-auto flex items-center gap-1 rounded px-0.5 text-[11px] text-blue-700 hover:bg-blue-50 dark:text-blue-300 dark:hover:bg-blue-950"
            >
              <Ring done={done} total={keys.length} />
              {done}/{keys.length}
            </button>
          )}
        </span>
        <span className="line-clamp-2 break-words font-mono text-[11px] leading-[14px] text-neutral-500">
          <WrappedName name={name} />
        </span>
        <span className="flex items-center gap-1.5">
          <RelationBadge relation={input.relation} />
          <span className="font-mono text-[11px] text-neutral-400">{short(input.address)}</span>
        </span>
        {line}
      </div>
      {showSteps && !solid && <StepPopover keys={keys} steps={steps} running={phase === "running"} />}
    </div>
  );
}

function Ring({ done, total }: { done: number; total: number }) {
  const r = 6;
  const c = 2 * Math.PI * r;
  return (
    <svg width={16} height={16} viewBox="0 0 16 16" aria-hidden>
      <circle cx={8} cy={8} r={r} fill="none" stroke="currentColor" strokeOpacity={0.2} strokeWidth={2} />
      <circle cx={8} cy={8} r={r} fill="none" stroke="currentColor" strokeWidth={2} strokeDasharray={`${(c * done) / Math.max(total, 1)} ${c}`} transform="rotate(-90 8 8)" />
    </svg>
  );
}

function StepPopover({ keys, steps, running }: { keys: string[]; steps: Record<string, TxStep>; running: boolean }) {
  const t = useT();
  const active = running ? keys.find((k) => !steps[k] || !DONE.has(steps[k].status)) : undefined;
  return (
    <ol
      data-testid="family-add-steps"
      className="absolute left-0 top-full z-30 mt-1 flex w-72 flex-col gap-1.5 rounded-lg border border-[rgba(28,19,1,0.11)] bg-white p-3 shadow-lg dark:border-neutral-600 dark:bg-neutral-800"
    >
      {keys.map((k) => {
        const s = steps[k];
        let icon: ReactNode = <span className="h-2 w-2 rounded-full bg-neutral-300 dark:bg-neutral-600" />;
        if (s && DONE.has(s.status)) icon = <Check size={13} className={s.status === "skipped" ? "text-neutral-400" : "text-green-600"} />;
        else if (s?.status === "sent" || k === active) icon = <Loader2 size={13} className="animate-spin text-blue-500" />;
        return (
          <li key={k} data-key={k} data-status={s?.status ?? (k === active ? "active" : "pending")} className="flex items-start gap-2 text-xs">
            <span className="mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center">{icon}</span>
            <span className={`break-all ${s?.status === "skipped" ? "text-neutral-400" : "text-neutral-800 dark:text-neutral-200"}`}>{stepText(k, t)}</span>
            {s?.hash && (
              <a href={txUrl(s.hash)} target="_blank" rel="noreferrer" className="flex shrink-0 items-center gap-0.5 text-blue-600 hover:underline">
                Etherscan <ExternalLink size={10} />
              </a>
            )}
          </li>
        );
      })}
    </ol>
  );
}

// ── the form (the ghost opened in place) ─────────────────────────────────────────────────────────

function AddForm({
  workspaceId,
  kind,
  parent,
  parentRegistry,
  candidates,
  treeNodes,
  initial,
  takenLabel,
  formError,
  onCancel,
  onAdd,
}: {
  workspaceId: string;
  kind: "child" | "spouse";
  parent: TreeNode;
  parentRegistry: string;
  candidates: Candidate[];
  treeNodes: TreeNode[];
  initial: AddMemberInput | null;
  takenLabel: string | null;
  formError: string | null;
  onCancel: () => void;
  onAdd: (input: AddMemberInput) => void;
}) {
  const t = useT();
  const initialPick = initial ? candidates.find((c) => c.address.toLowerCase() === initial.address.toLowerCase()) : undefined;
  const [picked, setPicked] = useState<string | null>(initialPick?.userId ?? null);
  const [pasting, setPasting] = useState(!!initial && !initialPick);
  const [pasted, setPasted] = useState(initial && !initialPick ? initial.address : "");
  const [labelRaw, setLabelRaw] = useState(initial?.label ?? "");
  const [alias, setAlias] = useState(initial?.alias ?? "");
  const [relation, setRelation] = useState<"son" | "daughter" | null>(initial && initial.relation !== "spouse" ? initial.relation : null);
  const [answer, setAnswer] = useState<SubnameAnswer | null>(null);

  const local = useMemo(() => checkLabel(labelRaw), [labelRaw]);
  const debounced = useDebounced(labelRaw, 400);

  // availability under the parent (debounced 400 ms); invalid labels are refused here without a request
  useEffect(() => {
    const c = checkLabel(debounced);
    if (!c.ok) return;
    let alive = true;
    fetch(`/api/workspaces/${workspaceId}/ens?parent=${encodeURIComponent(parent.name)}&label=${encodeURIComponent(c.label)}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => alive && d && setAnswer(d as SubnameAnswer))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [debounced, workspaceId, parent.name, takenLabel]);

  const candidate = candidates.find((c) => c.userId === picked) ?? null;
  const address = pasting ? pasted.trim() : candidate?.address ?? "";
  const addressOk = isAddress(address, { strict: false });
  const inTree = addressOk ? treeNodes.find((n) => n.address && n.address.toLowerCase() === address.toLowerCase()) : undefined;
  const sameAlias = alias.trim() ? treeNodes.find((n) => displayOf(n).toLowerCase() === alias.trim().toLowerCase()) : undefined;
  const current = local.ok && answer?.label === local.label && debounced === labelRaw ? answer : null;
  const free = current?.status === "free" && current.label !== takenLabel;
  const rel = kind === "spouse" ? "spouse" : relation;
  const ready = addressOk && !inTree && free && alias.trim() !== "" && rel !== null;

  function pick(c: Candidate) {
    setPicked(c.userId);
    setPasting(false);
    // prefill from the display name when the fields are still empty
    if (!labelRaw.trim()) {
      const l = checkLabel(c.displayName.split(/\s+/)[0] ?? "");
      if (l.ok) setLabelRaw(l.label);
    }
    if (!alias.trim()) setAlias(c.displayName);
  }

  function add() {
    if (!ready || !local.ok || !rel) return;
    onAdd({
      parentName: parent.name,
      parentLabel: parent.label,
      parentRegistry: parentRegistry as Address,
      parentHasRegistry: !!parent.registry,
      label: local.label,
      alias: alias.trim(),
      relation: rel,
      address: address as Address,
      treeAddresses: treeNodes.flatMap((n) => (n.address ? [n.address as Address] : [])),
    });
  }

  let status: ReactNode = null;
  if (labelRaw.trim()) {
    if (!local.ok) {
      const why = { empty: t("Type a name"), "too-short": t("Type a name"), "too-long": t("At most 32 characters"), invalid: t("Only a–z, 0–9 and inner hyphens") }[local.reason];
      status = <span className="text-xs text-red-500">{why}</span>;
    } else if (!current) status = <span className={MUTED}>{t("Checking…")}</span>;
    else if (free) status = <span className="text-xs text-green-700 dark:text-green-400">{t("✓ available")}</span>;
    else
      status = (
        <span className="flex flex-col gap-1">
          <span className="text-xs text-red-500">
            {takenLabel === current.label && current.status === "free"
              ? t("{name} was just registered by someone else.", { name: `${current.label}.${parent.name}` })
              : t("{name} is taken", { name: `${current.label}.${parent.name}` })}
          </span>
          {current.suggestions.length > 0 && (
            <span className="flex flex-wrap gap-1" data-testid="family-add-suggestions">
              {current.suggestions.map((s) => (
                <button key={s} type="button" className={`${BTN} h-6 text-xs`} onClick={() => setLabelRaw(s)}>
                  {s}
                </button>
              ))}
            </span>
          )}
        </span>
      );
  }

  return (
    <div
      data-testid="family-add-form"
      data-kind={kind}
      className="flex flex-col gap-2.5 rounded-lg border border-dashed border-blue-400 bg-white p-3 shadow-lg dark:bg-neutral-800"
    >
      <span className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
        {kind === "child" ? t("A child of {name}", { name: displayOf(parent) }) : t("{name}'s spouse", { name: displayOf(parent) })}
      </span>

      {/* who */}
      <div className="flex flex-col gap-1">
        <span className={MUTED}>{t("Who")}</span>
        {candidates.length === 0 ? (
          <span className="text-xs text-neutral-500" data-testid="family-add-no-candidates">
            {t("Only people who connected MetaMask can be added. Ask them to open Settings → Family names and press Connect MetaMask.")}
          </span>
        ) : (
          <div className="flex max-h-28 flex-col gap-0.5 overflow-y-auto">
            {candidates.map((c) => (
              <button
                key={c.userId}
                type="button"
                data-testid="family-add-candidate"
                data-address={c.address}
                aria-pressed={!pasting && picked === c.userId}
                onClick={() => pick(c)}
                className={`flex items-center gap-2 rounded-md px-1.5 py-1 text-left text-sm hover:bg-neutral-100 dark:hover:bg-neutral-700 ${
                  !pasting && picked === c.userId ? "bg-blue-50 dark:bg-blue-950" : ""
                }`}
              >
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-neutral-200 text-[11px] font-medium text-neutral-700 dark:bg-neutral-600 dark:text-neutral-100">
                  {c.displayName.slice(0, 1).toUpperCase()}
                </span>
                <span className="truncate text-neutral-800 dark:text-neutral-200">{c.displayName}</span>
                <span className="ml-auto font-mono text-[11px] text-neutral-400">{short(c.address)}</span>
              </button>
            ))}
          </div>
        )}
        {pasting ? (
          <input
            data-testid="family-add-paste-input"
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
            placeholder="0x…"
            className={`${INPUT} w-full font-mono text-xs`}
            aria-label={t("Paste an address")}
          />
        ) : (
          <button type="button" data-testid="family-add-paste" className="self-start text-xs text-blue-600 hover:underline" onClick={() => setPasting(true)}>
            {t("Paste an address")}
          </button>
        )}
        {pasting && pasted.trim() && !addressOk && <span className="text-xs text-red-500">{t("Not an Ethereum address")}</span>}
        {inTree && (
          <span className="text-xs text-red-500" data-testid="family-add-in-tree">
            {t("{addr} is already {name} in this family", { addr: short(address), name: displayOf(inTree) })}
          </span>
        )}
      </div>

      {/* the name, built live */}
      <div className="flex flex-col gap-1">
        <span className={MUTED}>{t("Name")}</span>
        <div className="flex flex-wrap items-center gap-0.5 font-mono text-xs text-neutral-500">
          <input
            data-testid="family-add-label-input"
            value={labelRaw}
            onChange={(e) => setLabelRaw(e.target.value)}
            placeholder="minjun"
            className={`${INPUT} w-24 font-mono text-xs`}
            aria-label={t("Name")}
          />
          <span className="break-all">
            .<WrappedName name={parent.name} />
          </span>
        </div>
        <span data-testid="family-add-label-status" data-status={!labelRaw.trim() ? "empty" : !local.ok ? "invalid" : !current ? "checking" : free ? "free" : "taken"}>
          {status}
        </span>
      </div>

      <div className="flex flex-col gap-1">
        <span className={MUTED}>{t("Display name")}</span>
        <input data-testid="family-add-alias-input" value={alias} onChange={(e) => setAlias(e.target.value)} placeholder="Minjun" className={`${INPUT} w-full`} aria-label={t("Display name")} />
        {sameAlias && (
          <span className="text-xs text-amber-600" data-testid="family-add-alias-note">
            {t("Two people will be called {alias} — the agent will ask which one when sending", { alias: alias.trim() })}
          </span>
        )}
      </div>

      {kind === "child" && (
        <div className="flex items-center gap-1" role="radiogroup" aria-label={t("Relation")}>
          {(["son", "daughter"] as const).map((r) => (
            <button
              key={r}
              type="button"
              role="radio"
              aria-checked={relation === r}
              data-testid={`family-add-relation-${r}`}
              onClick={() => setRelation(r)}
              className={`${BTN} ${relation === r ? "bg-neutral-200/60 dark:bg-neutral-700" : ""}`}
            >
              {r === "son" ? t("son") : t("daughter")}
            </button>
          ))}
        </div>
      )}

      <span className="rounded-md bg-neutral-50 px-2 py-1.5 text-xs text-neutral-700 dark:bg-neutral-900 dark:text-neutral-300" data-testid="family-add-cost">
        {parent.registry ? t("2 approvals in MetaMask") : t("4 approvals — the first child also creates {name}'s branch", { name: displayOf(parent) })}
      </span>
      {formError && <span className="text-xs text-red-500">{formError}</span>}

      <div className="flex items-center gap-2">
        <button type="button" data-testid="family-add-submit" className={PRIMARY} disabled={!ready} onClick={add}>
          {t("Add")}
        </button>
        <button type="button" data-testid="family-add-cancel" className={BTN} onClick={onCancel}>
          {t("Cancel")}
        </button>
      </div>
    </div>
  );
}
