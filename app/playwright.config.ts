import { defineConfig, devices } from "@playwright/test";
import path from "node:path";

// Dedicated e2e port (NOT 3000/366xx/368xx — those belong to warm dev servers
// booted with the REAL OKF_ROOT; reusing one would let agent write-tests mutate
// the real memory-data/. A fresh port forces playwright to boot its own server
// with the isolated .okf-work root below).
const PORT = process.env.E2E_PORT || "34100";
const BASE_URL = `http://localhost:${PORT}`;
// OKF store points at a throwaway working copy of the fixture (global-setup
// copies it) so write-back tests can mutate files without dirtying git.
const OKF_FIXTURE = path.resolve(__dirname, "e2e/.okf-work");

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  timeout: 60_000,
  expect: { timeout: 5_000 },
  fullyParallel: false, // serial: scenarios share one database
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // Direct binary — pnpm is unusable in this env (ERR_PNPM_ABORTED_REMOVE_
    // MODULES_DIR_NO_TTY), so `pnpm exec` can't boot the server.
    command: `./node_modules/.bin/next dev -p ${PORT}`,
    url: `${BASE_URL}/login`,
    // Next 16 allows a single dev server per app dir — the harness keeps one
    // warm (UI loop + gates share it via E2E_PORT). CI always boots fresh.
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    // AGENT_FAKE_LLM: agent write-pipeline specs run deterministically without
    // the vLLM server (see src/lib/agent/pipeline.ts fakeEdits).
    env: {
      // The code reads OKF_ROOT (src/lib/okf-store.ts). Point it at the isolated
      // working copy so agent write-tests never touch the real memory-data/.
      OKF_ROOT: OKF_FIXTURE,
      // Deterministic agent write-pipeline without the vLLM server (pipeline.ts
      // fakeEdits). Also keep AI_URL unset so the LLM path is never taken.
      AGENT_FAKE_LLM: "1",
      AI_FAKE_LLM: process.env.AI_FAKE_LLM ?? "1",
      // demo-login/metamask-verify are open in dev; make it explicit so a fresh
      // server never gates them off.
      ENABLE_DEMO_LOGIN: "1",
      // Blank the on-chain registry so consent/dissolve do NOT relay a real
      // Sepolia tx (relayRelationOnChain returns null on a zero/blank address).
      // Otherwise the completing signature would block on waitForTransactionReceipt
      // (~120s) and time the request out. The EIP-712 domain stays self-consistent
      // (signer + verifier read the same blanked env), so signatures still verify.
      NEXT_PUBLIC_RELATION_REGISTRY_ADDRESS: "",
    },
  },
});
