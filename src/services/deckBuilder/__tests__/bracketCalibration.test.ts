import { describe, it, expect, beforeAll } from 'vitest';

/**
 * Bracket calibration harness — NOT part of the normal suite.
 *
 *   $env:VITE_CALIBRATE="1"; node node_modules/vitest/vitest.mjs run `
 *     src/services/deckBuilder/__tests__/bracketCalibration.test.ts
 *
 * The conformance suite next door proves the estimator implements the rules we
 * think it does. It cannot tell us whether those rules, plus our invented soft
 * score, actually sort real decks correctly. This does.
 *
 * Method: EDHREC publishes an "average deck" per commander per bracket, and the
 * user confirmed those brackets come from builder self-declaration on the deck
 * sites EDHREC scrapes. That gives us a real, legal, 100-card list carrying a
 * human label — the closest thing to ground truth available for free.
 *
 * Known limits, stated up front so nobody over-reads the output:
 *  - An "average deck" is a centroid, so it is smoother and more typical than
 *    any real list. Expect it to understate variance at the extremes.
 *  - Combo detection is NOT wired in here (it needs a separate EDHREC fetch per
 *    commander). Combos only ever RAISE a floor, so every number below is a
 *    lower bound — the bias runs against high brackets, not for them.
 *  - Self-declared labels are noisy. Bracket 1 and 5 are thinly populated for
 *    most commanders, so we report sample sizes and skip thin cells.
 */

import { loadTaggerData, getCardRole } from '@/services/tagger/client';
import { estimateBracket } from '../bracketEstimator';

const RUN = import.meta.env.VITE_CALIBRATE === '1';

const TAGGER_HOST = 'https://mtg-deck-builder-tagger.s3.amazonaws.com';
const EDHREC = 'https://json.edhrec.com/pages';
const SCRYFALL = 'https://api.scryfall.com';

/** EDHREC's bracket path segments, indexed by bracket number. */
const BRACKET_SLUG: Record<number, string> = {
  1: 'exhibition', 2: 'core', 3: 'upgraded', 4: 'optimized', 5: 'cedh',
};

/** A spread of archetypes, not just the popular ones — casual tribal through cEDH. */
const COMMANDERS = [
  'atraxa-praetors-voice', 'edgar-markov', 'miirym-sentinel-wyrm',
  'ygra-eater-of-all', 'muldrotha-the-gravetide', 'prosper-tome-bound',
  'lathril-blade-of-the-elves', 'krenko-mob-boss', 'talrand-sky-summoner',
  'kinnan-bonder-prodigy', 'najeela-the-blade-blossom', 'rograkh-son-of-rohgahh',
];

/** Below this many decks behind a bracket page, the label is too noisy to score. */
const MIN_SAMPLE = 30;

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/**
 * Scryfall rejects the default User-Agent every HTTP library sends, with a 400
 * rather than an empty result — so a missing header looks like "no such cards"
 * unless you check status. Throw loudly instead.
 */
async function scryfall(path: string, init?: RequestInit): Promise<any> {
  const res = await fetch(`${SCRYFALL}${path}`, {
    ...init,
    headers: { 'User-Agent': 'ManaFoundry/1.0 (bracket calibration)', Accept: 'application/json', ...init?.headers },
  });
  if (!res.ok) throw new Error(`Scryfall ${path} -> ${res.status} ${(await res.text()).slice(0, 160)}`);
  return res.json();
}

// ── Scryfall card facts ────────────────────────────────────────────────────

interface CardFacts { cmc: number; isLand: boolean }
const factsCache = new Map<string, CardFacts>();

async function loadFacts(names: string[]): Promise<void> {
  const missing = [...new Set(names)].filter(n => !factsCache.has(n));
  for (let i = 0; i < missing.length; i += 75) {
    const batch = missing.slice(i, i + 75);
    const json = await scryfall('/cards/collection', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifiers: batch.map(name => ({ name })) }),
    });
    for (const c of json.data ?? []) {
      factsCache.set(c.name, {
        cmc: c.cmc ?? 0,
        isLand: (c.type_line ?? '').toLowerCase().includes('land'),
      });
      // EDHREC uses front-face names for DFCs; index those too.
      if (c.name.includes(' // ')) {
        factsCache.set(c.name.split(' // ')[0], {
          cmc: c.cmc ?? 0,
          isLand: (c.type_line ?? '').toLowerCase().includes('land'),
        });
      }
    }
    await sleep(100); // Scryfall asks for 100ms between requests
  }
}

// ── EDHREC average decks ───────────────────────────────────────────────────

interface LabelledDeck { commander: string; declared: number; sample: number; cards: string[] }

async function fetchAverageDeck(slug: string, bracket: number): Promise<LabelledDeck | null> {
  const res = await fetch(`${EDHREC}/average-decks/${slug}/${BRACKET_SLUG[bracket]}.json`);
  if (!res.ok) return null;
  const json = await res.json();

  const cards: string[] = [];
  for (const group of Object.values(json?.deck?.cards ?? {}) as [string, number][][]) {
    for (const [name, qty] of group) for (let i = 0; i < (qty || 1); i++) cards.push(name);
  }
  for (const c of json?.deck?.commander ?? []) cards.push(c);
  if (cards.length < 90) return null; // not a real list

  return {
    commander: slug,
    declared: bracket,
    sample: Number(json?.bracket_counts?.[String(bracket)] ?? 0),
    cards,
  };
}

// ── Estimation, mirroring deckEnricher's methodology exactly ───────────────

