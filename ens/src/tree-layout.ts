// ens/src/tree-layout.ts
// Where each card of the family tree canvas goes (docs/superpowers/plans/2026-09-26-ens-family-settings.md,
// Task 7b). Pure: no DOM, so it is checked like the rest of ens/. Rows are generations; a spouse (onchain
// a child node of their partner) sits beside the partner in the same row; children sit centred under the
// person, or under the couple. Columns are in card widths and may be half-integers; the component only
// multiplies them by a card width.

/** Just what the layout reads, so both FamilyNode and the API's TreeNode fit. */
export interface LayoutNode {
  name: string;
  label: string;
  relation: string | null;
  children: LayoutNode[];
}

export interface LaidOutCard<N extends LayoutNode = LayoutNode> {
  key: string;
  kind: "person" | "ghost-child" | "ghost-spouse";
  /** Only for `person`. */
  node?: N;
  /** The person this card hangs under: the parent for a person, the person a ghost adds to. */
  parentName?: string;
  row: number;
  col: number;
}
export interface LaidOutEdge {
  from: string;
  to: string;
  kind: "child" | "spouse";
}
export interface FamilyLayout<N extends LayoutNode = LayoutNode> {
  cards: LaidOutCard<N>[];
  edges: LaidOutEdge[];
  rows: number;
  cols: number;
}
export interface LayoutOptions<N extends LayoutNode = LayoutNode> {
  /** Add "+ Add a child" / "+ Add spouse" cards. */
  ghosts: boolean;
  /** With `ghosts`: only on these people (e.g. where the viewer may write). Default: everyone. */
  ghostsFor?: (node: N) => boolean;
}

export const ghostChildKey = (name: string) => `ghost-child:${name}`;
export const ghostSpouseKey = (name: string) => `ghost-spouse:${name}`;

const isSpouse = (n: LayoutNode) => n.relation === "spouse";
const byLabel = (a: LayoutNode, b: LayoutNode) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0);

/** One person as the top of the tree. */
export function layoutFamily<N extends LayoutNode>(tree: N, opts: LayoutOptions<N>): FamilyLayout<N> {
  return layoutForest([tree], opts);
}

/** Several top people side by side in row 0 (e.g. everyone registered directly under the family root). */
export function layoutForest<N extends LayoutNode>(tops: N[], opts: LayoutOptions<N>): FamilyLayout<N> {
  const cards: LaidOutCard<N>[] = [];
  const edges: LaidOutEdge[] = [];
  /** next free column per row */
  const next: number[] = [];
  const free = (row: number) => next[row] ?? 0;
  const ghostOn = (n: N) => opts.ghosts && (opts.ghostsFor ? opts.ghostsFor(n) : true);

  /** Shift every card placed since `from` (one subtree) right by `d`, and the free columns with them. */
  function shift(from: number, d: number) {
    for (let i = from; i < cards.length; i++) {
      const c = cards[i];
      c.col += d;
      next[c.row] = Math.max(free(c.row), c.col + 1);
    }
  }

  /** Place person `n` in `row` with their spouses beside them and their children in the next row;
   *  returns n's column. Spouses are placed here, never on their own. */
  function place(n: N, row: number, parentName: string | undefined): number {
    const start = cards.length;
    const kids = n.children as N[];
    const spouses = kids.filter(isSpouse);
    // a spouse's own children (rare onchain) hang under the couple with the partner's
    const children = [...kids.filter((c) => !isSpouse(c)), ...spouses.flatMap((s) => (s.children as N[]).filter((c) => !isSpouse(c)))].sort(byLabel);
    // a spouse gets no ghosts: the couple's children live in the blood-line partner's registry
    const ghosts = ghostOn(n);
    const ghostSpouse = ghosts && spouses.length === 0;
    const width = 1 + spouses.length + (ghostSpouse ? 1 : 0);

    // children first (leaf-first), the ghost child last
    const childCols = children.map((c) => place(c, row + 1, n.name));
    if (ghosts) {
      const col = free(row + 1);
      cards.push({ key: ghostChildKey(n.name), kind: "ghost-child", parentName: n.name, row: row + 1, col });
      next[row + 1] = col + 1;
      childCols.push(col);
    }

    // centred over the children (a couple by its midpoint), never left of what this row already holds
    let left = childCols.length ? childCols.reduce((a, b) => a + b, 0) / childCols.length - (width - 1) / 2 : free(row);
    if (left < free(row)) {
      shift(start, free(row) - left);
      left = free(row);
    }

    cards.push({ key: n.name, kind: "person", node: n, parentName, row, col: left });
    spouses.forEach((s, i) => {
      cards.push({ key: s.name, kind: "person", node: s, parentName: n.name, row, col: left + 1 + i });
      edges.push({ from: n.name, to: s.name, kind: "spouse" });
    });
    if (ghostSpouse) {
      cards.push({ key: ghostSpouseKey(n.name), kind: "ghost-spouse", parentName: n.name, row, col: left + 1 });
      edges.push({ from: n.name, to: ghostSpouseKey(n.name), kind: "spouse" });
    }
    next[row] = left + width;
    for (const c of children) edges.push({ from: n.name, to: c.name, kind: "child" });
    if (ghosts) edges.push({ from: n.name, to: ghostChildKey(n.name), kind: "child" });
    return left;
  }

  for (const top of tops) place(top, 0, undefined);

  // start at column 0 (a couple over one child can sit half a column left of it)
  const min = cards.length ? Math.min(...cards.map((c) => c.col)) : 0;
  if (min !== 0) for (const c of cards) c.col -= min;
  const rows = cards.length ? Math.max(...cards.map((c) => c.row)) + 1 : 0;
  const cols = cards.length ? Math.max(...cards.map((c) => c.col)) + 1 : 0;
  return { cards, edges, rows, cols };
}
