import { test, expect, type Page } from "@playwright/test";
import { demoLogin } from "./helpers";
import { CHAT_FIX_02_LINKS as C } from "../src/i18n/content/e2e";

// Requirement 2: links in the chat render as hyperlinks (<a>), not plain text.
// The fake reply contains the markdown link [docs](https://example.com/docs) and the bare URL https://example.com.

test.beforeEach(async ({ context }) => {
  await context.addCookies([
    { name: "e2e_fake_ai", value: "1", domain: "localhost", path: "/" },
  ]);
});

async function seedAndOpen(page: Page): Promise<void> {
  const chat = await (await page.request.post("/api/ai/chats", { data: {} })).json();
  const id: string = chat.chat.id;
  const res = await page.request.post(`/api/ai/chats/${id}/messages`, {
    data: { text: C.showLinks, present: true },
    timeout: 30_000,
  });
  await res.text();
  await page.goto(`/chat/${id}`, { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("chat-msg-content").last()).toBeVisible({ timeout: 15_000 });
}

test("CHAT-FIX-2010 markdown link renders as <a> with correct text/href/security attributes", async ({ page }) => {
  await demoLogin(page);
  await seedAndOpen(page);
  const link = page.getByTestId("chat-msg-content").last().locator('a[href="https://example.com/docs"]');
  await expect(link).toBeVisible();
  await expect(link).toHaveText("docs"); // only the link text, not the plain [docs](...)
  await expect(link).toHaveAttribute("target", "_blank");
  await expect(link).toHaveAttribute("rel", /noopener/);
});

test("CHAT-FIX-2011 a bare URL is auto-linked too", async ({ page }) => {
  await demoLogin(page);
  await seedAndOpen(page);
  const auto = page
    .getByTestId("chat-msg-content")
    .last()
    .locator('a[href="https://example.com"]');
  await expect(auto).toBeVisible();
  await expect(auto).toHaveText("https://example.com");
});

test("CHAT-FIX-2012 the raw markdown brackets of a link are not visible (not plain text)", async ({ page }) => {
  await demoLogin(page);
  await seedAndOpen(page);
  const content = page.getByTestId("chat-msg-content").last();
  await expect(content).not.toContainText("[docs](https://example.com/docs)");
});
