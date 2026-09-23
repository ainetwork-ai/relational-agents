import { test, expect, type BrowserContext } from "@playwright/test";
import { sealData } from "iron-session";

/**
 * 배포 검증 — 실제로 떠 있는 사이트를 브라우저로 본다.
 *
 * **읽기만 한다.** 글을 쓰거나 올리거나 지우지 않는다. 라이브 데이터다.
 *
 * 이전 판은 `POST /api/auth/demo-login` 으로 로그인했는데 그 엔드포인트는
 * 2026-08-03(`ecfcc6b`, 지갑·데모 제거)에 사라졌다. 그 뒤로 11개 전부 같은 줄에서
 * 죽고 있었고 — 3주 넘게 **배포 검증이 사실상 없었다**. 여기서 다시 세운다.
 *
 * 로그인은 세션 쿠키를 직접 서명해 넣는다. dev 검사들이 쓰는 방법 그대로다.
 * 테스트 전용 로그인 경로를 되살리는 것보다 낫다 — 공격면을 늘리지 않는다.
 *
 *   PROD_URL=https://ainmem.ainetwork.ai \
 *   PROD_SESSION_SECRET=… PROD_USER_ID=… \
 *   npx playwright test -c playwright.prod.config.ts
 *
 * 비밀값은 레포에 없다. 안 주면 로그인이 필요한 것들은 skip 되고, 익명으로 볼 수
 * 있는 것만 돈다 — 비밀값 없이도 "사이트가 살아 있나"는 답한다.
 */

const SECRET = process.env.PROD_SESSION_SECRET;
const USER_ID = process.env.PROD_USER_ID;
const signedIn = Boolean(SECRET && USER_ID);

async function signIn(context: BrowserContext, baseURL: string) {
  const cookie = await sealData({ userId: USER_ID }, { password: SECRET!, ttl: 0 });
  await context.addCookies([
    { name: "rm-session", value: cookie, domain: new URL(baseURL).hostname, path: "/", secure: true },
  ]);
}

test.describe("배포된 사이트 — 누구나 보는 것", () => {
  test("헬스체크가 200 이다 (스키마가 이 빌드에 맞는다는 뜻)", async ({ request }) => {
    const res = await request.get("/api/health");
    expect(res.status(), "503 이면 라이브 DB 가 이 빌드보다 뒤처졌다").toBe(200);
  });

  test("로그인하지 않으면 로그인 화면이 나온다", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("google-login-button")).toBeVisible();
  });

  test("로그인 없이 남의 파일을 가져갈 수 없다", async ({ request }) => {
   // 오브젝트 스토리지 이관 뒤 바이트가 나가는 유일한 문이라, 여기가 뚫리면
   // 워크스페이스의 첨부와 이미지가 전부 공개된다
    const res = await request.get(
      "/api/files/key/files/" + "a".repeat(64) + ".png",
      { failOnStatusCode: false }
    );
    expect([401, 403, 404]).toContain(res.status());
  });
});

test.describe("로그인한 사람이 보는 것", () => {
  test.skip(!signedIn, "PROD_SESSION_SECRET / PROD_USER_ID 가 없다");

  test.beforeEach(async ({ context, baseURL }) => {
    await signIn(context, baseURL!);
  });

  test("홈이 그려지고 사이드바에 내용이 있다", async ({ page }) => {
    await page.goto("/home");
    await expect(page.getByTestId("sidebar")).toBeVisible();
   // 트리가 비어 있으면 DB 는 붙었는데 내용이 안 오는 상태다 — 200 만으로는 안 잡힌다
    await expect(page.locator("[data-testid^='page-tree-item-']").first()).toBeVisible();
  });

  test("페이지를 열면 본문이 그려진다", async ({ page }) => {
    const pageId = process.env.PROD_PAGE_ID;
    test.skip(!pageId, "PROD_PAGE_ID 가 없다");
    await page.goto(`/p/${pageId}`);
    await expect(page.getByTestId("sidebar")).toBeVisible();
    await expect(page.locator("h1, [contenteditable]").first()).toBeVisible();
  });

  test("오브젝트 스토리지의 이미지가 실제로 그려진다", async ({ page }) => {
   // 이관(2026-08-28)으로 이미지가 디스크에서 MinIO 로 옮겨갔다. 참조만 바뀌고
   // 바이트가 안 왔으면 화면은 멀쩡히 뜨면서 그림만 깨진다 — 헬스체크는 200 이다.
    const pageId = process.env.PROD_IMAGE_PAGE_ID;
    test.skip(!pageId, "PROD_IMAGE_PAGE_ID 가 없다");
    await page.goto(`/p/${pageId}`);
    const img = page.locator("img[src^='/api/files/key/']").first();
    await expect(img).toBeVisible();
    await expect
      .poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth), { timeout: 20_000 })
      .toBeGreaterThan(0);
  });
});
