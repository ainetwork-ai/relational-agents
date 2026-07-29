"use client";

import { useRef, useState } from "react";
import { Download } from "lucide-react";

interface ImportResult {
  name: string;
  pages: number;
  databases: number;
}

/** Sidebar "Import" control: upload a workspace export .zip → it becomes pages. */
export function ImportButton() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function submit() {
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setError("Choose a workspace export .zip first");
      return;
    }
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/import", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Import failed");
      } else {
        setResult(data as ImportResult);
      }
    } catch {
      setError("Import failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        data-testid="import-button"
        onClick={() => {
          setOpen(true);
          setResult(null);
          setError(null);
        }}
        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-neutral-500 transition-colors hover:bg-neutral-200/50 dark:text-neutral-400 dark:hover:bg-neutral-800"
      >
        <Download size={15} />
        Import
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-[2px]"
          onClick={() => !busy && setOpen(false)}
        >
          <div
            data-testid="import-modal"
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-xl border border-neutral-200 bg-white p-5 shadow-2xl dark:border-neutral-700 dark:bg-neutral-800"
          >
            <h2 className="mb-1 text-base font-semibold text-neutral-800 dark:text-neutral-100">
              Import export
            </h2>
            <p className="mb-4 text-xs text-neutral-500 dark:text-neutral-400">
              Upload a workspace export <code>.zip</code> (Markdown &amp; CSV). Its pages and
              databases are added to your content tree.
            </p>

            <input
              ref={fileRef}
              type="file"
              accept=".zip"
              data-testid="import-file-input"
              className="mb-4 block w-full text-sm text-neutral-600 file:mr-3 file:rounded-md file:border-0 file:bg-neutral-900 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-white dark:text-neutral-300 dark:file:bg-neutral-200 dark:file:text-neutral-900"
            />

            {error && (
              <p data-testid="import-error" className="mb-3 text-sm text-red-500">
                {error}
              </p>
            )}

            {result ? (
              <div data-testid="import-result" className="mb-3 rounded-md bg-green-50 p-3 text-sm text-green-700 dark:bg-green-900/20 dark:text-green-300">
                Imported <strong>{result.name}</strong>: {result.pages} pages,{" "}
                {result.databases} databases.
                <button
                  data-testid="import-done"
                  onClick={() => window.location.reload()}
                  className="mt-2 block rounded-md bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700"
                >
                  Show in sidebar
                </button>
              </div>
            ) : (
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setOpen(false)}
                  disabled={busy}
                  className="rounded-md px-3 py-1.5 text-sm text-neutral-500 hover:bg-neutral-100 disabled:opacity-50 dark:hover:bg-neutral-700"
                >
                  Cancel
                </button>
                <button
                  data-testid="import-submit"
                  onClick={submit}
                  disabled={busy}
                  className="rounded-md bg-blue-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-blue-600 disabled:opacity-50"
                >
                  {busy ? "Importing…" : "Import"}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
