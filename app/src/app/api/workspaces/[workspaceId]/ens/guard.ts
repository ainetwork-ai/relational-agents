// Shared checks for /api/workspaces/[workspaceId]/ens and …/ens/reserve
// (docs/superpowers/plans/2026-09-26-ens-family-settings.md, Task 6, F5).
import "server-only";
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { getWorkspaceRole, hasRole, type WorkspaceRole } from "@/lib/auth/workspace-role";
import { linkedWallet, verifiedWallet } from "@/lib/wallet/linked";
import type { User } from "@/lib/db/schema";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `wallet`: the account's proven wallet (verifiedWallet), the only one family writes act as.
 *  `linked`: whatever 0x address the account lists, proven or not (for telling the user). */
export type Member = { user: User; role: WorkspaceRole; wallet: `0x${string}` | null; linked: `0x${string}` | null };

/** Signed in (401) and a member of this workspace (403). Guests (DM plumbing) do not count. */
export async function requireMember(workspaceId: string): Promise<Member | { error: NextResponse }> {
  const auth = await requireAuth();
  if (!auth.user) return { error: auth.error };
  const role = UUID.test(workspaceId) ? await getWorkspaceRole(workspaceId, auth.user.id) : null;
  if (!role || !hasRole(role, "member")) {
    return { error: NextResponse.json({ error: "Not a workspace member" }, { status: 403 }) };
  }
  return { user: auth.user, role, wallet: verifiedWallet(auth.user), linked: linkedWallet(auth.user) };
}

/** requireMember, then admin/owner (403), then a proven 0x wallet (412) — in that order. */
export async function requireFamilyAdmin(
  workspaceId: string
): Promise<(Member & { wallet: `0x${string}` }) | { error: NextResponse }> {
  const m = await requireMember(workspaceId);
  if ("error" in m) return m;
  if (!hasRole(m.role, "admin")) {
    return { error: NextResponse.json({ error: "Only workspace admins can change family names." }, { status: 403 }) };
  }
  if (!m.wallet) {
    return {
      error: NextResponse.json(
        { reason: "no-wallet", error: "Connect MetaMask to prove this account's wallet first." },
        { status: 412 }
      ),
    };
  }
  return { ...m, wallet: m.wallet };
}

/** A Sepolia read failed: say so plainly instead of a 500. */
export function chainUnavailable(err: unknown): NextResponse {
  console.error("[ens] Sepolia read failed:", err instanceof Error ? err.message : err);
  return NextResponse.json(
    { reason: "chain-unavailable", error: "Could not reach Sepolia right now. Try again in a moment." },
    { status: 502 }
  );
}
