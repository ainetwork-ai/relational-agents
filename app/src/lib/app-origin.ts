import "server-only";

/**
 * How this server reaches itself over HTTP (an x402 client paying one of our
 * own resources). In a container PORT is set and loopback avoids the TLS
 * front door; in dev (`next dev -p`) it is not, and the origin a request
 * arrived on is used — remembered from the last one, since agent work runs
 * after the request that started it has returned.
 */
const KEY = Symbol.for("app.origin");
type G = Record<symbol, string | undefined>;

export function rememberOrigin(origin: string): void {
  if (/^https?:\/\//.test(origin)) (globalThis as unknown as G)[KEY] = origin;
}

export function selfOrigin(fallback?: string): string {
  if (process.env.PORT) return `http://127.0.0.1:${process.env.PORT}`;
  return process.env.APP_ORIGIN || fallback || (globalThis as unknown as G)[KEY] || "http://127.0.0.1:3000";
}

/**
 * The origin people open this app on, for links written into text OTHER people read
 * (a prompt's page URLs, saved into a shared prompt page): only what the deployment
 * configures — APP_ORIGIN, else the origin of GOOGLE_REDIRECT_URI (by definition this
 * app's public origin: Google checks it byte for byte, see api/auth/google/callback) —
 * else "" and links stay relative (`/p/<id>`). Never a request's origin: that is one
 * person's view of the app (127.0.0.1, a LAN address, a Host header a proxy passed on),
 * and remembering it process-wide would let any request decide the links in everyone's
 * prompts. Never the container's loopback.
 */
export function publicOrigin(): string {
  const configured = process.env.APP_ORIGIN?.trim();
  if (configured && /^https?:\/\//.test(configured)) return configured.replace(/\/+$/, "");
  try {
    const redirect = process.env.GOOGLE_REDIRECT_URI?.trim();
    if (redirect) return new URL(redirect).origin;
  } catch {
    // not a URL: fall through to relative links
  }
  return "";
}
