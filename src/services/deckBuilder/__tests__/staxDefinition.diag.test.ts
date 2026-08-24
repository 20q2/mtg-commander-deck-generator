/**
 * WOULD ADDING `hate` AND `symmetrical` TO STAX HELP? — skipped unless VITE_LIVE_DIAG=1.
 *
 *   VITE_LIVE_DIAG=1 node node_modules/vitest/vitest.mjs run src/services/deckBuilder/__tests__/staxDefinition.diag.test.ts
 *
 * Both tags are genuinely characteristic of stax: on the synergy-specific part of EDHREC's stax
 * page, `hate` is on 46% of cards and `symmetrical` on 14%. The tempting conclusion is that the
 * definition should include them.
 *
 * But membership is only half the story. The score is observed-over-EXPECTED, and expected is the
 * definition's base rate across the whole card pool — so a broad tag raises the numerator and the
 * denominator together. This measures both ends on the same pool instead of assuming the numerator
 * wins: the Glissa deck's member count under each definition, the honest base rate of each, and the
 * lift that actually comes out.
 */
import { describe, it, expect } from 'vitest';
import { loadThemeCharTags } from '@/services/themes';
import type { ScryfallCard } from '@/types';

const H = { 'User-Agent': 'ManaFoundry/1.0', Accept: 'application/json' };
const S3 = 'https://mtg-deck-builder-tagger.s3.amazonaws.com';
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

const DECK = `Altar of the Brood|Arcane Signet|Birds of Paradise|Braids, Arisen Nightmare|Braids, Cabal Minion|Contamination|Creeping Bloodsucker|Dauthi Voidwalker|Dense Foliage|Dockside Chef|Earthcraft|Eldrazi Monument|Elves of Deep Shadow|Freyalise's Winds|Garruk Wildspeaker|Glissa, Herald of Predation|Haywire Mite|Inspiring Statuary|Jaheira, Friend of the Forest|Lithoform Engine|Llanowar Elves|Meekstone|Nether Void|Overgrowth|Priest of Titania|Sakura-Tribe Elder|Sarinth Steelseeker|Sheoldred, the Apocalypse|Smokestack|Static Orb|Sun Droplet|Tainted Æther|Tangle Wire|Teething Wurmlet|Tendershoot Dryad|The Mycotyrant|Trinisphere|Twilight Prophet|Underhanded Designs|Wild Growth|Winter Orb`.split('|');

const ADDED = ['hate', 'symmetrical'];
/** Mirrors tuning.ts — copied rather than imported so the arithmetic below is visible in one place. */
const MAX_LIFT = 26;
const COVERAGE_FULL = 0.5;
const COVERAGE_WEIGHT = 0.15;
const OFF_LIST_PRIOR = 0.65;

describe.skipIf(import.meta.env.VITE_LIVE_DIAG !== '1')('stax definition: broader vs sharper', () => {
  it('measures the numerator and the denominator together', async () => {
    const dictFile = await (await fetch(`${S3}/spellchroma-tag-dictionary.json`)).json();
    const idxFile = await (await fetch(`${S3}/spellchroma-tag-index.json`)).json();
    const dict: { s: string; p?: string[] }[] = dictFile.tags;
    const index: Record<string, number[]> = idxFile.index;
    const bySlug = new Map(dict.map(e => [e.s, e]));
    const walk = (slug: string, out: Set<string>) => {
      for (const p of bySlug.get(slug)?.p ?? []) {
        if (out.has(p)) continue;
        out.add(p); walk(p, out);
      }
    };
    const tagsFor = (c: ScryfallCard): string[] => {
      const ids = c.oracle_id ? index[c.oracle_id] : undefined;
      if (!ids) return [];
      const out = new Set<string>();
      for (const i of ids) {
        const e = dict[i];
        if (!e) continue;
        out.add(e.s); walk(e.s, out);
      }
      return [...out];
    };

    // Background = the honest denominator: commander-legal nonland cards, most-played first, which
    // is the population a deck is actually drawn from.
    const background: ScryfallCard[] = [];
    for (const p of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
      const r = await fetch(
        `https://api.scryfall.com/cards/search?q=${encodeURIComponent('f:commander -t:land')}&page=${p}&order=edhrec`,
        { headers: H },
      );
      if (!r.ok) break;
      const j = await r.json();
      background.push(...(j.data ?? []));
      await sleep(120);
    }

    const deck: ScryfallCard[] = [];
    for (let i = 0; i < DECK.length; i += 70) {
      const r = await fetch('https://api.scryfall.com/cards/collection', {
        method: 'POST', headers: { ...H, 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifiers: DECK.slice(i, i + 70).map(name => ({ name })) }),
      });
      const j = await r.json();
      deck.push(...(j.data ?? []));
    }

    const shipped = loadThemeCharTags().themes['stax']?.charTags ?? [];
    const widened = [...new Set([...shipped, ...ADDED])];

    function report(label: string, def: string[], shippedBaseRate?: number) {
      const set = new Set(def);
      const members = deck.filter(c => tagsFor(c).some(t => set.has(t)));
      const bgHits = background.filter(c => tagsFor(c).some(t => set.has(t))).length;
      const baseRate = bgHits / background.length;
      const ratio = members.length / deck.length;
      // Honest lift uses the base rate this definition actually has. The shipped number is shown
      // beside it because the committed table would keep the OLD base rate until a rebuild.
      const lift = Math.min(ratio / Math.max(baseRate, 0.02), MAX_LIFT);
      const coverage = Math.pow(Math.min(ratio / COVERAGE_FULL, 1), COVERAGE_WEIGHT);
      const membershipScore = (lift / MAX_LIFT) * 100 * coverage * OFF_LIST_PRIOR;
      console.log(`\n${label}`);
      console.log(`  tags        ${def.join(', ')}`);
      console.log(`  deck members ${members.length}/${deck.length} (${(ratio * 100).toFixed(0)}%)`);
      console.log(`    ${members.map(m => m.name).join(', ')}`);
      console.log(`  base rate    ${(baseRate * 100).toFixed(2)}% of ${background.length} pool cards` +
        (shippedBaseRate != null ? `   [committed table says ${(shippedBaseRate * 100).toFixed(2)}%]` : ''));
      console.log(`  lift         ${lift.toFixed(1)}x`);
      console.log(`  membership   ${membershipScore.toFixed(1)}  (off-list prior applied)`);
      return membershipScore;
    }

    console.log(`\nbackground ${background.length} cards · deck ${deck.length} cards`);
    const a = report('SHIPPED', shipped, loadThemeCharTags().themes['stax']?.baseRate);
    const b = report(`WIDENED (+ ${ADDED.join(', ')})`, widened);

    console.log(`\nwidening ${b > a ? 'HELPS' : 'HURTS'}: ${a.toFixed(1)} -> ${b.toFixed(1)}`);
    console.log('Prison, the correct answer on this deck today, scores 14.7 for comparison.');
    expect(background.length).toBeGreaterThan(100);
  }, 600000);
});
