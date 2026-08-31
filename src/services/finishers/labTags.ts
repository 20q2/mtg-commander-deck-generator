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
 * These four are display-only: the strip reports them, but `grantsConnect` is parsed from oracle
 * text rather than looked up here, so dropping them changes no score. They're the first thing to
 * cut if the sweep gets slow.
 */
export const FUEL_TAGS: Record<string, { query: string; note: string }> = {
  'gives-haste': { query: 'otag:gives-haste', note: '651 — display only' },
  'gives-trample': { query: 'otag:gives-trample', note: '514 — display only' },
  unblockable: { query: 'otag:unblockable', note: '196 — display only' },
  anthem: { query: 'otag:anthem', note: '543 — display only' },
};

/** Membership lookup handed to the pure scoring functions. */
export interface TagMembership {
  has(key: string, cardName: string): boolean;
  /** key → how many cards Scryfall returned. Drives the health strip. */
  sizes: Record<string, number>;
}

/** One line of the editable vocabulary box: `key: query`. */
export interface VocabEntry { key: string; query: string }

/** The default vocabulary, serialised for the textarea. */
export function defaultVocab(): VocabEntry[] {
  return [
    ...Object.entries(SHAPE_TAGS).map(([key, v]) => ({ key, query: v.query })),
    ...Object.entries(FUEL_TAGS).map(([key, v]) => ({ key, query: v.query })),
  ];
}

export function vocabToText(entries: VocabEntry[]): string {
  return entries.map(e => `${e.key}: ${e.query}`).join('\n');
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
  onProgress?: (done: number, total: number, key: string) => void,
): Promise<TagMembership> {
  const sets = new Map<string, Set<string>>();
  const sizes: Record<string, number> = {};

  for (let i = 0; i < entries.length; i++) {
    const { key, query } = entries[i];
    onProgress?.(i, entries.length, key);
    const names = await fetchOracleTagNames(query);
    sets.set(key, names);
    sizes[key] = names.size;
  }
  onProgress?.(entries.length, entries.length, 'done');

  return {
    has: (key, cardName) => sets.get(key)?.has(cardName) ?? false,
    sizes,
  };
}
