import "server-only";

/**
 * Google sign-in — the server-side authorization code flow.
 *
 * No SDK and no auth framework: this app already owns its session
 * (iron-session, `lib/auth/session.ts`), so all that is missing is two
 * redirects and one token exchange. A framework would take over session
 * handling to add nothing here.
 *
 * The browser never talks to Google's API directly, which is why the OAuth
 * client needs no "authorized JavaScript origin" for this flow — only the
 * redirect URI, and it must match GOOGLE_REDIRECT_URI byte for byte.
 */

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const ISSUERS = ["https://accounts.google.com", "accounts.google.com"];

export interface GoogleConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

/** null when the deployment has no Google credentials — callers answer 503. */
export function googleConfig(): GoogleConfig | null {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) return null;
  return { clientId, clientSecret, redirectUri };
}

export function authorizeUrl(cfg: GoogleConfig, state: string): string {
  const p = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state,
    // no refresh token: this is sign-in, not delegated API access. Asking for
    // offline access would hand us a long-lived credential we never use.
    access_type: "online",
    prompt: "select_account",
  });
  return `${AUTH_ENDPOINT}?${p}`;
}

export interface GoogleIdentity {
  sub: string;
  email: string;
  emailVerified: boolean;
  name?: string;
  picture?: string;
}

/** Decode one base64url JWT segment. */
function decodeSegment(seg: string): Record<string, unknown> {
  const b64 = seg.replace(/-/g, "+").replace(/_/g, "/");
  return JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
}

/**
 * Exchange the code for an id_token and read the identity out of it.
 *
 * The signature is not verified, and that is safe *only* because of how the
 * token arrives: our server fetched it over TLS straight from Google's token
 * endpoint, authenticated with the client secret. Nothing untrusted touched
 * it. (Google documents this exemption for the code flow.) The claims that
 * still have to be checked are the ones that guard against a token minted for
 * a *different* client, so aud/iss/exp are enforced below.
 */
export async function exchangeCode(cfg: GoogleConfig, code: string): Promise<GoogleIdentity> {
  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      redirect_uri: cfg.redirectUri,
      grant_type: "authorization_code",
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    // Google puts the useful part in `error_description` — "redirect_uri_mismatch"
    // is by far the most common and says exactly what to fix.
    const detail = await res.text().catch(() => "");
    throw new Error(`google token exchange ${res.status}: ${detail.slice(0, 300)}`);
  }

  const { id_token: idToken } = (await res.json()) as { id_token?: string };
  if (!idToken) throw new Error("google token response carried no id_token");

  const parts = idToken.split(".");
  if (parts.length !== 3) throw new Error("id_token is not a JWT");
  const claims = decodeSegment(parts[1]);

  const aud = claims.aud;
  if (aud !== cfg.clientId) throw new Error("id_token audience is not this client");
  if (typeof claims.iss !== "string" || !ISSUERS.includes(claims.iss))
    throw new Error("id_token issuer is not Google");
  const exp = typeof claims.exp === "number" ? claims.exp : 0;
  if (exp * 1000 <= Date.now()) throw new Error("id_token is expired");

  const sub = typeof claims.sub === "string" ? claims.sub : "";
  const email = typeof claims.email === "string" ? claims.email.toLowerCase() : "";
  if (!sub || !email) throw new Error("id_token carried no sub/email");

  return {
    sub,
    email,
    // An unverified address must not become an identity: whoever really owns
    // it could sign in later and find someone else in their account.
    emailVerified: claims.email_verified === true,
    name: typeof claims.name === "string" ? claims.name : undefined,
    picture: typeof claims.picture === "string" ? claims.picture : undefined,
  };
}
