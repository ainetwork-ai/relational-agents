import { NextRequest, NextResponse } from "next/server";
import { SignJWT } from "jose";
import { consumeCode, mockConfig, mockKeys, notFound, s256 } from "../_lib/mock";

export const dynamic = "force-dynamic";

const ID_TOKEN_TTL_S = 300;

function oauthError(error: string, status = 400, description?: string) {
  return NextResponse.json(
    { error, ...(description ? { error_description: description } : {}) },
    { status, headers: { "cache-control": "no-store" } }
  );
}

/** client_secret_basic (Authorization header) or client_secret_post (body). */
function clientCredentials(req: NextRequest, body: URLSearchParams) {
  const header = req.headers.get("authorization");
  if (header?.startsWith("Basic ")) {
    const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
    const i = decoded.indexOf(":");
    if (i < 0) return null;
    const form = (s: string) => decodeURIComponent(s.replace(/\+/g, " "));
    try {
      return { id: form(decoded.slice(0, i)), secret: form(decoded.slice(i + 1)) };
    } catch {
      return null;
    }
  }
  const id = body.get("client_id");
  const secret = body.get("client_secret");
  return id && secret ? { id, secret } : null;
}

/**
 * POST /api/world-mock/token — local mock of the sandbox token endpoint.
 * One-time code, redirect_uri match, PKCE S256, then an RS256 id_token with
 * iss, aud, sub, nonce, iat, exp (+5m), auth_time.
 */
export async function POST(req: NextRequest) {
  const cfg = mockConfig();
  if (!cfg) return notFound();

  const body = new URLSearchParams(await req.text());
  const client = clientCredentials(req, body);
  if (!client || client.id !== cfg.clientId || client.secret !== cfg.clientSecret) return oauthError("invalid_client", 401);
  if (body.get("grant_type") !== "authorization_code") return oauthError("unsupported_grant_type");

  const entry = consumeCode(body.get("code") ?? "");
  if (!entry) return oauthError("invalid_grant", 400, "code unknown, used or expired");
  if (entry.clientId !== client.id) return oauthError("invalid_grant", 400, "code was issued to another client");
  if (entry.redirectUri !== body.get("redirect_uri")) return oauthError("invalid_grant", 400, "redirect_uri mismatch");
  const verifier = body.get("code_verifier");
  if (!verifier || (await s256(verifier)) !== entry.codeChallenge)
    return oauthError("invalid_grant", 400, "PKCE verification failed");

  const { privateKey, kid } = await mockKeys();
  const idToken = await new SignJWT({
    auth_time: entry.authTime,
    ...(entry.nonce ? { nonce: entry.nonce } : {}),
  })
    .setProtectedHeader({ alg: "RS256", kid, typ: "JWT" })
    .setIssuer(cfg.issuer)
    .setAudience(client.id)
    .setSubject(entry.sub)
    .setIssuedAt()
    .setExpirationTime(`${ID_TOKEN_TTL_S}s`)
    .sign(privateKey);

  return NextResponse.json(
    {
      id_token: idToken,
      access_token: Buffer.from(crypto.getRandomValues(new Uint8Array(24))).toString("base64url"),
      token_type: "Bearer",
      expires_in: ID_TOKEN_TTL_S,
    },
    { headers: { "cache-control": "no-store", pragma: "no-cache" } }
  );
}
