// Contract every inline preview renderer implements. See README.md here.

/** A file to preview, independent of where its bytes live. */
export type PreviewSource = {
  /** Display name (basename) — also what the renderer is chosen from. */
  name: string;
  /** Same-origin URL for the raw bytes (an app route / upload path, or a
      blob: URL for an archive member). */
  url: string;
  /** Byte size (for size guards before a client-side parse). 0 = unknown. */
  size: number;
  /** Fetch the whole file once (memoized per source). Renderers that parse in
      the browser (docx, sheet, psd, …) use this rather than fetching `url`. */
  bytes: () => Promise<ArrayBuffer>;
};

export type PreviewProps = { src: PreviewSource };
