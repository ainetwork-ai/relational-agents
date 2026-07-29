import { test, expect, type Page } from "@playwright/test";
import { demoLogin } from "./helpers";

// 요구사항 2: 채팅 안의 링크가 평문이 아니라 하이퍼링크(<a>)로 렌더된다.
// fake 응답에 마크다운 링크 [docs](https://example.com/docs)와 맨 URL https://example.com 포함.

test.beforeEach(async ({ context }) => {
  await context.addCookies([
    { name: "e2e_fake_ai", value: "1", domain: "localhost", path: "/" },
  ]);
});

async function seedAndOpen(page: Page): Promise<void> {
  const chat = await (await page.request.post("/api/ai/chats", { data: {} })).json();
  const id: string = chat.chat.id;
  const res = await page.request.post(`/api/ai/chats/${id}/messages`, {
    data: { text: "링크 보여줘", present: true },
    timeout: 30_000,
  });
  await res.text();
  await page.goto(`/chat/${id}`, { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("chat-msg-content").last()).toBeVisible({ timeout: 15_000 });
}

test("CHAT-FIX-2010 마크다운 링크가 <a>로 렌더되고 텍스트/href/보안속성 올바름", async ({ page }) => {
  await demoLogin(page);
  await seedAndOpen(page);
  const link = page.getByTestId("chat-msg-content").last().locator('a[href="https://example.com/docs"]');
  await expect(link).toBeVisible();
  await expect(link).toHaveText("docs"); // 평문 [docs](...)가 아니라 링크 텍스트만
  await expect(link).toHaveAttribute("target", "_blank");
  await expect(link).toHaveAttribute("rel", /noopener/);
});

test("CHAT-FIX-2011 맨 URL도 자동 하이퍼링크된다", async ({ page }) => {
  await demoLogin(page);
  await seedAndOpen(page);
  const auto = page
    .getByTestId("chat-msg-content")
    .last()
    .locator('a[href="https://example.com"]');
  await expect(auto).toBeVisible();
  await expect(auto).toHaveText("https://example.com");
});

test("CHAT-FIX-2012 링크 원문 마크다운 대괄호가 화면에 안 보인다(평문 아님)", async ({ page }) => {
  await demoLogin(page);
  await seedAndOpen(page);
  const content = page.getByTestId("chat-msg-content").last();
  await expect(content).not.toContainText("[docs](https://example.com/docs)");
});
