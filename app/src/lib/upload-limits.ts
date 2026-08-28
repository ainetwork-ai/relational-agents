/**
 * The one place the upload ceiling is written down. It used to live twice —
 * once in /api/upload and once in uploadBlob, with a "keep in sync" comment —
 * and nginx carries a third copy.
 *
 * 10 MB was too small for what people actually attach: the documents on the
 * original's comments measured 14.4 MiB (hwp), 15.4 MiB (pdf) and 65.8 MiB
 * (zip), so a real report was rejected while the screenshots beside it went
 * through — which reads as "only images can be attached".
 *
 * Raising this is not enough on its own: nginx caps the request body at
 * `client_max_body_size` and returns 413 before the app ever sees it. Keep
 * deploy/nginx/*.conf and the live /etc/nginx/sites-available/* in step
 * (docs/deployment.md §nginx).
 */
export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

/** For messages: "100 MB". */
export const MAX_UPLOAD_LABEL = `${Math.round(MAX_UPLOAD_BYTES / (1024 * 1024))} MB`;
