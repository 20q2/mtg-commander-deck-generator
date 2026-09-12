import type { ScryfallCard } from '@/types';
import { getFrontFaceTypeLine } from '@/services/scryfall/client';
import { isLand } from '@/components/playtest/utils';
import {
  BOT_DEATH_TRIGGERS,
  BOT_DEATH_WATCHERS,
  type BotSelfSpec,
} from '@/services/playtest/opponents/effects';
import { isCreatureCard, isTokenCard } from '@/services/playtest/opponents/stats';
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
 * bot's own zones plus a life total — draw, mill, reanimate, regrow, and a
 * drain. Anything needing a target on the player's board is left to the normal
 * cast path, because a death trigger fires outside the frame loop and has
 * nowhere to put an AppliedEffect.
 */
export interface DeathResult {
  opponent: Opponent;
  /** Life the PLAYER loses from these deaths. */
  lifeLoss: number;
  logs: string[];
}

/** The subset of specs a death trigger can resolve on its own. */
function applySpec(o: Opponent, spec: BotSelfSpec): { opponent: Opponent; label: string | null } {
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
        .filter(x => isCreatureCard(x.card))
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
      const idx = o.graveyard.findIndex(c => !isLand(c));
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
    // Everything else needs the engine's frame loop — tokens need the deck's
    // token pool, tutors need a choice. A death trigger is not the place.
    default:
      return { opponent: o, label: null };
  }
}

function toPermanent(card: ScryfallCard): OpponentPermanent {
  return {
    instanceId: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    card,
    tapped: false,
    summoningSick: true,
    counters: {},
  };
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
  if (dead.length === 0) return { opponent, lifeLoss: 0, logs: [] };

  let next = opponent;
  let lifeLoss = 0;
  const logs: string[] = [];

  const run = (source: string, spec: BotSelfSpec | BotSelfSpec[]) => {
    for (const one of Array.isArray(spec) ? spec : [spec]) {
      const { opponent: after, label } = applySpec(next, one);
      next = after;
      if (label) logs.push(`${next.name}'s ${source} — ${next.name} ${label}`);
    }
  };

  for (const corpse of dead) {
    // "When this dies…" — read off the card that died.
    const own = BOT_DEATH_TRIGGERS[corpse.card.name];
    if (own) run(`${corpse.card.name} dies`, own);

    // "Whenever a creature you control dies…" — read off what is watching.
    for (const p of next.battlefield) {
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

  return { opponent: next, lifeLoss, logs };
}
