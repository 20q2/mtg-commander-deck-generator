/**
 * How much of each bot deck the bot actually understands.
 *
 * Run: `npm run bot:coverage`. Offline — it reads the committed fixture, so run
 * `npm run build:bot-fixture` first if a decklist changed.
 *
 * ## What this is for
 *
 * The whole bet of the playtest opponents is that we teach the bot these
 * specific decks rather than building a Magic engine. That only works if we can
 * answer "does this bot understand its own deck yet?" — otherwise a deck ships
 * with eight cards that quietly do nothing and it plays like a worse deck for
 * reasons nobody can see. This is the per-deck shipping gate.
 *
 * A card counts as understood when it needs no guidance or already has some:
 *
 *   land     — the engine plays these itself
 *   mana     — a "{T}: Add …" source, read generically by `manaFrom`
 *   scripted — has an entry in one of the registries in effects.ts
 *   vanilla  — no rules text beyond keywords the combat module already reads
 *   GAP      — has text that matters and nothing to act on it
 *
 * The GAP list is the authoring queue, in the order it should be worked.
 */

import { readFileSync, writeFileSync } from 'node:fs';

const STUBS = new URL('../src/data/opponentStubs.json', import.meta.url);
/**
 * Written on every run. The seat picker badges each deck with how well the bot
 * knows it, and a hand-set label would drift the moment a registry entry lands
 * — so the badge reads this, and this is a measurement.
 */
const COVERAGE = new URL('../src/data/botDeckCoverage.json', import.meta.url);
const FIXTURE = new URL(
  '../src/services/playtest/opponents/__tests__/botGames.fixture.json',
  import.meta.url,
);
const EFFECTS = new URL('../src/services/playtest/opponents/effects.ts', import.meta.url);
const COMBOS = new URL('../src/services/playtest/opponents/botCombos.ts', import.meta.url);

interface Stub { id: string; name: string; commander: string; cards: string[] }
interface Card {
  name: string; type_line?: string; oracle_text?: string;
  keywords?: string[]; cmc?: number;
}

/**
 * Registry keys, read out of the source rather than imported.
 *
 * Importing effects.ts would drag in the `@/` alias and the whole module graph
 * for what is two regexes. Keys are quoted object literals, and names contain
 * apostrophes, so both quote styles are matched — miss that and every card
 * called "Hero's Downfall" reads as an unhandled gap.
 */
function registryNames(): Set<string> {
  const src = readFileSync(EFFECTS, 'utf-8') + readFileSync(COMBOS, 'utf-8');
  const out = new Set<string>();
  for (const m of src.matchAll(/^\s*'([^']+)':\s*[[{]/gm)) out.add(m[1]);
  for (const m of src.matchAll(/^\s*"([^"]+)":\s*[[{]/gm)) out.add(m[1]);
  // Combo pieces are named in arrays, not as keys, but a piece the engine knows
  // to assemble is a card it understands.
  for (const m of src.matchAll(/onBattlefield:\s*\[([^\]]*)\]/g)) {
    for (const n of m[1].matchAll(/['"]([^'"]+)['"]/g)) out.add(n[1]);
  }
  for (const m of src.matchAll(/inHand:\s*\[([^\]]*)\]/g)) {
    for (const n of m[1].matchAll(/['"]([^'"]+)['"]/g)) out.add(n[1]);
  }
  return out;
}

const MANA_ABILITY = /\{t\}[^:]*:\s*add/i;

function distinctNames(stub: Stub): string[] {
  const out = new Set<string>([stub.commander]);
  for (const entry of stub.cards) {
    const m = entry.match(/^\s*(\d+)\s+(.*)$/);
    const name = (m ? m[2] : entry).trim();
    if (name) out.add(name);
  }
  return [...out].sort();
}

type Bucket = 'land' | 'mana' | 'scripted' | 'vanilla' | 'gap';

function classify(card: Card, known: Set<string>): Bucket {
  const type = (card.type_line ?? '').toLowerCase();
  if (type.includes('land')) return 'land';
  if (known.has(card.name)) return 'scripted';
  const text = (card.oracle_text ?? '').trim();
  if (MANA_ABILITY.test(text)) return 'mana';
  // Parenthesised reminder text restates a keyword and never carries rules the
  // engine needs — leaving it in made every Menace creature read as a gap.
  let rest = text.replace(/\([^)]*\)/g, '');
  // Then the keywords themselves, which `keywordsOf` already reads off the card.
  for (const kw of card.keywords ?? []) rest = rest.replaceAll(new RegExp(kw, 'gi'), '');
  return rest.replace(/[\s,.\n()—-]+/g, '') ? 'gap' : 'vanilla';
}

function main() {
  const stubs = (JSON.parse(readFileSync(STUBS, 'utf-8')) as { stubs: Stub[] }).stubs;
  const fixture = JSON.parse(readFileSync(FIXTURE, 'utf-8')) as { cards: Record<string, Card> };
  const known = registryNames();

  console.log(`${known.size} cards in the registries\n`);
  const head = ['deck', 'cards', 'land', 'mana', 'scripted', 'vanilla', 'GAP', 'understood'];
  console.log(
    head[0].padEnd(24) + head.slice(1, 7).map(h => h.padStart(9)).join('') + head[7].padStart(12),
  );
  console.log('-'.repeat(24 + 9 * 6 + 12));

  const queues: { deck: string; gaps: Card[] }[] = [];
  const coverage: Record<string, { understood: number; gaps: number; cards: number }> = {};
  let absent = 0;

  for (const stub of stubs) {
    const names = distinctNames(stub);
    const counts: Record<Bucket, number> = { land: 0, mana: 0, scripted: 0, vanilla: 0, gap: 0 };
    const gaps: Card[] = [];
    for (const name of names) {
      const card = fixture.cards[name];
      if (!card) { absent++; continue; }
      const bucket = classify({ ...card, name }, known);
      counts[bucket]++;
      if (bucket === 'gap') gaps.push({ ...card, name });
    }
    const total = names.length - 0;
    const understood = total > 0 ? Math.round(((total - counts.gap) / total) * 100) : 100;
    console.log(
      stub.name.padEnd(24)
      + [total, counts.land, counts.mana, counts.scripted, counts.vanilla, counts.gap]
        .map(n => String(n).padStart(9)).join('')
      + `${understood}%`.padStart(12),
    );
    queues.push({ deck: stub.name, gaps });
    coverage[stub.id] = { understood, gaps: counts.gap, cards: total };
  }

  writeFileSync(COVERAGE, JSON.stringify(coverage, null, 2) + '\n');

  if (absent > 0) {
    console.log(`\n! ${absent} card(s) missing from the fixture — run npm run build:bot-fixture`);
  }

  // The authoring queue. Most expensive first: a 6-drop the bot does not
  // understand costs it far more than a 1-drop does.
  console.log('\nAuthoring queue — cards with text and no guidance:');
  for (const { deck, gaps } of queues) {
    if (gaps.length === 0) { console.log(`\n  ${deck}: clean`); continue; }
    console.log(`\n  ${deck} (${gaps.length}):`);
    for (const c of [...gaps].sort((a, b) => (b.cmc ?? 0) - (a.cmc ?? 0))) {
      const line = (c.oracle_text ?? '').replace(/\n/g, ' ').slice(0, 84);
      console.log(`    ${String(c.cmc ?? 0).padStart(2)}  ${c.name.padEnd(30)} ${line}`);
    }
  }
}

main();
