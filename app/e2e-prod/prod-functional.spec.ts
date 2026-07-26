import { test, expect, type Page } from "@playwright/test";

/**
 * Does the deployed app actually work when someone uses it?
 *
 * prod-smoke.spec checks the demo world renders. This checks the things a
 * visitor will try for themselves: make a page, type in it, come back and find
 * the text still there, search for it, attach an image.
 *
 * Writes go to a scratch account. `POST /api/auth/demo-login {as}` mints a
 * `demo:<slug>` identity with its own workspace, so nothing here appears in the
 * demo world a judge is looking at. The slug is fixed rather than random so
 * repeated runs reuse one account instead of littering the users table.
 */
const SCRATCH = "qa-smoke";

async function signInScratch(page: Page) {
  await page.goto("/login");
  const res = await page.request.post("/api/auth/demo-login", { data: { as: SCRATCH } });
  expect(res.ok(), "scratch sign-in failed").toBeTruthy();
  await page.goto("/home");
  await expect(page.getByTestId("home-workspaces")).toBeVisible();
}

/** The editor sets this once the page it is on has hydrated. */
async function waitEditorReady(page: Page) {
  await page.waitForFunction(() => {
    const m = location.pathname.match(/\/p\/([0-9a-f-]{36})/);
    return !!m && (window as unknown as Record<string, unknown>).__editorReady === m[1];
  }, { timeout: 30_000 });
}

async function createPage(page: Page): Promise<string> {
  const before = page.url().match(/\/p\/([0-9a-f-]{36})/)?.[1] ?? null;
  await page.getByTestId("sidebar-new-page").click();
  await page.waitForURL((url) => {
    const m = url.pathname.match(/\/p\/([0-9a-f-]{36})/);
    return !!m && m[1] !== before;
  }, { timeout: 45_000 });
  await waitEditorReady(page);
  return page.url().match(/\/p\/([0-9a-f-]{36})/)![1];
}

/**
 * Removes the pages a test created, including when it failed partway.
 *
 * Deliberately not `page.request`: the page fixture is disposed before hooks
 * finish, so those deletes fail — and the first version swallowed the error,
 * which is how five scratch pages piled up in production unnoticed. This opens
 * its own context, signs in again, and asserts each delete landed. `permanent=1`
 * matters too: without it DELETE only archives, so the rows keep piling up.
 */
const trash: string[] = [];
test.afterEach(async ({ playwright, baseURL }) => {
  if (!trash.length) return;
  const api = await playwright.request.newContext({ baseURL });
  try {
    await api.post("/api/auth/demo-login", { data: { as: SCRATCH } });
    while (trash.length) {
      const id = trash.pop()!;
      const res = await api.delete(`/api/pages/${id}?permanent=1`);
      expect(res.status(), `scratch page ${id} not cleaned up`).toBe(200);
    }
  } finally {
    await api.dispose();
  }
});

test.describe("production — what a visitor can actually do", () => {
  test("a new page keeps its title and text across a reload", async ({ page }) => {
    await signInScratch(page);
    const id = await createPage(page);
    trash.push(id);

    const title = `QA ${Date.now()}`;
    const body = "the deployed build persisted this line";
    await page.getByTestId("page-title").fill(title);
    await page.locator('[data-testid^="block-editable-"]').first().click();
    await page.keyboard.type(body);

    // Autosave is debounced; a reload is the honest test that it committed
    // rather than merely showing in local state.
    await expect
      .poll(async () => (await page.request.get(`/api/pages/${id}`)).status(), { timeout: 20_000 })
      .toBe(200);
    await page.waitForTimeout(1200);
    await page.reload();
    await waitEditorReady(page);

    await expect(page.getByTestId("page-title")).toHaveValue(title);
    await expect(page.getByTestId("editor-root")).toContainText(body);
  });

  test("search finds a page the visitor just wrote", async ({ page }) => {
    await signInScratch(page);
    const id = await createPage(page);
    trash.push(id);

    const needle = `zeta${Date.now().toString().slice(-6)}`;
    await page.getByTestId("page-title").fill(`Findable ${needle}`);
    await page.waitForTimeout(1200);

    await page.getByTestId("sidebar-search").click();
    await expect(page.getByTestId("search-modal")).toBeVisible();
    await page.getByTestId("search-input").fill(needle);

    // Assert the result ROW, not the modal's text. The modal echoes the query
    // back in two places — the "Ask AI: <query>" button and the empty state's
    // No results for "<query>" — so a contains-check on the modal passes with
    // zero results, and would stay green if search 500'd.
    await expect(page.getByTestId(`search-result-${id}`)).toBeVisible({ timeout: 20_000 });
  });

  test("an uploaded image is stored and served back", async ({ page }) => {
    await signInScratch(page);

    // 1x1 PNG — enough to prove the write path and the mounted volume.
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64"
    );
    const res = await page.request.post("/api/upload", {
      multipart: { file: { name: "qa.png", mimeType: "image/png", buffer: png } },
    });
    expect(res.status(), "upload rejected").toBe(200);
    const { url } = await res.json();
    expect(url, "upload returned no url").toMatch(/^\/uploads\//);

    const fetched = await page.request.get(url);
    expect(fetched.status(), `uploaded file not served back: ${url}`).toBe(200);
  });

  test("the demo world is reachable from home without signing in twice", async ({ page }) => {
    // Judges use the shared demo account rather than pairing two wallets, so
    // this is their real path: land on home, pick a relationship, read it.
    await page.goto("/login");
    await page.getByTestId("demo-login-button").click();
    await page.waitForURL(/\/home/);

    const list = page.getByTestId("home-workspaces");
    await expect(list).toBeVisible();
    await expect(list, "the relationships are not offered on home").toContainText("Hannah");

    const { rooms } = await page.request.get("/api/dm/rooms").then((r) => r.json());
    expect(rooms?.length, "no relationship room to open").toBeGreaterThan(0);
    await page.goto(`/dm/${rooms[0].id}`);
    await expect(page.getByTestId("dm-room-title")).toBeVisible();
    await expect(page.getByTestId("dm-messages")).toBeVisible();
  });
});
