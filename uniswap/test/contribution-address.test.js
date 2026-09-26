// The app repeats RecurringContribution's Base address (its Docker build context is app/ alone);
// this keeps it equal to the deployment record.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const here = path.dirname(new URL(import.meta.url).pathname);

test("the app's RecurringContribution address is the one deployed on Base", () => {
  const deployed = JSON.parse(fs.readFileSync(path.join(here, "../contracts/deployments/base.json"), "utf8"));
  const app = fs.readFileSync(path.join(here, "../../app/src/lib/agent/treasury/contribution-plan.ts"), "utf8");
  const inApp = app.match(/contract: "(0x[0-9a-fA-F]{40})"/)?.[1];
  assert.equal(inApp, deployed.RecurringContribution.address);
  assert.equal(deployed.chainId, 8453);
});
