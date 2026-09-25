// Agents provisioned before profiles existed were seeded with
// `persona: {name:"Relationship agent", tone:"warm"}` and
// `behavior: {proactive:true}`. resolveProfile reads a stored value as a room
// override, so those rows pin every agent to the romantic voice — picking the
// Business profile changed the sections but the prompt still said
// "You are the Relationship agent … in a warm voice". BUSINESS.persona was
// unreachable code.
//
// This removes only the keys that still hold exactly those seeded values; a
// persona someone actually chose is left alone. Absent means "follow the
// profile", which is what these rooms meant all along.
//
//   npx tsx --tsconfig scripts/tsconfig.json scripts/strip-seeded-persona.mts [--write]

import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users, type AgentConfig } from "@/lib/db/schema";
import { ROMANTIC } from "@/lib/agent/profiles/romantic";

const WRITE = process.argv.includes("--write");

const agents = await db.select().from(users).where(eq(users.isAgent, true));
let touched = 0;

for (const agent of agents) {
  const config = (agent.agentConfig ?? {}) as AgentConfig;
  const next: AgentConfig = { ...config };
  const changes: string[] = [];

  const persona = config.persona;
  if (
    persona &&
    (persona.name ?? ROMANTIC.persona.name) === ROMANTIC.persona.name &&
    (persona.tone ?? ROMANTIC.persona.tone) === ROMANTIC.persona.tone
  ) {
    delete next.persona;
    changes.push("persona");
  }

  const behavior = config.behavior;
  if (
    behavior &&
    (behavior.proactive ?? ROMANTIC.behavior.proactive) === ROMANTIC.behavior.proactive &&
    (behavior.whisperOnQuestion ?? ROMANTIC.behavior.whisperOnQuestion) ===
      ROMANTIC.behavior.whisperOnQuestion
  ) {
    delete next.behavior;
    changes.push("behavior");
  }

  // a room that never named its profile was running on the default anyway —
  // writing it down makes the settings form show the truth
  if (!config.profile) {
    next.profile = ROMANTIC.key;
    changes.push("profile=romantic");
  }

  if (!changes.length) continue;
  touched++;
  console.log(`${WRITE ? "정리" : "정리 예정"}: ${agent.displayName} — ${changes.join(", ")}`);
  if (WRITE)
    await db
      .update(users)
      .set({ agentConfig: next as Record<string, unknown> })
      .where(eq(users.id, agent.id));
}

console.log(`\n에이전트 ${agents.length}개 중 ${touched}개${WRITE ? " 정리함" : " 정리 예정"}`);
if (!WRITE) console.log("실제로 적용하려면 --write");
process.exit(0);
