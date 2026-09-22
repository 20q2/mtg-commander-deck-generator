/**
 * Tiny, dependency-free "juice" for the brew's celebration toasts: a soft synthesized chime (Web
 * Audio off the app's shared AudioContext — no asset files) plus a haptic buzz on devices that
 * support it. Each earned beat (goal / combo / streak) gets its own little motif. Gated by a
 * persisted on/off preference; everything is wrapped in try/catch and lazily created so it's inert
 * in tests/SSR and never throws into the UI.
 */
import { audioContext, noiseBuffer } from '@/services/audio/context';

const PREF_KEY = 'mtg-brew-sound';

let enabled = (() => {
  try { return localStorage.getItem(PREF_KEY) !== 'false'; } catch { return true; }
})();

export function isBrewSoundEnabled(): boolean {
  return enabled;
}

export function setBrewSoundEnabled(on: boolean): void {
  enabled = on;
  try { localStorage.setItem(PREF_KEY, on ? 'true' : 'false'); } catch { /* ignore */ }
}

// A short ascending motif per beat (Hz). Goal = a bright major arpeggio; combo = a "click" interval;
// streak = a quick two-note lift.
const MOTIF: Record<'goal' | 'combo' | 'streak', number[]> = {
  goal: [523.25, 659.25, 783.99],   // C5 E5 G5
  combo: [659.25, 987.77],          // E5 B5
  streak: [493.88, 739.99],         // B4 F#5
};

function tone(ac: AudioContext, freq: number, startAt: number, dur: number): void {
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = 'triangle';
  osc.frequency.value = freq;
  // Soft attack/decay so it reads as a gentle chime, not a beep. Peak volume kept low (~0.06).
  gain.gain.setValueAtTime(0.0001, startAt);
  gain.gain.exponentialRampToValueAtTime(0.06, startAt + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + dur);
  osc.connect(gain).connect(ac.destination);
  osc.start(startAt);
  osc.stop(startAt + dur + 0.02);
}

/** The pack-opening cue: a foil-tear (a filtered noise sweep) + a low pop as it gives way.
 *  `tearSec` stretches the tear so the pop lands on the visible strip release — the 3D ceremony
 *  passes its seam-sweep duration; the CSS path keeps the default. */
export function playPackCrack(tearSec = 0.3): void {
  if (!enabled) return;
  try { navigator.vibrate?.([12, 30, 10]); } catch { /* ignore */ }
  const ac = audioContext();
  if (!ac) return;
  const now = ac.currentTime;
  const dur = tearSec;
  // The tear: a decaying white-noise burst through a bandpass sweeping down — ripping foil.
  const buf = noiseBuffer(ac, dur, t => 1 - t);
  const src = ac.createBufferSource();
  src.buffer = buf;
  const bp = ac.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.setValueAtTime(3200, now);
  bp.frequency.exponentialRampToValueAtTime(900, now + dur);
  bp.Q.value = 0.9;
  const g = ac.createGain();
  g.gain.setValueAtTime(0.09, now);
  g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
  src.connect(bp).connect(g).connect(ac.destination);
  src.start(now);
  // The pop as the wrapper gives way, just before the cards fan out.
  tone(ac, 220, now + dur, 0.12);
}

/** Play the celebration cue (sound + haptic) for an earned beat. No-op when muted or unsupported. */
export function playCelebration(kind: 'goal' | 'combo' | 'streak'): void {
  if (!enabled) return;
  // Haptic — meaningful on mobile, harmless (returns false) elsewhere. Goal gets a richer pattern.
  try { navigator.vibrate?.(kind === 'goal' ? [18, 40, 22] : 16); } catch { /* ignore */ }
  const ac = audioContext();
  if (!ac) return;
  const now = ac.currentTime;
  MOTIF[kind].forEach((f, i) => tone(ac, f, now + i * 0.085, 0.16));
}
