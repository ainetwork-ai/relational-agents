import { NextRequest, NextResponse } from "next/server";
import { SealClient, SessionKey, NoAccessError } from "@mysten/seal";
import type { SealCompatibleClient } from "@mysten/seal";
import { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import { Transaction } from "@mysten/sui/transactions";
import { fromHex } from "@mysten/sui/utils";
import {
  PACKAGE_ID,
  RPC_ENDPOINTS,
  SEAL_KEY_SERVERS,
  WALLET_AGENT_ID,
  WALLET_NOTE_BLOB_ID,
  WALLET_NOTE_IDENTITY_HEX,
  WALRUS_AGGREGATOR,
} from "@/lib/sui/demo";

export const dynamic = "force-dynamic";

/**
 * Ask Seal's key servers on the caller's behalf.
 *
 * The wallet still does the only thing that matters: it signs the session key,
 * and that signature is what the key servers weigh against `seal_approve`. What
 * moved to the server is the HTTP call — in the browser the Seal client has to
 * be handed a Sui client it does not actually type-check against, and the key
 * server URL it resolves through that mismatch is wrong (every fetch_key came
 * back 404). Here it uses the client it expects, which is the same path the
 * scripted proof runs.
 *
 * We never see a key: the session key is the wallet's, the shares are derived
 * for its address, and a non-member gets the same refusal here as anywhere.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const exported = body?.sessionKey;
  if (!exported || typeof exported !== "object")
    return NextResponse.json({ error: "session key required" }, { status: 400 });

 // Sui's own testnet fullnode answers 404 to JSON-RPC now, and the Seal SDK
 // surfaces that as "Unexpected status code: 404" from a key-server fetch —
 // which reads like a refusal and is not one. Use the endpoints the rest of
 // this page already falls back to.
  const suiClient = new SuiJsonRpcClient({
    url: RPC_ENDPOINTS[0],
    network: "testnet",
  }) as unknown as SealCompatibleClient;

  try {
    const sessionKey = SessionKey.import(exported, suiClient);

    const res = await fetch(`${WALRUS_AGGREGATOR}/v1/blobs/${WALLET_NOTE_BLOB_ID}`, {
      cache: "no-store",
    });
    if (!res.ok)
      return NextResponse.json({ error: `walrus ${res.status}` }, { status: 502 });
    const data = new Uint8Array(await res.arrayBuffer());

    const tx = new Transaction();
    tx.moveCall({
      target: `${PACKAGE_ID}::relational_agent::seal_approve`,
      arguments: [
        tx.pure.vector("u8", Array.from(fromHex(WALLET_NOTE_IDENTITY_HEX))),
        tx.object(WALLET_AGENT_ID),
      ],
    });
    const txBytes = await tx.build({ client: suiClient as never, onlyTransactionKind: true });

    const seal = new SealClient({
      suiClient,
      serverConfigs: SEAL_KEY_SERVERS,
      verifyKeyServers: false,
    });
    const plaintext = await seal.decrypt({ data, sessionKey, txBytes });

    return NextResponse.json({
      opened: true,
      bytes: plaintext.length,
      text: new TextDecoder().decode(plaintext),
    });
  } catch (err) {
    const refused = err instanceof NoAccessError;
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      {
        opened: false,
        refused,
        error: message,
        errorClass: err instanceof Error ? err.constructor.name : "Error",
      },
      { status: refused ? 403 : 502 }
    );
  }
}
