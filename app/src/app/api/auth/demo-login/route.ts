import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { and, eq, inArray, ne } from "drizzle-orm";
import { workspaceMembers, workspaces } from "@/lib/db/schema";
import { ensureWorkspace } from "@/lib/auth/provision";
import { toPublicUser } from "@/lib/auth/public-user";
import { familyDemo } from "@/i18n/content/demo-lang";

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
 *
 * With `member`, logs into one of the demo account's family by name (Grandma,
 * Dad, Seoyeon — people who share a workspace the demo account owns), landing in
 * that workspace. GET lists who can be picked.
 */

/** The demo account, and the people of the workspaces it owns. */
async function demoFamily() {
  const configured = (process.env.DEMO_LOGIN_ADDRESS ?? "").toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(configured)) return null;
  const [demo] = await db.select().from(users).where(eq(users.ainAddress, configured)).limit(1);
  if (!demo) return null;
  const owned = await db
    .select({ id: workspaceMembers.workspaceId })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .where(and(eq(workspaceMembers.userId, demo.id), eq(workspaceMembers.role, "owner")));
  if (!owned.length) return { demo, members: [] as { id: string; displayName: string; workspaceId: string }[] };
  const members = await db
    .select({ id: users.id, displayName: users.displayName, workspaceId: workspaceMembers.workspaceId })
    .from(workspaceMembers)
    .innerJoin(users, eq(users.id, workspaceMembers.userId))
    .where(and(inArray(workspaceMembers.workspaceId, owned.map((o) => o.id)), ne(users.id, demo.id), eq(users.isAgent, false)));
  return { demo, members };
}

export async function GET(req: NextRequest) {
  if (process.env.NODE_ENV === "production" && process.env.ENABLE_DEMO_LOGIN !== "1")
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  // ?as=<slug>: the link form of POST { as } — a clickable sign-in as a named
  // demo account (the Tokyo Trip members), then straight to the app. Same
  // guard and same accounts as POST; nothing a link can reach that POST can't.
  const as = req.nextUrl.searchParams.get("as")?.trim().slice(0, 32) ?? "";
  if (as) {
    const slug = as.toLowerCase().replace(/[^a-z0-9-_]/g, "");
    if (!slug) return NextResponse.json({ error: "Bad name" }, { status: 400 });
    await loginUser(`demo:${slug}`, as);
    // A relative Location, on purpose: inside the container req.nextUrl.origin
    // is the bind address (https://0.0.0.0:3000 — deployment.md §4.11), and this
    // host has no GOOGLE_REDIRECT_URI to borrow a public origin from. The
    // browser resolves "/" against the URL it actually requested.
    return new NextResponse(null, { status: 303, headers: { Location: "/" } });
  }
  const fam = await demoFamily();
  return NextResponse.json({
    demo: fam?.demo.displayName ?? null,
    members: [...new Set((fam?.members ?? []).map((m) => m.displayName))],
  });
}
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
  session.ainAddress = user.ainAddress ?? undefined;
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
    const member = typeof body?.member === "string" ? body.member.trim() : "";
    if (member) {
      const fam = await demoFamily();
      const who = fam?.members.find((m) => m.displayName === member);
      if (!who) return NextResponse.json({ error: "No such family member" }, { status: 404 });
      const session = await getSession();
      session.userId = who.id;
      session.ainAddress = undefined;
      session.challenge = undefined;
      // straight into the family's workspace, not their own empty one
      session.activeWorkspaceId = who.workspaceId;
      await session.save();
      const [user] = await db.select().from(users).where(eq(users.id, who.id));
      return NextResponse.json({ user: toPublicUser(user) });
    }
    const as = typeof body?.as === "string" ? body.as.trim().slice(0, 32) : "";
    if (as) {
      const slug = as.toLowerCase().replace(/[^a-z0-9-_]/g, "");
      if (!slug) return NextResponse.json({ error: "Bad name" }, { status: 400 });
      const user = await loginUser(`demo:${slug}`, as);
      return NextResponse.json({ user: toPublicUser(user) });
    }

   // The demo world hangs off one specific account (Mom — who made the
   // family workspace (FAMILY_WORKSPACE_NAME via i18n/content/demo-lang) and linked her aindrive folder into it, beside
   // grandma's and dad's; scripts/seed-family-demo.mts). DEMO_LOGIN_ADDRESS points
   // "Try the demo" straight at that account so the demo opens with its
   // workspaces instead of a fresh empty one. There is no second-best account
   // to fall back to: any other lands in an empty app that looks like data
   // loss, so an unset address fails loudly instead.
    const configured = process.env.DEMO_LOGIN_ADDRESS ?? "";
    if (!/^0x[0-9a-f]{40}$/i.test(configured))
      return NextResponse.json({ error: "Demo login is not configured" }, { status: 503 });

   // the account ships with a Chuseok full-moon home cover — seeded only at
   // creation, so a user-picked cover is never overwritten
    const user = await loginUser(
      configured.toLowerCase(),
      familyDemo().FAMILY.mom.name,
      "/covers/home-cover-family.jpg"
    );
    return NextResponse.json({ user: toPublicUser(user) });
  } catch (err) {
    return NextResponse.json(
      { error: "Internal server error", details: String(err) },
      { status: 500 }
    );
  }
}
