// Ringtone module — extracted from public/index.html startRingtone/stopRingtone.
// US-style dual-tone (440+480 Hz), 1.2s burst every 3s, via WebAudio.
//
// Usage (ESM):
//   import { startRingtone, stopRingtone } from "./ringtone.js";
//   const ring = startRingtone();   // returns handle (or null if audio blocked)
//   stopRingtone(ring);
//
// Note: a fresh tab may have its AudioContext suspended until a user gesture;
// startRingtone degrades to silence in that case (returns handle anyway).

export function startRingtone() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.connect(ctx.destination);
    const o1 = ctx.createOscillator(); o1.frequency.value = 440;
    const o2 = ctx.createOscillator(); o2.frequency.value = 480;
    o1.connect(gain); o2.connect(gain);
    o1.start(); o2.start();
    const beep = () => {
      const t = ctx.currentTime;
      gain.gain.setValueAtTime(0.06, t);
      gain.gain.setValueAtTime(0, t + 1.2);
    };
    beep();
    const iv = setInterval(beep, 3000);
    return { ctx, iv };
  } catch {
    return null;
  }
}

export function stopRingtone(handle) {
  if (!handle) return;
  clearInterval(handle.iv);
  handle.ctx.close();
}
