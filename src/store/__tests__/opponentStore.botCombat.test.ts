// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { useOpponentStore } from '@/store/opponentStore';
import { usePlaytestSettings } from '@/store/playtestSettingsStore';
import { usePlaytestStore } from '@/store/playtestStore';
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
    usePlaytestSettings.setState({ animations: false, stackMode: 'auto' });
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
    // The 1/1 chump absorbed the 4/4, so the fight says so rather than going quiet.
    expect(usePlaytestStore.getState().log.map(l => l.text)).toContain("Seat A's attack on Seat B dealt no damage");
  });
  it("a bot killing your commander sends it to the command zone, not the graveyard", () => {
    const krenko = card({ name: 'Krenko, Mob Boss', cmc: 4, power: '3', toughness: '3', type_line: 'Legendary Creature — Goblin Warrior' });
    usePlaytestStore.setState({
      // Only commanderNames is read; the rest of SourceMeta is irrelevant here.
      source: { kind: 'pasted', name: 'Test', commanderNames: ['Krenko, Mob Boss'] } as never,
      battlefield: [{ instanceId: 'k1', card: krenko, x: 0, y: 0, tapped: false, faceDown: false, flipped: false, counters: {} }],
    });
    useOpponentStore.setState({
      opponents: [bot({ id: 'A', name: 'Seat A' })],
      stack: [{
        id: 's1', opponentId: 'A', opponentName: 'Seat A', name: 'Murder', kind: 'spell', label: 'Destroys Krenko',
        effect: { destroy: ['k1'], destination: 'graveyard', lifeLoss: 0, discard: 0 },
      }],
    });
    useOpponentStore.getState().resolveStackTop();
    const s = usePlaytestStore.getState();
    expect(s.battlefield.map(b => b.card.name)).not.toContain('Krenko, Mob Boss');
    expect(s.zones.command.map(c => c.name)).toContain('Krenko, Mob Boss');
    expect(s.zones.graveyard.map(c => c.name)).not.toContain('Krenko, Mob Boss');
  });
  it('warns when a creature that arrived this turn is declared as an attacker', () => {
    const goblin = card({ name: 'Goblin Piker', cmc: 2, power: '2', toughness: '1' });
    usePlaytestStore.setState({
      turn: 4,
      toast: null,
      battlefield: [{ instanceId: 'g1', card: goblin, x: 0, y: 0, tapped: false, faceDown: false, flipped: false, counters: {}, arrivedTurn: 4 }],
    });
    useOpponentStore.setState({ opponents: [bot({ id: 'A', name: 'Seat A' })], declaration: null, combatPhase: true });
    useOpponentStore.getState().declareAttacker('A', 'g1');
    expect(usePlaytestStore.getState().toast?.text).toMatch(/arrived this turn/);
    // Allowed anyway — it's a sandbox — so the declaration still lands.
    expect(useOpponentStore.getState().declaration?.A).toEqual(['g1']);
  });
  it('a bot effect aimed at a rival lands on that rival, not on your stack', async () => {
    const murder = card({ name: 'Murder', type_line: 'Instant', cmc: 3 });
    const fatty = perm(card({ name: 'Fatty', cmc: 6, power: '6', toughness: '6' }));
    const caster = bot({ id: 'A', name: 'Seat A', resistance: true, hand: [murder], turnsTaken: 6,
      battlefield: Array.from({ length: 3 }, () => perm(card({ name: 'Swamp', type_line: 'Basic Land — Swamp', cmc: 0 }))) });
    const victim = bot({ id: 'B', name: 'Seat B', battlefield: [fatty] });
    usePlaytestSettings.setState({ animations: false, stackMode: 'targeted' });
    useOpponentStore.setState({ opponents: [caster, victim], stack: [] });
    await useOpponentStore.getState().runAllTurns();
    const b = useOpponentStore.getState().opponents.find(o => o.id === 'B')!;
    expect(b.battlefield.map(p => p.card.name)).not.toContain('Fatty');
    expect(b.graveyard.map(c => c.name)).toContain('Fatty');
    expect(useOpponentStore.getState().stack).toHaveLength(0);
  });
});
