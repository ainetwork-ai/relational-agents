// The one list of upload types. The server gate (/api/upload, the tus hooks)
// and the client's pre-check share it, so a file that will be refused is
// refused before the round trip instead of after it.
//
// Ported from ainteams (web/src/lib/files/allowed-types.ts) — same policy, so
// the two services agree on what may be attached. Client-safe: no node
// imports, string logic only.
//
// Executable extensions (js, mjs, exe …) stay out. svg and html/htm are IN,
// and they rest on next.config.ts serving /uploads/* with
// `Content-Security-Policy: sandbox` and `nosniff` — take that header away and
// these two have to come out with it.

export const ALLOWED_EXTENSIONS = new Set([
  // Images — heic/heif 는 iPhone 기본 사진 포맷. avif 는 렌더 판정(isImageFile)과 정합
  // (기존엔 allowlist 누락으로 불일치였다). heic 인라인 렌더는 브라우저별(Safari O/Chrome X)이라
  // best-effort — 못 그리면 파일 카드/다운로드로 degrade.
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'avif', 'heic', 'heif', 'bmp', 'tif', 'tiff',
  // Video (UX audit #14)
  'mp4', 'mov', 'webm', 'm4v',
  // Audio (UX audit #14)
  'mp3', 'm4a', 'wav', 'ogg', 'aac',
  // Documents
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'csv', 'rtf',
  // Text / data — 개발팀 협업용. 스크립트 실행형(js/mjs/exe 등)은 여전히 제외.
  // lottie: 디자이너가 넘기는 애니메이션 자산(dotLottie = JSON+이미지를 담은 zip). 인라인
  // 재생은 하지 않고 파일 카드/다운로드로만 다룬다 — 실행형이 아니라 zip 과 동급이다.
  'md', 'markdown', 'json', 'xml', 'yaml', 'yml', 'log', 'lottie',
  // html/htm — 리포트·저장한 웹페이지 공유 수요. 활성 콘텐츠를 담을 수 있지만 앱 origin
  // 문서로 렌더되는 서빙 경로가 없다: download=attachment 고정, stream=isStreamableMedia
  // 게이트(streamable-media.ts), /uploads=CSP sandbox+nosniff(next.config.ts). 같은
  // 위험도의 svg 가 이미 기대고 있는 방어선이다. 앞의 둘은 라우트 테스트가 고정한다
  // (download/route.test.ts · stream/route.test.ts) — /uploads 헤더만 정적 설정이다.
  'html', 'htm',
  // OpenDocument (LibreOffice/OpenOffice)
  'odt', 'ods', 'odp',
  // Korean Hancom (한글) documents
  'hwp', 'hwpx',
  // Archives
  'zip', 'tar', 'gz', 'rar', '7z', 'bz2',
  // Everything else Google Drive previews (support.google.com/drive/answer/37603),
  // so what it can show, an attachment here can too (components/previews).
  // Still no script types a browser would run (js/mjs stay out).
  'jpe', 'jfif', 'apng', 'ico', 'dib',
  'psd', 'ai', 'eps', 'ps', 'xps', 'oxps', 'dxf',
  'mkv', 'ogv', 'avi', 'wmv', 'flv', '3gp', 'mpg', 'mpeg',
  'opus', 'oga', 'flac', 'weba',
  'docm', 'dotx', 'xlsm', 'xlsb', 'pptm', 'ppsx', 'pps', 'pot', 'dot',
  'key', 'numbers', 'pages', 'wpd',
  'ttf', 'otf', 'woff', 'woff2',
  'tsv', 'srt', 'vtt', 'css', 'c', 'cpp', 'h', 'hpp', 'java', 'py',
  'tgz', 'xz',
]);

// text/* 는 md/xml/yaml/log/plain/html 등을 커버 — 확장자 게이트가 먼저 실행형(js 등 미허용
// 확장자)을 막으므로 안전. video/audio/image prefix 는 그 계열 mime 전반 허용.
// font/* too: a font is data, not code (ttf/otf/woff previews as a specimen)
export const ALLOWED_MIME_PREFIXES = ['image/', 'video/', 'audio/', 'text/', 'font/'];

export const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  // Korean Hancom (한글) — .hwp / .hwpx (only sent when Hancom Office is
  // installed; otherwise browsers fall back to octet-stream/empty, handled below)
  'application/x-hwp',
  'application/haansofthwp',
  'application/vnd.hancom.hwp',
  'application/vnd.hancom.hwpx',
  'application/hwp+zip',
  'text/plain',
  'text/csv',
  'application/json',
  'application/rtf',
  // OpenDocument
  'application/vnd.oasis.opendocument.text',
  'application/vnd.oasis.opendocument.spreadsheet',
  'application/vnd.oasis.opendocument.presentation',
  'application/zip',
  'application/x-zip-compressed',
  'application/x-tar',
  'application/gzip',
  'application/x-gzip',
  'application/vnd.rar',
  'application/x-rar-compressed',
  'application/x-7z-compressed',
  'application/x-bzip2',
  'application/x-xz',
  // the Google-Drive-previewable rest (above) — what browsers label them with
  'application/postscript',
  'application/illustrator',
  'application/vnd.ms-xpsdocument',
  'application/oxps',
  'application/dxf',
  'application/vnd.ms-word.document.macroenabled.12',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.template',
  'application/vnd.ms-excel.sheet.macroenabled.12',
  'application/vnd.ms-excel.sheet.binary.macroenabled.12',
  'application/vnd.ms-powerpoint.presentation.macroenabled.12',
  'application/vnd.openxmlformats-officedocument.presentationml.slideshow',
  'application/vnd.apple.keynote',
  'application/vnd.apple.numbers',
  'application/vnd.apple.pages',
  'application/x-iwork-keynote-sffkey',
  'application/x-iwork-numbers-sffnumbers',
  'application/x-iwork-pages-sffpages',
  'application/vnd.wordperfect',
  'application/x-font-ttf',
  'application/x-font-otf',
  'application/font-woff',
  'application/x-matroska',
  'application/vnd.rn-realmedia',
  'application/x-shockwave-flash',
]);

/** 확장자 추출(node path 비의존) — 점 없거나 끝점이면 빈 문자열. */
export function fileExtension(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  if (dot < 0 || dot === fileName.length - 1) return '';
  return fileName.slice(dot + 1).toLowerCase();
}

export type UploadTypeCheck =
  | { allowed: true }
  | { allowed: false; reason: 'ext' | 'mime'; ext: string; mimeType: string };

/**
 * 확장자·MIME 타입 허용 여부(크기 검증은 호출자 몫 — 서버 route/클라가 각자 제한). 확장자
 * 게이트를 먼저 통과해야 하고, MIME 은 prefix/allowlist/unknown 중 하나여야 한다. 브라우저가
 * OS 매핑 없는 포맷에 ""·application/octet-stream 을 주므로(예: Hancom 미설치 .hwp) 이는
 * 확장자 게이트 통과 후 신뢰한다.
 */
export function checkUploadType(fileName: string, mimeType: string): UploadTypeCheck {
  const ext = fileExtension(fileName);
  const mt = (mimeType || '').toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) return { allowed: false, reason: 'ext', ext, mimeType: mt };
  const isUnknownMime = mt === '' || mt === 'application/octet-stream';
  const mimeAllowed =
    ALLOWED_MIME_PREFIXES.some((p) => mt.startsWith(p)) ||
    ALLOWED_MIME_TYPES.has(mt) ||
    isUnknownMime;
  if (!mimeAllowed) return { allowed: false, reason: 'mime', ext, mimeType: mt };
  return { allowed: true };
}
