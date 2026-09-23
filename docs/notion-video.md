# 동영상 — 노션 측정과 ainteams 대조 (2026-09-10)

comcom: "동영상 기능 노션은 어떤지 측정하고, ainteams에서는 동영상 어떻게 하고 있는지 파악하고
동영상 업로드 가능하도록 기능 추가하고 싶어."

노션 쪽은 **내가 만든 페이지**에서 재고 그 페이지를 휴지통으로 보냈다(측정 스크립트 `mv*.mjs`,
원자료 `n-video-*.jsonl`). 실제 동영상 파일은 **올리지 않았다** — 회사 노션에 측정용 바이트를
남기지 않기 위해서다. 그래서 §3(재생기)은 노션이 아니라 **ainteams 의 완성된 구현**이 기준이다.

## 0. 잴 때 밟은 함정 (다음 사람용)

- **공용 스크래치 페이지에서 재면 안 된다.** 다른 세션이 같은 페이지에서 인용·코드 블록을
  재고 있었고, 내 `/비디오` 가 그쪽 코드 블록에 들어가 `왜` 가 `왜/비디오` 가 됐다(네 글자만
  정확히 지워 되돌렸다). 측정은 **내가 만든 페이지**에서 하고 끝나면 그 페이지를 지운다.
- 새 페이지는 사이드바 좌상단 `새 페이지`(aria-label) → 오버레이의 **`페이지`** 항목으로 만든다.
  버튼만 누르면 `페이지 / 채팅 / AI 노트 / 데이터베이스` 오버레이가 뜰 뿐 페이지는 안 생긴다.
  **URL 이 바뀐 것을 확인하기 전에는 한 글자도 치지 말 것.**
- 제목 요소는 `[contenteditable="true"]` 중 **`placeholder="새 페이지"`** 인 것 하나뿐이다.
  `closest('.notion-page-block')` 같은 조건을 곁들이면 페이지 전체 래퍼가 먼저 잡혀서
  타이핑이 엉뚱한 데로 간다.
- 페이지 삭제는 상단 오른쪽 끝 **`aria-label="작업"`** 버튼 → `휴지통으로 이동`.

## 1. 블록을 만드는 길

`/` 메뉴에서 **`동영상`** (행 316 × 32). 고르면 빈 동영상 블록이 생긴다.

| 부분 | 값 |
|---|---|
| 블록 | `notion-video-block`, 720 × **65**, 배경 없음, radius 0 |
| 안쪽 띠(누르는 곳) | 704 × **49**, 좌우 **8** 안쪽 |
| 문구 | **`동영상 임베드 또는 업로드`**, **16px** / 400 / rgb(44,44,43) |

## 2. 업로드 팝오버

띠를 누르면 뜬다. 카드 **300 폭**, radius **10px**, 흰 배경 — 그림자는 멘션 메뉴와 **같은 3겹**
(`docs/notion-comment-mention.md` §3).

| 탭 | 카드 높이 |
|---|---|
| **업로드** | 300 × **106** |
| **링크** | 300 × **161** |

| 부분 | 위치(카드 기준) | 크기 | 타이포 |
|---|---|---|---|
| 탭 `업로드` | dx **8**, dy **6** | 52 × 28 | 14px / 400 |
| 탭 `링크` | dx **60**, dy 6 | 40 × 28 | 14px / 400 |
| 선택된 탭 글자색 | — | — | rgb(44,44,43) |
| 안 선택된 탭 글자색 | — | — | rgb(142,139,134) |
| 업로드 탭의 기본 버튼 `동영상을 선택하세요` | dx **24**, dy **56** | **252 × 28** | 14px / **500**, 글자 rgb(243,249,253) (파란 채움 위) |
| 링크 탭의 기본 버튼 `동영상 임베드` | dx **12**, dy **96** | **276 × 28** | 14px / 500, 같은 글자색 |

즉 노션은 **업로드와 링크 임베드를 한 팝오버의 두 탭**으로 둔다. 우리 동영상 블록은 지금
**URL 입력칸 하나뿐**이라 업로드 탭 자체가 없다.

**못 잰 것**: 파일당 용량 안내 문구, 파일 선택창의 `accept` 목록, 드래그&드롭·붙여넣기 동작,
그리고 **올라간 뒤의 재생기**. 전부 실제 파일을 회사 노션에 올려야 나오는 것이라 하지 않았다.

## 3. 재생기 — 기준은 ainteams (이미 완성돼 있다)

