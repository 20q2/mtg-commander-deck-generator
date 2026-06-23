/**
 * Per-run deterministic jitter.
 *
 * The brew engine is otherwise fully deterministic, which is great for session resume but means
 * two runs of the same commander always funnel down the identical staple path. A single random
 * `seed` is minted once at session start (see startBrewSession) and stored on BrewState; every
 * jitter value is then a pure hash of (seed, key), so a given run stays byte-stable across
 * resume/undo while *different* runs (different seeds) see different — but still good — offers.
 *
 * `seed` falsy (0 / undefined) ⇒ no jitter and a stable first-element pick, so unit fixtures that
 * omit the seed remain deterministic.
 */

/** FNV-1a-style string hash mixed with the run seed → uint32. */
function hash(seed: number, key: string): number {
  let h = (seed ^ 0x9e3779b9) >>> 0;
  for (let i = 0; i < key.length; i++) {
    h = Math.imul(h ^ key.charCodeAt(i), 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** A stable perturbation in [-amplitude, +amplitude] for this run+key. 0 when seed is falsy. */
export function seededJitter(seed: number | undefined, key: string, amplitude: number): number {
  if (!seed) return 0;
  const unit = hash(seed, key) / 0xffffffff; // [0,1]
  return (unit * 2 - 1) * amplitude;
}

/**
 * A stable yes/no roll for this run+key: true with probability `prob` (0..1). Always false when
 * seed is falsy, so unit fixtures that omit the seed never trip a chance-gated beat.
 */
export function seededChance(seed: number | undefined, key: string, prob: number): boolean {
  if (!seed) return false;
  return hash(seed, key) / 0xffffffff < prob;
}

/** Deterministically pick one element keyed by run+key. Returns arr[0] when seed is falsy. */
export function seededPick<T>(seed: number | undefined, key: string, arr: T[]): T | null {
  if (arr.length === 0) return null;
  if (!seed) return arr[0];
  return arr[hash(seed, key) % arr.length];
}
