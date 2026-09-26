// /api/workspaces/[workspaceId]/ens — the workspace's ENS family
// (docs/superpowers/plans/2026-09-26-ens-family-settings.md, Task 6).
//   GET                         state: the tree, its expiry, who can edit, who could be added, and per
//                               node `canAdd` (Task 7b); `?fresh=1` re-reads the tree after a write
//   GET ?label=lee              is lee.eth free for this workspace (F11, F14)
//   GET ?parent=<name>&label=x  is x.<name> free inside the family (F15)
//   POST { familyLabel, fromBlock }  link <familyLabel>.eth to this workspace — only when the
//                                    caller's wallet owns it onchain (Review Focus 3)
// The server only reads Sepolia here; it holds no key and sends no transaction.
import { NextRequest, NextResponse } from "next/server";
import { and, eq, ne } from "drizzle-orm";
import { zeroAddress, type Address } from "viem";
import { db } from "@/lib/db";
import { users, workspaceMembers } from "@/lib/db/schema";
import { hasRole } from "@/lib/auth/workspace-role";
import { linkedWallet } from "@/lib/wallet/linked";
import { ensReader } from "@/lib/ens-chain";
import {
  familyChainFor,
  forgetFamilyChain,
  familyLabelStatus,
  getWorkspaceFamily,
  releaseLabel,
  setWorkspaceFamily,
  workspaceOfRoot,
} from "@/lib/ens-workspace";
import { ethExpiry, ethNameStatus, holdsAllRoles, subnameStatus } from "@/lib/ens-family/availability";
import { registryAbi } from "@/lib/ens-family/abi";
import { ETH_REGISTRY } from "@/lib/ens-family/config";
import { checkLabel, suggestLabels } from "@/lib/ens-family/labels";
import { descendants, type FamilyNode } from "@/lib/ens-family/family-tree";
import { chainUnavailable, requireFamilyAdmin, requireMember } from "./guard";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ workspaceId: string }> };

export interface TreeNode {
  name: string;
  label: string;
  alias: string | null;
  relation: string | null;
  avatar: string | null;
  address: string | null;
  registry: string | null;
  /** The viewer (an admin) can add a child or spouse under this person: their wallet holds every
   *  role on the registry the new name is written into (Task 7b). Always false for the family root. */
  canAdd: boolean;
  children: TreeNode[];
}

const toTreeNode = (n: FamilyNode, canAdd: ReadonlySet<string>): TreeNode => ({
  name: n.name,
  label: n.label,
  alias: n.alias,
  relation: n.relation,
  avatar: n.avatar,
  address: n.address,
  registry: n.registry ?? null,
  canAdd: canAdd.has(n.name),
  children: n.children.map((c) => toTreeNode(c, canAdd)),
});

/**
 * The people under whom `wallet` can add someone. addMember writes into the person's own subregistry
 * when it exists (register needs its roles), else into the registry the person is registered in
 * (setSubregistry there, then a registry the wallet deploys itself). One hasRootRoles read per
 * distinct registry, cached for this request.
 */
async function addableNames(tree: FamilyNode, wallet: Address): Promise<Set<string>> {
  const pub = ensReader();
  const memo = new Map<string, Promise<boolean>>();
  const holds = (registry: string) => {
    const k = registry.toLowerCase();
    if (!memo.has(k)) memo.set(k, holdsAllRoles(pub, registry as Address, wallet).catch(() => false));
    return memo.get(k)!;
  };
  const out = new Set<string>();
  const walk = async (parent: FamilyNode): Promise<void> => {
    await Promise.all(
      parent.children.map(async (n) => {
        const target = n.registry ?? parent.registry ?? null;
        if (target && (await holds(target))) out.add(n.name);
        await walk(n);
      })
    );
  };
  await walk(tree);
  return out;
}

