"use client";

import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Play } from "lucide-react";
import { useAnchored } from "@/hooks/use-anchored";
import { useDismiss } from "@/hooks/use-dismiss";
import { useT } from "@/i18n/provider";
import { uploadResumable } from "@/lib/upload";
import { isImeComposing } from "@/hooks/use-ime-guard";

/**
 * 동영상 블록 — 원본에서 잰 그대로. 측정: docs/notion-video.md §1·§2 (2026-09-10).
 *
 * 비어 있을 때는 `동영상 임베드 또는 업로드` 띠 하나이고, 누르면 **300폭 팝오버**가
 * `업로드 / 링크` 두 탭으로 열린다. 우리 동영상 블록에는 원래 URL 칸밖에 없어서
 * 업로드라는 길 자체가 없었다.
 *
 * 업로드는 `uploadBlob` 이 아니라 **`uploadResumable`(tus)** 로 간다 — 동영상은 크고,
 * 버퍼링 경로는 50MB 에서 잘린다. tus 는 8MB 씩 보내고 끊기면 이어서 올린다.
 */
export function VideoBody({
  blockId,
  url,
  onUrl,
}: {
  blockId: string;
  url: string;
  onUrl: (url: string) => void;
}) {
  const t = useT();
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"upload" | "link">("upload");
  const [draft, setDraft] = useState("");
  const [progress, setProgress] = useState<number | null>(null);

  useAnchored(open, trigger, panel, { gap: 4, align: "start" });
  useDismiss(open, () => setOpen(false), trigger, panel);

  const commitLink = () => {
    const v = draft.trim();
    if (!v) return;
    onUrl(v);
    setOpen(false);
  };

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setProgress(0);
    const up = await uploadResumable(file, (f) => setProgress(f));
    setProgress(null);
    if (!up) return;
    onUrl(up.url);
    setOpen(false);
  };

  if (url) return <VideoPlayer blockId={blockId} url={url} />;

  return (
    <div className="my-1 w-full">
      <button
        ref={trigger}
        type="button"
        data-testid={`video-empty-${blockId}`}
       // onMouseDown, not onClick: the editor re-renders the row while the
       // button is held, and the replaced element never receives the click —
       // the popover opened maybe one time in three. preventDefault keeps the
       // caret where it was, the way the other in-editor menus do it.
        onMouseDown={(e) => {
          e.preventDefault();
          setOpen((v) => !v);
        }}
        className="flex h-[49px] w-full items-center gap-2.5 rounded-md bg-neutral-100/80 px-3 text-left transition-colors hover:bg-neutral-200/70 dark:bg-neutral-800/60 dark:hover:bg-neutral-800"
      >
        <Play size={18} className="shrink-0 text-[rgb(125,122,117)]" aria-hidden />
        <span className="text-[16px] text-[rgb(125,122,117)]">
          {t("동영상 임베드 또는 업로드")}
        </span>
      </button>

      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={panel}
            data-testid={`video-picker-${blockId}`}
            style={{
              visibility: "hidden",
              width: 300,
              borderRadius: 10,
             // 멘션 메뉴와 같은 3겹 — 원본이 팝오버에 공통으로 쓰는 그림자다
              boxShadow:
                "rgba(25,25,25,0.05) 0 20px 24px, rgba(25,25,25,0.027) 0 5px 8px, rgba(42,28,0,0.07) 0 0 0 1px",
            }}
            className="popover-anim fixed z-50 bg-white dark:bg-neutral-800"
          >
            <div className="flex items-center gap-2 px-2 pt-1.5">
              <Tab id="upload" cur={tab} set={setTab} testid={`video-tab-upload-${blockId}`}>
                {t("업로드")}
              </Tab>
              <Tab id="link" cur={tab} set={setTab} testid={`video-tab-link-${blockId}`}>
                {t("링크")}
              </Tab>
            </div>
            <div className="border-b border-neutral-200 dark:border-neutral-700" />

            {tab === "upload" ? (
              <div className="px-6 py-3.5">
                <input
                  ref={fileRef}
                  type="file"
                  accept="video/*,.mp4,.mov,.webm,.m4v"
                  hidden
                  data-testid={`video-file-${blockId}`}
                  onChange={(e) => {
                    void pick(e.target.files?.[0]);
                    e.target.value = "";
                  }}
                />
                <PrimaryButton
                  testid={`video-choose-${blockId}`}
                  disabled={progress !== null}
                  onClick={() => fileRef.current?.click()}
                >
                  {progress === null
                    ? t("동영상을 선택하세요")
                    : `${Math.round(progress * 100)}%`}
                </PrimaryButton>
              </div>
            ) : (
              <div className="px-3 py-3.5">
                <input
                  autoFocus
                  data-testid={`video-url-input-${blockId}`}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (!isImeComposing(e) && e.key === "Enter") commitLink();
                  }}
                  placeholder={t("동영상 링크를 붙여넣으세요")}
                  className="mb-2.5 h-7 w-full rounded border border-neutral-200 bg-transparent px-2 text-sm outline-none placeholder:text-[rgb(161,158,153)] focus:border-neutral-300 dark:border-neutral-600"
                />
                <PrimaryButton testid={`video-embed-${blockId}`} onClick={commitLink}>
                  {t("동영상 임베드")}
                </PrimaryButton>
              </div>
            )}
          </div>,
          document.body
        )}
    </div>
  );
}

