import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { generateChallenge } from "@/lib/auth/ain-verify";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  const { nonce, message } = generateChallenge();
  session.challenge = nonce;
  await session.save();
  return NextResponse.json({ nonce, message });
}
