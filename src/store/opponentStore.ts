import { create } from 'zustand';
import { usePlaytestStore } from '@/store/playtestStore';
import { usePlaytestSettings } from '@/store/playtestSettingsStore';
import { takeTurn } from '@/services/playtest/opponents/engine';
import { buildOpponentFromStub, findStub } from '@/services/playtest/opponents/deckSources';
import { fisherYates, makeInstanceId } from '@/components/playtest/utils';
import { getFrontFaceTypeLine } from '@/services/scryfall/client';
import { resolvePT } from '@/services/playtest/powerToughness';
import type { AppliedEffect, PlayerBoardRead } from '@/services/playtest/opponents/evaluate';
import type { Opponent, OpponentZone } from '@/components/playtest/opponentTypes';
import type { ScryfallCard } from '@/types';

const STARTING_LIFE = 40;
export const MAX_OPPONENTS = 3;

interface OpponentState {
  opponents: Opponent[];
  /** Stub ids currently being fetched, so the picker can show per-deck spinners. */
  loadingStubIds: string[];
  error: string | null;
}

interface OpponentActions {
  addFromStub: (stubId: string) => Promise<void>;
  remove: (id: string) => void;
  clearAll: () => void;
  adjustLife: (id: string, delta: number) => void;
  setLife: (id: string, life: number) => void;
  togglePermanentTap: (opponentId: string, instanceId: string) => void;
  removePermanent: (opponentId: string, instanceId: string) => void;
  /** Run every bot's turn in sequence. Called from the player's Next Turn. */
  runAllTurns: () => void;
  /** Reshuffle every seated bot back to a fresh opening hand. No refetch. */
  resetAll: () => void;
  setResistance: (id: string, resistance: boolean) => void;
  setAggression: (id: string, aggression: number) => void;
  /** Theft: pull a permanent off a bot's board and hand the card back. */
  takePermanent: (opponentId: string, instanceId: string) => ScryfallCard | null;
  /** The other direction — donate effects, or stocking a board by hand. */
  givePermanent: (opponentId: string, card: ScryfallCard) => void;
  /** Move one of their permanents off the board into one of their zones. */
  permanentToZone: (opponentId: string, instanceId: string, zone: OpponentZone) => void;
  adjustPermanentCounter: (opponentId: string, instanceId: string, type: string, delta: number) => void;
  untapAll: (opponentId: string) => void;
}

/**
 * Flatten the player's battlefield into what a bot needs to make decisions.
 * Combo membership comes from the detection the playtest already runs, which is
 * what lets a bot break up a combo that's one card from live — the one thing
 * here no other playtester does.
 */
function readPlayerBoard(): PlayerBoardRead {
  const s = usePlaytestStore.getState();
  const commanders = new Set(s.source?.commanderNames ?? []);

  // Only combos that are live or a single card away are worth disrupting.
  const liveComboByCard = new Map<string, string>();
  for (const combo of s.combos) {
    if (!combo.isComplete && combo.missingCards.length > 1) continue;
    for (const name of combo.cards) liveComboByCard.set(name, combo.comboId);
  }

  return {
    life: s.life,
    handSize: s.zones.hand.length,
    cards: s.battlefield.map(b => {
      const type = getFrontFaceTypeLine(b.card).toLowerCase();
      const pt = resolvePT(b);
      const power = parseInt(pt?.modified.split('/')[0] ?? '', 10);
      const toughness = parseInt(pt?.modified.split('/')[1] ?? '', 10);
      return {
        instanceId: b.instanceId,
        name: b.card.name,
        isCreature: type.includes('creature'),
        isArtifact: type.includes('artifact'),
        // Counters and stickers already changed these numbers on screen; a bot
        // reading the printed values would target the wrong creature.
        power: Number.isNaN(power) ? 0 : power,
        toughness: Number.isNaN(toughness) ? 0 : toughness,
        isCommander: commanders.has(b.card.name),
        comboId: liveComboByCard.get(b.card.name) ?? null,
      };
    }),
  };
}

