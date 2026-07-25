import "server-only";
import { watch } from "node:fs";
import { existsSync } from "node:fs";
import path from "node:path";
import { publish } from "@/lib/realtime"; // fs → SSE bridge

/**
 * The folder IS the backend — so edits made directly on disk (editor, git
 * pull, scripts) must reach open clients just like API edits do. Watches
 * NOTION_FS_ROOT recursively and broadcasts a realtime event on the OKF
 * page channel (base64url of the relative path), which makes any open
 * BlockEditor refetch via its normal applyRemote path.
 *
 * Survives dev HMR module duplication via globalThis (same pattern as
 * lib/realtime).
 */

const KEY = Symbol.for("notion.fswatch.started");

export function ensureFsWatcher(): void {
  const g = globalThis as unknown as Record<symbol, boolean>;
  if (g[KEY]) return;
  const root = process.env.NOTION_FS_ROOT;
  if (!root || !existsSync(root)) return;
  g[KEY] = true;

  const pending = new Map<string, ReturnType<typeof setTimeout>>();
  try {
    watch(root, { recursive: true }, (_event, filename) => {
      if (!filename) return;
      const rel = filename.split(path.sep).join("/");
      // only content files; skip tempfiles and hidden dirs
      if (!/\.(md|csv)$/i.test(rel)) return;
      if (rel.includes(".tmp-") || rel.split("/").some((seg) => seg.startsWith("."))) return;

      // debounce per file — editors fire several events per save
      const prev = pending.get(rel);
      if (prev) clearTimeout(prev);
      pending.set(
        rel,
        setTimeout(() => {
          pending.delete(rel);
          const pageId = Buffer.from(rel, "utf8").toString("base64url");
          const at = Date.now();
          publish({ type: "blocks", pageId, clientId: "fs-watch", at });
          publish({ type: "page", pageId, clientId: "fs-watch", at });
          // folder index pages (dir/index.md) are addressed by the dir path too
          if (rel.endsWith("/index.md")) {
            const dirId = Buffer.from(rel.slice(0, -"/index.md".length), "utf8").toString(
              "base64url"
            );
            publish({ type: "blocks", pageId: dirId, clientId: "fs-watch", at });
          }
        }, 300)
      );
    });
  } catch {
    // fs.watch recursive unavailable — degrade to no live file sync
    g[KEY] = false;
  }
}
