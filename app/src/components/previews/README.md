# components/previews — inline file previews

`<FilePreview src={{ name, url, size }} compact? header? />` renders a file inline.
The renderer is chosen by file name (`lib/preview-kind.ts`), which covers every
type Google Drive previews. Ported from aindrive (`web/components/previews`).

- `url` must be same-origin and return the raw bytes (`/uploads/…`,
  `/api/files/key/…`, or `/api/aindrive/raw?…` for an aindrive link).
- Each renderer is its own lazy chunk (pdf.js, SheetJS, three.js, libarchive…).
- There is no converter sidecar here. The `converted` kind (doc/ppt/rtf/odt/
  key/pages/eps/xps) and video the browser can't decode show a message with a
  download link instead.
- Workers, wasm, CMaps and DXF fonts are self-hosted under `/preview-assets`
  by `scripts/copy-preview-assets.mjs`, which runs before `dev` and `build`.
  The folder is gitignored.

## Security rules (keep them)

- HTML that libraries build from untrusted XML (docx, pptx) only goes into
  `sandboxed-doc-frame`, whose `sandbox` has no `allow-scripts`.
- Links in rendered documents: only http(s) and mailto survive, forced to
  `target=_blank rel=noopener`.
- Archive members become blob: URLs typed `application/octet-stream`, so
  "open in new tab" can't run HTML on this origin.
- There is no "open in new tab" for the file itself, only download. An
  html/svg opened as a document on this origin could run script.
