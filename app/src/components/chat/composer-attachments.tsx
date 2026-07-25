"use client";

import { useCallback, useRef, useState } from "react";
import { Paperclip, X } from "lucide-react";
import { uploadBlob } from "@/lib/upload";
import { newId } from "@/lib/compat";

export interface ComposerAttachment {
  id: string;
  name: string;
  url: string;
  isImage: boolean;
}

/** Attachment state: file pick/paste → upload via the existing /api/upload
 *  (kind=file) → kept as a chip list. Reaches the server only merged into the
 *  message body string at send time (demo). */
export function useComposerAttachments() {
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const addFiles = useCallback(async (files: FileList | File[] | null) => {
    if (!files || files.length === 0) return;
    setError(null);
    for (const file of Array.from(files)) {
      const result = await uploadBlob(file, "file");
      if (!result) {
        setError(`Could not upload "${file.name}"`);
        continue;
      }
      setAttachments((prev) => [
        ...prev,
        {
          id: newId(),
          name: result.name ?? file.name,
          url: result.url,
          isImage: file.type.startsWith("image/"),
        },
      ]);
    }
  }, []);

  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const clear = useCallback(() => setAttachments([]), []);

  const openFilePicker = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      void addFiles(e.target.files);
      e.target.value = "";
    },
    [addFiles]
  );

  /** If the clipboard holds an image, upload it as an attachment (paste integration). */
  const handlePaste = useCallback(
    (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const files = Array.from(e.clipboardData?.items ?? [])
        .filter((it) => it.kind === "file" && it.type.startsWith("image/"))
        .map((it) => it.getAsFile())
        .filter((f): f is File => !!f);
      if (files.length > 0) void addFiles(files);
    },
    [addFiles]
  );

  /** String appended to the body at send time: "\n[attachment: name](url)" × N */
  const serialize = useCallback(() => {
    return attachments.map((a) => `\n[Attachment: ${a.name}](${a.url})`).join("");
  }, [attachments]);

  return {
    attachments,
    error,
    fileInputRef,
    addFiles,
    removeAttachment,
    clear,
    openFilePicker,
    handleFileInputChange,
    handlePaste,
    serialize,
  };
}

/** Attach button + hidden file input. */
export function AttachButton({
  onOpen,
  fileInputRef,
  onFileChange,
  disabled,
}: {
  onOpen: () => void;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  disabled?: boolean;
}) {
  return (
    <>
      <button
        type="button"
        data-testid="composer-attach-btn"
        onClick={onOpen}
        disabled={disabled}
        aria-label="Attach a file"
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-neutral-500 hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-40 dark:text-neutral-400 dark:hover:bg-neutral-800"
      >
        <Paperclip size={15} />
      </button>
      <input
        ref={fileInputRef}
        type="file"
        multiple
        data-testid="composer-file-input"
        onChange={onFileChange}
        className="hidden"
      />
    </>
  );
}

/** Attachment chip list + error display. */
export function AttachmentsList({
  attachments,
  error,
  onRemove,
}: {
  attachments: ComposerAttachment[];
  error: string | null;
  onRemove: (id: string) => void;
}) {
  if (attachments.length === 0 && !error) return null;
  return (
    <div className="mb-2 space-y-1.5">
      {error && (
        <p data-testid="attachment-error" className="text-xs text-red-500 dark:text-red-400">
          {error}
        </p>
      )}
      {attachments.length > 0 && (
        <div data-testid="attachments-list" className="flex flex-wrap gap-1.5">
          {attachments.map((a) => (
            <div
              key={a.id}
              data-testid="attachment-chip"
              className="flex items-center gap-1.5 rounded-md border border-neutral-200 bg-neutral-50 py-1 pl-1.5 pr-1 text-xs dark:border-neutral-700 dark:bg-neutral-800"
            >
              {a.isImage && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={a.url}
                  alt={a.name}
                  data-testid="attachment-preview"
                  className="h-6 w-6 rounded object-cover"
                />
              )}
              <span
                data-testid="attachment-name"
                className="max-w-[10rem] truncate text-neutral-700 dark:text-neutral-200"
              >
                {a.name}
              </span>
              <button
                type="button"
                data-testid="attachment-remove"
                onClick={() => onRemove(a.id)}
                aria-label={`Remove ${a.name}`}
                className="rounded p-0.5 text-neutral-400 hover:bg-neutral-200 hover:text-neutral-600 dark:hover:bg-neutral-700"
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
