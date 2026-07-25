import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // LAN dev access (e.g. http://192.168.1.193): Next 16 blocks cross-origin
  // dev asset/HMR requests unless the origin is allowlisted.
  allowedDevOrigins: ["192.168.1.193"],
  // Isolated build dir (e2e): a concurrent dev server overwrites the default
  // .next and wipes prod builds (F12), so e2e prod builds go to
  // NEXT_DIST_DIR=.next-e2e. Unset = default .next (dev server), so other
  // sessions are unaffected.
  distDir: process.env.NEXT_DIST_DIR || ".next",
};

export default nextConfig;
