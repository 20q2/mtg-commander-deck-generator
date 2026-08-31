/**
 * The oracle-tag vocabulary the Finisher Lab scores against — and the reason the lab fetches
 * membership from Scryfall directly rather than from the S3 tagger artifact.
 *
 * Baking these into `infra/lambda/tagger-sync.ts` would mean redeploying the tagger stack by hand
 * every time a candidate tag is tried, which front-loads exactly the decision the lab exists to
 * explore. Once the vocabulary settles, the winners get baked in and this stays as the dev path.
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

/** Tags that measure the deck's fuel rather than name a shape. */
export const FUEL_TAGS: Record<string, { query: string; note: string }> = {
  'gives-haste': { query: 'otag:gives-haste', note: '651' },
  'gives-trample': { query: 'otag:gives-trample', note: '514' },
  unblockable: { query: 'otag:unblockable', note: '196' },
  anthem: { query: 'otag:anthem', note: '543' },
  ramp: { query: 'otag:ramp', note: 'mana ceiling' },
  'mana-dork': { query: 'otag:mana-dork', note: 'mana ceiling' },
  'mana-rock': { query: 'otag:mana-rock', note: 'mana ceiling' },
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
