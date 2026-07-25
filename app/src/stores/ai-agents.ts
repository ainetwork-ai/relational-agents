"use client";

import { create } from "zustand";
import type { AiAgent } from "@/lib/db/schema";

interface AiAgentsState {
  agents: AiAgent[];
  loaded: boolean;
  load: () => Promise<void>;
  create: (opts?: { name?: string; icon?: string; instructions?: string }) => Promise<AiAgent>;
  patch: (
    id: string,
    patch: Partial<
      Pick<AiAgent, "name" | "icon" | "instructions" | "isFavorite" | "isShared" | "knowledgeScope">
    > & {
      lastUsedAt?: true;
    }
  ) => Promise<void>;
  remove: (id: string) => Promise<void>;
  duplicate: (id: string) => Promise<AiAgent>;
}

export const useAiAgentsStore = create<AiAgentsState>()((set) => ({
  agents: [],
  loaded: false,

  load: async () => {
    const r = await fetch("/api/ai/agents");
    if (!r.ok) return;
    const { agents } = (await r.json()) as { agents: AiAgent[] };
    set({ agents, loaded: true });
  },

  create: async (opts) => {
    const r = await fetch("/api/ai/agents", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(opts ?? {}),
    });
    const { agent } = (await r.json()) as { agent: AiAgent };
    set((s) => ({ agents: [agent, ...s.agents] }));
    return agent;
  },

  patch: async (id, patch) => {
 // optimistic — lastUsedAt bumps the agent to the front (recently-used order)
    set((s) => {
      const updated = s.agents.map((a) =>
        a.id === id
          ? {
              ...a,
              ...("name" in patch && patch.name !== undefined ? { name: patch.name } : {}),
              ...("icon" in patch ? { icon: patch.icon ?? null } : {}),
              ...("instructions" in patch && patch.instructions !== undefined
                ? { instructions: patch.instructions }
                : {}),
              ...("isFavorite" in patch && patch.isFavorite !== undefined
                ? { isFavorite: patch.isFavorite }
                : {}),
              ...("isShared" in patch && patch.isShared !== undefined ? { isShared: patch.isShared } : {}),
              ...("knowledgeScope" in patch && patch.knowledgeScope !== undefined
                ? { knowledgeScope: patch.knowledgeScope }
                : {}),
              ...(patch.lastUsedAt ? { lastUsedAt: new Date() as unknown as AiAgent["lastUsedAt"] } : {}),
            }
          : a
      );
      if (!patch.lastUsedAt) return { agents: updated };
      const moved = updated.find((a) => a.id === id);
      if (!moved) return { agents: updated };
      return { agents: [moved, ...updated.filter((a) => a.id !== id)] };
    });
    await fetch(`/api/ai/agents/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    });
  },

  remove: async (id) => {
    set((s) => ({ agents: s.agents.filter((a) => a.id !== id) }));
    await fetch(`/api/ai/agents/${id}`, { method: "DELETE" });
  },

  duplicate: async (id) => {
    const r = await fetch(`/api/ai/agents/${id}/duplicate`, { method: "POST" });
    const { agent } = (await r.json()) as { agent: AiAgent };
    set((s) => ({ agents: [agent, ...s.agents] }));
    return agent;
  },
}));
