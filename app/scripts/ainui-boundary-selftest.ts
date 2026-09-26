import assert from "node:assert/strict";
import { confineAction, confinedPath, confineSurface } from "../src/lib/ainui-boundary";

const link = { driveId: "drive1", root: "family/shared" };
for (const path of ["family", "family/shared-other", "family/shared/../secret", "family/shared\\..\\secret"])
  assert.throws(() => confinedPath(link.root, path));
assert.equal(confinedPath(link.root, "family/shared/docs/a.txt"), "family/shared/docs/a.txt");
assert.throws(() => confineAction({ name: "aindrive.open", context: { drive_id: "other", path: link.root } }, link));
assert.throws(() => confineAction({ name: "x402_sign", context: { path: link.root } }, link));
assert.throws(() => confineAction({ name: "aindrive.delete", context: { path: link.root } }, link));
const protectedPath = "family/shared/backup";
for (const action of [
  { name: "aindrive.save", context: { path: `${protectedPath}/page.md`, content: "oops" } },
  { name: "aindrive.delete", context: { path: link.root } },
  { name: "aindrive.upload", context: { path: link.root, name: "../outside" } },
  { name: "aindrive.upload", context: { path: link.root, name: "backup" } },
]) assert.throws(() => confineAction(action, link, protectedPath));
assert.equal(confineAction({ name: "aindrive.upload", context: { path: link.root, name: "photo.png" } }, link, protectedPath).context?.drive_id, link.driveId);
const picker = confineSurface([{ version: "v0.9", updateComponents: { surfaceId: "picker", components: [
  { id: "open", component: "Button", action: { event: { name: "aindrive.open" } } },
  { id: "upload", component: "FileUpload" },
  { id: "delete", component: "Button", action: { event: { name: "aindrive.delete" } } },
] } }], link.root, true);
assert.ok("updateComponents" in picker[0]);
const nodes = picker[0].updateComponents.components;
assert.equal(nodes[0].component, "Button");
assert.equal(nodes[1].component, "Text");
assert.equal(nodes[2].component, "Text");
console.log("AIN-UI boundary checks passed: linked roots, drive identity, action allow-list and managed backups.");
