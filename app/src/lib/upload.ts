"use client";

import { useToastStore } from "@/stores/toast";
import * as tus from "tus-js-client";
import { checkUploadType } from "@/lib/files/allowed-types";
import { TUS_CLIENT_CHUNK_BYTES } from "@/lib/files/upload-protocol";


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

/**
 * The resumable path — what an attachment uses.
 *
 * The buffered `uploadBlob` reads the whole file into a request; at the sizes
 * people actually attach (a 65 MiB zip on the original's own comments) that is
 * memory on both ends and a full restart on any blip. tus sends
 * TUS_CLIENT_CHUNK_BYTES at a time, resumes from the offset the server
 * acknowledged, and — because tus-js-client keeps fingerprint→URL in
 * localStorage — picks the same file back up after a reload.
 *
 * `onProgress` is called with 0..1. Resolves null on failure, after the toast.
 */
export async function uploadResumable(
  file: File,
  onProgress?: (fraction: number) => void
): Promise<{ url: string; name?: string; size?: number } | null> {
  const toast = useToastStore.getState();
  const check = checkUploadType(file.name, file.type);
  if (!check.allowed) {
    toast.show(
      check.reason === "ext"
        ? `".${check.ext}" files cannot be attached`
        : `"${check.mimeType}" files cannot be attached`
    );
    return null;
  }
  if (maxUploadBytes === null) await refreshUploadLimit();
  if (maxUploadBytes !== null && file.size > maxUploadBytes) {
    toast.show(
      `"${file.name}" is larger than ${Math.floor(maxUploadBytes / (1024 * 1024))} MB — too big to upload`
    );
    return null;
  }
  return new Promise((resolve) => {
    const upload = new tus.Upload(file, {
      endpoint: "/api/upload/tus",
      chunkSize: TUS_CLIENT_CHUNK_BYTES,
      retryDelays: [0, 1000, 3000, 5000],
      metadata: { filename: file.name, filetype: file.type },
      onProgress: (sent, total) => onProgress?.(total ? sent / total : 0),
      onError: (err) => {
       // the server's own words when it gave any (415 type, 413 size)
        const body = (err as { originalResponse?: { getBody?: () => string } })
          ?.originalResponse?.getBody?.();
        toast.show(body?.trim() || `"${file.name}" could not be uploaded`);
        resolve(null);
      },
      onSuccess: (payload) => {
       // tus-js-client v4 hands the final response to the callback; it is not
       // a property on the Upload
        const body = payload?.lastResponse?.getBody?.();
        try {
          resolve(JSON.parse(body ?? "") as { url: string; name?: string; size?: number });
        } catch {
         // finish returned no body we could read — the bytes are stored but we
         // have no url, so treat it as a failure rather than attach nothing
          toast.show(`"${file.name}" uploaded but the server sent no location`);
          resolve(null);
        }
      },
    });
    upload.start();
  });
}