/** 선택된 탭은 진한 잉크 + 2px 밑줄, 아닌 탭은 rgb(142,139,134) — 잰 값. */
function Tab({
  id,
  cur,
  set,
  testid,
  children,
}: {
  id: "upload" | "link";
  cur: string;
  set: (v: "upload" | "link") => void;
  testid: string;
  children: React.ReactNode;
}) {
  const on = cur === id;
  return (
    <button
      type="button"
      data-testid={testid}
      aria-selected={on}
      onClick={() => set(id)}
      className={`h-7 px-1.5 text-sm ${
        on
          ? "border-b-2 border-neutral-800 text-[rgb(44,44,43)] dark:border-neutral-200 dark:text-neutral-100"
          : "border-b-2 border-transparent text-[rgb(142,139,134)]"
      }`}
    >
      {children}
    </button>
  );
}

function PrimaryButton({
  testid,
  onClick,
  disabled,
  children,
}: {
  testid: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      data-testid={testid}
      onClick={onClick}
      disabled={disabled}
      className="h-7 w-full rounded bg-[rgb(53,120,229)] text-sm font-medium text-[rgb(243,249,253)] transition-opacity hover:opacity-90 disabled:opacity-60"
    >
      {children}
    </button>
  );
}

/** 파일이면 `<video>`, 아니면 임베드 프레임. */
const VIDEO_FILE_RE = /\.(mp4|mov|webm|m4v|ogg|ogv)(\?|#|$)/i;

/** 우리 파일 프록시가 준 주소 — 확장자가 URL 에 없어도 우리가 올린 동영상이다. */
const OUR_VIDEO_KEY_RE = /^\/api\/files\/(key\/files\/[0-9a-f]{64}\.(mp4|mov|webm|m4v)|[0-9a-f-]{36}\/stream)/i;

function toEmbedUrl(url: string): string {
  const yt = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]{11})/);
  if (yt) return `https://www.youtube.com/embed/${yt[1]}`;
  return url;
}

export function VideoPlayer({ blockId, url }: { blockId: string; url: string }) {
  const [broken, setBroken] = useState(false);
  const isFile = VIDEO_FILE_RE.test(url) || OUR_VIDEO_KEY_RE.test(url);

  if (isFile && !broken)
    return (
      <div className="my-1 w-full" data-testid={`video-frame-${blockId}`}>
        {/* preload=metadata: 바디를 미리 받지 않고 길이만. autoplay 는 하지 않는다.
            aspect-video 로 16:9 를 미리 잡아 레이아웃 점프를 막고, 세로 영상은
            object-contain + 어두운 바탕으로 레터박스한다 (ainteams 와 같은 규칙). */}
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <video
          src={url}
          controls
          preload="metadata"
          playsInline
          data-testid={`video-el-${blockId}`}
          onError={() => setBroken(true)}
          className="aspect-video w-full rounded-md bg-neutral-900/90 object-contain"
        />
      </div>
    );

  if (isFile)
    return (
      <div
        className="my-1 flex w-full items-center justify-between gap-3 rounded-md border border-neutral-200 px-3 py-2.5 dark:border-neutral-700"
        data-testid={`video-broken-${blockId}`}
      >
        <span className="truncate text-sm text-neutral-500">
          {url.split("/").pop()}
        </span>
        <a
          href={url}
          download
          className="shrink-0 rounded border border-neutral-300 px-2.5 py-1 text-xs font-medium text-neutral-600 hover:bg-neutral-100 dark:border-neutral-600 dark:text-neutral-300"
        >
          ↓
        </a>
      </div>
    );

  return (
    <div className="my-1 w-full" data-testid={`video-frame-${blockId}`}>
      <iframe
        src={toEmbedUrl(url)}
        title="video"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
        sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
        className="aspect-video w-full rounded-md border border-neutral-200 dark:border-neutral-700"
      />
    </div>
  );
}
