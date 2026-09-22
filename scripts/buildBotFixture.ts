/**
 * Builds `src/services/playtest/opponents/__tests__/botGames.fixture.json` — the
 * offline card snapshot the bot diagnostic plays its games against.
 *
 * Run manually: `npm run build:bot-fixture`. NOT a cron job. It only needs
 * running when a deck in `src/data/opponentStubs.json` changes.
 *
 * ## Why this exists
 *
 * The diagnostic drives the real `takeTurn` against the real decklists over
 * hundreds of games, and it must be deterministic and offline — a balance
 * measurement that depends on the network is not a measurement. So it reads
 * cards from a committed snapshot instead.
 *
 * That snapshot was maintained by hand, which was survivable at four 40-card
 * decks and is not survivable at ten precons: the diagnostic hard-fails with
 * `fixture missing` the moment a decklist gains a card nobody remembered to add.
 * Hence a generator.
 *
 * ## What it writes
 *
 * Only the fields the engine actually reads — name, id, cmc, mana_cost,
 * type_line, oracle_text, power, toughness, keywords, produced_mana, and the
 * token parts of all_parts. A full Scryfall payload is ~20x larger and none of the rest is
 * consulted, so trimming keeps a ten-deck fixture reviewable in a diff.
 */

import { writeFileSync, readFileSync } from 'node:fs';

const SCRYFALL = 'https://api.scryfall.com';
const BATCH = 75;
const DELAY_MS = 100;

/**
 * Scryfall rejects a default library User-Agent with a 400 and asks callers to
 * identify themselves. The browser client never hits this because the browser
 * sets one; a node script has to say who it is.
 */
const HEADERS = {
  'Content-Type': 'application/json',
  'Accept': 'application/json',
  'User-Agent': 'ManaFoundry-BotFixtureBuilder/1.0',
};

const STUBS = new URL('../src/data/opponentStubs.json', import.meta.url);
const OUT = new URL(
  '../src/services/playtest/opponents/__tests__/botGames.fixture.json',
  import.meta.url,
);

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

interface Stub { id: string; name: string; commander: string; cards: string[] }

/** "16 Mountain" → one entry per copy, deduplicated by the caller. */
function namesOf(stub: Stub): string[] {
  const out: string[] = [stub.commander];
  for (const entry of stub.cards) {
    const m = entry.match(/^\s*(\d+)\s+(.*)$/);
    const name = (m ? m[2] : entry).trim();
    if (name) out.push(name);
  }
  return out;
}

/** The subset of a Scryfall card the playtest engine reads. */
function trim(card: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {
    name: card.name,
    id: card.id,
    cmc: card.cmc,
    type_line: card.type_line,
  };
  // The coloured pips the mana planner reads. Without it every spell in the
  // fixture is all-generic and the diagnostic cannot see a colour screw.
  if (card.mana_cost) out.mana_cost = card.mana_cost;
  if (card.oracle_text) out.oracle_text = card.oracle_text;
  if (card.power !== undefined) out.power = card.power;
  if (card.toughness !== undefined) out.toughness = card.toughness;
  const keywords = card.keywords as string[] | undefined;
  if (keywords?.length) out.keywords = keywords;
  const mana = card.produced_mana as string[] | undefined;
  if (mana?.length) out.produced_mana = mana;

  // Only the token parts matter: `resolveDeckTokens` walks all_parts looking for
  // component === 'token', and the rest of the graph is noise here.
  const parts = card.all_parts as { component?: string; id?: string; name?: string }[] | undefined;
  const tokens = (parts ?? []).filter(p => p.component === 'token');
  if (tokens.length) out.all_parts = tokens.map(p => ({ component: 'token', id: p.id, name: p.name }));

  // A double-faced card keeps the faces the front-face helpers read.
  const faces = card.card_faces as Record<string, unknown>[] | undefined;
  if (faces?.length) {
    out.card_faces = faces.map(f => ({
      name: f.name, type_line: f.type_line, oracle_text: f.oracle_text,
      mana_cost: f.mana_cost, power: f.power, toughness: f.toughness,
    }));
  }
  return out;
}

