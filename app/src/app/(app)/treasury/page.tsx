import type { Metadata } from "next";
import { TreasuryOverview } from "@/components/treasury-app/overview/treasury-overview";

export const metadata: Metadata = { title: "Your treasuries" };

/** /treasury — every relation's treasury in one list (behind the ?treasury=v2 switch). */
export default function TreasuryIndexPage() {
  return <TreasuryOverview />;
}
