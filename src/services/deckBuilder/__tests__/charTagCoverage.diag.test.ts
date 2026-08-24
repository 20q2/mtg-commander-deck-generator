/**
 * DEFINITION COVERAGE for archetype themes — skipped unless VITE_LIVE_DIAG=1.
 *
 *   VITE_LIVE_DIAG=1 node node_modules/vitest/vitest.mjs run src/services/deckBuilder/__tests__/charTagCoverage.diag.test.ts
 *
 * `computeThemeCharTags` ranks candidate tags by LIFT and keeps the top 8. Lift rewards rarity, so
 * the winners are the tags most concentrated in the theme — which is not the same as the tags that
 * FIND the theme. Stax's definition came out as hate-storm / stasis / hate-flash / cost-increaser /
 * hatebear / silence / white-effect / kismet-effect, and on a real artifact-stax deck it matched 5
 * of ~12 obvious stax pieces. Smokestack, Tangle Wire, Nether Void, Contamination and Freyalise's
 * Winds carry none of them.
 *
 * This measures the thing lift can't see: what share of a theme's OWN cards its definition matches,
 * and how that share moves if the selection keeps ranking by lift but stops at 8, goes to 16, or
 * picks greedily for coverage instead.
 *
 * Approximation, stated up front: the real build mines over Scryfall's bulk pool with EDHREC theme
 * membership. Here the theme's pool is its EDHREC tag page and the background is a broad random
 * sample. Same shape, smaller numbers — good enough to rank strategies against each other, not to
 * set a constant.
 */
import { describe, it, expect } from 'vitest';
import { loadThemeCharTags } from '@/services/themes';
import { CHAR_TAG_MIN_LIFT, CHAR_TAG_MIN_CARRIERS } from '@/services/themes/charTags';
import type { ScryfallCard } from '@/types';

const H = { 'User-Agent': 'ManaFoundry/1.0', Accept: 'application/json' };
const S3 = 'https://mtg-deck-builder-tagger.s3.amazonaws.com';
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** Themes to inspect — the one that failed, plus neighbours to show whether it is systemic. */
const THEMES = ['stax', 'prison', 'aristocrats', 'control'];

/**
 * A tag page's top cards are mostly format goodstuff — Sol Ring is on the stax page because stax
 * decks play Sol Ring, not because it is stax. Measuring "coverage of the page" therefore rewards
 * generic tags (`mana-dork`, `single-target-instant-sorcery`) that cover the staples, which is how
 * a first pass of this concluded that greedy coverage selection was a 4x win.
 *
 * EDHREC's own per-card synergy is the correction: a card's rate in THESE decks minus its rate
 * everywhere. Above this it is on the page because of the theme.
 */
const SYNERGY_SPECIFIC = 0.1;

