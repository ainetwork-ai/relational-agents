import { NextRequest, NextResponse } from "next/server";
import { desc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { transactions, users } from "@/lib/db/schema";
import { resolveEditAccess } from "@/lib/pages/edit-access";
import { aindriveHttp } from "@/lib/aindrive";
import { runAsOrService } from "@/lib/aindrive-account";
import { signingOf } from "@/lib/willow/record-drive";
import type { Operation } from "@/lib/transactions/types";

export const dynamic = "force-dynamic";

const SCAN = 5000;

export type BlockAuthor = { name: string | null; signed: "wallet" | "attested" | null; at: string };

/**
 * GET /api/pages/:id/authors → { blocks: { [blockId]: BlockAuthor } }
 *
 * Who last edited each block: the last transaction touching it. In a teamspace
 * linked to aindrive, that transaction's signer as the drive's Willow store
 * verifies it (aindrive's /api/willow/ainmem-authors) — "Signed", with how the
 * device was vouched for — otherwise the ainmem user the server recorded
 * (docs/willow-ainmem-plan.md Task 7).
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ pageId: string }> }) {
  const { pageId } = await params;
  const access = await resolveEditAccess(req, pageId);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });

  const rows = await db
    .select({ id: transactions.id, userId: transactions.userId, operations: transactions.operations, appliedAt: transactions.appliedAt })
    .from(transactions)
    .where(eq(transactions.pageId, pageId))
    .orderBy(desc(transactions.appliedAt))
    .limit(SCAN);
  const last = new Map<string, (typeof rows)[number]>();
  for (const r of rows) {
    for (const op of (r.operations as Operation[]) ?? []) {
      for (const id of [op.pointer?.id, op.command === "moveTextSlice" ? op.args.toBlock : undefined]) {
        if (id && !last.has(id)) last.set(id, r);
      }
    }
  }

  const signers = new Map<string, { name: string | null; strength: "wallet" | "attested" }>();
  const s = await signingOf(pageId);
  if (s && last.size) {
    try {
      const q = new URLSearchParams({ drive: s.driveId, teamspace: s.teamspaceId, page: pageId });
      const res = await runAsOrService(s.createdBy, () => aindriveHttp(`/api/willow/ainmem-authors?${q}`, {}, 5000));
      if (res.ok) {
        const { authors } = (await res.json()) as { authors: { tx: string; name: string | null; strength: "wallet" | "attested" }[] };
        for (const a of authors) signers.set(a.tx, { name: a.name, strength: a.strength });
      }
    } catch {} // aindrive unreachable: the recorded authors still answer, unsigned
  }

  const userIds = [...new Set([...last.values()].map((r) => r.userId).filter((u): u is string => !!u))];
  const names = new Map(
    userIds.length
      ? (await db.select({ id: users.id, name: users.displayName }).from(users).where(inArray(users.id, userIds))).map((u) => [u.id, u.name])
      : []
  );
  const blocks: Record<string, BlockAuthor> = {};
  for (const [blockId, r] of last) {
    const signer = signers.get(r.id);
    blocks[blockId] = {
      name: signer?.name ?? (r.userId ? names.get(r.userId) ?? null : null),
      signed: signer?.strength ?? null,
      at: r.appliedAt.toISOString(),
    };
  }
  return NextResponse.json({ blocks });
}
