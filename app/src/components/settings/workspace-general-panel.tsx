"use client";

import { useState } from "react";
import { isImeComposing } from "@/hooks/use-ime-guard";
import { Download, ImagePlus } from "lucide-react";
import type { ActiveWorkspace } from "@/components/sidebar/workspace-switcher";
import { IconPicker } from "@/components/page/icon-picker";
import { firstGlyphs } from "@/lib/glyph";
import { useT } from "@/i18n/provider";
import { SettingsHeader, SettingsRow, SettingsSection } from "./settings-layout";

export interface WorkspacePatch {
  name: string;
  iconText: string;
  iconUrl: string | null;
  description: string | null;
}

const INPUT =
  "h-7 rounded-md border border-[rgba(28,19,1,0.11)] bg-transparent px-2 text-sm outline-none focus:border-neutral-400 dark:border-neutral-600 dark:text-neutral-100";
const BTN =
  "flex h-7 items-center gap-1 whitespace-nowrap rounded-md border border-[rgba(28,19,1,0.11)] px-2 text-sm text-neutral-800 transition-colors hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-600 dark:text-neutral-200 dark:hover:bg-neutral-700";

/** 설정 › 워크스페이스 › 일반: name / icon / description / export.
 *  (Was the standalone workspace-settings-modal.) */
export function WorkspaceGeneralPanel({
  workspace,
  onSaved,
}: {
  workspace: ActiveWorkspace;
  onSaved: (patch: WorkspacePatch) => void;
}) {
  const t = useT();
  const [name, setName] = useState(workspace.name);
  const [iconText, setIconText] = useState(workspace.iconText);
  const [iconUrl, setIconUrl] = useState<string | null>(workspace.iconUrl ?? null);
  const [uploading, setUploading] = useState(false);
  const [description, setDescription] = useState(workspace.description ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [exporting, setExporting] = useState(false);

  const dirty =
    name !== workspace.name ||
    iconText !== workspace.iconText ||
    (iconUrl ?? null) !== (workspace.iconUrl ?? null) ||
    description !== (workspace.description ?? "");

  async function exportWorkspace() {
    if (exporting) return;
    setExporting(true);
    try {
      const res = await fetch("/api/workspace/export");
      if (!res.ok) {
        setError(t("내보내기에 실패했습니다"));
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "workspace-export.zip";
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setError(t("내보내기에 실패했습니다"));
    } finally {
      setExporting(false);
    }
  }

  async function uploadIcon(file: File) {
    setUploading(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/upload", { method: "POST", body: form });
      if (!res.ok) throw new Error();
      const d = await res.json();
      if (d?.url) setIconUrl(d.url as string);
    } catch {
      setError(t("업로드하지 못했습니다"));
    } finally {
      setUploading(false);
    }
  }

  async function save() {
    if (saving) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setError(t("이름을 입력하세요"));
      return;
    }
    setSaving(true);
    setError(null);
    const res = await fetch("/api/workspace", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: trimmed, iconText, iconUrl: iconUrl ?? "", description }),
    });
    setSaving(false);
    if (res.ok) {
      const d = await res.json();
      const w = d.workspace;
      onSaved({
        name: w?.name ?? trimmed,
        iconText: w?.iconText ?? iconText,
        iconUrl: w?.iconUrl ?? iconUrl,
        description: w?.description ?? (description || null),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
      return;
    }
    const d = await res.json().catch(() => ({}));
    setError(d.error ?? t("저장하지 못했습니다"));
  }

  return (
    <>
      <SettingsHeader title={t("일반")} subtitle={t("워크스페이스 이름, 아이콘 등을 관리하세요")} />
      <SettingsSection title={t("워크스페이스 설정")}>
        <SettingsRow label={t("워크스페이스 이름")}>
          <input
            data-testid="workspace-name-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (!isImeComposing(e) && e.key === "Enter") void save();
            }}
            className={`${INPUT} w-56`}
          />
        </SettingsRow>
        <SettingsRow
          label={t("아이콘")}
          description={t("이미지를 업로드하거나 이모지를 선택하세요. 이 아이콘은 사이드바에 표시됩니다.")}
        >
          <div className="flex items-center gap-2">
            {iconUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={iconUrl} alt="" className="h-10 w-10 rounded-lg object-cover ring-1 ring-neutral-200 dark:ring-neutral-600" />
            ) : (
              <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-neutral-100 text-lg dark:bg-neutral-700">
                {iconText || "WS"}
              </span>
            )}
            <input
              value={iconText}
              /* clamped by visible character, not by UTF-16 unit */
              onChange={(e) => setIconText(firstGlyphs(e.target.value, 2))}
              className={`${INPUT} w-12 text-center`}
              aria-label={t("아이콘")}
            />
            <IconPicker
              icon={null}
              onChange={(emoji) => emoji && setIconText(firstGlyphs(emoji, 1))}
              testid="workspace-icon-emoji"
              pickerTestid="workspace-icon-emoji-picker"
              triggerClassName={BTN}
              placeholder="😀"
              allowRemove={false}
            />
            <label className="cursor-pointer">
              <input
                data-testid="workspace-icon-file"
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void uploadIcon(f);
                  e.target.value = "";
                }}
              />
              <span className={BTN}>
                <ImagePlus size={13} /> {uploading ? t("업로드 중…") : t("이미지 업로드")}
              </span>
            </label>
            {iconUrl && (
              <button
                data-testid="workspace-icon-clear"
                onClick={() => setIconUrl(null)}
                className="text-xs text-neutral-500 underline-offset-2 hover:underline"
              >
                {t("제거")}
              </button>
            )}
          </div>
        </SettingsRow>
        <SettingsRow label={t("설명")}>
          <textarea
            data-testid="workspace-desc-input"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            placeholder={t("이 워크스페이스는 무엇을 위한 것인가요?")}
            className="w-72 resize-none rounded-md border border-[rgba(28,19,1,0.11)] bg-transparent px-2 py-1 text-sm outline-none focus:border-neutral-400 dark:border-neutral-600 dark:text-neutral-100"
          />
        </SettingsRow>
        <div className="flex items-center gap-2">
          <button
            data-testid="workspace-settings-save"
            onClick={() => void save()}
            disabled={saving || !dirty}
            className="h-7 rounded-md bg-blue-500 px-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-600 disabled:opacity-50"
          >
            {saving ? t("저장 중…") : t("변경 사항 저장")}
          </button>
          {saved && <span className="text-xs text-neutral-500">{t("저장했습니다")}</span>}
          {error && <span className="text-xs text-red-500">{error}</span>}
        </div>
      </SettingsSection>
      <SettingsSection title={t("내보내기")}>
        <SettingsRow label={t("워크스페이스 콘텐츠")} description={t("이 워크스페이스의 모든 페이지를 내보냅니다.")}>
          <button data-testid="workspace-export" onClick={() => void exportWorkspace()} disabled={exporting} className={BTN}>
            <Download size={14} />
            {exporting ? t("내보내는 중…") : t("내보내기")}
          </button>
        </SettingsRow>
      </SettingsSection>
    </>
  );
}
