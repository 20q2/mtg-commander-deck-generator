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
 * Shuffle and draw seven, redrawing a hand with fewer than two or more than
 * five lands. Bots do
 * not mulligan down to six — they just take another seven, up to four tries,
 * and keep the best they saw. A one-land keep produces a bot that does nothing
 * for ten turns, which reads as the feature being broken rather than as variance.
 */
function openingHand(pool: ScryfallCard[]): { library: ScryfallCard[]; hand: ScryfallCard[] } {
  let best: { library: ScryfallCard[]; hand: ScryfallCard[] } | null = null;
  let bestLands = -1;
  for (let attempt = 0; attempt < 4; attempt++) {
    const shuffled = fisherYates(pool);
    const hand = shuffled.slice(0, 7);
    const lands = hand.filter(isLand).length;
    // A keep is two to five lands. Seven lands used to count as the best hand
    // seen, because "more lands" was the only score.
    const keepable = lands >= 2 && lands <= 5;
    if (keepable) {
      best = { library: shuffled.slice(7), hand };
      break;
    }
    // Nothing keepable yet: remember the hand closest to three lands.
    if (best === null || Math.abs(lands - 3) < Math.abs(bestLands - 3)) {
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
