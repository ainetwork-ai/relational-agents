import type { Metadata } from "next";
import { TreasuryRoomShell } from "@/components/treasury-app/room/room-shell";

export const metadata: Metadata = { title: "Treasury" };

/** /treasury/[roomId]/* — one relation's treasury; the shell loads it once for all four tabs. */
export default async function TreasuryRoomLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ roomId: string }>;
}) {
  const { roomId } = await params;
  return <TreasuryRoomShell roomId={roomId}>{children}</TreasuryRoomShell>;
}
