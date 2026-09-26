import { NextRequest, NextResponse } from "next/server";
import { resolveEditAccess } from "@/lib/pages/edit-access";
import type { Transaction } from "@/lib/transactions/types";
import { recordSigned, verifySigned } from "@/lib/willow/verify-save";

export const dynamic = "force-dynamic";

/**
 * POST /api/willow/record { transactions } → { unrecorded, signatureRefused }
 *
 * Signed transactions that were applied while aindrive could not be reached, handed
 * to the drive's store now (docs/willow-ainmem-plan.md Task 6, review I4). Nothing
 * is applied here; only what this user's session already applied is recorded.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { transactions?: Transaction[] } | null;
  if (!body || !Array.isArray(body.transactions) || body.transactions.length > 500) {
    return NextResponse.json({ error: "transactions[] (≤500) required" }, { status: 400 });
  }
  const byPage = new Map<string, Transaction[]>();
  for (const t of body.transactions) {
    if (!t || typeof t.pageId !== "string" || typeof t.id !== "string" || !t.signed) continue;
    const list = byPage.get(t.pageId) ?? [];
    list.push(t);
    byPage.set(t.pageId, list);
  }
  const unrecorded: string[] = [];
  const signatureRefused: string[] = [];
  for (const [pageId, txs] of byPage) {
    const access = await resolveEditAccess(req, pageId);
    if (!access.ok) continue; // no longer theirs to record: drop quietly
    const v = await verifySigned(pageId, access.userId, txs);
    signatureRefused.push(...v.signatureRefused);
    const r = await recordSigned(pageId, access.userId, v.signed);
    unrecorded.push(...r.unrecorded);
    signatureRefused.push(...r.signatureRefused);
  }
  return NextResponse.json({ unrecorded, signatureRefused });
}
