import { getIronSession, type SessionOptions } from "iron-session";
import { cookies } from "next/headers";

export interface SessionData {
  userId?: string;
  /** the workspace the user is currently viewing (workspace switcher) */
  activeWorkspaceId?: string;
}
// `ainAddress` and `challenge` lived here for the wallet logins. Both are gone:
// the address was a copy of users.ainAddress that nothing read back, and the
// challenge was the AIN sign-in nonce. A Google sign-in adds neither — the
// session stays a user id and the workspace being viewed.

const sessionOptions: SessionOptions = {
  password: process.env.SESSION_SECRET || "dev-secret-change-in-production-32ch",
  cookieName: "rm-session",
  cookieOptions: {
 // INSECURE_COOKIES=1 lets the harness smoke-test a production build over
 // plain http://127.0.0.1 (curl won't send Secure cookies over http).
    secure:
      process.env.NODE_ENV === "production" &&
      process.env.INSECURE_COOKIES !== "1",
    httpOnly: true,
    sameSite: "lax",
  },
};

export async function getSession() {
  const cookieStore = await cookies();
  return getIronSession<SessionData>(cookieStore, sessionOptions);
}
