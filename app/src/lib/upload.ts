"use client";

import { useToastStore } from "@/stores/toast";
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_LABEL } from "@/lib/upload-limits";


/** Upload a blob to /api/upload. On ANY failure the user gets a toast that
 * says why (silent failures read as "upload is broken" — user report
 * oversized/HEIC files were rejected server-side with no UI
 * feedback at all). Returns null on failure. */
export async function uploadBlob(
  file: File,
  kind?: "file"
): Promise<{ url: string; name?: string; size?: number } | null> {
  const toast = useToastStore.getState();
  if (file.size > MAX_UPLOAD_BYTES) {
    toast.show(`"${file.name}" is larger than ${MAX_UPLOAD_LABEL} — too big to upload`);
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
      ? `"${file.name}" is larger than ${MAX_UPLOAD_LABEL} — too big to upload`
      : res.status === 415
        ? `Unsupported image type${file.type ? ` (${file.type})` : ""} — use PNG, JPEG, GIF, WebP or AVIF`
        : ((await res.json().catch(() => null))?.error ?? "Upload failed");
  toast.show(msg);
  return null;
}
