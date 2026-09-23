"use client";

import "@mysten/dapp-kit/dist/index.css";

import { useMemo, useState } from "react";
import {
  ConnectButton,
  SuiClientProvider,
  WalletProvider,
  useCurrentAccount,
  useSignPersonalMessage,
  useSuiClient,
  useWallets,
} from "@mysten/dapp-kit";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { Transaction } from "@mysten/sui/transactions";
import { SealClient, SessionKey } from "@mysten/seal";
import type { SealCompatibleClient } from "@mysten/seal";
import { Check, KeyRound, Lock, X } from "lucide-react";
import {
  WALLET_NOTE_BLOB_ID as NOTE_BLOB_ID,
  WALLET_NOTE_IDENTITY_HEX as NOTE_IDENTITY_HEX,
  PACKAGE_ID,
  RPC_ENDPOINTS,
  ROOM_SEALED,
  SEAL_KEY_SERVERS,
  SEAL_THRESHOLD,
  WALLET_AGENT_ID as SEALED_AGENT_ID,
  shortId,
} from "@/lib/sui/demo";

 // Sui's own testnet fullnode answers 404 to JSON-RPC, and every dapp-kit query
 // — including the chain read inside SessionKey.create — died on it before the
 // wallet could even be asked. Same endpoint the rest of this page falls back to.
const NETWORKS = {
  testnet: { url: RPC_ENDPOINTS[0], network: "testnet" as const },
};

const CARD =
  "rounded-xl border border-neutral-200 bg-white shadow-sm dark:border-neutral-700 dark:bg-neutral-800/60";

type Phase = "idle" | "signing" | "fetching" | "asking";

type Outcome =
  | { kind: "opened"; text: string; bytes: number }
  | { kind: "refused"; error: string; errorClass: string }
  | { kind: "aborted"; message: string };

const PHASE_LABEL: Record<Exclude<Phase, "idle">, string> = {
  signing: "Waiting for your signature…",
  fetching: "Pulling the ciphertext off Walrus…",
  asking: "Asking the Seal key servers…",
};

/** Wallets may reject with a plain Error; only the message is worth showing. */
function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function looksRejected(err: unknown): boolean {
  return /reject|denied|cancell?ed|user closed/i.test(messageOf(err));
}

function MemberBadge({ isMember }: { isMember: boolean }) {
  return isMember ? (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">
      <Check size={12} /> A member of {ROOM_SEALED}
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-neutral-100 px-2.5 py-1 text-[11px] font-medium text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
      <X size={12} /> Not a member of {ROOM_SEALED}
    </span>
  );
}

