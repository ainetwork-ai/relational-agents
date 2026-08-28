import { NextResponse } from "next/server";
import { getTusServer, sweepStaging, TUS_EXPIRATION_MS } from "@/lib/files/tus-server";

export const dynamic = "force-dynamic";

/**
 * POST → 만료된 tus 진행분을 치운다.
 *
 * 재개 가능 업로드는 중단되면 조각을 남긴다 — 그게 재개의 대가다. 만료(24h)는
 * `TUS_EXPIRATION_MS` 로 정해 뒀는데 **치우는 사람이 없었다.** tus 를 들여오면서 빠뜨린
 * 부분이고, 그냥 두면 실패한 업로드마다 스테이징 디렉터리가 자란다.
 *
 * 인증: `CRON_SECRET` 헤더. 세션이 아니라 공유 비밀인 이유는 부르는 쪽이 사람이 아니라
 * cron 이기 때문이다. **비밀이 설정돼 있지 않으면 거절한다** — 설정을 빠뜨린 배포에서
 * 아무나 부를 수 있게 열리는 편보다 아무도 못 부르는 편이 낫다.
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
     // 청소 실패가 cron 을 빨갛게 만들 이유는 있지만, 다음 시간에 다시 돌면 된다
      console.error("[cron/cleanup] tus 진행분 청소 실패:", e);
      return -1;
    });

  // 라이브러리 수집기가 볼 수 없는 모양 — finalize 가 데이터 파일을 옮겨 짝이 깨진
  // 사이드카 — 은 우리가 나이로 쓸어낸다. 원인은 finalize 쪽에서 막았고, 이건 그 전에
  // 쌓인 것과 혹시 놓친 것을 위한 그물이다.
  const sweptOrphans = await sweepStaging().catch(() => -1);

  return NextResponse.json({
    expiredTusUploads,
    sweptOrphans,
    expiryHours: TUS_EXPIRATION_MS / 3_600_000,
  });
}
