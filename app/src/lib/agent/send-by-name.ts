// app/src/lib/agent/send-by-name.ts
// "send Minjun 20 USDC": the ens-family core decides; this turns its answer into a reply
// and, when ready, the inline "Is this Minjun?" card (then Send, in the same chat).
import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { makeT } from "@/i18n/translate";
import { familyChainFor } from "@/lib/ens-workspace";
import { linkedWallet } from "@/lib/wallet/linked";
import { ensureNicknamesTable, loadNicknames } from "@/lib/ens-nicknames";
import { prepareSend } from "@/lib/ens-family/prepare";
import { displayName, findNodeByAddress, pickAnswer, pickRecipients, type FamilyNode } from "@/lib/ens-family/family-tree";
import { formatUsdc, isSendRequest, kinshipOf, parseSendRequest } from "@/lib/ens-family/send-request";
import { createSendOffer } from "./send-offer";
import { sendOfferMarker } from "./send-offer-surface";
import type { SkillContext, SkillResult } from "./family-skills";

// "Who should get it: Minjun or Seoyeon?" waits on that person in that room for 5 minutes:
// their next message naming one of them continues with the amount they said.
interface PendingSend {
  amountMicro: bigint;
  candidates: FamilyNode[];
  nicknames: Map<string, string[]>;
  expires: number;
}
const PENDING_SEND_MS = 5 * 60 * 1000;
const g = globalThis as unknown as { __ensPendingSend?: Map<string, PendingSend> };
const pendingSends = (g.__ensPendingSend ??= new Map<string, PendingSend>());
const pendingKey = (roomId: string, askerId: string) => `${roomId}\u0000${askerId}`;

function pendingSend(roomId: string, askerId: string, now = Date.now()): PendingSend | null {
  const k = pendingKey(roomId, askerId);
  const p = pendingSends.get(k);
  if (p && p.expires <= now) pendingSends.delete(k);
  return p && p.expires > now ? p : null;
}

/** Does `text` answer this person's pending "who should get it?" here? Anything else takes the
 *  question off the table (one turn, like the prompt skill's "which one?"). */
export function answersPendingSend(roomId: string, askerId: string, text: string): boolean {
  const p = pendingSend(roomId, askerId);
  if (!p) return false;
  if (!isSendRequest(text) && pickAnswer(text, p.candidates, p.nicknames)) return true;
  pendingSends.delete(pendingKey(roomId, askerId));
  return false;
}

/** The reply, or null when a sentence without an amount names nobody below the asker
 *  ("how much money did we give at Chuseok?"): the model answers that one. */
export async function sendByName(ctx: SkillContext): Promise<SkillResult | null> {
  const t = makeT(ctx.lang);
  // "Minjun" after "Minjun or Seoyeon?": the same request, now for that one person (by label,
  // so prepareSend still does every check — family, amount, on-chain path — itself)
  const pend = ctx.roomId ? pendingSend(ctx.roomId, ctx.askerId) : null;
  if (ctx.roomId) pendingSends.delete(pendingKey(ctx.roomId, ctx.askerId));
  const picked = pend && !isSendRequest(ctx.text) ? pickAnswer(ctx.text, pend.candidates, pend.nicknames) : null;
  const text = pend && picked ? `send ${picked.label} ${formatUsdc(pend.amountMicro)} USDC` : ctx.text;
  // no amount ("send Minjun some money"): ours only if it names someone to ask the amount for
  const vague = !isSendRequest(text);

  const chain = await familyChainFor(ctx.workspaceId);
  if (!chain) return vague ? null : { text: t("Family names aren't set up here yet.") };
  const [row] = await db.select({ ainAddress: users.ainAddress }).from(users).where(eq(users.id, ctx.askerId));
  const me = { address: row ? linkedWallet(row) : null };
  if (!me.address) return vague ? null : { text: t("Sign in with your wallet first, so I know which family name is yours.") };

  const tree = await chain.loadTree();
  const nicknames = await loadNicknames(ctx.workspaceId);
  if (vague) {
    const asker = findNodeByAddress(tree, me.address);
    if (!asker || pickRecipients(asker, { kinship: kinshipOf(text), text, nicknames }).length === 0) return null;
  }
  const table = await ensureNicknamesTable({ workspaceId: ctx.workspaceId, byUserId: ctx.askerId, tree, t });
  const note = table.pageId
    ? "\n" + t("I made a “Family nicknames” page where you can add the names you call each other → /p/{pageId}", { pageId: table.pageId })
    : "";

  const r = await prepareSend({ text, askerAddress: me.address, tree, nicknames }, chain);
  if (r.kind === "ask" && ctx.roomId) {
    const amountMicro = parseSendRequest(text)?.amountMicro;
    const now = Date.now();
    for (const [k, v] of pendingSends) if (v.expires <= now) pendingSends.delete(k);
    if (amountMicro !== undefined)
      pendingSends.set(pendingKey(ctx.roomId, ctx.askerId), { amountMicro, candidates: r.candidates, nicknames, expires: now + PENDING_SEND_MS });
  }
  if (r.kind === "ask") return { text: t("Who should get it: {names}?", { names: r.candidates.map(displayName).join(t(" or ")) }) + note };
  if (r.kind === "refuse") {
    const why = {
      "no-request": t("Tell me one amount in USDC, like “send Minjun 20 USDC”."),
      "too-small": t("The smallest amount I can send is 0.01 USDC."),
      "too-large": t("I can send at most 100 USDC at a time."),
      "not-in-family": t("I couldn't find your wallet in the {root} family.", { root: chain.root }),
      nobody: t("I couldn't find that person below you in the family tree."),
      unverified: t("I couldn't confirm {name} on-chain, so I won't prepare this.", { name: r.name ?? "" }),
    }[r.reason];
    return { text: why + note };
  }
  // no link to another page: the chat asks "Is this Minjun?" with their photo and email, and
  // after yes shows the Send button (lib/agent/send-offer.ts)
  if (!ctx.roomId) return { text: t("Ask me in a chat, so I can show you who gets it before sending.") + note };
  const offerId = await createSendOffer({
    workspaceId: ctx.workspaceId,
    roomId: ctx.roomId,
    askerId: ctx.askerId,
    from: me.address,
    name: r.recipient.name,
    displayName: displayName(r.recipient),
    ensAvatar: r.recipient.avatar,
    to: r.to,
    amountMicro: r.amountMicro,
  });
  return { text: sendOfferMarker("check", offerId) + note };
}
