/**
 * NEGATIVE CONTROL for the classifier's declaration floor — skipped unless VITE_LIVE_DIAG=1.
 *
 *   VITE_LIVE_DIAG=1 node node_modules/vitest/vitest.mjs run src/services/deckBuilder/__tests__/themelessControl.diag.test.ts
 *
 * A Glissa prison deck reported NO theme: the classifier ranked Prison first with 14 members over
 * 34% of the deck, the composite scored it 24.4, and PRIMARY_THRESHOLD is 30. The proposed rescue
 * is to declare the top theme anyway — unconfidently — when the classifier's own floor passed for
 * it, which adds no new constant and can only turn "(none)" into something.
 *
 * That rescue cannot damage the 22 fixtures: all of them already declare, and a rule that fires
 * only on an empty result cannot change a non-empty one. The population it CAN damage is themeless
 * decks, and this measures exactly that — how often a deck with no strategy at all still has a
 * theme clearing the classifier floor.
 *
 * Both control populations are honest in different ways: random legal cards are the pure null, and
 * a pile of format staples is the realistic one (a real user's unfocused goodstuff deck).
 */
import { describe, it, expect } from 'vitest';
import {
  buildThemeModel, scoreThemesForDeck, survivingThemes, loadThemeCharTags,
} from '@/services/themes';
import { parseTagsIndex } from '@/services/edhrec/client';
import type { EDHRECTag, ScryfallCard } from '@/types';
import type { MtgCatalogs } from '@/services/scryfall/client';

const H = { 'User-Agent': 'ManaFoundry/1.0', Accept: 'application/json' };
const S3 = 'https://mtg-deck-builder-tagger.s3.amazonaws.com';
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

const DECK_SIZE = 40;      // non-land count of a typical analysed list
const RANDOM_DECKS = 20;
const STAPLE_DECKS = 10;

/** Deterministic shuffle so a run is reproducible — Math.random would make this unrepeatable. */
function seededPick<T>(pool: T[], n: number, seed: number): T[] {
  const out: T[] = [];
  const used = new Set<number>();
  let s = seed;
  while (out.length < n && used.size < pool.length) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const i = s % pool.length;
    if (used.has(i)) continue;
    used.add(i);
    out.push(pool[i]);
  }
  return out;
}

describe.skipIf(import.meta.env.VITE_LIVE_DIAG !== '1')('themeless decks vs the classifier floor', () => {
  it('measures how often a strategy-free deck still clears it', async () => {
    // ── tag lookup ──
    const dictFile = await (await fetch(`${S3}/spellchroma-tag-dictionary.json`)).json();
    const idxFile = await (await fetch(`${S3}/spellchroma-tag-index.json`)).json();
    const dict: { s: string; p?: string[] }[] = dictFile.tags;
    const index: Record<string, number[]> = idxFile.index;
    const tagBySlug = new Map(dict.map(e => [e.s, e]));
    const walk = (slug: string, out: Set<string>) => {
      for (const p of tagBySlug.get(slug)?.p ?? []) {
        if (out.has(p)) continue;
        out.add(p); walk(p, out);
      }
    };
    const tagsFor = (c: ScryfallCard): readonly string[] => {
      const ids = index[c.oracle_id];
      if (!ids) return [];
      const out = new Set<string>();
      for (const i of ids) {
        const e = dict[i];
        if (!e) continue;
        out.add(e.s); walk(e.s, out);
      }
      return [...out];
    };

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
    const staples = new Set(table.staples ?? []);

    // ── pool 1: random commander-legal nonland cards, spread across pages so it is not one set ──
    const pool: ScryfallCard[] = [];
    for (const p of [1, 3, 5, 7, 9, 11]) {
      const r = await fetch(
        `https://api.scryfall.com/cards/search?q=${encodeURIComponent('f:commander -t:land -is:reprint')}&page=${p}&order=released`,
        { headers: H },
      );
      if (!r.ok) break;
      const j = await r.json();
      pool.push(...(j.data ?? []));
      await sleep(120);
    }
    console.log(`\nrandom pool: ${pool.length} cards`);

    // ── pool 2: the format staples the tag table already lists ──
    const stapleNames = [...staples];
    const stapleCards: ScryfallCard[] = [];
    for (let i = 0; i < stapleNames.length; i += 70) {
      const r = await fetch('https://api.scryfall.com/cards/collection', {
        method: 'POST', headers: { ...H, 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifiers: stapleNames.slice(i, i + 70).map(name => ({ name })) }),
      });
      const j = await r.json();
      stapleCards.push(...(j.data ?? []));
      await sleep(120);
    }
    console.log(`staple pool: ${stapleCards.length} of ${stapleNames.length} names`);

    /** Would the rescue fire? It needs SOME theme that survived and passed the floor. */
    function probe(cards: ScryfallCard[]) {
      const scored = scoreThemesForDeck(cards, models, tagsFor, new Set(), undefined, staples, null);
      const survivors = survivingThemes(scored).filter(s => s.passedFloor && !s.gateMissing);
      return survivors[0] ?? null;
    }

    let fired = 0;
    const rows: string[] = [];
    for (let d = 0; d < RANDOM_DECKS; d++) {
      const deck = seededPick(pool, DECK_SIZE, 7919 + d * 104729);
      const top = probe(deck);
      if (top) fired++;
      rows.push(`  random#${String(d).padStart(2)}  ${top
        ? `${top.model.name.padEnd(22)} members=${String(top.members).padStart(2)} ratio=${(top.ratio * 100).toFixed(0)}% score=${top.membershipScore.toFixed(1)}`
        : '(nothing clears the floor)'}`);
    }
    let stapleFired = 0;
    for (let d = 0; d < STAPLE_DECKS; d++) {
      const deck = seededPick(stapleCards, Math.min(DECK_SIZE, stapleCards.length), 104729 + d * 7919);
      const top = probe(deck);
      if (top) stapleFired++;
      rows.push(`  staples#${String(d).padStart(2)} ${top
        ? `${top.model.name.padEnd(22)} members=${String(top.members).padStart(2)} ratio=${(top.ratio * 100).toFixed(0)}% score=${top.membershipScore.toFixed(1)}`
        : '(nothing clears the floor)'}`);
    }

    console.log(`\ndeck size ${DECK_SIZE} nonland\n`);
    for (const r of rows) console.log(r);
    console.log(`\nrandom decks with a floor-passing theme : ${fired}/${RANDOM_DECKS} (${(fired / RANDOM_DECKS * 100).toFixed(0)}%)`);
    console.log(`staple decks with a floor-passing theme : ${stapleFired}/${STAPLE_DECKS} (${(stapleFired / STAPLE_DECKS * 100).toFixed(0)}%)`);
    console.log('\nThis is the UPPER bound on how often the rescue can fire wrongly: it also requires');
    console.log('the composite to rank that same theme first, which these controls do not simulate.');
    expect(pool.length).toBeGreaterThan(50);
  }, 600000);
});
