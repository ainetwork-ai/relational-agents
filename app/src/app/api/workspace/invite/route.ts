import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { requireAuth } from "@/lib/auth/middleware";
import { db } from "@/lib/db";
import { inviteTokens } from "@/lib/db/schema";
import { and, desc, eq, gt } from "drizzle-orm";
import { getDefaultWorkspaceId } from "@/lib/workspace";
import { requireWorkspaceRole } from "@/lib/auth/workspace-role";

export const dynamic = "force-dynamic";

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function originFrom(req: NextRequest): string {
  const explicit = req.headers.get("origin");
  if (explicit) return explicit;
  const host = req.headers.get("host");
  const proto = req.headers.get("x-forwarded-proto") ?? "http";
  return host ? `${proto}://${host}` : req.nextUrl.origin;
}

/** GET → the current (latest, unexpired) invite for the caller's workspace. */
export async function GET(req: NextRequest) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;

  const workspaceId = await getDefaultWorkspaceId(auth.user.id);
  if (!workspaceId) return NextResponse.json({ invite: null });

  const [row] = await db
    .select()
    .from(inviteTokens)
    .where(
      and(
        eq(inviteTokens.workspaceId, workspaceId),
        gt(inviteTokens.expiresAt, new Date())
      )
    )
    .orderBy(desc(inviteTokens.createdAt))
    .limit(1);

  if (!row) return NextResponse.json({ invite: null });
  return NextResponse.json({
    invite: { token: row.token, url: `${originFrom(req)}/join/${row.token}` },
  });
}

/** POST → mint a fresh 7-day workspace invite link. */
export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;

  const workspaceId = await getDefaultWorkspaceId(auth.user.id);
  if (!workspaceId)
    return NextResponse.json({ error: "No workspace" }, { status: 400 });

  // Minting workspace invite links requires admin (or owner).
  const roleCheck = await requireWorkspaceRole(workspaceId, auth.user.id, "admin");
  if (roleCheck !== true) return roleCheck;

  const token = randomBytes(16).toString("hex");
  await db.insert(inviteTokens).values({
    token,
    workspaceId,
    createdBy: auth.user.id,
    expiresAt: new Date(Date.now() + INVITE_TTL_MS),
  });

  return NextResponse.json(
    { token, url: `${originFrom(req)}/join/${token}` },
    { status: 201 }
  );
}
