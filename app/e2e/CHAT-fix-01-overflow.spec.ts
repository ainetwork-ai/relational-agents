import { test, expect, type Page } from "@playwright/test";
import { demoLogin } from "./helpers";

// 요구사항 1: 채팅이 길어져도(긴 URL/무공백 토큰/코드) 페이지 가로 스크롤이 생기지 않는다.
// 메시지는 API로 시드(전송 UI 타이밍 flakiness 제거)한 뒤 렌더 상태에서 가로 스크롤을 검증한다.

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

test("CHAT-FIX-1010 긴 무공백 토큰 + URL 메시지 → 페이지 가로 스크롤 없음", async ({ page }) => {
  await demoLogin(page);
  const longUrl = "https://example.com/" + "segment-".repeat(60) + "end";
  const id = await seedChat(page, `${"x".repeat(400)} ${longUrl}`);
  await page.goto(`/chat/${id}`, { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("chat-msg-user").last()).toBeVisible({ timeout: 15_000 });
  await noHorizontalPageScroll(page);
});

test("CHAT-FIX-1011 좁은 뷰포트(모바일)에서도 가로 스크롤 없음", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await demoLogin(page);
  const id = await seedChat(page, "초장문 " + "가나다라마".repeat(120));
  await page.goto(`/chat/${id}`, { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("chat-msg-user").last()).toBeVisible({ timeout: 15_000 });
  await noHorizontalPageScroll(page);
});

test("CHAT-FIX-1012 코드블록/표 렌더 + 페이지 가로 스크롤 없음", async ({ page }) => {
  await demoLogin(page);
  const id = await seedChat(page, "코드 보여줘");
  await page.goto(`/chat/${id}`, { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("chat-msg-content").last().locator("pre code").first()).toBeVisible({
    timeout: 15_000,
  });
  await noHorizontalPageScroll(page);
});
