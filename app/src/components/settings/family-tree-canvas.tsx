"use client";

// The family tree canvas (docs/superpowers/plans/2026-09-26-ens-family-settings.md, Task 7b): absolutely
// positioned cards from layoutForest, one SVG of orthogonal edges behind them, scrolling inside its own
// box. Ghost "+ Add" cards appear on the people the viewer can add under (per-node `canAdd` from the API:
// an admin whose wallet holds the roles); an admin whose wallet holds none is told why and who can. The
// canvas opens scrolled to the first person and their "+ Add a child", and fades at an edge that has
// more to scroll to. Under 640 px the rows stack as an indented list of the same cards.
import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import type { Address } from "viem";
import { useT } from "@/i18n/provider";
import { ghostChildKey, ghostSpouseKey, layoutForest, type LaidOutCard } from "@/lib/ens-family/tree-layout";
import { MUTED, short, type Candidate, type TreeNode } from "./family-ui";
import { CARD_H, CARD_W, FamilyPersonCard } from "./family-person-card";
import { AddMemberCard, FORM_W, type AddPhase } from "./add-member-card";

const GAP = 16;
const VGAP = 44;
const PAD = 16;
/** Room below an open form (it is taller than a card). */
const FORM_ROOM = 560;
const NARROW = "(max-width: 639px)";

const xOf = (col: number) => PAD + col * (CARD_W + GAP);
const yOf = (row: number) => PAD + row * (CARD_H + VGAP);

function subscribeNarrow(cb: () => void) {
  const mq = window.matchMedia(NARROW);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}
const useNarrow = () =>
  useSyncExternalStore(
    subscribeNarrow,
    () => window.matchMedia(NARROW).matches,
    () => false
  );

/** Every node, and for each the registry its parent keeps it in (where addMember writes setSubregistry). */
function indexTree(tree: TreeNode) {
  const all: TreeNode[] = [];
  const parentRegistry = new Map<string, string | null>();
  const walk = (n: TreeNode, parentReg: string | null) => {
    all.push(n);
    parentRegistry.set(n.name, parentReg);
    for (const c of n.children) walk(c, n.registry);
  };
  walk(tree, null);
  return { all, parentRegistry };
}

