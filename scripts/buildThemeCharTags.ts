/**
 * Builds `src/data/themeCharTags.json` — the precomputed definition of every EDHREC theme that has
 * no literal card attribute to test against.
 *
 * Run manually: `npm run build:theme-tags`. NOT a cron job. Theme definitions don't go stale on
 * their own — "Aristocrats means sacrifice outlets and death triggers" doesn't drift, and new cards
 * get classified BY the definition rather than changing it. The only reason this isn't done in the
 * browser is that it costs ~400 EDHREC page fetches.
 *
 * What it produces, per theme:
 *   - `charTags`: for ARCHETYPE themes only, the oracle tags over-represented among the theme's
 *     cards relative to the whole playable pool. This is the theme's working definition.
 *   - `baseRate`: what fraction of the playable pool belongs to the theme at all — the denominator
 *     for observed-over-expected at deck-scoring time, so "10 Humans" reads as unremarkable while
 *     "6 Praetors" reads as enormous.
 *
 * The comparison universe is the union of all EDHREC tag pages, i.e. cards that actually show up in
 * Commander decks — deliberately NOT every card ever printed. "Over-represented among cards people
 * play" is the question we mean to ask, and it also spares us a 160MB bulk download.
 *
 * Deterministic themes (tribal / mechanic / subtype / cardType / curated) get a baseRate but no
 * charTags: they already have an exact card-attribute test, and tags would double-count them.
 * Role themes ("Ramp", "Card Draw") are skipped entirely — they name a job, not a strategy.
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { classifyTheme, themeKindMatches, type ThemeKind } from '../src/services/themes/themeKind.ts';
import { computeThemeCharTags, type TaggedPoolCard } from '../src/services/themes/charTags.ts';
import { isIgnoredTag } from '../src/services/spellchroma/ignoredTags.ts';

const EDHREC = 'https://json.edhrec.com';
const SCRYFALL = 'https://api.scryfall.com';
const CHROMA = 'https://mtg-deck-builder-tagger.s3.amazonaws.com';
const OUT = new URL('../src/data/themeCharTags.json', import.meta.url);

const EDHREC_DELAY_MS = 100;
const SCRYFALL_DELAY_MS = 100;
const SCRYFALL_BATCH = 75;

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/**
 * On-disk cache of the two slow network stages, so re-runs while tuning the lift constants cost
 * seconds instead of four minutes. Gitignored; delete `.cache/` to force a full refresh.
 */
const CACHE_DIR = new URL('../.cache/', import.meta.url);
function cacheRead<T>(name: string): T | null {
  const f = new URL(name, CACHE_DIR);
  if (!existsSync(f)) return null;
  try { return JSON.parse(readFileSync(f, 'utf8')) as T; } catch { return null; }
}
function cacheWrite(name: string, data: unknown): void {
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(new URL(name, CACHE_DIR), JSON.stringify(data));
}

// Scryfall 403s requests without these. Omitting them fails silently enough to produce a
// plausible-looking but entirely empty table, so they are not optional.
const HEADERS = {
  'User-Agent': 'ManaFoundry/1.0 (theme-chartag-builder)',
  Accept: 'application/json',
};

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { headers: HEADERS });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

// ─── EDHREC shapes (mirroring the parsers in services/edhrec/client.ts) ───

interface RawCardview { name?: string; url?: string; num_decks?: number; inclusion?: number }
interface RawPage {
  container?: { json_dict?: { cardlists?: Array<{ tag?: string; cardviews?: RawCardview[] }> } };
}

interface Tag { name: string; slug: string; numDecks: number }

function parseTags(raw: RawPage): Tag[] {
  const lists = raw.container?.json_dict?.cardlists ?? [];
  const list = lists.find(l => l.tag === 'tagsbypopularitysort');
  const out: Tag[] = [];
  for (const v of list?.cardviews ?? []) {
    const slug = (v.url || '').split('/').filter(Boolean).pop() || '';
    if (!v.name || !slug) continue;
    out.push({ name: v.name, slug, numDecks: v.num_decks ?? v.inclusion ?? 0 });
  }
  return out;
}

function parsePageCardNames(raw: RawPage): string[] {
  const names = new Set<string>();
  for (const list of raw.container?.json_dict?.cardlists ?? []) {
    for (const v of list.cardviews ?? []) if (v.name) names.add(v.name);
  }
  return [...names];
}