/** Apply one bot effect to the player's board through the normal move path. */
function applyEffect(effect: AppliedEffect) {
  const playtest = usePlaytestStore.getState();

  for (const instanceId of effect.destroy) {
    playtest.moveCard({
      source: { kind: 'battlefield', instanceId },
      target: { kind: 'zone', zone: effect.destination },
    });
  }

  if (effect.discard > 0) {
    for (let i = 0; i < effect.discard; i++) {
      const hand = usePlaytestStore.getState().zones.hand;
      if (hand.length === 0) break;
      const index = Math.floor(Math.random() * hand.length);
      playtest.appendLog(`You discard ${hand[index].name}`);
      playtest.moveCard({
        source: { kind: 'zone', zone: 'hand', index },
        target: { kind: 'zone', zone: 'graveyard' },
      });
    }
  }

  if (effect.lifeLoss > 0) playtest.adjustLife(-effect.lifeLoss);
}

const initial: OpponentState = {
  opponents: [],
  loadingStubIds: [],
  error: null,
};

/**
 * Opponents live in their own store rather than joining playtestStore, which is
 * already ~1,300 lines. The coupling is one-directional and explicit: bot effects
 * reach the player's board through `usePlaytestStore.getState()`, and the playtest
 * store never imports this one.
 *
 * Bot actions are deliberately outside the playtest undo history — Ctrl+Z rewinds
 * your own moves, not the opponents' turns.
 */
