import { getIronSession, type SessionOptions } from "iron-session";
import { cookies } from "next/headers";

export interface SessionData {
  userId?: string;
  ainAddress?: string;
  challenge?: string;
  /** the workspace the user is currently viewing (workspace switcher) */
  activeWorkspaceId?: string;
}

const sessionOptions: SessionOptions = {
  password: process.env.SESSION_SECRET || "dev-secret-change-in-production-32ch",
  cookieName: "notion-session",
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
