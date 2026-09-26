// POST /api/auth/wallet-link { signature, address, replace? } — prove a MetaMask address for the account
// that is signed in now. Same challenge and EIP-191 check as /api/auth/metamask-verify, but it never
// switches accounts: the session keeps its user and active workspace. One wallet belongs to one account.
//
// A valid signature sets users.wallet_verified_at together with ain_address:
//   - no wallet yet, or the same address unproven → linked and proven;
//   - an unproven 0x address (seeded placeholder, older data) → replaced by the signing wallet;
//   - a proven different wallet → 409 has-verified, unless the client sends `replace: true` after
//     warning the user; even then 409 owns-family while that wallet owns the .eth family name of a
//     workspace this account administers (the name stays with the old wallet, so switching would
//     lock the account out of its own family);
//   - anything that is not a 0x address (demo:<slug>, other login ids) is a sign-in identity and
//     stays: 409 has-other.
import { NextRequest, NextResponse } from "next/server";
import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { getSession } from "@/lib/auth/session";
import { verifyEthSignature } from "@/lib/auth/eth-verify";
import { challengeMessage } from "@/lib/auth/ain-verify";
import { db } from "@/lib/db";
import { users, workspaceEns, workspaceMembers } from "@/lib/db/schema";
import { linkedWallet } from "@/lib/wallet/linked";
import { ensReader } from "@/lib/ens-chain";
import { ethNameStatus } from "@/lib/ens-family/availability";

export const dynamic = "force-dynamic";

const EVM_ADDRESS = /^0x[0-9a-f]{40}$/;
const TAKEN = { reason: "taken", error: "This wallet is already used by another account." } as const;
const CHANGED = { reason: "changed", error: "This account's wallet changed meanwhile. Try again." } as const;

/** The first .eth family root of a workspace this user administers that `wallet` owns onchain (or null). */
async function familyOwnedBy(userId: string, wallet: `0x${string}`): Promise<string | null> {
  const rows = await db
    .select({ root: workspaceEns.rootName })
    .from(workspaceEns)
    .innerJoin(workspaceMembers, eq(workspaceMembers.workspaceId, workspaceEns.workspaceId))
    .where(and(eq(workspaceMembers.userId, userId), inArray(workspaceMembers.role, ["owner", "admin"])));
  const pub = ensReader();
  for (const { root } of rows) {
    // only a <label>.eth root has an owner of its own; a subname root lives under its parent
    const label = /^([a-z0-9-]+)\.eth$/.exec(root)?.[1];
    if (label && (await ethNameStatus(pub, label, wallet)).status === "ours") return root;
  }
  return null;
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session.userId) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { signature, address, replace } = await req.json().catch(() => ({}));
  if (typeof signature !== "string" || typeof address !== "string") {
    return NextResponse.json({ error: "signature and address are required" }, { status: 400 });
  }
  const challenge = session.challenge;
  if (!challenge) return NextResponse.json({ reason: "no-challenge", error: "No challenge found. Please try again." }, { status: 401 });
  session.challenge = undefined; // one use, pass or fail
  await session.save();

  const addr = address.toLowerCase();
  if (!EVM_ADDRESS.test(addr)) return NextResponse.json({ reason: "invalid-signature", error: "Invalid address" }, { status: 400 });
  if (!verifyEthSignature(challengeMessage(challenge), signature, address)) {
    return NextResponse.json({ reason: "invalid-signature", error: "Invalid signature" }, { status: 401 });
  }

  const [me] = await db.select().from(users).where(eq(users.id, session.userId)).limit(1);
  if (!me) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const now = new Date();
  if (me.ainAddress === addr) {
    // the same address, now proven (a no-op when it already was)
    if (!me.walletVerifiedAt) {
      await db.update(users).set({ walletVerifiedAt: now }).where(and(eq(users.id, me.id), eq(users.ainAddress, addr)));
    }
    session.ainAddress = addr;
    await session.save();
    return NextResponse.json({ address: addr });
  }

  const old = me.ainAddress;
  const oldWallet = linkedWallet(me);
  if (old && !oldWallet) {
    return NextResponse.json({ reason: "has-other", error: "This account already has another wallet." }, { status: 409 });
  }
  const oldVerified = !!oldWallet && !!me.walletVerifiedAt;

  const [owner] = await db.select({ id: users.id }).from(users).where(eq(users.ainAddress, addr)).limit(1);
  if (owner) return NextResponse.json(TAKEN, { status: 409 });

  if (oldVerified && oldWallet) {
    if (replace !== true) {
      return NextResponse.json(
        { reason: "has-verified", current: oldWallet, error: "This account already has another proven wallet." },
        { status: 409 }
      );
    }
    let root: string | null;
    try {
      root = await familyOwnedBy(me.id, oldWallet);
    } catch (e) {
      console.error("[wallet-link] Sepolia read failed:", e instanceof Error ? e.message : e);
      return NextResponse.json(
        { reason: "chain-unavailable", error: "Could not reach Sepolia right now. Try again in a moment." },
        { status: 502 }
      );
    }
    if (root) {
      return NextResponse.json(
        { reason: "owns-family", name: root, current: oldWallet, error: `${root} is owned by this account's wallet ${oldWallet}.` },
        { status: 409 }
      );
    }
  }

  try {
    // The WHERE repeats what was checked above (the old address and whether it was proven), so a
    // link racing this one for the same account cannot be overwritten by it: zero rows → changed.
    const updated = await db
      .update(users)
      .set({ ainAddress: addr, walletVerifiedAt: now })
      .where(
        and(
          eq(users.id, me.id),
          old ? eq(users.ainAddress, old) : isNull(users.ainAddress),
          oldVerified ? isNotNull(users.walletVerifiedAt) : old ? isNull(users.walletVerifiedAt) : undefined
        )
      )
      .returning({ id: users.id });
    if (!updated.length) return NextResponse.json(CHANGED, { status: 409 });
  } catch {
    return NextResponse.json(TAKEN, { status: 409 }); // lost a race on the unique column
  }
  session.ainAddress = addr;
  await session.save();
  return NextResponse.json({ address: addr, replaced: old ?? null });
}
