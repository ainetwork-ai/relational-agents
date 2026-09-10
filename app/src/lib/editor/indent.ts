/**
 * Block nesting (Tab / Shift+Tab / Enter / Backspace) — the tree surgery, kept
 * out of the editor component so the rules are one place and readable.
 *
 * Every rule here was measured on app.notion.com on 2026-09-10
 * (`docs/notion-indent.md`, raw rows in `scratchpad/nind-*.jsonl`). The ones
 * that changed our behaviour, in the order they surprised us:
 *
 *  1. **A run of selected siblings indents as a run.** Two adjacent siblings
 *     both indented under the block before them stay siblings of each other —
 *     the second does NOT nest under the first (T16: both went to the same
 *     depth).
 *  2. **Outdent adopts what was below it.** Shift+Tab on a middle child lifts
 *     that child one level AND takes its former later siblings along as its own
 *     children (T6b: A > B1,B2,B3 → A > B1, then B2 at A's level with B3 under
 *     B2). Without this the later siblings stay in the old parent and render
 *     ABOVE the block that just moved — the keystroke silently reorders the
 *     document.
 *  3. **Positions are renumbered, not halved.** Our outdent used to compute its
 *     new position after reparenting, which made it collide with its old
 *     parent's position; equal positions leave the order to `Array.sort`, and
 *     the same input rendered two different orders on two runs. Whole numbers
 *     for the touched sibling lists remove both that tie and the fractional
 *     collapse after ~50 splits.
 *
 * The functions mutate the array they are given (the editor hands them a fresh
 * copy inside `mutate`) and return true when something changed.
 */

/** The shape these functions need — the editor's EBlock satisfies it. */
export interface TreeBlock {
  id: string;
  type: string;
  parentBlockId: string | null;
  position: number;
}

/**
 * Blocks that never take a Tab-nested child. Measured: a paragraph after a
 * heading stays at top level when you press Tab (2026-08-26 input cases
 * `heading1/enter_tab`, re-confirmed 2026-09-10), and the same for a divider
 * and a code block. Everything not listed here accepts children.
 */
export const NO_CHILDREN: ReadonlySet<string> = new Set([
  "heading1",
  "heading2",
  "heading3",
  "divider",
  "code",
  "image",
  "file",
  "video",
  "bookmark",
  "embed",
  "equation",
  "table",
  "database",
]);

/**
 * The types whose Backspace-at-start drops the marker before it touches the
 * depth (measured, T7c) and whose children step 32px instead of 30 (T18).
 */
export const LIST_TYPES: ReadonlySet<string> = new Set([
  "bulleted_list",
  "numbered_list",
  "todo",
  "toggle",
]);

/**
 * How far one nesting level moves a child to the right, by the PARENT's type
 * (measured 2026-09-10, docs/notion-indent.md §3): a text-ish parent steps 30px,
 * a parent with a marker column (bullet, number, checkbox, toggle arrow) steps
 * 32px so the child lines up under the parent's text. We drew a flat 24px.
 */
export const indentStep = (parentType?: string): number =>
  parentType && LIST_TYPES.has(parentType) ? 32 : 30;

const parentOf = (b: TreeBlock) => b.parentBlockId ?? null;

/** children of `parentId`, in document order */
export function childrenOf<T extends TreeBlock>(all: T[], parentId: string | null): T[] {
  return all.filter((b) => parentOf(b) === parentId).sort((a, b) => a.position - b.position);
}

/** 1..n whole numbers for one sibling list — kills position ties and float drift */
export function renumberSiblings<T extends TreeBlock>(all: T[], parentId: string | null): void {
  renumber(all, parentId);
}

function renumber<T extends TreeBlock>(all: T[], parentId: string | null): void {
  childrenOf(all, parentId).forEach((b, i) => {
    b.position = i + 1;
  });
}

/** is `maybeAncestor` an ancestor of `b`? */
function isAncestor<T extends TreeBlock>(all: T[], maybeAncestor: string, b: T): boolean {
  let p = parentOf(b);
  const seen = new Set<string>();
  while (p && !seen.has(p)) {
    if (p === maybeAncestor) return true;
    seen.add(p);
    p = all.find((x) => x.id === p)?.parentBlockId ?? null;
  }
  return false;
}

/**
 * The blocks that actually move: an id whose ancestor is also selected already
 * travels with that ancestor, so moving it again would double-indent it.
 * Returned in document order, grouped into runs of adjacent siblings.
 */
function runsOf<T extends TreeBlock>(all: T[], ids: string[]): T[][] {
  const wanted = new Set(ids);
  const tops = all.filter(
    (b) => wanted.has(b.id) && ![...wanted].some((o) => o !== b.id && isAncestor(all, o, b))
  );
  const runs: T[][] = [];
  for (const parentId of new Set(tops.map(parentOf))) {
    const sibs = childrenOf(all, parentId);
    let run: T[] = [];
    for (const s of sibs) {
      if (tops.some((t) => t.id === s.id)) run.push(s);
      else if (run.length) {
        runs.push(run);
        run = [];
      }
    }
    if (run.length) runs.push(run);
  }
  // document order between runs keeps the caller's caret bookkeeping simple
  const order = new Map(all.map((b, i) => [b.id, i]));
  return runs.sort((a, b) => (order.get(a[0].id) ?? 0) - (order.get(b[0].id) ?? 0));
}

