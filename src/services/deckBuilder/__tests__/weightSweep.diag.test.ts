/**
 * COMPOSITE WEIGHT SWEEP — skipped unless VITE_LIVE_DIAG=1. Hits EDHREC and Scryfall.
 *
 *   VITE_LIVE_DIAG=1 node node_modules/vitest/vitest.mjs run src/services/deckBuilder/__tests__/weightSweep.diag.test.ts
 *
 * OVERLAP_WEIGHT / INCLUSION_WEIGHT / MEMBERSHIP_WEIGHT were set before the membership signal was
 * trusted ("deliberately TIMID at launch... turn MEMBERSHIP_WEIGHT up once /theme-lab shows the
 * numbers are sane"). This measures what they should be instead of arguing about it.
 *
 * The fixtures are the right instrument and the page sweep is not: the sweep passes no commander
 * list, so every theme is off-list and these three weights cannot change its ranking at all. The
 * fixtures are also hand-authored rather than built from EDHREC pages, which is what keeps the
 * overlap term from being circular — their own note says so.
 *
 * Method: run real detection per fixture ONCE, keep each theme's three unweighted components, then
 * re-apply candidate weights arithmetically. Components come from ThemeMatchResult.components rather
 * than being recomputed here, so the sweep cannot drift from the implementation it is measuring.
 */
import { describe, it, expect } from 'vitest';
import {
  buildThemeModel, scoreThemesForDeck, survivingThemes, loadThemeCharTags, SHORTLIST_SIZE,
} from '@/services/themes';
import { scoreThemeMatch, type ThemeMatchResult } from '../themeDetector';
import { parseTagsIndex } from '@/services/edhrec/client';
import fixtures from '@/data/themeTestDecks.json';
import type { EDHRECCommanderData, EDHRECTag, EDHRECTheme, ScryfallCard } from '@/types';
import type { MtgCatalogs } from '@/services/scryfall/client';

const H = { 'User-Agent': 'ManaFoundry/1.0', Accept: 'application/json' };
const S3 = 'https://mtg-deck-builder-tagger.s3.amazonaws.com';
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// Mirrors detectThemes' declaration rules, so "declared" here means what the app would declare.
const PRIMARY_THRESHOLD = 30;
const SECONDARY_THRESHOLD = 20;
const SECONDARY_GAP_MAX = 15;

const pct = (c: { num_decks?: number; potential_decks?: number }) =>
  c.potential_decks && c.potential_decks > 0 ? ((c.num_decks ?? 0) / c.potential_decks) * 100 : 0;

const slugify = (name: string) =>
  name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

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

interface Row { slug: string; name: string; c: ThemeMatchResult['components'] }
interface Case { commander: string; expect: string[]; rows: Row[] }

/** Re-score a collected case under candidate weights and apply the declaration rules. */
function declare(rows: Row[], w: { o: number; i: number; m: number; gap?: number }): string[] {
  const total = w.o + w.i + w.m;
  const gap = w.gap ?? SECONDARY_GAP_MAX;
  const scored = rows
    .map(r => ({ slug: r.slug, score: (r.c.overlap * w.o + r.c.inclusion * w.i + r.c.membership * w.m) / total }))
    .sort((a, b) => b.score - a.score);
  if (!scored.length || scored[0].score < PRIMARY_THRESHOLD) return [];
  const out = [scored[0].slug];
  if (scored[1] && scored[1].score >= SECONDARY_THRESHOLD
      && scored[0].score - scored[1].score <= gap) {
    out.push(scored[1].slug);
  }
  return out;
}

