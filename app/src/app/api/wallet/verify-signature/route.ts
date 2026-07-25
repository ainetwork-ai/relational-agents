import { NextRequest, NextResponse } from "next/server";
import { recoverSigner, verifySignedMessage } from "@/lib/wallet/verify";

export const dynamic = "force-dynamic";

/**
 * POST /api/wallet/verify-signature
 * body: { message: string, signature: string, address?: string }
 * → { valid: boolean, signer: string | null }
 *
 * Stateless signature check — pure crypto, no session, no DB, no side effects.
 * It answers "did this address sign this string?" and nothing more.
 *
 * A real flow must NOT rely on this alone: it has no nonce, so a replayed
 * (message, signature) pair verifies forever. Bind a server-issued nonce into
 * the message (see @/lib/wallet/message) and verify inside the endpoint that
 * actually grants something — /api/auth/metamask-verify is the existing
 * example of that pattern.
 */
export async function POST(req: NextRequest) {
  try {
    const { message, signature, address } = await req.json();

    if (typeof message !== "string" || typeof signature !== "string") {
      return NextResponse.json(
        { error: "message and signature are required" },
        { status: 400 }
      );
    }

    const signer = await recoverSigner(message, signature);

    if (typeof address === "string") {
      const valid = await verifySignedMessage({ message, signature, address });
      return NextResponse.json({ valid, signer });
    }

    return NextResponse.json({ valid: signer !== null, signer });
  } catch (err) {
    return NextResponse.json(
      { error: "Internal server error", details: String(err) },
      { status: 500 }
    );
  }
}
