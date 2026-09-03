import type { ScryfallCard } from '@/types';
import { getCardsByNames } from '@/services/scryfall/client';
import { fisherYates, makeInstanceId } from '@/components/playtest/utils';
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
 * block the whole feature over a single typo.
 */
export async function buildOpponentFromStub(stub: OpponentStub, startingLife: number): Promise<Opponent> {
  const names = expandEntries(stub.cards);
  const cardMap = await getCardsByNames(Array.from(new Set([...names, stub.commander])));

  const command: ScryfallCard[] = [];
  const commander = cardMap.get(stub.commander);
  if (commander) command.push(commander);

  const pool: ScryfallCard[] = [];
  for (const name of names) {
    if (name === stub.commander) continue;
    const card = cardMap.get(name);
    if (card) pool.push(card);
  }

  const shuffled = fisherYates(pool);
  return {
    id: makeInstanceId(),
    name: stub.name,
    stubId: stub.id,
    blurb: stub.blurb,
    colors: stub.colors,
    life: startingLife,
    library: shuffled.slice(7),
    hand: shuffled.slice(0, 7),
    graveyard: [],
    exile: [],
    command,
    battlefield: [],
    decked: false,
    // Bots resist by default — a passive dummy is the opt-out, not the norm.
    resistance: true,
    aggression: 0.5,
    turnsTaken: 0,
  };
}
