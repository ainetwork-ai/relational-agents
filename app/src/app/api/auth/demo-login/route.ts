import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { ensureWorkspace } from "@/lib/auth/provision";
import { toPublicUser } from "@/lib/auth/public-user";

export const dynamic = "force-dynamic";

/**
 * POST /api/auth/demo-login { as?: string }
 *
 * Logs the caller into the account named by DEMO_LOGIN_ADDRESS, so visitors
 * can try the app without a wallet.
 *
 * With `as`, logs into (or creates) a named secondary demo account (address
 * `demo:<slug>`) — for DM demos/e2e needing two accounts in one browser.
 * Wallet addresses are 0x…-shaped, so the `demo:` namespace can't collide.
 */
async function loginUser(ainAddress: string, displayName: string, homeCoverUrl?: string) {
  let [user] = await db.select().from(users).where(eq(users.ainAddress, ainAddress)).limit(1);
  if (!user) {
    const [created] = await db
      .insert(users)
      .values({ ainAddress, displayName, status: "online", homeCoverUrl })
      .returning();
    user = created;
  }
  await ensureWorkspace(user.id, user.displayName);
  const session = await getSession();
  session.userId = user.id;
  session.ainAddress = user.ainAddress;
  session.challenge = undefined;
 // switching accounts invalidates the previous account's active workspace
  session.activeWorkspaceId = undefined;
  await session.save();
  return user;
}

export async function POST(req: NextRequest) {
  try {
 // Demo login attaches to accounts without credentials (the configured
 // account + deterministic `as` accounts). Disabled in production unless
 // explicitly enabled — removes the account-takeover surface.
    if (process.env.NODE_ENV === "production" && process.env.ENABLE_DEMO_LOGIN !== "1")
      return NextResponse.json({ error: "Not found" }, { status: 404 });

    const body = await req.json().catch(() => ({}));
    const as = typeof body?.as === "string" ? body.as.trim().slice(0, 32) : "";
    if (as) {
      const slug = as.toLowerCase().replace(/[^a-z0-9-_]/g, "");
      if (!slug) return NextResponse.json({ error: "Bad name" }, { status: 400 });
      const user = await loginUser(`demo:${slug}`, as);
      return NextResponse.json({ user: toPublicUser(user) });
    }

   // The demo world hangs off one specific account (Chanho — owner of the
   // girlfriend workspaces, DM rooms and agents). DEMO_LOGIN_ADDRESS points
   // "Try the demo" straight at that account so the demo opens with its
   // workspaces instead of a fresh empty one. There is no second-best account
   // to fall back to: any other lands in an empty app that looks like data
   // loss, so an unset address fails loudly instead.
    const configured = process.env.DEMO_LOGIN_ADDRESS ?? "";
    if (!/^0x[0-9a-f]{40}$/i.test(configured))
      return NextResponse.json({ error: "Demo login is not configured" }, { status: 503 });

   // the account ships with its own azulejo home cover — seeded only at
   // creation, so a user-picked cover is never overwritten
    const user = await loginUser(
      configured.toLowerCase(),
      "Chanho",
      "/covers/home-cover-chanho.png"
    );
    return NextResponse.json({ user: toPublicUser(user) });
  } catch (err) {
    return NextResponse.json(
      { error: "Internal server error", details: String(err) },
      { status: 500 }
    );
  }
}
