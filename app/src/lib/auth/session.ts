import { getIronSession, type SessionOptions } from "iron-session";
import { cookies } from "next/headers";

export interface SessionData {
  userId?: string;
  /** the workspace the user is currently viewing (workspace switcher) */
  activeWorkspaceId?: string;
  /** CSRF state for an in-flight Google sign-in; cleared by the callback */
  oauthState?: string;
  /** same-origin path to land on after the in-flight sign-in (an invite page
   * must survive the login round-trip); single-use, cleared by the callback */
  returnTo?: string;
  /** wallet identity for the AIN/MetaMask logins (the relational-chain line) */
  ainAddress?: string;
  /** the AIN sign-in nonce for an in-flight wallet login */
  challenge?: string;
  /** the in-flight "Sign in with aindrive" pairing — only this browser may finish it */
  aindrivePairing?: string;
}

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
