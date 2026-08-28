"use client";

import { useToastStore } from "@/stores/toast";
import { checkUploadType } from "@/lib/files/allowed-types";


/** Upload a blob to /api/upload. On ANY failure the user gets a toast that
 * says why (silent failures read as "upload is broken" — user report
 * oversized/HEIC files were rejected server-side with no UI
 * feedback at all). Returns null on failure. */
/**
 * The ceiling comes from the server (`GET /api/upload/limits`), not a constant
 * baked at build time — an operator who lowers MAX_UPLOAD_MB must not need a
 * redeploy for the client to know. Until the answer arrives the size check is
 * simply skipped; the authoritative refusal is the server's 413 either way.
 */
let maxUploadBytes: number | null = null;
export async function refreshUploadLimit(): Promise<void> {
  try {
    const r = await fetch("/api/upload/limits");
    if (!r.ok) return;
    const d = (await r.json()) as { maxUploadBytes?: number };
    if (typeof d.maxUploadBytes === "number") maxUploadBytes = d.maxUploadBytes;
  } catch {
    /* leave it unknown — the server still refuses */
  }
}

export async function uploadBlob(
  file: File,
  kind?: "file"
): Promise<{ url: string; name?: string; size?: number } | null> {
  const toast = useToastStore.getState();
 // refuse before the round trip what the server would refuse after it
  if (kind === "file") {
    const check = checkUploadType(file.name, file.type);
    if (!check.allowed) {
      toast.show(
        check.reason === "ext"
          ? `".${check.ext}" files cannot be attached`
          : `"${check.mimeType}" files cannot be attached`
      );
      return null;
    }
  }
  if (maxUploadBytes === null) void refreshUploadLimit();
  if (maxUploadBytes !== null && file.size > maxUploadBytes) {
    toast.show(
      `"${file.name}" is larger than ${Math.floor(maxUploadBytes / (1024 * 1024))} MB — too big to upload`
    );
    return null;
  }
  const fd = new FormData();
  fd.append("file", file);
  if (kind) fd.append("kind", kind);
  let res: Response;
  try {
    res = await fetch("/api/upload", { method: "POST", body: fd });
  } catch {
    toast.show("Upload failed — you appear to be offline");
    return null;
  }
  if (res.ok) return (await res.json()) as { url: string; name?: string; size?: number };
  const msg =
    res.status === 413
      ? ((await res.json().catch(() => null))?.error ?? `"${file.name}" is too big to upload`)
      : res.status === 415
        ? `Unsupported image type${file.type ? ` (${file.type})` : ""} — use PNG, JPEG, GIF, WebP or AVIF`
        : ((await res.json().catch(() => null))?.error ?? "Upload failed");
  toast.show(msg);
  return null;
}
