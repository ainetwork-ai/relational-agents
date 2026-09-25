/**
 * Pushes files to the family's devices the way a phone would: over aindrive
 * MCP (`write_file`), as each person's own account — not by copying into the
 * drive folder behind aindrive's back.
 *
 *   pnpm tsx scripts/family-demo-push.mts --from <dir> [--home ~/.ainmem-demo]
 *     --from  a folder holding grandma/ mom/ dad/ seoyeon/ — each file lands at
 *             the same relative path on that person's drive
 *
 * Text (md, csv, txt, json) is written as UTF-8, everything else as bytes.
 * Every file is read back and compared, so "pushed" means "there".
 */
process.loadEnvFile?.(new URL("../.env.local", import.meta.url).pathname);

const fs = await import("node:fs");
const os = await import("node:os");
const path = await import("node:path");
const { listDrives, writeFile, writeFileBytes, readFile, readFileBytes } = await import("../src/lib/aindrive");
const { runAs } = await import("../src/lib/aindrive-account");

const arg = (name: string, fallback?: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const FROM = arg("from");
const HOME = arg("home", path.join(os.homedir(), ".ainmem-demo")) as string;
if (!FROM) {
  console.error("usage: family-demo-push.mts --from <dir with grandma/ mom/ dad/ seoyeon/> [--home DIR]");
  process.exit(2);
}
const family = JSON.parse(fs.readFileSync(path.join(HOME, "family.json"), "utf8")) as {
  members: Record<string, { name: string; drive: string; ainmemUserId: string }>;
};
const TEXT = /\.(md|markdown|csv|txt|json)$/i;
const walk = (d: string): string[] =>
  fs.existsSync(d)
    ? fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]))
    : [];

let failed = 0;
for (const [key, m] of Object.entries(family.members)) {
  const files = walk(path.join(FROM, key));
  if (!files.length) continue;
  await runAs(m.ainmemUserId, async () => {
    const d = (await listDrives()).find((x) => x.name === m.drive);
    if (!d) throw new Error(`${m.name}: no drive named "${m.drive}" — is its aindrive CLI running?`);
    const link = { driveId: d.id, root: "" };
    for (const f of files) {
      const rel = path.relative(path.join(FROM, key), f).split(path.sep).join("/");
      try {
        let same: boolean;
        if (TEXT.test(rel)) {
          const text = fs.readFileSync(f, "utf8");
          await writeFile(link, rel, text);
          same = (await readFile(link, rel)) === text;
        } else {
          const bytes = fs.readFileSync(f);
          await writeFileBytes(link, rel, bytes);
          same = Buffer.compare(await readFileBytes(link, rel), bytes) === 0;
        }
        if (!same) failed++;
        console.log(`${m.name} → ${m.drive}: ${rel} ${same ? "✓" : "✗ differs after write"}`);
      } catch (e) {
        failed++;
        console.log(`${m.name} → ${m.drive}: ${rel} ✗ ${(e as Error).message}`);
      }
    }
  });
}
process.exit(failed ? 1 : 0);