// ─── SpellChroma tag index ───
// The app's tagIndex.ts can't be imported here: it's coupled to `import.meta.env` and the vite
// proxy. The ancestor walk is ten lines, so it's re-implemented rather than refactored.

interface TagDictEntry { s: string; l: string; d: string; p?: string[] }

function buildTagResolver(dict: TagDictEntry[], index: Record<string, number[]>) {
  const bySlug = new Map(dict.map(e => [e.s, e]));
  const ancestors = (slug: string, out: Set<string>): void => {
    for (const p of bySlug.get(slug)?.p ?? []) {
      if (out.has(p)) continue;
      out.add(p);
      ancestors(p, out);
    }
  };
  return (oracleId: string): string[] => {
    const ids = index[oracleId];
    if (!ids) return [];
    const out = new Set<string>();
    for (const i of ids) {
      const e = dict[i];
      if (!e) continue;
      out.add(e.s);
      ancestors(e.s, out);
    }
    // Printing-cycle and trivia tags ("cycle-rav-shockland", "reprint") describe where a card was
    // printed, not what it does. They're murder on lift: staples appear on nearly every theme page
    // while the pool is dominated by long-tail single-theme cards, so a shockland looks wildly
    // "characteristic" of every archetype at once. Brew filters these too.
    return [...out].filter(s => !isIgnoredTag(s));
  };
}

// ─── Scryfall ───

interface ScryCard {
  name: string;
  oracle_id?: string;
  type_line?: string;
  oracle_text?: string;
  keywords?: string[];
  card_faces?: { name?: string; type_line?: string; oracle_text?: string }[];
}

async function fetchCatalogs() {
  const cat = async (p: string): Promise<string[]> => {
    const j = await getJson<{ data?: string[] }>(`${SCRYFALL}/catalog/${p}`);
    await sleep(SCRYFALL_DELAY_MS);
    return j?.data ?? [];
  };
  const abilities = await cat('keyword-abilities');
  const actions = await cat('keyword-actions');
  const words = await cat('ability-words');
  const creatureTypes = await cat('creature-types');
  const artifactTypes = await cat('artifact-types');
  const enchantmentTypes = await cat('enchantment-types');
  return {
    mechanics: new Set([...abilities, ...actions, ...words].map(s => s.toLowerCase())),
    creatureTypes: new Set(creatureTypes.map(s => s.toLowerCase())),
    permanentSubtypes: new Set([...artifactTypes, ...enchantmentTypes].map(s => s.toLowerCase())),
  };
}

/** Resolve card names in batches of 75 via /cards/collection. Unresolved names are dropped. */
async function resolveCards(names: string[]): Promise<Map<string, ScryCard>> {
  const out = new Map<string, ScryCard>();
  for (let i = 0; i < names.length; i += SCRYFALL_BATCH) {
    const chunk = names.slice(i, i + SCRYFALL_BATCH);
    const res = await fetch(`${SCRYFALL}/cards/collection`, {
      method: 'POST',
      headers: { ...HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifiers: chunk.map(n => ({ name: n })) }),
    }).catch(() => null);
    if (res?.ok) {
      const json = (await res.json()) as { data?: ScryCard[] };
      for (const c of json.data ?? []) {
        out.set(c.name, c);
        // EDHREC uses front-face names for DFCs; index both so lookups hit either way.
        if (c.name.includes(' // ')) out.set(c.name.split(' // ')[0], c);
      }
    }
    process.stdout.write(`\r  resolved ${Math.min(i + SCRYFALL_BATCH, names.length)}/${names.length}`);
    await sleep(SCRYFALL_DELAY_MS);
  }
  process.stdout.write('\n');
  return out;
}

// ─── Main ───

