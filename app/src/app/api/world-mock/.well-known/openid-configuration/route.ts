import { NextResponse } from "next/server";
import { mockConfig, notFound } from "../../_lib/mock";

export const dynamic = "force-dynamic";

/** Local mock of the sandbox IdP — discovery, same shape as
 *  https://sandbox.auth.world.org/.well-known/openid-configuration. */
export function GET() {
  const cfg = mockConfig();
  if (!cfg) return notFound();
  const { issuer } = cfg;
  return NextResponse.json(
    {
      issuer,
      authorization_endpoint: `${issuer}/authorize`,
      token_endpoint: `${issuer}/token`,
      jwks_uri: `${issuer}/jwks`,
      token_endpoint_auth_methods_supported: ["client_secret_basic", "client_secret_post"],
      response_types_supported: ["code"],
      response_modes_supported: ["query"],
      grant_types_supported: ["authorization_code"],
      scopes_supported: ["openid"],
      claims_supported: ["iss", "sub", "aud", "exp", "iat", "nonce", "auth_time"],
      prompt_values_supported: ["none", "login"],
      subject_types_supported: ["pairwise"],
      id_token_signing_alg_values_supported: ["RS256"],
      code_challenge_methods_supported: ["S256"],
      // not part of the real document: marks this as the local mock
      x_mock: "local mock of the World sandbox IdP — not World",
    },
    { headers: { "cache-control": "no-store" } }
  );
}
