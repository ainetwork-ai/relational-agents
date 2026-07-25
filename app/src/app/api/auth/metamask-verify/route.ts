import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { ensureWorkspace } from "@/lib/auth/provision";
import { toPublicUser } from "@/lib/auth/public-user";

export const dynamic = "force-dynamic";

/**
 * POST /api/auth/metamask-verify
 *   body: { signature: string, address: string, displayName?: string }
 *
 * MetaMask sign-in: the client fetches GET /api/auth/challenge, signs the
 * returned message with `personal_sign`, and posts the signature here.
 * Verification is EIP-191 (personal_sign) recovery — distinct from the AIN
 * wallet flow in /api/auth/verify, but shares the same challenge + user
 * provisioning. MetaMask addresses live in the same `ainAddress` column
 * (both are 0x-prefixed secp256k1 addresses).
 */
export async function POST(req: NextRequest) {
  try {
    const { signature, address, displayName } = await req.json();

    if (typeof signature !== "string" || typeof address !== "string") {
      return NextResponse.json(
        { error: "signature and address are required" },
        { status: 400 }
      );
    }

    const session = await getSession();
    if (!session.challenge) {
      return NextResponse.json(
        { error: "No challenge found. Please try again." },
        { status: 400 }
      );
    }

    let valid = false;
    try {
      const { verifyEthSignature } = await import("@/lib/auth/eth-verify");
      const { challengeMessage } = await import("@/lib/auth/ain-verify");
      valid = await verifyEthSignature(
        challengeMessage(session.challenge),
        signature,
        address
      );
    } catch {
      valid = false;
    }

    if (!valid) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }

    const normalizedAddress = address.toLowerCase();

    const [existing] = await db
      .select()
      .from(users)
      .where(eq(users.ainAddress, normalizedAddress))
      .limit(1);

    let user = existing;
    // Returning user typed a (different) name → honor it. Login is the only
    // place the form offers a name, so this is how you rename yourself.
    if (user && typeof displayName === "string" && displayName.trim() && displayName.trim() !== user.displayName) {
      const [renamed] = await db
        .update(users)
        .set({ displayName: displayName.trim() })
        .where(eq(users.id, user.id))
        .returning();
      user = renamed;
    }
    if (!user) {
      const [created] = await db
        .insert(users)
        .values({
          ainAddress: normalizedAddress,
          displayName: displayName || `User-${address.slice(0, 8)}`,
          status: "online",
        })
        .returning();
      user = created;
    }

    await ensureWorkspace(user.id, user.displayName);

    session.userId = user.id;
    session.ainAddress = user.ainAddress;
    session.challenge = undefined;
    // switching accounts invalidates the previous account's active workspace (same as demo-login)
    session.activeWorkspaceId = undefined;
    await session.save();

    return NextResponse.json({ user: toPublicUser(user) });
  } catch (err) {
    return NextResponse.json(
      { error: "Internal server error", details: String(err) },
      { status: 500 }
    );
  }
}
