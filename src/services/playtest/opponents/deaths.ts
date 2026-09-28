import { getFrontFaceTypeLine } from '@/services/scryfall/client';
import {
  BOT_DEATH_TRIGGERS,
  BOT_DEATH_WATCHERS,
  BOT_EXPERIENCE_SOURCES,
  reanimateMatches,
  regrowMatches,
  type BotSelfSpec,
} from '@/services/playtest/opponents/effects';
import {
  isCreatureCard,
  isTokenCard,
  makeTokenBatch,
  toPermanent,
} from '@/services/playtest/opponents/stats';
import type { Opponent, OpponentPermanent } from '@/components/playtest/opponentTypes';

/**
 * What happens when a bot's creatures die.
 *
 * Kept out of both the store and the engine because deaths happen in both, and
 * they have to agree: a Midnight Reaper draws whether its friend died blocking
 * your alpha strike or died attacking another bot. The store owns combat
 * deaths, the engine owns sacrifices, and neither should own this.
 *
 * Deliberately narrow. It resolves only the effects that can be applied to the
 * bot's own zones plus a life total — draw, mill, reanimate, regrow, tokens and
 * a drain. Anything needing a target on the player's board is left to the normal
 * cast path, because a death trigger fires outside the frame loop and has
 * nowhere to put an AppliedEffect.
 */
export interface DeathResult {
  opponent: Opponent;
  /** Life the PLAYER loses from these deaths. */
  lifeLoss: number;
  /**
   * Life the BOT pays or gains from its own death triggers — a Midnight
   * Reaper's damage, an Undead Augur's draw.
   *
   * Separate from `lifeLoss` because they point at different people, and
   * because there was no channel at all: `payLife` on a death trigger was
   * registered and then swallowed by `applySpec`'s default, so three cards
   * drew for free for a whole release.
   */
  selfLifeLoss: number;
  selfLifeGain: number;
  logs: string[];
}

/**
 * Kinds a death trigger cannot resolve on its own.
 *
 * Spelled out rather than left to a silent `default`, so adding a kind to
 * `BotSelfSpec` fails to compile here until someone decides which side of the
 * line it belongs on. Two shipped bugs came from the silent version — experience
 * counters and `payLife` were both registered on death triggers and quietly
 * thrown away, and nothing said so until a full game was read by hand.
 */
type UnresolvableOnDeath =
  | 'populate' | 'tutor' | 'recurExperience' | 'fetchLand' | 'amass'
  | 'reclaimLands' | 'pump' | 'selfDiscard';

