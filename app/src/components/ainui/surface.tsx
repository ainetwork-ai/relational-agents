"use client";

import { useId, useMemo, useRef, useState } from "react";
import { AinuiSurface } from "ain-ui/react";
import { A2UI_VERSION, AINUI_CATALOG, resolveMime, type A2uiComponent, type A2uiMessage, type A2uiAction } from "ain-ui";
import { FilePreview } from "@/components/previews";
import { aindriveRawUrl, aindriveThumbUrl } from "@/lib/aindrive-url";
import "ain-ui/styles.css";

export function screen(id: string, components: A2uiComponent[], value: Record<string, unknown> = {}): A2uiMessage[] {
  return [
    { version: A2UI_VERSION, createSurface: { surfaceId: id, catalogId: AINUI_CATALOG } },
    { version: A2UI_VERSION, updateComponents: { surfaceId: id, components } },
    { version: A2UI_VERSION, updateDataModel: { surfaceId: id, path: "/", value } },
  ];
}

export function DriveSurface({ messages, onAction = () => {} }: { messages: A2uiMessage[]; onAction?: (action: A2uiAction) => void | Promise<void> }) {
  return <AinuiSurface messages={messages} onAction={onAction} resolveAsset={(asset, opts) => {
    const ref = { driveId: asset.drive_id, path: asset.path };
    return asset.variant === "thumb" && !opts?.download ? aindriveThumbUrl(ref) : aindriveRawUrl(ref, opts?.download);
  }} renderFile={({ src, name, size }) => <FilePreview src={{ url: src, name, size }} compact />} />;
}

/** App-owned actions use the same protocol renderer as producer-owned file surfaces. */
export function AinuiButton({ label, onClick, disabled = false, testId, confirm, className }: {
  label: string; onClick: () => void | Promise<unknown>; disabled?: boolean; testId?: string; confirm?: string; className?: string;
}) {
  const id = useId();
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const [error, setError] = useState("");
  const messages = useMemo(() => screen(id, [
    { id: "root", component: "Button", child: "label", action: { event: { name: "activate" } }, ...(confirm ? { confirm } : {}) },
    { id: "label", component: "Text", text: label },
  ]), [id, label, confirm]);
  return <fieldset disabled={disabled || busy} data-testid={testId} className={`min-w-0 border-0 p-0 ${className ?? ""}`}>
    <DriveSurface messages={messages} onAction={async () => {
      if (disabled || running.current) return;
      running.current = true; setBusy(true); setError("");
      try { await onClick(); } catch (e) { setError((e as Error).message); }
      finally { running.current = false; setBusy(false); }
    }} />{error && <p role="alert">{error}</p>}
  </fieldset>;
}

export function AinuiText({ text }: { text: string }) {
  const id = useId();
  const messages = useMemo(() => screen(id, [{ id: "root", component: "Text", text }]), [id, text]);
  return <DriveSurface messages={messages} />;
}

export type Field = { key: string; label: string; value: string | string[]; options?: { value: string; label: string }[]; multiple?: boolean };
export function AinuiForm({ fields, submitLabel, onSubmit, disabled, testId }: {
  fields: Field[]; submitLabel: string; onSubmit: (values: Record<string, unknown>) => void | Promise<unknown>; disabled?: boolean; testId?: string;
}) {
  const id = useId();
  // Stabilize the complete snapshot through parent busy/error rerenders so typing is preserved.
  const serialized = JSON.stringify({ fields, submitLabel });
  const messages = useMemo(() => {
    const spec = JSON.parse(serialized) as { fields: Field[]; submitLabel: string };
    return screen(id, [
      { id: "root", component: "Column", children: [...spec.fields.map((f) => `field-${f.key}`), "submit"] },
      ...spec.fields.map((f): A2uiComponent => f.options ? {
        id: `field-${f.key}`, component: "ChoicePicker", label: f.label, value: { path: `/${f.key}` }, options: f.options,
        variant: f.multiple ? "multipleSelection" : "mutuallyExclusive",
      } : { id: `field-${f.key}`, component: "TextField", label: f.label, value: { path: `/${f.key}` } }),
      { id: "submit", component: "Button", child: "submit-label", action: { event: { name: "submit", context: Object.fromEntries(spec.fields.map((f) => [f.key, { path: `/${f.key}` }])) } } },
      { id: "submit-label", component: "Text", text: spec.submitLabel },
    ], Object.fromEntries(spec.fields.map((f) => [f.key, f.value])));
  }, [id, serialized]);
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const [error, setError] = useState("");
  return <fieldset disabled={disabled || busy} data-testid={testId} className="min-w-0 border-0 p-0">
    <DriveSurface messages={messages} onAction={async (action) => {
      if (disabled || running.current) return;
      running.current = true; setBusy(true); setError("");
      try { await onSubmit(action.context ?? {}); } catch (e) { setError((e as Error).message); }
      finally { running.current = false; setBusy(false); }
    }} />{error && <p role="alert">{error}</p>}
  </fieldset>;
}

export function AinuiFile({ url, name, mime, size }: { url: string; name: string; mime?: string; size?: number | null }) {
  const id = useId();
  const messages = useMemo(() => screen(id, [{ id: "root", component: "FileView", src: url, name, mime: mime || resolveMime(name, null), size: size ?? null }]), [id, url, name, mime, size]);
  return <DriveSurface messages={messages} />;
}

export function AinuiImage({ url }: { url: string }) {
  const id = useId();
  const messages = useMemo(() => screen(id, [{ id: "root", component: "Image", url }]), [id, url]);
  return <DriveSurface messages={messages} />;
}