export function FamilyTreeCanvas({
  workspaceId,
  tree,
  wallet,
  canEdit,
  candidates,
  onChanged,
}: {
  workspaceId: string;
  /** the family root; the people are its children */
  tree: TreeNode;
  wallet: Address | null;
  canEdit: boolean;
  candidates: Candidate[];
  onChanged: () => Promise<void>;
}) {
  const t = useT();
  const narrow = useNarrow();
  const boxRef = useRef<HTMLDivElement>(null);
  const [phases, setPhases] = useState<Record<string, AddPhase>>({});
  const [branches, setBranches] = useState<Record<string, boolean>>({});
  const [edges, setEdges] = useState({ left: false, right: false });
  const scrolledOnce = useRef(false);

  const ghosts = canEdit && !!wallet;
  const { all, parentRegistry } = useMemo(() => indexTree(tree), [tree]);
  const layout = useMemo(() => layoutForest(tree.children, { ghosts, ghostsFor: (n) => !!n.canAdd }), [tree, ghosts]);
  const ghostKeys = useMemo(() => new Set(layout.cards.filter((c) => c.kind !== "person").map((c) => c.key)), [layout]);

  /** Scroll the canvas box (never the page) so the card is in view. */
  const reveal = useCallback((key: string) => {
    requestAnimationFrame(() => {
      const box = boxRef.current;
      const el = box?.querySelector<HTMLElement>(`[data-card-key="${CSS.escape(key)}"]`);
      if (!box || !el) return;
      const b = box.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      const dx = r.left < b.left ? r.left - b.left - PAD : r.right > b.right ? Math.min(r.right - b.right + PAD, r.left - b.left - PAD) : 0;
      const dy = r.top < b.top ? r.top - b.top - PAD : r.bottom > b.bottom ? Math.min(r.bottom - b.bottom + PAD, r.top - b.top - PAD) : 0;
      if (dx || dy) box.scrollBy({ left: dx, top: dy, behavior: "smooth" });
    });
  }, []);

  // open on the first person and their "+ Add a child" (the main action), centred when both fit,
  // else with the ghost fully in view; once per mount, so an add never jumps the view
  useLayoutEffect(() => {
    const box = boxRef.current;
    if (narrow || !box || scrolledOnce.current) return;
    const top = layout.cards.find((c) => c.kind === "person" && c.row === 0 && c.node);
    if (!top?.node) return;
    scrolledOnce.current = true;
    const ghost = layout.cards.find((c) => c.key === ghostChildKey(top.node!.name));
    const lo = Math.min(xOf(top.col), ghost ? xOf(ghost.col) : Infinity);
    const hi = Math.max(xOf(top.col), ghost ? xOf(ghost.col) : -Infinity) + CARD_W;
    const view = box.clientWidth;
    const target = hi - lo + 2 * PAD <= view ? (lo + hi) / 2 - view / 2 : hi + PAD - view;
    box.scrollLeft = Math.max(0, target);
  }, [layout, narrow]);

  // the edge fades: shown while there is more to scroll to on that side
  useEffect(() => {
    const box = boxRef.current;
    if (narrow || !box) return;
    const update = () => {
      const left = box.scrollLeft > 1;
      const right = box.scrollLeft + box.clientWidth < box.scrollWidth - 1;
      setEdges((e) => (e.left === left && e.right === right ? e : { left, right }));
    };
    const ro = new ResizeObserver(update);
    ro.observe(box);
    if (box.firstElementChild) ro.observe(box.firstElementChild);
    box.addEventListener("scroll", update, { passive: true });
    return () => {
      ro.disconnect();
      box.removeEventListener("scroll", update);
    };
  }, [narrow, tree]);

  const onPhase = (key: string) => (p: AddPhase) => {
    setPhases((prev) => ({ ...prev, [key]: p }));
    if (p === "form") reveal(key);
  };
  const onBranch = (parentName: string) => (active: boolean) => setBranches((prev) => ({ ...prev, [parentName]: active }));

  // an admin with a wallet that holds none of the family's registry roles sees no "+ Add" cards: say why
  const cannotAdd = ghosts && !all.some((n) => n.canAdd) && wallet ? (
    <p className={MUTED} data-testid="family-no-add">
      {t("This wallet ({addr}) holds no roles on the registries of {root}, so it can't add people. The wallet that created {root} can.", {
        addr: short(wallet),
        root: tree.name,
      })}
    </p>
  ) : null;

  if (tree.children.length === 0) {
    return (
      <>
        {cannotAdd}
        <p className={MUTED}>{t("No one is in the family tree yet.")}</p>
      </>
    );
  }

  const addCard = (kind: "child" | "spouse", parent: TreeNode, key: string, fluid?: boolean): ReactNode => {
    const reg = parentRegistry.get(parent.name);
    if (!wallet || !reg) return null;
    return (
      <AddMemberCard
        workspaceId={workspaceId}
        account={wallet}
        kind={kind}
        parent={parent}
        parentRegistry={reg}
        candidates={candidates}
        treeNodes={all}
        fluid={fluid}
        onPhase={onPhase(key)}
        onBranch={onBranch(parent.name)}
        onDone={onChanged}
      />
    );
  };
  const byName = new Map(all.map((n) => [n.name, n]));

  if (narrow) {
    return (
      <>
        {cannotAdd}
        <ul className="flex flex-col gap-2" data-testid="family-tree-list">
          <ListRows nodes={tree.children} depth={0} ghostKeys={ghostKeys} branches={branches} addCard={addCard} />
        </ul>
      </>
    );
  }

  // ── the canvas ──
  const openForm = layout.cards.find((c) => phases[c.key] === "form");
  const width = Math.max(xOf(layout.cols) - GAP + PAD, openForm ? xOf(openForm.col) + FORM_W + PAD : 0);
  const height = Math.max(yOf(layout.rows) - VGAP + PAD, openForm ? yOf(openForm.row) + FORM_ROOM : 0);
  const cardAt = new Map(layout.cards.map((c) => [c.key, c]));

  const fade = "pointer-events-none absolute inset-y-px z-30 w-10 from-neutral-400/25 to-transparent dark:from-black/50";
  return (
    <>
      {cannotAdd}
      <div className="relative">
        <div
          ref={boxRef}
          data-testid="family-tree-canvas"
          className="relative max-h-[520px] w-full overflow-auto rounded-lg border border-[rgba(28,19,1,0.08)] bg-neutral-50/60 dark:border-neutral-700 dark:bg-neutral-900/40"
        >
          <div className="relative" style={{ width, height }}>
            <Edges layout={layout.edges} cardAt={cardAt} phases={phases} width={width} height={height} />
            {layout.cards.map((c) => (
              <div
                key={c.key}
                data-card-key={c.key}
                className={`absolute ${phases[c.key] && phases[c.key] !== "ghost" ? "z-20" : "z-10"}`}
                style={{ left: xOf(c.col), top: yOf(c.row) }}
              >
                {c.kind === "person" && c.node ? (
                  <FamilyPersonCard node={c.node} branch={!!branches[c.node.name]} />
                ) : c.parentName && byName.get(c.parentName) ? (
                  addCard(c.kind === "ghost-child" ? "child" : "spouse", byName.get(c.parentName)!, c.key)
                ) : null}
              </div>
            ))}
          </div>
        </div>
        {edges.left && <div aria-hidden data-testid="family-tree-fade-left" className={`${fade} left-px rounded-l-lg bg-gradient-to-r`} />}
        {edges.right && <div aria-hidden data-testid="family-tree-fade-right" className={`${fade} right-px rounded-r-lg bg-gradient-to-l`} />}
      </div>
    </>
  );
}

