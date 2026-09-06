import { create } from 'zustand';
import { usePlaytestStore } from '@/store/playtestStore';
import { usePlaytestSettings } from '@/store/playtestSettingsStore';
import { floatDelta, useFloatingText } from '@/store/floatingTextStore';
import { takeTurn } from '@/services/playtest/opponents/engine';
import { buildOpponentFromStub, findStub } from '@/services/playtest/opponents/deckSources';
import { fisherYates, makeInstanceId } from '@/components/playtest/utils';
import { getFrontFaceTypeLine } from '@/services/scryfall/client';
import { resolvePT } from '@/services/playtest/powerToughness';
import { keywordsOf, resolveDamage, type Combatant } from '@/services/playtest/combat';
import { botPower, botToughness, isCreatureCard, isTokenCard } from '@/services/playtest/opponents/stats';
import { registerUndoParticipant } from '@/store/undoBridge';
import { chooseBlocks } from '@/services/playtest/opponents/evaluate';
import type { AppliedEffect, PlayerBoardRead } from '@/services/playtest/opponents/evaluate';
import type { CombatState, Opponent, OpponentPermanent, OpponentZone } from '@/components/playtest/opponentTypes';
import type { BattlefieldCard } from '@/components/playtest/types';
import type { ScryfallCard } from '@/types';

const STARTING_LIFE = 40;
export const MAX_OPPONENTS = 3;

/** Pause between the beats of a bot's turn — untap, land, cast, attack. */
const STEP_MS = 260;

/**
 * Settles the promise that combat is blocking on. Module-level because there's
 * one store and one combat at a time; parking it in state would mean storing a
 * function in Zustand, which nothing else here does.
 */
let combatResolver: (() => void) | null = null;

/**
 * Flatten one of the player's battlefield cards into a Combatant. Reads live
 * P/T through resolvePT so counters and stickers count — the same path the
 * blocker flattening in resolveCombat already uses.
 */
function playerCombatant(b: BattlefieldCard): Combatant {
  const [p, t] = (resolvePT(b)?.modified ?? '0/0').split('/');
  const power = parseInt(p, 10);
  const toughness = parseInt(t, 10);
  return {
    instanceId: b.instanceId,
    name: b.card.name,
    power: Number.isNaN(power) ? 0 : power,
    toughness: Number.isNaN(toughness) ? 0 : toughness,
    keywords: keywordsOf(b.card),
  };
}

/**
 * The same, for a bot's permanent. `battlefield` is the whole board it is on,
 * because its stats depend on it: counters on the card, anthems from the rest.
 */
function botCombatant(p: OpponentPermanent, battlefield: OpponentPermanent[]): Combatant {
  return {
    instanceId: p.instanceId,
    name: p.card.name,
    power: botPower(p, battlefield),
    toughness: botToughness(p, battlefield),
    keywords: keywordsOf(p.card),
  };
}

/**
 * Move permanents off a bot's battlefield to where they actually belong.
 * A commander goes back to the command zone so it can be recast, a token
 * ceases to exist, and everything else goes to the graveyard. Every death path
 * has to agree on this, so none of them writes it out by hand.
 */
function sendToGraveyard(o: Opponent, instanceIds: string[]): Opponent {
  if (instanceIds.length === 0) return o;
  const leaving = o.battlefield.filter(p => instanceIds.includes(p.instanceId));
  const toGraveyard = leaving
    .filter(p => !isTokenCard(p.card) && p.card.name !== o.commanderName)
    .map(p => p.card);
  const returning = leaving.filter(p => p.card.name === o.commanderName).map(p => p.card);
  return {
    ...o,
    battlefield: o.battlefield.filter(p => !instanceIds.includes(p.instanceId)),
    graveyard: [...o.graveyard, ...toGraveyard],
    command: [...o.command, ...returning],
  };
}