/**
 * Resolve one name the collection endpoint would not take.
 *
 * The collection endpoint wants exact names and is particular about split and
 * adventure cards — it rejects "Dusk // Dawn" outright even though that IS the
 * canonical name. The fuzzy endpoint takes them, and also quietly forgives the
 * transcription slips that come with copying a decklist off a web page.
 *
 * Keyed by the name the stub asked for, because that is what the engine looks
 * up at play time. A canonical name that differs is printed rather than
 * silently accepted: a fuzzy match is a guess, and a wrong guess would put a
 * card nobody chose into a deck.
 */
async function fuzzyResolve(name: string): Promise<Record<string, unknown> | null> {
  const res = await fetch(
    `${SCRYFALL}/cards/named?fuzzy=${encodeURIComponent(name)}`,
    { headers: HEADERS },
  );
  await sleep(DELAY_MS);
  if (!res.ok) return null;
  const card = await res.json() as Record<string, unknown>;
  if (card.name !== name) {
    console.warn(`  ~ "${name}" resolved to "${card.name as string}" — check the decklist`);
  }
  return card;
}

async function fetchByNames(names: string[]): Promise<Map<string, Record<string, unknown>>> {
  const found = new Map<string, Record<string, unknown>>();
  const misses: string[] = [];
  for (let i = 0; i < names.length; i += BATCH) {
    const slice = names.slice(i, i + BATCH);
    const res = await fetch(`${SCRYFALL}/cards/collection`, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({ identifiers: slice.map(name => ({ name })) }),
    });
    if (!res.ok) {
      throw new Error(`Scryfall ${res.status} on batch ${i / BATCH}: ${await res.text()}`);
    }
    const json = await res.json() as {
      data: Record<string, unknown>[];
      not_found?: { name: string }[];
    };
    for (const card of json.data) found.set(card.name as string, card);
    for (const miss of json.not_found ?? []) misses.push(miss.name);
    console.log(`  fetched ${Math.min(i + BATCH, names.length)}/${names.length}`);
    await sleep(DELAY_MS);
  }

  // Second pass, one at a time, for whatever the bulk endpoint refused.
  for (const name of misses) {
    const card = await fuzzyResolve(name);
    if (card) found.set(name, card);
  }
  return found;
}

/** Fetch every token any of these cards can make, by id. */
async function fetchTokens(
  cards: Record<string, unknown>[],
): Promise<Map<string, Record<string, unknown>>> {
  const ids = new Set<string>();
  for (const c of cards) {
    const parts = c.all_parts as { component?: string; id?: string }[] | undefined;
    for (const p of parts ?? []) {
      if (p.component === 'token' && p.id) ids.add(p.id);
    }
  }
  const out = new Map<string, Record<string, unknown>>();
  const list = [...ids];
  for (let i = 0; i < list.length; i += BATCH) {
    const slice = list.slice(i, i + BATCH);
    const res = await fetch(`${SCRYFALL}/cards/collection`, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({ identifiers: slice.map(id => ({ id })) }),
    });
    if (!res.ok) throw new Error(`Scryfall ${res.status} on token batch`);
    const json = await res.json() as { data: Record<string, unknown>[] };
    for (const t of json.data) out.set(t.id as string, t);
    console.log(`  tokens ${Math.min(i + BATCH, list.length)}/${list.length}`);
    await sleep(DELAY_MS);
  }
  return out;
}

async function main() {
  const stubs = (JSON.parse(readFileSync(STUBS, 'utf-8')) as { stubs: Stub[] }).stubs;
  const wanted = [...new Set(stubs.flatMap(namesOf))].sort();
  console.log(`${stubs.length} decks, ${wanted.length} distinct cards`);

  const found = await fetchByNames(wanted);
  const missing = wanted.filter(n => !found.has(n));
  if (missing.length > 0) {
    // Hard stop: a fixture that silently omits cards produces a diagnostic that
    // throws later with far less context than this.
    throw new Error(`Unresolved card names:\n  ${missing.join('\n  ')}`);
  }

  const tokens = await fetchTokens([...found.values()]);

  const cards: Record<string, unknown> = {};
  for (const name of wanted) cards[name] = trim(found.get(name)!);
  const tokenOut: Record<string, unknown> = {};
  for (const [id, t] of tokens) tokenOut[id] = trim(t);

  writeFileSync(OUT, JSON.stringify({ cards, tokens: tokenOut }));
  const kb = Math.round(readFileSync(OUT, 'utf-8').length / 1024);
  console.log(`\nwrote ${Object.keys(cards).length} cards + ${tokens.size} tokens (${kb}KB)`);
}

main().catch(e => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
