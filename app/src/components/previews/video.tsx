"use client";
// Video: play natively when the container is one browsers decode. Anything
// else (avi, wmv, flv, mpeg-ps, 3gp…) — or a native container whose codec the
// browser can't decode (HEVC, ProRes in .mov/.mp4) — gets a download card:
// this app has no transcode service.
import { useEffect, useRef, useState } from "react";
import { isNativeVideo } from "@/lib/preview-kind";
import type { PreviewProps } from "./types";
import { PreviewMessage } from "./status";

export const CANT_PLAY_VIDEO = "브라우저에서 재생할 수 없는 동영상입니다 — 다운로드해서 열어 주세요.";

export default function VideoPreview({ src }: PreviewProps) {
  // Keyed by URL so switching files starts native again.
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  if (isNativeVideo(src.name) && failedUrl !== src.url) {
    return <Player url={src.url} onError={() => setFailedUrl(src.url)} />;
  }
  return <PreviewMessage name={src.name} size={src.size} message={CANT_PLAY_VIDEO} download={src.url} />;
}

function Player({ url, onError }: { url: string; onError: () => void }) {
  const ref = useRef<HTMLVideoElement>(null);
  // An undecodable codec shows up two ways: `error` (MEDIA_ERR_SRC_NOT_SUPPORTED
  // / DECODE), or — Chromium with HEVC/ProRes — metadata loads but videoWidth
  // stays 0 while the audio track would play. Checked from an effect, not
  // onLoadedMetadata: a fast Range response can deliver metadata before
  // React's handler sees it. (An audio-only .mp4 trips the second check too.)
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    const check = () => { if (v.error || (v.readyState >= 1 && v.videoWidth === 0)) onError(); };
    check();
    v.addEventListener("loadedmetadata", check);
    v.addEventListener("error", check);
    return () => { v.removeEventListener("loadedmetadata", check); v.removeEventListener("error", check); };
  }, [url, onError]);
  return (
    <div className="h-full flex items-center justify-center bg-black p-2">
      {/* preload=metadata: grab duration/dimensions only; bytes flow on
          play/seek via Range requests. */}
      <video
        ref={ref}
        key={url}
        src={url}
        controls
        preload="metadata"
        playsInline
        className="max-w-full max-h-full rounded-md"
      />
    </div>
  );
}