function estimate(deck: LabelledDeck, gameChangers: Set<string>) {
  const landNames = new Set<string>();
  const roleCounts: Record<string, number> = {};
  let cmcSum = 0, nonLandCount = 0;

  for (const name of deck.cards) {
    const facts = factsCache.get(name);
    if (!facts) continue;
    if (facts.isLand) { landNames.add(name); continue; }
    cmcSum += facts.cmc;
    nonLandCount++;
    const role = getCardRole(name);
    if (role) roleCounts[role] = (roleCounts[role] ?? 0) + 1;
  }

  const averageCmc = nonLandCount > 0 ? parseFloat((cmcSum / nonLandCount).toFixed(2)) : 0;
  return estimateBracket(deck.cards, landNames, undefined, averageCmc, undefined, roleCounts, gameChangers);
}

// ── The run ────────────────────────────────────────────────────────────────

describe.skipIf(!RUN)('bracket calibration against EDHREC self-declared brackets', () => {
  const results: { deck: LabelledDeck; got: number; gotMax: number; soft: number }[] = [];

  beforeAll(async () => {
    // Use the real tagger client so this exercises production code paths. In
    // dev mode the client rewrites the S3 host to a vite proxy path that node
    // can't resolve, so point it back at the bucket.
    const realFetch = globalThis.fetch;
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      return realFetch(url.startsWith('/tagger-s3') ? url.replace('/tagger-s3', TAGGER_HOST) : input, init);
    }) as typeof fetch;

    const tagger = await loadTaggerData();
    if (!tagger) throw new Error('Tagger data unavailable — is VITE_TAG_REPO_URL set in .env.local?');

    const gameChangers = new Set<string>();
    for (let page = 1; ; page++) {
      const json = await scryfall(`/cards/search?q=${encodeURIComponent('is:gamechanger')}&page=${page}`);
      for (const c of json.data ?? []) gameChangers.add(c.name);
      if (!json.has_more) break;
      await sleep(100);
    }
    // A silent zero here would fake a Bracket 1 reading for every deck.
    if (gameChangers.size === 0) throw new Error('No Game Changers loaded — the run would be meaningless');
    console.log(`\n[calibration] ${gameChangers.size} Game Changers, ${Object.keys(tagger.tags).length} tag sets\n`);

    for (const slug of COMMANDERS) {
      for (const bracket of [1, 2, 3, 4, 5]) {
        const deck = await fetchAverageDeck(slug, bracket);
        await sleep(100); // EDHREC courtesy
        if (!deck || deck.sample < MIN_SAMPLE) continue;
        await loadFacts(deck.cards);
        const est = estimate(deck, gameChangers);
        results.push({ deck, got: est.bracket, gotMax: est.bracketMax, soft: est.softScore });
      }
    }
  }, 600_000);

  it('sorts self-declared brackets in the right order', () => {
    // Confusion matrix — rows are what the builder declared, columns what we said.
    const matrix: number[][] = Array.from({ length: 5 }, () => Array(5).fill(0));
    for (const r of results) matrix[r.deck.declared - 1][r.got - 1]++;

    console.log('\n            estimated');
    console.log('declared    1    2    3    4    5   |  n   mean   soft');
    const means: (number | null)[] = [];
    for (let d = 0; d < 5; d++) {
      const row = results.filter(r => r.deck.declared === d + 1);
      const mean = row.length ? row.reduce((a, r) => a + r.got, 0) / row.length : null;
      const soft = row.length ? row.reduce((a, r) => a + r.soft, 0) / row.length : null;
      means.push(mean);
      console.log(
        `   ${d + 1}     ` +
        matrix[d].map(v => String(v).padStart(4)).join(' ') +
        `   | ${String(row.length).padStart(2)}  ` +
        `${mean === null ? '  — ' : mean.toFixed(2)}  ` +
        `${soft === null ? '  — ' : soft.toFixed(0).padStart(4)}`,
      );
    }

    const exact = results.filter(r => r.got === r.deck.declared).length;
    const within1 = results.filter(r => Math.abs(r.got - r.deck.declared) <= 1).length;
    // A reported range is only "covered" if the declared bracket falls inside
    // it. That is the number the UI is actually claiming, so it's the honest
    // headline — a "1 or 2" reading on a declared-2 deck is not a miss.
    const covered = results.filter(r => r.deck.declared >= r.got && r.deck.declared <= r.gotMax).length;
    const ranged = results.filter(r => r.gotMax > r.got).length;
    console.log(
      `\nexact ${exact}/${results.length}` +
      `   within one ${within1}/${results.length}` +
      `   covered by reported range ${covered}/${results.length}` +
      `   (${ranged} reported as a range)`,
    );

    const worst = [...results].sort((a, b) => Math.abs(b.got - b.deck.declared) - Math.abs(a.got - a.deck.declared)).slice(0, 8);
    console.log('\nlargest misses:');
    for (const r of worst) {
      console.log(`  ${r.deck.commander.padEnd(28)} declared ${r.deck.declared} → got ${r.got} (soft ${r.soft}, n=${r.deck.sample})`);
    }
    console.log('');

    expect(results.length, 'no bracket pages cleared the sample threshold').toBeGreaterThan(10);

    // The real assertion: whatever the absolute accuracy, the estimator must at
    // least ORDER the brackets. If declared-5 decks don't read higher than
    // declared-2 decks, the soft score is not measuring power at all.
    const observed = means.filter((m): m is number => m !== null);
    const sorted = [...observed].sort((a, b) => a - b);
    expect(observed, 'mean estimate should rise with declared bracket').toEqual(sorted);
  });
});
