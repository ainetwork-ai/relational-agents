import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { pageShares } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

/** POST { password } → sets the unlock cookie for a password-protected link. */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const [share] = await db
    .select()
    .from(pageShares)
    .where(eq(pageShares.token, token))
    .limit(1);
  if (!share) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!share.passwordHash) return NextResponse.json({ ok: true });

  const body = await req.json().catch(() => ({}));
  const password = typeof body?.password === "string" ? body.password : "";
  const hash = createHash("sha256").update(password).digest("hex");
  if (hash !== share.passwordHash)
    return NextResponse.json({ error: "Wrong password" }, { status: 403 });

  const res = NextResponse.json({ ok: true });
 // LAN http serving → no `secure` flag (same trade-off as INSECURE_COOKIES)
  res.cookies.set(`share_pw_${token}`, hash, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
  return res;
}
