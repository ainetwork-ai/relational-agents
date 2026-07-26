import { test, expect, type Page, type ConsoleMessage } from "@playwright/test";

/**
 * Read-only smoke check against the deployed site, scene by scene.
 *
 * The demo script (assets/script.txt) is the spec: sign in, one workspace per
 * relationship, an agent born on mutual consent, a photo that becomes a memory,
 * and that memory staying with the relationship it belongs to. e2e/DEMO-0*.spec
 * already drives those scenes end to end — but against a dev server and a
 * scratch database, and by signing consent and dissolving relationships. None
 * of that may touch production.
 *
 * So this asserts the observable STATE each scene depends on: if the deployed
 * build can show the demo, these pass. Nothing here writes.
 */

/**
 * Collects the failures that mean something, and only those.
 *
 * Next prefetches route payloads (`?_rsc=`) and cancels them on navigation; the
 * DM event stream is a long-lived SSE aborted at teardown; and the agent
 * endpoint answers 404 by design — `loadAgent` reads res.ok to decide whether a
 * room has an agent, so "no agent" IS a 404. None is a defect.
 */
const ABORTED = /net::ERR_ABORTED/;
const AGENT_PROBE = /\/api\/dm\/rooms\/[^/]+\/agent$/;

function watch(page: Page) {
  const problems: string[] = [];
  page.on("console", (m: ConsoleMessage) => {
    // The browser logs a line for every non-2xx; the response handler judges
    // those with the URL in hand. Keep only real script errors.
    if (m.type() === "error" && !/Failed to load resource/.test(m.text()))
      problems.push(`console: ${m.text().slice(0, 200)}`);
  });
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

/** OKF page ids are the content path; the route takes it base64url-encoded. */
function pageUrl(okfPath: string) {
  return `/p/${Buffer.from(okfPath, "utf8").toString("base64url")}`;
}

const HANNAH_TIMELINE = "Relationship doc — Hannah Brooks-f08201/Timeline.md";
const AVA_TIMELINE = "Relationship doc — Ava Thorne-36b9ad/Timeline.md";

async function demoLogin(page: Page) {
  await page.goto("/login");
  await page.getByTestId("demo-login-button").click();
  await page.waitForURL(/\/home/, { timeout: 45_000 });
}

/**
 * Opens a relationship document and waits for its blocks to actually arrive.
 *
 * `editor-root` turns visible while still holding placeholder glyphs, so a text
 * read here can catch "💘 💕 💕 •". For the absence check that is worse than a
 * flake: "Ava's record has no egg tart" would pass on an empty page, which is
 * the one result this suite must never report for the wrong reason.
 */
async function openDoc(page: Page, okfPath: string) {
  await page.goto(pageUrl(okfPath));
  await expect(page.getByTestId("page-title")).toBeVisible();
  const editor = page.getByTestId("editor-root");
  await expect(editor).toBeVisible();
  await expect
    .poll(async () => (await editor.innerText()).replace(/[\s•💘💕]/g, "").length, {
      message: `document never loaded its content: ${okfPath}`,
      timeout: 20_000,
    })
    .toBeGreaterThan(200);
  return editor;
}

test.describe("production — the demo, scene by scene (read-only)", () => {
  // ── "He signs in with his wallet." ───────────────────────────────────────
  test("scene: sign-in lands on the account the demo world hangs off", async ({ page }) => {
    const problems = watch(page);
    await demoLogin(page);

    // /home renders for an empty account too, so assert the identity.
    const me = await page.request.get("/api/auth/me").then((r) => r.json());
    expect(me.user?.displayName).toBe("Chanho");

    await expect(page.getByTestId("home-cover")).toBeVisible();
    expect(problems, problems.join("\n")).toEqual([]);
  });

  // ── "He has two exclusive workspaces — one for Hannah, one for Ava." ─────
  test("scene: one workspace per relationship", async ({ page }) => {
    const problems = watch(page);
    await demoLogin(page);

    const { workspaces } = await page.request.get("/api/workspaces").then((r) => r.json());
    const names: string[] = workspaces.map((w: { name: string }) => w.name);
    expect(names, `workspaces: ${names.join(", ")}`).toEqual(
      expect.arrayContaining([expect.stringContaining("Hannah"), expect.stringContaining("Ava")])
    );

    await expect(page.getByTestId("home-workspaces")).toBeVisible();
    expect(problems, problems.join("\n")).toEqual([]);
  });

  // ── "This is Chanho's home — ten different women, each with her own agent" ─
  test("scene: the home dashboard lists the relationships", async ({ page }) => {
    const problems = watch(page);
    await demoLogin(page);

    await expect(page.getByTestId("home-dashboard")).toBeVisible();
    const { rooms } = await page.request.get("/api/dm/rooms").then((r) => r.json());
    expect(rooms?.length, "no relationships to show").toBeGreaterThan(0);
    expect(problems, problems.join("\n")).toEqual([]);
  });

  // ── "Chanho drops a photo in — the agent organized it into the document." ─
  test("scene: the photo became a memory, and the image still loads", async ({ page }) => {
    const problems = watch(page);
    await demoLogin(page);

    await openDoc(page, HANNAH_TIMELINE);

    // Uploads live on a mounted volume — a redeploy that loses the mount
    // leaves the page rendering fine with every image broken.
    const imgs = page.getByTestId("editor-root").locator("img");
    const n = await imgs.count();
    for (let i = 0; i < n; i++) {
      const src = await imgs.nth(i).getAttribute("src");
      if (!src) continue;
      const res = await page.request.get(src);
      expect(res.status(), `image not served: ${src}`).toBe(200);
    }
    expect(problems, problems.join("\n")).toEqual([]);
  });

  // ── "The Chanho-and-Hannah agent holds the egg tarts. Ava's holds none." ──
  test("scene: the egg tart lives with Hannah, and never with Ava", async ({ page }) => {
    const problems = watch(page);
    await demoLogin(page);

    const hannah = await openDoc(page, HANNAH_TIMELINE);
    await expect(hannah, "Hannah's record lost the egg tart memory").toContainText(/egg tarts?/i);

    // openDoc has already proven this page carries real content, so an absent
    // egg tart here means isolation held — not that nothing rendered.
    const ava = await openDoc(page, AVA_TIMELINE);
    await expect(
      ava,
      "the egg tart leaked into Ava's record — isolation broken"
    ).not.toContainText(/egg tarts?/i);
    expect(problems, problems.join("\n")).toEqual([]);
  });

  // ── "And right then — a video call." ─────────────────────────────────────
  test("scene: a room and its call surface open", async ({ page }) => {
    const problems = watch(page);
    await demoLogin(page);

    const { rooms } = await page.request.get("/api/dm/rooms").then((r) => r.json());
    const room = rooms[0];
    await page.goto(`/dm/${room.id}`);
    await expect(page.getByTestId("dm-room-title")).toBeVisible();
    await expect(page.getByTestId("dm-messages")).toBeVisible();

    // Placing a call needs two browsers and media permissions; what is checked
    // here is that the deployed build serves the surface without blowing up.
    await page.goto(`/call/${room.id}`);
    await expect(page.locator("body")).toBeVisible();
    expect(problems, problems.join("\n")).toEqual([]);
  });

  // ── "The relational agent is born when both sign." ───────────────────────
  // Demo-readiness, not a build check: the deployment can be perfectly healthy
  // and still have no agent in the demo rooms, which is what `pnpm demo:seed`
  // is for. Failing here means "do not record yet", not "the code is broken".
  test("scene: the demo relationships have their agent", async ({ page }) => {
    await demoLogin(page);

    // One relationship per workspace, and /api/dm/rooms only returns the active
    // one's — so walk them. Switching moves session.activeWorkspaceId and
    // nothing else, which is the same kind of write as signing in.
    const { workspaces } = await page.request.get("/api/workspaces").then((r) => r.json());
    const checked: string[] = [];
    const withAgent: string[] = [];

    for (const ws of workspaces) {
      await page.request.post("/api/workspaces/switch", { data: { workspaceId: ws.id } });
      const { rooms } = await page.request.get("/api/dm/rooms").then((r) => r.json());
      for (const r of rooms ?? []) {
        checked.push(r.name);
        const res = await page.request.get(`/api/dm/rooms/${r.id}/agent`);
        if (res.ok()) withAgent.push(r.name);
      }
    }

    expect(
      withAgent.length,
      `no relationship has an agent — seed the demo before recording. ` +
        `checked ${checked.length} room(s) across ${workspaces.length} workspace(s): ${checked.join(", ")}`
    ).toBeGreaterThan(0);
  });
});
