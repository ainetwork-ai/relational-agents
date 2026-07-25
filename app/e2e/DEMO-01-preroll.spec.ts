import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

/**
 * Demo scene 1 — Pre-roll (Card 1 😈 / Card 2 🛡️) and the egg-tart payoff.
 * The pre-roll is narrative, but it leans on three real assets that MUST exist
 * for the video to be shot: the two concept diagrams and the Lisbon egg-tart
 * photo. This guards them (and their references in the script) from bit-rot.
 */
const REPO = path.resolve(__dirname, "../..");

test.describe("DEMO-01 Pre-roll assets", () => {
  const assets = [
    "docs/img/agent.png", // Card 1: one agent per human — the leak
    "docs/img/relational_agent.png", // Card 2: one agent per relationship — no leak
    "docs/img/egg-tart.jpg", // the Lisbon egg tart, uploaded in scene 5
  ];

  for (const rel of assets) {
    test(`asset exists: ${rel}`, () => {
      const p = path.join(REPO, rel);
      expect(fs.existsSync(p), `${rel} must exist for the pre-roll/remember scenes`).toBeTruthy();
      expect(fs.statSync(p).size, `${rel} is non-empty`).toBeGreaterThan(0);
    });
  }

  test("the script wires the concept diagrams and the tagline", () => {
    const demo = fs.readFileSync(path.join(REPO, "memory-data/content/demo.md"), "utf8");
    expect(demo).toContain("docs/img/agent.png");
    expect(demo).toContain("docs/img/relational_agent.png");
    // the thesis and the closing tagline the whole demo builds toward
    expect(demo).toMatch(/You see me, therefore I am\./);
  });
});
