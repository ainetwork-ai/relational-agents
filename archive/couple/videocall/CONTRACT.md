# videocall ↔ notion Contract (In-App Video Call)

The only contact point between the notion app plan (4-task: send/receive/layout/STT→record) and
the videocall area is the **STT hook interface**. Everything else is notion-side implementation;
videocall supplies verified snippets and modules.

## 1. STT hook interface (needs agreement — the only contact point)

```ts
const { interim, supported, error } = useSpeechTranscript({
  enabled: boolean,          // true only while the call is active
  lang?: string,             // default "en-US" (STT_LANG constant at top of file)
  onFinal: (text: string) => void,  // finalized utterance (>=2 chars, trimmed)
});
// interim: current partial hypothesis (for italic display, "" once finalized)
// supported: whether the engine is available (Azure: whether the env key exists)
// error: last error message | null
```

onFinal's destination is not the chat: utterances pile up in a call-only store via
`POST /api/calls/{roomId}/utterance`, and **only the agent reads them** (a whisper during
the call + one summary item after it ends). 🎙 The chat-message prefix convention from the
old design has been dropped.

Write the Web Speech version (`use-speech-transcript.ts`) to this signature, and it becomes
swappable with the Azure version (`videocall/web/use-azure-transcript.ts`) by **changing a
single import line**.

**Current engine status (2026-07-25)**: Web Speech, but **disabled by default** —
it only captures when `NEXT_PUBLIC_CALL_WEB_SPEECH=1`. Web Speech cuts off and restarts
recognition on every silence, and each restart grabs and releases the mic capture, so the
**browser's mic indicator keeps blinking for the whole call** (Azure holds a continuous
session, so it doesn't have this problem). Engine decision: since we don't have an Azure
key yet, go with Web Speech (flag enabled) for now, and switch to an external STT relay API
once one is available — swapping to Azure is also fine once a key is secured.

## 2. Using the Azure version (2 lines of notion-side work + env)

1. `pnpm add microsoft-cognitiveservices-speech-sdk`
2. Copy `videocall/web/use-azure-transcript.ts` + `videocall/web/azure-transcript.js`
   into `app/src/hooks/` (or import via relative path)
3. `.env.local`:
   ```
   NEXT_PUBLIC_AZURE_SPEECH_KEY=...     # do not commit
   NEXT_PUBLIC_AZURE_SPEECH_REGION=...  # e.g. eastus
   ```
   Direct client-side integration (demo only) — the key is exposed in the bundle, so local
   demo use only.

Compared to Web Speech: no Chrome-only restriction, no need for a silence auto-stop/restart
loop (stays continuous), and better recognition quality. Echo (the other person's voice
picked up by my mic) happens regardless of engine — headphones are required.

## 3. Modules provided

| File | Purpose |
|---|---|
| `videocall/web/azure-transcript.js` | Framework-agnostic STT core (injected via CDN `window.SpeechSDK` or the npm sdk) |
| `videocall/web/use-azure-transcript.ts` | React hook with the above contract signature (for notion to copy) |
| `videocall/web/ringtone.js` | `startRingtone()/stopRingtone(handle)` — for IncomingCallHost, extracted from index.html |
| `videocall/public/test.html` | Standalone verification harness for WebRTC P2P + STT (below) |

## 4. Test harness (verify media/STT without notion)

```
cd videocall && node server.mjs   # :3111
```
Open `http://localhost:3111/test.html` with 2 Chrome profiles:
tab A "Start as Caller", tab B "Start as Callee" → non-trickle offer/answer exchange
(`/api/rtc/<room>` in-memory, the same gatherComplete 2s cap logic as the notion plan) →
the other side's video fills the screen + local PiP bottom-right. For STT, enter the
key/region (saved to localStorage) then Start STT.
The verified snippets (gatherComplete, pc setup, STT wiring) can be referenced as-is when
implementing CallView.

## 5. Demo recording checklist

- [ ] **Both sides wear headphones — a mandatory recording condition.** This isn't about
      audio quality but about **speaker-attribution accuracy**: since each side only
      transcribes its own mic, speaker = session user is taken as settled; without
      headphones, if the other person's voice is picked up by my mic, it gets recorded as
      something I said → the whisper goes to the wrong person and the relationship
      document's speaker attribution is also wrong
- [ ] The caller's face is full-screen, my face is PiP bottom-right
- [ ] Click the receiving tab (B) once before recording (AudioContext suspended → prevents
      a silent ringtone)
- [ ] Confirm `.env.local` has no `AI_URL` (keeps the fakeEdits deterministic append path)
- [ ] Confirm the Azure key/region env is set, `supported === true`
- [ ] One P2P pair visible at chrome://webrtc-internals