interface OpponentState {
  opponents: Opponent[];
  /** Stub ids currently being fetched, so the picker can show per-deck spinners. */
  loadingStubIds: string[];
  error: string | null;
  /** True while turns are animating, so a double-click can't interleave them. */
  running: boolean;
  /** Set while a bot is attacking and waiting on your blocks. */
  combat: CombatState | null;
  /**
   * True once you've stepped into combat. The seats' strips only open as drop
   * targets in this phase — an explicit step rather than something that
   * appears whenever you happen to pick a card up.
   */
  combatPhase: boolean;
  /**
   * Your attack in progress, before you confirm it: opponentId → the
   * battlefield instanceIds you've dropped into that seat's strip.
   */
  declaration: Record<string, string[]> | null;
  /** Set on confirm — the bots' chosen blocks, waiting on Resolve. */
  playerCombat: {
    perOpponent: Record<string, {
      attackers: string[];
      blocks: Record<string, string[]>;
    }>;
  } | null;
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
  runAllTurns: () => Promise<void>;
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
  /** Assign one of your creatures to block an attacker. */
  assignBlocker: (attackerId: string, blockerInstanceId: string) => void;
  removeBlocker: (attackerId: string, blockerInstanceId: string) => void;
  /** Work out damage, kill what died, and let the bot's turn continue. */
  resolveCombat: () => void;
  /** Step into combat — opens every seat's strip as a drop target. */
  enterCombat: () => void;
  /** Back out. Anything declared is untapped and forgotten. */
  exitCombat: () => void;
  /** Drop one of your creatures into a seat's strip. Taps it unless vigilant. */
  declareAttacker: (opponentId: string, instanceId: string) => void;
  /** Pull a declared attacker back out. Untaps it. */
  undeclareAttacker: (instanceId: string) => void;
  /** Lock the attack in and let every bot choose its blocks. */
  confirmAttack: () => void;
  /** Work out damage in your direction and clear the strips. */
  resolvePlayerCombat: () => void;
  /** Throw away an unconfirmed declaration, untapping everything in it. */
  discardDeclaration: () => void;
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
  running: false,
  combat: null,
  combatPhase: false,
  declaration: null,
  playerCombat: null,
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

  clearAll: () => {
    // Never leave a turn awaiting blocks for a table that no longer exists.
    combatResolver?.();
    combatResolver = null;
    set({
      opponents: [], error: null, combat: null, combatPhase: false,
      declaration: null, playerCombat: null, running: false,
    });
  },

  assignBlocker: (attackerId, blockerInstanceId) => set(s => {
    if (!s.combat) return {};
    // Legality lives here rather than in the drop handler, because there are
    // two ways to assign a blocker now — dragging a creature up onto the
    // attacker, and pulling a targeting arrow down out of its blocker slot —
    // and both have to agree on what a legal blocker is.
    const card = usePlaytestStore.getState().battlefield
      .find(b => b.instanceId === blockerInstanceId);
    if (!card || card.tapped) return {};
    if (!getFrontFaceTypeLine(card.card).toLowerCase().includes('creature')) return {};
    // A creature can only block once — drop it from any other attacker first.
    const blocks: Record<string, string[]> = {};
    for (const [id, ids] of Object.entries(s.combat.blocks)) {
      blocks[id] = ids.filter(b => b !== blockerInstanceId);
    }
    const current = blocks[attackerId] ?? [];
    blocks[attackerId] = [...current, blockerInstanceId];
    return { combat: { ...s.combat, blocks } };
  }),

  removeBlocker: (attackerId, blockerInstanceId) => set(s => {
    if (!s.combat) return {};
    return {
      combat: {
        ...s.combat,
        blocks: {
          ...s.combat.blocks,
          [attackerId]: (s.combat.blocks[attackerId] ?? []).filter(b => b !== blockerInstanceId),
        },
      },
    };
  }),

