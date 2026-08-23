/**
 * LIVE DIAGNOSTIC for the Nath inconsistency — skipped unless VITE_LIVE_DIAG=1.
 *
 *   VITE_LIVE_DIAG=1 node node_modules/vitest/vitest.mjs run src/services/deckBuilder/__tests__/nathDiag.diag.test.ts
 *
 * /theme-lab reports Elves + Discard on this deck; the picker and Inspector report Combo + Stax.
 * The lab shows the CLASSIFIER's ranking (Phase A alone); the other two show the COMPOSITE, in which
 * the classifier is one term of three. This prints both, plus each composite term, so the
 * disagreement is attributable rather than guessed at.
 *
 * Loads SpellChroma's tag dictionary and index straight from S3 and replicates tagsForOracleId,
 * including the ancestor walk — otherwise archetype themes find no members under Node and the
 * harness cannot reproduce the lab at all.
 */
import { describe, it, expect } from 'vitest';
import {
  buildThemeModel, scoreThemesForDeck, survivingThemes, loadThemeCharTags,
  OVERLAP_WEIGHT, INCLUSION_WEIGHT, MEMBERSHIP_WEIGHT,
} from '@/services/themes';
import { detectThemes, scoreThemeMatch } from '../themeDetector';
import { parseTagsIndex } from '@/services/edhrec/client';
import type { EDHRECCommanderData, EDHRECTag, EDHRECTheme, ScryfallCard } from '@/types';
import type { MtgCatalogs } from '@/services/scryfall/client';

const H = { 'User-Agent': 'ManaFoundry/1.0', Accept: 'application/json' };
const S3 = 'https://mtg-deck-builder-tagger.s3.amazonaws.com';
const COMMANDER = 'Nath of the Gilt-Leaf';
const SLUG = 'nath-of-the-gilt-leaf';

const DECK = `Nath of the Gilt-Leaf|Ral Zarek, Guest Lecturer|Birds of Paradise|Elves of Deep Shadow|Elvish Mystic|Fyndhorn Elves|Llanowar Elves|Elderfang Disciple|Fiend Artisan|Orcish Bowmasters|Priest of Titania|Braids, Arisen Nightmare|Elvish Archdruid|Ezuri, Renegade Leader|Marwyn, the Nurturer|Opposition Agent|Rankle, Master of Pranks|Sadistic Hypnotist|Chalice of the Void|Skullclamp|Lightning Greaves|Tangle Wire|Geth's Grimoire|Bottomless Pit|Oppression|Crop Rotation|Vampiric Tutor|Worldly Tutor|Assassin's Trophy|Heroic Intervention|Chord of Calling|Demonic Tutor|Finale of Devastation|Dark Deal|Death Cloud|Bayou|Bloodstained Mire|Boseiju, Who Endures|Cavern of Souls|Command Tower|Forest|Gilt-Leaf Palace|Llanowar Wastes|Nurturing Peatland|Overgrown Tomb|Phyrexian Tower|Swamp|Takenuma, Abandoned Mire|Twilight Mire|Undergrowth Stadium|Urborg, Tomb of Yawgmoth|Verdant Catacombs|Woodland Cemetery|Yavimaya, Cradle of Growth`.split('|');

const pct = (c: { num_decks?: number; potential_decks?: number }) =>
  c.potential_decks && c.potential_decks > 0 ? ((c.num_decks ?? 0) / c.potential_decks) * 100 : 0;

async function page(url: string, numDecks?: number): Promise<EDHRECCommanderData | null> {
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
    stats: { numDecks: numDecks ?? j.container?.json_dict?.card?.num_decks ?? 0 },
    cardlists: { allNonLand, lands },
  } as unknown as EDHRECCommanderData;
}

