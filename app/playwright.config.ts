import { defineConfig, devices } from "@playwright/test";
import path from "node:path";

const PORT = process.env.E2E_PORT || "3000";
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
      NOTION_FS_ROOT: OKF_FIXTURE,
      AGENT_FAKE_LLM: "1",
      // AI 채팅 e2e도 실 LLM 없이 결정론적으로 (src/lib/ai-chat.ts fakeReply)
      AI_FAKE_LLM: process.env.AI_FAKE_LLM ?? "1",
    },
  },
});
