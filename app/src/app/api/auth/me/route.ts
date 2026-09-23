import { NextResponse } from "next/server";
import { isServableAssetUrl } from "@/lib/files/serve";
import { getSession } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { toPublicUser } from "@/lib/auth/public-user";
import { normalizeDisplayName, setUserDisplayName } from "@/lib/auth/display-name";
import { LANG_COOKIE, isLocale } from "@/i18n/locales";

export const dynamic = "force-dynamic";

/** PATCH { displayName?, avatarUrl?, homeCoverUrl?, language? } → { user }.
 * language is "ko" | "en" | "" (clear → follow the browser); it is also copied
 * into the `lang` cookie so the next server render paints in it at once. avatarUrl
 * must be an /uploads/* path (from POST /api/upload) or "" to clear the photo;
 * homeCoverUrl additionally accepts built-in /covers/* and "" resets to the
 * default cover. */
export async function PATCH(req: Request) {
  const session = await getSession();
  if (!session.userId)
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const patch: { avatarUrl?: string | null; homeCoverUrl?: string | null; language?: string | null } = {};
  let renamed: Awaited<ReturnType<typeof setUserDisplayName>> = null;

  if (typeof body?.displayName === "string") {
    const name = normalizeDisplayName(body.displayName);
    if (!name) return NextResponse.json({ error: "Name required" }, { status: 400 });
 // one global name — also refreshes the copies frozen into room titles,
 // agent names and the personal workspace
    renamed = await setUserDisplayName(session.userId, name);
    if (!renamed) return NextResponse.json({ error: "User not found" }, { status: 404 });
  }
  if (typeof body?.avatarUrl === "string") {
   // either the pre-migration disk path or the key-addressed serving path the
   // upload route returns once object storage is on — nothing else, so a
   // caller cannot point an avatar at an arbitrary url
    if (body.avatarUrl !== "" && !isServableAssetUrl(body.avatarUrl))
      return NextResponse.json(
        { error: "avatarUrl must be an /uploads/ or /api/files/key/ path" },
        { status: 400 }
      );
    patch.avatarUrl = body.avatarUrl === "" ? null : body.avatarUrl;
  }
  if (typeof body?.homeCoverUrl === "string") {
    if (
      body.homeCoverUrl !== "" &&
      !isServableAssetUrl(body.homeCoverUrl) &&
      !/^\/covers\/[\w.-]+$/.test(body.homeCoverUrl)
    )
      return NextResponse.json(
        { error: "homeCoverUrl must be an /uploads/, /covers/ or /api/files/key/ path" },
        { status: 400 }
      );
    patch.homeCoverUrl = body.homeCoverUrl === "" ? null : body.homeCoverUrl;
  }
  if (typeof body?.language === "string") {
    if (body.language !== "" && !isLocale(body.language))
      return NextResponse.json({ error: "Unsupported language" }, { status: 400 });
    patch.language = body.language === "" ? null : body.language;
  }
  if (Object.keys(patch).length === 0) {
    if (renamed) return NextResponse.json({ user: toPublicUser(renamed) });
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const [user] = await db
    .update(users)
    .set(patch)
    .where(eq(users.id, session.userId))
    .returning();
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });
  const res = NextResponse.json({ user: toPublicUser(user) });
  if ("language" in patch) {
    if (patch.language)
      res.cookies.set(LANG_COOKIE, patch.language, { path: "/", sameSite: "lax", maxAge: 60 * 60 * 24 * 365 });
    else res.cookies.set(LANG_COOKIE, "", { path: "/", maxAge: 0 });
  }
  return res;
}

export async function GET() {
  const session = await getSession();
  if (!session.userId) {
    return NextResponse.json({ user: null });
  }

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.id, session.userId))
    .limit(1);

  return NextResponse.json({ user: user ? toPublicUser(user) : null });
}
