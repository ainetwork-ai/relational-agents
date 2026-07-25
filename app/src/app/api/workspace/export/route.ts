import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { getDefaultWorkspaceId } from "@/lib/workspace";
import { mirrorWorkspace } from "@/lib/md-mirror";
import { okfRoot } from "@/lib/okf-store";
import { db } from "@/lib/db";
import { workspaces } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

export const dynamic = "force-dynamic";

const MIRROR_ROOT =
  process.env.MD_MIRROR_ROOT ?? path.join(process.cwd(), "..", "md-mirror");

function slug(title: string, id: string): string {
  const s = (title || "untitled")
    .replace(/[^\p{L}\p{N} _-]/gu, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 60);
  return `${s || "untitled"}-${id.slice(0, 6)}`;
}

/** Recursively collect all files in a directory. */
async function collectFiles(
  dir: string,
  base: string
): Promise<{ path: string; data: Uint8Array }[]> {
  const results: { path: string; data: Uint8Array }[] = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    const rel = path.join(base, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await collectFiles(full, rel)));
    } else {
      results.push({ path: rel, data: await readFile(full) });
    }
  }
  return results;
}

/** Collect only .md / .csv documents from the OKF content tree (memory-safe —
 *  skips large media attachments). */
async function collectOkfDocs(
  dir: string,
  base: string
): Promise<{ path: string; data: Uint8Array }[]> {
  const results: { path: string; data: Uint8Array }[] = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    const rel = path.join(base, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await collectOkfDocs(full, rel)));
    } else if (/\.(md|csv)$/i.test(entry.name)) {
      results.push({ path: rel, data: await readFile(full) });
    }
  }
  return results;
}

/**
 * Build a minimal zip file from a list of entries.
 * Uses the "stored" method (no compression) — simple, dependency-free.
 */
function buildZip(files: { path: string; data: Uint8Array }[]): Uint8Array {
  const entries: { header: Uint8Array; centralHeader: Uint8Array; offset: number }[] = [];
  const parts: Uint8Array[] = [];
  let offset = 0;

  for (const f of files) {
    const nameBytes = new TextEncoder().encode(f.path.replace(/\\/g, "/"));
    const crc = crc32(f.data);

    // Local file header (30 + name + data)
    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true); // signature
    lv.setUint16(4, 20, true); // version
    lv.setUint16(8, 0, true); // method: stored
    lv.setUint32(14, crc, true); // crc32
    lv.setUint32(18, f.data.length, true); // compressed
    lv.setUint32(22, f.data.length, true); // uncompressed
    lv.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);

    // Central directory header
    const central = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(10, 0, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, f.data.length, true);
    cv.setUint32(24, f.data.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, offset, true);
    central.set(nameBytes, 46);

    entries.push({ header: local, centralHeader: central, offset });
    parts.push(local, f.data);
    offset += local.length + f.data.length;
  }

  // End of central directory
  const centralStart = offset;
  let centralSize = 0;
  for (const e of entries) {
    parts.push(e.centralHeader);
    centralSize += e.centralHeader.length;
  }

  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, centralStart, true);
  parts.push(eocd);

  const total = parts.reduce((s, p) => s + p.length, 0);
  const result = new Uint8Array(total);
  let pos = 0;
  for (const p of parts) {
    result.set(p, pos);
    pos += p.length;
  }
  return result;
}

/** CRC-32 (standard polynomial, no dependency). */
function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * GET /api/workspace/export → downloads the workspace as a .zip of markdown files.
 * Triggers a fresh mirror first to ensure consistency.
 */
export async function GET() {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;

  const workspaceId = await getDefaultWorkspaceId(auth.user.id);
  if (!workspaceId)
    return NextResponse.json({ error: "No workspace" }, { status: 404 });

  const [ws] = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .limit(1);
  if (!ws)
    return NextResponse.json({ error: "No workspace" }, { status: 404 });

  // Ensure the mirror is up to date
  await mirrorWorkspace(workspaceId);

  const wsDir = path.join(MIRROR_ROOT, slug(ws.name, ws.id));
  const files = await collectFiles(wsDir, "");

  // Also include the OKF content tree — the file-backed documents that ARE the
  // primary content (md pages + csv databases). Documents only (skip large
  // media) so the archive stays memory-safe.
  const okf = await collectOkfDocs(okfRoot(), "content");
  files.push(...okf);

  if (files.length === 0) {
    return NextResponse.json(
      { error: "No content to export" },
      { status: 404 }
    );
  }

  const zip = buildZip(files);
  const filename = `${slug(ws.name, ws.id)}-export.zip`;

  return new Response(Buffer.from(zip), {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="${filename}"`,
    },
  });
}
