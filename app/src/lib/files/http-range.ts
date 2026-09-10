/**
 * `Range: bytes=…` 파싱 — 저장소 부분 읽기(`streamFile(bucket, key, range)`)의 입력을 만든다.
 *
 * 왜 필요한가: `<video>` 의 탐색(seek)과 iOS Safari 의 재생이 **206 Partial Content 를 전제**한다.
 * 200 으로 전체를 주면 사파리는 재생 자체를 거부하고, 다른 브라우저도 탐색이 안 된다.
 * 우리 `lib/files/storage.ts` 의 `streamFile` 은 처음부터 range 를 받았는데 어떤 라우트도
 * 넘기지 않았다(측정: `docs/notion-video.md` §4).
 *
 * ainteams `backend/src/domain/shared/http-range.ts` 에서 가져왔다. 그쪽 주석의 경고를 그대로
 * 옮긴다 — **사본은 반드시 갈라진다.** 문법을 손볼 일이 생기면 두 곳을 같이 본다.
 */

export interface ByteRange {
  /** inclusive */
  start: number;
  /** inclusive */
  end: number;
}

/**
 * RFC 7233 §2.1 의 단일 byte-range. **suffix 형(`bytes=-N`, 마지막 N 바이트)을 포함한다.**
 *
 * 반환 세 가지의 뜻이 다르다:
 *   - `ByteRange` — 그 구간으로 **206**.
 *   - `"unsatisfiable"` — 문법은 맞는데 만족 불가 → **416**.
 *   - `null` — 못 알아본 형식(다중 구간 등)이거나 헤더 없음 → **200 전체**.
 *
 * `null` 과 `"unsatisfiable"` 을 가르는 이유: 해석조차 못 한 요청에 416 을 주면 재생이 아예
 * 안 되지만, 전체를 주면 느릴 뿐 동작한다. 반대로 문법이 맞는데 범위가 파일 밖이면 그건
 * 클라이언트가 알아야 하는 오류다.
 *
 * suffix 를 지원하는 이유: mp4/mov 는 컨테이너 메타(`moov`)가 파일 **뒤**에 있어 플레이어가
 * `bytes=-65536` 으로 먼저 훑는다. 미지원으로 두면 그 요청마다 파일 **전체**가 나간다 —
 * Range 를 만든 목적과 정반대로 조용히 비싸진다.
 */
export function parseByteRange(
  header: string | null | undefined,
  totalSize: number
): ByteRange | "unsatisfiable" | null {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return null; // 다중 구간 등 미지원 형식 → 전체를 준다
  const [, rawStart, rawEnd] = m;
  if (rawStart === "" && rawEnd === "") return "unsatisfiable"; // `bytes=-`
  if (!Number.isFinite(totalSize) || totalSize <= 0) return "unsatisfiable";

  let start: number;
  let end: number;
  if (rawStart === "") {
    const n = Number(rawEnd);
    if (n === 0) return "unsatisfiable";
    start = Math.max(0, totalSize - n);
    end = totalSize - 1;
  } else {
    start = Number(rawStart);
    if (start >= totalSize) return "unsatisfiable";
    end = rawEnd === "" ? totalSize - 1 : Number(rawEnd);
    if (end < start) return "unsatisfiable";
  }

  return { start, end: Math.min(end, totalSize - 1) };
}

/** 416 에 실어야 하는 `Content-Range: bytes * /<total>`. */
export function unsatisfiableContentRange(totalSize: number): string {
  return `bytes */${Math.max(0, totalSize)}`;
}
