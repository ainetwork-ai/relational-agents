import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { db } from "@/lib/db";
import { aiConnectors, type AiConnectorProvider } from "@/lib/db/schema";
import { getDefaultWorkspaceId } from "@/lib/workspace";
import { AI_CONNECTOR_PROVIDERS } from "../route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function isValidProvider(p: string): p is AiConnectorProvider {
  return (AI_CONNECTOR_PROVIDERS as string[]).includes(p);
}

/** POST /api/ai/connectors/[provider] → { connector } — mock connect (instantly connected). */
export async function POST(_req: NextRequest, ctx: { params: Promise<{ provider: string }> }) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  const { provider } = await ctx.params;
  if (!isValidProvider(provider))
    return NextResponse.json({ error: "Invalid provider" }, { status: 400 });

  const workspaceId = await getDefaultWorkspaceId(auth.user.id);
  if (!workspaceId) return NextResponse.json({ error: "No workspace" }, { status: 400 });

  const [connector] = await db
    .insert(aiConnectors)
    .values({
      workspaceId,
      userId: auth.user.id,
      provider,
      status: "connected",
      accountLabel: `Mock ${provider} account`,
      connectedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [aiConnectors.userId, aiConnectors.provider],
      set: {
        status: "connected",
        accountLabel: `Mock ${provider} account`,
        connectedAt: new Date(),
        updatedAt: new Date(),
      },
    })
    .returning();

  return NextResponse.json({ connector });
}

/** DELETE /api/ai/connectors/[provider] → { connector } — mock disconnect. */
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ provider: string }> }) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  const { provider } = await ctx.params;
  if (!isValidProvider(provider))
    return NextResponse.json({ error: "Invalid provider" }, { status: 400 });

  const workspaceId = await getDefaultWorkspaceId(auth.user.id);
  if (!workspaceId) return NextResponse.json({ error: "No workspace" }, { status: 400 });

  const [connector] = await db
    .insert(aiConnectors)
    .values({
      workspaceId,
      userId: auth.user.id,
      provider,
      status: "disconnected",
      accountLabel: null,
      connectedAt: null,
    })
    .onConflictDoUpdate({
      target: [aiConnectors.userId, aiConnectors.provider],
      set: {
        status: "disconnected",
        accountLabel: null,
        connectedAt: null,
        updatedAt: new Date(),
      },
    })
    .returning();

  return NextResponse.json({ connector });
}
