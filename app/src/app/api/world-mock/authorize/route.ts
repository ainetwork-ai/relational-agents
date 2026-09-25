import { NextRequest, NextResponse } from "next/server";
import { MOCK_HUMANS, issueCode, mockConfig, notFound } from "../_lib/mock";

export const dynamic = "force-dynamic";

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function html(body: string, status = 200) {
  return new NextResponse(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>World ID — local mock</title>
<style>
:root{--bg:#f6f6f4;--card:#fff;--fg:#1d1d1f;--muted:#6b6b70;--line:#e3e3e0;--btn:#1d1d1f;--btnfg:#fff;--warn:#8a5a00;--warnbg:#fff4d6;color-scheme:light}
@media (prefers-color-scheme:dark){:root{--bg:#121213;--card:#1c1c1e;--fg:#f2f2f2;--muted:#9a9aa0;--line:#2e2e31;--btn:#f2f2f2;--btnfg:#111;--warn:#ffcf66;--warnbg:#3a2e10;color-scheme:dark}}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;padding:32px 16px}
main{max-width:420px;margin:0 auto;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:24px}
h1{font-size:18px;margin:0 0 4px}
p{margin:8px 0;color:var(--muted)}
.tag{display:inline-block;font-size:12px;font-weight:600;color:var(--warn);background:var(--warnbg);border-radius:6px;padding:2px 8px;margin-bottom:12px}
.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:16px 0}
a.btn{display:block;text-align:center;text-decoration:none;background:var(--btn);color:var(--btnfg);border-radius:10px;padding:10px 0;font-weight:600}
a.cancel{display:block;text-align:center;color:var(--muted);padding:8px 0}
code{font-size:13px}
</style></head><body><main>${body}</main></body></html>`,
    { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } }
  );
}

/**
 * GET /api/world-mock/authorize — local mock of the sandbox authorize page.
 *
 * Interactive: a page where the tester picks which human they are
 * (sub "mock-human-<n>") or cancels. Non-interactive (e2e): ?human=<n> picks
 * immediately, ?deny=1 cancels immediately.
 *
 * There is no remembered session, so every visit is a fresh verification —
 * auth_time is always "now", which is what max_age=0 / prompt=login ask for.
 */
export function GET(req: NextRequest) {
  const cfg = mockConfig();
  if (!cfg) return notFound();

  const q = req.nextUrl.searchParams;
  const clientId = q.get("client_id") ?? "";
  const redirectUri = q.get("redirect_uri") ?? "";
  const state = q.get("state");

  // An unknown client or unregistered redirect is shown, never redirected to.
  if (clientId !== cfg.clientId || redirectUri !== cfg.redirectUri)
    return html(
      `<span class="tag">Local mock</span><h1>Invalid request</h1><p>Unknown client or unregistered redirect_uri.</p>`,
      400
    );

  const back = (p: Record<string, string>) => {
    const to = new URL(redirectUri);
    for (const [k, v] of Object.entries(p)) to.searchParams.set(k, v);
    if (state) to.searchParams.set("state", state);
    return NextResponse.redirect(to, 302);
  };

  if (q.get("response_type") !== "code") return back({ error: "unsupported_response_type" });
  if (!(q.get("scope") ?? "").split(" ").includes("openid")) return back({ error: "invalid_scope" });
  const codeChallenge = q.get("code_challenge");
  if (!codeChallenge || q.get("code_challenge_method") !== "S256")
    return back({ error: "invalid_request", error_description: "PKCE S256 required" });

  if (q.get("deny") === "1") return back({ error: "access_denied" });

  const human = q.get("human");
  if (human !== null) {
    if (!/^[1-9]\d?$/.test(human)) return back({ error: "invalid_request", error_description: "bad human" });
    const code = issueCode({
      sub: `mock-human-${human}`,
      nonce: q.get("nonce"),
      clientId,
      redirectUri,
      codeChallenge,
      authTime: Math.floor(Date.now() / 1000),
    });
    return back({ code });
  }

  const link = (extra: Record<string, string>) => {
    const p = new URLSearchParams(q);
    p.delete("human");
    p.delete("deny");
    for (const [k, v] of Object.entries(extra)) p.set(k, v);
    return esc(`?${p}`);
  };
  const buttons = Array.from(
    { length: MOCK_HUMANS },
    (_, i) => `<a class="btn" href="${link({ human: String(i + 1) })}">Human ${i + 1}</a>`
  ).join("");

  return html(`<span class="tag">Local mock — not World</span>
<h1>World ID — local mock of the sandbox IdP</h1>
<p>Stands in for <code>sandbox.auth.world.org</code> during development. Choose which human is verifying right now. The app receives <code>sub = mock-human-&lt;n&gt;</code>.</p>
<p>Pick the same number from two accounts to play one person with two accounts.</p>
<div class="grid">${buttons}</div>
<a class="cancel" href="${link({ deny: "1" })}">Cancel</a>`);
}
