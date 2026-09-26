import { test, expect, type BrowserContext } from "@playwright/test";
import { sealData } from "iron-session";

/**
 * Deployment check — looks at the site that is actually running, in a browser.
 *
 * **Read-only.** Writes, uploads and deletes nothing. This is live data.
 *
 * The previous version signed in through `POST /api/auth/demo-login`, an
 * endpoint that disappeared on 2026-08-03 (`ecfcc6b`, wallet/demo removal).
 * After that all 11 tests died on the same line — for over three weeks there
 * was **effectively no deployment check**. This rebuilds it.
 *
 * Sign-in seals a session cookie directly, the same way the dev checks do.
 * Better than reviving a test-only login route — it adds no attack surface.
 *
 *   PROD_URL=https://ainmem.ainetwork.ai \
 *   PROD_SESSION_SECRET=… PROD_USER_ID=… \
 *   npx playwright test -c playwright.prod.config.ts
 *
 * The secrets are not in the repo. Without them the signed-in tests are
 * skipped and only what an anonymous visitor sees runs — "is the site alive"
 * is still answered.
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

test.describe("the deployed site — what anyone sees", () => {
  test("health check is 200 (meaning the schema matches this build)", async ({ request }) => {
    const res = await request.get("/api/health");
    expect(res.status(), "503 means the live DB is behind this build").toBe(200);
  });

  test("signed out, the login screen shows", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("google-login-button")).toBeVisible();
  });

  test("nobody's files can be fetched without signing in", async ({ request }) => {
   // Since the object-storage migration this is the only door bytes leave by;
   // if it is open, every workspace's attachments and images are public
    const res = await request.get(
      "/api/files/key/files/" + "a".repeat(64) + ".png",
      { failOnStatusCode: false }
    );
    expect([401, 403, 404]).toContain(res.status());
  });
});

test.describe("what a signed-in person sees", () => {
  test.skip(!signedIn, "PROD_SESSION_SECRET / PROD_USER_ID not set");

  test.beforeEach(async ({ context, baseURL }) => {
    await signIn(context, baseURL!);
  });

  test("home renders and the sidebar has content", async ({ page }) => {
    await page.goto("/home");
    await expect(page.getByTestId("sidebar")).toBeVisible();
   // An empty tree means the DB connected but content is not coming — a 200 alone does not catch it
    await expect(page.locator("[data-testid^='page-tree-item-']").first()).toBeVisible();
  });

  test("opening a page renders its body", async ({ page }) => {
    const pageId = process.env.PROD_PAGE_ID;
    test.skip(!pageId, "PROD_PAGE_ID not set");
    await page.goto(`/p/${pageId}`);
    await expect(page.getByTestId("sidebar")).toBeVisible();
    await expect(page.locator("h1, [contenteditable]").first()).toBeVisible();
  });

  test("images from object storage actually render", async ({ page }) => {
   // The migration (2026-08-28) moved images from disk to MinIO. If only the
   // reference changed and the bytes never arrived, the page looks fine with
   // broken pictures — and the health check is 200.
    const pageId = process.env.PROD_IMAGE_PAGE_ID;
    test.skip(!pageId, "PROD_IMAGE_PAGE_ID not set");
    await page.goto(`/p/${pageId}`);
    const img = page.locator("img[src^='/api/files/key/']").first();
    await expect(img).toBeVisible();
    await expect
      .poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth), { timeout: 20_000 })
      .toBeGreaterThan(0);
  });
});
