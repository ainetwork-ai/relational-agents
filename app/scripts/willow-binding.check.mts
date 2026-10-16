// The device binding: ainmem's word that a device key belongs to an ainmem user
// (docs/willow-ainmem-plan.md Task 5).
//
//   ./node_modules/.bin/tsx --tsconfig scripts/tsconfig.json scripts/willow-binding.check.mts
process.env.SESSION_SECRET ||= "check-secret-check-secret-check-secret";
const { deviceBinding, bindingValid } = await import("../src/lib/willow/binding");

const fails: string[] = [];
const check = (name: string, ok: boolean) => {
  console.log(`${ok ? "✓" : "✗"} ${name}`);
  if (!ok) fails.push(name);
};
const key = "ab".repeat(32);
const b = deviceBinding("user-a", key);
check("the binding verifies for the same user and key", bindingValid("user-a", key, b));
check("another user's session cannot use it", !bindingValid("user-b", key, b));
check("another key cannot use it", !bindingValid("user-a", "cd".repeat(32), b));
check("garbage is refused", !bindingValid("user-a", key, "zz") && !bindingValid("user-a", key, undefined as unknown as string));
if (fails.length) {
  console.log(`\n${fails.length} failed`);
  process.exit(1);
}
console.log("\nall passed");
