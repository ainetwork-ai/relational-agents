import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // LAN dev access (e.g. http://192.168.1.193): Next 16 blocks cross-origin
  // dev asset/HMR requests unless the origin is allowlisted.
  allowedDevOrigins: ["192.168.1.193"],
  // 격리 빌드 디렉토리(e2e): 동시 dev 서버가 기본 .next를 덮어써 prod 빌드가
  // 사라지는 문제(F12)를 피하려고, e2e prod 빌드는 NEXT_DIST_DIR=.next-e2e로
  // 분리한다. 미설정 시 기본 .next(개발 서버용)라 다른 세션에 영향 없음.
  distDir: process.env.NEXT_DIST_DIR || ".next",
};

export default nextConfig;
