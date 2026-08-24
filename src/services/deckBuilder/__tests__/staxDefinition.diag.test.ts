/**
 * SHOULD A CANDIDATE TAG JOIN A THEME'S DEFINITION? — skipped unless VITE_LIVE_DIAG=1.
 *
 *   VITE_LIVE_DIAG=1 node node_modules/vitest/vitest.mjs run src/services/deckBuilder/__tests__/staxDefinition.diag.test.ts
 *
 * "Tag X is obviously theme Y" is a claim about CARDS, and it is usually right. The classifier asks
 * a different question — is this concentration SURPRISING — and a tag can be a perfect description
 * of the theme while being useless as evidence for it, because the score is observed over EXPECTED
 * and a broad tag raises both. Measured on stax: adding `hate` and `symmetrical` took membership
 * from 5 cards to 14 (all of them correct) and the score from 12.3 to 5.3, because 15% of all
 * commander-legal cards carry one of them.
 *
 * So every candidate gets three numbers before it goes anywhere near the table:
 *   1. is it characteristic  — carriers among the theme's synergy-specific EDHREC page cards,
 *   2. what does it cost     — base rate across the played-card pool (the denominator),
 *   3. what is the net       — membership score on a real deck of that archetype.
 *
 * The reference deck is the Glissa prison/stax pile that reported no theme. Prison is the current
 * winner on it at 14.7 composite-membership and the whole deck fell 5.6 points short of declaring,
 * so "does this move Prison up" is the question that actually matters.
 */
import { describe, it, expect } from 'vitest';
import { loadThemeCharTags } from '@/services/themes';
import type { ScryfallCard } from '@/types';

const H = { 'User-Agent': 'ManaFoundry/1.0', Accept: 'application/json' };
const S3 = 'https://mtg-deck-builder-tagger.s3.amazonaws.com';
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

const DECK = `Altar of the Brood|Arcane Signet|Birds of Paradise|Braids, Arisen Nightmare|Braids, Cabal Minion|Contamination|Creeping Bloodsucker|Dauthi Voidwalker|Dense Foliage|Dockside Chef|Earthcraft|Eldrazi Monument|Elves of Deep Shadow|Freyalise's Winds|Garruk Wildspeaker|Glissa, Herald of Predation|Haywire Mite|Inspiring Statuary|Jaheira, Friend of the Forest|Lithoform Engine|Llanowar Elves|Meekstone|Nether Void|Overgrowth|Priest of Titania|Sakura-Tribe Elder|Sarinth Steelseeker|Sheoldred, the Apocalypse|Smokestack|Static Orb|Sun Droplet|Tainted Æther|Tangle Wire|Teething Wurmlet|Tendershoot Dryad|The Mycotyrant|Trinisphere|Twilight Prophet|Underhanded Designs|Wild Growth|Winter Orb`.split('|');

/** Theme → the tags a domain read says belong in it. Each is tested alone and in combination. */
const CANDIDATES: Record<string, string[]> = {
  stax: ['group-slug', 'punisher'],
  prison: ['group-slug', 'punisher'],
};

/** Only cards this far above their own baseline count as the theme's own — see charTagCoverage. */
const SYNERGY_SPECIFIC = 0.1;

// Mirrors tuning.ts. Copied rather than imported so the arithmetic is visible in one place.
const MAX_LIFT = 26;
const COVERAGE_FULL = 0.5;
const COVERAGE_WEIGHT = 0.15;
const OFF_LIST_PRIOR = 0.65;
const EXPECTED_RATE_FLOOR = 0.02;

