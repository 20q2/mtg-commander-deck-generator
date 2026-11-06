/**
 * The playtest table's sound layer: quiet synthesized cues — a shuffle riffle, a card draw, a
 * counter bump, a card landing, a tap and untap swoosh, a die rattle — so the board feels physical
 * without anything chattering at you, plus one deliberately audible chime when the bots hand the
 * turn back to you.
 *
 * Synthesized rather than sampled, like the brew's chimes: no asset files, nothing added to the
 * bundle, nothing to fetch. Everything is wrapped in try/catch and built lazily off the shared
 * AudioContext, so the module is inert in tests and never throws into the UI.
 *
 * Gains sit well under the brew's celebration chime (which peaks at 0.06). That chime fires a
 * handful of times a session; the table cues fire hundreds of times, and anything you hear hundreds
 * of times has to sit below conscious notice. The `yourTurn` chime is the exception on purpose —
 * it fires once a turn cycle and is the one sound meant to fetch you back from another window.
 */
import { audioContext, noiseBuffer } from '@/services/audio/context';
import { usePlaytestSettings } from '@/store/playtestSettingsStore';

export type PlaytestCue =
  | 'shuffle' | 'draw' | 'counterUp' | 'counterDown' | 'land' | 'tap' | 'untap' | 'roll' | 'hit'
  | 'dust' | 'yourTurn';

/** Bot seats play the same cues at half gain — present, but clearly not your own hands. */
export const BOT_GAIN = 0.5;

/**
 * Repeat calls of the same cue inside this window collapse to one. Bulk gestures — untapping a
 * board, tapping out a marquee selection, holding down a counter's + button — would otherwise
 * layer a dozen identical bursts into a rasp. Per-cue, so a counter click during a shuffle still
 * sounds.
 */
const COALESCE_MS = 60;
const lastPlayed: Partial<Record<PlaytestCue, number>> = {};

function shouldPlay(cue: PlaytestCue): boolean {
  if (!usePlaytestSettings.getState().sounds) return false;
  const now = Date.now();
  if (now - (lastPlayed[cue] ?? -Infinity) < COALESCE_MS) return false;
  lastPlayed[cue] = now;
  return true;
}

/** A band-limited noise burst — the body of every cue here except the card-landing thud. */
function burst(
  ac: AudioContext,
  opts: {
    dur: number;
    gain: number;
    type: BiquadFilterType;
    freq: number;
    q?: number;
    /** Sweep the filter to this frequency across the burst (the riffle's downward hiss). */
    freqTo?: number;
    envelope?: (t: number) => number;
    /** Seconds from now to start — lets one cue schedule several bursts (the die's rattle). */
    delay?: number;
  },
): void {
  const now = ac.currentTime + (opts.delay ?? 0);
  const src = ac.createBufferSource();
  src.buffer = noiseBuffer(ac, opts.dur, opts.envelope ?? (t => 1 - t));
  const filter = ac.createBiquadFilter();
  filter.type = opts.type;
  filter.frequency.setValueAtTime(opts.freq, now);
  if (opts.freqTo) filter.frequency.exponentialRampToValueAtTime(opts.freqTo, now + opts.dur);
  filter.Q.value = opts.q ?? 1;
  const g = ac.createGain();
  g.gain.value = opts.gain;
  src.connect(filter).connect(g).connect(ac.destination);
  src.start(now);
  src.stop(now + opts.dur + 0.02);
}

/** A short pitched body under a cue: the card-landing thud, the bump at the end of a swoosh. */
function thud(ac: AudioContext, freq: number, dur: number, gain: number, delay = 0): void {
  const now = ac.currentTime + delay;
  const osc = ac.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(freq, now);
  // A slight downward bend is what makes it read as something hitting a surface rather than a beep.
  osc.frequency.exponentialRampToValueAtTime(freq * 0.6, now + dur);
  const g = ac.createGain();
  g.gain.setValueAtTime(gain, now);
  g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
  osc.connect(g).connect(ac.destination);
  osc.start(now);
  osc.stop(now + dur + 0.02);
}

/**
 * The riffle: noise fluttering at ~55 Hz under a swell-then-fade envelope, swept from bright to
 * dull. The flutter is what separates a shuffle from plain hiss — it's the individual cards.
 */
function shuffleRiffle(ac: AudioContext, gain: number): void {
  burst(ac, {
    dur: 0.26,
    gain: 0.045 * gain,
    type: 'bandpass',
    freq: 2400,
    freqTo: 900,
    q: 0.8,
    envelope: t => Math.sin(Math.PI * t) * (0.65 + 0.35 * Math.abs(Math.sin(t * Math.PI * 2 * 14))),
  });
}

/**
 * A soft pitched note for the one cue that is meant to be heard rather than felt: a triangle wave
 * with a gentle attack and a long exponential tail, so it reads as a chime and not a notification
 * beep.
 */
function bell(ac: AudioContext, freq: number, startAt: number, dur: number, gain: number): void {
  const osc = ac.createOscillator();
  osc.type = 'triangle';
  osc.frequency.value = freq;
  const g = ac.createGain();
  g.gain.setValueAtTime(0.0001, startAt);
  g.gain.exponentialRampToValueAtTime(gain, startAt + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, startAt + dur);
  osc.connect(g).connect(ac.destination);
  osc.start(startAt);
  osc.stop(startAt + dur + 0.02);
}