/** The subset of specs a death trigger can resolve on its own. */
function applySpec(
  o: Opponent,
  spec: BotSelfSpec,
  /** The permanent whose death is being resolved, for "return IT" triggers. */
  corpse?: OpponentPermanent,
): { opponent: Opponent; label: string | null; lifeLoss?: number; lifeGain?: number } {
  switch (spec.kind) {
    case 'draw': {
      const n = Math.min(spec.count, o.library.length);
      if (n === 0) return { opponent: o, label: null };
      return {
        opponent: { ...o, hand: [...o.hand, ...o.library.slice(0, n)], library: o.library.slice(n) },
        label: `draws ${n}`,
      };
    }
    case 'selfMill': {
      const n = Math.min(spec.count, o.library.length);
      if (n === 0) return { opponent: o, label: null };
      return {
        opponent: {
          ...o,
          graveyard: [...o.graveyard, ...o.library.slice(0, n)],
          library: o.library.slice(n),
        },
        label: `mills ${n}`,
      };
    }
    case 'reanimate': {
      // Biggest body first — the graveyard is a resource and a death trigger
      // is the moment to spend it well.
      const pool = o.graveyard
        .map((card, i) => ({ card, i }))
        // Same restriction the engine's reanimate applies — without this a
        // `want` added to a death trigger is silently ignored on this path.
        .filter(x => isCreatureCard(x.card) && reanimateMatches(x.card, spec.want))
        .sort((a, b) => (b.card.cmc ?? 0) - (a.card.cmc ?? 0))
        .slice(0, spec.count);
      if (pool.length === 0) return { opponent: o, label: null };
      const taken = new Set(pool.map(x => x.i));
      return {
        opponent: {
          ...o,
          graveyard: o.graveyard.filter((_, i) => !taken.has(i)),
          battlefield: [...o.battlefield, ...pool.map(x => toPermanent(x.card))],
        },
        label: `returns ${pool.map(x => x.card.name).join(', ')}`,
      };
    }
    case 'regrow': {
      const idx = o.graveyard.findIndex(c => regrowMatches(c, spec.want));
      if (idx < 0) return { opponent: o, label: null };
      const card = o.graveyard[idx];
      return {
        opponent: {
          ...o,
          graveyard: o.graveyard.filter((_, i) => i !== idx),
          hand: [...o.hand, card],
        },
        label: `returns ${card.name} to hand`,
      };
    }
    case 'returnSelf': {
      if (!corpse) return { opponent: o, label: null };
      // By identity, not by name: a second copy of the card already sitting in
      // the graveyard is not the one that just died.
      const idx = o.graveyard.lastIndexOf(corpse.card);
      const at = idx >= 0 ? idx : o.graveyard.findIndex(c => c.name === corpse.card.name);
      if (at < 0) return { opponent: o, label: null };
      return {
        opponent: {
          ...o,
          graveyard: o.graveyard.filter((_, i) => i !== at),
          hand: [...o.hand, o.graveyard[at]],
        },
        label: `returns ${o.graveyard[at].name} to hand`,
      };
    }
    case 'makeTokens': {
      const batch = makeTokenBatch(o, spec.tokens);
      if (batch.permanents.length === 0) return { opponent: o, label: null };
      return {
        opponent: { ...o, battlefield: [...o.battlefield, ...batch.permanents] },
        label: `creates ${batch.parts.join(', ')}`,
      };
    }
    case 'payLife':
      return { opponent: o, label: `pays ${spec.amount} life`, lifeLoss: spec.amount };

    case 'gainLifeSelf':
      return { opponent: o, label: `gains ${spec.amount} life`, lifeGain: spec.amount };

    // Everything else needs the engine's frame loop — a tutor needs a choice,
    // and anything aimed at the player needs an AppliedEffect to put it in.
    default: {
      const unresolvable: UnresolvableOnDeath = spec.kind;
      void unresolvable;
      return { opponent: o, label: null };
    }
  }
}

function matchesWatcher(
  dead: OpponentPermanent,
  watcher: { subtype?: string; nontokenOnly?: boolean },
): boolean {
  if (watcher.nontokenOnly && isTokenCard(dead.card)) return false;
  if (!isCreatureCard(dead.card)) return false;
  if (watcher.subtype) {
    const line = getFrontFaceTypeLine(dead.card).toLowerCase();
    if (!line.includes(watcher.subtype.toLowerCase())) return false;
  }
  return true;
}

/**
 * Resolve every death trigger these deaths set off.
 *
 * `opponent` must already have the dead creatures removed — a watcher counts
 * the board as it stands after the deaths, and a creature never watches its
 * own death (that is what BOT_DEATH_TRIGGERS is for).
 */