describe.skipIf(import.meta.env.VITE_LIVE_DIAG !== '1')('candidate definition tags', () => {
  it('weighs each against the denominator it moves', async () => {
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

    const fetchCards = async (names: string[]): Promise<ScryfallCard[]> => {
      const out: ScryfallCard[] = [];
      for (let i = 0; i < names.length; i += 70) {
        const r = await fetch('https://api.scryfall.com/cards/collection', {
          method: 'POST', headers: { ...H, 'Content-Type': 'application/json' },
          body: JSON.stringify({ identifiers: names.slice(i, i + 70).map(name => ({ name })) }),
        });
        const j = await r.json();
        out.push(...(j.data ?? []));
        await sleep(110);
      }
      return out;
    };

    // The denominator: commander-legal nonland cards, most-played first.
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
    const bgTags = background.map(tagsFor);
    const deck = await fetchCards(DECK);
    const deckTags = deck.map(tagsFor);
    console.log(`\nbackground ${background.length} cards · reference deck ${deck.length} cards`);

    const table = loadThemeCharTags();

    for (const [slug, candidates] of Object.entries(CANDIDATES)) {
      const shipped = table.themes[slug]?.charTags ?? [];

      // ── 1. Is each candidate characteristic of the theme at all? ──
      const res = await fetch(`https://json.edhrec.com/pages/tags/${slug}.json`, { headers: H });
      if (!res.ok) { console.log(`\n${slug}: page ${res.status}`); continue; }
      const j = await res.json();
      const views: { name: string; synergy?: number }[] = (j.container?.json_dict?.cardlists ?? [])
        .filter((l: { header: string }) => !/commanders/i.test(l.header))
        .flatMap((l: { cardviews: { name: string; synergy?: number }[] }) => l.cardviews);
      const poolNames = [...new Set(views.filter(v => (v.synergy ?? 0) >= SYNERGY_SPECIFIC).map(v => v.name))];
      const pool = await fetchCards(poolNames.slice(0, 140));
      const poolTags = pool.map(tagsFor);

      console.log(`\n══ ${slug} — ${pool.length} synergy-specific page cards ══`);
      for (const tag of candidates) {
        const known = dict.some(e => e.s === tag);
        const inPool = poolTags.filter(t => t.includes(tag)).length;
        const inBg = bgTags.filter(t => t.includes(tag)).length;
        const base = inBg / background.length;
        const lift = base > 0 ? (inPool / pool.length) / base : 0;
        console.log(`  ${tag.padEnd(14)} ${known ? '' : 'NOT A REAL TAG  '}page ${String(inPool).padStart(3)}/${pool.length} (${(inPool / pool.length * 100).toFixed(0)}%)  background ${(base * 100).toFixed(2)}%  lift ${lift.toFixed(1)}x`);
      }

      // ── 2 & 3. Cost and net, per definition variant. ──
      const variants: { label: string; def: string[] }[] = [{ label: 'shipped', def: shipped }];
      for (const c of candidates) variants.push({ label: `+ ${c}`, def: [...new Set([...shipped, c])] });
      if (candidates.length > 1) {
        variants.push({ label: `+ ${candidates.join(' + ')}`, def: [...new Set([...shipped, ...candidates])] });
      }

      console.log(`  ${'variant'.padEnd(26)}${'deck'.padStart(7)}${'base%'.padStart(8)}${'lift'.padStart(7)}${'memb'.padStart(7)}`);
      let shippedScore = 0;
      for (const { label, def } of variants) {
        const set = new Set(def);
        const members = deckTags.filter(t => t.some(x => set.has(x))).length;
        const baseRate = bgTags.filter(t => t.some(x => set.has(x))).length / background.length;
        const ratio = members / deck.length;
        const lift = Math.min(ratio / Math.max(baseRate, EXPECTED_RATE_FLOOR), MAX_LIFT);
        const coverage = Math.pow(Math.min(ratio / COVERAGE_FULL, 1), COVERAGE_WEIGHT);
        const memb = (lift / MAX_LIFT) * 100 * coverage * OFF_LIST_PRIOR;
        if (label === 'shipped') shippedScore = memb;
        const delta = label === 'shipped' ? '' : `  ${memb > shippedScore ? '+' : ''}${(memb - shippedScore).toFixed(1)}`;
        console.log(`  ${label.padEnd(26)}${String(members).padStart(4)}/${deck.length}${(baseRate * 100).toFixed(2).padStart(8)}${lift.toFixed(1).padStart(7)}${memb.toFixed(1).padStart(7)}${delta}`);
      }
    }

    console.log('\nPrison needs +5.6 composite to declare on this deck; membership is 50% of the');
    console.log('composite, so a membership gain of ~11 would do it on its own.');
    expect(background.length).toBeGreaterThan(100);
  }, 900000);
});
