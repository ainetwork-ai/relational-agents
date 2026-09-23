"use client";
// Shared loading / error / no-preview states for renderers.
import { Download, Loader2 } from "lucide-react";
import clsx from "clsx";
import { fileIconForName, prettyBytes } from "./file-icon";

export function PreviewLoading({ label }: { label?: string }) {
  return (
    <div className="h-full min-h-[200px] flex flex-col items-center justify-center gap-2 text-neutral-500 dark:text-neutral-400">
      <Loader2 className="w-4 h-4 animate-spin" />
      {label && <span className="text-xs">{label}</span>}
    </div>
  );
}

/** Type icon + name + message. Used for "no inline preview" and for errors.
    `download` adds a download button (file card for unsupported types). */
export function PreviewMessage({ name, message, onRetry, download, size }: {
  name: string;
  message: string;
  onRetry?: () => void;
  /** Same-origin URL of the original bytes. */
  download?: string;
  size?: number;
}) {
  const { Icon, className: tone } = fileIconForName(name);
  return (
    <div className="h-full min-h-[200px] flex flex-col items-center justify-center gap-3 p-6 text-center">
      <Icon className={clsx("w-16 h-16", tone)} />
      <div className="text-sm text-neutral-800 dark:text-neutral-200 max-w-xs truncate" title={name}>{name}</div>
      {size ? <div className="-mt-2 text-xs text-neutral-500 dark:text-neutral-400 tabular-nums">{prettyBytes(size)}</div> : null}
      <p className="text-xs text-neutral-500 dark:text-neutral-400 max-w-sm">{message}</p>
      {onRetry && (
        <button type="button" onClick={onRetry} className="px-3 py-1.5 rounded-full border border-neutral-200 dark:border-neutral-700 text-xs text-neutral-800 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-800">
          Retry
        </button>
      )}
      {download && (
        <a
          href={download}
          download={name}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-blue-500 text-white text-xs hover:bg-blue-600"
        >
          <Download className="w-3.5 h-3.5" />
          다운로드
        </a>
      )}
    </div>
  );
}

export const NO_PREVIEW = "미리보기를 지원하지 않는 형식입니다 — 다운로드해서 열어 주세요.";
