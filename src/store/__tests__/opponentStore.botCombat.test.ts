// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { useOpponentStore } from '@/store/opponentStore';
import { usePlaytestSettings } from '@/store/playtestSettingsStore';
import type { Opponent, OpponentPermanent } from '@/components/playtest/opponentTypes';
import type { ScryfallCard } from '@/types';

/**
 * The store-level half of bot combat: what survives from one seat's attack
 * into the next seat's turn. The engine is pure and well covered; this is the
 * seam where the planned turn meets the live table, and it is where a blocker
 * that died to seat A walked back onto the board during seat B's replay.
 */

let n = 0;
function card(p: Partial<ScryfallCard> & { name: string }): ScryfallCard {
  return {
    id: `c${n++}`, type_line: p.type_line ?? 'Creature — Goblin',
    cmc: p.cmc ?? 1, oracle_text: p.oracle_text ?? '', keywords: p.keywords ?? [],
    color_identity: [], colors: [], legalities: {}, set: 'tst', rarity: 'common',
    ...p,
  } as unknown as ScryfallCard;
}
const perm = (c: ScryfallCard, over: Partial<OpponentPermanent> = {}): OpponentPermanent =>
  ({ instanceId: `p${n++}`, card: c, tapped: false, summoningSick: false, counters: {}, ...over });

function bot(over: Partial<Opponent> = {}): Opponent {
  return {
    id: 'b1', name: 'Bot', stubId: null, blurb: '', colors: [], life: 40,
    library: [], hand: [], graveyard: [], exile: [], command: [],
    commanderName: null, commanderCasts: 0, tokens: [], battlefield: [],
    decked: false, resistance: false, aggression: 0.5, turnsTaken: 0, ...over,
  };
}

describe('runAllTurns across seats', () => {
  beforeEach(() => {
    // No pauses, no held stack: the whole cycle resolves inside the await.
    usePlaytestSettings.setState({ animations: false, stackHold: false });
    useOpponentStore.setState({ opponents: [], running: false, combat: null, stack: [] });
  });

  it('a blocker that died to an earlier seat stays dead through its own turn', async () => {
    const brute = perm(card({ name: 'Brute', cmc: 4, power: '4', toughness: '4' }));
    const chump = perm(card({ name: 'Chump', cmc: 1, power: '1', toughness: '1' }));
    const attacker = bot({ id: 'A', name: 'Seat A', battlefield: [brute] });
    // Three life behind one 1/1: a kill seat A cannot pass up, and a chump
    // block seat B cannot avoid. The 1/1 dies to the 4/4.
    const defender = bot({ id: 'B', name: 'Seat B', life: 3, battlefield: [chump] });
    useOpponentStore.setState({ opponents: [attacker, defender] });

    await useOpponentStore.getState().runAllTurns();

    const b = useOpponentStore.getState().opponents.find(o => o.id === 'B')!;
    expect(b.battlefield.map(p => p.card.name)).not.toContain('Chump');
    expect(b.graveyard.map(c => c.name)).toContain('Chump');
    expect(b.life).toBe(3);
  });
});