  resolveCombat: () => {
    const combat = get().combat;
    if (!combat) return;
    const playtest = usePlaytestStore.getState();
    const float = useFloatingText.getState().float;

    const attackers: Combatant[] = combat.attackers.map(a => ({
      instanceId: a.instanceId,
      name: a.card.name,
      power: a.power,
      toughness: a.toughness,
      keywords: keywordsOf(a.card),
    }));

    // Blockers are read off the live board so counters and P/T stickers count.
    const names = new Map<string, string>();
    const blocks: Record<string, Combatant[]> = {};
    for (const attacker of combat.attackers) {
      const ids = combat.blocks[attacker.instanceId] ?? [];
      blocks[attacker.instanceId] = ids
        .map(id => playtest.battlefield.find(b => b.instanceId === id))
        .filter((b): b is NonNullable<typeof b> => !!b)
        .map(b => {
          const pt = resolvePT(b);
          const [p, t] = (pt?.modified ?? '0/0').split('/');
          const power = parseInt(p, 10);
          const toughness = parseInt(t, 10);
          names.set(b.instanceId, b.card.name);
          return {
            instanceId: b.instanceId,
            name: b.card.name,
            power: Number.isNaN(power) ? 0 : power,
            toughness: Number.isNaN(toughness) ? 0 : toughness,
            keywords: keywordsOf(b.card),
          };
        });
    }

    const outcome = resolveDamage(attackers, blocks);
    const { deadAttackers, deadBlockers } = outcome;

    for (const id of deadBlockers) {
      float('Dies', 'damage', id);
      const killer = combat.attackers.find(a =>
        (combat.blocks[a.instanceId] ?? []).includes(id),
      );
      playtest.appendLog(
        `${names.get(id) ?? 'A creature'} died blocking ${killer?.card.name ?? 'an attacker'}`,
      );
    }
    for (const id of deadAttackers) {
      float('Dies', 'damage', id);
      const attacker = combat.attackers.find(a => a.instanceId === id);
      playtest.appendLog(`${attacker?.card.name ?? 'An attacker'} died in combat`);
    }

    for (const id of deadBlockers) {
      playtest.moveCard({
        source: { kind: 'battlefield', instanceId: id },
        target: { kind: 'zone', zone: 'graveyard' },
      });
    }
    if (deadAttackers.length > 0) {
      set(s => ({
        opponents: s.opponents.map(o =>
          o.id === combat.opponentId ? sendToGraveyard(o, deadAttackers) : o,
        ),
      }));
    }

    if (outcome.damageToDefender > 0) {
      playtest.appendLog(`You took ${outcome.damageToDefender} from ${combat.opponentName}`);
      playtest.adjustLife(-outcome.damageToDefender);
    } else {
      playtest.appendLog(`${combat.opponentName}'s attack dealt no damage`);
    }

    set({ combat: null });
    combatResolver?.();
    combatResolver = null;
  },

  enterCombat: () => {
    if (get().opponents.length === 0) return;
    set({ combatPhase: true });
  },

  exitCombat: () => {
    get().discardDeclaration();
    set({ combatPhase: false });
  },

  declareAttacker: (opponentId, instanceId) => {
    const playtest = usePlaytestStore.getState();
    const card = playtest.battlefield.find(b => b.instanceId === instanceId);
    if (!card || card.tapped) return;
    if (!getFrontFaceTypeLine(card.card).toLowerCase().includes('creature')) return;

    const current = get().declaration;
    // Already swinging at someone? Don't let it attack twice.
    if (current && Object.values(current).some(ids => ids.includes(instanceId))) return;

    // First attacker of the attack: one checkpoint covers the whole arc.
    if (!current) playtest.pushCheckpoint();

    // Vigilance attacks without tapping. Everything else taps.
    if (!keywordsOf(card.card).has('vigilance')) {
      playtest.setTappedQuiet([instanceId], true);
    }

    set(s => {
      const next = { ...(s.declaration ?? {}) };
      next[opponentId] = [...(next[opponentId] ?? []), instanceId];
      return { declaration: next };
    });
  },

