import { create } from 'zustand';
import { usePlaytestStore } from '@/store/playtestStore';
import { takeTurn } from '@/services/playtest/opponents/engine';
import { buildOpponentFromStub, findStub } from '@/services/playtest/opponents/deckSources';
import { fisherYates } from '@/components/playtest/utils';
import type { Opponent } from '@/components/playtest/opponentTypes';

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
      const opponent = await buildOpponentFromStub(stub, STARTING_LIFE);
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

    const playtest = usePlaytestStore.getState();
    const next: Opponent[] = [];
    let totalDamage = 0;

    for (const opponent of opponents) {
      const result = takeTurn(opponent);
      next.push(result.opponent);
      totalDamage += result.damageToPlayer;
      result.logs.forEach(line => playtest.appendLog(line));
    }

    set({ opponents: next });
    if (totalDamage > 0) playtest.adjustLife(-totalDamage);
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
          ...o.battlefield.map(p => p.card),
        ].filter(c => !c.type_line.toLowerCase().includes('token'));
        const shuffled = fisherYates(all);
        return {
          ...o,
          life: STARTING_LIFE,
          library: shuffled.slice(7),
          hand: shuffled.slice(0, 7),
          graveyard: [],
          battlefield: [],
          decked: false,
        };
      }),
    };
  }),
}));
