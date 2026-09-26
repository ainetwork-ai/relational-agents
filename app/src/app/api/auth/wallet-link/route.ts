// POST /api/auth/wallet-link { signature, address } — prove a MetaMask address for the account
// that is signed in now. Same challenge and EIP-191 check as /api/auth/metamask-verify, but it never
// switches accounts: the session keeps its user and active workspace. One wallet belongs to one account.
//
// A valid signature sets users.wallet_verified_at together with ain_address:
//   - no wallet yet, or the same address unproven → linked and proven;
//   - an unproven 0x address (seeded placeholder, older data) → replaced by the signing wallet;
//   - a proven different wallet stays (the family names are owned by it onchain): 409 has-other;
//   - anything that is not a 0x address (demo:<slug>, other login ids) is a sign-in identity and
//     stays: 409 has-other.
import { NextRequest, NextResponse } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { getSession } from "@/lib/auth/session";
import { verifyEthSignature } from "@/lib/auth/eth-verify";
import { challengeMessage } from "@/lib/auth/ain-verify";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { linkedWallet } from "@/lib/wallet/linked";

export const dynamic = "force-dynamic";

const EVM_ADDRESS = /^0x[0-9a-f]{40}$/;
const TAKEN = { reason: "taken", error: "This wallet is already used by another account." } as const;
const CHANGED = { reason: "changed", error: "This account's wallet changed meanwhile. Try again." } as const;

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session.userId) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { signature, address } = await req.json().catch(() => ({}));
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
  // a proven wallet, or a sign-in id that is not a wallet, stays: only an unproven 0x address is replaced
  if (old && (!linkedWallet(me) || me.walletVerifiedAt)) {
    return NextResponse.json({ reason: "has-other", error: "This account already has another wallet." }, { status: 409 });
  }

  const [owner] = await db.select({ id: users.id }).from(users).where(eq(users.ainAddress, addr)).limit(1);
  if (owner) return NextResponse.json(TAKEN, { status: 409 });

  try {
    // The WHERE repeats what was checked above (the old address, still unproven), so a link racing
    // this one for the same account cannot be overwritten by it: zero rows → changed.
    const updated = await db
      .update(users)
      .set({ ainAddress: addr, walletVerifiedAt: now })
      .where(
        and(
          eq(users.id, me.id),
          old ? eq(users.ainAddress, old) : isNull(users.ainAddress),
          old ? isNull(users.walletVerifiedAt) : undefined
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