  undeclareAttacker: (instanceId) => {
    const current = get().declaration;
    if (!current) return;
    const playtest = usePlaytestStore.getState();
    const card = playtest.battlefield.find(b => b.instanceId === instanceId);
    if (card && !keywordsOf(card.card).has('vigilance')) {
      playtest.setTappedQuiet([instanceId], false);
    }
    set(() => {
      const next: Record<string, string[]> = {};
      for (const [oppId, ids] of Object.entries(current)) {
        const kept = ids.filter(id => id !== instanceId);
        if (kept.length > 0) next[oppId] = kept;
      }
      return { declaration: Object.keys(next).length > 0 ? next : null };
    });
  },

  discardDeclaration: () => {
    const current = get().declaration;
    if (!current) return;
    const playtest = usePlaytestStore.getState();
    const toUntap = Object.values(current).flat().filter(id => {
      const card = playtest.battlefield.find(b => b.instanceId === id);
      return card ? !keywordsOf(card.card).has('vigilance') : false;
    });
    playtest.setTappedQuiet(toUntap, false);
    set({ declaration: null });
  },

  confirmAttack: () => {
    const declaration = get().declaration;
    if (!declaration) return;
    const playtest = usePlaytestStore.getState();
    const opponents = get().opponents;

    const perOpponent: Record<string, { attackers: string[]; blocks: Record<string, string[]> }> = {};

    for (const [opponentId, instanceIds] of Object.entries(declaration)) {
      const opponent = opponents.find(o => o.id === opponentId);
      if (!opponent || instanceIds.length === 0) continue;

      const attackers = instanceIds
        .map(id => playtest.battlefield.find(b => b.instanceId === id))
        .filter((b): b is BattlefieldCard => !!b)
        .map(playerCombatant);

      // Untapped creatures only. Summoning-sick creatures block fine.
      const blockers = opponent.battlefield
        .filter(p => !p.tapped && isCreatureCard(p.card))
        .map(p => botCombatant(p, opponent.battlefield));

      perOpponent[opponentId] = {
        attackers: instanceIds,
        blocks: chooseBlocks({
          attackers,
          blockers,
          life: opponent.life,
          aggression: opponent.aggression,
        }),
      };

      playtest.appendLog(
        `You attack ${opponent.name} with ${attackers.length} creature${attackers.length === 1 ? '' : 's'}`,
      );
    }

    set({ declaration: null, playerCombat: { perOpponent } });
  },

  resolvePlayerCombat: () => {
    const playerCombat = get().playerCombat;
    if (!playerCombat) return;
    const playtest = usePlaytestStore.getState();
    const float = useFloatingText.getState().float;

    const myDead: string[] = [];
    const theirDead: Record<string, string[]> = {};

    for (const [opponentId, side] of Object.entries(playerCombat.perOpponent)) {
      const opponent = get().opponents.find(o => o.id === opponentId);
      if (!opponent) continue;

      const attackers = side.attackers
        .map(id => playtest.battlefield.find(b => b.instanceId === id))
        .filter((b): b is BattlefieldCard => !!b)
        .map(playerCombatant);

      const blocks: Record<string, Combatant[]> = {};
      for (const attacker of attackers) {
        blocks[attacker.instanceId] = (side.blocks[attacker.instanceId] ?? [])
          .map(id => opponent.battlefield.find(p => p.instanceId === id))
          .filter((p): p is OpponentPermanent => !!p)
          .map(p => botCombatant(p, opponent.battlefield));
      }

      // Same pure module the bot→player direction uses. It does not know or
      // care which side is defending.
      const outcome = resolveDamage(attackers, blocks);

      for (const id of outcome.deadAttackers) {
        float('Dies', 'damage', id);
        const c = attackers.find(a => a.instanceId === id);
        playtest.appendLog(`${c?.name ?? 'A creature'} died attacking ${opponent.name}`);
        myDead.push(id);
      }
      for (const id of outcome.deadBlockers) {
        float('Dies', 'damage', id);
        const p = opponent.battlefield.find(b => b.instanceId === id);
        playtest.appendLog(`${opponent.name}'s ${p?.card.name ?? 'creature'} died blocking`);
      }
      theirDead[opponentId] = outcome.deadBlockers;

      if (outcome.damageToDefender > 0) {
        playtest.appendLog(`${opponent.name} took ${outcome.damageToDefender}`);
        get().adjustLife(opponentId, -outcome.damageToDefender);
      } else {
        playtest.appendLog(`Your attack on ${opponent.name} dealt no damage`);
      }
    }

    // Your dead attackers go to your graveyard through the normal move path.
    for (const id of myDead) {
      playtest.moveCard({
        source: { kind: 'battlefield', instanceId: id },
        target: { kind: 'zone', zone: 'graveyard' },
      });
    }

    // Their dead blockers go to theirs. Survivors need no repositioning: they
    // never left `battlefield`, so their x/y is intact by construction.
    set(s => ({
      opponents: s.opponents.map(o => sendToGraveyard(o, theirDead[o.id] ?? [])),
      playerCombat: null,
      // Damage is dealt; the phase is over. combatPhase stays true from
      // confirm through here so the strips keep showing the blocks.
      combatPhase: false,
    }));
  },

