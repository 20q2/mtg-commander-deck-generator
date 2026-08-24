/**
 * LIVE DIAGNOSTIC for a Glissa stax/prison deck reporting NO theme — skipped unless VITE_LIVE_DIAG=1.
 *
 *   VITE_LIVE_DIAG=1 node node_modules/vitest/vitest.mjs run src/services/deckBuilder/__tests__/glissaDiag.diag.test.ts
 *
 * The deck is unambiguously Stax by eye — Winter Orb, Static Orb, Smokestack, Tangle Wire,
 * Trinisphere, Nether Void, Contamination, Braids, Meekstone, Freyalise's Winds. "Themeless" means
 * one of four things and this prints enough to tell them apart:
 *   1. the classifier never scored the theme (no model, or zero members),
 *   2. it scored it but a gate or the nesting suppression dropped it,
 *   3. it survived but never reached the shortlist the composite scores,
 *   4. it was scored and simply fell under the 30-point declaration threshold.
 */
import { describe, it, expect } from 'vitest';
import {
  buildThemeModel, scoreThemesForDeck, survivingThemes, loadThemeCharTags, SHORTLIST_SIZE,
} from '@/services/themes';
import { detectThemes, scoreThemeMatch } from '../themeDetector';
import { parseTagsIndex } from '@/services/edhrec/client';
import type { EDHRECCommanderData, EDHRECTag, EDHRECTheme, ScryfallCard } from '@/types';
import type { MtgCatalogs } from '@/services/scryfall/client';

const H = { 'User-Agent': 'ManaFoundry/1.0', Accept: 'application/json' };
const S3 = 'https://mtg-deck-builder-tagger.s3.amazonaws.com';
const COMMANDER = 'Glissa, Herald of Predation';
const SLUG = 'glissa-herald-of-predation';

const DECK = `Altar of the Brood|Arcane Signet|Birds of Paradise|Boseiju, Who Endures|Braids, Arisen Nightmare|Braids, Cabal Minion|Command Tower|Contamination|Creeping Bloodsucker|Darkmoss Bridge|Dauthi Voidwalker|Dense Foliage|Dockside Chef|Earthcraft|Eldrazi Monument|Elves of Deep Shadow|Forest|Freyalise's Winds|Garruk Wildspeaker|Glissa, Herald of Predation|Haywire Mite|Inspiring Statuary|Inventors' Fair|Jaheira, Friend of the Forest|Lithoform Engine|Llanowar Elves|Maze of Ith|Meekstone|Nether Void|Overgrown Tomb|Overgrowth|Phyrexian Tower|Priest of Titania|Sakura-Tribe Elder|Sarinth Steelseeker|Sheoldred, the Apocalypse|Smokestack|Static Orb|Sun Droplet|Swamp|Tainted Æther|Takenuma, Abandoned Mire|Tangle Wire|Teething Wurmlet|Tendershoot Dryad|The Mycotyrant|Tomb of the Spirit Dragon|Trinisphere|Twilight Prophet|Undergrowth Stadium|Underhanded Designs|Urborg, Tomb of Yawgmoth|Volrath's Stronghold|Wild Growth|Winter Orb|Yavimaya Hollow|Yavimaya, Cradle of Growth`.split('|');

/** Themes the deck obviously IS, by eye — printed with full detail whatever they scored. */
const EXPECTED = ['stax', 'artifacts', 'incubate', 'prison', 'sacrifice', 'lands', 'tokens'];

const pct = (c: { num_decks?: number; potential_decks?: number }) =>
  c.potential_decks && c.potential_decks > 0 ? ((c.num_decks ?? 0) / c.potential_decks) * 100 : 0;

async function page(url: string): Promise<EDHRECCommanderData | null> {
  const res = await fetch(url, { headers: H });
  if (!res.ok) return null;
  const j = await res.json();
  const lists = j.container?.json_dict?.cardlists ?? [];
  const allNonLand: unknown[] = [];
  const lands: unknown[] = [];
  for (const l of lists) {
    if (/commanders/i.test(l.header)) continue;
    const bucket = /land/i.test(l.header) ? lands : allNonLand;
    for (const c of l.cardviews) bucket.push({ name: c.name, inclusion: pct(c), synergy: c.synergy ?? 0 });
  }
  return {
    themes: [], similarCommanders: [],
    stats: { numDecks: j.container?.json_dict?.card?.num_decks ?? 0 },
    cardlists: { allNonLand, lands },
  } as unknown as EDHRECCommanderData;
}

