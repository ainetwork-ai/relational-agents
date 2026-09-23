// What decides the size of a single upload request. **Client-safe** (no node
// imports): the uploader hook and next.config.ts both read it.
//
// A request passes three gates, narrowing in this order:
//
//   tus chunk (TUS_CLIENT_CHUNK_BYTES) ≤ Next proxy body (PROXY_MAX_BODY_BYTES)
//                                      ≤ nginx client_max_body_size
//
// ainteams lost data to the middle one (2026-08-06): Next 16 caps a proxied
// body at 10MB by default and passes the route the truncated bytes — no
// rejection, no 500. A 32MB chunk arrived as 10MB, the client resumed from the
// acknowledged offset, and the upload moved three times the file's size while
// the progress bar went up and down.
//
// Two layers of defence: the chunk is under the DEFAULT cap so it is safe even
// with no config, and next.config.ts raises the cap anyway.

/**
 * One tus PATCH. Under the 10MB default on purpose, so a lost config setting
 * cannot truncate anything. Bigger chunks barely help — transfer dominates the
 * round trip — while the proxy buffers each body in memory, so chunk size is
 * server memory per concurrent upload.
 */
export const TUS_CLIENT_CHUNK_BYTES = 8 * 1024 * 1024;

/** `experimental.proxyClientMaxBodySize` in next.config.ts (replaces 10MB). */
export const PROXY_MAX_BODY_BYTES = 50 * 1024 * 1024;