  adjustLife: (id, delta) => {
    floatDelta(delta, `opp-life-${id}`);
    set(s => ({
      opponents: s.opponents.map(o => (o.id === id ? { ...o, life: o.life + delta } : o)),
    }));
  },

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

  adjustPermanentCounter: (opponentId, instanceId, type, delta) => {
    useFloatingText.getState().float(
      `${delta > 0 ? '+' : '−'}${Math.abs(delta)} ${type}`,
      delta > 0 ? 'buff' : 'debuff',
      instanceId,
    );
    set(s => ({
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
    }));
  },

  removePermanent: (opponentId, instanceId) => set(s => ({
    opponents: s.opponents.map(o => {
      if (o.id !== opponentId) return o;
      const hit = o.battlefield.find(p => p.instanceId === instanceId);
      if (hit) usePlaytestStore.getState().appendLog(`${o.name}'s ${hit.card.name} was destroyed`);
      return sendToGraveyard(o, [instanceId]);
    }),
  })),

  runAllTurns: async () => {
    if (get().running || get().opponents.length === 0) return;
    set({ running: true });

    // Animations off means no waiting — the whole turn lands at once.
    const animate = usePlaytestSettings.getState().animations;
    const pause = () => (animate ? new Promise(r => setTimeout(r, STEP_MS)) : Promise.resolve());

    try {
      for (const opponent of get().opponents) {
        // Re-read the board for every bot: the one before it may have blown up
        // half of it, and targeting a creature that's already dead reads broken.
        const { frames, final } = takeTurn(opponent, readPlayerBoard());

        for (const f of frames) {
          set(s => ({
            opponents: s.opponents.map(o => (o.id === f.opponent.id ? f.opponent : o)),
          }));
          f.logs.forEach(line => usePlaytestStore.getState().appendLog(line));
          // Narrate the play off the bot's lane, so you can follow the turn
          // without reading the log.
          if (f.blurb) useFloatingText.getState().float(f.blurb, 'neutral', `opp-lane-${f.opponent.id}`);
          f.effects.forEach(applyEffect);
          // Damage from the bot's own triggers, billed per beat.
          if (f.selfDamage) usePlaytestStore.getState().adjustLife(-f.selfDamage);

          if (f.attackers.length > 0) {
            // Combat stops the turn until the player has blocked. resolveCombat
            // settles this promise; clearAll settles it too, so leaving the table
            // mid-combat can't strand the loop forever.
            const attackers = f.attackers
              .map(id => f.opponent.battlefield.find(p => p.instanceId === id))
              .filter((p): p is NonNullable<typeof p> => !!p)
              .map(p => ({
                instanceId: p.instanceId,
                card: p.card,
                power: botPower(p, f.opponent.battlefield),
                toughness: botToughness(p, f.opponent.battlefield),
              }));
            set({
              combat: {
                opponentId: f.opponent.id,
                opponentName: f.opponent.name,
                attackers,
                blocks: {},
              },
            });
            await new Promise<void>(resolve => { combatResolver = resolve; });
          }

          await pause();
        }

        // Frames are snapshots; make sure the stored bot is the authoritative
        // final state even if it was removed and re-added mid-animation.
        set(s => ({ opponents: s.opponents.map(o => (o.id === final.id ? final : o)) }));
      }
    } finally {
      set({ running: false });
    }
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
      // A reshuffle must not leave a half-declared attack pointing at instance
      // ids that no longer mean anything.
      declaration: null,
      playerCombat: null,
      combatPhase: false,
      opponents: s.opponents.map(o => {
        // Gather every real card back. Tokens have no printing to return to,
        // and the commander goes to the command zone rather than into the deck.
        const all = [
          ...o.library,
          ...o.hand,
          ...o.graveyard,
          ...o.exile,
          ...o.battlefield.map(p => p.card),
        ].filter(c => !c.type_line.toLowerCase().includes('token'));

        const commander = o.commanderName
          ? all.find(c => c.name === o.commanderName)
          : undefined;
        const deck = commander ? all.filter(c => c !== commander) : all;

        const shuffled = fisherYates(deck);
        return {
          ...o,
          life: STARTING_LIFE,
          library: shuffled.slice(7),
          hand: shuffled.slice(0, 7),
          graveyard: [],
          exile: [],
          command: commander ? [commander] : o.command,
          commanderCasts: 0,
          battlefield: [],
          decked: false,
          turnsTaken: 0,
        };
      }),
    };
  }),
}));

