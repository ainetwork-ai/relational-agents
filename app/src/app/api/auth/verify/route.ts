import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { ensureWorkspace } from "@/lib/auth/provision";
import { toPublicUser } from "@/lib/auth/public-user";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const { signature, address, displayName } = await req.json();

    const session = await getSession();
    if (!session.challenge) {
      return NextResponse.json(
        { error: "No challenge found. Please try again." },
        { status: 400 }
      );
    }

    let valid = false;
    try {
      const { verifyAinSignature, challengeMessage } = await import(
        "@/lib/auth/ain-verify"
      );
      valid = verifyAinSignature(challengeMessage(session.challenge), signature, address);
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
    await session.save();

    return NextResponse.json({ user: toPublicUser(user) });
  } catch (err) {
    return NextResponse.json(
      { error: "Internal server error", details: String(err) },
      { status: 500 }
    );
  }
}
