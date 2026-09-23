"use client";
// Loads an Office file's bytes and, when it is a password-protected OOXML
// package, asks for the password and decrypts it in the browser before
// handing the plain zip to the renderer. The password never leaves the tab.
import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { Lock, Loader2 } from "lucide-react";
import { decryptOoxml, isEncryptedOoxml, OfficePasswordError } from "./office-crypto";
import type { PreviewSource } from "./types";
import { usePreviewBytes } from "./use-preview-bytes";
import { PreviewLoading, PreviewMessage } from "./status";

export const PROTECTED_MESSAGE = "This file is password-protected in a format that can't be opened here. Download it to open it.";

export function OfficeBytes({ src, children }: { src: PreviewSource; children: (data: ArrayBuffer) => ReactNode }) {
  const bytes = usePreviewBytes(src);
  const [decrypted, setDecrypted] = useState<ArrayBuffer | null>(null);
  // CFB-parses the file, so once per load rather than per render.
  const encrypted = useMemo(() => bytes.status === "ready" && isEncryptedOoxml(new Uint8Array(bytes.data)), [bytes]);

  if (bytes.status === "loading") return <PreviewLoading />;
  if (bytes.status === "error") return <PreviewMessage name={src.name} message={bytes.message} />;
  if (decrypted) return <>{children(decrypted)}</>;
  if (!encrypted) return <>{children(bytes.data)}</>;
  const data = bytes.data;
  return <PasswordForm name={src.name} onSubmit={async (pw) => {
    const out = await decryptOoxml(new Uint8Array(data), pw);
    setDecrypted(out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) as ArrayBuffer);
  }} />;
}

function PasswordForm({ name, onSubmit }: { name: string; onSubmit: (password: string) => Promise<void> }) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!password || busy) return;
    setBusy(true);
    setError(null);
    try {
      // Let the spinner paint: key derivation is a sync 50k–100k-round hash loop.
      await new Promise((r) => setTimeout(r, 30));
      await onSubmit(password);
    } catch (err) {
      setError(err instanceof OfficePasswordError ? "Incorrect password. Try again." : err instanceof Error ? err.message : "Could not open this file.");
      setBusy(false);
    }
  }

  return (
    <div className="h-full min-h-[300px] flex items-center justify-center p-6">
      <form onSubmit={submit} className="w-full max-w-xs flex flex-col items-center text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-blue-50 dark:bg-blue-500/15 text-blue-500">
          <Lock className="w-6 h-6" />
        </div>
        <div className="mt-3 text-sm font-medium text-neutral-800 dark:text-neutral-200 max-w-full truncate" title={name}>{name}</div>
        <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">This file is password-protected. Enter the password to preview it.</p>
        <input
          type="password"
          autoFocus
          autoComplete="off"
          aria-label="File password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mt-4 w-full rounded-lg border border-neutral-200 dark:border-neutral-700 px-3 py-2 text-sm"
        />
        {error && <p role="alert" className="mt-2 text-xs text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={!password || busy}
          className="mt-3 w-full rounded-lg bg-blue-500 text-white py-2 text-sm hover:bg-blue-600 disabled:opacity-60 flex items-center justify-center gap-2"
        >
          {busy && <Loader2 className="w-4 h-4 animate-spin" />}
          {busy ? "Unlocking…" : "Open"}
        </button>
      </form>
    </div>
  );
}