export const useOpponentStore = create<OpponentState & OpponentActions>((set, get) => ({
  ...initial,

  addFromStub: async (stubId) => {
    if (get().opponents.length >= MAX_OPPONENTS) return;
    const stub = findStub(stubId);
    if (!stub) { set({ error: `Unknown opponent deck "${stubId}"` }); return; }

    set(s => ({ loadingStubIds: [...s.loadingStubIds, stubId], error: null }));
    try {
      const opponent = await buildOpponentFromStub(
        stub,
        STARTING_LIFE,
        usePlaytestSettings.getState().opponentResistanceDefault,
      );
      set(s => ({
        opponents: s.opponents.length >= MAX_OPPONENTS ? s.opponents : [...s.opponents, opponent],
        loadingStubIds: s.loadingStubIds.filter(id => id !== stubId),
      }));
      usePlaytestStore.getState().appendLog(`${stub.name} sat down across from you`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      set(s => ({
        loadingStubIds: s.loadingStubIds.filter(id => id !== stubId),
        error: `Could not load ${stub.name}: ${msg}`,
      }));
    }
  },

  remove: (id) => set(s => {
    const gone = s.opponents.find(o => o.id === id);
    if (gone) usePlaytestStore.getState().appendLog(`${gone.name} left the table`);
    return { opponents: s.opponents.filter(o => o.id !== id) };
  }),

  clearAll: () => set({ opponents: [], error: null }),

  adjustLife: (id, delta) => set(s => ({
    opponents: s.opponents.map(o => (o.id === id ? { ...o, life: o.life + delta } : o)),
  })),

  setLife: (id, life) => set(s => ({
    opponents: s.opponents.map(o => (o.id === id ? { ...o, life } : o)),
  })),

  togglePermanentTap: (opponentId, instanceId) => set(s => ({
    opponents: s.opponents.map(o =>
      o.id === opponentId
        ? {
            ...o,
            battlefield: o.battlefield.map(p =>
              p.instanceId === instanceId ? { ...p, tapped: !p.tapped } : p,
            ),
          }
        : o,
    ),
  })),

  permanentToZone: (opponentId, instanceId, zone) => set(s => ({
    opponents: s.opponents.map(o => {
      if (o.id !== opponentId) return o;
      const hit = o.battlefield.find(p => p.instanceId === instanceId);
      if (!hit) return o;
      const label =
        zone === 'graveyard' ? 'graveyard'
      : zone === 'exile'     ? 'exile'
      : zone === 'hand'      ? 'hand'
      :                        'top of library';
      usePlaytestStore.getState().appendLog(`${o.name}'s ${hit.card.name} → ${label}`);
      return {
        ...o,
        battlefield: o.battlefield.filter(p => p.instanceId !== instanceId),
        graveyard: zone === 'graveyard' ? [...o.graveyard, hit.card] : o.graveyard,
        exile:     zone === 'exile'     ? [...o.exile, hit.card]     : o.exile,
        hand:      zone === 'hand'      ? [...o.hand, hit.card]      : o.hand,
        library:   zone === 'library'   ? [hit.card, ...o.library]   : o.library,
      };
    }),
  })),

  adjustPermanentCounter: (opponentId, instanceId, type, delta) => set(s => ({
    opponents: s.opponents.map(o =>
      o.id === opponentId
        ? {
            ...o,
            battlefield: o.battlefield.map(p => {
              if (p.instanceId !== instanceId) return p;
              const counters = { ...p.counters };
              const next = (counters[type] ?? 0) + delta;
              if (next <= 0) delete counters[type];
              else counters[type] = next;
              return { ...p, counters };
            }),
          }
        : o,
    ),
  })),

  untapAll: (opponentId) => set(s => ({
    opponents: s.opponents.map(o =>
      o.id === opponentId
        ? { ...o, battlefield: o.battlefield.map(p => ({ ...p, tapped: false })) }
        : o,
    ),
  })),

  removePermanent: (opponentId, instanceId) => set(s => ({
    opponents: s.opponents.map(o => {
      if (o.id !== opponentId) return o;
      const hit = o.battlefield.find(p => p.instanceId === instanceId);
      if (hit) usePlaytestStore.getState().appendLog(`${o.name}'s ${hit.card.name} was destroyed`);
      return {
        ...o,
        battlefield: o.battlefield.filter(p => p.instanceId !== instanceId),
        graveyard: hit ? [...o.graveyard, hit.card] : o.graveyard,
      };
    }),
  })),

  runAllTurns: () => {
    const { opponents } = get();
    if (opponents.length === 0) return;

    const next: Opponent[] = [];
    let totalDamage = 0;

    for (const opponent of opponents) {
      // Re-read the board for every bot: the one before it may have blown up
      // half of it, and targeting a creature that's already dead reads as broken.
      const result = takeTurn(opponent, readPlayerBoard());
      next.push(result.opponent);
      totalDamage += result.damageToPlayer;
      result.logs.forEach(line => usePlaytestStore.getState().appendLog(line));
      result.effects.forEach(applyEffect);
    }

    set({ opponents: next });
    if (totalDamage > 0) usePlaytestStore.getState().adjustLife(-totalDamage);
  },

  setResistance: (id, resistance) => set(s => ({
    opponents: s.opponents.map(o => (o.id === id ? { ...o, resistance } : o)),
  })),

  setAggression: (id, aggression) => set(s => ({
    opponents: s.opponents.map(o => (o.id === id ? { ...o, aggression } : o)),
  })),

  takePermanent: (opponentId, instanceId) => {
    const opponent = get().opponents.find(o => o.id === opponentId);
    const permanent = opponent?.battlefield.find(p => p.instanceId === instanceId);
    if (!opponent || !permanent) return null;
    set(s => ({
      opponents: s.opponents.map(o =>
        o.id === opponentId
          ? { ...o, battlefield: o.battlefield.filter(p => p.instanceId !== instanceId) }
          : o,
      ),
    }));
    usePlaytestStore.getState().appendLog(`You took ${permanent.card.name} from ${opponent.name}`);
    return permanent.card;
  },

  givePermanent: (opponentId, card) => {
    const opponent = get().opponents.find(o => o.id === opponentId);
    if (!opponent) return;
    set(s => ({
      opponents: s.opponents.map(o =>
        o.id === opponentId
          ? {
              ...o,
              battlefield: [
                ...o.battlefield,
                { instanceId: makeInstanceId(), card, tapped: false, summoningSick: true, counters: {} },
              ],
            }
          : o,
      ),
    }));
    usePlaytestStore.getState().appendLog(`${card.name} went to ${opponent.name}`);
  },

  resetAll: () => set(s => {
    if (s.opponents.length === 0) return {};
    return {
      opponents: s.opponents.map(o => {
        // Gather every card back — tokens have no printing to return to, and
        // nothing here creates them yet, but filter anyway so that stays true.
        const all = [
          ...o.library,
          ...o.hand,
          ...o.graveyard,
          ...o.exile,
          ...o.battlefield.map(p => p.card),
        ].filter(c => !c.type_line.toLowerCase().includes('token'));
        const shuffled = fisherYates(all);
        return {
          ...o,
          life: STARTING_LIFE,
          library: shuffled.slice(7),
          hand: shuffled.slice(0, 7),
          graveyard: [],
          exile: [],
          battlefield: [],
          decked: false,
          turnsTaken: 0,
        };
      }),
    };
  }),
}));
