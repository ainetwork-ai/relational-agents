import { test, expect } from "@playwright/test";
import { spawnPerson, inviteAndJoin } from "./relation-helpers";

/**
 * Demo scene 2 — Setup: three MetaMask accounts (Chanho, Hannah, Ava), each a
 * real wallet sign-in, all landing in ONE team so relationships can be opened.
 * Reproduces "three wallets, one team" without pre-wiring anything off camera.
 */
test.describe("DEMO-02 Setup — three wallets, one team", () => {
  test("three wallet sign-ins, each its own identity", async ({ browser, baseURL }) => {
    const chanho = await spawnPerson(browser, baseURL, "Chanho");
    const hannah = await spawnPerson(browser, baseURL, "Hannah Brooks");
    const ava = await spawnPerson(browser, baseURL, "Ava Thorne");
    try {
      for (const p of [chanho, hannah, ava]) {
        const me = await p.ctx.get("/api/auth/me");
        const { user } = await me.json();
        expect(user.id).toBe(p.id);
        expect(user.displayName).toBe(p.name);
        // metamask-verify stamped the wallet address onto the account
        expect(user.ainAddress).toBe(p.wallet.address);
      }
      // three distinct wallets, three distinct users
      const ids = new Set([chanho.id, hannah.id, ava.id]);
      expect(ids.size).toBe(3);
    } finally {
      await Promise.all([chanho, hannah, ava].map((p) => p.context.close()));
    }
  });

  test("Hannah and Ava join Chanho's team via real invites", async ({ browser, baseURL }) => {
    const chanho = await spawnPerson(browser, baseURL, "Chanho");
    const hannah = await spawnPerson(browser, baseURL, "Hannah Brooks");
    const ava = await spawnPerson(browser, baseURL, "Ava Thorne");
    try {
      await inviteAndJoin(chanho.ctx, hannah.ctx);
      await inviteAndJoin(chanho.ctx, ava.ctx);

      // Chanho's workspace now holds all three — the New-relationship modal's
      // member list is exactly this set.
      const res = await chanho.ctx.get("/api/workspace/members");
      expect(res.ok()).toBeTruthy();
      const { members } = await res.json();
      const ids = new Set(members.map((m: { id: string }) => m.id));
      expect(ids.has(chanho.id)).toBeTruthy();
      expect(ids.has(hannah.id)).toBeTruthy();
      expect(ids.has(ava.id)).toBeTruthy();
      expect(members.length).toBeGreaterThanOrEqual(3);
    } finally {
      await Promise.all([chanho, hannah, ava].map((p) => p.context.close()));
    }
  });
});
