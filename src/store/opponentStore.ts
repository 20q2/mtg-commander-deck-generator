import { create } from 'zustand';
import { usePlaytestStore } from '@/store/playtestStore';
import { usePlaytestSettings } from '@/store/playtestSettingsStore';
import { floatDelta, useFloatingText } from '@/store/floatingTextStore';
import { takeTurn } from '@/services/playtest/opponents/engine';
import { buildOpponentFromStub, findStub } from '@/services/playtest/opponents/deckSources';
import { fisherYates, makeInstanceId } from '@/components/playtest/utils';
import { getFrontFaceTypeLine } from '@/services/scryfall/client';
import { resolvePT, describeEdit } from '@/services/playtest/powerToughness';
import { canBlock, keywordsOf, resolveDamage, type Combatant } from '@/services/playtest/combat';
import { botKeywords, botPower, botToughness, isCreatureCard, isTokenCard } from '@/services/playtest/opponents/stats';
import { buryPermanents } from '@/services/playtest/opponents/deaths';
import { registerUndoParticipant } from '@/store/undoBridge';
import { chooseBlocks, type AttackCandidate } from '@/services/playtest/opponents/combatChoices';
import { readIncomingCombat } from '@/services/playtest/opponents/incomingCombat';
import type { AppliedEffect, PlayerBoardRead } from '@/services/playtest/opponents/evaluate';
import type { CombatState, Opponent, OpponentPermanent, OpponentZone, StackItem, TurnFrame } from '@/components/playtest/opponentTypes';
import type { BattlefieldCard, CardEdit } from '@/components/playtest/types';
import type { ScryfallCard } from '@/types';

const STARTING_LIFE = 40;
export const MAX_OPPONENTS = 3;

/** Pause between the beats of a bot's turn — untap, land, cast, attack. */
const STEP_MS = 260;

/**
 * A turn this long or shorter plays at the full step. Past it the step shrinks
 * so a busy turn does not drag.
 */
const COMFORTABLE_BEATS = 6;

/** Never go below this, or a long turn is a flicker rather than a sequence. */
const MIN_STEP_MS = 90;

/**
 * How long to hold each beat of a turn with `beats` of them.
 *
 * A bot that casts its commander, makes four tokens, triggers a Rabblemaster
 * and then discards has three times the beats it used to, and at a flat step
 * three seated bots became ten seconds of watching. The step shrinks as a turn
 * gets busier, so a quiet turn stays readable and a big one stays watchable.
 */
function stepFor(beats: number): number {
  if (beats <= COMFORTABLE_BEATS) return STEP_MS;
  return Math.max(MIN_STEP_MS, Math.round((STEP_MS * COMFORTABLE_BEATS) / beats));
}

/**
 * Settles the promise that combat is blocking on. Module-level because there's
 * one store and one combat at a time; parking it in state would mean storing a
 * function in Zustand, which nothing else here does.
 */
let combatResolver: (() => void) | null = null;

/**
 * Same idea for the stack. A beat that does something to you parks the turn
 * here until you resolve or counter what is waiting, which is the response
 * window — everything you might do in it (tapping lands, pitching a
 * counterspell to your graveyard) is an ordinary playtest move, so the window
 * itself needs no machinery beyond "the bot is not allowed to continue yet".
 */
let stackResolver: (() => void) | null = null;

/**
 * Identifies the turn loop that is allowed to write to the store.
 *
 * `runAllTurns` is a long async replay that pauses in the middle, waiting on
 * your blocks. Anything that throws the game away while it is parked has to be
 * able to stop it, or the loop wakes up and writes a dead game back over the
 * new one: resetting mid-combat reshuffled every bot and then had two of the
 * three seats clobbered by the run that was still in flight. Bumping this
 * invalidates the run, which checks it after every await.
 */
let turnRunId = 0;

/** Stop any in-flight turn loop from writing anything more. */
function cancelTurns() {
  turnRunId++;
  combatResolver?.();
  combatResolver = null;
  stackResolver?.();
  stackResolver = null;
}

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
    keywords: keywordsOf(b.card, b.edit),
  };
}

/**
 * The same, for a bot's permanent. `battlefield` is the whole board it is on,
 * because its stats depend on it: counters on the card, anthems from the rest.
 */
function botCombatant(
  p: OpponentPermanent,
  battlefield: OpponentPermanent[],
  graveyard: ScryfallCard[] = [],
): Combatant {
  return {
    instanceId: p.instanceId,
    name: p.card.name,
    power: botPower(p, battlefield, graveyard),
    toughness: botToughness(p, battlefield, graveyard),
    // Not `keywordsOf`: a bot's creature can be granted keywords by its own
    // board or graveyard, and blocking legality has to see them.
    keywords: botKeywords(p, battlefield, graveyard),
  };
}

/**
 * The projection every existing death path wants: just the opponent.
 *
 * The player-facing half is read separately with `deathToll`, off the SAME
 * `buryPermanents` — two callers deriving deaths independently is exactly how
 * the combat preview and the damage maths came to disagree once already.
 */
