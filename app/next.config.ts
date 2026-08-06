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
  // serverExternalPackages held viem and @ainblockchain/ain-js: both shipped
  // prebundled code that broke when Turbopack re-bundled it ("TypeError: Y is
  // not a function" from a vendored @noble/hashes copy). Nothing imports either
  // package now that the wallet layer is gone, so the escape hatch is gone too.
  // The two entries stay in package.json until the lockfile can be regenerated
  // without colliding with other in-flight work.
};

export default nextConfig;
