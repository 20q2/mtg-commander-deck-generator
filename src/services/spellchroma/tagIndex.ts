import { isIgnoredTag } from './ignoredTags';

// File URLs — same public bucket as tagger-tags.json. Overridable via env for
// local/staging, with a prod fallback so the service works even without .env.
const BUCKET = 'https://mtg-deck-builder-tagger.s3.amazonaws.com';
const DICT_URL = (import.meta.env.VITE_SPELLCHROMA_DICT_URL as string | undefined)
  ?? `${BUCKET}/spellchroma-tag-dictionary.json`;
const INDEX_URL = (import.meta.env.VITE_SPELLCHROMA_INDEX_URL as string | undefined)
  ?? `${BUCKET}/spellchroma-tag-index.json`;

export interface TagDictEntry { s: string; l: string; d: string; p?: string[]; }
interface TagDictionaryFile { generatedAt: string; tags: TagDictEntry[]; }
interface TagIndexFile { generatedAt: string; index: Record<string, number[]>; }

/** One aggregated deck tag: slug, human label, and how many deck cards carry it. */
export interface DeckTagCount { slug: string; label: string; count: number; ignored: boolean; }

// ── module cache ──────────────────────────────────────────────────────────
let dict: TagDictEntry[] | null = null;
let dictPromise: Promise<TagDictEntry[] | null> | null = null;
let index: Record<string, number[]> | null = null;
let indexPromise: Promise<boolean> | null = null;

/** Load the small tag dictionary (call on page open — powers the tag picker + labels). */
export function loadTagDictionary(): Promise<TagDictEntry[] | null> {
  if (dict) return Promise.resolve(dict);
  if (dictPromise) return dictPromise;
  dictPromise = (async () => {
    try {
      const res = await fetch(DICT_URL);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const file: TagDictionaryFile = await res.json();
      dict = file.tags;
      console.log(`[SpellChroma] dictionary loaded: ${dict.length} tags (gen ${file.generatedAt})`);
      return dict;
    } catch (err) {
      console.warn('[SpellChroma] dictionary load failed — tag picker/labels degrade:', err);
      return null;
    } finally {
      dictPromise = null;
    }
  })();
  return dictPromise;
}

/** Load the bigger per-card index (call lazily — only when a deck is loaded or a card is previewed). */
export function loadTagIndex(): Promise<boolean> {
  if (index) return Promise.resolve(true);
  if (indexPromise) return indexPromise;
  indexPromise = (async () => {
    try {
      // The dictionary is needed to decode int-ids, so ensure it's present too.
      await loadTagDictionary();
      const res = await fetch(INDEX_URL);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const file: TagIndexFile = await res.json();
      index = file.index;
      console.log(`[SpellChroma] index loaded: ${Object.keys(index).length} cards (gen ${file.generatedAt})`);
      return true;
    } catch (err) {
      console.warn('[SpellChroma] index load failed — Deck Lens/preview tags degrade:', err);
      return false;
    } finally {
      indexPromise = null;
    }
  })();
  return indexPromise;
}

/** All tag dictionary entries (for the autocomplete picker). Empty until loaded. */
export function allTags(): TagDictEntry[] {
  return dict ?? [];
}

/** Whether the per-card index is loaded (so callers can skip a redundant lazy-load). */
export function isTagIndexLoaded(): boolean {
  return index !== null;
}

/** Tag slugs for a card by oracle_id. Empty if the index isn't loaded or the card is untagged. */
export function tagsForOracleId(oracleId: string): string[] {
  if (!index || !dict) return [];
  const ids = index[oracleId];
  if (!ids) return [];
  const out: string[] = [];
  for (const i of ids) {
    const e = dict[i];
    if (e) out.push(e.s);
  }
  return out;
}

/**
 * Aggregate tag counts across a deck. Sorted by count desc, then ignored tags
 * demoted below helpful ones (matching the original's behavior). `cards` need
 * only carry `oracle_id`.
 */
export function aggregateDeckTags(cards: { oracle_id?: string }[]): DeckTagCount[] {
  if (!index || !dict) return [];
  const counts = new Map<string, number>(); // slug -> count
  for (const c of cards) {
    if (!c.oracle_id) continue;
    for (const i of index[c.oracle_id] ?? []) {
      const e = dict[i];
      if (!e) continue;
      counts.set(e.s, (counts.get(e.s) ?? 0) + 1);
    }
  }
  const labelBySlug = new Map(dict.map(e => [e.s, e.l]));
  return [...counts.entries()]
    .map(([slug, count]): DeckTagCount => ({
      slug,
      label: labelBySlug.get(slug) || slug,
      count,
      ignored: isIgnoredTag(slug),
    }))
    .sort((a, b) => {
      if (a.ignored !== b.ignored) return a.ignored ? 1 : -1; // helpful first
      return b.count - a.count || a.slug.localeCompare(b.slug);
    });
}