/** append `moved` to `newParentId`'s children, in the given order */
function appendUnder<T extends TreeBlock>(all: T[], newParentId: string | null, moved: T[]): void {
  const kids = childrenOf(all, newParentId).filter((k) => !moved.includes(k));
  let pos = (kids[kids.length - 1]?.position ?? 0) + 1;
  for (const m of moved) {
    m.parentBlockId = newParentId;
    m.position = pos++;
  }
}

/**
 * Tab. Each run of adjacent selected siblings nests under the sibling right
 * before the run — all of them as that block's last children, keeping their
 * order and their own subtrees. A run with nothing before it, or whose previous
 * sibling takes no children, is refused (Notion: nothing happens at all).
 */
export function indentBlocks<T extends TreeBlock>(all: T[], ids: string[]): boolean {
  let changed = false;
  for (const run of runsOf(all, ids)) {
    const sibs = childrenOf(all, parentOf(run[0]));
    const firstIdx = sibs.findIndex((s) => s.id === run[0].id);
    const prev = sibs
      .slice(0, firstIdx)
      .reverse()
      .find((s) => !run.some((r) => r.id === s.id));
    if (!prev || NO_CHILDREN.has(prev.type)) continue;
    const oldParent = parentOf(run[0]);
    appendUnder(all, prev.id, run);
    renumber(all, prev.id);
    renumber(all, oldParent);
    changed = true;
  }
  return changed;
}

/**
 * Shift+Tab. Each run moves up one level, landing right after its former
 * parent, and adopts the siblings that stayed behind after it (measured — see
 * the header). A run already at the top level is refused.
 */
export function outdentBlocks<T extends TreeBlock>(all: T[], ids: string[]): boolean {
  let changed = false;
  for (const run of runsOf(all, ids)) {
    const parentId = parentOf(run[0]);
    if (!parentId) continue;
    const parent = all.find((b) => b.id === parentId);
    if (!parent) continue;
    const grandParent = parentOf(parent);

    const sibs = childrenOf(all, parentId);
    const lastIdx = sibs.findIndex((s) => s.id === run[run.length - 1].id);
    const later = sibs.slice(lastIdx + 1).filter((s) => !run.some((r) => r.id === s.id));

    // 1. the run becomes the parent's next siblings, in order
    const uncles = childrenOf(all, grandParent);
    const parentIdx = uncles.findIndex((u) => u.id === parent.id);
    const after = uncles.slice(parentIdx + 1);
    for (const r of run) {
      r.parentBlockId = grandParent;
      r.position = parent.position; // provisional; renumber below fixes order
    }
    // order within the new sibling list: parent, run…, then whatever followed
    const orderedNew = [
      ...uncles.slice(0, parentIdx + 1).filter((u) => !run.some((r) => r.id === u.id)),
      ...run,
      ...after.filter((u) => !run.some((r) => r.id === u.id)),
    ];
    orderedNew.forEach((b, i) => {
      b.position = i + 1;
    });

    // 2. the run's last block adopts what stayed behind after it
    if (later.length) appendUnder(all, run[run.length - 1].id, later);

    renumber(all, parentId);
    renumber(all, run[run.length - 1].id);
    changed = true;
  }
  return changed;
}

/**
 * Enter. The new block takes the text after the caret AND the current block's
 * children (measured: T13/T13b/T13c/T14b — the children always follow the
 * second half, which is what keeps the new line directly under the block you
 * split and the nesting below it intact).
 */
export function moveChildren<T extends TreeBlock>(all: T[], fromId: string, toId: string): void {
  const kids = childrenOf(all, fromId);
  if (!kids.length) return;
  appendUnder(all, toId, kids);
  renumber(all, toId);
}

/**
 * Deleting a block must not leave its children pointing at a ghost: nothing
 * renders a block whose parent is gone, so the content disappears from the page
 * while still being saved. Lift them to where the deleted block was.
 */
export function liftChildren<T extends TreeBlock>(
  all: T[],
  deletedId: string,
  newParentId: string | null,
  afterId?: string
): void {
  const kids = childrenOf(all, deletedId);
  if (!kids.length) return;
  const sibs = childrenOf(all, newParentId).filter((s) => !kids.includes(s));
  const at = afterId ? sibs.findIndex((s) => s.id === afterId) : sibs.length - 1;
  const ordered = [...sibs.slice(0, at + 1), ...kids, ...sibs.slice(at + 1)];
  for (const k of kids) k.parentBlockId = newParentId;
  ordered.forEach((b, i) => {
    b.position = i + 1;
  });
}