/** "lee" for "lee.eth"; null for anything else (the kim.ainmem.eth fallback is not a .eth 2LD). */
const ethLabelOf = (root: string) => /^([a-z0-9-]+)\.eth$/.exec(root)?.[1] ?? null;

export async function GET(req: NextRequest, ctx: Ctx) {
  const { workspaceId } = await ctx.params;
  const m = await requireMember(workspaceId);
  if ("error" in m) return m.error;

  const sp = new URL(req.url).searchParams;
  const label = sp.get("label");
  const parent = sp.get("parent");
  if (label !== null && parent !== null) return subnameAvailability(workspaceId, parent, label);
  if (label !== null) {
    try {
      return NextResponse.json(await familyLabelStatus(label, workspaceId));
    } catch (e) {
      return chainUnavailable(e);
    }
  }

  const canEdit = hasRole(m.role, "admin");
  const mapped = await getWorkspaceFamily(workspaceId);
  let chain = await familyChainFor(workspaceId);
  // after an add: drop the cached tree (and its chain) so the new name shows
  // (admins only: they are the ones who add, and it costs a full re-read from Sepolia)
  if (chain && canEdit && sp.get("fresh") === "1") {
    forgetFamilyChain(chain.root);
    chain = await familyChainFor(workspaceId);
  }
  let family: null | {
    root: string;
    source: "workspace" | "default";
    registry: string | null;
    expiresAt: string | null;
    inGrace: boolean;
    tree: TreeNode;
  } = null;
  let tree: FamilyNode | null = null;
  if (chain) {
    try {
      tree = await chain.loadTree();
      // only a <label>.eth root has a registration that expires; the env fallback
      // (kim.ainmem.eth) is a subname and lives as long as ainmem.eth — so null here is correct
      const ethLabel = ethLabelOf(chain.root);
      const exp = ethLabel ? await ethExpiry(ensReader(), ethLabel) : null;
      family = {
        root: chain.root,
        source: mapped ? "workspace" : "default",
        registry: tree.registry ?? null,
        expiresAt: exp ? new Date(exp.expiresAt * 1000).toISOString() : null,
        inGrace: exp?.inGrace ?? false,
        tree: toTreeNode(tree, canEdit && m.wallet ? await addableNames(tree, m.wallet) : new Set()),
      };
    } catch (e) {
      return chainUnavailable(e);
    }
  }

  // Wallet addresses of other members are for the people who can add them (admins) only.
  let candidates: { userId: string; displayName: string; address: string }[] = [];
  if (canEdit) {
    const inTree = new Set(
      (tree ? [tree, ...descendants(tree).map((d) => d.node)] : []).flatMap((n) => (n.address ? [n.address.toLowerCase()] : []))
    );
    const rows = await db
      .select({ id: users.id, displayName: users.displayName, ainAddress: users.ainAddress, isAgent: users.isAgent })
      .from(workspaceMembers)
      .innerJoin(users, eq(workspaceMembers.userId, users.id))
      .where(and(eq(workspaceMembers.workspaceId, workspaceId), ne(workspaceMembers.role, "guest")));
    candidates = rows
      .filter((r) => !r.isAgent)
      .map((r) => ({ userId: r.id, displayName: r.displayName, address: linkedWallet(r) }))
      .filter((r): r is { userId: string; displayName: string; address: `0x${string}` } => !!r.address && !inTree.has(r.address));
  }

  return NextResponse.json({ me: { address: m.wallet, canEdit }, family, candidates });
}