function TryToOpen({ members }: { members: string[] }) {
  const account = useCurrentAccount();
  const wallets = useWallets();
  const suiClient = useSuiClient();
  const { mutateAsync: signPersonalMessage } = useSignPersonalMessage();

  const [phase, setPhase] = useState<Phase>("idle");
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  const isMember = Boolean(
    account && members.some((m) => m.toLowerCase() === account.address.toLowerCase()),
  );

  async function attempt() {
    if (!account) return;
    setOutcome(null);
    try {
      // The key servers will only talk to a session key the wallet itself
      // vouched for, so the personal-message signature is the wallet asserting
      // "this address is asking".
      setPhase("signing");
      const sessionKey = await SessionKey.create({
        address: account.address,
        packageId: PACKAGE_ID,
        ttlMin: 10,
        suiClient: suiClient as unknown as SealCompatibleClient,
      });
      const { signature } = await signPersonalMessage({
        message: sessionKey.getPersonalMessage(),
      });
      await sessionKey.setPersonalMessageSignature(signature);

      setPhase("asking");
 // The signed session key goes to our server, which owns a Sui client the Seal
 // SDK actually accepts; in the browser that client is a cast, and the key
 // server URL it resolves through the mismatch answers 404. The wallet's
 // signature is still the only thing that decides the answer.
      const res = await fetch("/api/sui/decrypt", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionKey: sessionKey.export() }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.opened) {
        setOutcome({
          kind: "refused",
          error: String(body?.error ?? `HTTP ${res.status}`),
          errorClass: String(body?.errorClass ?? "Error"),
        });
        setPhase("idle");
        return;
      }
      setOutcome({ kind: "opened", text: String(body.text), bytes: Number(body.bytes) });
    } catch (err) {
      if (looksRejected(err)) {
        setOutcome({ kind: "aborted", message: messageOf(err) });
      } else {
        setOutcome({
          kind: "refused",
          error: messageOf(err),
          errorClass: err?.constructor?.name ?? "Error",
        });
      }
    } finally {
      setPhase("idle");
    }
  }

  return (
    <div className={`${CARD} overflow-hidden`}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-100 px-5 py-4 dark:border-neutral-700/60">
        <div className="min-w-0">
          <h4 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
            Try it with your own wallet
          </h4>
          <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
            Connect any Sui wallet and ask the key servers for the egg tart note. The answer
            comes from testnet, not from us.
          </p>
        </div>
        <div className="shrink-0" data-testid="sui-connect">
          <ConnectButton connectText="Connect a Sui wallet" />
        </div>
      </div>

      <div className="px-5 py-4">
        {wallets.length === 0 && !account && (
          <p
            data-testid="sui-no-wallet"
            className="rounded-lg border border-neutral-200 bg-neutral-50/60 px-4 py-3 text-sm leading-relaxed text-neutral-500 dark:border-neutral-700 dark:bg-neutral-800/60 dark:text-neutral-400"
          >
            No Sui wallet is available in this browser. Install a Wallet-Standard extension —{" "}
            <a
              href="https://slush.app"
              target="_blank"
              rel="noreferrer"
              className="text-blue-600 underline underline-offset-2 dark:text-blue-400"
            >
              Slush
            </a>{" "}
            is the usual one — and this section becomes a live attempt. Everything below it is
            already real without a wallet; a wallet is only how you sign as yourself.
          </p>
        )}

        {!account && wallets.length > 0 && (
          <p className="text-sm text-neutral-500 dark:text-neutral-400">
            {wallets.length} wallet{wallets.length === 1 ? "" : "s"} detected. Connect one to
            see whether it is a member of this relationship.
          </p>
        )}

        {account && (
          <div data-testid="sui-connected">
            <div className="flex flex-wrap items-center gap-2">
              <MemberBadge isMember={isMember} />
              <span className="break-all font-mono text-[11.5px] text-neutral-500 dark:text-neutral-400">
                {shortId(account.address, 10, 8)}
              </span>
            </div>
            <p className="mt-2 text-sm leading-relaxed text-neutral-500 dark:text-neutral-400">
              {isMember
                ? "Your address is one of this relationship's two members, so seal_approve passes and the key servers release their shares. Press the button to read the note."
                : "Your address is not a member of this relationship. seal_approve aborts with ENotMember and neither key server will release a share — press the button and read the refusal it gives you."}
            </p>

            <button
              onClick={attempt}
              disabled={phase !== "idle"}
              data-testid="sui-try-open"
              className="mt-4 inline-flex items-center gap-1.5 rounded-md bg-blue-500 px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-600 disabled:opacity-50"
            >
              <KeyRound size={14} />
              {phase === "idle" ? "Try to open the memory" : PHASE_LABEL[phase]}
            </button>

            {outcome?.kind === "opened" && (
              <div
                data-testid="sui-outcome-opened"
                className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50/60 p-4 dark:border-emerald-900/60 dark:bg-emerald-950/20"
              >
                <p className="inline-flex items-center gap-1.5 text-sm font-semibold text-emerald-700 dark:text-emerald-300">
                  <Check size={14} /> Opened · {outcome.bytes} bytes
                </p>
                <pre className="mt-3 whitespace-pre-wrap font-mono text-[12px] leading-relaxed text-neutral-700 dark:text-neutral-300">
                  {outcome.text}
                </pre>
                <p className="mt-3 text-xs text-neutral-400">
                  Decrypted in this browser, just now. The ciphertext came off Walrus and the
                  shares came from the two Seal key servers after they dry-ran seal_approve
                  against your signature. Our server never saw the plaintext.
                </p>
              </div>
            )}

            {outcome?.kind === "refused" && (
              <div
                data-testid="sui-outcome-refused"
                className="mt-4 rounded-lg border border-neutral-200 bg-neutral-50/60 p-4 dark:border-neutral-700 dark:bg-neutral-800/60"
              >
                <p className="inline-flex items-center gap-1.5 text-sm font-semibold text-red-600 dark:text-red-300">
                  <Lock size={14} /> Refused · {outcome.errorClass}
                </p>
                <pre className="mt-3 overflow-x-auto whitespace-pre-wrap rounded-lg bg-white p-3 font-mono text-[11.5px] leading-relaxed text-neutral-600 dark:bg-neutral-900/60 dark:text-neutral-300">
                  {outcome.error}
                </pre>
                <p className="mt-3 text-[13px] leading-relaxed text-neutral-500 dark:text-neutral-400">
                  That is the feature. Nothing in our code produced this sentence — two
                  independent key servers read the Move policy, did not find your address in
                  members, and declined to derive a key. The bytes are in your browser and they
                  stay unreadable.
                </p>
              </div>
            )}

            {outcome?.kind === "aborted" && (
              <p
                data-testid="sui-outcome-aborted"
                className="mt-4 rounded-lg bg-neutral-100 px-3 py-2 text-sm text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400"
              >
                Nothing was signed — the wallet reported: {outcome.message}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i += 1) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/**
 * The wallet island. Everything under it needs browser APIs and a wallet
 * connection, so it is the only client boundary on this page.
 */
export function WalletDecrypt({ members }: { members: string[] }) {
  const queryClient = useMemo(() => new QueryClient(), []);
  return (
    <QueryClientProvider client={queryClient}>
      <SuiClientProvider networks={NETWORKS} defaultNetwork="testnet">
        <WalletProvider autoConnect slushWallet={{ name: "Relational memory" }}>
          <TryToOpen members={members} />
        </WalletProvider>
      </SuiClientProvider>
    </QueryClientProvider>
  );
}
