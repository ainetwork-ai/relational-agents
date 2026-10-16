// ainmem's service worker: pages you have visited open with no network
// (docs/willow-offline-authorship-design.md A6, docs/willow-ainmem-plan.md Task 2).
//
// - Page loads (navigations): network first; a good HTML answer is kept, and served
//   when the network is gone. The editor then replays the edits still waiting in
//   IndexedDB on top of it, so the page shows what you typed offline.
// - /_next/static: cache first (content-hashed, never changes).
// - GET /api/*: network first, the last JSON answer when offline — the sidebar, the
//   page's blocks. Event streams, files and uploads are never kept.
// - RSC fetches (client-side navigation) are never kept: when one fails, Next falls
//   back to a full page load, which is served above.
// - {type: "clear"} (sent on logout) deletes everything, so the next person on this
//   browser does not see the last one's pages.
const PAGES = "ainmem-pages-v1";
const STATIC = "ainmem-static-v1";
const API = "ainmem-api-v1";
const MAX_API_BYTES = 2 * 1024 * 1024;
const NO_API = /^\/api\/(files|upload|uploads|auth|saveTransactions)(\/|$)/;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("message", (e) => {
  if (e.data?.type !== "clear") return;
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
      .then(() => e.ports?.[0]?.postMessage("cleared"))
  );
});

const keyOf = (url) => url.origin + url.pathname;

async function networkFirst(req, cacheName, key, keep) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(req);
    if (keep(res)) await cache.put(key, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(key);
    if (hit) return hit;
    throw err;
  }
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (req.headers.get("rsc") || url.searchParams.has("_rsc")) return;

  if (req.mode === "navigate") {
    const keep = (res) => res.ok && !res.redirected && (res.headers.get("content-type") || "").includes("text/html");
    e.respondWith(networkFirst(req, PAGES, keyOf(url), keep));
    return;
  }
  if (url.pathname.startsWith("/_next/static/")) {
    e.respondWith(
      caches.open(STATIC).then(async (cache) => {
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) await cache.put(req, res.clone());
        return res;
      })
    );
    return;
  }
  if (url.pathname.startsWith("/api/") && !NO_API.test(url.pathname)) {
    if ((req.headers.get("accept") || "").includes("text/event-stream")) return;
    const keep = (res) => {
      const type = res.headers.get("content-type") || "";
      const len = Number(res.headers.get("content-length") || 0);
      return res.ok && type.includes("application/json") && len <= MAX_API_BYTES;
    };
    e.respondWith(networkFirst(req, API, url.href, keep));
  }
});
