import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { worldConfig, worldDiscovery, worldSiteUrl, pkcePair, randomToken, newNonce, type WorldConfig } from "@/lib/auth/world";
import { safeReturnTo } from "@/lib/auth/return-to";
import { stamp, stampOk } from "@/lib/secret-box";
import { approvalCard, type ApprovalCard } from "@/lib/agent/treasury/approvals";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EXPLORER = "https://sepolia.etherscan.io";

/** The confirmation form is good for this long, for this member and this action only. */
const CONFIRM_TTL_MS = 10 * 60_000;
const CONFIRM_LABEL = "world-approval-confirm";

/**
 * /api/auth/world/connect — step-up to World ID: sends the signed-in member to
 * the Human Continuity IdP.
 *
 *   GET  (no action)   a plain verification — straight to the IdP; the
 *                      callback binds the sub to this account (users.worldSub).
 *   GET  ?action=<id>  an APPROVAL of that pending treasury action. Nothing is
 *                      started yet: this renders, on our origin, what is being
 *                      approved — amount, payee and its address (a recurring
 *                      buy: its terms, total, and the agent wallet it trades
 *                      from on Base), requester, the
 *                      rule, who approved so far. The IdP screen can't say any
 *                      of that, so without this page a link that looks like
 *                      "re-verify your World ID" would collect an approval of a
 *                      spend the person never saw.
 *   POST (from that page) action + a stamp binding member, action and expiry
 *                      → the same checks again → the IdP. The callback hands
 *                      the verified pairwise sub to recordIdpApproval.
 *
 * max_age=0 + prompt=login: the approval must be a verification made NOW, not
 * a session the IdP remembers. `returnTo` brings the person back to the moment
 * that asked for trust (the room, the approval card).
 *
 * Every world_* cookie is (re)written when a flow starts, including clearing
 * world_action on a plain verification — a stale one from an abandoned
 * approval must not turn the next plain verification into an approval.
 */
export async function GET(req: NextRequest) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;

  const params = req.nextUrl.searchParams;
  const actionId = params.get("action") || null;
  const returnTo = safeReturnTo(params.get("returnTo")) ?? "/";
  const back = backTo(req, returnTo, actionId !== null);

  const cfg = worldConfig();
  if (!cfg) return back("unavailable");
  if (!actionId) return startFlow(req, cfg, auth.user.id, null, returnTo, back);

  if (!UUID_RE.test(actionId)) return back("not-allowed");
  const card = await approvalCard(actionId, auth.user.id);
  if (!card.ok) return back(refusalCode(card.reason));

  const exp = Date.now() + CONFIRM_TTL_MS;
  const token = stamp(CONFIRM_LABEL, `${auth.user.id}:${actionId}:${exp}`);
  return new NextResponse(confirmPage(card.card, { returnTo, exp, token, mock: cfg.mode === "mock" }), {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      // an approval page must not be framed under someone else's buttons
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'",
      "x-frame-options": "DENY",
    },
  });
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;

  const form = await req.formData().catch(() => null);
  const field = (name: string) => {
    const v = form?.get(name);
    return typeof v === "string" ? v : "";
  };
  const actionId = field("action");
  const returnTo = safeReturnTo(field("returnTo")) ?? "/";
  const back = backTo(req, returnTo, true, 303);

  const cfg = worldConfig();
  if (!cfg) return back("unavailable");
  const exp = Number(field("exp"));
  if (
    !UUID_RE.test(actionId) ||
    !Number.isFinite(exp) ||
    Date.now() > exp ||
    !stampOk(CONFIRM_LABEL, `${auth.user.id}:${actionId}:${exp}`, field("token"))
  )
    return back("bad-state");
  // the page may be minutes old: everything is checked again
  const card = await approvalCard(actionId, auth.user.id);
  if (!card.ok) return back(refusalCode(card.reason));
  return startFlow(req, cfg, auth.user.id, actionId, returnTo, back, 303);
}

type Back = (value: string) => NextResponse;

function backTo(req: NextRequest, returnTo: string, approval: boolean, status?: number): Back {
  return (value: string) => {
    const url = worldSiteUrl(returnTo, req.url);
    url.searchParams.set(approval ? "treasury" : "world", value);
    return NextResponse.redirect(url, status);
  };
}

/** What the panel shows for a refusal before the IdP: the reason itself, except
 *  "this request isn't yours to approve" in its several forms. */
function refusalCode(reason: string): string {
  return reason === "not-found" || reason === "not-pending" || reason === "not-member" ? "not-allowed" : reason;
}

