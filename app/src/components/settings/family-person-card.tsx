"use client";

// One person on the family tree canvas (docs/superpowers/plans/2026-09-26-ens-family-settings.md, Task 7b):
// alias, full name (wrapping at the dots), relation badge, short address, ✓. Clicking it opens a popover
// that resolves the name live through the Universal Resolver — the proof the subname works.
import { Fragment, useEffect, useRef, useState } from "react";
import { Check, ExternalLink, Loader2 } from "lucide-react";
import { useT } from "@/i18n/provider";
import { resolveName } from "@/lib/wallet/ens-issue";
import { ENS_APP, MUTED, addressUrl, displayOf, short, type TreeNode } from "./family-ui";

export const CARD_W = 184;
export const CARD_H = 104;

/** The name with a break opportunity after every dot: dad.grandma.lee.eth wraps as dad. / grandma. / … */
export function WrappedName({ name }: { name: string }) {
  const parts = name.split(".");
  return (
    <>
      {parts.map((p, i) => (
        <Fragment key={i}>
          {p}
          {i < parts.length - 1 && (
            <>
              .<wbr />
            </>
          )}
        </Fragment>
      ))}
    </>
  );
}

export function RelationBadge({ relation }: { relation: string | null }) {
  const t = useT();
  const text = relation === "son" ? t("son") : relation === "daughter" ? t("daughter") : relation === "spouse" ? t("spouse") : null;
  if (!text) return null;
  return <span className="rounded bg-neutral-100 px-1.5 text-[11px] leading-4 text-neutral-600 dark:bg-neutral-700 dark:text-neutral-300">{text}</span>;
}

export function FamilyPersonCard({ node, branch, fluid }: { node: TreeNode; branch?: boolean; fluid?: boolean }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative" style={fluid ? undefined : { width: CARD_W }}>
      <button
        type="button"
        data-testid="family-person-card"
        data-name={node.name}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full flex-col items-start gap-0.5 overflow-hidden rounded-lg border border-[rgba(28,19,1,0.11)] bg-white px-2.5 py-2 text-left shadow-sm transition-colors hover:border-neutral-400 dark:border-neutral-600 dark:bg-neutral-800"
        style={fluid ? { minHeight: CARD_H } : { height: CARD_H }}
      >
        <span className="flex w-full items-center gap-1">
          <span className="truncate text-[15px] font-semibold text-neutral-900 dark:text-neutral-100">{displayOf(node)}</span>
          <Check size={13} className="shrink-0 text-green-600" aria-label={t("Registered")} />
          {branch && (
            <span className="ml-auto rounded bg-blue-50 px-1 text-[10px] text-blue-700 dark:bg-blue-950 dark:text-blue-300" data-testid="family-branch-badge">
              {t("branch")}
            </span>
          )}
        </span>
        <span className="line-clamp-2 break-words font-mono text-[11px] leading-[14px] text-neutral-500">
          <WrappedName name={node.name} />
        </span>
        <span className="mt-auto flex items-center gap-1.5">
          <RelationBadge relation={node.relation} />
          {node.address && <span className="font-mono text-[11px] text-neutral-400">{short(node.address)}</span>}
        </span>
      </button>
      {open && <ResolvePopover node={node} />}
    </div>
  );
}

/** "Resolves to 0x…", read when the popover opens (mounting it is the open). */
function ResolvePopover({ node }: { node: TreeNode }) {
  const t = useT();
  const [resolved, setResolved] = useState<{ address: string | null } | null>(null);
  useEffect(() => {
    let alive = true;
    resolveName(node.name).then((address) => alive && setResolved({ address }));
    return () => {
      alive = false;
    };
  }, [node.name]);
  return (
    <div
      role="dialog"
      data-testid="family-person-popover"
      className="absolute left-0 top-full z-30 mt-1 flex w-64 flex-col gap-1.5 rounded-lg border border-[rgba(28,19,1,0.11)] bg-white p-3 text-sm shadow-lg dark:border-neutral-600 dark:bg-neutral-800"
    >
      <span className="break-all font-mono text-xs text-neutral-700 dark:text-neutral-300">{node.name}</span>
      {!resolved ? (
        <span className={`flex items-center gap-1 ${MUTED}`}>
          <Loader2 size={12} className="animate-spin" /> {t("Resolving…")}
        </span>
      ) : resolved.address ? (
        <span className="text-xs text-green-700 dark:text-green-400" data-testid="family-resolves-to">
          {t("Resolves to {addr}", { addr: short(resolved.address) })}
        </span>
      ) : (
        <span className="text-xs text-red-500">{t("Does not resolve right now")}</span>
      )}
      <div className="flex flex-wrap gap-3">
        {node.address && (
          <a href={addressUrl(node.address)} target="_blank" rel="noreferrer" className="flex items-center gap-0.5 text-xs text-blue-600 hover:underline">
            Etherscan <ExternalLink size={11} />
          </a>
        )}
        <a href={`${ENS_APP}/${node.name}`} target="_blank" rel="noreferrer" className="flex items-center gap-0.5 text-xs text-blue-600 hover:underline">
          {t("Open in ENS app")} <ExternalLink size={11} />
        </a>
      </div>
    </div>
  );
}
