import { NextRequest, NextResponse } from "next/server";
import { resolveEditAccess } from "@/lib/pages/edit-access";
import { applyTransactions } from "@/lib/transactions/apply";
import { recordSigned, verifySigned } from "@/lib/willow/verify-save";
import type { SaveError, SaveRequest, Transaction } from "@/lib/transactions/types";

export const dynamic = "force-dynamic";

/**
 * POST /api/saveTransactions — { requestId, transactions[] } ⇒ 200 `{}`
 *
 * One endpoint for every page, like Notion's saveTransactionsFanout: the
 * transactions carry their own pageId. Edit access is resolved per page, each
 * transaction is applied atomically and exactly once, and the applied ones
 * are fanned out over SSE. The body says nothing on success; when something
 * can never apply, 4xx names it (docs/save-protocol-target.md §4.1).
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as SaveRequest | null;
  if (!body || !Array.isArray(body.transactions)) {
    return NextResponse.json(error("ValidationError", "transactions[] required"), { status: 400 });
  }
  if (body.transactions.length > 500) {
    return NextResponse.json(error("ValidationError", "too many transactions"), { status: 413 });
  }
  const clientId = req.headers.get("x-client-id");
  const byPage = new Map<string, Transaction[]>();
  const rejectedIds: string[] = [];
  const reasons: string[] = [];
  // signed edits applied here but not (yet) in their aindrive drive, and signatures
  // dropped — the client re-sends the first later and refreshes its certificate
  const unrecorded: string[] = [];
  const signatureRefused: string[] = [];
  for (const t of body.transactions) {
    if (!t || typeof t.pageId !== "string" || typeof t.id !== "string") {
      if (t && typeof t.id === "string") rejectedIds.push(t.id);
      reasons.push("malformed transaction");
      continue;
    }
    let list = byPage.get(t.pageId);
    if (!list) byPage.set(t.pageId, (list = []));
    list.push(t);
  }
  for (const [pageId, transactions] of byPage) {
    const access = await resolveEditAccess(req, pageId);
    if (!access.ok) {
      rejectedIds.push(...transactions.map((t) => t.id));
      reasons.push(`${pageId}: ${access.error}`);
      continue;
    }
    // signed edits (a teamspace linked to aindrive): the signed payload is what
    // applies, and once applied it is recorded in the drive (docs/willow-ainmem-plan.md Task 6)
    const willow = await verifySigned(pageId, access.userId, transactions);
    signatureRefused.push(...willow.signatureRefused);
    const result = await applyTransactions({
      pageId,
      userId: access.userId,
      workspaceId: access.workspaceId,
      clientId,
      transactions: willow.transactions,
    });
    const rec = await recordSigned(pageId, access.userId, willow.signed);
    unrecorded.push(...rec.unrecorded);
    signatureRefused.push(...rec.signatureRefused);
    for (const r of result.rejected) {
      rejectedIds.push(r.id);
      reasons.push(`${r.id}: ${r.reason}`);
    }
  }
  if (rejectedIds.length) {
    const authProblem = reasons.some((r) => /Not found|Forbidden/.test(r));
    return NextResponse.json(
      { ...error(authProblem ? "UnauthorizedError" : "ValidationError", reasons.join("; ")), rejectedIds },
      { status: authProblem ? 403 : 422 }
    );
  }
  if (unrecorded.length || signatureRefused.length) return NextResponse.json({ unrecorded, signatureRefused });
  return NextResponse.json({});
}

function error(name: SaveError["name"], message: string): SaveError {
  return { errorId: crypto.randomUUID(), name, message };
}
