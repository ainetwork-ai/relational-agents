// Opens an archive in the browser and exposes a flat listing + per-entry
// extraction. libarchive.js runs libarchive (wasm) in a worker: listing skips
// entry data, and each entry is extracted only when the user opens it.
import { Archive } from "libarchive.js";
import { gunzipSync } from "fflate";
import { extOf } from "@/lib/preview-kind";
import { legacyZipNames } from "./archive-zip-names";

// Self-hosted by scripts/copy-preview-assets.mjs. The worker resolves
// libarchive.wasm relative to its own URL (same directory).
const WORKER_URL = "/preview-assets/libarchive/worker-bundle.js";

export type ArchiveItem = {
  /** Display path ("dir/sub/file.txt"), no trailing slash. */
  path: string;
  isDir: boolean;
  size: number;
};

export type OpenedArchive = {
  items: ArchiveItem[];
  /** Some entries are encrypted — they list but cannot be extracted. */
  encrypted: boolean;
  extract: (path: string) => Promise<Blob>;
  close: () => void;
};

export const ENCRYPTED_ENTRY = "This entry is password-protected. Download the archive to open it.";

// Raw worker entry (libarchive.js' own listing hides directories and loses
// archive order — we need both for folders and the legacy-name remap).
type RawEntry = { type: string; path: string; size: number };
type Reader = Awaited<ReturnType<typeof Archive.open>>;

async function listRaw(reader: Reader): Promise<RawEntry[]> {
  // `client` is private in the typings (pinned libarchive.js 2.x internals).
  const client = (reader as unknown as { client?: { listFiles?: () => Promise<RawEntry[]> } }).client;
  if (typeof client?.listFiles === "function") return client.listFiles();
  // Fallback to the public API if the private client ever changes shape.
  const arr: Array<{ file: { name: string; size: number }; path: string }> = await reader.getFilesArray();
  return arr.map((e) => ({ type: "FILE", path: e.path + e.file.name, size: e.file.size }));
}

// "report.txt.gz" → "report.txt" — for a plain compressed file with no tar inside.
function innerName(name: string): string {
  return name.replace(/\.(gz|bz2|xz)$/i, "") || "file";
}

// Member blobs back same-origin blob: URLs (download anchor, <video>, pdf.js).
// An untyped blob opened in a new tab could be sniffed as HTML and run on the
// app origin, so every member is forced to an inert type.
const INERT = "application/octet-stream";

function singleFile(name: string, data: Uint8Array): OpenedArchive {
  const path = innerName(name);
  const blob = new Blob([data as BlobPart], { type: INERT });
  return {
    items: [{ path, isDir: false, size: data.byteLength }],
    encrypted: false,
    extract: async () => blob,
    close: () => {},
  };
}

export async function openArchive(name: string, data: ArrayBuffer): Promise<OpenedArchive> {
  Archive.init({ workerUrl: WORKER_URL });
  let reader: Reader | null = null;
  try {
    reader = await Archive.open(new File([data], name));
    const raw = await listRaw(reader);
    // A lone compressed file lists as empty rather than failing.
    if (raw.length === 0 && /^(gz|bz2|xz)$/.test(extOf(name))) throw new Error("not an archive");
    const r = reader;
    const encrypted = (await r.hasEncryptedData().catch(() => null)) === true;
    const fixed = legacyZipNames(data);
    const useFixed = fixed && fixed.length === raw.length;
    const byDisplay = new Map<string, string>(); // display path → libarchive path
    const items: ArchiveItem[] = [];
    raw.forEach((e, i) => {
      if (e.type !== "FILE" && e.type !== "DIR") return; // symlinks, devices: skip
      const path = (useFixed ? fixed[i] : e.path).replace(/\/+$/, "");
      if (!path) return;
      byDisplay.set(path, e.path);
      items.push({ path, isDir: e.type === "DIR", size: e.size });
    });
    return {
      items,
      encrypted,
      extract: async (path) => {
        try {
          const file: Blob = await r.extractSingleFile(byDisplay.get(path) ?? path);
          return file.type === INERT ? file : file.slice(0, file.size, INERT);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          throw new Error(/passphrase|encrypt|decrypt/i.test(msg) ? ENCRYPTED_ENTRY : `Could not extract this entry (${msg}).`);
        }
      },
      close: () => { void r.close(); },
    };
  } catch (e) {
    void reader?.close();
    // libarchive has no "raw" format in this build, so a lone compressed file
    // (server.log.gz) fails to open. Gzip we can inflate ourselves; bz2/xz we can't.
    const ext = extOf(name);
    if (ext === "gz" || (data.byteLength > 2 && new Uint8Array(data, 0, 2).join() === "31,139")) {
      try { return singleFile(name, gunzipSync(new Uint8Array(data))); } catch { /* fall through */ }
    }
    if (ext === "bz2" || ext === "xz") {
      throw new Error(`Single-file .${ext} files can't be previewed in the browser. Download it to open it.`);
    }
    throw new Error(`This archive couldn't be opened${e instanceof Error && e.message ? ` (${e.message})` : ""}. It may be damaged or in an unsupported format.`);
  }
}
