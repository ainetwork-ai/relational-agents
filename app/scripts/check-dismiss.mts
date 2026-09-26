/**
 * A portalled popover must not hand-roll its outside-click check.
 *
 * The failure it guards against: a popover moved into `createPortal` keeps a
 * `document.addEventListener("mousedown", …)` that only tests the trigger's
 * ref. The portal node is not inside that ref, so the first mousedown on the
 * popover reads as "outside", the popover closes, and the click never reaches
 * the button. Nothing throws; the feature is just dead. That is what happened
 * to the person picker (docs/notion-projects-spec.md → the section on things we got wrong while measuring).
 *
 * The rule: a file that calls `createPortal` uses `useDismiss` (which takes the
 * portal ref too) rather than its own mousedown listener.
 *
 *   pnpm check:dismiss
 *
 * A file whose ref genuinely lives inside its portal (a modal), or whose portal
 * closes itself, opts out with a one-line reason:
 *
 *   // dismiss:manual — the ref is on the portalled modal itself
 *
 * What it cannot see: a hand-rolled listener in a file that portals nothing
 * today but is portalled tomorrow, or a `useDismiss` call that forgets the
 * portal ref. It catches the shape that has actually bitten us.
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../src");

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return walk(p);
    return e.isFile() && p.endsWith(".tsx") ? [p] : [];
  });
}

const offenders: { file: string; line: number }[] = [];
for (const file of walk(ROOT)) {
  const src = fs.readFileSync(file, "utf8");
  if (!src.includes("createPortal")) continue;
  if (!src.includes('addEventListener("mousedown"')) continue;
  if (src.includes("dismiss:manual")) continue; // opted out, with its reason
  const line = src.slice(0, src.indexOf('addEventListener("mousedown"')).split("\n").length;
  offenders.push({ file: path.relative(path.resolve(ROOT, ".."), file), line });
}

if (offenders.length) {
  console.error("\n  ┌─ A portalled popover hand-rolls its outside-click check ──");
  for (const o of offenders) console.error(`  │ ${o.file}:${o.line}`);
  console.error("  │");
  console.error("  │ Switch it to useDismiss(open, close, triggerRef, portalRef).");
  console.error("  │ Leaving out the portal node makes a click inside the popover count as 'outside',");
  console.error("  │ so it closes on mousedown and the button click never arrives.");
  console.error("  └──────────────────────────────────────────────────────────\n");
  process.exit(1);
}
console.log(`No hand-rolled outside-click check among portal-using components (${walk(ROOT).length} files checked)`);
