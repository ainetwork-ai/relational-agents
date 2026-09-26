"use client";

import { useEffect, useRef, useState } from "react";
import { Download, ExternalLink, HardDrive, Paperclip, Upload } from "lucide-react";
import { FilePreview } from "@/components/previews";
import { AindrivePicker } from "@/components/aindrive/aindrive-picker";
import { AindriveConnect } from "@/components/aindrive/aindrive-connect";
import { uploadResumable } from "@/lib/upload";
import { useAindriveInfo } from "@/lib/aindrive-client";
import { aindriveFileName, aindriveRawUrl, parseAindriveUrl } from "@/lib/aindrive-url";
import { useT } from "@/i18n/provider";
import { aindrivePickPending } from "@/lib/editor/block-defs";

/**
 * A file block's two faces.
 *
 * Empty: where the file comes from — this computer (uploaded, resumable), or
 * aindrive (not uploaded: the block keeps the file's aindrive link, like a
 * Google Drive attachment), or a pasted aindrive link.
 *
 * Filled: the file itself — name, where it lives, download/open, and an inline
 * preview for every type Google Drive previews (components/previews).
 */

export function FileAttachment({ blockId, url, name }: { blockId: string; url: string; name: string }) {
  const t = useT();
  const info = useAindriveInfo();
  const ref = parseAindriveUrl(url, info?.base);
  const realName = ref ? aindriveFileName(ref) : url.split("/").pop() || "file";
  const fileName = name || realName;
  // the label may be a caption ("14:10 · Yongduam — Mom's phone"); what the file IS
  // comes from its own name when the label carries no extension
  const kindName = /\.[a-z0-9]{1,8}$/i.test(fileName) ? fileName : realName;
  const bytesUrl = ref ? aindriveRawUrl(ref) : url;
  const downloadUrl = ref ? aindriveRawUrl(ref, true) : url;
  return (
    <div
      data-testid={`file-block-${blockId}`}
      data-source={ref ? "aindrive" : "upload"}
      className="my-1 w-full overflow-hidden rounded-lg border border-neutral-200 dark:border-neutral-700"
      contentEditable={false}
    >
      <div className="flex items-center gap-2 border-b border-neutral-100 px-3 py-1.5 text-sm dark:border-neutral-800">
        {ref ? (
          <HardDrive size={14} className="shrink-0 text-neutral-400" />
        ) : (
          <Paperclip size={14} className="shrink-0 text-neutral-400" />
        )}
        <span className="truncate font-medium text-neutral-700 dark:text-neutral-200">{fileName}</span>
        <span
          className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${
            ref
              ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
              : "bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400"
          }`}
          title={ref ? t("Shows the file from aindrive as a link") : undefined}
        >
          {ref ? t("aindrive link") : t("Uploaded")}
        </span>
        <div className="ml-auto flex shrink-0 items-center gap-1">
          {ref && (
            <a
              data-testid={`file-block-open-${blockId}`}
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              title={t("Open in aindrive")}
              className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600 dark:hover:bg-neutral-800"
            >
              <ExternalLink size={14} />
            </a>
          )}
          <a
            data-testid={`file-block-download-${blockId}`}
            href={downloadUrl}
            download={fileName}
            title={t("Download")}
            className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600 dark:hover:bg-neutral-800"
          >
            <Download size={14} />
          </a>
        </div>
      </div>
      {ref && info && !info.connected ? (
        // like a Google Drive link: the file opens for people whose own
        // aindrive can open it
        <AindriveConnect compact />
      ) : (
        <FilePreview src={{ name: kindName, url: bytesUrl }} compact header={false} className="rounded-none border-0" />
      )}
    </div>
  );
}

export function FileAttachPicker({
  blockId,
  pendingName,
  onFile,
}: {
  blockId: string;
  /** a pasted attachment's name that came without a fetchable url */
  pendingName?: string;
  onFile: (file: { url: string; name: string }) => void;
}) {
  const t = useT();
  const info = useAindriveInfo();
  const inputRef = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<number | null>(null);
    // inserted from the menu's "From aindrive": start on the picker
  const [picking, setPicking] = useState(() => aindrivePickPending.has(blockId));
  useEffect(() => {
    aindrivePickPending.delete(blockId);
  }, [blockId]);
  const [link, setLink] = useState("");
  const [linkError, setLinkError] = useState<string | null>(null);
  const [over, setOver] = useState(false);

  async function upload(f: File) {
    setProgress(0);
    const up = await uploadResumable(f, (p) => setProgress(p));
    setProgress(null);
    if (up) onFile({ url: up.url, name: up.name ?? f.name });
  }

  function submitLink() {
    const ref = parseAindriveUrl(link.trim(), info?.base);
    if (!ref) return setLinkError(t("Not an aindrive file link (…/d/<drive>?path=<file>)"));
    setLinkError(null);
    onFile({ url: link.trim(), name: aindriveFileName(ref) });
  }

  return (
    <div
      data-testid={`file-drop-${blockId}`}
      contentEditable={false}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const f = e.dataTransfer.files?.[0];
        if (f) void upload(f);
      }}
      className={`my-1 w-full rounded-lg border border-dashed px-3 py-2.5 text-sm transition-colors ${
        over ? "border-neutral-500 bg-neutral-50 dark:bg-neutral-800" : "border-neutral-200 dark:border-neutral-700"
      }`}
    >
      {pendingName && (
        <p className="mb-2 text-xs text-neutral-400">
          {t("{name} — please upload it again", { name: pendingName })}
        </p>
      )}
      {progress !== null ? (
        <div data-testid={`file-upload-progress-${blockId}`} className="flex items-center gap-2 text-xs text-neutral-500">
          <span>{t("Uploading… {p}%", { p: Math.round(progress * 100) })}</span>
          <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800">
            <span className="block h-full bg-neutral-700 dark:bg-neutral-300" style={{ width: `${progress * 100}%` }} />
          </span>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <button
            data-testid={`file-upload-button-${blockId}`}
            onClick={() => inputRef.current?.click()}
            className="flex items-center gap-1.5 rounded-md border border-neutral-200 px-2.5 py-1 text-xs font-medium text-neutral-700 hover:bg-neutral-50 dark:border-neutral-600 dark:text-neutral-200 dark:hover:bg-neutral-800"
          >
            <Upload size={13} /> {t("Upload from this computer")}
          </button>
          {info?.configured && (
            <button
              data-testid={`file-aindrive-button-${blockId}`}
              onClick={() => setPicking(true)}
              className="flex items-center gap-1.5 rounded-md border border-neutral-200 px-2.5 py-1 text-xs font-medium text-neutral-700 hover:bg-neutral-50 dark:border-neutral-600 dark:text-neutral-200 dark:hover:bg-neutral-800"
            >
              <HardDrive size={13} /> {t("From aindrive")}
            </button>
          )}
          <span className="text-xs text-neutral-400">{t("or drop it here")}</span>
          <input
            ref={inputRef}
            data-testid={`file-input-${blockId}`}
            type="file"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void upload(f);
            }}
          />
        </div>
      )}
      {info?.configured && progress === null && (
        <div className="mt-2 flex items-center gap-2">
          <input
            data-testid={`file-link-input-${blockId}`}
            value={link}
            onChange={(e) => setLink(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                submitLink();
              }
            }}
            placeholder={t("Paste an aindrive file link")}
            className="flex-1 rounded-md border border-neutral-200 bg-transparent px-2 py-1 text-xs outline-none placeholder:text-neutral-400 dark:border-neutral-700"
          />
          <button
            data-testid={`file-link-submit-${blockId}`}
            onClick={submitLink}
            disabled={!link.trim()}
            className="rounded-md bg-neutral-900 px-2.5 py-1 text-xs font-medium text-white disabled:opacity-40 dark:bg-neutral-100 dark:text-neutral-900"
          >
            {t("Insert")}
          </button>
        </div>
      )}
      {linkError && <p className="mt-1 text-xs text-red-600">{linkError}</p>}
      {picking && (
        <AindrivePicker
          onClose={() => setPicking(false)}
          onPick={(f) => {
            setPicking(false);
            onFile(f);
          }}
        />
      )}
    </div>
  );
}
