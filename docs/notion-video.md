# Video — Notion measurements and ainteams comparison (2026-09-10)

comcom: "Measure how Notion does video, figure out how ainteams handles video, and I want to add a
feature so videos can be uploaded."

The Notion side was measured on **a page I created**, which was then sent to the trash (measurement
scripts `mv*.mjs`, raw data `n-video-*.jsonl`). No actual video file was **uploaded** — to avoid leaving
measurement bytes in the company Notion. So §3 (the player) is based not on Notion but on
**ainteams' finished implementation**.

## 0. Pitfalls hit while measuring (for the next person)

- **Do not measure on a shared scratch page.** Another session was measuring quote and code blocks on
  the same page, and my `/video` slash command landed in their code block, turning a word there into
  that word plus `/video` (reverted by deleting exactly those characters). Measure on **a page you created**
  and delete that page when done.
- Create a new page via the sidebar's top-left `New page` (aria-label) → the **`Page`** item in the overlay.
  Pressing only the button just shows the `Page / Chat / AI note / Database` overlay and creates no page.
  **Do not type a single character until you have confirmed the URL changed.**
- The title element is the one and only `[contenteditable="true"]` with **`placeholder` = the `New page`
  string (ko dictionary)**. Adding conditions like `closest('.notion-page-block')` grabs the whole-page
  wrapper first and the typing goes somewhere else.
- Delete a page via the **`aria-label` = `Actions`** button at the far top right → `Move to Trash`.

## 1. How to create the block

**`Video`** in the `/` menu (row 316 × 32). Picking it creates an empty video block.

| Part | Value |
|---|---|
| Block | `notion-video-block`, 720 × **65**, no background, radius 0 |
| Inner strip (the click target) | 704 × **49**, **8** horizontal inset |
| Text | **`Embed or upload a video`**, **16px** / 400 / rgb(44,44,43) |

## 2. Upload popover

Appears when you click the strip. Card **300 wide**, radius **10px**, white background — the shadow is
**the same 3 layers** as the mention menu (`docs/notion-comment-mention.md` §3).

| Tab | Card height |
|---|---|
| **Upload** | 300 × **106** |
| **Link** | 300 × **161** |

| Part | Position (relative to card) | Size | Typography |
|---|---|---|---|
| Tab `Upload` | dx **8**, dy **6** | 52 × 28 | 14px / 400 |
| Tab `Link` | dx **60**, dy 6 | 40 × 28 | 14px / 400 |
| Selected tab text color | — | — | rgb(44,44,43) |
| Unselected tab text color | — | — | rgb(142,139,134) |
| Upload tab primary button `Choose a video` | dx **24**, dy **56** | **252 × 28** | 14px / **500**, text rgb(243,249,253) (on blue fill) |
| Link tab primary button `Embed video` | dx **12**, dy **96** | **276 × 28** | 14px / 500, same text color |

So Notion puts **upload and link embed as two tabs of one popover**. Our video block currently has
**only a URL input**, so there is no upload tab at all.

**Not measured**: the per-file size limit text, the file picker's `accept` list, drag & drop / paste
behavior, and **the player after upload**. All of these require uploading a real file to the company
Notion, so they were not done.

## 3. Player — the reference is ainteams (already complete)

In ainteams, video is a **finished feature**. Rather than imitating Notion, it makes sense to follow this
implementation that our organization has already validated.

`web/src/components/chat/MessageFileCard.tsx`:

```tsx
<video
  src={streamSrc}
  controls
  preload="metadata"   // fetch only duration, not the body up front. No autoplay
  playsInline
  aria-label={fileName}
  onError={() => setMediaBroken(true)}
  className="w-full aspect-video object-contain rounded-md bg-scrim"
/>
```

- `aspect-video` reserves 16:9 up front to **prevent layout jumps**. Portrait videos are letterboxed with
  `object-contain` + a dark background.
- If playback fails, it falls back to a "Can't play" card + a download button.
- **No player library.** It is a plain HTML5 element.

## 4. ainteams upload and serving (what we have already ported and what we have not)

| Item | ainteams | ainmem (us) |
|---|---|---|
| Upload | tus resumable (`/api/upload/tus`), 8MB chunks, cap **1GB** | **Present** — ported up to `uploadResumable` |
| Allowed extensions | `mp4, mov, webm, m4v` + `video/` prefix | **Present** (`lib/files/allowed-types.ts`) |
| Storage | MinIO, key = content **SHA-256** (`files/<sha>.<ext>`) | Present (bucket `ainmem-files`) |
| Byte serving | **Range/206 support** — prerequisite for `<video>` seeking and iOS Safari playback | **Missing** ← this is the key gap |
| MIME recovery | If `mime_type` is empty, restores `video/mp4` etc. from the extension | **Missing** — `octet-stream` + `nosniff`, so playback is refused |
| Thumbnails · duration · transcoding | **None** (no ffmpeg at all) | None |

`streamFile(bucket, key, range)` in `lib/files/storage.ts` **already accepts partial reads, but no route
passes a range.** `api/files/[id]/stream/route.ts` receives the request object as `_req` and never looks at it.

## 5. So, the work (in dependency order)

1. **Range/206** — `api/files/[id]/stream`, `api/files/key/[...key]`, `/uploads/[name]`,
   `api/okf/asset`. Bring over ainteams' parser at `backend/src/domain/shared/http-range.ts`.
   Without this, videos **cannot seek and do not show up at all on iOS**.
2. **MIME recovery** — restore from the extension when `mime_type` is null (`streamable-media.ts`).
3. **Add upload to the video block** — currently only a URL field. Like Notion, have two tabs
   `Upload / Link`, and since uploads are large files, use **`uploadResumable` (tus)**, not `uploadBlob`.
   (`uploadBlob(file)` without a `kind` only accepts image MIME types and rejects with 415.)
4. **Drop and paste** — the drop/paste handling in `block-editor.tsx` filters to `image/` only.
5. **Player per §3** — currently just `<video controls>`, with no `preload`, `playsInline`, aspect
   reservation or failure fallback. The file-detection regex `/\.(mp4|webm|ogg)/` also misses the allowlist's
   `.mov` and `.m4v`, so those leak into an `<iframe>`.
6. **Videos in comment attachments** — upload and storage already work, but rendering only has a file-name
   regex (`IMAGE`), so they **fall back to a download link**. Add a `<video>` branch.
7. **Checks** — of the 88 files in `app/e2e`, **not one** mentions `video`/`mp4`.
   Add a new check that measures Range responses (206 · `Content-Range` · 416).

Found along the way: `rewriteAssetBlocks` in `okf-store.ts` says "image/video" in its comment but filters
with `b.type !== "image"`. `app/src/app/uploads/[name]/route.ts` has no video entries in its MIME table and
reads the whole file into memory.