describe.skipIf(import.meta.env.VITE_LIVE_DIAG !== '1')('Glissa: why themeless', () => {
  it('attributes the empty result', async () => {
    // ── deck ──
    const cards: ScryfallCard[] = [];
    for (let i = 0; i < DECK.length; i += 70) {
      const r = await fetch('https://api.scryfall.com/cards/collection', {
        method: 'POST', headers: { ...H, 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifiers: DECK.slice(i, i + 70).map(name => ({ name })) }),
      });
      const j = await r.json();
      cards.push(...(j.data ?? []));
      if (j.not_found?.length) {
        console.log('NOT FOUND:', j.not_found.map((n: { name: string }) => n.name).join(', '));
      }
    }
    console.log(`\ndeck resolved ${cards.length} of ${DECK.length} names`);

    // ── SpellChroma tags, replicating tagsForOracleId including the ancestor walk ──
    const dictFile = await (await fetch(`${S3}/spellchroma-tag-dictionary.json`)).json();
    const idxFile = await (await fetch(`${S3}/spellchroma-tag-index.json`)).json();
    const dict: { s: string; p?: string[] }[] = dictFile.tags;
    const index: Record<string, number[]> = idxFile.index;
    const tagBySlug = new Map(dict.map(e => [e.s, e]));
    const walk = (slug: string, out: Set<string>) => {
      for (const p of tagBySlug.get(slug)?.p ?? []) {
        if (out.has(p)) continue;
        out.add(p);
        walk(p, out);
      }
    };
    const tagsFor = (c: ScryfallCard): readonly string[] => {
      const ids = index[c.oracle_id];
      if (!ids) return [];
      const out = new Set<string>();
      for (const i of ids) {
        const e = dict[i];
        if (!e) continue;
        out.add(e.s);
        walk(e.s, out);
      }
      return [...out];
    };
    const untagged = cards.filter(c => tagsFor(c).length === 0);
    console.log(`${cards.length - untagged.length} of ${cards.length} carry oracle tags`);
    if (untagged.length) console.log(`  untagged: ${untagged.map(c => c.name).join(', ')}`);

    // The stax pieces specifically — if these carry no usable tags, no archetype theme can find them.
    const STAX = ['Winter Orb', 'Static Orb', 'Smokestack', 'Tangle Wire', 'Trinisphere',
      'Nether Void', 'Contamination', 'Braids, Cabal Minion', 'Meekstone', "Freyalise's Winds"];
    console.log('\nstax pieces and their tags:');
    for (const name of STAX) {
      const c = cards.find(x => x.name === name);
      console.log(`  ${name.padEnd(24)} ${c ? tagsFor(c).join(', ') || '(none)' : '(not in deck)'}`);
    }

    // ── models ──
    const cat = async (n: string) =>
      ((await (await fetch(`https://api.scryfall.com/catalog/${n}`, { headers: H })).json()).data ?? []) as string[];
    const [ab, ac, wo, ct, at, et] = await Promise.all([
      cat('keyword-abilities'), cat('keyword-actions'), cat('ability-words'),
      cat('creature-types'), cat('artifact-types'), cat('enchantment-types'),
    ]);
    const catalogs: MtgCatalogs = {
      mechanics: new Set([...ab, ...ac, ...wo].map(s => s.toLowerCase())),
      creatureTypes: new Set(ct.map(s => s.toLowerCase())),
      permanentSubtypes: new Set([...at, ...et].map(s => s.toLowerCase())),
    };
    const tags: EDHRECTag[] = parseTagsIndex(
      await (await fetch('https://json.edhrec.com/pages/tags.json', { headers: H })).json(),
    );
    const table = loadThemeCharTags();
    const models = tags.map(t => buildThemeModel(t, catalogs, table.themes, new Set(table.forceArchetype ?? [])));
    console.log(`\n${models.length} theme models built`);
    for (const slug of EXPECTED) {
      const m = models.find(x => x.slug === slug);
      console.log(`  ${slug.padEnd(12)} ${m ? `kind=${m.kind.kind} charTags=[${m.charTags.join(', ')}] baseRate=${m.baseRate}` : 'NO MODEL — not in EDHREC tags.json'}`);
    }

    const baseRes = await fetch(`https://json.edhrec.com/pages/commanders/${SLUG}.json`, { headers: H });
    console.log(`\ncommander page: ${baseRes.status}`);
    const base = baseRes.ok ? await baseRes.json() : {};
    const commanderThemes: EDHRECTheme[] = (base.panels?.taglinks ?? [])
      .map((t: { value: string; slug: string; count: number }) => ({ name: t.value, slug: t.slug, count: t.count, url: '' }))
      .sort((a: EDHRECTheme, b: EDHRECTheme) => b.count - a.count);
    console.log(`taglinks: ${commanderThemes.map(t => `${t.slug}(${t.count})`).join(', ') || '(none)'}`);
    console.log(`page decks: ${base.container?.json_dict?.card?.num_decks ?? '(absent)'}`);

    // ── Phase A: the classifier ──
    const scored = scoreThemesForDeck(
      cards, models, tagsFor, new Set(commanderThemes.map(t => t.slug)), undefined,
      new Set(table.staples ?? []), cards.find(c => c.name === COMMANDER) ?? null,
    );
    const bySlug = new Map(scored.map(s => [s.model.slug, s]));
    const survivors = survivingThemes(scored);
    const survivorSlugs = new Set(survivors.map(s => s.model.slug));

    console.log('\nCLASSIFIER top 12:');
    for (const s of survivors.slice(0, 12)) {
      console.log(`  ${s.model.name.padEnd(24)} ${s.model.kind.kind.padEnd(10)} score=${s.membershipScore.toFixed(1).padStart(6)} members=${String(s.members).padStart(3)} ratio=${(s.ratio * 100).toFixed(0).padStart(3)}% conf=${s.confidence}%`);
    }

    console.log('\nEXPECTED themes, full detail:');
    for (const slug of EXPECTED) {
      const s = bySlug.get(slug);
      if (!s) { console.log(`  ${slug.padEnd(12)} NOT SCORED (no model)`); continue; }
      const why = s.gateMissing
        ? `GATED (${s.gateMissing.kind} "${s.gateMissing.subject}" need ${s.gateMissing.need} have ${s.gateMissing.have})`
        : !s.passedFloor ? 'BELOW FLOOR'
          : !survivorSlugs.has(slug) ? 'SUPPRESSED (nested under a rival)'
            : 'survived';
      console.log(`  ${slug.padEnd(12)} ${why.padEnd(52)} members=${String(s.members).padStart(3)} ratio=${(s.ratio * 100).toFixed(0)}% o/e=${s.observedOverExpected.toFixed(1)} score=${s.membershipScore.toFixed(1)}`);
      if (s.members > 0) console.log(`      ${s.memberCards.slice(0, 12).map(m => `${m.name}[${m.basis[0]}]`).join(', ')}`);
    }

    // ── Composite: the shortlist the Inspector actually scores ──
    const top = commanderThemes.slice(0, 8);
    const extras = survivors
      .filter(s => !top.some(t => t.slug === s.model.slug)).slice(0, SHORTLIST_SIZE)
      .map(s => ({ name: s.model.name, slug: s.model.slug, count: s.model.numDecks, url: '' }));
    const shortlist = [...top, ...extras];
    console.log(`\nSHORTLIST (${shortlist.length}): ${shortlist.map(t => t.slug).join(', ')}`);
    for (const slug of EXPECTED) {
      if (!shortlist.some(t => t.slug === slug)) console.log(`  !! ${slug} is NOT on the shortlist — it can never be declared`);
    }

    const dataMap = new Map<string, EDHRECCommanderData>();
    for (const t of shortlist) {
      const d = await page(`https://json.edhrec.com/pages/commanders/${SLUG}/${t.slug}.json`)
        ?? await page(`https://json.edhrec.com/pages/tags/${t.slug}.json`);
      if (d) dataMap.set(t.slug, d);
      else console.log(`  no page for ${t.slug} — dropped from scoring`);
    }

    console.log('\nCOMPOSITE (unweighted terms; declared needs >= 30):');
    console.log('  theme                 score  overlap   incl   memb  pageDecks  members');
    const rows = shortlist.map(t => {
      const d = dataMap.get(t.slug);
      if (!d) return null;
      const r = scoreThemeMatch(t, d, cards, bySlug.get(t.slug), true);
      return { name: t.name, r };
    }).filter(Boolean) as { name: string; r: ReturnType<typeof scoreThemeMatch> }[];
    rows.sort((a, b) => b.r.score - a.r.score);
    for (const { name, r } of rows) {
      console.log(`  ${name.slice(0, 20).padEnd(21)}${r.score.toFixed(1).padStart(6)}${r.components.overlap.toFixed(0).padStart(9)}${r.components.inclusion.toFixed(0).padStart(7)}${r.components.membership.toFixed(0).padStart(7)}${String(r.components.pageDecks).padStart(11)}${String(r.memberCount).padStart(9)}`);
    }

    const det = detectThemes(shortlist, dataMap, cards, [], COMMANDER, bySlug);
    console.log('\nDECLARED:', det.matchedThemes.map(m => `${m.theme.name} (${m.score})`).join(' + ') || '(NONE)');
    expect(cards.length).toBeGreaterThan(40);
  }, 600000);
});
