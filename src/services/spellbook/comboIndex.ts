// Precomputed Commander Spellbook combo index, built weekly by the
// spellbook-combos Lambda (infra/lambda/spellbook-combos.ts) into the tagger
// S3 bucket. One file per color identity; each file is the full subset
// closure (golgari.json = golgari + mono-black + mono-green + colorless), so
// a single fetch covers everything a deck of that identity can run.
//
// This exists because EDHREC's color-identity combo pages only expose the top
// 100 combos per page-1 fetch (golgari alone has ~3,000 across 30 pages) and
// exclude subset identities entirely — low-popularity and off-guild combos
// were invisible to detection. Consumers fall back to the EDHREC page when
// this index is unavailable (env unset, fetch failure).

// Same URL treatment as the SpellChroma index: default to the public bucket
// (behind the vite /tagger-s3 proxy in dev), overridable via env.
const BUCKET = import.meta.env.DEV
  ? '/tagger-s3'
  : 'https://mtg-deck-builder-tagger.s3.amazonaws.com';
const BASE = (import.meta.env.VITE_SPELLBOOK_COMBOS_URL as string | undefined)
  ?? `${BUCKET}/spellbook-combos`;

// One combo as shipped in the artifact (compact keys): i = Spellbook variant
// id (same id EDHREC uses as comboId), c = card names, r = results, d = color
// identity string ("BG", "C" = colorless), p = popularity (EDHREC deck count,
// synced by Spellbook), b = Spellbook bracket tag.
export interface SpellbookComboEntry {
  i: string;
  c: string[];
  r: string[];
  d: string;
  p: number;
  b: string;
}

interface SpellbookComboFile {
  generatedAt: string;
  count: number;
  combos: SpellbookComboEntry[];
}

/**
 * Spellbook bracket tag → the EDHREC-style bracket vote string the rest of the
 * app parses with parseInt (see comboFitsBracket). Conservative mapping:
 * Ruthless is cEDH-grade, Spicy/Powerful read as bracket-4 material, Core as
 * the classic bracket-3 two-card engines. Oddball/Exhibition map to 'any'
 * (NaN), which existing logic treats cautiously — only seeded at bracket 4+
 * and ignored by the bracket estimator.
 */
const BRACKET_TAG_TO_VOTE: Record<string, string> = {
  R: '5',
  S: '4',
  P: '4',
  C: '3',
  O: 'any',
  E: 'any',
};

export function spellbookBracketToVote(tag: string): string {
  return BRACKET_TAG_TO_VOTE[tag] ?? 'unknown';
}

// slug → entries (null = unavailable this session; retried only via TTL expiry
// of the caller's combo cache, which is fine — the EDHREC fallback covers it).
const cache = new Map<string, SpellbookComboEntry[] | null>();
const inflight = new Map<string, Promise<SpellbookComboEntry[] | null>>();

/**
 * Fetch the combo closure file for a color-identity slug ("golgari").
 * Returns null when the index is unconfigured or unreachable — callers treat
 * that as "fall back to the EDHREC color page".
 */
export async function fetchSpellbookCombosBySlug(slug: string): Promise<SpellbookComboEntry[] | null> {
  if (!BASE) return null;
  if (cache.has(slug)) return cache.get(slug)!;
  const pending = inflight.get(slug);
  if (pending) return pending;

  const promise = (async () => {
    try {
      const res = await fetch(`${BASE}/${slug}.json`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: SpellbookComboFile = await res.json();
      if (!Array.isArray(data.combos)) throw new Error('malformed combo file');
      cache.set(slug, data.combos);
      console.log(`[Spellbook] Loaded ${data.combos.length} ${slug} combos (generated ${data.generatedAt})`);
      return data.combos;
    } catch (err) {
      console.warn(`[Spellbook] Combo index unavailable for ${slug} — falling back to EDHREC page:`, err);
      cache.set(slug, null);
      return null;
    } finally {
      inflight.delete(slug);
    }
  })();

  inflight.set(slug, promise);
  return promise;
}