function sendToGraveyard(o: Opponent, instanceIds: string[]): Opponent {
  return buryPermanents(o, instanceIds).opponent;
}

/** What these deaths cost YOU, and what to say about them. */
function deathToll(o: Opponent, instanceIds: string[]): { lifeLoss: number; logs: string[] } {
  const { lifeLoss, logs } = buryPermanents(o, instanceIds);
  return { lifeLoss, logs };
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
  /**
   * True once your combat has resolved this turn — you're past it, in your
   * second main phase. Combat happens once a turn, so the button stops
   * offering a second one until `beginTurn` clears this.
   */
  combatDone: boolean;
  /**
   * What the bots have aimed at you and not yet resolved, newest last. The turn
   * loop is parked for as long as this is non-empty, so anything here is a
   * question waiting on an answer rather than a record of what happened.
   */
  stack: StackItem[];
}

interface OpponentActions {
  addFromStub: (stubId: string) => Promise<void>;
  /**
   * Drop the last add-opponent failure. It used to be set and never unset, so a
   * one-off Scryfall hiccup left a red box in the picker for the rest of the
   * session with no way to acknowledge it.
   */
  clearError: () => void;
  remove: (id: string) => void;
  clearAll: () => void;
  adjustLife: (id: string, delta: number) => void;
  setLife: (id: string, life: number) => void;
  togglePermanentTap: (opponentId: string, instanceId: string) => void;
  removePermanent: (opponentId: string, instanceId: string) => void;
  /**
   * Run every bot's turn in sequence. Resolves true when the whole cycle
   * played out, false when a reset or exit threw the game away mid-cycle —
   * the caller must not start the player's next turn on top of a new game.
   */
  runAllTurns: () => Promise<boolean>;
  /** Reshuffle every seated bot back to a fresh opening hand. No refetch. */
  resetAll: () => void;
  setResistance: (id: string, resistance: boolean) => void;
  setAggression: (id: string, aggression: number) => void;
  /**
   * Theft: pull a permanent off a bot's board and hand the whole thing back —
   * counters and tap state included, so what lands on your side is what was
   * standing on theirs.
   */
  takePermanent: (opponentId: string, instanceId: string) => OpponentPermanent | null;
  /** The other direction — donate effects, or stocking a board by hand. */
  givePermanent: (
    opponentId: string,
    card: ScryfallCard,
    arrival?: { tapped?: boolean; counters?: Record<string, number>; edit?: CardEdit },
  ) => void;
  /** Move one of their permanents off the board into one of their zones. */
  permanentToZone: (opponentId: string, instanceId: string, zone: OpponentZone) => void;
  adjustPermanentCounter: (opponentId: string, instanceId: string, type: string, delta: number) => void;
  /**
   * Rewrite one of a bot's creatures — Lignify and friends. `null` clears it.
   * The bot reads its own board through botPower/botToughness/keywordsOf, so an
   * edit here changes what it attacks with and how it chooses blocks, not just
   * what the numbers say on screen.
   */
  setPermanentEdit: (opponentId: string, instanceId: string, edit: CardEdit | null) => void;
  /** Assign one of your creatures to block an attacker. */
  assignBlocker: (attackerId: string, blockerInstanceId: string) => void;
  removeBlocker: (attackerId: string, blockerInstanceId: string) => void;
  /** Work out damage, kill what died, and let the bot's turn continue. */
  resolveCombat: () => void;
  /** Step into combat — opens every seat's strip as a drop target. */
  enterCombat: () => void;
  /** Back out. Anything declared is untapped and forgotten. */
  exitCombat: () => void;
  /**
   * A new turn has started: your combat is available again. Called from the
   * player's Next Turn, alongside `exitCombat`.
   */
  beginTurn: () => void;
  /** Drop one of your creatures into a seat's strip. Taps it unless vigilant. */
  declareAttacker: (opponentId: string, instanceId: string) => void;
  /** Pull a declared attacker back out. Untaps it. */
  undeclareAttacker: (instanceId: string) => void;
  /** Lock the attack in and let every bot choose its blocks. */
  confirmAttack: () => void;
  /**
   * Work out damage in your direction. Pass an opponent id to settle just that
   * fight — attacking three seats renders three Resolve buttons, and any one of
   * them used to resolve all three at once.
   */
  resolvePlayerCombat: (opponentId?: string) => void;
  /** Throw away an unconfirmed declaration, untapping everything in it. */
  discardDeclaration: () => void;
  /** Let the top item resolve — its effect lands on your board. */
  resolveStackTop: () => void;
  /** Counter the top item. The effect is thrown away; the card already left. */
  counterStackTop: () => void;
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
    // What could actually block a bot's attack this turn.
    untappedCreatures: s.battlefield
      .filter(b => !b.tapped && (b.edit?.typeLine ?? getFrontFaceTypeLine(b.card)).toLowerCase().includes('creature'))
      .map(playerCombatant),
    cards: s.battlefield.map(b => {
      const type = (b.edit?.typeLine ?? getFrontFaceTypeLine(b.card)).toLowerCase();
      const pt = resolvePT(b);
      const power = parseInt(pt?.modified.split('/')[0] ?? '', 10);
      const toughness = parseInt(pt?.modified.split('/')[1] ?? '', 10);
      return {
        instanceId: b.instanceId,
        name: b.card.name,
        isCreature: type.includes('creature'),
        isArtifact: type.includes('artifact'),
        isLand: type.includes('land'),
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

  const commanders = new Set(playtest.source?.commanderNames ?? []);
  for (const instanceId of effect.destroy) {
    const hit = playtest.battlefield.find(b => b.instanceId === instanceId);
    // Your commander dying or being exiled goes back to the command zone. It
    // is the choice every player makes every single time, so it is not worth
    // a prompt — and the graveyard path stranded Krenko with no way back.
    const toCommand = !!hit && commanders.has(hit.card.name);
    playtest.moveCard({
      source: { kind: 'battlefield', instanceId },
      target: { kind: 'zone', zone: toCommand ? 'command' : effect.destination },
    });
    if (toCommand && hit) playtest.appendLog(`${hit.card.name} returns to the command zone`, 'bot');
  }

  if (effect.discard > 0) {
    for (let i = 0; i < effect.discard; i++) {
      const hand = usePlaytestStore.getState().zones.hand;
      if (hand.length === 0) break;
      const index = Math.floor(Math.random() * hand.length);
      playtest.appendLog(`You discard ${hand[index].name}`, 'bot');
      playtest.moveCard({
        source: { kind: 'zone', zone: 'hand', index },
        target: { kind: 'zone', zone: 'graveyard' },
      });
    }
  }

  if (effect.lifeLoss > 0) playtest.adjustLife(-effect.lifeLoss);

  // Straight to zero, through adjustLife so the defeat line and the banner
  // fire the same way they would from any other lethal damage.
  if (effect.lethal) {
    const life = usePlaytestStore.getState().life;
    if (life > 0) playtest.adjustLife(-life);
  }
}

/**
 * Take one item off the stack and, once it is empty, let the parked turn carry
 * on. Shared by resolve and counter, because the only difference between them
 * is whether the effect was applied on the way out.
 */
function popStack(id: string) {
  const rest = useOpponentStore.getState().stack.filter(x => x.id !== id);
  useOpponentStore.setState({ stack: rest });
  if (rest.length === 0) {
    stackResolver?.();
    stackResolver = null;
  }
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
  combatDone: false,
  stack: [],
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
      const { opponent, missing } = await buildOpponentFromStub(
        stub,
        STARTING_LIFE,
        usePlaytestSettings.getState().opponentResistanceDefault,
      );
      set(s => ({
        opponents: s.opponents.length >= MAX_OPPONENTS ? s.opponents : [...s.opponents, opponent],
        loadingStubIds: s.loadingStubIds.filter(id => id !== stubId),
      }));
      const playtest = usePlaytestStore.getState();
      playtest.appendLog(`${stub.name} sat down across from you`, 'bot');
      // Said out loud rather than swallowed: a deck short a handful of cards
      // plays noticeably worse, and you could not tell that was why.
      if (missing.length > 0) {
        const listed = missing.slice(0, 4).join(', ');
        const rest = missing.length > 4 ? ` and ${missing.length - 4} more` : '';
        playtest.appendLog(
          `${stub.name} is missing ${missing.length} card${missing.length === 1 ? '' : 's'}: ${listed}${rest}`,
          'bot',
        );
        set({ error: `${stub.name} sat down without ${missing.length} of its cards — see the log.` });
        playtest.showToast(`${stub.name}: ${missing.length} cards unavailable`);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      set(s => ({
        loadingStubIds: s.loadingStubIds.filter(id => id !== stubId),
        error: `Could not load ${stub.name}: ${msg}`,
      }));
      // Also outside the picker: you can dismiss the modal and never learn the
      // seat failed to arrive.
      usePlaytestStore.getState().showToast(`Could not seat ${stub.name}`);
    }
  },

  clearError: () => set({ error: null }),

  remove: (id) => set(s => {
    const gone = s.opponents.find(o => o.id === id);
    if (gone) usePlaytestStore.getState().appendLog(`${gone.name} left the table`, 'bot');
    return { opponents: s.opponents.filter(o => o.id !== id) };
  }),

  clearAll: () => {
    // Never leave a turn awaiting blocks for a table that no longer exists.
    cancelTurns();
    set({
      opponents: [], error: null, combat: null, combatPhase: false,
      declaration: null, playerCombat: null, running: false, combatDone: false,
      stack: [],
    });
  },

  assignBlocker: (attackerId, blockerInstanceId) => set(s => {
    if (!s.combat) return {};
    // Legality lives here rather than in the drop handler, because there are
    // two ways to assign a blocker now — dragging a creature up onto the
    // attacker, and pulling a targeting arrow down out of its blocker slot —
    // and both have to agree on what a legal blocker is.
    const playtest = usePlaytestStore.getState();
    const card = playtest.battlefield.find(b => b.instanceId === blockerInstanceId);
    // Every refusal below says so. Failing silently made a legal-looking drop
    // that simply did nothing read as the app being broken.
    if (!card) return {};
    if (card.tapped) {
      playtest.showToast(`${card.card.name} is tapped and can't block`);
      return {};
    }
    if (!getFrontFaceTypeLine(card.card).toLowerCase().includes('creature')) {
      playtest.showToast(`${card.card.name} isn't a creature`);
      return {};
    }
    // Evasion is checked here rather than at resolve, so an illegal block is
    // refused while you can still see what you dropped. Without it a ground
    // creature blocked a flyer and the damage maths happily honoured it — while
    // the bots' own attack step assumed flying was unblockable, so the two
    // sides of the table disagreed about the rules.
    const attacker = s.combat.attackers.find(a => a.instanceId === attackerId);
    if (attacker && !canBlock(
      { instanceId: attacker.instanceId, name: attacker.card.name,
        power: attacker.power, toughness: attacker.toughness,
        keywords: keywordsOf(attacker.card, attacker.edit) },
      playerCombatant(card),
    )) {
      playtest.showToast(`${card.card.name} can't block a flyer`);
      return {};
    }
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

    // Read off the live board, not off the snapshot the attack was declared
    // from: an attacker you killed mid-combat is gone, and everyone's stats are
    // whatever they are now. The same helper feeds the button's number, so the
    // preview and the resolution cannot disagree.
    const opponent = get().opponents.find(o => o.id === combat.opponentId);
    const { attackers, blocks, blockerNames: names } =
      readIncomingCombat(combat, opponent, playtest.battlefield);

    // Every attacker died or left before you resolved. Nothing to work out, but
    // the turn is still parked on this promise.
    if (attackers.length === 0) {
      playtest.appendLog(`${combat.opponentName}'s attack came to nothing`, 'bot');
      set({ combat: null });
      combatResolver?.();
      combatResolver = null;
      return;
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
        'bot',
      );
    }
    for (const id of deadAttackers) {
      float('Dies', 'damage', id);
      const attacker = attackers.find(a => a.instanceId === id);
      playtest.appendLog(`${attacker?.name ?? 'An attacker'} died in combat`, 'bot');
    }

    for (const id of deadBlockers) {
      playtest.moveCard({
        source: { kind: 'battlefield', instanceId: id },
        target: { kind: 'zone', zone: 'graveyard' },
      });
    }
    if (deadAttackers.length > 0) {
      // Read the toll off the pre-death board, then apply — one resolution,
      // two projections, so the drain and the graveyard cannot disagree.
      const before = get().opponents.find(o => o.id === combat.opponentId);
      const toll = before ? deathToll(before, deadAttackers) : { lifeLoss: 0, logs: [] };
      set(s => ({
        opponents: s.opponents.map(o =>
          o.id === combat.opponentId ? sendToGraveyard(o, deadAttackers) : o,
        ),
      }));
      toll.logs.forEach(line => playtest.appendLog(line, 'bot'));
      if (toll.lifeLoss > 0) playtest.adjustLife(-toll.lifeLoss);
    }

    if (outcome.damageToDefender > 0) {
      playtest.appendLog(`You took ${outcome.damageToDefender} from ${combat.opponentName}`, 'bot');
      playtest.adjustLife(-outcome.damageToDefender);
    } else {
      playtest.appendLog(`${combat.opponentName}'s attack dealt no damage`, 'bot');
    }

    set({ combat: null });
    combatResolver?.();
    combatResolver = null;
  },

  resolveStackTop: () => {
    // Last on, first off. Nothing puts two things up at once today, but a
    // stack that resolved bottom-up would be a stack in name only.
    const item = get().stack[get().stack.length - 1];
    if (!item) return;
    const playtest = usePlaytestStore.getState();

    // Read the board as it is NOW, not as it was when the bot picked. If you
    // answered by killing, bouncing or blinking the target, the spell has
    // nothing left to hit and says so instead of quietly doing nothing.
    const live = new Set(playtest.battlefield.map(b => b.instanceId));
    const stillThere = item.effect.destroy.filter(id => live.has(id));
    const fizzled = item.effect.destroy.length > 0 && stillThere.length === 0;

    if (fizzled) {
      playtest.appendLog(`${item.name} fizzles — no legal target`, 'bot');
    } else {
      applyEffect({ ...item.effect, destroy: stillThere });
    }
    popStack(item.id);
  },

  counterStackTop: () => {
    // Last on, first off. Nothing puts two things up at once today, but a
    // stack that resolved bottom-up would be a stack in name only.
    const item = get().stack[get().stack.length - 1];
    if (!item) return;
    // Nothing to undo on the bot's side: an instant or sorcery was already put
    // into their graveyard when it was cast, which is where a countered spell
    // goes anyway. An ETB trigger's body is on their board and stays there,
    // same as being Stifled.
    usePlaytestStore.getState().appendLog(`You counter ${item.name}`, 'bot');
    popStack(item.id);
  },

  enterCombat: () => {
    if (get().opponents.length === 0) return;
    set({ combatPhase: true });
  },

  exitCombat: () => {
    get().discardDeclaration();
    set({ combatPhase: false });
  },

  beginTurn: () => set({ combatDone: false }),

  declareAttacker: (opponentId, instanceId) => {
    const playtest = usePlaytestStore.getState();
    const card = playtest.battlefield.find(b => b.instanceId === instanceId);
    if (!card) return;
    if (card.tapped) {
      playtest.showToast(`${card.card.name} is tapped and can't attack`);
      return;
    }
    if (!getFrontFaceTypeLine(card.card).toLowerCase().includes('creature')) {
      playtest.showToast(`${card.card.name} isn't a creature`);
      return;
    }

    // Summoning sickness, as a nudge rather than a wall. The bots' side
    // enforces it; on yours haste can come from a lord the store cannot see,
    // so the attack is allowed — but a creature that arrived this turn is
    // called out, because Krenko swinging the turn it was cast teaches you
    // the wrong clock and nothing said so.
    const printedHaste = (card.card.keywords ?? []).some(k => k.toLowerCase() === 'haste');
    if (card.arrivedTurn === playtest.turn && !printedHaste) {
      playtest.showToast(`${card.card.name} arrived this turn — it needs haste to attack`);
    }

    const current = get().declaration;
    // Already swinging at someone? Don't let it attack twice.
    if (current && Object.values(current).some(ids => ids.includes(instanceId))) return;

    // First attacker of the attack: one checkpoint covers the whole arc.
    if (!current) playtest.pushCheckpoint();

    // Vigilance attacks without tapping. Everything else taps.
    if (!keywordsOf(card.card, card.edit).has('vigilance')) {
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
    if (card && !keywordsOf(card.card, card.edit).has('vigilance')) {
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
      return card ? !keywordsOf(card.card, card.edit).has('vigilance') : false;
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
        .map(p => botCombatant(p, opponent.battlefield, opponent.graveyard));

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
        'bot',
      );
    }

    set({ declaration: null, playerCombat: { perOpponent } });
  },

  resolvePlayerCombat: (only) => {
    const playerCombat = get().playerCombat;
    if (!playerCombat) return;
    const playtest = usePlaytestStore.getState();
    const float = useFloatingText.getState().float;

    // One seat, or all of them when called without an id.
    const entries = Object.entries(playerCombat.perOpponent)
      .filter(([id]) => only === undefined || id === only);
    if (entries.length === 0) return;

    const myDead: string[] = [];
    const theirDead: Record<string, string[]> = {};

    for (const [opponentId, side] of entries) {
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
          .map(p => botCombatant(p, opponent.battlefield, opponent.graveyard));
      }

      // Same pure module the bot→player direction uses. It does not know or
      // care which side is defending.
      const outcome = resolveDamage(attackers, blocks);

      for (const id of outcome.deadAttackers) {
        float('Dies', 'damage', id);
        const c = attackers.find(a => a.instanceId === id);
        playtest.appendLog(`${c?.name ?? 'A creature'} died attacking ${opponent.name}`, 'bot');
        myDead.push(id);
      }
      for (const id of outcome.deadBlockers) {
        float('Dies', 'damage', id);
        const p = opponent.battlefield.find(b => b.instanceId === id);
        playtest.appendLog(`${opponent.name}'s ${p?.card.name ?? 'creature'} died blocking`, 'bot');
      }
      theirDead[opponentId] = outcome.deadBlockers;

      if (outcome.damageToDefender > 0) {
        playtest.appendLog(`${opponent.name} took ${outcome.damageToDefender}`, 'bot');
        get().adjustLife(opponentId, -outcome.damageToDefender);
      } else {
        playtest.appendLog(`Your attack on ${opponent.name} dealt no damage`, 'bot');
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
    //
    // Their death triggers are read BEFORE the deaths are applied, off the same
    // resolution the graveyard move uses — a zombie deck chump-blocking your
    // alpha strike bills you for every body it threw in front of you.
    const tolls = get().opponents.map(o => deathToll(o, theirDead[o.id] ?? []));
    const settled = new Set(entries.map(([id]) => id));
    set(s => {
      const remaining = Object.fromEntries(
        Object.entries(s.playerCombat?.perOpponent ?? {}).filter(([id]) => !settled.has(id)),
      );
      const done = Object.keys(remaining).length === 0;
      return {
        opponents: s.opponents.map(o => sendToGraveyard(o, theirDead[o.id] ?? [])),
        playerCombat: done ? null : { perOpponent: remaining },
        // combatPhase stays true from confirm through here so the strips keep
        // showing the blocks — and stays true while another fight is unsettled.
        combatPhase: done ? false : s.combatPhase,
        // Every fight settled means combat is behind you: second main phase.
        combatDone: done || s.combatDone,
      };
    });

    const drained = tolls.reduce((n, t) => n + t.lifeLoss, 0);
    tolls.flatMap(t => t.logs).forEach(line => playtest.appendLog(line, 'bot'));
    if (drained > 0) playtest.adjustLife(-drained);
  },

  adjustLife: (id, delta) => {
    floatDelta(delta, `opp-life-${id}`);
    const before = get().opponents.find(o => o.id === id);
    set(s => ({
      opponents: s.opponents.map(o => (o.id === id ? { ...o, life: o.life + delta } : o)),
    }));
    // Announced on the crossing only, so nudging a dead bot's life stays quiet.
    if (before && before.life > 0 && before.life + delta <= 0) {
      usePlaytestStore.getState().appendLog(`${before.name} is defeated`, 'bot');
    }
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
      usePlaytestStore.getState().appendLog(`${o.name}'s ${hit.card.name} → ${label}`, 'bot');

      // Killing it is a death like any other, so it goes through the one helper
      // that knows a commander belongs in the command zone and a token belongs
      // nowhere. Sending it here by hand put a bot's commander in its graveyard
      // permanently — it could never be recast — and left token cards lying in
      // the graveyard as if they were real.
      if (zone === 'graveyard') return sendToGraveyard(o, [instanceId]);

      // A token that leaves the battlefield any other way also ceases to exist.
      if (isTokenCard(hit.card)) {
        return { ...o, battlefield: o.battlefield.filter(p => p.instanceId !== instanceId) };
      }

      return {
        ...o,
        battlefield: o.battlefield.filter(p => p.instanceId !== instanceId),
        exile:     zone === 'exile'   ? [...o.exile, hit.card]   : o.exile,
        hand:      zone === 'hand'    ? [...o.hand, hit.card]    : o.hand,
        library:   zone === 'library' ? [hit.card, ...o.library] : o.library,
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

  setPermanentEdit: (opponentId, instanceId, edit) => {
    const opp = get().opponents.find(o => o.id === opponentId);
    const hit = opp?.battlefield.find(p => p.instanceId === instanceId);
    if (!opp || !hit) return;
    usePlaytestStore.getState().pushCheckpoint();
    usePlaytestStore.getState().appendLog(`${opp.name}'s ${describeEdit(hit.card.name, edit)}`, 'bot');
    set(s => ({
      opponents: s.opponents.map(o =>
        o.id === opponentId
          ? {
              ...o,
              battlefield: o.battlefield.map(p =>
                p.instanceId === instanceId
                  // Dropped rather than set to undefined, so a cleared edit
                  // leaves no trace in the snapshots the undo stack keeps.
                  ? (edit ? { ...p, edit } : (({ edit: _drop, ...rest }) => rest)(p))
                  : p,
              ),
            }
          : o,
      ),
    }));
  },

  removePermanent: (opponentId, instanceId) => set(s => ({
    opponents: s.opponents.map(o => {
      if (o.id !== opponentId) return o;
      const hit = o.battlefield.find(p => p.instanceId === instanceId);
      if (hit) usePlaytestStore.getState().appendLog(`${o.name}'s ${hit.card.name} was destroyed`, 'bot');
      return sendToGraveyard(o, [instanceId]);
    }),
  })),

  runAllTurns: async () => {
    if (get().running || get().opponents.length === 0) return false;
    const myRun = ++turnRunId;
    /** False once a reset or a teardown has claimed the store from under us. */
    const mine = () => myRun === turnRunId;
    set({ running: true });

    // Animations off means no waiting — the whole turn lands at once.
    const animate = usePlaytestSettings.getState().animations;
    const pause = (ms: number) =>
      animate ? new Promise(r => setTimeout(r, ms)) : Promise.resolve();

    /**
     * One bot swinging at another. Nothing here needs the player, so it does
     * not open a combat and does not pause the turn: the attacker's creatures
     * are already chosen and the defender picks its own blocks.
     */
    const resolveBotAttack = (
      attacker: Opponent,
      defenderId: string,
      attackerIds: string[],
    ) => {
      const playtest = usePlaytestStore.getState();
      const defender = get().opponents.find(o => o.id === defenderId);
      if (!defender) return;

      const attackers = attackerIds
        .map(id => attacker.battlefield.find(p => p.instanceId === id))
        .filter((p): p is OpponentPermanent => !!p)
        .map(p => botCombatant(p, attacker.battlefield, attacker.graveyard));
      if (attackers.length === 0) return;

      const pool = defender.battlefield
        .filter(p => !p.tapped && isCreatureCard(p.card))
        .map(p => botCombatant(p, defender.battlefield, defender.graveyard));

      const assignment = chooseBlocks({
        attackers,
        blockers: pool,
        life: defender.life,
        aggression: defender.aggression,
      });

      const blocks: Record<string, Combatant[]> = {};
      for (const a of attackers) {
        blocks[a.instanceId] = (assignment[a.instanceId] ?? [])
          .map(id => pool.find(b => b.instanceId === id))
          .filter((b): b is Combatant => !!b);
      }

      const blocked = Object.values(blocks).flat();
      if (blocked.length > 0) {
        playtest.appendLog(
          `${defender.name} blocks with ${blocked.length} creature${blocked.length === 1 ? '' : 's'}`,
          'bot',
        );
      }

      const outcome = resolveDamage(attackers, blocks);
      for (const id of outcome.deadAttackers) {
        const c = attackers.find(a => a.instanceId === id);
        playtest.appendLog(`${attacker.name}'s ${c?.name ?? 'creature'} died attacking ${defender.name}`, 'bot');
      }
      for (const id of outcome.deadBlockers) {
        const c = pool.find(b => b.instanceId === id);
        playtest.appendLog(`${defender.name}'s ${c?.name ?? 'creature'} died blocking`, 'bot');
      }

      set(s => ({
        opponents: s.opponents.map(o => {
          if (o.id === attacker.id) return sendToGraveyard(o, outcome.deadAttackers);
          if (o.id === defenderId)  return sendToGraveyard(o, outcome.deadBlockers);
          return o;
        }),
      }));

      if (outcome.damageToDefender > 0) {
        playtest.appendLog(
          `${defender.name} took ${outcome.damageToDefender} from ${attacker.name}`,
          'bot',
        );
        get().adjustLife(defenderId, -outcome.damageToDefender);
      } else {
        // Say so. A fight that logged its blocks and then went quiet read as
        // an unfinished sentence — you could not tell whether it was still
        // being worked out or had simply bounced off.
        playtest.appendLog(`${attacker.name}'s attack on ${defender.name} dealt no damage`, 'bot');
      }
    };

    /**
     * Park the turn on one beat's effects.
     *
     * Holding priority is the default: the item waits until you resolve or
     * counter it, and everything you do in the meantime — untapping a land,
     * dropping a counterspell into your graveyard — is a normal move on your
     * own board, which is why nothing here has to model a response.
     */
    const putOnStack = async (f: TurnFrame, step: number) => {
      const items: StackItem[] = f.effects.map(effect => ({
        id: makeInstanceId(),
        opponentId: f.opponent.id,
        opponentName: f.opponent.name,
        effect,
        card: f.source?.card,
        name: f.source?.name ?? f.blurb ?? f.opponent.name,
        kind: f.source?.kind ?? 'spell',
        label: f.source?.label ?? 'Resolves',
      }));
      set(s => ({ stack: [...s.stack, ...items] }));

      if (!usePlaytestSettings.getState().stackHold) {
        // Auto-pass: hold it long enough to read, then let it through.
        await pause(Math.max(STEP_MS, step));
        if (!mine()) return;
        for (const item of items) applyEffect(item.effect);
        set(s => ({ stack: s.stack.filter(x => !items.some(i => i.id === x.id)) }));
        return;
      }

      // resolveStackTop / counterStackTop settle this once the last item is
      // gone; cancelTurns settles it too, so leaving the table mid-response
      // cannot strand the loop.
      await new Promise<void>(resolve => { stackResolver = resolve; });
    };

    try {
      // By id, re-read at the top of every turn. The array captured when the
      // loop started is a photograph: seat A's attack this cycle kills seat
      // B's blockers in the live store, and a turn planned from the photograph
      // replayed them back onto the board — the chump that died blocking was
      // standing there again by B's cleanup, with B's graveyard and the card
      // its Midnight Reaper drew both gone.
      for (const seatId of get().opponents.map(o => o.id)) {
        if (!mine()) return false;
        const opponent = get().opponents.find(o => o.id === seatId);
        // Left the table mid-cycle, or out of the game. A dead seat stays on
        // the table so you can see what beat them, but it takes no turn.
        if (!opponent || opponent.life <= 0) continue;
        // Re-read the board for every bot: the one before it may have blown up
        // half of it, and targeting a creature that's already dead reads broken.
        // The rivals are read fresh for the same reason.
        const rivals: AttackCandidate[] = get().opponents
          .filter(o => o.id !== opponent.id && o.life > 0)
          .map(o => ({
            id: o.id,
            name: o.name,
            life: o.life,
            untappedCreatures: o.battlefield
              .filter(p => !p.tapped && isCreatureCard(p.card))
              .map(p => botCombatant(p, o.battlefield, o.graveyard)),
            // Everything it has, tapped or not: what it swings with next turn.
            threat: o.battlefield
              .filter(p => isCreatureCard(p.card))
              .reduce((n, p) => n + botPower(p, o.battlefield, o.graveyard), 0),
          }));
        const { frames, final } = takeTurn(opponent, readPlayerBoard(), rivals);
        const step = stepFor(frames.length);

        /**
         * Creatures of this bot's that died partway through its own turn.
         *
         * The engine plans the whole turn before the first frame is shown, so
         * its later frames — and its `final` — still have anything you killed
         * in combat standing. Replaying them straight put a creature that died
         * blocking right back onto the board. Diffing the live seat against the
         * frame catches every cause: blocks, and the seat's own kill button.
         */
        const casualties = new Set<string>();
        const noteCasualties = (snapshot: Opponent) => {
          const live = get().opponents.find(o => o.id === snapshot.id);
          if (!live) return;
          for (const p of snapshot.battlefield) {
            if (!live.battlefield.some(q => q.instanceId === p.instanceId)) {
              casualties.add(p.instanceId);
            }
          }
        };
        /** A planned snapshot, brought back in line with what actually happened. */
        const correct = (o: Opponent): Opponent => {
          const live = get().opponents.find(x => x.id === o.id);
          // Nothing in the engine writes a bot's life, so the live value always wins.
          const base = live && live.life !== o.life ? { ...o, life: live.life } : o;
          const dead = [...casualties].filter(id =>
            base.battlefield.some(p => p.instanceId === id),
          );
          return dead.length > 0 ? sendToGraveyard(base, dead) : base;
        };

        for (const f of frames) {
          if (!mine()) return false;
          set(s => ({
            opponents: s.opponents.map(o => (o.id === f.opponent.id ? correct(f.opponent) : o)),
          }));
          f.logs.forEach(line => usePlaytestStore.getState().appendLog(line, 'bot'));
          // Narrate the play off the bot's lane, so you can follow the turn
          // without reading the log.
          if (f.blurb) useFloatingText.getState().float(f.blurb, 'neutral', `opp-lane-${f.opponent.id}`);
          // Anything aimed at you goes on the stack rather than straight onto
          // your board. With priority held the turn parks here until you answer
          // it; without, the item still shows for a beat, so the panel is a
          // record of what hit you either way.
          if (f.effects.length > 0) {
            await putOnStack(f, step);
            if (!mine()) return false;
          }
          // Damage from the bot's own triggers, billed per beat.
          if (f.selfDamage) usePlaytestStore.getState().adjustLife(-f.selfDamage);

          // An attack on another seat needs nothing from the player: both sides
          // are bot decisions, so it is worked out here and the turn carries on.
          if (f.attackers.length > 0 && f.attackTarget?.kind === 'opponent') {
            resolveBotAttack(correct(f.opponent), f.attackTarget.id, f.attackers);
            noteCasualties(f.opponent);
            await pause(step);
            if (!mine()) return false;
            continue;
          }

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
                edit: p.edit,
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
            // A reset while we were parked means this game no longer exists.
            if (!mine()) return false;
            // Whatever you killed blocking stays dead for the rest of the turn.
            noteCasualties(f.opponent);
          }

          await pause(step);
          if (!mine()) return false;
        }

        // Frames are snapshots; make sure the stored bot is the authoritative
        // final state even if it was removed and re-added mid-animation — minus
        // anything that died while the turn was being played out.
        set(s => ({ opponents: s.opponents.map(o => (o.id === final.id ? correct(final) : o)) }));
      }
      return mine();
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
    usePlaytestStore.getState().appendLog(`You took ${permanent.card.name} from ${opponent.name}`, 'bot');
    return permanent;
  },

  givePermanent: (opponentId, card, arrival) => {
    const opponent = get().opponents.find(o => o.id === opponentId);
    if (!opponent) return;
    set(s => ({
      opponents: s.opponents.map(o =>
        o.id === opponentId
          ? {
              ...o,
              battlefield: [
                ...o.battlefield,
                {
                  instanceId: makeInstanceId(), card,
                  tapped: arrival?.tapped ?? false,
                  summoningSick: true,
                  counters: { ...(arrival?.counters ?? {}) },
                  ...(arrival?.edit ? { edit: arrival.edit } : {}),
                },
              ],
            }
          : o,
      ),
    }));
    usePlaytestStore.getState().appendLog(`${card.name} went to ${opponent.name}`, 'bot');
  },

  resetAll: () => set(s => {
    if (s.opponents.length === 0) return {};
    // A bot's attack that was waiting on blocks belongs to the game being
    // thrown away. Left behind, its strip stayed live over a turn-one board and
    // resolving it dealt damage in the new game — so the parked promise is
    // settled, the combat dropped and the turn loop cancelled.
    cancelTurns();
    return {
      // A reshuffle must not leave a half-declared attack pointing at instance
      // ids that no longer mean anything.
      declaration: null,
      playerCombat: null,
      combatPhase: false,
      combatDone: false,
      combat: null,
      running: false,
      stack: [],
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
  combatDone: boolean;
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
      combatDone: s.combatDone,
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
      combatDone: s.combatDone,
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
