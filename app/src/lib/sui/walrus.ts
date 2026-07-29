/**
 * Walrus — where a relationship's memories actually live.
 *
 * Today the pipeline writes markdown and photos to a folder on one server
 * (`app/src/lib/okf-store.ts`), which means a backup, a stray `cat`, or a
 * compromised host hands over everyone's memories at once. On Walrus the bytes
 * are content-addressed and spread across storage nodes, and — paired with
 * `seal.ts` — what we hand over is ciphertext.
 *
 * This module deliberately speaks the Walrus HTTP publisher/aggregator protocol
 * rather than pulling in `@mysten/walrus`: the same two functions then work in
 * the browser, in a route handler, and in `sui/scripts/walrus-seal.mjs`, with no
 * WAL-token plumbing in the request path.
 */

export interface WalrusEndpoints {
  publisher: string;
  aggregator: string;
}

export const WALRUS_TESTNET: WalrusEndpoints = {
  publisher: "https://publisher.walrus-testnet.walrus.space",
  aggregator: "https://aggregator.walrus-testnet.walrus.space",
};

export function walrusEndpoints(): WalrusEndpoints {
  return {
    publisher: process.env.WALRUS_PUBLISHER_URL ?? WALRUS_TESTNET.publisher,
    aggregator:
      process.env.NEXT_PUBLIC_WALRUS_AGGREGATOR_URL ??
      process.env.WALRUS_AGGREGATOR_URL ??
      WALRUS_TESTNET.aggregator,
  };
}

export interface PutBlobOptions {
  /** How many Walrus epochs to pay for. The demo keeps blobs well past judging. */
  epochs?: number;
  endpoints?: WalrusEndpoints;
}

/** Public URL for a blob — safe to put in a receipt, since the bytes are sealed. */
export function walrusBlobUrl(blobId: string, endpoints = walrusEndpoints()): string {
  return `${endpoints.aggregator}/v1/blobs/${blobId}`;
}

/**
 * Store bytes and return the Walrus blob id. The id is what goes on chain via
 * `add_memory` — the bytes never do.
 */
export async function putBlob(bytes: Uint8Array, options: PutBlobOptions = {}): Promise<string> {
  const { epochs = 5, endpoints = walrusEndpoints() } = options;
  const res = await fetch(`${endpoints.publisher}/v1/blobs?epochs=${epochs}`, {
    method: "PUT",
    body: bytes as unknown as BodyInit,
  });
  if (!res.ok) {
    throw new Error(`walrus publisher refused the blob (${res.status}): ${await res.text()}`);
  }
  const body = (await res.json()) as WalrusPutResponse;
  // Walrus answers differently depending on whether these exact bytes were
  // already stored by someone else — same blob id either way, since it is a
  // hash of the content.
  const blobId = body.newlyCreated?.blobObject?.blobId ?? body.alreadyCertified?.blobId;
  if (!blobId) throw new Error(`walrus publisher returned no blobId: ${JSON.stringify(body)}`);
  return blobId;
}

/** Read the bytes back. Byte-identical to what `putBlob` was given. */
export async function getBlob(blobId: string, endpoints = walrusEndpoints()): Promise<Uint8Array> {
  const res = await fetch(walrusBlobUrl(blobId, endpoints));
  if (!res.ok) throw new Error(`walrus aggregator has no blob ${blobId} (${res.status})`);
  return new Uint8Array(await res.arrayBuffer());
}

interface WalrusPutResponse {
  newlyCreated?: { blobObject?: { blobId?: string } };
  alreadyCertified?: { blobId?: string };
}
