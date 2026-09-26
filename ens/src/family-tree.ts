// ens/src/family-tree.ts
// The family tree as ENS names, and who in it a request means. Pure: the tree is
// loaded by chain.ts; everything here is decided from that snapshot.
import type { Address } from "viem";
import type { Relation } from "./config";
import type { Kinship } from "./send-request";

export interface FamilyNode {
  /** full ENS name, e.g. minjun.dad.grandma.kim.ainmem.eth */
  name: string;
  /** first label, e.g. minjun */
  label: string;
  /** ENSIP-18 `alias` — the display name */
  alias: string | null;
  /** `family.relation` — kinship to the parent node */
  relation: Relation | null;
  avatar: string | null;
  address: Address | null;
  children: FamilyNode[];
}

export function displayName(node: FamilyNode): string {
  return node.alias ?? node.label;
}

export function findNodeByAddress(root: FamilyNode, address: string): FamilyNode | null {
  const want = address.toLowerCase();
  if (root.address && root.address.toLowerCase() === want) return root;
  for (const c of root.children) {
    const hit = findNodeByAddress(c, address);
    if (hit) return hit;
  }
  return null;
}

export function descendants(node: FamilyNode): { node: FamilyNode; path: FamilyNode[] }[] {
  const out: { node: FamilyNode; path: FamilyNode[] }[] = [];
  const walk = (n: FamilyNode, path: FamilyNode[]) => {
    for (const c of n.children) {
      const p = [...path, c];
      out.push({ node: c, path: p });
      walk(c, p);
    }
  };
  walk(node, []);
  return out;
}

const isChild = (n: FamilyNode) => n.relation === "son" || n.relation === "daughter";

export function matchesKinship(path: FamilyNode[], kinship: Kinship): boolean {
  const [a, b] = path;
  switch (kinship) {
    case "son":
      return path.length === 1 && a.relation === "son";
    case "daughter":
      return path.length === 1 && a.relation === "daughter";
    case "child":
      return path.length === 1 && isChild(a);
    case "grandson":
      return path.length === 2 && isChild(a) && b.relation === "son";
    case "granddaughter":
      return path.length === 2 && isChild(a) && b.relation === "daughter";
    case "grandchild":
      return path.length === 2 && isChild(a) && isChild(b);
    case "daughter-in-law":
      return path.length === 2 && a.relation === "son" && b.relation === "spouse";
    case "son-in-law":
      return path.length === 2 && a.relation === "daughter" && b.relation === "spouse";
  }
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Whole-word, case-insensitive: "Min" does not match inside "Minjun". */
function mentioned(text: string, word: string): boolean {
  return new RegExp(`(^|[^\\p{L}\\p{N}-])${escape(word)}($|[^\\p{L}\\p{N}-])`, "iu").test(text);
}
const namedIn = (text: string, n: FamilyNode, nicknames?: Map<string, string[]>) =>
  mentioned(text, n.label) ||
  (!!n.alias && mentioned(text, n.alias)) ||
  (nicknames?.get(n.name.toLowerCase()) ?? []).some((w) => mentioned(text, w));

/** Everyone below the asker the request can mean. Empty = nobody; more than one = ask. */
export function pickRecipients(
  asker: FamilyNode,
  req: { kinship: Kinship | null; text: string; nicknames?: Map<string, string[]> }
): FamilyNode[] {
  const below = descendants(asker);
  const byKin = req.kinship ? below.filter((d) => matchesKinship(d.path, req.kinship!)) : below;
  const named = byKin.filter((d) => namedIn(req.text, d.node, req.nicknames));
  if (named.length) return named.map((d) => d.node);
  return req.kinship ? byKin.map((d) => d.node) : [];
}