describe.skipIf(import.meta.env.VITE_LIVE_DIAG !== '1')('Nath: lab vs composite', () => {
  it('attributes the disagreement', async () => {
    // ── deck ──
    const cards: ScryfallCard[] = [];
    for (let i = 0; i < DECK.length; i += 70) {
      const r = await fetch('https://api.scryfall.com/cards/collection', {
        method: 'POST', headers: { ...H, 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifiers: DECK.slice(i, i + 70).map(name => ({ name })) }),
      });
      const j = await r.json();
      cards.push(...(j.data ?? []));
    }
    expect(cards.length).toBeGreaterThan(45);

    // ── SpellChroma tags, replicating tagsForOracleId including the ancestor walk ──
    const dictFile = await (await fetch(`${S3}/spellchroma-tag-dictionary.json`)).json();
    const idxFile = await (await fetch(`${S3}/spellchroma-tag-index.json`)).json();
    const dict: { s: string; p?: string[] }[] = dictFile.tags;
    const index: Record<string, number[]> = idxFile.index;
    const bySlug = new Map(dict.map(e => [e.s, e]));
    const walk = (slug: string, out: Set<string>) => {
      for (const p of bySlug.get(slug)?.p ?? []) {
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
    const tagged = cards.filter(c => tagsFor(c).length > 0).length;
    console.log(`\ndeck ${cards.length} cards, ${tagged} carry oracle tags`);

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

    const base = await (await fetch(`https://json.edhrec.com/pages/commanders/${SLUG}.json`, { headers: H })).json();
    const commanderThemes: EDHRECTheme[] = (base.panels?.taglinks ?? [])
      .map((t: { value: string; slug: string; count: number }) => ({ name: t.value, slug: t.slug, count: t.count, url: '' }))
      .sort((a: EDHRECTheme, b: EDHRECTheme) => b.count - a.count);

    // ── Phase A: what /theme-lab shows ──
    const scored = scoreThemesForDeck(
      cards, models, tagsFor, new Set(commanderThemes.map(t => t.slug)), undefined,
      new Set(table.staples ?? []), cards.find(c => c.name === COMMANDER) ?? null,
    );
    console.log('\nCLASSIFIER (what /theme-lab ranks on):');
    for (const s of survivingThemes(scored).slice(0, 8)) {
      console.log(`  ${s.model.name.padEnd(22)} ${s.model.kind.kind.padEnd(10)} score=${s.membershipScore.toFixed(1).padStart(6)} members=${String(s.members).padStart(3)} ratio=${(s.ratio * 100).toFixed(0)}% conf=${s.confidence}%`);
    }

    // ── Composite: what the picker and Inspector show ──
    const membership = new Map(scored.map(s => [s.model.slug, s]));
    const top = commanderThemes.slice(0, 8);
    const extras = survivingThemes(scored)
      .filter(s => !top.some(t => t.slug === s.model.slug)).slice(0, 6)
      .map(s => ({ name: s.model.name, slug: s.model.slug, count: s.model.numDecks, url: '' }));
    const shortlist = [...top, ...extras];

    const dataMap = new Map<string, EDHRECCommanderData>();
    for (const t of shortlist) {
      const d = await page(`https://json.edhrec.com/pages/commanders/${SLUG}/${t.slug}.json`)
        ?? await page(`https://json.edhrec.com/pages/tags/${t.slug}.json`);
      if (d) dataMap.set(t.slug, d);
    }

    console.log('\nCOMPOSITE (what the picker and Inspector show) — terms shown weighted:');
    console.log('  theme                  score   overlapTerm  inclTerm  membTerm  pageDecks');
    const rows = shortlist.map(t => {
      const d = dataMap.get(t.slug);
      if (!d) return null;
      const m = membership.get(t.slug);
      const r = scoreThemeMatch(t, d, cards, m, true);
      // Recompute the terms to attribute the score.
      const nonBasic = cards.filter(c => !/^(Forest|Swamp|Island|Mountain|Plains)$/.test(c.name)).length;
      // Graded credit, mirroring scoreThemeMatch, so the raw ratio is visible pre-cap.
      const decks = (d.stats as { numDecks?: number })?.numDecks ?? 0;
      const conf = decks > 0 ? decks / (decks + 12) : 1;
      const names = new Map<string, { inclusion: number; synergy?: number }>();
      for (const c of [...d.cardlists.allNonLand, ...d.cardlists.lands]) names.set((c as { name: string }).name, c as never);
      let credit = 0;
      for (const c of cards) {
        const hit = names.get(c.name);
        if (!hit) continue;
        const reach = Math.min(Math.max((hit.synergy ?? 0) * conf, 0) / 0.25, 1);
        credit += 0.25 + 0.75 * reach;
      }
      const rawRatio = credit / nonBasic;
      const overlapScore = Math.min(rawRatio * 150, 100);
      const weighted = Math.min((r.weightedOverlap / (r.cardOverlap > 0 ? r.cardOverlap * 50 : 1)) * 100, 100) * conf;
      return {
        name: t.name, score: r.score,
        o: overlapScore * OVERLAP_WEIGHT, i: weighted * INCLUSION_WEIGHT,
        m: (m?.membershipScore ?? 0) * MEMBERSHIP_WEIGHT,
        decks, rawRatio, credit, hits: r.cardOverlap,
      };
    }).filter(Boolean) as { name: string; score: number; o: number; i: number; m: number; decks: number; rawRatio: number; credit: number; hits: number }[];
    rows.sort((a, b) => b.score - a.score);
    console.log('  (rawRatio is credit/deckSize BEFORE the x150 boost and the 100 cap)');
    for (const r of rows.slice(0, 10)) {
      console.log(`  ${r.name.padEnd(22)}${r.score.toFixed(1).padStart(6)}${r.o.toFixed(1).padStart(13)}${r.i.toFixed(1).padStart(10)}${r.m.toFixed(1).padStart(10)}${String(r.decks).padStart(11)}   hits=${String(r.hits).padStart(2)} credit=${r.credit.toFixed(1).padStart(5)} rawRatio=${(r.rawRatio * 100).toFixed(0)}%`);
    }

    const det = detectThemes(shortlist, dataMap, cards, [], COMMANDER, membership);
    console.log('\nDECLARED:', det.matchedThemes.map(m => `${m.theme.name} (${m.score})`).join(' + ') || '(none)');
    expect(rows.length).toBeGreaterThan(0);
  }, 300000);
});