ainteams 는 동영상이 **끝난 기능**이다. 노션을 흉내내기보다 우리 조직이 이미 검증한 이 구현을
따르는 게 맞다.

`web/src/components/chat/MessageFileCard.tsx`:

```tsx
<video
  src={streamSrc}
  controls
  preload="metadata"   // 바디를 미리 안 받고 duration 만. autoplay X
  playsInline
  aria-label={fileName}
  onError={() => setMediaBroken(true)}
  className="w-full aspect-video object-contain rounded-md bg-scrim"
/>
```

- `aspect-video` 로 16:9 를 미리 잡아 **레이아웃 점프를 막는다**. 세로 영상은 `object-contain`
  + 어두운 바탕으로 레터박스.
- 재생 실패하면 "재생할 수 없음" 카드 + 내려받기 버튼으로 떨어진다.
- **플레이어 라이브러리 없음.** 순수 HTML5 요소다.

## 4. ainteams 의 업로드·서빙 (우리가 이미 포팅한 것과 안 한 것)

| 항목 | ainteams | ainmem(우리) |
|---|---|---|
| 업로드 | tus 재개형(`/api/upload/tus`), 8MB 청크, 상한 **1GB** | **있다** — `uploadResumable` 까지 포팅됨 |
| 허용 확장자 | `mp4, mov, webm, m4v` + `video/` 접두 | **있다** (`lib/files/allowed-types.ts`) |
| 저장 | MinIO, 키 = 내용 **SHA-256** (`files/<sha>.<ext>`) | 있다 (버킷 `ainmem-files`) |
| 바이트 서빙 | **Range/206 지원** — `<video>` 탐색과 iOS Safari 재생의 전제 | **없다** ← 이게 핵심 구멍 |
| MIME 복구 | `mime_type` 이 비면 확장자로 `video/mp4` 등을 되살림 | **없다** — `octet-stream` + `nosniff` 라 재생 거부 |
| 썸네일·duration·트랜스코딩 | **없음**(ffmpeg 아예 없음) | 없음 |

`lib/files/storage.ts` 의 `streamFile(bucket, key, range)` 는 **이미 부분 읽기를 받는데
아무 라우트도 range 를 넘기지 않는다.** `api/files/[id]/stream/route.ts` 는 요청 객체를
`_req` 로 받아 아예 보지 않는다.

## 5. 그래서 할 일 (의존 순서)

1. **Range/206** — `api/files/[id]/stream`, `api/files/key/[...key]`, `/uploads/[name]`,
   `api/okf/asset`. ainteams 의 `backend/src/domain/shared/http-range.ts` 파서를 가져온다.
   이게 없으면 동영상이 **탐색이 안 되고 iOS 에서는 아예 안 뜬다**.
2. **MIME 복구** — `mime_type` 이 null 일 때 확장자로 되살리기(`streamable-media.ts`).
3. **동영상 블록에 업로드 붙이기** — 지금은 URL 칸뿐이다. 노션처럼 `업로드 / 링크` 두 탭을
   두고, 업로드는 큰 파일이라 `uploadBlob` 이 아니라 **`uploadResumable`(tus)** 을 쓴다.
   (`uploadBlob(file)` 은 `kind` 가 없으면 이미지 MIME 만 받아 415 로 거절한다.)
4. **떨어뜨리기·붙여넣기** — `block-editor.tsx` 의 드롭·붙여넣기가 `image/` 로만 걸러진다.
5. **재생기를 §3 대로** — 지금 `<video controls>` 뿐이라 `preload`·`playsInline`·비율 예약·
   실패 대체가 없다. 파일 판정 정규식 `/\.(mp4|webm|ogg)/` 도 허용 목록의 `.mov`·`.m4v` 를
   빠뜨려 그것들이 `<iframe>` 으로 샌다.
6. **댓글 첨부의 동영상** — 업로드·저장은 이미 되는데 렌더가 파일명 정규식(`IMAGE`)뿐이라
   **내려받기 링크로 떨어진다**. `<video>` 분기를 준다.
7. **검사** — `app/e2e` 88개 중 `video`/`mp4` 를 언급하는 파일이 **하나도 없다**.
   Range 응답(206·`Content-Range`·416)을 재는 검사를 새로 둔다.

곁가지로 확인된 것: `okf-store.ts` 의 `rewriteAssetBlocks` 는 주석에 "image/video" 라고
써 놓고 `b.type !== "image"` 로 걷어낸다. `app/src/app/uploads/[name]/route.ts` 는 MIME 표에
동영상이 없고 파일을 통째로 메모리에 읽는다.
