"use client";

import { useState } from "react";
import { NOTE_BLOB_ID, NOTE_PLAINTEXT_PREVIEW, walrusBlobUrl } from "@/lib/sui/demo";

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
    <div className="rounded-2xl border border-amber-400/25 bg-gradient-to-b from-amber-400/[0.07] to-transparent p-5 sm:p-7">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-amber-200">The blob, right now</h3>
          <p className="mt-1 text-sm text-neutral-400">
            No key required — that is the point. Anyone can hold this file.
          </p>
        </div>
        <button
          onClick={fetchBlob}
          disabled={busy}
          data-testid="fetch-blob"
          className="rounded-lg bg-amber-400 px-4 py-2 text-sm font-semibold text-black transition-colors hover:bg-amber-300 disabled:opacity-50"
        >
          {busy ? "Fetching…" : data ? "Fetch again" : "Fetch the raw blob"}
        </button>
      </div>

      <p className="mt-4 break-all font-mono text-[11px] text-neutral-500">
        GET {walrusBlobUrl(NOTE_BLOB_ID)}
      </p>

      {error && (
        <p className="mt-4 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300">
          Walrus fetch failed: {error}
        </p>
      )}

      {data && (
        <div className="mt-5 space-y-5" data-testid="blob-result">
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="min-w-0 rounded-xl border border-neutral-800 bg-black/50 p-4">
              <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-neutral-500">
                What came back · first {data.headBytes} of {data.totalBytes} bytes
              </p>
              <div className="overflow-x-auto">
                <pre className="font-mono text-[11px] leading-relaxed text-neutral-300">
                  {rows(data.hex, data.ascii).map((r) => (
                    <div key={r.offset} className="whitespace-pre">
                      <span className="text-neutral-600">{r.offset}</span>{" "}
                      <span className="text-emerald-300/90">
                        {r.hex.join(" ").padEnd(47, " ")}
                      </span>{" "}
                      <span className="text-neutral-500">|{r.ascii}|</span>
                    </div>
                  ))}
                </pre>
              </div>
            </div>

            <div className="min-w-0 rounded-xl border border-neutral-800 bg-black/50 p-4">
              <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-neutral-500">
                What it would say, decrypted
              </p>
              <pre className="whitespace-pre-wrap font-mono text-[12px] leading-relaxed text-neutral-400 blur-[3px] select-none">
                {NOTE_PLAINTEXT_PREVIEW}
              </pre>
              <p className="mt-3 text-xs text-neutral-500">
                Blurred here because this page has no key either. Only a member&apos;s
                signature gets those bytes back.
              </p>
            </div>
          </div>

          <div
            className={`rounded-xl border px-4 py-3 text-sm ${
              data.containsMarker
                ? "border-red-500/40 bg-red-500/10 text-red-200"
                : "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
            }`}
          >
            <span className="font-mono text-xs text-neutral-400">
              blob.includes(&quot;{data.marker}&quot;) ={" "}
            </span>
            <span className="font-semibold">{String(data.containsMarker)}</span>
            {!data.containsMarker && (
              <span className="ml-2 text-emerald-300/80">
                — the memory is not in the file we serve.
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
