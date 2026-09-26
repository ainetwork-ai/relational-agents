/**
 * "Send Minjun 1 USDC", asked in a chat, as two A2UI v0.9 cards drawn in place
 * (components/a2ui/surface.tsx), the way the treasury's recurring-buy card is:
 *
 *   check  "Is this Minjun?" — the recipient's photo, name and email, the
 *          amount, Yes / No (the asker only)
 *   send   "Send 1 USDC to Minjun" — one Send button (the asker only); the
 *          browser hands the transfer to MetaMask and the card follows it:
 *          ready → waiting → sent → done, or cancelled / failed
 *
 * An agent message carrying the line `[[a2ui:send-check/<offerId>]]` or
 * `[[a2ui:send/<offerId>]]` shows that card in place of the line
 * (splitA2uiMarkers in lib/agent/treasurer/surfaces.ts).
 *
 * Pure: no IO, safe on the client. No addresses in any text. English source
 * run through the caller's `t`.
 */

import type { T } from "@/i18n";
import { A2UI_BASIC_CATALOG, A2UI_VERSION, type A2uiComponent, type A2uiMessage } from "@/lib/x402/a2ui";

export const SEND_ANSWER_ACTION = "ainmem.send.answer";
export const SEND_GO_ACTION = "ainmem.send.go";
export const SEND_RECHECK_ACTION = "ainmem.send.recheck";
export const SEND_EXPLORER_ACTION = "ainmem.send.explorer";
/** sent by the browser, not drawn as buttons: what MetaMask answered */
export const SEND_CANCELLED_ACTION = "ainmem.send.cancelled";
export const SEND_FAILED_ACTION = "ainmem.send.failed";

export type SendOfferView = "check" | "send";

export function sendOfferMarker(view: SendOfferView, offerId: string): string {
  return view === "check" ? `[[a2ui:send-check/${offerId}]]` : `[[a2ui:send/${offerId}]]`;
}

export function sendOfferSrc(view: SendOfferView, offerId: string): string {
  return `/api/ens/send/offers/${encodeURIComponent(offerId)}?view=${view}`;
}

/** changed: at Yes the name pointed at another wallet, so nothing was prepared */
export type CheckState = "asking" | "yes" | "no" | "expired" | "changed";
export type SendState = "ready" | "waiting" | "sent" | "done" | "cancelled" | "failed" | "expired";

/** Why a send failed, as the card says it (reason codes from lib/agent/send-offer.ts and the wallet) */
export const SEND_FAIL_TEXT: Record<string, string> = {
  "address-changed": "{who}'s wallet changed since I asked, so I stopped. Ask me again.",
  "wrong-account": "MetaMask has a different account open. Choose your wallet in MetaMask and press Send again.",
  "no-provider": "Open this in a browser with MetaMask to send it.",
  "no-wallet": "Log in with your wallet first, then press Send again.",
  "low-usdc": "Your wallet has less than {amount} USDC.",
  "chain-unavailable": "I couldn't reach the network just now. Try again in a moment.",
  different: "That transaction moved USDC, but not as prepared here. Check it on Etherscan.",
  unconfirmed: "It was sent, but I couldn't confirm it yet. Press Check again.",
  failed: "MetaMask couldn't send it. Nothing was sent.",
  "no-usdc-moved": "That transaction didn't move any USDC, so nothing was paid. You can send again.",
};

export interface SendOfferCardInput {
  offerId: string;
  view: SendOfferView;
  /** the recipient as the family calls them ("Minjun") */
  who: string;
  /** "1" — whole USDC as formatUsdc writes it */
  amount: string;
  photoUrl: string | null;
  initials: string;
  /** the workspace member's email, only when they have one — shown to the asker only */
  email: string | null;
  /** a workspace member holds the recipient's wallet (proved by signature) */
  inWorkspace: boolean;
  /** the viewer is the person who asked: only they may answer or send */
  canAct: boolean;
  askerName: string;
  checkState?: CheckState;
  sendState?: SendState;
  /** a reason code from SEND_FAIL_TEXT, for failed (and a note on ready after a freed hash) */
  failReason?: string | null;
  /** Etherscan page of the transaction, once there is one */
  explorerUrl?: string | null;
  /** the signed intent the browser confirms with — the asker's card only */
  token?: string | null;
}

const text = (id: string, value: string, variant?: string): A2uiComponent => ({ id, component: "Text", text: value, ...(variant ? { variant } : {}) });
const row = (id: string, children: string[], justify?: string): A2uiComponent => ({ id, component: "Row", children, ...(justify ? { justify } : {}) });
const column = (id: string, children: string[]): A2uiComponent => ({ id, component: "Column", children });
const chip = (id: string, value: string, tone: string, icon?: string): A2uiComponent => ({ id, component: "Chip", text: value, tone, ...(icon ? { icon } : {}) });
const button = (id: string, child: string, name: string, context: Record<string, unknown>, variant?: string): A2uiComponent => ({
  id,
  component: "Button",
  child,
  action: { event: { name, context } },
  ...(variant ? { variant } : {}),
});

const SEND_CHIP: Record<SendState, { label: string; tone: string }> = {
  ready: { label: "Ready", tone: "neutral" },
  waiting: { label: "Waiting for MetaMask", tone: "waiting" },
  sent: { label: "Sent · confirming", tone: "waiting" },
  done: { label: "Done", tone: "success" },
  cancelled: { label: "Cancelled", tone: "neutral" },
  failed: { label: "Didn't send", tone: "danger" },
  expired: { label: "Expired", tone: "neutral" },
};

