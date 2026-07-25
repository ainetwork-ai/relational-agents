import "server-only";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { okfRoot } from "./okf-store";

const run = promisify(execFile);

export interface ImportResult {
  name: string;
  pages: number;
  databases: number;
  dest: string;
}

function countTree(dir: string): { pages: number; databases: number } {
  let pages = 0;
  let databases = 0;
  const walk = (d: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.md$/i.test(e.name) && e.name.toLowerCase() !== "index.md") pages++;
      else if (/\.csv$/i.test(e.name) && !/_all\.csv$/i.test(e.name)) databases++;
    }
  };
  walk(dir);
  return { pages, databases };
}

/**
 * Import a workspace export .zip into the OKF content root as pages/databases.
 * Handles nested wrapper: the outer .zip contains one or more
 * `ExportBlock-<id>-Part-N.zip` archives which hold the actual md/csv/folder
 * tree. Long-filename attachment errors are tolerated (pages still import).
 * The content lands under okfRoot()/<name> so it shows up in the sidebar tree.
 */
export async function importExportZip(zipPath: string, importName: string): Promise<ImportResult> {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "memory-import-"));
  try {
 // pass 1: unzip the uploaded archive (tolerate long-name / attachment errors)
    await run("unzip", ["-o", "-q", zipPath, "-d", tmp]).catch(() => {});

 // pass 2: The export wraps everything in ExportBlock-*.zip (one per part)
    const inner = fs
      .readdirSync(tmp)
      .filter((n) => /^ExportBlock-.*\.zip$/i.test(n));
    let contentRoot = tmp;
    if (inner.length > 0) {
      const extracted = path.join(tmp, "__okf_content");
      await fsp.mkdir(extracted, { recursive: true });
      for (const z of inner) {
        await run("unzip", ["-o", "-q", path.join(tmp, z), "-d", extracted]).catch(() => {});
      }
      contentRoot = extracted;
    }

 // If the export root is a single wrapper folder, unwrap it for a cleaner tree.
    let placeFrom = contentRoot;
    const top = fs.readdirSync(contentRoot, { withFileTypes: true });
    const topDirs = top.filter((e) => e.isDirectory());
    const topFiles = top.filter((e) => e.isFile());
    if (topDirs.length === 1 && topFiles.length === 0) {
      placeFrom = path.join(contentRoot, topDirs[0].name);
    }

    const safeName =
      importName.replace(/\.zip$/i, "").replace(/[/\\]/g, "-").trim().slice(0, 80) || "Imported";
    const root = okfRoot();
    await fsp.mkdir(root, { recursive: true });
    const dest = path.join(root, safeName);
    await fsp.rm(dest, { recursive: true, force: true });
    await fsp.cp(placeFrom, dest, { recursive: true, force: true });

    const { pages, databases } = countTree(dest);
    if (pages === 0 && databases === 0) {
      throw new Error("nothing to import — the zip did not contain a workspace export (md/csv)");
    }
    return { name: safeName, pages, databases, dest };
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
}
