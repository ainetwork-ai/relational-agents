import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { chatRoomBots, users, type AgentConfig } from "@/lib/db/schema";
import { ROMANTIC } from "./romantic";
import { BUSINESS } from "./business";
import type { ProfileSection, RelationshipProfile } from "./types";

export type { ProfileSection, RelationshipProfile } from "./types";

/** Built-in profiles, in the order the settings form offers them. */
export const PROFILES: RelationshipProfile[] = [ROMANTIC, BUSINESS];

/** The profile a room gets when it has never chosen one — and the fallback
 *  when it names one that no longer exists. A room never goes profile-less. */
export const DEFAULT_PROFILE = ROMANTIC;

export function profileByKey(key: string | undefined | null): RelationshipProfile {
  return PROFILES.find((p) => p.key === key) ?? DEFAULT_PROFILE;
}

/**
 * The profile a room actually runs on: the chosen profile, with the room's own
 * overrides laid on top.
 *
 * Three layers, outermost wins — built-in defaults ← profile ← room overrides.
 * The form only ever writes the overrides, so a profile improved in a later
 * release reaches every room that did not deliberately opt out of that setting.
 */
export function resolveProfile(config: AgentConfig | null | undefined): RelationshipProfile {
  const base = profileByKey(typeof config?.profile === "string" ? config.profile : undefined);
  if (!config) return base;
  return {
    ...base,
    persona: {
      name: config.persona?.name ?? base.persona.name,
      tone: config.persona?.tone ?? base.persona.tone,
    },
    behavior: {
      proactive: config.behavior?.proactive ?? base.behavior.proactive,
      whisperOnQuestion: config.behavior?.whisperOnQuestion ?? base.behavior.whisperOnQuestion,
    },
  };
}

/**
 * The room's profile, found through its agent.
 *
 * Config lives on the agent user (it is the agent's configuration, and the
 * agent outlives any one conversation), so every write path resolves it the
 * same way rather than each caller inventing its own lookup.
 */
export async function profileForRoom(roomId: string): Promise<RelationshipProfile> {
  const [bot] = await db.select().from(chatRoomBots).where(eq(chatRoomBots.roomId, roomId));
  if (!bot) return DEFAULT_PROFILE;
  const [agent] = await db.select().from(users).where(eq(users.id, bot.agentUserId));
  return resolveProfile((agent?.agentConfig ?? null) as AgentConfig | null);
}

/** `key (Title), key (Title)` — the menu a prompt offers the model. */
export function sectionMenu(sections: ProfileSection[]): string {
  return sections.map((s) => `${s.key} (${s.title})`).join(", ");
}