async function main() {
  console.log('1/6  EDHREC tag index…');
  const tagsRaw = await getJson<RawPage>(`${EDHREC}/pages/tags.json`);
  if (!tagsRaw) throw new Error('could not fetch EDHREC tag index');
  const tags = parseTags(tagsRaw);
  console.log(`     ${tags.length} tags`);

  console.log('2/6  Scryfall catalogs…');
  const catalogs = await fetchCatalogs();
  // Bail loudly. Empty catalogs classify EVERY theme as archetype, which produces a table that looks
  // fine and is completely wrong — exactly the silent failure this check exists to prevent.
  if (catalogs.mechanics.size === 0 || catalogs.creatureTypes.size === 0) {
    throw new Error('Scryfall catalogs came back empty — refusing to build an all-archetype table');
  }
  const kinds = new Map<string, ThemeKind>();
  for (const t of tags) {
    kinds.set(t.slug, classifyTheme(t.name, catalogs.mechanics, catalogs.creatureTypes, catalogs.permanentSubtypes));
  }
  const byKind: Record<string, number> = {};
  for (const k of kinds.values()) byKind[k.kind] = (byKind[k.kind] ?? 0) + 1;
  console.log(`     ${catalogs.mechanics.size} mechanics, ${catalogs.creatureTypes.size} creature types`);
  console.log(`     kinds: ${Object.entries(byKind).map(([k, n]) => `${k}=${n}`).join(', ')}`);

  console.log('3/6  EDHREC tag pages (this is the slow part)…');
  const themeCards = new Map<string, Set<string>>();
  const universe = new Set<string>();
  const cachedPages = cacheRead<Record<string, string[]>>('theme-pages.json');
  if (cachedPages) {
    for (const [slug, names] of Object.entries(cachedPages)) {
      themeCards.set(slug, new Set(names));
      for (const n of names) universe.add(n);
    }
    console.log(`     cached: ${themeCards.size} pages · universe ${universe.size}`);
  } else {
    let fetched = 0;
    for (const t of tags) {
      // Role themes never become themes anywhere downstream — don't spend a request on them.
      if (kinds.get(t.slug)?.kind === 'role') continue;
      const page = await getJson<RawPage>(`${EDHREC}/pages/tags/${t.slug}.json`);
      await sleep(EDHREC_DELAY_MS);
      fetched++;
      if (!page) continue;
      const names = parsePageCardNames(page);
      if (names.length === 0) continue;
      themeCards.set(t.slug, new Set(names));
      for (const n of names) universe.add(n);
      process.stdout.write(`\r  ${fetched}/${tags.length} pages · universe ${universe.size}`);
    }
    process.stdout.write('\n');
    cacheWrite('theme-pages.json', Object.fromEntries([...themeCards].map(([k, v]) => [k, [...v]])));
  }

  console.log('4/6  Resolving the card universe on Scryfall…');
  const cachedCards = cacheRead<Record<string, ScryCard>>('cards.json');
  const cards = cachedCards
    ? new Map(Object.entries(cachedCards))
    : await resolveCards([...universe]);
  if (!cachedCards && cards.size > 0) cacheWrite('cards.json', Object.fromEntries(cards));
  console.log(`     ${cards.size} resolved`);
  if (cards.size < universe.size / 2) {
    throw new Error(`only ${cards.size}/${universe.size} cards resolved — refusing to build on a broken pool`);
  }

  console.log('5/6  SpellChroma tag index…');
  const dictFile = await getJson<{ tags: TagDictEntry[] }>(`${CHROMA}/spellchroma-tag-dictionary.json`);
  const indexFile = await getJson<{ index: Record<string, number[]> }>(`${CHROMA}/spellchroma-tag-index.json`);
  const tagsFor = dictFile && indexFile
    ? buildTagResolver(dictFile.tags, indexFile.index)
    : () => [];
  if (!dictFile || !indexFile) {
    console.warn('     !! tag index unavailable — archetype themes will get no charTags');
  }

  console.log('6/6  Computing lift and base rates…');
  // One pooled row per resolved card: its oracle tags, and every theme whose page lists it. This is
  // exactly the shape computeThemeCharTags wants, so the lift math has a single implementation
  // shared with brew rather than a copy that can drift.
  const themesByCard = new Map<string, string[]>();
  for (const [slug, names] of themeCards) {
    for (const n of names) {
      const list = themesByCard.get(n);
      if (list) list.push(slug); else themesByCard.set(n, [slug]);
    }
  }
  // Format staples carry no theme information and actively poison lift. A card sitting on most
  // theme pages is "in-theme" for all of them while the pool baseline is diluted by thousands of
  // long-tail single-theme cards, so its tags earn spurious lift everywhere — that's how `burn-you`
  // (which means "this card damages YOU", i.e. the Talisman cycle) ended up defining Zoo.
  //
  // Safe by construction: a card that genuinely defines a theme appears on FEW pages, so this can
  // only ever remove non-defining cards. The Talismans sit on 39-70% of pages; Arcane Signet, 99%.
  const STAPLE_PAGE_SHARE = 0.3;
  const pageCount = new Map<string, number>();
  for (const names of themeCards.values()) for (const n of names) pageCount.set(n, (pageCount.get(n) ?? 0) + 1);
  const staples = new Set(
    [...pageCount].filter(([, c]) => c / themeCards.size > STAPLE_PAGE_SHARE).map(([n]) => n),
  );
  console.log(`     excluding ${staples.size} format staples (on >${STAPLE_PAGE_SHARE * 100}% of theme pages)`);

  const pool: TaggedPoolCard[] = [];
  const resolved: { card: ScryCard; tags: string[] }[] = [];
  for (const [name, themeTags] of themesByCard) {
    const card = cards.get(name);
    if (!card?.oracle_id) continue;
    if (staples.has(name)) continue;
    // Lands are excluded from the whole computation, matching brew's non-land candidate pool.
    // Dual lands sit on nearly every theme page while the pool is mostly long-tail spells, so
    // "shockland" otherwise reads as characteristic of Aristocrats, Voltron and Blink alike. A
    // manabase is not what makes a deck a theme, and the deck-side ratio is non-land too.
    if ((card.type_line ?? '').split('—')[0].toLowerCase().includes('land')) continue;
    const cardTags = tagsFor(card.oracle_id);
    pool.push({ chromaTags: cardTags, themeTags });
    resolved.push({ card, tags: cardTags });
  }
  console.log(`     pool: ${pool.length} non-land cards`);

  const archetypeSlugs = [...themeCards.keys()].filter(s => kinds.get(s)?.kind === 'archetype');

  // Two-pass. Lift alone still lets format-wide staples through: "cast-tax" and
  // "mana-ability-with-extra-effect" landed in >50% of theme definitions on the first run, because
  // staples sit on many theme pages while the pool is mostly long-tail cards. A tag characteristic
  // of most themes is characteristic of none, so compute a wider list, drop the tags that turn out
  // to be near-universal, then truncate. Dropping noise promotes the real tags beneath it.
  const WIDE = 20;
  const UBIQUITY_LIMIT = 0.2;
  const wide = computeThemeCharTags(pool, archetypeSlugs, WIDE);
  const themeCount = Object.values(wide).filter(t => t.length > 0).length || 1;
  const appearsIn = new Map<string, number>();
  for (const list of Object.values(wide)) {
    for (const t of list) appearsIn.set(t, (appearsIn.get(t) ?? 0) + 1);
  }
  const ubiquitous = new Set(
    [...appearsIn].filter(([, n]) => n / themeCount > UBIQUITY_LIMIT).map(([t]) => t),
  );
  console.log(`     dropped ${ubiquitous.size} near-universal tags: ${[...ubiquitous].slice(0, 8).join(', ')}`);
  const charTags: Record<string, string[]> = {};
  for (const [slug, list] of Object.entries(wide)) {
    charTags[slug] = list.filter(t => !ubiquitous.has(t)).slice(0, 8);
  }

  const out: Record<string, { charTags: string[]; baseRate: number }> = {};
  const denom = resolved.length || 1;
  for (const t of tags) {
    const kind = kinds.get(t.slug);
    if (!kind || kind.kind === 'role') continue;
    if (!themeCards.has(t.slug)) continue;

    let members = 0;
    let tagsForTheme: string[] = [];
    if (kind.kind === 'archetype') {
      tagsForTheme = charTags[t.slug] ?? [];
      if (tagsForTheme.length > 0) {
        for (const r of resolved) if (tagsForTheme.some(x => r.tags.includes(x))) members++;
      }
    } else {
      for (const r of resolved) if (themeKindMatches(kind, r.card as never)) members++;
    }
    out[t.slug] = { charTags: tagsForTheme, baseRate: members / denom };
  }

  writeFileSync(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), themes: out }, null, 2) + '\n');
  console.log(`\nWrote ${Object.keys(out).length} themes → src/data/themeCharTags.json`);

  const withTags = Object.values(out).filter(e => e.charTags.length > 0).length;
  console.log(`  ${withTags} archetype themes have characteristic tags`);
  console.log('\nSpot-check:');
  for (const slug of ['aristocrats', 'voltron', 'blink', 'elves', 'lifegain', 'spellslinger', 'humans', 'tokens']) {
    const e = out[slug];
    if (!e) { console.log(`  ${slug.padEnd(14)} —`); continue; }
    const kind = kinds.get(slug)!.kind;
    console.log(`  ${slug.padEnd(14)} ${kind.padEnd(10)} base=${(e.baseRate * 100).toFixed(1)}%  ${e.charTags.join(', ') || '(literal test)'}`);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
