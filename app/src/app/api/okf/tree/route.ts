import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { listTree, type TreeNode } from "@/lib/okf-store";
import { okfGateFor, type OkfGate } from "@/lib/okf-acl";

export const dynamic = "force-dynamic";

/** 참여자 전용 노드(와 그 하위)를 트리에서 제거. */
function prune(nodes: TreeNode[], gate: OkfGate): TreeNode[] {
  return nodes
    .filter((n) => gate.canRead(n.id))
    .map((n) => (n.children ? { ...n, children: prune(n.children, gate) } : n));
}

/** GET → the OKF folder tree (the content DB's structure). */
export async function GET() {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  const gate = await okfGateFor(auth.user.id);
  return NextResponse.json({ tree: prune(listTree(), gate) });
}