describe.skipIf(import.meta.env.VITE_LIVE_DIAG !== '1')('archetype definition coverage', () => {
  it('measures what share of a theme\'s own cards its definition finds', async () => {
    // ── tags ──
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
    const tagsForOracle = (oracleId?: string): string[] => {
      const ids = oracleId ? index[oracleId] : undefined;
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

    // ── background pool ──
    const background: ScryfallCard[] = [];
    for (const p of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const r = await fetch(
        `https://api.scryfall.com/cards/search?q=${encodeURIComponent('f:commander -t:land')}&page=${p}&order=edhrec`,
        { headers: H },
      );
      if (!r.ok) break;
      const j = await r.json();
      background.push(...(j.data ?? []));
      await sleep(120);
    }
    const bgTags = background.map(c => tagsForOracle(c.oracle_id));
    const bgFreq = new Map<string, number>();
    for (const tags of bgTags) for (const t of new Set(tags)) bgFreq.set(t, (bgFreq.get(t) ?? 0) + 1);
    console.log(`\nbackground pool: ${background.length} cards, ${bgFreq.size} distinct tags\n`);

    const table = loadThemeCharTags();

    for (const slug of THEMES) {
      const res = await fetch(`https://json.edhrec.com/pages/tags/${slug}.json`, { headers: H });
      if (!res.ok) { console.log(`${slug}: page ${res.status}\n`); continue; }
      const j = await res.json();
      const views: { name: string; synergy?: number }[] = (j.container?.json_dict?.cardlists ?? [])
        .filter((l: { header: string }) => !/commanders/i.test(l.header))
        .flatMap((l: { cardviews: { name: string; synergy?: number }[] }) => l.cardviews);
      const specific = views.filter(v => (v.synergy ?? 0) >= SYNERGY_SPECIFIC);
      console.log(`── ${slug}: ${specific.length} of ${views.length} page cards are synergy-specific`);
      const names = [...new Set(specific.map(v => v.name))];
      const pool = await fetchCards(names.slice(0, 140));
      const poolTags = pool.map(c => tagsForOracle(c.oracle_id));
      if (pool.length < 20) { console.log(`${slug}: only ${pool.length} pool cards\n`); continue; }

      // Lift per tag, exactly as computeThemeCharTags scores it.
      const memberCarriers = new Map<string, number>();
      for (const tags of poolTags) for (const t of new Set(tags)) memberCarriers.set(t, (memberCarriers.get(t) ?? 0) + 1);
      const scored: { tag: string; lift: number; carriers: number }[] = [];
      for (const [tag, carriers] of memberCarriers) {
        if (carriers < CHAR_TAG_MIN_CARRIERS) continue;
        const base = (bgFreq.get(tag) ?? 0) / background.length;
        if (base <= 0) continue;
        const lift = (carriers / pool.length) / base;
        if (lift >= CHAR_TAG_MIN_LIFT) scored.push({ tag, lift, carriers });
      }
      scored.sort((a, b) => b.lift - a.lift);

      /** Share of the theme's own pool matched by a definition (membership = carries ANY tag). */
      const coverage = (def: string[]) => {
        const set = new Set(def);
        let hit = 0;
        for (const tags of poolTags) if (tags.some(t => set.has(t))) hit++;
        return hit / pool.length;
      };

      // Greedy: repeatedly take the qualifying tag that adds the most UNCOVERED pool cards.
      const greedy: string[] = [];
      const covered = new Set<number>();
      while (greedy.length < 8) {
        let best: { tag: string; gain: number } | null = null;
        for (const { tag } of scored) {
          if (greedy.includes(tag)) continue;
          let gain = 0;
          for (let i = 0; i < poolTags.length; i++) if (!covered.has(i) && poolTags[i].includes(tag)) gain++;
          if (!best || gain > best.gain) best = { tag, gain };
        }
        if (!best || best.gain === 0) break;
        greedy.push(best.tag);
        for (let i = 0; i < poolTags.length; i++) if (poolTags[i].includes(best.tag)) covered.add(i);
      }

      const shipped = table.themes[slug]?.charTags ?? [];
      const top8 = scored.slice(0, 8).map(s => s.tag);
      const top16 = scored.slice(0, 16).map(s => s.tag);
      console.log(`── ${slug} (${pool.length} pool cards) ─────────────────────────`);
      console.log(`  shipped  ${(coverage(shipped) * 100).toFixed(0).padStart(3)}%  ${shipped.join(', ')}`);
      console.log(`  lift@8   ${(coverage(top8) * 100).toFixed(0).padStart(3)}%  ${top8.join(', ')}`);
      console.log(`  lift@16  ${(coverage(top16) * 100).toFixed(0).padStart(3)}%  ${top16.slice(8).join(', ')} (+8 more)`);
      console.log(`  greedy@8 ${(coverage(greedy) * 100).toFixed(0).padStart(3)}%  ${greedy.join(', ')}`);

      // Where the user's named tags actually rank, if they qualify at all.
      for (const want of ['symmetrical', 'tax', 'hate', 'freeze', 'mass-land-denial', 'stasis']) {
        const i = scored.findIndex(s => s.tag === want);
        const c = memberCarriers.get(want) ?? 0;
        console.log(`    ${want.padEnd(18)} ${i >= 0 ? `rank ${String(i + 1).padStart(3)}  lift ${scored[i].lift.toFixed(1).padStart(5)}` : 'does not qualify'}  carriers ${c}/${pool.length}`);
      }
      console.log('');
    }
    expect(background.length).toBeGreaterThan(100);
  }, 900000);
});
