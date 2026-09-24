import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { aindriveServer } from "@/lib/aindrive";
import { disconnectAccount, getAccount } from "@/lib/aindrive-account";

export const dynamic = "force-dynamic";

/**
 * The caller's own aindrive account.
 * GET    → { server, account: { email, name, expiresAt } | null }
 * DELETE → disconnect (their links stop working until they connect again)
 */
export async function GET() {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  const account = await getAccount(auth.user.id);
  return NextResponse.json({
    server: aindriveServer(),
    account: account && { email: account.email, name: account.name, expiresAt: account.expiresAt },
  });
}

export async function DELETE() {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  await disconnectAccount(auth.user.id);
  return NextResponse.json({ ok: true });
}
