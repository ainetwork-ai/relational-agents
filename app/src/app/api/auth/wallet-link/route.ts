// POST /api/auth/wallet-link — attach a MetaMask address to the account that is signed in now.
// Same challenge and EIP-191 check as /api/auth/metamask-verify, but it never switches accounts:
// the session keeps its user and active workspace. One wallet belongs to one account.
import { NextRequest, NextResponse } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { getSession } from "@/lib/auth/session";
import { verifyEthSignature } from "@/lib/auth/eth-verify";
import { challengeMessage } from "@/lib/auth/ain-verify";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

const TAKEN = { reason: "taken", error: "This wallet is already used by another account." } as const;

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session.userId) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { signature, address } = await req.json().catch(() => ({}));
  if (typeof signature !== "string" || typeof address !== "string") {
    return NextResponse.json({ error: "signature and address are required" }, { status: 400 });
  }
  const challenge = session.challenge;
  if (!challenge) return NextResponse.json({ error: "No challenge found. Please try again." }, { status: 401 });
  session.challenge = undefined; // one use, pass or fail
  await session.save();

  if (!verifyEthSignature(challengeMessage(challenge), signature, address)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const addr = address.toLowerCase();
  const [me] = await db.select().from(users).where(eq(users.id, session.userId)).limit(1);
  if (!me) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (me.ainAddress === addr) return NextResponse.json({ address: addr });
  if (me.ainAddress) {
    return NextResponse.json({ reason: "has-other", error: "This account already has another wallet." }, { status: 409 });
  }
  const [owner] = await db.select({ id: users.id }).from(users).where(eq(users.ainAddress, addr)).limit(1);
  if (owner) return NextResponse.json(TAKEN, { status: 409 });
  try {
    // `ain_address IS NULL` in the update too: two links racing for this account can't both win
    const updated = await db
      .update(users)
      .set({ ainAddress: addr })
      .where(and(eq(users.id, me.id), isNull(users.ainAddress)))
      .returning({ id: users.id });
    if (!updated.length) {
      return NextResponse.json({ reason: "has-other", error: "This account already has another wallet." }, { status: 409 });
    }
  } catch {
    return NextResponse.json(TAKEN, { status: 409 }); // lost a race on the unique column
  }
  session.ainAddress = addr;
  await session.save();
  return NextResponse.json({ address: addr });
}
