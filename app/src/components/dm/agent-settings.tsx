"use client";

import { useCallback, useEffect, useState } from "react";
import { X } from "lucide-react";

/**
 * What this relationship's agent should be.
 *
 * Not every relationship is a romance, so the agent cannot be one thing. The
 * profile decides the shape — which sections the record is kept in, what the
 * agent calls things, which of its rules apply — and everything below it is an
 * override this room alone carries. Blank means "follow the profile", which is
 * why clearing a field is a real action here rather than saving an empty value.
 *
 * Any member may change this, without a signature: the signed contract is what
 * brought the agent into being, not what it is told to pay attention to.
 */

interface ProfileOption {
  key: string;
  name: string;
  description: string;
  docTitle: string;
  docIcon: string;
  sections: { key: string; title: string }[];
  persona: { name: string; tone: string };
  behavior: { proactive: boolean; whisperOnQuestion: boolean };
}

interface AgentConfigShape {
  profile?: string;
  systemPrompt?: string;
  persona?: { name?: string; tone?: string };
  behavior?: { proactive?: boolean; whisperOnQuestion?: boolean };
}

const TONES = ["warm", "concise", "playful", "formal"];

export function AgentSettings({
  roomId,
  agentName,
  onClose,
  onSaved,
}: {
  roomId: string;
  agentName: string;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const [profiles, setProfiles] = useState<ProfileOption[] | null>(null);
  const [config, setConfig] = useState<AgentConfigShape>({});
  const [name, setName] = useState(agentName);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const [pRes, aRes] = await Promise.all([
        fetch("/api/agent/profiles"),
        fetch(`/api/dm/rooms/${roomId}/agent`),
      ]);
      if (pRes.ok) setProfiles(((await pRes.json()) as { profiles: ProfileOption[] }).profiles);
      if (aRes.ok) {
        const { agents } = (await aRes.json()) as {
          agents: { displayName: string; agentConfig: AgentConfigShape }[];
        };
        if (agents[0]) {
          setConfig(agents[0].agentConfig ?? {});
          setName(agents[0].displayName);
        }
      }
    })();
  }, [roomId]);

  const active = profiles?.find((p) => p.key === (config.profile ?? "romantic")) ?? profiles?.[0];
  // the profile supplies every default, so the form can show what a blank field
  // will actually do instead of showing nothing
  const personaName = config.persona?.name ?? active?.persona.name ?? "";
  const tone = config.persona?.tone ?? active?.persona.tone ?? "warm";
  const proactive = config.behavior?.proactive ?? active?.behavior.proactive ?? true;
  const whisper = config.behavior?.whisperOnQuestion ?? active?.behavior.whisperOnQuestion ?? true;

  const save = useCallback(async () => {
    setSaving(true);
    setError(null);
    const target = profiles?.find((p) => p.key === (config.profile ?? active?.key)) ?? active;
    const personaOverride: { name?: string; tone?: string } = {};
    if (personaName && personaName !== target?.persona.name) personaOverride.name = personaName;
    if (tone && tone !== target?.persona.tone) personaOverride.tone = tone;
    const behaviorOverride: { proactive?: boolean; whisperOnQuestion?: boolean } = {};
    if (target && proactive !== target.behavior.proactive) behaviorOverride.proactive = proactive;
    if (target && whisper !== target.behavior.whisperOnQuestion)
      behaviorOverride.whisperOnQuestion = whisper;
    const res = await fetch(`/api/dm/rooms/${roomId}/agent`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: name.trim() || undefined,
        profile: target?.key,
        // Only what actually differs from the chosen profile travels as an
        // override. Sending every field back would pin this room to today's
        // defaults forever — a profile improved in a later release, or a
        // profile switch that means to change the voice, would never reach it.
        persona: Object.keys(personaOverride).length ? personaOverride : null,
        behavior: Object.keys(behaviorOverride).length ? behaviorOverride : null,
        systemPrompt: config.systemPrompt ?? "",
      }),
    });
    setSaving(false);
    if (!res.ok) {
      setError(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "Could not save");
      return;
    }
    onSaved?.();
    onClose();
  }, [roomId, name, config, active, profiles, personaName, tone, proactive, whisper, onClose, onSaved]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
      onClick={onClose}
    >
      <div
        data-testid="agent-settings"
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-y-auto rounded-xl bg-white p-5 shadow-xl dark:bg-neutral-900"
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold">Agent settings</h2>
            <p className="text-xs text-neutral-500">
              What this agent keeps, and how it speaks. Any member can change it.
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded p-1 text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800"
          >
            <X size={16} />
          </button>
        </div>

        <label className="mb-1 block text-xs font-medium text-neutral-500">Relationship</label>
        <div className="mb-4 flex flex-col gap-2">
          {(profiles ?? []).map((p) => {
            const on = p.key === active?.key;
            return (
              <button
                key={p.key}
                type="button"
                data-testid={`profile-${p.key}`}
                onClick={() => setConfig((c) => ({ ...c, profile: p.key }))}
                className={`rounded-lg border px-3 py-2.5 text-left transition ${
                  on
                    ? "border-neutral-800 bg-neutral-50 dark:border-neutral-300 dark:bg-neutral-800/60"
                    : "border-neutral-200 hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-800/40"
                }`}
              >
                <span className="flex items-center gap-2 text-sm font-medium">
                  <span aria-hidden>{p.docIcon}</span>
                  {p.name}
                </span>
                <span className="mt-0.5 block text-xs text-neutral-500">{p.description}</span>
                <span className="mt-1.5 block text-[11px] text-neutral-400">
                  {p.docTitle} · {p.sections.map((s) => s.title).join(" · ")}
                </span>
              </button>
            );
          })}
        </div>

        {/* switching is safe, but only because nothing is thrown away — say so */}
        <p className="mb-4 rounded-md bg-neutral-50 px-3 py-2 text-[11px] text-neutral-500 dark:bg-neutral-800/50">
          Changing this renames sections and may add new ones. Nothing already written is moved or
          deleted — a section the new profile does not use stays in the document.
        </p>

        <div className="mb-4 grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-neutral-500" htmlFor="agent-name">
              Name
            </label>
            <input
              id="agent-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-md border border-neutral-200 px-2.5 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-800"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-neutral-500" htmlFor="agent-tone">
              Tone
            </label>
            <select
              id="agent-tone"
              value={tone}
              onChange={(e) =>
                setConfig((c) => ({
                  ...c,
                  persona: { ...c.persona, name: personaName, tone: e.target.value },
                }))
              }
              className="w-full rounded-md border border-neutral-200 px-2.5 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-800"
            >
              {TONES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
        </div>

        <label className="flex items-start gap-2.5 py-1.5 text-sm">
          <input
            type="checkbox"
            checked={proactive}
            onChange={(e) =>
              setConfig((c) => ({ ...c, behavior: { ...c.behavior, proactive: e.target.checked } }))
            }
            className="mt-0.5"
          />
          <span>
            Speak up unasked
            <span className="block text-xs text-neutral-500">
              Only when you both need to know something — a clash, a promise it remembers.
            </span>
          </span>
        </label>

        <label className="mb-4 flex items-start gap-2.5 py-1.5 text-sm">
          <input
            type="checkbox"
            checked={whisper}
            onChange={(e) =>
              setConfig((c) => ({
                ...c,
                behavior: { ...c.behavior, whisperOnQuestion: e.target.checked },
              }))
            }
            className="mt-0.5"
          />
          <span>
            Whisper on calls
            <span className="block text-xs text-neutral-500">
              When you are asked something, it tells you privately what the record says.
            </span>
          </span>
        </label>

        <label className="mb-1 block text-xs font-medium text-neutral-500" htmlFor="agent-extra">
          Extra instructions
        </label>
        <textarea
          id="agent-extra"
          rows={3}
          value={config.systemPrompt ?? ""}
          onChange={(e) => setConfig((c) => ({ ...c, systemPrompt: e.target.value }))}
          placeholder="e.g. Always put anything we promise into Action items."
          className="mb-4 w-full resize-y rounded-md border border-neutral-200 px-2.5 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-800"
        />

        {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-md px-3 py-1.5 text-sm text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
          >
            Cancel
          </button>
          <button
            data-testid="agent-settings-save"
            onClick={() => void save()}
            disabled={saving || !profiles}
            className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
