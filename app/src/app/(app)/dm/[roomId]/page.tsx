import { DmView } from "./dm-view";

export const dynamic = "force-dynamic";

export default async function DmPage({ params }: { params: Promise<{ roomId: string }> }) {
  const { roomId } = await params;
  return <DmView roomId={roomId} />;
}
