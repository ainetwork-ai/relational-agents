import { NextResponse } from "next/server";
import { getTusServer, sweepStaging, TUS_EXPIRATION_MS } from "@/lib/files/tus-server";

export const dynamic = "force-dynamic";

/**
 * POST → clears out expired tus uploads in progress.
 *
 * A resumable upload leaves its pieces behind when interrupted — that is the price of
 * resuming. The expiry (24h) was set with `TUS_EXPIRATION_MS`, but **nobody was cleaning up.**
 * It was the part missed when tus came in; left alone, the staging directory grows with every
 * failed upload.
 *
 * Auth: the `CRON_SECRET` header. A shared secret rather than a session, because the caller is
 * cron, not a person. **With no secret configured it refuses** — better that nobody can call it
 * than that a deployment missing the setting is open to anyone.
 *
 *   0 * * * * curl -fsS -X POST -H "x-cron-secret: …" https://…/api/cron/cleanup
 */
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (req.headers.get("x-cron-secret") !== secret)
    return NextResponse.json({ error: "Not found" }, { status: 404 });

  const expiredTusUploads = await getTusServer()
    .cleanUpExpiredUploads()
    .catch((e: unknown) => {
     // a failed cleanup could turn cron red, but the next hourly run will just try again
      console.error("[cron/cleanup] failed to clean up tus uploads in progress:", e);
      return -1;
    });

  // Shapes the library's collector can't see — sidecars left unpaired because finalize
  // moved their data file — we sweep by age. The cause was fixed on the finalize side; this
  // is the net for what piled up before that and anything that still slips through.
  const sweptOrphans = await sweepStaging().catch(() => -1);

  return NextResponse.json({
    expiredTusUploads,
    sweptOrphans,
    expiryHours: TUS_EXPIRATION_MS / 3_600_000,
  });
}
