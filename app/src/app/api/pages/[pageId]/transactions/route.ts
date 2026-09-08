import { NextRequest, NextResponse } from "next/server";
import { resolveEditAccess } from "@/lib/pages/edit-access";
import { applyTransactions } from "@/lib/transactions/apply";
import type { SaveRequest } from "@/lib/transactions/types";

export const dynamic = "force-dynamic";

/**
 * POST → { requestId, transactions: Transaction[] }  ⇒  { rejected?, dropped? }
 *
 * The editor's save path (docs/save-protocol-target.md §4.1). Transactions
 * carry operations on single blocks, are applied atomically and exactly once
 * by id, and the answer is deliberately small: the client already holds the
 * state it sent, and the other clients are told over SSE.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ pageId: string }> }) {
  const { pageId } = await params;
  const access = await resolveEditAccess(req, pageId);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });

  const body = (await req.json().catch(() => null)) as SaveRequest | null;
  if (!body || !Array.isArray(body.transactions)) {
    return NextResponse.json({ error: "transactions[] required" }, { status: 400 });
  }
  if (body.transactions.length > 500) {
    return NextResponse.json({ error: "too many transactions" }, { status: 413 });
  }
  const result = await applyTransactions({
    pageId,
    userId: access.userId,
    workspaceId: access.workspaceId,
    clientId: req.headers.get("x-client-id"),
    transactions: body.transactions.filter((t) => t && t.pageId === pageId),
  });
  return NextResponse.json(result);
}
