"use client";
import { useState } from "react";
import clsx from "clsx";
import { fileIconForName } from "./file-icon";
import type { PreviewProps } from "./types";
import { PreviewMessage } from "./status";

const CANT_PLAY = "브라우저에서 재생할 수 없는 오디오입니다 — 다운로드해서 열어 주세요.";

/**
 * Type icon + filename over a full-width <audio> control. Plays natively; if
 * the browser can't decode the codec (e.g. MPEG-1 Layer II .mpga/.mp2) it
 * shows a download card (no transcode service in this app).
 */
export default function AudioPreview({ src }: PreviewProps) {
  // Keyed by URL so switching files starts native again.
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  if (failedUrl === src.url) return <PreviewMessage name={src.name} size={src.size} message={CANT_PLAY} download={src.url} />;
  const { Icon, className: tone } = fileIconForName(src.name);
  return (
    <div className="h-full min-h-[200px] flex flex-col items-center justify-center gap-4 p-6">
      <Icon className={clsx("w-16 h-16", tone)} />
      <div className="text-sm text-neutral-800 dark:text-neutral-200 text-center max-w-xs truncate" title={src.name}>{src.name}</div>
      {/* onError fires for MEDIA_ERR_SRC_NOT_SUPPORTED / DECODE on the element. */}
      <audio key={src.url} src={src.url} controls preload="metadata" onError={() => setFailedUrl(src.url)} className="w-full max-w-sm" />
    </div>
  );
}