const CUES: Record<PlaytestCue, (ac: AudioContext, gain: number) => void> = {
  shuffle: shuffleRiffle,

  // One card off the top: drier and brighter than the riffle, and over in a tenth of a second.
  draw: (ac, gain) => burst(ac, {
    dur: 0.1, gain: 0.032 * gain, type: 'bandpass', freq: 3000, freqTo: 1400, q: 1.2,
    envelope: t => Math.sin(Math.PI * t),
  }),

  // Counters: a small rounded bump with a resonant tick on its front edge. The tick alone was
  // twelve milliseconds and sat below hearing; the bump gives it a body. Up and down differ only in
  // pitch, which is enough to hear the direction without looking — the same information the
  // floating +1/−1 text carries visually.
  counterUp: (ac, gain) => {
    thud(ac, 620, 0.05, 0.04 * gain);
    burst(ac, { dur: 0.012, gain: 0.04 * gain, type: 'bandpass', freq: 1700, q: 9 });
  },
  counterDown: (ac, gain) => {
    thud(ac, 400, 0.05, 0.04 * gain);
    burst(ac, { dur: 0.012, gain: 0.04 * gain, type: 'bandpass', freq: 1050, q: 9 });
  },

  // A card meeting the table: a low bend plus a soft dull "pff" of air and cardstock.
  land: (ac, gain) => {
    thud(ac, 150, 0.075, 0.05 * gain);
    burst(ac, { dur: 0.06, gain: 0.022 * gain, type: 'lowpass', freq: 700, q: 0.7 });
  },

  // Turning a card sideways: a short swoosh of cardstock through air that comes to rest on a soft
  // bump. Tap sweeps up and untap sweeps down, so you can hear which way the card turned. Both are
  // airy where a counter is pitched, so a tapped-out board and a counter flurry never sound alike.
  tap: (ac, gain) => {
    burst(ac, {
      dur: 0.11, gain: 0.05 * gain, type: 'bandpass', freq: 700, freqTo: 2400, q: 1.4,
      envelope: t => Math.sin(Math.PI * Math.min(1, t * 1.15)) ** 2,
    });
    thud(ac, 170, 0.05, 0.035 * gain, 0.09);
  },
  untap: (ac, gain) => {
    burst(ac, {
      dur: 0.1, gain: 0.045 * gain, type: 'bandpass', freq: 2200, freqTo: 650, q: 1.4,
      envelope: t => Math.sin(Math.PI * Math.min(1, t * 1.15)) ** 2,
    });
    thud(ac, 150, 0.045, 0.03 * gain, 0.08);
  },

  // A die tumbling: a handful of hard, bright clicks at uneven gaps that close up and fade, then
  // one duller knock as it settles. Paced to the 450ms wiggle the die plays on screen, and pitched
  // at random on each roll so two rolls never sound like a sample being replayed.
  roll: (ac, gain) => {
    const hits = [0, 0.065, 0.14, 0.2, 0.25, 0.29];
    hits.forEach((at, i) => burst(ac, {
      delay: at,
      dur: 0.014,
      gain: 0.05 * gain * (1 - i * 0.12),
      type: 'bandpass',
      freq: 2000 + Math.random() * 1600,
      q: 6,
    }));
    thud(ac, 260, 0.06, 0.04 * gain, 0.36);
    burst(ac, { delay: 0.36, dur: 0.02, gain: 0.035 * gain, type: 'bandpass', freq: 1300, q: 4 });
  },

  // A creature connecting, once per strike as combat paces itself out. Lower and shorter than
  // `land` — a hit is a body, not cardstock — with the noise layer clipped tight so a five-creature
  // alpha strike reads as five separate impacts rather than one long crunch. The 60ms coalescing
  // window is doing real work here: a swarm whose strikes crowd closer than that collapses to one
  // hit instead of rasping.
  hit: (ac, gain) => {
    thud(ac, 110, 0.055, 0.055 * gain);
    burst(ac, { dur: 0.035, gain: 0.03 * gain, type: 'bandpass', freq: 1900, freqTo: 600, q: 1.1 });
  },

  // A bot defeated and its board blowing away: a long, soft exhale of grit that swells and thins
  // out as it falls in pitch, timed to the wave crossing the seat. Long for a table cue, but it
  // happens once or twice a game and is the board leaving, so it can afford to be felt.
  dust: (ac, gain) => burst(ac, {
    dur: 1.6, gain: 0.04 * gain, type: 'bandpass', freq: 3200, freqTo: 500, q: 0.7,
    envelope: t => Math.sin(Math.PI * Math.min(1, t * 1.05)) ** 1.5
      * (0.75 + 0.25 * Math.abs(Math.sin(t * Math.PI * 2 * 9))),
  }),

  // Control coming back to you after the table has played. The only cue here with a pitch you are
  // meant to notice: it fires once per turn cycle, and its whole job is to reach you when you have
  // looked away from the screen. An ascending fourth — G5 then C6, the second overlapping the
  // first's tail — which is why it can sit louder than the table cues without nagging.
  yourTurn: (ac, gain) => {
    const now = ac.currentTime;
    bell(ac, 783.99, now, 0.26, 0.05 * gain);
    bell(ac, 1046.5, now + 0.1, 0.34, 0.045 * gain);
  },
};

/**
 * Play one cue. No-op when the setting is off, when Web Audio is unavailable, or when the same cue
 * already sounded within the coalescing window. `gain` scales the cue — bots pass {@link BOT_GAIN}.
 */
export function playCue(cue: PlaytestCue, gain = 1): void {
  if (!shouldPlay(cue)) return;
  try {
    const ac = audioContext();
    if (!ac) return;
    CUES[cue](ac, gain);
  } catch {
    /* sound is decoration — never let it break the table */
  }
}

/** A tap cue picked by direction: `true` is turning sideways, `false` is standing back up. */
export function playTapCue(tapped: boolean, gain = 1): void {
  playCue(tapped ? 'tap' : 'untap', gain);
}

/** A counter cue picked by direction. */
export function playCounterCue(delta: number, gain = 1): void {
  playCue(delta >= 0 ? 'counterUp' : 'counterDown', gain);
}