export function applyDeathTriggers(
  opponent: Opponent,
  dead: OpponentPermanent[],
): DeathResult {
  if (dead.length === 0) return { opponent, lifeLoss: 0, selfLifeLoss: 0, selfLifeGain: 0, logs: [] };

  let next = opponent;
  let lifeLoss = 0;
  let selfLifeLoss = 0;
  let selfLifeGain = 0;
  const logs: string[] = [];

  const run = (source: string, spec: BotSelfSpec | BotSelfSpec[], corpse?: OpponentPermanent) => {
    for (const one of Array.isArray(spec) ? spec : [spec]) {
      const { opponent: after, label, lifeLoss: paid, lifeGain: gained } = applySpec(next, one, corpse);
      next = after;
      selfLifeLoss += paid ?? 0;
      selfLifeGain += gained ?? 0;
      if (label) logs.push(`${next.name}'s ${source} — ${next.name} ${label}`);
    }
  };

  // "Whenever another creature you control dies, you get an experience
  // counter." Read off the board AFTER the deaths, which is also what makes a
  // Meren that died with the rest not count its own funeral.
  const experienceSources = next.battlefield.filter(p => BOT_EXPERIENCE_SOURCES.has(p.card.name));
  if (experienceSources.length > 0) {
    const gained = dead.filter(p => isCreatureCard(p.card)).length * experienceSources.length;
    if (gained > 0) {
      next = { ...next, experience: (next.experience ?? 0) + gained };
      logs.push(
        `${next.name}'s ${experienceSources[0].card.name} gets ${gained === 1 ? 'an experience counter' : `${gained} experience counters`}`,
      );
    }
  }

  for (const corpse of dead) {
    // "When this dies…" — read off the card that died.
    const own = BOT_DEATH_TRIGGERS[corpse.card.name];
    if (own) run(`${corpse.card.name} dies`, own, corpse);

    // "Whenever a creature you control dies…" — read off what is watching.
    // The dead are included for watchers that see their own death: Judith reads
    // "a nontoken creature you control", she is one, and a leaves-the-battlefield
    // trigger uses last-known information.
    const watching = [
      ...next.battlefield,
      ...dead.filter(p => BOT_DEATH_WATCHERS[p.card.name]?.includeSelf),
    ];
    for (const p of watching) {
      const watcher = BOT_DEATH_WATCHERS[p.card.name];
      if (!watcher || !matchesWatcher(corpse, watcher)) continue;
      if (watcher.spec) run(`${p.card.name} sees ${corpse.card.name} die`, watcher.spec);
      // The player-facing half. A drain is life loss by definition. A "deals
      // N damage to any target" trigger has no read of your board here, so it
      // goes to your face — which is where Judith points it once your blockers
      // are gone anyway. Until this branch existed the bracket-4 deck's whole
      // reach plan was registered and silently ignored.
      if (watcher.effect?.kind === 'drain') {
        lifeLoss += watcher.effect.amount;
        logs.push(`${next.name}'s ${p.card.name} drains you for ${watcher.effect.amount}`);
      } else if (watcher.effect?.kind === 'damage') {
        lifeLoss += watcher.effect.amount;
        logs.push(`${next.name}'s ${p.card.name} deals ${watcher.effect.amount} to you`);
      }
    }
  }

  return { opponent: next, lifeLoss, selfLifeLoss, selfLifeGain, logs };
}

/**
 * Take permanents off a bot's battlefield, put them where they belong, and
 * fire the death triggers those deaths set off. A commander goes back to the
 * command zone so it can be recast, a token ceases to exist, everything else
 * goes to the graveyard.
 *
 * The one implementation for every death path. The store's combat and kill
 * button already used this logic; the engine's own wraths and sacrifices wrote
 * the zone moves out by hand and skipped the triggers, so a Sakura-Tribe Elder
 * cracked with a Midnight Reaper out drew nothing.
 */
export function buryPermanents(o: Opponent, instanceIds: string[]): DeathResult {
  if (instanceIds.length === 0) return { opponent: o, lifeLoss: 0, selfLifeLoss: 0, selfLifeGain: 0, logs: [] };
  const ids = new Set(instanceIds);
  const leaving = o.battlefield.filter(p => ids.has(p.instanceId));
  const next: Opponent = {
    ...o,
    battlefield: o.battlefield.filter(p => !ids.has(p.instanceId)),
    graveyard: [
      ...o.graveyard,
      ...leaving
        .filter(p => !isTokenCard(p.card) && p.card.name !== o.commanderName)
        .map(p => p.card),
    ],
    command: [...o.command, ...leaving.filter(p => p.card.name === o.commanderName).map(p => p.card)],
  };
  // Triggers read the board AFTER the deaths: a watcher never counts itself
  // dying, and a reanimation can legally bring back what just fell.
  return applyDeathTriggers(next, leaving);
}
