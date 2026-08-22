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
  // The bar was 10, which conflated two different problems. "Matches nothing" is inert; "matches a
  // few" is just a NARROW test, and a narrow literal test beats a statistical one every time.
  // Measured over the pool, the 25 themes it was demoting split cleanly: 8 match exactly zero
  // (keyword actions that never reach card.keywords — discard, sacrifice, exile, voting; subtypes
  // that only exist as tokens — servo, blood, attraction, room), while daleks(4) through exploit(9)
  // are perfectly testable. Demoting those replaced a precise test with a guess: Dredge got
  // lands-and-graveyard vocabulary and scored 65.0 on a deck holding one dredge card.
  //
  // 3 rather than 1, because a type that exists almost exclusively as TOKENS still needs the
  // statistical path — Saprolings has one printed creature in the pool and a real deck of them would
  // match nothing at all.
  const MIN_LITERAL_COVERAGE = 3;
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
  const WIDE = Number(process.env.WIDE ?? 20);
  const UBIQUITY_LIMIT = Number(process.env.UBIQUITY_LIMIT ?? 0.2);

  // brew's CHAR_TAG_MIN_CARRIERS default is 3, tuned against a few-hundred-card per-commander pool.
  // That is far too permissive here: over a 14k-card global pool it left 39% of all (theme, tag)
  // pairs resting on four or fewer cards, which is noise, not a definition. It is how six incidental
  // ramp cards on Umori Companion's page made `tutor-land-to-battlefield` part of its identity, so
  // any deck running Cultivate and Rampant Growth read as Umori.
  //
  // Swept 3/5/8/12/16 against a dozen known-good definitions: 8 is where the false positive dies
  // while every known-good theme keeps its full definition. Past 12 it degrades in the other
  // direction — precise narrow tags fall below the bar and broader generic ones take their slots.
  const MIN_CARRIERS = Number(process.env.MIN_CARRIERS ?? 8);
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

  // SIGNATURE VOCABULARY. A deterministic theme is tested against the card itself and so carries no
  // charTags — which meant nothing stopped an ARCHETYPE from claiming the tag that means the same
  // thing. X Spells' definition held `pp-counters-matter`, `counter-doubler` and `counter-increaser`,
  // the vocabulary of "+1/+1 Counters". On an Ezuri counters deck all 19 of its members matched
  // through those and not one through `x-cost-matters`: it scored 85.6 on a deck containing zero X
  // spells, and reported 75% confidence while the real theme reported 21%.
  //
  // So let each deterministic theme claim its own vocabulary. A tag that describes most of the cards
  // passing a literal test, and hardly any card outside it, belongs to that theme; archetypes may
  // not use it. They keep every tag describing what their cards DO, which is what an archetype is.
  //
  // This is the general form of bugs previously gated one theme at a time: `typal-demon` in
  // Shadowborn Apostles, `typal-rat` in Rat Colony, `typal-dragon` in Dragon's Approach,
  // `synergy-token`/`token-doubler` in Hare Apparent. Fixing the definitions fixes the class.
  //
  // Filtered BEFORE truncation to 8, like the ubiquity pass, so removing a stolen tag promotes the
  // real tag underneath it rather than leaving a hole.
  // Ownership is a question of PRECISION, not recall: are the tag's carriers overwhelmingly this
  // theme's cards? Testing coverage instead ("does the tag describe most Demons") fails, because
  // these tags are sparse by design — `typal-demon` sits on ~24 cards while the format has hundreds
  // of Demons. It means "relevant to Demon decks", not "is a Demon". Precision catches it; recall
  // never will.
  // Precision alone lets a BROAD theme claim everything. "Tokens" is a curated regex covering 17.7%
  // of the pool, so 80% of a tag's carriers making tokens is barely news — it claimed
  // `young-pyromancer-ability` off Spellslinger, because Young Pyromancer, Murmuring Mystic and
  // Docent of Perfection all make tokens. That tag is about CASTING SPELLS; tokens are its
  // consequence. A theme covering more than one card in eight is an ambient mechanic, not a
  // vocabulary owner, so it may claim nothing.
  const SIG_PRECISION = Number(process.env.SIG_PRECISION ?? 0.8);
  // Effectively a backstop now that ownership is lift-based; only Tokens-scale themes reach it.
  const SIG_MAX_BREADTH = Number(process.env.SIG_MAX_BREADTH ?? 0.25);
  // Swept 4-10 against both benchmarks. 10 is the winner at 47.5% weighted vs 44.6% below it, and
  // the whole gap comes from ONE decision: whether +1/+1 Counters (12.1% of the pool) gets to bar
  // the counter family from every archetype. Barring it costs 2.9 points, because counter-doubler,
  // counter-increaser and pp-counters-matter are real vocabulary for many popular themes.
  //
  // Safe to leave unbarred, and structurally so rather than by luck: every card carrying those tags
  // also matches the '+1/+1 counter' regex literally, so evidence-first suppression always hands the
  // deck to the literal theme. Verified on Ezuri -- X Spells (19 members) and Energy (19) are both
  // absorbed by +1/+1 Counters, which survives alone at 70%.
  const SIG_MIN_LIFT = Number(process.env.SIG_MIN_LIFT ?? 10);
  const tagCarriers = new Map<string, string[]>();
  for (const r of resolved) for (const t of r.tags) {
    const list = tagCarriers.get(t);
    if (list) list.push(r.card.name); else tagCarriers.set(t, [r.card.name]);
  }
  const signatures = new Map<string, string>();
  const tooBroad: string[] = [];
  for (const [slug, kind] of kinds) {
    if (kind.kind === 'archetype' || kind.kind === 'role') continue;
    const own = new Set(
      resolved.filter(r => themeKindMatches(kind, r.card as never)).map(r => r.card.name),
    );
    if (own.size < MIN_CARRIERS) continue;
    const breadth = own.size / resolved.length;
    if (breadth > SIG_MAX_BREADTH) {
      tooBroad.push(`${slug} ${(breadth * 100).toFixed(1)}%`);
      continue;
    }
    for (const [t, carriers] of tagCarriers) {
      if (carriers.length < MIN_CARRIERS || signatures.has(t)) continue;
      const precision = carriers.filter(n => own.has(n)).length / carriers.length;
      if (precision < SIG_PRECISION) continue;
      // Precision alone rewards BREADTH: 80% of a tag's carriers making tokens is barely news when
      // 17.7% of the pool makes tokens. Dividing by the theme's own breadth asks the real question --
      // how much more concentrated in this theme is the tag than chance would give. It separates
      // `pp-counters-matter` (precision ~1.0 over a 12.1% theme, lift 8.3) from
      // `young-pyromancer-ability` (~0.9 over a 17.7% theme, lift 5.1), which a single breadth
      // ceiling cannot: any cutoff admitting the first also admits the second.
      if (precision / breadth < SIG_MIN_LIFT) continue;
      signatures.set(t, slug);
    }
  }
  console.log(`     ${tooBroad.length} themes too broad to own vocabulary: ${tooBroad.join(', ')}`);
  console.log(`     ${signatures.size} tags claimed by deterministic themes, barred from archetypes`);
  for (const [t, owner] of [...signatures].slice(0, 12)) console.log(`        ${t} → ${owner}`);

  // PROVENANCE. Tags describing where a card came from rather than what it does. Lift loves them
  // because they mark small, rare sets, so a couple of carriers on one theme page earns a huge
  // ratio — that's how `40k-model` became part of X Spells' identity. Root tags with no parents, so
  // there's no subtree to exclude; the list is short and explicit.
  const PROVENANCE = new Set(['40k-model', 'meme', 'draft-signpost', 'custom-cards']);

  const charTags: Record<string, string[]> = {};
  for (const [slug, list] of Object.entries(wide)) {
    charTags[slug] = list
      .filter(t => !ubiquitous.has(t) && !PROVENANCE.has(t) && !signatures.has(t))
      .slice(0, Number(process.env.MAX_TAGS ?? 8));
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

  // Swept 0 to 0.10 with an HONEST denominator -- an inert theme counts as a failure to detect it,
  // because otherwise pruning a hard theme raises accuracy by shrinking the denominator and every
  // pruning experiment looks like a free win. (It did: 0.06 appeared to gain 8 points of weighted
  // accuracy and actually lost 2.)
  //
  // With that fixed, pruning buys no recall at all. 0.035 is kept because it is exactly FREE --
  // identical robust/deterministic/archetype accuracy and identical fixtures -- while cutting the
  // noise survivors that appear on every deck: Custom Cards, Premodern, Aggro, Good Stuff, Vanilla,
  // Zoo. Mean survivors on themeless decks 4.8 -> 4.1.
  //
  // Deliberately not higher. 0.045 costs 1.2 points of archetype accuracy, and 0.10 would take
  // Aristocrats (9.2%), Reanimator (8.3%) and Control (6.7%) -- real strategies whose definitions are
  // broad because the strategies are.
  const DEF_MIN_PRECISION = Number(process.env.DEF_MIN_PRECISION ?? 0.035);
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
      // OWN-VOCABULARY CHECK, for demoted themes only. A theme demoted here names a concrete thing —
      // a creature type, a subtype, a keyword — so if lift found no tag that even mentions it, lift
      // did not describe the theme. It described whatever deck happens to play it, and shipping that
      // makes a confident detector for the wrong strategy.
      //
      // Hippos is the case that proves it. EDHREC's Hippos page is dominated by Phelddagrif, so its
      // definition came out `group-hug, force-draw, toll, donate-token, selective-group-hug,
      // symmetrical, hate-attacker, tax` — an entire group-hug deck, no hippo anywhere. It matched 18
      // cards on a Niv-Mizzet WHEELS list (Howling Mine, Temple Bell, Font of Mythos) and absorbed
      // Wheels outright. Better inert and undetectable than confidently wrong.
      //
      // Not applied to genuine archetypes: "Aristocrats" has no tag containing "aristocrat" and
      // never will, because the name is a nickname rather than a thing printed on cards.
      if (forceArchetype.includes(t.slug)) {
        const stem = t.slug.replace(/ies$/, 'y').replace(/s$/, '');
        if (!tagsForTheme.some(x => x.includes(stem))) {
          console.log(`     ${t.slug}: no tag mentions "${stem}" → inert (was ${tagsForTheme.join(', ')})`);
          tagsForTheme = [];
        }
      }
      if (tagsForTheme.length > 0) {
        // DEFINITION PRECISION. Does the definition select the theme's OWN cards, or something much
        // broader? baseRate only measures how MANY cards a definition matches, never WHICH: two
        // definitions covering 5% of the pool score identically whether that 5% is the theme's cards
        // or a different 5% entirely. So measure the overlap directly.
        //
        // It cleanly separates real strategies from the taxonomy's non-strategies. Blink scores 37.6%,
        // Stax 38.3%, Exile 30.5%, Lands Matter 23.2% — while Custom Cards manages 0.6%, Premodern
        // 2.3%, Vanilla 3.3%, Aggro 3.4%, Midrange 4.1%, Combo 4.2%. That second group are format
        // names and meta-descriptors rather than plans, and they were surfacing as low-confidence
        // survivors on every deck: Old School, Premodern, Rube Goldberg, Value Vintage, cEDH.
        const page = themeCards.get(t.slug);
        let hit = 0, onPage = 0;
        for (const r of resolved) {
          if (!tagsForTheme.some(x => r.tags.includes(x))) continue;
          hit++;
          if (page?.has(r.card.name)) onPage++;
        }
        const precision = hit > 0 ? onPage / hit : 0;
        if (precision < DEF_MIN_PRECISION) {
          console.log(`     ${t.slug}: definition precision ${(precision * 100).toFixed(1)}% → inert`);
          tagsForTheme = [];
        } else {
          members = hit;
        }
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
    // Emitted so deck scoring can exclude the same cards the definitions excluded. They were only
    // filtered on the definition side, which left the two halves inconsistent: a card carrying no
    // theme information was barred from DEFINING a theme but still allowed to be EVIDENCE for one.
    // A deck of nothing but staples therefore scored Tron at 61% confidence, because Tron's
    // definition (synergy-colorless, refund, untaps-self) is an accurate description of every mana
    // rock in the format.
    staples: [...staples].sort(),
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