function Edges({
  layout,
  cardAt,
  phases,
  width,
  height,
}: {
  layout: { from: string; to: string; kind: "child" | "spouse" }[];
  cardAt: Map<string, LaidOutCard<TreeNode>>;
  phases: Record<string, AddPhase>;
  width: number;
  height: number;
}) {
  const cx = (c: LaidOutCard<TreeNode>) => xOf(c.col) + CARD_W / 2;
  // a couple's children hang from the midpoint of the partner and everyone beside them
  const unitMid = (from: string) => {
    const p = cardAt.get(from)!;
    const side = layout.filter((e) => e.kind === "spouse" && e.from === from).map((e) => cardAt.get(e.to)!);
    const xs = [p, ...side].map(cx);
    return xs.reduce((a, b) => a + b, 0) / xs.length;
  };
  const style = (to: string) => {
    const c = cardAt.get(to)!;
    const ph = phases[to];
    if (c.kind === "person" || ph === "settling" || ph === "settled") return { stroke: "var(--family-edge, #a3a3a3)", dash: undefined, order: 1 };
    if (ph === "running" || ph === "stopped") return { stroke: "#60a5fa", dash: "5 4", order: 2 };
    return { stroke: "#d4d4d4", dash: "3 4", order: 0 };
  };
  const paths = layout
    .filter((e) => cardAt.has(e.from) && cardAt.has(e.to))
    .map((e) => {
      const a = cardAt.get(e.from)!;
      const b = cardAt.get(e.to)!;
      const s = style(e.to);
      let d: string;
      if (e.kind === "spouse") {
        const y = yOf(a.row) + CARD_H / 2;
        d = `M ${xOf(a.col) + CARD_W} ${y} H ${xOf(b.col)}`;
      } else {
        const x0 = unitMid(e.from);
        const y0 = yOf(a.row) + CARD_H;
        const yBar = y0 + VGAP / 2;
        d = `M ${x0} ${y0} V ${yBar} H ${cx(b)} V ${yOf(b.row)}`;
      }
      return { key: `${e.from}->${e.to}`, d, ...s };
    })
    .sort((p, q) => p.order - q.order);
  return (
    <svg className="pointer-events-none absolute inset-0" width={width} height={height} aria-hidden data-testid="family-tree-edges">
      {paths.map((p) => (
        <path key={p.key} d={p.d} fill="none" stroke={p.stroke} strokeWidth={1.5} strokeDasharray={p.dash} data-dashed={p.dash ? "1" : "0"} />
      ))}
    </svg>
  );
}

/** < 640 px: the same cards as an indented list — spouses beside (same depth), children one step in. */
function ListRows({
  nodes,
  depth,
  ghostKeys,
  branches,
  addCard,
}: {
  nodes: TreeNode[];
  depth: number;
  ghostKeys: Set<string>;
  branches: Record<string, boolean>;
  addCard: (kind: "child" | "spouse", parent: TreeNode, key: string, fluid?: boolean) => ReactNode;
}) {
  const sorted = [...nodes].sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));
  const row = (key: string, d: number, content: ReactNode) => (
    <li key={key} data-card-key={key} style={{ paddingLeft: d * 16 }}>
      {content}
    </li>
  );
  return (
    <>
      {sorted.map((n) => {
        const spouses = n.children.filter((c) => c.relation === "spouse");
        const kids = [...n.children.filter((c) => c.relation !== "spouse"), ...spouses.flatMap((s) => s.children.filter((c) => c.relation !== "spouse"))];
        return (
          <Fragment key={n.name}>
            {row(n.name, depth, <FamilyPersonCard node={n} branch={!!branches[n.name]} fluid />)}
            {spouses.map((s) => row(s.name, depth, <FamilyPersonCard node={s} fluid />))}
            {ghostKeys.has(ghostSpouseKey(n.name)) && row(ghostSpouseKey(n.name), depth, addCard("spouse", n, ghostSpouseKey(n.name), true))}
            <ListRows nodes={kids} depth={depth + 1} ghostKeys={ghostKeys} branches={branches} addCard={addCard} />
            {ghostKeys.has(ghostChildKey(n.name)) && row(ghostChildKey(n.name), depth + 1, addCard("child", n, ghostChildKey(n.name), true))}
          </Fragment>
        );
      })}
    </>
  );
}