describe.skipIf(import.meta.env.VITE_LIVE_DIAG !== '1')('composite weight sweep', () => {
  it('measures declaration accuracy across the fixture decks', async () => {
    // ── shared, built once ──
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

    // ── collect each fixture once ──
    const cases: Case[] = [];
    for (const fx of fixtures.decks) {
      if (!fx.commander) continue;
      const names = [...new Set(fx.cards)];
      const cards: ScryfallCard[] = [];
      for (let i = 0; i < names.length; i += 70) {
        const r = await fetch('https://api.scryfall.com/cards/collection', {
          method: 'POST', headers: { ...H, 'Content-Type': 'application/json' },
          body: JSON.stringify({ identifiers: names.slice(i, i + 70).map(name => ({ name })) }),
        });
        const j = await r.json();
        cards.push(...(j.data ?? []));
        await sleep(110);
      }
      if (cards.length < 20) { console.log(`  skip ${fx.commander}: only ${cards.length} cards resolved`); continue; }

      const cslug = slugify(fx.commander);
      const baseRes = await fetch(`https://json.edhrec.com/pages/commanders/${cslug}.json`, { headers: H });
      if (!baseRes.ok) { console.log(`  skip ${fx.commander}: base page ${baseRes.status}`); continue; }
      const base = await baseRes.json();
      const commanderThemes: EDHRECTheme[] = (base.panels?.taglinks ?? [])
        .map((t: { value: string; slug: string; count: number }) => ({ name: t.value, slug: t.slug, count: t.count, url: '' }))
        .sort((a: EDHRECTheme, b: EDHRECTheme) => b.count - a.count);

      const scored = scoreThemesForDeck(
        cards, models, tagsFor, new Set(commanderThemes.map(t => t.slug)), undefined,
        staples, cards.find(c => c.name === fx.commander) ?? null,
      );
      const membership = new Map(scored.map(s => [s.model.slug, s]));
      const top = commanderThemes.slice(0, 8);
      const extras = survivingThemes(scored)
        .filter(s => !top.some(t => t.slug === s.model.slug)).slice(0, SHORTLIST_SIZE)
        .map(s => ({ name: s.model.name, slug: s.model.slug, count: s.model.numDecks, url: '' }));

      const rows: Row[] = [];
      for (const t of [...top, ...extras]) {
        const m = membership.get(t.slug);
        if (m?.gateMissing) continue;                       // detectThemes drops these
        const d = await page(`https://json.edhrec.com/pages/commanders/${cslug}/${t.slug}.json`)
          ?? await page(`https://json.edhrec.com/pages/tags/${t.slug}.json`);
        await sleep(110);
        if (!d) continue;
        rows.push({ slug: t.slug, name: t.name, c: scoreThemeMatch(t, d, cards, m, true).components });
      }
      cases.push({ commander: fx.commander, expect: fx.expect, rows });
      console.log(`  collected ${fx.commander.padEnd(32)} ${rows.length} themes`);
    }
    expect(cases.length).toBeGreaterThan(10);

    // ── sweep ──
    // Raising membership widens the score spread, which is the point — but SECONDARY_GAP_MAX was
    // calibrated against the compressed distribution, so a correct secondary starts falling outside
    // it. Sweep the gap with the weights rather than treating it as fixed.
    const candidates: { label: string; o: number; i: number; m: number; gap?: number }[] = [];
    for (const [o, i, m] of [[0.40, 0.25, 0.35], [0.30, 0.20, 0.50], [0.25, 0.15, 0.60]] as const) {
      for (const gap of [15, 20, 25, 30]) {
        candidates.push({
          label: `${(o * 100).toFixed(0)}/${(i * 100).toFixed(0)}/${(m * 100).toFixed(0)} gap ${gap}`,
          o, i, m, gap,
        });
      }
    }

    console.log(`\n${cases.length} fixtures. top1 = primary is in expect; prec = every declared theme is in expect;`);
    console.log('recall = share of expected themes declared; none = nothing declared at all.\n');
    console.log('weights              top1   prec  recall  none');
    const results: { label: string; top1: number; prec: number }[] = [];
    for (const w of candidates) {
      let top1 = 0, precOk = 0, recall = 0, none = 0;
      for (const c of cases) {
        const got = declare(c.rows, w);
        if (!got.length) { none++; continue; }
        if (c.expect.includes(got[0])) top1++;
        if (got.every(g => c.expect.includes(g))) precOk++;
        recall += got.filter(g => c.expect.includes(g)).length / c.expect.length;
      }
      const n = cases.length;
      console.log(
        w.label.padEnd(20) +
        `${(top1 / n * 100).toFixed(0)}%`.padStart(5) +
        `${(precOk / n * 100).toFixed(0)}%`.padStart(7) +
        `${(recall / n * 100).toFixed(0)}%`.padStart(8) +
        String(none).padStart(6),
      );
      results.push({ label: w.label, top1: top1 / n, prec: precOk / n });
    }

    // Per-fixture detail at the current setting vs the best top1, to see WHICH decks move.
    const best = candidates.reduce((a, b) => {
      const score = (w: typeof a) => {
        let t = 0;
        for (const c of cases) { const g = declare(c.rows, w); if (g.length && c.expect.includes(g[0])) t++; }
        return t;
      };
      return score(b) > score(a) ? b : a;
    });
    console.log(`\nper-fixture, current vs best (${best.label.trim()}):`);
    for (const c of cases) {
      const cur = declare(c.rows, candidates[0]);
      const nw = declare(c.rows, best);
      const mark = (g: string[]) => (g.length && c.expect.includes(g[0]) ? '✓' : '✗');
      if (mark(cur) !== mark(nw) || cur.join() !== nw.join()) {
        console.log(`  ${c.commander.padEnd(32)} want ${JSON.stringify(c.expect).padEnd(38)} ${mark(cur)} ${cur.join('+') || '(none)'}  ->  ${mark(nw)} ${nw.join('+') || '(none)'}`);
      }
    }
  }, 1800000);
});
