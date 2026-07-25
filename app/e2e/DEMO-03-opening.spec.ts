import { test, expect } from "@playwright/test";
import { spawnPerson, inviteAndJoin } from "./relation-helpers";

/**
 * Demo scene 3 — Opening: sign in, land in the app, open the sidebar
 * "Relationships" section, hit + and get the "New relationship" modal with the
 * member list. Also guards the fix that the modal is portaled to <body> so it
 * centers on the whole viewport (it used to be trapped inside the sidebar).
 */
test.describe("DEMO-03 Opening — dashboard + New relationship modal", () => {
  test("Relationships section, centered modal, member list", async ({ browser, baseURL }) => {
    const chanho = await spawnPerson(browser, baseURL, "Chanho");
    const hannah = await spawnPerson(browser, baseURL, "Hannah Brooks");
    const ava = await spawnPerson(browser, baseURL, "Ava Thorne");
    try {
      await inviteAndJoin(chanho.ctx, hannah.ctx);
      await inviteAndJoin(chanho.ctx, ava.ctx);

      // Chanho's own context already holds his session cookie — the page opens
      // authenticated, exactly like the first login lands you in the app.
      const page = await chanho.context.newPage();
      await page.goto("/");
      await expect(page.getByTestId("sidebar")).toBeVisible();

      // open the Chats tab where the Relationships section lives
      await page.getByTestId("sidebar-tab-chats").click();
      const dm = page.getByTestId("dm-section");
      await expect(dm).toBeVisible();
      await expect(dm.getByText("Relationships", { exact: true })).toBeVisible();

      // + opens the "New relationship" modal
      await page.getByTestId("dm-new").click();
      const modal = page.getByTestId("dm-new-modal");
      await expect(modal).toBeVisible();
      await expect(modal.getByText("New relationship", { exact: true })).toBeVisible();

      // the modal is portaled to <body> (overlay is a direct child of body) so
      // it centers over the whole viewport, not inside the sidebar column.
      const portaledAndCentered = await modal.evaluate((el) => {
        const overlay = el.parentElement; // the fixed inset-0 overlay
        const centered = overlay ? getComputedStyle(overlay).justifyContent === "center" : false;
        return overlay?.parentElement === document.body && centered;
      });
      expect(portaledAndCentered, "modal portaled to body and centered").toBeTruthy();

      // the member list is exactly Chanho's teammates — Hannah and Ava
      await expect(page.getByTestId(`dm-member-option-${hannah.id}`)).toBeVisible();
      await expect(page.getByTestId(`dm-member-option-${ava.id}`)).toBeVisible();

      await page.close();
    } finally {
      await Promise.all([chanho, hannah, ava].map((p) => p.context.close()));
    }
  });
});
