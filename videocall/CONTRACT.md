# videocall ↔ notion 접점 계약 (In-App Video Call)

notion 앱 플랜(4-태스크: send/receive/layout/STT→record)과 videocall 영역의 유일한 접점은
**STT 훅 인터페이스**다. 나머지는 notion 쪽 구현이며, videocall은 검증된 스니펫과 모듈을 공급한다.

## 1. STT 훅 인터페이스 (합의 필요 — 유일한 접점)

```ts
const { interim, supported, error } = useSpeechTranscript({
  enabled: boolean,          // 콜이 active일 때만 true
  lang?: string,             // 기본 "en-US" (파일 상단 STT_LANG 상수)
  onFinal: (text: string) => void,  // 확정 발화 (≥2자, trim됨)
});
// interim: 현재 부분 가설 (이탤릭 표시용, 확정되면 "")
// supported: 엔진 사용 가능 여부 (Azure: env 키 존재 여부)
// error: 마지막 에러 메시지 | null
```

onFinal의 목적지는 채팅이 아니다: 발화는 `POST /api/calls/{roomId}/utterance`로
통화 전용 저장소에 쌓이고 **에이전트만 읽는다** (통화 중 귀띔 + 종료 후 한 항목 요약).
🎙 채팅 메시지 시절의 접두 규약은 폐기되었다.

Web Speech 버전(`use-speech-transcript.ts`)을 이 시그니처로 작성해 주면, Azure 버전
(`videocall/web/use-azure-transcript.ts`)과 **import 한 줄 교체**로 스왑 가능하다.

**현재 엔진 상태 (2026-07-25)**: Web Speech, 단 **기본 비활성** —
`NEXT_PUBLIC_CALL_WEB_SPEECH=1`일 때만 캡처한다. Web Speech는 무음마다 인식을
끊고 재시작하는데 그때마다 마이크 캡처가 놓였다 잡혀 **브라우저 마이크 표시등이
통화 내내 깜빡이기 때문**이다 (Azure는 continuous 유지라 이 문제가 없다).
엔진 결정: Azure 키 미보유로 당분간 Web Speech(플래그 활성 시)로 가고, 추후
외부 STT 전달 API가 오면 그쪽으로 교체한다 — 키 확보 시 Azure 스왑도 무방.

## 2. Azure 버전 사용법 (notion 쪽 작업 2줄 + env)

1. `pnpm add microsoft-cognitiveservices-speech-sdk`
2. `videocall/web/use-azure-transcript.ts` + `videocall/web/azure-transcript.js`를
   `app/src/hooks/`에 복사 (또는 상대경로 import)
3. `.env.local`:
   ```
   NEXT_PUBLIC_AZURE_SPEECH_KEY=...     # 커밋 금지
   NEXT_PUBLIC_AZURE_SPEECH_REGION=...  # e.g. eastus
   ```
   클라이언트 직연동(데모 전용) — 키가 번들에 노출되므로 로컬 데모에서만.

Web Speech 대비: Chrome 전용 제약 없음, 무음 자동종료/재시작 루프 불필요(continuous 유지),
인식 품질 우수. 에코(상대 음성이 내 마이크에 잡힘)는 엔진 무관 — 헤드폰 필수.

## 3. 제공 모듈

| 파일 | 용도 |
|---|---|
| `videocall/web/azure-transcript.js` | 프레임워크 무관 STT 코어 (CDN `window.SpeechSDK` 또는 npm sdk 주입) |
| `videocall/web/use-azure-transcript.ts` | 위 계약 시그니처의 React 훅 (notion 복사용) |
| `videocall/web/ringtone.js` | `startRingtone()/stopRingtone(handle)` — IncomingCallHost용, index.html에서 추출 |
| `videocall/public/test.html` | WebRTC P2P + STT 독립 검증 하네스 (아래) |

## 4. 테스트 하네스 (notion 없이 미디어·STT 검증)

```
cd videocall && node server.mjs   # :3111
```
Chrome 프로필 2개로 `http://localhost:3111/test.html` 열고:
탭 A "Start as Caller", 탭 B "Start as Callee" → non-trickle offer/answer 교환
(`/api/rtc/<room>` in-memory, notion 플랜과 동일한 gatherComplete 2s cap 로직) →
상대 영상 풀 + 로컬 PiP 우하단. STT는 키/리전 입력(localStorage 저장) 후 Start STT.
검증된 스니펫(gatherComplete, pc 셋업, STT 배선)은 CallView 구현 시 그대로 참고 가능.

## 5. 데모 촬영 체크리스트

- [ ] 양쪽 모두 **헤드폰 착용 — 녹화 필수 조건.** 음질이 아니라 **화자 귀속 정확성**
      문제다: 각자 자기 마이크만 전사하므로 발화자 = 세션 사용자로 확정하는데,
      헤드폰 없이 상대 목소리가 내 마이크에 잡히면 내가 말한 것으로 기록된다 →
      귀띔이 엉뚱한 사람에게 가고 관계 문서의 화자도 틀린다
- [ ] 발신자 얼굴이 풀샷, 내 얼굴은 우하단 PiP
- [ ] 수신 탭(B)은 촬영 전 한 번 클릭 (AudioContext suspended → 링톤 무음 방지)
- [ ] `.env.local`에 `AI_URL` 없음 확인 (fakeEdits 결정적 append 경로 유지)
- [ ] Azure 키/리전 env 설정 확인, `supported === true`
- [ ] chrome://webrtc-internals 에 P2P 1쌍
