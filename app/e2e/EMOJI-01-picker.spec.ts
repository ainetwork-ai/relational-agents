import { test, expect } from "@playwright/test";
import { demoLogin, createRootPage, blockAt, waitEditorReady } from "./helpers";

/**
 * The icon picker and the `:shortcode:` shorthand run off the generated Unicode
 * catalogue (src/lib/emoji-data.generated.ts, ~1.9k emoji) which loads as its own
 * chunk on first use. These cover the part that only shows up in a browser: that
 * the chunk arrives, the grid fills, and search/shortcodes resolve against it.
 */
test.describe("emoji picker", () => {
  test("offers the whole catalogue, searchable", async ({ page }) => {
    await demoLogin(page);
    await createRootPage(page);

    // "😀 Add icon" in the page header
    await page.getByTestId("page-icon").click();
    const picker = page.getByTestId("icon-picker");
    await expect(picker).toBeVisible();

    // nine category tabs, and the grid fills once the chunk lands
    const grid = picker.locator(".grid button");
    await expect.poll(() => grid.count(), { timeout: 15_000 }).toBeGreaterThan(150);

    // every category holds emoji, and together they span the full set
    let total = 0;
    for (const name of ["Smileys", "People", "Nature", "Food", "Activities", "Travel", "Objects", "Symbols", "Flags"]) {
      const tab = picker.getByRole("button", { name });
      await tab.click();
      await expect(picker.getByText(name, { exact: true })).toBeVisible();
      const n = await grid.count();
      expect(n, `${name} should not be empty`).toBeGreaterThan(50);
      total += n;
    }
    expect(total).toBeGreaterThan(1500);

    // search reaches emoji the old hand-picked set never carried
    const search = page.getByTestId("icon-picker-search");
    await search.fill("melting");
    await expect(picker.getByRole("button", { name: "melting face" })).toBeVisible();

    await search.fill("south korea");
    await expect(picker.getByRole("button", { name: "flag: South Korea" })).toBeVisible();

    // and picking one puts it in the header
    await picker.getByRole("button", { name: "flag: South Korea" }).click();
    await expect(page.getByTestId("page-icon")).toHaveText("🇰🇷");
  });

  test("skin tone applies to sequences, not just single code points", async ({ page }) => {
    await demoLogin(page);
    await createRootPage(page);
    await page.getByTestId("page-icon").click();
    const picker = page.getByTestId("icon-picker");
    await page.getByTestId("icon-picker-search").fill("technologist");
    const technologist = picker.getByRole("button", { name: "technologist" }).first();
    await expect(technologist).toBeVisible();

    // default is the yellow 🧑‍💻
    await expect(technologist).toHaveText("🧑‍💻");
    // three clicks → medium tone, applied inside the ZWJ sequence
    for (let i = 0; i < 3; i++) await page.getByTestId("icon-skin-tone").click();
    await expect(technologist).toHaveText("🧑🏽‍💻");

    await technologist.click();
    await expect(page.getByTestId("page-icon")).toHaveText("🧑🏽‍💻");
  });

  test(":shortcode: expands beyond the legacy list", async ({ page }) => {
    await demoLogin(page);
    await createRootPage(page);
    await waitEditorReady(page);

    const block = blockAt(page, 0);
    await block.click();
    // :tada: is resident; :melting_face: and :kr: only exist in the lazy chunk,
    // and typing at human speed gives it the moment it needs to arrive
    await page.keyboard.type(":tada: :melting_face: :kr:", { delay: 60 });
    await expect(block).toHaveText("🎉 🫠 🇰🇷");
  });

  test(": autocomplete suggests from the whole set", async ({ page }) => {
    await demoLogin(page);
    await createRootPage(page);
    await waitEditorReady(page);

    const block = blockAt(page, 0);
    await block.click();
    await page.keyboard.type(":melt", { delay: 60 });
    const menu = page.getByTestId("emoji-suggest-menu");
    await expect(menu).toBeVisible();
    // 🫠 is offered by its shortest spelling, and 🫕 by name
    await expect(menu).toContainText(":melt:");
    await expect(menu).toContainText("fondue");
    await page.keyboard.press("Enter");
    await expect(block).toHaveText("🫠");
  });
});
