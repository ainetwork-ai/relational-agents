import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { ensureWorkspace } from "@/lib/auth/provision";

export const dynamic = "force-dynamic";

/**
 * POST /api/auth/key-login
 * body: { privateKey: string, displayName?: string }
 *
 * Same contract as slack-a2a: derives the AIN address from the supplied
 * private key and logs the user in. The key never persists.
 */
export async function POST(req: NextRequest) {
  try {
    const { privateKey, displayName } = await req.json();

    if (typeof privateKey !== "string" || privateKey.length < 32) {
      return NextResponse.json(
        { error: "privateKey is required (hex string, 32+ bytes)" },
        { status: 400 }
      );
    }

    let address: string;
    try {
      const Ain = (await import("@ainblockchain/ain-js")).default;
      const ain = new Ain("https://devnet-api.ainetwork.ai", null, 0);
      const cleanKey = privateKey.startsWith("0x") ? privateKey.slice(2) : privateKey;
      address = ain.wallet.add(cleanKey);
    } catch (err) {
      return NextResponse.json(
        { error: "Invalid private key", details: err instanceof Error ? err.message : String(err) },
        { status: 400 }
      );
    }

    const normalizedAddress = address.toLowerCase();

    let [user] = await db
      .select()
      .from(users)
      .where(eq(users.ainAddress, normalizedAddress))
      .limit(1);

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

    const session = await getSession();
    session.userId = user.id;
    session.ainAddress = user.ainAddress;
    session.challenge = undefined;
    await session.save();

    return NextResponse.json({
      user: {
        id: user.id,
        displayName: user.displayName,
        ainAddress: user.ainAddress,
        avatarUrl: user.avatarUrl,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: "Internal server error", details: String(err) },
      { status: 500 }
    );
  }
}