async function startFlow(
  req: NextRequest,
  cfg: WorldConfig,
  userId: string,
  actionId: string | null,
  returnTo: string,
  back: Back,
  status?: number
): Promise<NextResponse> {
  let authorizationEndpoint: string;
  try {
    authorizationEndpoint = (await worldDiscovery(cfg)).authorization_endpoint;
  } catch (err) {
    console.error("world discovery failed:", err);
    return back("unavailable");
  }

  const { verifier, challenge } = await pkcePair();
  const state = randomToken(16);
  const nonce = newNonce();

  const url = new URL(authorizationEndpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", cfg.clientId);
  url.searchParams.set("redirect_uri", cfg.redirectUri);
  url.searchParams.set("scope", "openid");
  url.searchParams.set("state", state);
  url.searchParams.set("nonce", nonce);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("max_age", "0");
  url.searchParams.set("prompt", "login");

  const res = NextResponse.redirect(url, status);
  // short-lived, HttpOnly, scoped to /api/auth/world: the callback reads them
  // once and clears them. Secure only where the browser would keep it (https
  // or production) — a Secure cookie on http://localhost is silently dropped.
  const cookie = {
    httpOnly: true,
    secure: req.nextUrl.protocol === "https:" || process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/api/auth/world",
    maxAge: 600,
  };
  res.cookies.set("world_pkce", verifier, cookie);
  res.cookies.set("world_state", state, cookie);
  res.cookies.set("world_nonce", nonce, cookie);
  // who started the flow — a demo login switch mid-flow must not bind this
  // person's proof to whichever account is signed in when it comes back
  res.cookies.set("world_uid", userId, cookie);
  res.cookies.set("world_return", returnTo, cookie);
  if (actionId) res.cookies.set("world_action", actionId, cookie);
  else res.cookies.set("world_action", "", { ...cookie, maxAge: 0 });
  return res;
}

// ── the confirmation page ───────────────────────────────────────────────────

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function usd(n: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
}

/** The relation's clock — the room is in Tokyo, and so is everyone approving. */
const LOCAL_ZONE = { id: "Asia/Tokyo", label: "Tokyo" };

/** "in 10 h (19:12 Tokyo)" — how long is left, and when that is where the group is. */
function expiresIn(iso: string, now = Date.now()): string {
  const at = new Date(iso);
  const ms = at.getTime() - now;
  const left = ms < 3_600_000 ? `in ${Math.max(1, Math.round(ms / 60_000))} min` : `in ${Math.round(ms / 3_600_000)} h`;
  const day = (d: Date) => d.toLocaleDateString("en-US", { timeZone: LOCAL_ZONE.id });
  const clock = new Intl.DateTimeFormat("en-GB", {
    timeZone: LOCAL_ZONE.id,
    ...(day(at) !== day(new Date(now)) ? { weekday: "short" as const } : {}),
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(at);
  return `${left} (${clock} ${LOCAL_ZONE.label})`;
}

/**
 * The memo only when it says more than the payee's name — "· hotel deposit"
 * beside Hotel Gracery Shinjuku, but not "· hotel" (the panel's card does the same).
 */
const FILLER = new Set(["the", "a", "an", "for", "to", "of", "our", "and", "pay", "send", "book"]);
function memoAddsWords(memo: string, label: string | undefined): boolean {
  const words = (s: string) =>
    s
      .toLowerCase()
      .split(/[^a-z0-9$']+/)
      .filter((w) => /[a-z]/.test(w) && !FILLER.has(w));
  if (!label) return true;
  const named = new Set(words(label));
  return words(memo).some((w) => !named.has(w));
}

/** "2 different humans approve it" / "a verified human approves it" */
function humansApprove(n: number): string {
  return n === 1 ? "a verified human approves it" : `${n} different humans approve it`;
}

/** A recurring buy is an authority, not a payment: its terms, where it trades and from which wallet — never its stored JSON. */
function recurringWhat(r: NonNullable<ApprovalCard["recurring"]>): string {
  return `<h1>Recurring buy</h1>
       <p class="to"><strong>${esc(usd(r.weeklyUsd))} of ETH every week for ${r.weeks} week${r.weeks === 1 ? "" : "s"}</strong> · at most ${esc(usd(r.exposureUsd))} in total</p>
       <p class="muted">USDC → WETH on Uniswap v3 on Base, at most once a week, until ${esc(new Date(r.expiresAt).toUTCString())}. Anyone in the room can stop it without a vote.</p>
       <p class="addr">From the agent's wallet <a href="${esc(r.agentAddressUrl)}" target="_blank" rel="noreferrer">${esc(r.agentAddress)}</a> (basescan)</p>
       <p class="addr">Terms ${esc(r.digestShort)}</p>`;
}

function confirmPage(
  c: ApprovalCard,
  f: { returnTo: string; exp: number; token: string; mock: boolean }
): string {
  const ratify = c.kind === "ratify";
  // the card grew these for this page; an older card without them still renders
  const { roomName, approverName } = c as ApprovalCard & { roomName?: string; approverName?: string };
  const so = c.approvedBy.length
    ? `${c.approvedBy.map(esc).join(", ")} — ${c.approvedBy.length} of ${c.required} needed`
    : `No one yet — 0 of ${c.required} needed`;
  const bar = ratify
    ? `The agent follows this version only after ${humansApprove(c.required)} with World ID.`
    : `The agent can't send this until ${humansApprove(c.required)} with World ID.`;
  const what = ratify
    ? `<h1>Adopt ${esc(c.memo)}</h1>
       ${
         c.changes && (c.changes.added.length || c.changes.removed.length || c.changes.joined.length)
           ? `<ul class="changes">${[
               ...c.changes.added.map((l) => `<li class="add">+ “${esc(l)}”</li>`),
               ...c.changes.removed.map((l) => `<li class="del">− “${esc(l)}”</li>`),
               ...c.changes.joined.map((n) => `<li class="add">+ ${esc(n)} votes</li>`),
             ].join("")}</ul>`
           : ""
       }
       <p class="muted">Once adopted, the agent follows this version for every payment.</p>`
    : c.recurring
      ? recurringWhat(c.recurring)
      : `<h1>${esc(usd(c.amountUsd))}</h1>
       <p class="to">to <strong>${esc(c.recipient?.label ?? "an unknown recipient")}</strong>${c.memo && memoAddsWords(c.memo, c.recipient?.label) ? ` · ${esc(c.memo)}` : ""}</p>
       ${
         c.recipient?.address
           ? `<p class="addr">Sends to <a href="${EXPLORER}/address/${esc(c.recipient.address)}" target="_blank" rel="noreferrer">${esc(c.recipient.address)}</a></p>`
           : ""
       }`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Approve with World ID</title>
<style>
  :root { color-scheme: light dark; --fg:#171717; --muted:#737373; --line:#e5e5e5; --bg:#f5f5f4; --card:#fff; --btn:#171717; --btnfg:#fff; --shadow:0 1px 2px rgba(0,0,0,.04), 0 12px 32px rgba(0,0,0,.08); }
  @media (prefers-color-scheme: dark) { :root { --fg:#e5e5e5; --muted:#a3a3a3; --line:#333; --bg:#0a0a0a; --card:#171717; --btn:#f5f5f5; --btnfg:#171717; --shadow:0 12px 32px rgba(0,0,0,.5); } }
  body { margin:0; min-height:100vh; display:grid; place-items:center; background:var(--bg); color:var(--fg); font:16px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
  main { width:100%; max-width:35rem; box-sizing:border-box; padding:2rem 1rem; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:16px; padding:2rem 2.25rem; box-shadow:var(--shadow); }
  .kicker { font-size:12px; font-weight:600; letter-spacing:.05em; text-transform:uppercase; color:var(--muted); margin:0 0 .75rem; }
  h1 { font-size:42px; line-height:1.1; letter-spacing:-.01em; margin:0; font-variant-numeric:tabular-nums; }
  .to { font-size:18px; margin:.5rem 0 0; }
  .addr { font-family:ui-monospace, monospace; font-size:12.5px; word-break:break-all; color:var(--muted); margin:.5rem 0 0; }
  .addr a { color:inherit; }
  dl { margin:1.5rem 0 0; padding-top:1.25rem; border-top:1px solid var(--line); display:grid; grid-template-columns:auto 1fr; gap:.5rem 1.25rem; font-size:15px; }
  dt { color:var(--muted); }
  dd { margin:0; }
  .rule { font-style:italic; }
  .changes { margin:.75rem 0 0; padding-left:1rem; font-size:15px; }
  .changes li { margin:.15rem 0; }
  .muted { color:var(--muted); font-size:14px; }
  .bar { font-size:15px; font-weight:600; margin:1.5rem 0 0; }
  .note { font-size:13px; color:var(--muted); margin:.25rem 0 0; }
  .actions { display:flex; gap:1rem; align-items:center; margin-top:1.25rem; }
  button { background:var(--btn); color:var(--btnfg); border:0; border-radius:10px; padding:.75rem 1.25rem; font:inherit; font-weight:600; cursor:pointer; }
  a.cancel { color:var(--muted); }
</style></head>
<body><main>
  <div class="card">
    <p class="kicker">${roomName ? `${esc(roomName)} · shared treasury` : "Shared treasury"} → World ID for Agents${f.mock ? " · local mock IdP" : ""}</p>
    ${what}
    <dl>
      ${approverName ? `<dt>Approving as</dt><dd>${esc(approverName)}</dd>` : ""}
      <dt>Requested by</dt><dd>${esc(c.requestedBy)}</dd>
      <dt>Rule</dt><dd class="rule">“${esc(c.ruleText)}”</dd>
      <dt>Approved so far</dt><dd>${so}</dd>
      <dt>Expires</dt><dd>${esc(expiresIn(c.expiresAt))}</dd>
    </dl>
    <p class="bar">${esc(bar)}</p>
    <p class="note">World ID checks, right now, that you're a unique human. Your approval counts once and can't be withdrawn.</p>
    <form method="post" action="/api/auth/world/connect" class="actions">
      <input type="hidden" name="action" value="${esc(c.actionId)}">
      <input type="hidden" name="returnTo" value="${esc(f.returnTo)}">
      <input type="hidden" name="exp" value="${f.exp}">
      <input type="hidden" name="token" value="${esc(f.token)}">
      <button type="submit">🌍 Approve with World ID</button>
      <a class="cancel" href="${esc(f.returnTo)}">Cancel</a>
    </form>
  </div>
</main></body></html>`;
}