/** One participant's snapshot: everything about the bots that undo should rewind. */
interface OpponentUndoSnapshot {
  opponents: Opponent[];
  combat: CombatState | null;
  combatPhase: boolean;
  declaration: Record<string, string[]> | null;
  playerCombat: OpponentState['playerCombat'];
}

registerUndoParticipant({
  capture: (): OpponentUndoSnapshot => {
    const s = useOpponentStore.getState();
    return {
      opponents: s.opponents.map(o => ({
        ...o,
        library: [...o.library],
        hand: [...o.hand],
        graveyard: [...o.graveyard],
        exile: [...o.exile],
        command: [...o.command],
        tokens: [...o.tokens],
        battlefield: o.battlefield.map(p => ({ ...p, counters: { ...p.counters } })),
      })),
      combat: s.combat
        ? { ...s.combat, attackers: [...s.combat.attackers], blocks: { ...s.combat.blocks } }
        : null,
      combatPhase: s.combatPhase,
      declaration: s.declaration
        ? Object.fromEntries(Object.entries(s.declaration).map(([k, v]) => [k, [...v]]))
        : null,
      playerCombat: s.playerCombat
        ? {
            perOpponent: Object.fromEntries(
              Object.entries(s.playerCombat.perOpponent).map(([k, side]) => [
                k,
                { attackers: [...side.attackers], blocks: { ...side.blocks } },
              ]),
            ),
          }
        : null,
    };
  },
  restore: (snapshot) => {
    const s = snapshot as OpponentUndoSnapshot;
    const hadCombat = useOpponentStore.getState().combat !== null;
    useOpponentStore.setState({
      opponents: s.opponents,
      combat: s.combat,
      combatPhase: s.combatPhase,
      declaration: s.declaration,
      playerCombat: s.playerCombat,
    });
    // An undo that closes an open combat has to settle the promise runAllTurns
    // is parked on, or the bot's turn never finishes and `running` sticks true,
    // which silently disables Next Turn for the rest of the game.
    if (hadCombat && s.combat === null) {
      combatResolver?.();
      combatResolver = null;
    }
  },
});
