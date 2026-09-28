import type { ScryfallCard } from '@/types';
import { getCardsByNames } from '@/services/scryfall/client';
import { fisherYates, isLand, makeInstanceId } from '@/components/playtest/utils';
import { resolveDeckTokens } from '@/services/playtest/tokens';
import type { Opponent, OpponentStub } from '@/components/playtest/opponentTypes';
import stubData from '@/data/opponentStubs.json';

export const OPPONENT_STUBS: OpponentStub[] = (stubData as { stubs: OpponentStub[] }).stubs;

export function findStub(id: string): OpponentStub | undefined {
  return OPPONENT_STUBS.find(s => s.id === id);
}

/** Expand "16 Mountain" style entries into one name per copy. */
function expandEntries(entries: string[]): string[] {
  const out: string[] = [];
  for (const entry of entries) {
    const match = entry.match(/^\s*(\d+)\s+(.*)$/);
    const qty = match ? parseInt(match[1], 10) : 1;
    const name = (match ? match[2] : entry).trim();
    if (!name) continue;
    for (let i = 0; i < qty; i++) out.push(name);
  }
  return out;
}

/**
 * Resolve a bundled stub into a ready-to-play opponent: cards fetched, commander
 * split out, library shuffled, opening seven drawn.
 *
 * Names that Scryfall can't resolve are skipped rather than failing the whole
 * deck — a bot one card short still plays fine, and a hard failure here would
 * block the whole feature over a single typo. But they are *reported*: dropping
 * them in silence meant a bot could quietly sit down as a 25-card deck, play
 * like it, and give you no way to tell why.
 */
export interface BuiltOpponent {
  opponent: Opponent;
  /** Deck entries Scryfall did not return, one per distinct name. */
  missing: string[];
}

export async function buildOpponentFromStub(
  stub: OpponentStub,
  startingLife: number,
  resistance: boolean,
): Promise<BuiltOpponent> {
  const names = expandEntries(stub.cards);
  const cardMap = await getCardsByNames(Array.from(new Set([...names, stub.commander])));

  const command: ScryfallCard[] = [];
  const commander = cardMap.get(stub.commander);
  if (commander) command.push(commander);

  const pool: ScryfallCard[] = [];
  const missing = new Set<string>();
  if (!commander) missing.add(stub.commander);
  for (const name of names) {
    if (name === stub.commander) continue;
    const card = cardMap.get(name);
    if (card) pool.push(card);
    else missing.add(name);
  }

  // Every token any card in this deck can make, in one batched, cached fetch.
  // A failure here costs the deck its tokens, not the whole bot.
  let tokens: ScryfallCard[] = [];
  try {
    tokens = await resolveDeckTokens([...pool, ...command]);
  } catch {
    tokens = [];
  }

  const { library, hand } = openingHand(pool);

  const opponent: Opponent = {
    id: makeInstanceId(),
    name: stub.name,
    stubId: stub.id,
    blurb: stub.blurb,
    colors: stub.colors,
    life: startingLife,
    library,
    hand,
    graveyard: [],
    exile: [],
    command,
    commanderName: commander?.name ?? null,
    commanderCasts: 0,
    tokens,
    battlefield: [],
    decked: false,
    resistance,
    aggression: 0.5,
    turnsTaken: 0,
  };
  return { opponent, missing: [...missing] };
}

/**
 * Shuffle and draw seven until the hand has three to five lands, then keep it.
 *
 * Bots never mulligan down to six — they take another fresh seven, free, as
 * many times as it takes. That is not how Magic works, and it is deliberate:
 * a bot that keeps a two-lander and stalls out plays no game at all, and what
 * you are playing against it for is a game. The floor is three rather than two
 * because two-land keeps in a 99-card deck miss their third drop often enough
 * to produce exactly the do-nothing opponent this is here to prevent.
 *
 * The ceiling still matters — an unbounded "more lands is better" search walks
 * itself to a seven-land hand that also does nothing.
 *
 * MULLIGAN_TRIES is a safety valve, not a budget. A hundred shuffles of a
 * 60-card array costs well under a millisecond and runs once per bot per game,
 * so the number is set by how badly the worst deck needs it rather than by
 * cost: our leanest stub hits the window about one shuffle in nine, which over
 * a hundred tries misses a few times in a million games. When it does miss we
 * keep the closest hand we saw, rather than looping forever on a deck that
 * cannot satisfy the window at all (a deck short a dozen cards Scryfall could
 * not resolve, say).
 */
const MULLIGAN_TRIES = 100;
const MIN_OPENING_LANDS = 3;
const MAX_OPENING_LANDS = 5;

/**
 * `shuffleFn` exists so the seeded game-simulation diagnostic can run this exact
 * rule off its own PRNG. Without it the harness dealt a raw seven and quietly
 * measured a bot that keeps one-land hands — the opposite of what ships.
 */
export function openingHand(
  pool: ScryfallCard[],
  shuffleFn: (cards: ScryfallCard[]) => ScryfallCard[] = fisherYates,
): { library: ScryfallCard[]; hand: ScryfallCard[] } {
  let best: { library: ScryfallCard[]; hand: ScryfallCard[] } | null = null;
  let bestLands = -1;
  for (let attempt = 0; attempt < MULLIGAN_TRIES; attempt++) {
    const shuffled = shuffleFn(pool);
    const hand = shuffled.slice(0, 7);
    const lands = hand.filter(isLand).length;
    if (lands >= MIN_OPENING_LANDS && lands <= MAX_OPENING_LANDS) {
      return { library: shuffled.slice(7), hand };
    }
    // Nothing keepable yet: remember the hand closest to the floor, so a deck
    // that can never hit the window still sits down with its best showing.
    if (best === null || Math.abs(lands - MIN_OPENING_LANDS) < Math.abs(bestLands - MIN_OPENING_LANDS)) {
      bestLands = lands;
      best = { library: shuffled.slice(7), hand };
    }
  }
  return best ?? { library: pool.slice(7), hand: pool.slice(0, 7) };
}

/**
 * How many cards the deck actually sits down with: the 99 (or however many we
 * wrote) plus the commander. Mirrors `buildOpponentFromStub`'s split, so a
 * commander that also appears in the list is still counted once.
 */
export function stubDeckSize(stub: OpponentStub): number {
  return expandEntries(stub.cards).filter(n => n !== stub.commander).length + 1;
}
