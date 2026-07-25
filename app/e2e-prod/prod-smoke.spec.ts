import { test, expect, type Page, type ConsoleMessage } from "@playwright/test";

/**
 * Read-only smoke check against the deployed site.
 *
 * The point is the half the API checks cannot see: whether the pages actually
 * render. A build can serve 200s on every route and still paint a blank screen
 * — a client bundle missing a NEXT_PUBLIC_* value, a hydration mismatch, an
 * asset 404. Those show up here and nowhere else.
 */

/**
 * Collects the failures that mean something, and only those.
 *
 * Three kinds of noise would otherwise drown the signal. Next prefetches route
 * payloads (`?_rsc=`) and cancels them when you navigate; the DM event stream
 * is a long-lived SSE connection that is aborted on teardown; and the agent
 * endpoint answers 404 by design — `loadAgent` reads `res.ok` to decide whether
 * a room has an agent yet, so "no agent" IS a 404. None of these is a defect.
 */
const ABORTED = /net::ERR_ABORTED/;
/** 404 here is a state check, not a failure — see dm-view.tsx `loadAgent`. */
const AGENT_PROBE = /\/api\/dm\/rooms\/[^/]+\/agent$/;

function watch(page: Page) {
  const problems: string[] = [];
  page.on("console", (m: ConsoleMessage) => {
    // The browser logs its own line for every non-2xx; the response handler
    // below judges those, with the URL in hand. Keep only real script errors.
    if (m.type() === "error" && !/Failed to load resource/.test(m.text()))
      problems.push(`console: ${m.text().slice(0, 200)}`);
  });
  // An uncaught exception is always a defect.
  page.on("pageerror", (e) => problems.push(`pageerror: ${String(e).slice(0, 200)}`));
  page.on("requestfailed", (r) => {
    if (ABORTED.test(r.failure()?.errorText ?? "")) return;
    problems.push(`requestfailed: ${r.method()} ${r.url().slice(0, 120)} — ${r.failure()?.errorText}`);
  });
  page.on("response", (r) => {
    if (r.status() < 400) return;
    if (r.status() === 404 && AGENT_PROBE.test(new URL(r.url()).pathname)) return;
    problems.push(`http ${r.status()}: ${r.url().slice(0, 120)}`);
  });
  return problems;
}

async function demoLogin(page: Page) {
  await page.goto("/login");
  await page.getByTestId("demo-login-button").click();
  await page.waitForURL(/\/home/, { timeout: 45_000 });
}

test.describe("production smoke (read-only)", () => {
  test("the demo entry lands on a populated home", async ({ page }) => {
    const problems = watch(page);
    await demoLogin(page);

    // The demo must open on the account that owns the relationship world. An
    // empty account also renders /home fine, so assert the identity, not the URL.
    const me = await page.request.get("/api/auth/me").then((r) => r.json());
    expect(me.user, "demo login returned no user").toBeTruthy();
    expect(me.user.displayName).toBe("Chanho");

    await expect(page.getByTestId("home-cover")).toBeVisible();
    await expect(page.getByTestId("home-workspaces")).toBeVisible();
    expect(problems, `page problems:\n${problems.join("\n")}`).toEqual([]);
  });

  test("a relationship room renders its conversation", async ({ page }) => {
    const problems = watch(page);
    await demoLogin(page);

    const { rooms } = await page.request.get("/api/dm/rooms").then((r) => r.json());
    expect(rooms?.length, "the demo account sees no rooms").toBeGreaterThan(0);

    await page.goto(`/dm/${rooms[0].id}`);
    await expect(page.getByTestId("dm-room-title")).toBeVisible();
    await expect(page.getByTestId("dm-messages")).toBeVisible();

    // A room with history must actually paint messages, not an empty shell.
    const { messages } = await page
      .request.get(`/api/dm/rooms/${rooms[0].id}/messages`)
      .then((r) => r.json());
    if (messages?.length) {
      await expect(page.getByTestId("dm-messages").locator("> *").first()).toBeVisible();
    }
    expect(problems, `page problems:\n${problems.join("\n")}`).toEqual([]);
  });

  test("the OKF content tree is served and readable", async ({ page }) => {
    const problems = watch(page);
    await demoLogin(page);

    // The folder tree IS the content database — if the volume were unmounted
    // the API would answer 200 with nothing, which is the failure to catch.
    const { tree } = await page.request.get("/api/okf/tree").then((r) => r.json());
    expect(tree?.length, "OKF tree is empty — content volume not mounted?").toBeGreaterThan(0);
    expect(problems, `page problems:\n${problems.join("\n")}`).toEqual([]);
  });

  test("static assets the demo depends on are present", async ({ page }) => {
    // The home cover ships in the image; uploads come from a mounted volume.
    // A 404 here means a redeploy dropped something that used to be there.
    const cover = await page.request.get("/covers/home-cover-chanho.png");
    expect(cover.status(), "demo home cover missing").toBe(200);
  });
});
