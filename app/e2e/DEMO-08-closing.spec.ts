import { test, expect } from "@playwright/test";
import {
  spawnPerson,
  inviteAndJoin,
  openRoom,
  bornRelationship,
  myAgents,
} from "./relation-helpers";

/**
 * Demo scene 8 — Closing: Chanho's home over all his relationships. The
 * implemented "home" of relationships is the sidebar — every ❤️ room in the
 * Relationships section, each with its born agent in the Agents section. This
 * asserts that reality (the video's per-relationship progress-bar/graph
 * dashboard is a separate presentation layer, not part of the app yet).
 */
test.describe("DEMO-08 Closing — every relationship, each with its agent", () => {
  test("sidebar lists both relationships and their agents", async ({ browser, baseURL }) => {
    const chanho = await spawnPerson(browser, baseURL, "Chanho");
    const hannah = await spawnPerson(browser, baseURL, "Hannah Brooks");
    const ava = await spawnPerson(browser, baseURL, "Ava Thorne");
    try {
      await inviteAndJoin(chanho.ctx, hannah.ctx);
      await inviteAndJoin(chanho.ctx, ava.ctx);
      const roomH = await openRoom(chanho.ctx, hannah.id);
      await bornRelationship(chanho, hannah, roomH.id);
      const roomA = await openRoom(chanho.ctx, ava.id);
      await bornRelationship(chanho, ava, roomA.id);

      // both agents exist server-side (one per relationship)
      const agents = await myAgents(chanho.ctx);
      expect(agents.length).toBeGreaterThanOrEqual(2);

      // and they surface in Chanho's sidebar
      const page = await chanho.context.newPage();
      await page.goto("/");
      await expect(page.getByTestId("sidebar")).toBeVisible();
      await page.getByTestId("sidebar-tab-chats").click();

      // every ❤️ relationship is listed
      await expect(page.getByTestId(`dm-item-${roomH.id}`)).toBeVisible();
      await expect(page.getByTestId(`dm-item-${roomA.id}`)).toBeVisible();

      // the Agents section shows the born agents
      await expect(page.getByText("Agents", { exact: true })).toBeVisible();
      for (const a of agents) {
        await expect(page.getByText(a.displayName, { exact: false }).first()).toBeVisible();
      }

      await page.close();
    } finally {
      await Promise.all([chanho, hannah, ava].map((p) => p.context.close()));
    }
  });
});
