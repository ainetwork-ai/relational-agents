import { defineConfig, devices } from "@playwright/test";

// Smoke-checks the DEPLOYED site with a real browser. Separate from
// playwright.config.ts on purpose: that one boots its own dev server against an
// isolated OKF fixture and a scratch database, and its specs consent to and
// dissolve relationships. Pointing it at production would mutate live data.
//
//   npx playwright test -c playwright.prod.config.ts
//
// Everything here is read-only: it signs in, looks, and asserts. It never
// writes a message, uploads, consents, or dissolves.
const BASE_URL = process.env.PROD_URL || "https://memory.ainetwork.ai";

export default defineConfig({
  testDir: "./e2e-prod",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 1, // one retry absorbs a cold container or a slow first paint
  reporter: [["list"]],
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    actionTimeout: 20_000,
    navigationTimeout: 45_000,
    ignoreHTTPSErrors: false, // the certificate is part of what we are checking
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
