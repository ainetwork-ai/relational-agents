import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // LAN dev access (e.g. http://192.168.1.193): Next 16 blocks cross-origin
  // dev asset/HMR requests unless the origin is allowlisted.
  // This host answers on .194 now; .193 stays for the machine it used to be.
  // 127.0.0.1 is here because it is a DIFFERENT origin from localhost: opening
  // dev on it got /_next/webpack-hmr blocked, and the page then sat there
  // "compiling" forever with no hydration.
  allowedDevOrigins: ["192.168.1.193", "192.168.1.194", "127.0.0.1"],
  // Isolated build dir (e2e): a concurrent dev server overwrites the default
  // .next and wipes prod builds (F12), so e2e prod builds go to
  // NEXT_DIST_DIR=.next-e2e. Unset = default .next (dev server), so other
  // sessions are unaffected.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Container images ship .next/standalone — a traced, self-contained server
  // that does not need the full node_modules tree at runtime.
  output: process.env.NEXT_STANDALONE === "1" ? "standalone" : undefined,
  // A tus PATCH, or any buffered upload, has to clear three gates and they
  // narrow in this order:
  //
  //   tus chunk 8MB  ≤  proxyClientMaxBodySize 50MB  ≤  nginx client_max_body_size
  //
  // The middle one is the trap. Next 16 caps a proxied request body at 10MB by
  // default and hands the route the TRUNCATED body — not a rejection, so
  // nothing errors and the bytes are quietly wrong. ainteams measured it on
  // 2026-08-06: a 32MB chunk arrived as 10MB, the client resent from the
  // acknowledged offset, and the upload moved three times the file's bytes
  // with the progress bar going up and down. Raising the app's own limit
  // without this does nothing.
  experimental: {
    proxyClientMaxBodySize: 50 * 1024 * 1024,
    // Dev only. Next 16.2's server Fast Refresh keeps an async loop per server
    // chunk (hot-reloader-turbopack setupServerHmr) spinning even when no file
    // changes, and React's dev async tracking records every promise it makes —
    // the idle dev server grew ~300MB/min until it ran out of heap (2026-09-24).
    // Off, a server edit reloads the module instead of patching it in place.
    turbopackServerFastRefresh: false,
  },
  // /uploads/* is served same-origin off disk, so an html or svg opened as a
  // document would run its script as us (stored XSS — the session cookie rides
  // along on any same-origin fetch it makes). `sandbox` stops the script and
  // `nosniff` stops MIME confusion. Neither applies to <img> subresource loads,
  // so inline images still render.
  // ⚠️ This header is what lets the upload allowlist accept svg and html/htm
  // (src/lib/files/allowed-types.ts). Removing it means taking those back.
  async headers() {
    return [
      {
        source: "/uploads/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Content-Security-Policy", value: "sandbox" },
        ],
      },
    ];
  },
  // The wallet layer is back (relational-chain line): viem and ain-js ship
  // prebundled code that breaks when Turbopack re-bundles it ("TypeError: Y is
  // not a function" from a vendored @noble/hashes copy), and agentkit's
  // coinbase-sdk reaches for transitive deps (@scure/bip39) the bundler cannot
  // resolve — all three stay external on the server.
  serverExternalPackages: ["@coinbase/agentkit", "viem", "@ainblockchain/ain-js"],
};

export default nextConfig;
