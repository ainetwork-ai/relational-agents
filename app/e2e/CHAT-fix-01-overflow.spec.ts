import { test, expect, type Page } from "@playwright/test";
import { demoLogin } from "./helpers";
import { CHAT_FIX_01_OVERFLOW as C } from "../src/i18n/content/e2e";

// Requirement 1: even when the chat gets long (long URLs / tokens without spaces / code), the page
// gets no horizontal scroll. Messages are seeded through the API (removing send-UI timing
// flakiness), then horizontal scroll is checked on the rendered state.

test.beforeEach(async ({ context }) => {
  await context.addCookies([
    { name: "e2e_fake_ai", value: "1", domain: "localhost", path: "/" },
  ]);
});

async function seedChat(page: Page, text: string): Promise<string> {
  const chat = await (await page.request.post("/api/ai/chats", { data: {} })).json();
  const id: string = chat.chat.id;
  const res = await page.request.post(`/api/ai/chats/${id}/messages`, {
    data: { text, present: true },
    timeout: 30_000,
  });
  await res.text();
  return id;
}
async function noHorizontalPageScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(overflow).toBeLessThanOrEqual(1);
}

test("CHAT-FIX-1010 long spaceless token + URL message → no horizontal page scroll", async ({ page }) => {
  await demoLogin(page);
  const longUrl = "https://example.com/" + "segment-".repeat(60) + "end";
  const id = await seedChat(page, `${"x".repeat(400)} ${longUrl}`);
  await page.goto(`/chat/${id}`, { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("chat-msg-user").last()).toBeVisible({ timeout: 15_000 });
  await noHorizontalPageScroll(page);
});

test("CHAT-FIX-1011 no horizontal scroll on a narrow (mobile) viewport either", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await demoLogin(page);
  const id = await seedChat(page, C.longPrefix + C.longUnit.repeat(120));
  await page.goto(`/chat/${id}`, { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("chat-msg-user").last()).toBeVisible({ timeout: 15_000 });
  await noHorizontalPageScroll(page);
});

test("CHAT-FIX-1012 code block/table render + no horizontal page scroll", async ({ page }) => {
  await demoLogin(page);
  const id = await seedChat(page, C.showCode);
  await page.goto(`/chat/${id}`, { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("chat-msg-content").last().locator("pre code").first()).toBeVisible({
    timeout: 15_000,
  });
  await noHorizontalPageScroll(page);
});
