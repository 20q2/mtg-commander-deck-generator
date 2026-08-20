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

/**
 * Tag roots whose entire subtree describes a card's JOB rather than a deck's strategy.
 *
 * This is `ROLE_THEME_NAMES` one level down. That list exists because "Ramp" and "Card Draw" are
 * roles, not strategies, and their EDHREC pages list what such decks *play*; the same is true of the
 * tags. A ramp spell reads "search your library for a land and put it onto the battlefield", so
 * `tutor-to-battlefield` matched every ramp card in the format and made Birthing Pod — whose page
 * is naturally tutor-heavy — the top theme for any deck running Cultivate and Rampant Growth.
 *
 * Kept to three ROOTS rather than a list of tags because the tag dictionary's own parent links do
 * the work: `tutor-mv`, `tutor-card`, `tutor-to-battlefield` and `tutor-land-basic` all descend
 * from `tutor`, and `mana-dork` from `mana-producer` from `ramp`. Frequency filtering cannot
 * substitute — `tutor-land-basic` appears in exactly one definition, so it is not ubiquitous, just
 * wrong for that theme.
 *
 * Deliberately narrow. Adding `removal` and `card-advantage` also tests clean on the obvious cases
 * but strips Wheels and Impulse Draw of their real definitions, so they stay in.
 *
 * `life-payment` and `fun-ruling` are here for the same reason, one category over. Paying life is a
 * COST ("Cards that cost life to use"), not a plan — it put Phyrexian Arena, Read the Bones and
 * Golgari Signet into Combo's definition, so any black deck matched. `fun-ruling` ("rulings where
 * the rules manager is having fun with us") is pure trivia. Excluding the roots takes their
 * subtrees too, so `alternate-cost-life` goes with `life-payment`.
 */
const ROLE_TAG_ROOTS = new Set(['tutor', 'ramp', 'cost-reducer', 'life-payment', 'fun-ruling']);

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
    //
    // Role-subtree tags go with them: a card's job is not a deck's strategy (see ROLE_TAG_ROOTS).
    const roleTagged = (slug: string): boolean => {
      if (ROLE_TAG_ROOTS.has(slug)) return true;
      const up = new Set<string>();
      ancestors(slug, up);
      for (const a of up) if (ROLE_TAG_ROOTS.has(a)) return true;
      return false;
    };
    return [...out].filter(s => !isIgnoredTag(s) && !roleTagged(s));
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

/** Is any face of this card a land? Card types are the words before the em-dash. */
function isLandCard(c: ScryCard): boolean {
  const lines = [c.type_line ?? '', ...(c.card_faces ?? []).map(f => f.type_line ?? '')];
  // The combined type_line of a DFC is "Front // Back", so split on // as well as the em-dash.
  return lines.some(l => l.split('//').some(part => part.split('—')[0].toLowerCase().includes('land')));
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

  // COVERAGE ASSERTION. A deterministic theme whose literal test matches (almost) no real card is
  // inert, and — this is the part that made it dangerous — indistinguishable at runtime from "this
  // deck happens to have none of them". Nothing checked, so Discard shipped matching zero cards.
  //
  // Measured against the actual pool rather than reasoned about, because the causes are varied:
  // keyword actions that never reach card.keywords (discard, sacrifice, exile, vote), token-only
  // types with no cards to match (servo, blood), and keywords too rare in the pool to seed a
  // definition (phasing, dredge). Anything under the bar becomes an archetype so the statistical
  // path can carry it.
  const MIN_LITERAL_COVERAGE = 10;
  const nonLandCards = [...cards.values()].filter(c => !isLandCard(c));
  const forceArchetype: string[] = [];
  for (const [slug, kind] of kinds) {
    if (kind.kind === 'role' || kind.kind === 'archetype') continue;
    let hits = 0;
    for (const c of nonLandCards) {
      if (themeKindMatches(kind, c as never) && ++hits >= MIN_LITERAL_COVERAGE) break;
    }
    if (hits < MIN_LITERAL_COVERAGE) {
      forceArchetype.push(slug);
      kinds.set(slug, { kind: 'archetype' });
    }
  }
  if (forceArchetype.length > 0) {
    console.log(`     ${forceArchetype.length} themes have <${MIN_LITERAL_COVERAGE} literal matches → archetype: ${forceArchetype.join(', ')}`);
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
    //
    // EVERY face, not just the front: the Zendikar Rising modal DFCs (Kazandu Mammoth, Glasspool
    // Mimic, …) are creatures on the front and lands on the back, and they carry their back face's
    // manabase tags. Checking only the front let `tapland` and `boltland` through — which is how
    // they ended up in the definition of All-Spells, an archetype that runs no lands at all.
    if (isLandCard(card)) continue;
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

  // brew's CHAR_TAG_MIN_CARRIERS default is 3, tuned against a few-hundred-card per-commander pool.
  // That is far too permissive here: over a 14k-card global pool it left 39% of all (theme, tag)
  // pairs resting on four or fewer cards, which is noise, not a definition. It is how six incidental
  // ramp cards on Umori Companion's page made `tutor-land-to-battlefield` part of its identity, so
  // any deck running Cultivate and Rampant Growth read as Umori.
  //
  // Swept 3/5/8/12/16 against a dozen known-good definitions: 8 is where the false positive dies
  // while every known-good theme keeps its full definition. Past 12 it degrades in the other
  // direction — precise narrow tags fall below the bar and broader generic ones take their slots.
  const MIN_CARRIERS = 8;
  const wide = computeThemeCharTags(pool, archetypeSlugs, WIDE, MIN_CARRIERS);
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

  // ANCHOR CARDS. A companion theme can't be declared without its companion actually in the deck:
  // an all-creature pile really does satisfy Umori's restriction, and its theme data is useful for
  // scoring, but it isn't an Umori deck without Umori.
  //
  // Derived from Scryfall's own `Companion` keyword — the ten companion cards carry it, and the
  // theme name's leading word says which one ("Umori Companion" → "Umori, the Collector"). No list.
  const companionCards = [...cards.values()]
    .filter(c => (c.keywords ?? []).some(k => k.toLowerCase() === 'companion'));
  const anchors: Record<string, string> = {};
  for (const t of tags) {
    const m = /^(.*?)\s+companion$/i.exec(t.name.trim());
    if (!m) continue;
    const lead = m[1].trim().toLowerCase();
    const card = companionCards.find(c => c.name.toLowerCase().startsWith(lead));
    if (card) anchors[t.slug] = card.name;
  }
  console.log(`     ${Object.keys(anchors).length} anchor-gated themes: ${Object.entries(anchors).map(([s, c]) => `${s}→${c.split(',')[0]}`).join(', ')}`);

  const out: Record<string, { charTags: string[]; baseRate: number; anchor?: string }> = {};
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
    out[t.slug] = { charTags: tagsForTheme, baseRate: members / denom, ...(anchors[t.slug] ? { anchor: anchors[t.slug] } : {}) };
  }

  writeFileSync(OUT, JSON.stringify({
    generatedAt: new Date().toISOString(),
    themes: out,
    forceArchetype: forceArchetype.sort(),
  }, null, 2) + '\n');
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
