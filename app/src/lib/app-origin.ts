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

/** The origin people open this app on, for links written into text they will read
 *  (a prompt's page URLs): APP_ORIGIN, else the origin the last request came in on,
 *  else "" (links stay relative). Never the container's loopback. */
export function publicOrigin(): string {
  return (process.env.APP_ORIGIN || (globalThis as unknown as G)[KEY] || "").replace(/\/+$/, "");
}