/** Is `<label>.<parent>` free? `parent` must be a name in this workspace's own tree. */
async function subnameAvailability(workspaceId: string, parent: string, input: string) {
  const checked = checkLabel(input);
  if (!checked.ok) {
    return NextResponse.json({ label: input.trim().toLowerCase(), status: "invalid", reason: checked.reason, suggestions: [] });
  }
  const label = checked.label;
  const chain = await familyChainFor(workspaceId);
  if (!chain) return NextResponse.json({ reason: "no-family", error: "This workspace has no family yet." }, { status: 404 });
  try {
    const tree = await chain.loadTree();
    const node = [tree, ...descendants(tree).map((d) => d.node)].find((n) => n.name === parent.trim().toLowerCase());
    if (!node) return NextResponse.json({ reason: "unknown-parent", error: "That name is not in this family." }, { status: 404 });
    const pub = ensReader();
    const taken = new Set(node.children.map((c) => c.label));
    // no registry under this person yet: nothing can be registered below them, so every label is free
    const isFree = async (l: string) =>
      !taken.has(l) &&
      (!node.registry ||
        (await subnameStatus(pub, { parentName: node.name, parentRegistry: node.registry as Address, label: l })) === "free");
    if (await isFree(label)) return NextResponse.json({ label, status: "free", suggestions: [] });
    const cands = suggestLabels(label, 6);
    const ok = await Promise.all(cands.map(isFree));
    return NextResponse.json({ label, status: "taken", suggestions: cands.filter((_, i) => ok[i]).slice(0, 3) });
  } catch (e) {
    return chainUnavailable(e);
  }
}

const DECIMAL = /^\d{1,15}$/;

export async function POST(req: NextRequest, ctx: Ctx) {
  const { workspaceId } = await ctx.params;
  const a = await requireFamilyAdmin(workspaceId);
  if ("error" in a) return a.error;

  const body = await req.json().catch(() => ({}));
  const fromBlockRaw = typeof body?.fromBlock === "number" ? String(body.fromBlock) : body?.fromBlock;
  if (typeof body?.familyLabel !== "string" || typeof fromBlockRaw !== "string" || !DECIMAL.test(fromBlockRaw)) {
    return NextResponse.json({ error: "familyLabel and fromBlock (a block number) are required" }, { status: 400 });
  }
  // every later read scans logs from this block; public RPCs refuse a scan from genesis
  if (BigInt(fromBlockRaw) === BigInt(0)) {
    return NextResponse.json(
      { error: "fromBlock must be the block the family registry was deployed in (its receipt's blockNumber)" },
      { status: 400 }
    );
  }
  if (await getWorkspaceFamily(workspaceId)) {
    return NextResponse.json({ reason: "exists", error: "This workspace already has a family name." }, { status: 409 });
  }
  const checked = checkLabel(body.familyLabel, { min: 3 });
  if (!checked.ok) return NextResponse.json({ reason: checked.reason, error: "Not a valid .eth label" }, { status: 400 });
  const label = checked.label;
  const root = `${label}.eth`;

  // Review Focus 3: the caller's wallet owns <label>.eth, and holds every role on its subregistry.
  try {
    const pub = ensReader();
    const st = await ethNameStatus(pub, label, a.wallet);
    let yours = st.status === "ours" && !st.inGrace;
    if (yours) {
      const sub = await pub.readContract({ address: ETH_REGISTRY, abi: registryAbi, functionName: "getSubregistry", args: [label] });
      yours = sub !== zeroAddress && (await holdsAllRoles(pub, sub, a.wallet));
    }
    if (!yours) {
      return NextResponse.json(
        { reason: "not-yours", error: `${root} is not owned by your wallet with its family registry.` },
        { status: 422 }
      );
    }
  } catch (e) {
    return chainUnavailable(e);
  }

  // only after ownership is proven, so this cannot be used to probe other workspaces' names
  if (await workspaceOfRoot(root)) {
    return NextResponse.json({ reason: "exists", error: `${root} is already linked to another workspace.` }, { status: 409 });
  }
  const saved = await setWorkspaceFamily({ workspaceId, rootName: root, fromBlock: BigInt(fromBlockRaw), createdBy: a.user.id });
  if (saved === "exists") {
    return NextResponse.json({ reason: "exists", error: "This workspace or this name already has a link." }, { status: 409 });
  }
  releaseLabel(label, workspaceId);
  return NextResponse.json({ root });
}
