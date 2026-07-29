import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { db } from "@/lib/db";
import { aiConnectors, type AiConnectorProvider } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const AI_CONNECTOR_PROVIDERS: AiConnectorProvider[] = ["slack", "teams", "drive"];

/** GET /api/ai/connectors → { connectors } — all 3 providers, defaulting to disconnected. */
export async function GET() {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;

  const rows = await db
    .select()
    .from(aiConnectors)
    .where(eq(aiConnectors.userId, auth.user.id));
  const byProvider = new Map(rows.map((r) => [r.provider, r]));

  const connectors = AI_CONNECTOR_PROVIDERS.map((provider) => {
    const row = byProvider.get(provider);
    return {
      provider,
      status: row?.status ?? "disconnected",
      accountLabel: row?.accountLabel ?? null,
      connectedAt: row?.connectedAt ?? null,
    };
  });

  return NextResponse.json({ connectors });
}
