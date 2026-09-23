import { expect, test, type Page } from "@playwright/test";

/**
 * Signing in from a test.
 *
 * The demo-login button this used to click is gone with the rest of the
 * wallet-era auth, and Google sign-in is not wired yet — so every spec that
 * needs a session skips with that reason instead of timing out on a locator
 * that will never appear. Replace the body when the new flow lands; the specs
 * themselves need no change.
 */
export async function demoLogin(page: Page) {
  test.skip(true, "no sign-in path: wallet logins removed, Google login not wired yet");
  await page.goto("/login");
}

export function pageIdFromUrl(page: Page): string {
  const m = page.url().match(/\/p\/([0-9a-f-]{36})/);
  if (!m) throw new Error(`not on a page URL: ${page.url()}`);
  return m[1];
}

/** Block until THIS page's editor is hydrated (flag is page-scoped —
 *  a leftover flag from the previous page must not satisfy the check). */
export async function waitEditorReady(page: Page) {
  await page.waitForFunction(() => {
    const m = location.pathname.match(/\/p\/([0-9a-f-]{36})/);
    return (
      !!m &&
      (window as unknown as Record<string, unknown>).__editorReady === m[1]
    );
  });
}

/** Create a page via the sidebar button and return its id.
 *  NB: demo login lands on /p/<some-page>, so we must wait for the URL to
 *  change to a DIFFERENT page id — /\/p\//.test(url) matches immediately. */
export async function createRootPage(page: Page): Promise<string> {
  const before = page.url().match(/\/p\/([0-9a-f-]{36})/)?.[1] ?? null;
  await page.getByTestId("sidebar-new-page").click();
  await page.waitForURL((url) => {
    const m = url.pathname.match(/\/p\/([0-9a-f-]{36})/);
    return !!m && m[1] !== before;
  });
  await waitEditorReady(page);
  return pageIdFromUrl(page);
}

export async function setTitle(page: Page, title: string) {
  await page.getByTestId("page-title").fill(title);
  // debounce is 300ms; give the PATCH a moment
  await page.waitForTimeout(600);
}

/** The nth contentEditable block body inside the editor. */
export function blockAt(page: Page, n: number) {
  return page
    .getByTestId("editor-root")
    .locator('[data-testid^="block-editable-"]')
    .nth(n);
}

/** Wait until the debounced autosave has actually COMMITTED (fixed sleeps
 *  race a cold dev server whose first PUT pays route-compile latency). */
export async function awaitAutosave(page: Page) {
  await page.waitForTimeout(600); // let the 500ms debounce fire
  await page.waitForFunction(
    () => {
      const s = document
        .querySelector('[data-testid="editor-root"]')
        ?.getAttribute("data-save-state");
      // "idle" = no block edits happened (e.g. title-only tests) — nothing to wait for
      return s === "saved" || s === "idle";
    },
    undefined,
    { timeout: 15_000 }
  );
}

export async function expectBlockType(
  page: Page,
  n: number,
  type: string
) {
  const wrapper = page
    .getByTestId("editor-root")
    .locator("[data-block-type]")
    .nth(n);
  await expect(wrapper).toHaveAttribute("data-block-type", type);
}

/** Choose a value in a NotionSelect custom dropdown (replaces selectOption). */
export async function pick(page: Page, testid: string, value: string) {
  await page.getByTestId(testid).click();
  await page.getByTestId(`${testid}-opt-${value}`).click();
}
