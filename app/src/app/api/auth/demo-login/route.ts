import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { ensureWorkspace } from "@/lib/auth/provision";
import { toPublicUser } from "@/lib/auth/public-user";

export const dynamic = "force-dynamic";

/**
 * POST /api/auth/demo-login  { as?: string }
 *
 * Logs the caller in as the shared "DemoUser" (same public demo key as
 * slack-a2a) so visitors can try the app without a wallet.
 *
 * `as`가 오면 그 이름의 보조 데모 계정(주소 `demo:<slug>`)으로 로그인/생성 —
 * 한 브라우저 2계정이 필요한 DM 데모·e2e용. 지갑 주소는 0x… 형식이라
 * `demo:` 네임스페이스와 충돌하지 않는다.
 */
const FALLBACK_DEMO_KEY =
  "b796e8971f2c5c909a2178fb3fc1970f317adb1e9237d950d8fcdd5f5e1d7e42";

async function loginUser(ainAddress: string, displayName: string) {
  let [user] = await db.select().from(users).where(eq(users.ainAddress, ainAddress)).limit(1);
  if (!user) {
    const [created] = await db
      .insert(users)
      .values({ ainAddress, displayName, status: "online" })
      .returning();
    user = created;
  }
  await ensureWorkspace(user.id, user.displayName);
  const session = await getSession();
  session.userId = user.id;
  session.ainAddress = user.ainAddress;
  session.challenge = undefined;
  // 계정을 바꿔 로그인하면 이전 계정의 활성 워크스페이스는 무효
  session.activeWorkspaceId = undefined;
  await session.save();
  return user;
}

export async function POST(req: NextRequest) {
  try {
    // 데모 로그인은 자격증명 없이 계정에 붙는다(공유 데모 키 + `as` 결정적 계정).
    // 프로덕션에서는 명시적으로 켜지 않는 한 비활성 — 계정 탈취 표면을 없앤다.
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

    const privateKey = process.env.DEMO_PRIVATE_KEY || FALLBACK_DEMO_KEY;

    let address: string;
    try {
      const Ain = (await import("@ainblockchain/ain-js")).default;
      const ain = new Ain("https://devnet-api.ainetwork.ai", null, 0);
      const clean = privateKey.startsWith("0x") ? privateKey.slice(2) : privateKey;
      address = ain.wallet.add(clean);
    } catch (err) {
      return NextResponse.json(
        { error: "Demo login unavailable", details: err instanceof Error ? err.message : String(err) },
        { status: 500 }
      );
    }

    const user = await loginUser(address.toLowerCase(), "DemoUser");
    return NextResponse.json({ user: toPublicUser(user) });
  } catch (err) {
    return NextResponse.json(
      { error: "Internal server error", details: String(err) },
      { status: 500 }
    );
  }
}
