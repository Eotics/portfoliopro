// Tiny synthesized cues (no audio files, no microphone). Off unless enabled in Settings.
let ctx: AudioContext | null = null;

function tone(freqs: number[], dur = 0.09, gain = 0.05) {
  try {
    ctx ??= new AudioContext();
    const t0 = ctx.currentTime;
    freqs.forEach((f, i) => {
      const o = ctx!.createOscillator();
      const g = ctx!.createGain();
      o.type = "sine";
      o.frequency.value = f;
      const start = t0 + i * dur;
      g.gain.setValueAtTime(0, start);
      g.gain.linearRampToValueAtTime(gain, start + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
      o.connect(g).connect(ctx!.destination);
      o.start(start);
      o.stop(start + dur + 0.02);
    });
  } catch {
    // Audio unavailable: cues are optional.
  }
}

export const cues = {
  success: () => tone([660, 880]),
  error: () => tone([420, 300], 0.12),
  attention: () => tone([740, 740], 0.07),
};
