/**
 * Moves the family's trip photos in time, on the phones themselves: every
 * photo's EXIF date (taken/modified) shifts so the trip ends on --end. For a
 * live demo — "Make an album from today's trip photos." then really means
 * today's photos. Files are read and written over aindrive MCP, as each owner.
 *
 *   pnpm tsx scripts/family-demo-trip-date.mts [--end today|YYYY-MM-DD] [--home ~/.ainmem-demo]
 *
 * Only photos with EXIF in the latest run of back-to-back days are moved; the
 * dates are rewritten in place (same length), nothing else in the file changes.
 */
process.loadEnvFile?.(new URL("../.env.local", import.meta.url).pathname);

const fs = await import("node:fs");
const os = await import("node:os");
const path = await import("node:path");
const { listDrives, listTree, notUserFolder, readFileBytes, writeFileBytes } = await import("../src/lib/aindrive");
const { runAs } = await import("../src/lib/aindrive-account");
const { readExif } = await import("../src/lib/exif");

const arg = (name: string, fallback?: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const HOME = arg("home", path.join(os.homedir(), ".ainmem-demo")) as string;
const kst = new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10);
const endArg = arg("end", "today") as string;
const END = endArg === "today" ? kst : endArg;
if (!/^\d{4}-\d{2}-\d{2}$/.test(END)) throw new Error("--end is today or YYYY-MM-DD");
const family = JSON.parse(fs.readFileSync(path.join(HOME, "family.json"), "utf8")) as {
  members: Record<string, { name: string; drive: string; ainmemUserId: string }>;
};

type Photo = { owner: string; name: string; link: { driveId: string; root: string }; rel: string; bytes: Buffer; day: string };
const photos: Photo[] = [];
for (const m of Object.values(family.members)) {
  await runAs(m.ainmemUserId, async () => {
    const d = (await listDrives()).find((x) => x.name === m.drive);
    if (!d) return;
    const link = { driveId: d.id, root: "" };
    for (const rel of (await listTree(link, 500, 80, notUserFolder)).filter((f) => /\.jpe?g$/i.test(f))) {
      const bytes = await readFileBytes(link, rel);
      const day = readExif(bytes).takenAt?.slice(0, 10);
      if (day) photos.push({ owner: m.ainmemUserId, name: m.name, link, rel, bytes, day });
    }
  });
}
const days = [...new Set(photos.map((p) => p.day))].sort();
let run: string[] = [];
for (const d of days) run = run.length && (Date.parse(d) - Date.parse(run[run.length - 1])) / 86_400_000 <= 1 ? [...run, d] : [d];
if (!run.length) throw new Error("no photos with EXIF dates");
const shift = (Date.parse(END) - Date.parse(run[run.length - 1])) / 86_400_000;
console.log(`trip ${run[0]} ~ ${run[run.length - 1]} → ends ${END} (${shift >= 0 ? "+" : ""}${shift} days)`);
const moved = (d: string) => new Date(Date.parse(d) + shift * 86_400_000).toISOString().slice(0, 10);
for (const p of photos.filter((x) => run.includes(x.day))) {
  let s = p.bytes.toString("latin1");
  for (const d of run) s = s.split(d.replace(/-/g, ":")).join(moved(d).replace(/-/g, ":"));
  await runAs(p.owner, () => writeFileBytes(p.link, p.rel, Buffer.from(s, "latin1")));
  console.log(`${p.name}: ${p.rel} ${p.day} → ${moved(p.day)}`);
}
process.exit(0);
