/**
 * The oracle-tag vocabulary the Finisher Lab scores against.
 *
 * Live from Scryfall ONLY for tags the tagger artifact doesn't already carry. Anything already in
 * `infra/lambda/tagger-sync.ts` — ramp, lifegain, tutors, the whole role vocabulary — is read
 * locally via `@/services/tagger/client`, because paginating a tag we already ship is pure waste.
 * `otag:ramp` alone is 2403 cards and was the single reliable source of 429s.
 *
 * The live path exists so a CANDIDATE shape tag can be tried without redeploying the tagger
 * stack, which is the decision the lab is for. Once a tag earns its place it should move into
 * tagger-sync.ts and out of here.
 *
 * Tag counts verified against the Scryfall API on 2026-08-30.
 */

import { fetchOracleTagNames } from '@/services/scryfall/client';
import type { FinisherShape } from '@/types';

/** Which oracle tag supplies each shape. `drain-x` / `drain-static` split on X, not on tag. */
export const SHAPE_TAGS: Record<string, { query: string; shapes: FinisherShape[]; note: string }> = {
  overrun: { query: 'otag:overrun', shapes: ['alpha-strike'], note: '72 cards — Craterhoof, Triumph of the Hordes' },
  lifedrain: { query: 'otag:lifedrain', shapes: ['drain-x', 'drain-static'], note: '426 — Exsanguinate, Gray Merchant' },
  // The X filter is pushed into the QUERY, not just applied after. `otag:burn` alone is 3133
  // cards — 18 pages, and enough on its own to earn a 429 mid-sweep. Since burn-x requires {X}
  // anyway, `mana:{X}` cuts it to 122 with no behaviour change at all.
  burn: { query: 'otag:burn mana:{X}', shapes: ['burn-x'], note: '122 of 3133 — X-scaling burn only' },
  'win-condition': { query: 'otag:win-condition', shapes: ['alt-win'], note: "68 — Thassa's Oracle, Approach" },
  'extra-combat': { query: 'otag:extra-combat', shapes: ['extra-combat'], note: '46 — Aggravated Assault' },
};

/**
 * Fuel tags NOT present in the tagger artifact, so they still need a live fetch.
 *
 * Ramp deliberately isn't here — `cardMatchesRole(name, 'ramp')` reads it from the artifact and
 * subsumes cost-reducer / mana-dork / mana-rock at the same time.
 *
 * These four are DISPLAY-ONLY: the strip reports them, but `grantsConnect` is parsed from oracle
 * text rather than looked up here, so they change no score. They were also 1,989 of the 2,763
 * names in a cold sweep — about 72% of its cost for zero effect on any answer — so they ship
 * commented out and the strip reads "not measured" for them. Uncomment a line to get the count.
 */
export const FUEL_TAGS: Record<string, { query: string; note: string }> = {
  'gives-haste': { query: 'otag:gives-haste', note: '675 — display only' },
  'gives-trample': { query: 'otag:gives-trample', note: '537 — display only' },
  unblockable: { query: 'otag:unblockable', note: '207 — display only' },
  anthem: { query: 'otag:anthem', note: '570 — display only' },
};

/** Membership lookup handed to the pure scoring functions. */
export interface TagMembership {
  has(key: string, cardName: string): boolean;
  /**
   * Whether this key was fetched at all. A tag that isn't in the vocabulary must read as "not
   * measured" rather than as zero carriers — the two look identical through `has` alone, and a
   * confident 0 is exactly the kind of plausible-looking wrong number this lab exists to avoid.
   */
  loaded(key: string): boolean;
  /** key → how many cards Scryfall returned. Drives the health strip. */
  sizes: Record<string, number>;
}

/** One line of the editable vocabulary box: `key: query`. */
export interface VocabEntry {
  key: string;
  query: string;
  /** Written as a `#` comment, so it's one keystroke from active but costs nothing by default. */
  optional?: boolean;
}

/** The default vocabulary, serialised for the textarea. */
export function defaultVocab(): VocabEntry[] {
  return [
    ...Object.entries(SHAPE_TAGS).map(([key, v]) => ({ key, query: v.query })),
    ...Object.entries(FUEL_TAGS).map(([key, v]) => ({ key, query: v.query, optional: true })),
  ];
}

export function vocabToText(entries: VocabEntry[]): string {
  return entries.map(e => `${e.optional ? '# ' : ''}${e.key}: ${e.query}`).join('\n');
}

/** Parse the textarea back. Blank lines and `#` comments are ignored; bad lines are dropped. */
export function parseVocab(text: string): VocabEntry[] {
  const out: VocabEntry[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const idx = line.indexOf(':');
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    const query = line.slice(idx + 1).trim();
    if (key && query) out.push({ key, query });
  }
  return out;
}

/**
 * Fetch every tag in the vocabulary. Sequential on purpose — `fetchOracleTagNames` already goes
 * through the shared Scryfall rate limiter, and firing eight paginated sweeps concurrently is how
 * you earn a 429 storm.
 */
export async function loadMembership(
  entries: VocabEntry[],
  /**
   * Called before each fetch AND after each one completes, carrying the sizes gathered so far.
   * The panel used to render sizes only once the whole sweep returned, which made a slow tag and
   * a dead tag look exactly alike for the length of the sweep.
   */
  onProgress?: (done: number, total: number, key: string, sizes: Record<string, number>) => void,
): Promise<TagMembership> {
  const sets = new Map<string, Set<string>>();
  const sizes: Record<string, number> = {};

  for (let i = 0; i < entries.length; i++) {
    const { key, query } = entries[i];
    onProgress?.(i, entries.length, key, { ...sizes });
    const names = await fetchOracleTagNames(query);
    sets.set(key, names);
    sizes[key] = names.size;
    onProgress?.(i + 1, entries.length, key, { ...sizes });
  }
  onProgress?.(entries.length, entries.length, 'done', { ...sizes });

  return {
    has: (key, cardName) => sets.get(key)?.has(cardName) ?? false,
    loaded: key => sets.has(key),
    sizes,
  };
}
