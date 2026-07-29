"use client";

import { useState } from "react";
import { Lock } from "lucide-react";
import {
  NOTE_BLOB_ID,
  NOTE_PLAINTEXT_PREVIEW,
  ROOM_SEALED,
  walrusBlobUrl,
} from "@/lib/sui/demo";

interface BlobHead {
  blobId: string;
  url: string;
  totalBytes: number;
  headBytes: number;
  hex: string;
  ascii: string;
  marker: string;
  containsMarker: boolean;
  fetchedAt: string;
}

/** Group the hex string into xxd-style rows of 16 bytes. */
function rows(hex: string, ascii: string): { offset: string; hex: string[]; ascii: string }[] {
  const out: { offset: string; hex: string[]; ascii: string }[] = [];
  for (let i = 0; i < ascii.length; i += 16) {
    const slice: string[] = [];
    for (let j = i; j < Math.min(i + 16, ascii.length); j++) {
      slice.push(hex.slice(j * 2, j * 2 + 2));
    }
    out.push({
      offset: i.toString(16).padStart(8, "0"),
      hex: slice,
      ascii: ascii.slice(i, i + 16),
    });
  }
  return out;
}

export function BlobInspector() {
  const [data, setData] = useState<BlobHead | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function fetchBlob() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/sui/blob?id=${NOTE_BLOB_ID}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
      setData(body as BlobHead);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-neutral-200 bg-white shadow-sm dark:border-neutral-700 dark:bg-neutral-800/60">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-100 px-5 py-4 dark:border-neutral-700/60">
        <div className="min-w-0">
          <h4 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
            Pull the egg tart note off Walrus
          </h4>
          <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
            No key required — that is the point. Anyone can hold this file.
          </p>
        </div>
        <button
          onClick={fetchBlob}
          disabled={busy}
          data-testid="fetch-blob"
          className="shrink-0 rounded-md bg-blue-500 px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-600 disabled:opacity-50"
        >
          {busy ? "Fetching…" : data ? "Fetch again" : "Fetch the raw blob"}
        </button>
      </div>

      <div className="px-5 py-4">
        <p className="break-all font-mono text-[11px] text-neutral-400">
          GET {walrusBlobUrl(NOTE_BLOB_ID)}
        </p>

        {error && (
          <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-950/40 dark:text-red-300">
            Walrus fetch failed: {error}
          </p>
        )}

        {data && (
          <div className="mt-4 space-y-4" data-testid="blob-result">
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="min-w-0 rounded-lg border border-neutral-200 p-4 dark:border-neutral-700">
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-400">
                  What the internet gets
                </p>
                <p className="mb-3 text-xs text-neutral-400">
                  First {data.headBytes} of {data.totalBytes} bytes, straight from the
                  aggregator
                </p>
                <div className="overflow-x-auto">
                  <pre className="font-mono text-[11px] leading-relaxed text-neutral-600 dark:text-neutral-300">
                    {rows(data.hex, data.ascii).map((r) => (
                      <div key={r.offset} className="whitespace-pre">
                        <span className="text-neutral-300 dark:text-neutral-600">{r.offset}</span>{" "}
                        <span>{r.hex.join(" ").padEnd(47, " ")}</span>{" "}
                        <span className="text-neutral-400 dark:text-neutral-500">|{r.ascii}|</span>
                      </div>
                    ))}
                  </pre>
                </div>
              </div>

              <div className="min-w-0 rounded-lg border border-rose-100 bg-rose-50/40 p-4 dark:border-rose-950/60 dark:bg-rose-950/10">
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-400">
                  What {ROOM_SEALED} gets
                </p>
                <p className="mb-3 inline-flex items-center gap-1 text-xs text-neutral-400">
                  <Lock size={11} /> Only with a member&apos;s signature
                </p>
                <pre className="whitespace-pre-wrap font-mono text-[12px] leading-relaxed text-neutral-700 dark:text-neutral-300">
                  {NOTE_PLAINTEXT_PREVIEW}
                </pre>
                <p className="mt-3 text-xs text-neutral-400">
                  Printed here from the recorded run, not decrypted by this page — this page
                  has no key either.
                </p>
              </div>
            </div>

            <div
              className={`rounded-lg border px-4 py-3 text-sm ${
                data.containsMarker
                  ? "border-red-200 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300"
                  : "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300"
              }`}
            >
              <span className="font-mono text-xs text-neutral-500 dark:text-neutral-400">
                blob.includes(&quot;{data.marker}&quot;) ={" "}
              </span>
              <span className="font-semibold">{String(data.containsMarker)}</span>
              {!data.containsMarker && (
                <span className="ml-2">— the memory is not in the file we serve.</span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
