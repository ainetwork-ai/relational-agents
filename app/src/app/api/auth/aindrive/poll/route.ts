import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { getSession } from "@/lib/auth/session";
import { ensureWorkspace } from "@/lib/auth/provision";
import { toPublicUser } from "@/lib/auth/public-user";
import { pollPairing, saveAccount, type AindriveIdentity } from "@/lib/aindrive-account";

export const dynamic = "force-dynamic";

/**
 * The account this aindrive identity signs in to, or a new one.
 *
 * Keyed on the aindrive id only. Unlike Google, aindrive does not promise the
 * address is verified, so an existing account with the same email is NOT
 * adopted — that would let whoever controls an aindrive account with your
 * address walk into yours. Someone who already has an account here connects
 * aindrive from inside it once; from then on either sign-in lands the same.
 */
async function upsertUser(who: AindriveIdentity) {
  const [bySub] = await db.select().from(users).where(eq(users.aindriveSub, who.sub)).limit(1);
  if (bySub) return bySub;
  // the address is only kept when no other account uses it (users.email is unique)
  const [emailTaken] = who.email
    ? await db.select({ id: users.id }).from(users).where(eq(users.email, who.email)).limit(1)
    : [];
  const [created] = await db
    .insert(users)
    .values({
      aindriveSub: who.sub,
      email: who.email && !emailTaken ? who.email : null,
      displayName: who.name?.trim() || who.email?.split("@")[0] || "aindrive user",
    })
    .returning();
  return created;
}

/** POST { pairingId } → { state: "pending" | "expired" } or, once approved,
 *  { state: "connected", user } with this browser signed in. */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { pairingId?: unknown };
  const session = await getSession();
  if (typeof body.pairingId !== "string" || body.pairingId !== session.aindrivePairing)
    return NextResponse.json({ state: "expired" }, { status: 400 });
  try {
    const r = await pollPairing(null, body.pairingId);
    if (r.state !== "connected") {
      if (r.state === "expired") {
        session.aindrivePairing = undefined;
        await session.save();
      }
      return NextResponse.json({ state: r.state });
    }
    const user = await upsertUser(r.identity!);
    // signed in, and the aindrive account connected in the same step — every
    // drive of it is usable from the first screen
    await saveAccount(user.id, r.server!, r.token!, r.identity!);
    session.userId = user.id;
    session.aindrivePairing = undefined;
    session.activeWorkspaceId = undefined;
    session.ainAddress = undefined;
    await session.save();
    await ensureWorkspace(user.id, user.displayName);
    return NextResponse.json({ state: "connected", user: toPublicUser(user) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
