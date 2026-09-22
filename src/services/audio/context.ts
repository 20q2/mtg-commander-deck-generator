/**
 * One lazily-created AudioContext shared by every bit of synthesized "juice" in the app (the brew's
 * celebration chimes, the playtest table sounds). Browsers cap how many contexts a page may hold
 * open, and there is no reason for two — a single node graph fans out to all of them.
 *
 * Creation is deferred to the first sound so nothing is constructed in tests, during SSR, or for a
 * visitor who never triggers a cue. Everything is wrapped so an unsupported or blocked context
 * degrades to silence instead of throwing into the UI.
 */
let audioCtx: AudioContext | null = null;

/** The shared context, or null when Web Audio is unavailable. Resumes an auto-suspended context. */
export function audioContext(): AudioContext | null {
  try {
    const AC = window.AudioContext
      ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    audioCtx ??= new AC();
    // Browsers start the context suspended until a user gesture; every caller is gesture-driven,
    // so resuming here is enough to get sound on the first click.
    if (audioCtx.state === 'suspended') void audioCtx.resume();
    return audioCtx;
  } catch {
    return null;
  }
}

/**
 * A white-noise buffer of `dur` seconds whose amplitude is shaped by `envelope` (0..1 over the
 * burst). Baking the envelope into the samples rather than automating a gain node keeps the very
 * short bursts — clicks and ticks of ten milliseconds — from being smeared by parameter smoothing.
 */
export function noiseBuffer(ac: AudioContext, dur: number, envelope: (t: number) => number): AudioBuffer {
  const length = Math.max(1, Math.ceil(ac.sampleRate * dur));
  const buf = ac.createBuffer(1, length, ac.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * envelope(i / length);
  return buf;
}
