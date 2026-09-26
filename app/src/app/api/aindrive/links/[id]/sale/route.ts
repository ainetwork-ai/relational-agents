import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { teamspaceDrive } from "@/lib/aindrive-teamspace";
import { fileSale, forgetOpen, quoteFor, sharedFile } from "@/lib/aindrive-file-sale";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * A teamspace link that is a single file (lib/aindrive-file-sale):
 *   GET  → { kind: "folder" } | { kind: "file", file, sale, owner, unlocked, needsAccount }
 *   POST {}                   → { paymentRequired } to sign, or { unlocked: true }
 *   POST { paymentSignature } → aindrive settles on chain as the buyer → { unlocked: true, txHash }
 */
async function load(ctx: Ctx) {
  const auth = await requireAuth();
  if ("error" in auth) return { res: auth.error };
  const found = await teamspaceDrive(auth.user.id, (await ctx.params).id);
  if (!found) return { res: NextResponse.json({ error: "Not found" }, { status: 404 }) };
  return { userId: auth.user.id, drive: found.drive };
}

export async function GET(_req: NextRequest, ctx: Ctx) {
  const r = await load(ctx);
  if ("res" in r) return r.res;
  const file = await sharedFile(r.drive);
  if (!file) return NextResponse.json({ kind: "folder" });
  const owner = r.drive.createdBy === r.userId;
  const sale = await fileSale(r.drive);
  const q = sale && !owner ? await quoteFor(r.userId, sale) : null;
  return NextResponse.json({
    kind: "file",
    file,
    sale: sale ? { price: sale.price, currency: sale.currency } : null,
    owner,
    unlocked: !sale || owner || q?.state === "unlocked",
    needsAccount: q?.state === "needs-account",
    messages: q?.state === "quote" ? q.messages : undefined,
    error: q?.state === "error" ? q.error : undefined,
  });
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const r = await load(ctx);
  if ("res" in r) return r.res;
  const sale = await fileSale(r.drive);
  if (!sale) return NextResponse.json({ unlocked: true });
  const { paymentSignature } = ((await req.json().catch(() => ({}))) ?? {}) as { paymentSignature?: unknown };
  if (paymentSignature !== undefined && (typeof paymentSignature !== "string" || !paymentSignature || paymentSignature.length > 8192))
    return NextResponse.json({ error: "bad paymentSignature" }, { status: 400 });
  const q = await quoteFor(r.userId, sale, paymentSignature as string | undefined);
  if (q.state === "unlocked") {
    forgetOpen(r.userId, r.drive.id);
    return NextResponse.json({ unlocked: true, txHash: q.txHash ?? null });
  }
  if (q.state === "quote") return NextResponse.json({ paymentRequired: q.paymentRequired, messages: q.messages });
  if (q.state === "needs-account") return NextResponse.json({ error: "Connect your aindrive to buy this file", needsAccount: true }, { status: 401 });
  return NextResponse.json({ error: q.error }, { status: q.status });
}
