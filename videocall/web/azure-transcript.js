// Framework-free Azure Speech continuous STT core.
// Works with the browser SDK loaded either as `window.SpeechSDK` (CDN bundle)
// or the `microsoft-cognitiveservices-speech-sdk` npm module (pass it as `sdk`).
//
//   const t = createAzureTranscript({
//     sdk: window.SpeechSDK,
//     key, region,             // client-direct (demo): SpeechConfig.fromSubscription
//     lang: "en-US",
//     onInterim(text) {},      // partial hypothesis (replaces previous interim)
//     onFinal(text) {},        // finalized utterance
//     onError(message) {},
//     onState(state) {},       // "starting" | "listening" | "stopped" | "error"
//   });
//   await t.start();
//   await t.stop();

export function createAzureTranscript({ sdk, key, region, lang = "en-US", onInterim, onFinal, onError, onState }) {
  let recognizer = null;
  const emit = (fn, arg) => { try { fn && fn(arg); } catch { /* listener error */ } };

  async function start() {
    if (recognizer) return;
    emit(onState, "starting");
    const speechConfig = sdk.SpeechConfig.fromSubscription(key, region);
    speechConfig.speechRecognitionLanguage = lang;
    const audioConfig = sdk.AudioConfig.fromDefaultMicrophoneInput();
    recognizer = new sdk.SpeechRecognizer(speechConfig, audioConfig);

    recognizer.recognizing = (_s, e) => {
      if (e.result.text) emit(onInterim, e.result.text);
    };
    recognizer.recognized = (_s, e) => {
      emit(onInterim, "");
      if (e.result.reason === sdk.ResultReason.RecognizedSpeech && e.result.text.trim().length >= 2) {
        emit(onFinal, e.result.text.trim());
      }
    };
    recognizer.canceled = (_s, e) => {
      if (e.reason === sdk.CancellationReason.Error) {
        emit(onState, "error");
        emit(onError, e.errorDetails || "speech canceled");
      }
    };
    recognizer.sessionStopped = () => emit(onState, "stopped");

    await new Promise((resolve, reject) =>
      recognizer.startContinuousRecognitionAsync(resolve, (err) => {
        emit(onState, "error");
        emit(onError, String(err));
        reject(err);
      })
    );
    emit(onState, "listening");
  }

  async function stop() {
    const r = recognizer;
    recognizer = null;
    if (!r) return;
    await new Promise((resolve) => r.stopContinuousRecognitionAsync(resolve, resolve));
    r.close();
    emit(onState, "stopped");
  }

  return { start, stop };
}
