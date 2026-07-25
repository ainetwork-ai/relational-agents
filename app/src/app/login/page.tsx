import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { LoginForm } from "@/components/login-form";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

export const metadata = { title: "Relational Memory" };

export default async function LoginPage() {
  const session = await getSession();
 // Only bounce to the app if the session points at a REAL user. A stale cookie
 // (userId set but the user was removed) must fall through to the form —
 // otherwise /login → / (layout: user not found) → /login ping-pongs into
 // ERR_TOO_MANY_REDIRECTS.
  if (session.userId) {
    const [user] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, session.userId))
      .limit(1);
    if (user) redirect("/");
  }
  return <LoginForm />;
}