export function sendOfferSurface(s: SendOfferCardInput, t: T): A2uiMessage[] {
  const surfaceId = `ainmem-send-${s.view}-${s.offerId}`;
  const ctx = { offer_id: s.offerId };
  const vars = { who: s.who, amount: s.amount };
  // the email is for the asker to check who this is; everyone else sees the name and photo
  const sub = !s.inWorkspace ? t("{who} isn't in this workspace yet", vars) : s.canAct ? (s.email ?? t("No email on their account")) : null;
  const person = (big: boolean): A2uiComponent[] => [
    row("person", ["photo", "person_text"]),
    { id: "photo", component: "Image", url: s.photoUrl ?? "", variant: big ? "avatar" : "smallAvatar", fallback: s.initials },
    column("person_text", sub ? ["person_name", "person_sub"] : ["person_name"]),
    text("person_name", s.who, "h4"),
    ...(sub ? [text("person_sub", sub, "caption")] : []),
  ];
  const root: string[] = [];
  const comps: A2uiComponent[] = [];

  if (s.view === "check") {
    const state = s.checkState ?? "asking";
    root.push("person", "amount", "question");
    comps.push(...person(true), text("amount", t("{amount} USDC", vars), "h3"), text("question", t("Is this {who}?", vars), "body"));
    if (state === "yes") {
      root.push("answer");
      comps.push(chip("answer", t("Yes — it's {who}", vars), "success", "check"));
    } else if (state === "no") {
      root.push("answer");
      comps.push(chip("answer", t("No — nothing was sent"), "neutral"));
    } else if (state === "expired" || state === "changed") {
      root.push("answer");
      comps.push(text("answer", state === "changed" ? t(SEND_FAIL_TEXT["address-changed"], vars) : t("This question expired. Ask me again."), "caption"));
    } else if (s.canAct) {
      root.push("divider", "answers");
      comps.push(
        { id: "divider", component: "Divider" },
        row("answers", ["yes", "no"]),
        button("yes", "yes_label", SEND_ANSWER_ACTION, { ...ctx, answer: "yes" }, "primary"),
        text("yes_label", t("Yes")),
        button("no", "no_label", SEND_ANSWER_ACTION, { ...ctx, answer: "no" }),
        text("no_label", t("No"))
      );
    } else {
      root.push("only");
      comps.push(text("only", t("Only {name} can answer this.", { name: s.askerName }), "caption"));
    }
  } else {
    const state = s.sendState ?? "ready";
    const chipOf = SEND_CHIP[state];
    root.push("head", "person");
    comps.push(
      row("head", ["title", "state"], "spaceBetween"),
      text("title", t("Send {amount} USDC to {who}", vars), "h4"),
      chip("state", t(chipOf.label), chipOf.tone),
      ...person(false)
    );
    const note =
      state === "waiting"
        ? t("Confirm it in MetaMask.")
        : state === "sent"
          ? s.failReason
            ? t(SEND_FAIL_TEXT[s.failReason] ?? SEND_FAIL_TEXT.unconfirmed, vars)
            : t("Sent from your wallet. Waiting for the network to confirm it…")
          : state === "done"
            ? t("Sent {amount} USDC to {who}.", vars)
            : state === "cancelled"
              ? t("You cancelled it in MetaMask. Nothing was sent.")
              : state === "failed"
                ? t(SEND_FAIL_TEXT[s.failReason ?? "failed"] ?? SEND_FAIL_TEXT.failed, vars)
                : state === "expired"
                  ? t("This expired before it was sent. Ask me again.")
                  : s.failReason
                    ? t(SEND_FAIL_TEXT[s.failReason] ?? SEND_FAIL_TEXT.failed, vars)
                    : null;
    if (note) {
      root.push("note");
      comps.push(text("note", note, state === "done" ? "body" : "caption"));
    }
    // a failure the asker can fix (another account, a network hiccup) offers Send again;
    // one that needs a new question (the wallet changed, it moved USDC differently) does not
    const retry = state === "cancelled" || (state === "failed" && !["address-changed", "different"].includes(s.failReason ?? ""));
    const buttons: string[] = [];
    if (s.canAct && (state === "ready" || retry)) {
      buttons.push("go");
      comps.push(button("go", "go_label", SEND_GO_ACTION, ctx, "primary"), text("go_label", state === "ready" ? t("Send") : t("Send again")));
    }
    if (s.canAct && state === "sent") {
      buttons.push("recheck");
      comps.push(button("recheck", "recheck_label", SEND_RECHECK_ACTION, ctx), text("recheck_label", t("Check again")));
    }
    if ((state === "sent" || state === "done" || state === "failed") && s.explorerUrl) {
      buttons.push("explorer");
      comps.push(button("explorer", "explorer_label", SEND_EXPLORER_ACTION, { url: s.explorerUrl }), text("explorer_label", t("View on Etherscan")));
    }
    if (buttons.length) {
      root.push("divider", "buttons");
      comps.push({ id: "divider", component: "Divider" }, row("buttons", buttons));
    }
    if (!s.canAct && (state === "ready" || retry)) {
      root.push("only");
      comps.push(text("only", t("Only {name} can send this.", { name: s.askerName }), "caption"));
    }
  }

  comps.unshift(column("root", root));
  return [
    { version: A2UI_VERSION, createSurface: { surfaceId, catalogId: A2UI_BASIC_CATALOG } },
    { version: A2UI_VERSION, updateComponents: { surfaceId, components: comps } },
    {
      version: A2UI_VERSION,
      updateDataModel: {
        surfaceId,
        path: "/",
        value: {
          offer_id: s.offerId,
          view: s.view,
          state: s.view === "check" ? (s.checkState ?? "asking") : (s.sendState ?? "ready"),
          ...(s.canAct && s.token ? { token: s.token } : {}),
        },
      },
    },
  ];
}
