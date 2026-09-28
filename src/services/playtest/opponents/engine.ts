import type { ScryfallCard } from '@/types';
import { getFrontFaceTypeLine } from '@/services/scryfall/client';
import { isLand } from '@/components/playtest/utils';
import { chooseResistancePlay, describeEffect, hasLiveTarget, pickTarget, resolveEverywhere, type AppliedEffect, type PlayerBoardRead } from '@/services/playtest/opponents/evaluate';
import {
  BOT_CYCLING,
  BOT_LANDFALL_EFFECTS,
  BOT_LANDFALL_SELF,
  BOT_RECURRING_EFFECTS,
  BOT_RECURSION,
  BOT_SPELL_TRIGGERS,
  BOT_TRIGGERS,
  costOf,
  lookupActivated,
  lookupEffect,
  lookupSelfEffect,
  reanimateMatches,
  regrowMatches,
  specsOf,
} from '@/services/playtest/opponents/effects';
import type { BotActivatedEntry, BotEffectSpec, BotSelfSpec, GraveyardCost } from '@/services/playtest/opponents/effects';
import { MAX_BOARD, arrivesDead, botKeywords, botPower as livePower, botToughness as liveToughness, echoCostOf, effectiveCost, findToken, hasHaste, isCreatureCard, isTokenCard, makeTokenBatch, toPermanent, tokenMultiplier, typeLineOf } from '@/services/playtest/opponents/stats';
import { applyTaps, devotionTo, genericCost, graveyardManaCost, manaFrom, planPayment, requirementFor, requirementForCost } from '@/services/playtest/opponents/mana';
import { chooseAttackTarget, chooseAttackers, type AttackCandidate } from '@/services/playtest/opponents/combatChoices';
import { BOT_COMBOS, comboPiecesWanted, liveCombos } from '@/services/playtest/opponents/botCombos';
import { pickSacrificeFodder } from '@/services/playtest/opponents/choices';
import { buryPermanents } from '@/services/playtest/opponents/deaths';
import type { AttackTarget, CastZone, Opponent, OpponentPermanent, StackSource, TurnFrame, TurnResult } from '@/components/playtest/opponentTypes';

/**
 * The bot turn loop. Pure: it takes an opponent plus a read of the player's board
 * and returns the next opponent, what happened, and any effects for the caller to
 * apply. Nothing here touches a store, which is what keeps the decision logic
 * testable and the coupling one-directional.
 *
 * Mana lives in `mana.ts`: what a source can make, what a spell demands, and
 * which permanents get tapped to bridge the two. Colours are checked for
 * anything cast from hand or the command zone; registry costs (cycling,
 * recursion, activated abilities) are plain numbers and are paid as generic.
 */

/** A do-nothing effect, for combo outcomes to fill in one field of. */
const EMPTY_EFFECT: AppliedEffect = {
  destroy: [], destination: 'graveyard', lifeLoss: 0, discard: 0,
};

/** Backstop on the develop loop so a mana-flooded board can't spin forever. */
const MAX_CASTS_PER_TURN = 5;

/**
 * The life total below which a bot starts taking the defensive mode of a card
 * that offers one — see `only: 'lowLife'`.
 *
 * Eight is a quarter of a starting total and about one good attack: high
 * enough that a bot under real pressure reaches for the shield, low enough
 * that a healthy one never wastes its turn gaining two.
 */
const LOW_LIFE = 8;

/** How many interaction spells a resisting bot casts in one turn. */
const MAX_INTERACTION_PER_TURN = 2;

/**
 * Distinct names a log line will spell out before it starts counting.
 *
 * Identical tokens collapse to "29 Goblins" on their own, but a developed
 * precon attacks with a dozen DIFFERENT creatures, and naming every one made
 * a 276-character line nobody could read.
 */
const MAX_NAMED = 4;

function isPermanent(card: ScryfallCard): boolean {
  const t = getFrontFaceTypeLine(card).toLowerCase();
  return (
    t.includes('creature') ||
    t.includes('artifact') ||
    t.includes('enchantment') ||
    t.includes('planeswalker')
  );
}

/** Which graveyard card an ability's cost eats, as a predicate. */
function graveyardCostMatcher(cost: GraveyardCost): (card: ScryfallCard) => boolean {
  switch (cost) {
    case 'land':     return isLand;
    case 'creature': return isCreatureCard;
    case 'instantOrSorcery': return card => {
      const t = getFrontFaceTypeLine(card).toLowerCase();
      return t.includes('instant') || t.includes('sorcery');
    };
  }
}

/** A Zombie Army token — the single permanent every `amass` piles onto. */
function isArmyToken(card: ScryfallCard): boolean {
  const t = getFrontFaceTypeLine(card).toLowerCase();
  return t.includes('token') && t.includes('army');
}

/** What a beat's arrivals owe, once every trigger on the board has seen them. */
interface EtbToll {
  /** Life the player loses. */
  damage: number;
  /** Life the bot gains. */
  lifeGain: number;
  /** Cards the bot draws. */
  draws: number;
}

/**
 * Bill the arrival triggers for the creatures that turned up this beat. Every
 * trigger fires for every creature, tokens included, which is the entire
 * reason a goblin deck with an Impact Tremors out is scary.
 *
 * Takes the arrivals rather than a count because the triggers do not all ask
 * the same question: Wayward Servant wants Zombies, Soul of the Harvest wants
 * nontoken bodies, and "another creature" means the source sits out its own
 * arrival but not anyone else's. That last one used to be done by dropping
 * every trigger source from the count entirely, so an Impact Tremors watched a
 * Purphoros enter and charged you nothing for it.
 */
function etbToll(battlefield: OpponentPermanent[], arrivals: ScryfallCard[]): EtbToll {
  const toll: EtbToll = { damage: 0, lifeGain: 0, draws: 0 };
  if (arrivals.length === 0) return toll;
  for (const p of battlefield) {
    const spec = BOT_TRIGGERS[p.card.name];
    if (!spec) continue;
    for (const card of arrivals) {
      // "Whenever ANOTHER creature you control enters" — never its own arrival.
      if (card.name === p.card.name) continue;
      if (spec.kind === 'creatureEtbDraw') {
        if (spec.nontokenOnly && isTokenCard(card)) continue;
        toll.draws += spec.count;
        continue;
      }
      if (spec.subtype && !getFrontFaceTypeLine(card).toLowerCase().includes(spec.subtype)) continue;
      toll.damage += spec.amount;
      toll.lifeGain += spec.lifeGain ?? 0;
    }
  }
  return toll;
}

/**
 * Name a group of attackers without listing every one of them.
 *
 * A goblin swarm attacks with fifty-two creatures, and spelling that out gave
 * the game log a 571-character line reading "Goblin, Goblin, Goblin" forty-odd
 * times. Repeats collapse to a count, so the line says what you need: how many
 * goblins, and which real cards came with them.
 */
function describeNames(names: string[], max = MAX_NAMED): string {
  const counts = new Map<string, number>();
  for (const n of names) counts.set(n, (counts.get(n) ?? 0) + 1);
  const parts = [...counts.entries()]
    .map(([name, n]) => (n > 1 ? `${n} ${name}s` : name));
  if (parts.length <= max) return parts.join(', ');
  // Identical creatures are already collapsed above; this is the other case —
  // a dozen DIFFERENT bodies. Naming all twelve produced a 276-character log
  // line nobody reads, so name a few and count the rest.
  return `${parts.slice(0, max).join(', ')} and ${parts.length - max} more`;
}

function describeAttackers(cards: ScryfallCard[]): string {
  return describeNames(cards.map(c => c.name));
}

export function takeTurn(
  input: Opponent,
  playerBoard: PlayerBoardRead,
  /** The other seats, so a bot can swing at one of them instead of the player. */
  rivals: AttackCandidate[] = [],
  /**
   * The other seats' boards, so a removal spell can be pointed at whichever
   * one is actually scary. Without them every Murder in the pod aimed at the
   * human, because the human's board was the only one the engine could see.
   */
  rivalBoards: PlayerBoardRead[] = [],
): TurnResult {
  const frames: TurnFrame[] = [];
  const opp: Opponent = {
    ...input,
    library: [...input.library],
    hand: [...input.hand],
    graveyard: [...input.graveyard],
    command: [...input.command],
    battlefield: input.battlefield.map(p => ({ ...p })),
  };

  /**
   * The player's board as this turn sees it. A copy, because the bot's own
   * plays change it: once a Murder has been pointed at your biggest creature,
   * the second Murder this turn has to look at the board without it. The
   * snapshot passed in never changes, so both used to pick the same target
   * and the second one fizzled on resolution — two cards for one kill.
   *
   * Planned as if everything resolves. You might counter the first one, in
   * which case the second was aimed at the wrong body; a real player makes
   * the same bet.
   */
  const board: PlayerBoardRead = {
    ...playerBoard,
    cards: [...playerBoard.cards],
    untappedCreatures: [...playerBoard.untappedCreatures],
  };

  /** The rivals' boards, copied for the same reason the player's is. */
  const rivalReads: PlayerBoardRead[] = rivalBoards.map(b => ({ ...b, cards: [...b.cards], untappedCreatures: [...b.untappedCreatures] }));
  /** Every board a player-facing effect may land on, the player's first. */
  const boards = () => [board, ...rivalReads];

  /** Take what an effect does out of the bot's view, so later picks skip it. */
  const spend = (effect: AppliedEffect) => {
    const on = effect.target ? rivalReads.find(b => b.seatId === effect.target!.seatId) : board;
    if (!on) return;
    if (effect.destroy.length > 0) {
      const gone = new Set(effect.destroy);
      on.cards = on.cards.filter(c => !gone.has(c.instanceId));
      on.untappedCreatures = on.untappedCreatures.filter(c => !gone.has(c.instanceId));
    }
    on.handSize = Math.max(0, on.handSize - effect.discard);
    on.life = Math.max(0, on.life - effect.lifeLoss);
  };

  /** Capture the board as it stands, as one beat of the turn. */
  const frame = (
    logs: string[],
    effects: AppliedEffect[] = [],
    attackers: string[] = [],
    blurb?: string,
    attackTarget?: AttackTarget,
    /** The card behind `effects`. Only beats that touch the player have one. */
    source?: StackSource,
    /** The card leaving a zone this beat, if any — see TurnFrame.moved. */
    moved?: { card: ScryfallCard; from: CastZone; onStack: boolean },
  ) => {
    // Queued arrival effects join this beat before anything is spent, so the
    // bot's running read of your board accounts for what its own reanimated
    // body just did to it.
    if (pendingArrivalEffects.length > 0) {
      effects = [...effects, ...pendingArrivalEffects];
      pendingArrivalEffects = [];
    }
    effects.forEach(spend);
    // Triggers are billed against the board as it stands at the end of the
    // beat, so a Purphoros cast alongside its goblins counts them.
    const toll = etbToll(opp.battlefield, pendingArrivals);
    // Split: the toll's own gain is narrated here, a spec's gain narrates itself.
    const tollLifeGain = toll.lifeGain;
    toll.lifeGain += pendingLifeGain;
    pendingLifeGain = 0;
    const paidLife = pendingLifeLoss;
    pendingLifeLoss = 0;
    // Arrival effects belong to whatever beat put the body down.
    const arrived = arrivalLogs;
    arrivalLogs = [];
    const selfDamage = toll.damage + pendingDrain;
    // Drawn here rather than counted for later, so the cards are in hand before
    // the snapshot below is taken.
    let tollDraws = 0;
    for (let i = 0; i < toll.draws; i++) {
      if (opp.library.length === 0) break;
      opp.hand.push(opp.library.shift() as ScryfallCard);
      pendingDraws++;
      tollDraws++;
    }
    // Read before the reset: the frame below is built after it.
    const drew = pendingDraws;
    // Mana paid for this beat was spent before it: the lines go in front.
    const paidWith = pendingManaLogs;
    pendingArrivals = [];
    pendingDrain = 0;
    pendingDraws = 0;
    pendingManaLogs = [];
    frames.push({
      opponent: {
        ...opp,
        library: [...opp.library],
        hand: [...opp.hand],
        graveyard: [...opp.graveyard],
        exile: [...opp.exile],
        command: [...opp.command],
        battlefield: opp.battlefield.map(p => ({ ...p, counters: { ...p.counters } })),
      },
      logs: [
        ...paidWith,
        ...logs,
        ...arrived,
        ...(tollDraws > 0 ? [`${opp.name} draws ${tollDraws} off arrivals`] : []),
        ...(toll.damage > 0 ? [`${opp.name} deals ${toll.damage} to you`] : []),
        // Only the arrival-trigger half. A `gainLifeSelf` or `payLife` spec has
        // already said so in its own label, and printing both read as double.
        ...(tollLifeGain > 0 ? [`${opp.name} gains ${tollLifeGain} life`] : []),
      ],
      effects,
      attackers,
      blurb,
      attackTarget,
      selfDamage,
      selfLifeGain: toll.lifeGain,
      selfLifeLoss: paidLife,
      source,
      moved,
      drew,
    });
  };

  /**
   * Creatures that arrived since the last frame. Read and reset by `frame`, so
   * every beat bills its own triggers exactly once. The cards themselves rather
   * than a count, because the triggers ask about their types — see `etbToll`.
   */
  let pendingArrivals: ScryfallCard[] = [];

  /**
   * Bill the ETB triggers for a card arriving on the bot's board.
   *
   * Creatures only: a Gate to the Afterlife tutoring God-Pharaoh's Gift onto
   * the battlefield was charging you for Corpse Knight over an artifact.
   * Whether a given trigger wants a given arrival — "another creature", a
   * Zombie, a nontoken body — is `etbToll`'s question, not this one's.
   */
  const arrive = (card: ScryfallCard) => {
    if (isCreatureCard(card)) pendingArrivals.push(card);
  };

  /**
   * Life the player loses to the bot's own death triggers this beat — a
   * Judith or a Plague Belcher paid off by a wrath or a sacrifice. Billed
   * the same way ETB trigger damage is, straight onto the frame.
   */
  let pendingDrain = 0;

  /**
   * Life the bot gains from its own effects since the last frame — a Pelakka
   * Wurm arriving. Held rather than written to `opp.life` because the store
   * owns a seat's life total and throws away whatever the engine says about it.
   */
  let pendingLifeGain = 0;

  /**
   * Life the bot pays itself since the last frame — a tutor's cost, an Undead
   * Augur's draw. Same channel as the gain, applied by the store for the same
   * reason: the engine's copy of a seat's life total is thrown away.
   */
  let pendingLifeLoss = 0;

  /**
   * The attacker whose trigger is resolving, and the swing it is part of.
   *
   * Only `selfPerAttacking` needs it — a Goblin Rabblemaster counting the other
   * goblins beside it — and threading it through every applySpec signature for
   * one spec would be worse than a closure the attack beat sets and clears.
   */
  let attackContext: { self: OpponentPermanent; attackers: OpponentPermanent[] } | null = null;

  /**
   * Cards drawn off the top of the library since the last frame. Read and
   * reset by `frame`, the same way the two counters above are — see
   * TurnFrame.drew for why this is counted rather than diffed.
   */
  let pendingDraws = 0;

  /**
   * Graveyard cards spent paying for mana since the last frame.
   *
   * Paying happens before the beat it pays for is built — a spell is paid for
   * and only then cast — so these lines are held and read by `frame`, the same
   * way the counters above are. Without them a land quietly vanished from the
   * bot's graveyard with nothing in the log to say why.
   */
  let pendingManaLogs: string[] = [];

  /**
   * Kill some of the bot's own permanents — a wrath, a sacrifice — through
   * the same path the store uses for combat deaths, so their death triggers
   * fire. Returns the trigger log lines for the frame.
   */
  const bury = (ids: string[]): string[] => {
    const { opponent, lifeLoss, selfLifeLoss, selfLifeGain, logs } = buryPermanents(opp, ids);
    pendingLifeLoss += selfLifeLoss;
    pendingLifeGain += selfLifeGain;
    // Whole-object writeback on purpose. Naming the five zones by hand meant
    // every other field a death trigger writes was silently thrown away —
    // experience counters earned by a sacrifice never survived the turn, so
    // Meren always took the "otherwise, put it into your hand" branch — and the
    // next field added to Opponent would have gone the same way.
    Object.assign(opp, opponent);
    pendingDrain += lifeLoss;
    return logs;
  };

  /**
   * The creature just paid as an additional cost, for as long as the spell that
   * ate it is resolving.
   *
   * Victimize chooses its targets on announcement and only then sacrifices, so
   * the corpse can never be one of them. The engine pays costs first, which put
   * the fodder in the graveyard in time for the reanimate picker to find it —
   * and since that picker takes the biggest body, "sacrifice a creature" became
   * "sacrifice nothing and get it straight back".
   */
  let sacrificedForSpell: ScryfallCard | null = null;

  /**
   * Apply a card's effect on the bot's own board — tokens and draw. Returns a
   * short label for the frame, or null when nothing happened. Called for cast
   * effects and again for the combat-timed ones.
   */
  /**
   * Is the bot short of mana for where the game is?
   *
   * One land a turn is the baseline every deck is built around, so falling
   * behind that is the moment a ramp creature is worth more cashed in than left
   * as a blocker. Deliberately generous by one: sacrificing a body to catch up
   * from a single missed land drop is a bad trade.
   */
  const behindOnLands = () =>
    opp.battlefield.filter(p => isLand(p.card)).length < input.turnsTaken;

  /** Put `card` onto the board as a fresh permanent, respecting the cap. */
  /**
   * The self-facing half of landfall, for `count` lands arriving at once.
   *
   * Pulled out of the land-drop block, which was the only place it ever ran —
   * while the comment above it claimed it covered "every land it ramps into".
   * A deck with Harrow, Farseek, Wood Elves and a Sakura-Tribe Elder puts one
   * or two extra lands onto the battlefield a turn, and Rampaging Baloths saw
   * none of them. Returns the log lines; the caller decides which beat they
   * belong to.
   *
   * Re-entrancy guarded: a landfall trigger that fetched a land would feed
   * itself otherwise.
   */
  let inLandfall = false;
  const landfallSelf = (count: number): string[] => {
    if (inLandfall || count <= 0) return [];
    inLandfall = true;
    const lines: string[] = [];
    try {
      for (let i = 0; i < count; i++) {
        for (const p of opp.battlefield) {
          const spec = BOT_LANDFALL_SELF[p.card.name];
          if (!spec) continue;
          const label = applySpecs(Array.isArray(spec) ? spec : [spec]);
          if (label) lines.push(`${opp.name}'s ${p.card.name} triggers on the land — ${opp.name} ${label}`);
        }
      }
    } finally {
      inLandfall = false;
    }
    return lines;
  };

  const addBody = (card: ScryfallCard, opts?: { tapped?: boolean }): boolean => {
    if (opp.battlefield.length >= MAX_BOARD) return false;
    const permanent = toPermanent(card);
    opp.battlefield.push(opts?.tapped ? { ...permanent, tapped: true } : permanent);
    arrive(card);
    // "When this enters" fires wherever the body came from. Only the self-facing
    // half: an ETB aimed at YOU needs an AppliedEffect, and a reanimation
    // happens inside another spec's resolution with no frame to put one on.
    // Guarded against a reanimator reanimating itself into a loop.
    const entry = lookupSelfEffect(card.name);
    if (entry && entry.timing === undefined && !inArrivalEffect) {
      inArrivalEffect = true;
      try {
        const label = applySpecs(specsOf(entry));
        if (label) arrivalLogs.push(`${opp.name}'s ${card.name} arrives — ${opp.name} ${label}`);
      } finally {
        inArrivalEffect = false;
      }
    }
    // The half of an arrival aimed at YOU. A Gray Merchant reanimated by
    // Victimize drains exactly as one cast from hand does, and a Bone Shredder
    // brought back by Meren kills something.
    //
    // Drains and damage ride `pendingDrain`, the channel death triggers already
    // use, so they need no frame of their own. A targeted destroy needs an
    // AppliedEffect the store can resolve against your board, so it is queued
    // for the beat that is already being built — which is what makes the old
    // "no frame to put one on" comment here wrong rather than merely cautious.
    const facing = lookupEffect(card.name);
    if (facing?.etb && !inArrivalEffect) {
      const spec = facing.spec;
      if (spec.kind === 'drain' || spec.kind === 'damage') {
        // No `incoming`: `addBody` has already put this card on the battlefield,
        // so devotion counts its own pips from there. Passing it as well counted
        // Gray Merchant twice.
        const scale = effectScale(spec);
        const amount = spec.amount * scale;
        if (amount > 0) {
          pendingDrain += amount;
          if (spec.kind === 'drain' && !spec.noGain) pendingLifeGain += amount;
          arrivalLogs.push(`${opp.name}'s ${card.name} arrives — ${opp.name} drains you for ${amount}`);
        }
      } else {
        const hit = pickTarget(spec, boards(), effectScale(spec));
        if (hit) {
          pendingArrivalEffects.push(hit.effect);
          arrivalLogs.push(`${opp.name}'s ${card.name} arrives — ${opp.name} hits ${hit.target}`);
        }
      }
    }
    return true;
  };

  /** Guards `addBody` against an arrival effect that puts another body down. */
  let inArrivalEffect = false;
  /** Lines from arrival effects, folded into whichever beat caused them. */
  let arrivalLogs: string[] = [];
  /**
   * Player-facing arrival effects waiting for a beat to ride on.
   *
   * A reanimation happens inside another spec's resolution, so there is no
   * frame at that moment — but there is always one at the end of the beat, and
   * `frame` drains this the way it drains `arrivalLogs`.
   */
  let pendingArrivalEffects: AppliedEffect[] = [];

  const applySpec = (spec: BotSelfSpec): string | null => {
    switch (spec.kind) {
      case 'reclaimLands': {
        // Lands come back worst-first is wrong — a land is a land, so take
        // them in the order they were milled. Straight onto the battlefield is
        // mana this turn; to hand is a land drop banked for a later one.
        const names: string[] = [];
        let landed = 0;
        for (let i = 0; i < spec.count; i++) {
          const idx = opp.graveyard.findIndex(isLand);
          if (idx < 0) break;
          const card = opp.graveyard.splice(idx, 1)[0];
          if (spec.to === 'hand') {
            opp.hand.push(card);
          } else {
            if (opp.battlefield.length >= MAX_BOARD) break;
            opp.battlefield.push({ ...toPermanent(card), tapped: spec.tapped ?? false });
            landed++;
          }
          names.push(card.name);
        }
        if (names.length === 0) return null;
        if (spec.to === 'hand') return `returns ${describeNames(names)} to hand`;
        // A land arriving from the graveyard is still a land entering. The
        // round-3 landfall fix reached `fetchLand` and stopped there, so Teval
        // and Floral Evoker put thirteen lands onto the battlefield in one game
        // and Hedron Crab saw none of them.
        return [`returns ${describeNames(names)} from the graveyard`, ...landfallSelf(landed)].join(', ');
      }

      case 'pump': {
        if (spec.selfPerAttacking) {
          // Rabblemaster counts the crowd it is swinging with, not the board.
          if (!attackContext) return null;
          const others = attackContext.attackers.filter(a =>
            a.instanceId !== attackContext!.self.instanceId
            && typeLineOf(a).toLowerCase().includes(spec.selfPerAttacking!.toLowerCase()),
          ).length;
          if (others === 0) return null;
          const gain = spec.power * others;
          opp.battlefield = opp.battlefield.map(p =>
            p.instanceId === attackContext!.self.instanceId
              ? { ...p, tempBoost: { power: gain, toughness: spec.toughness * others, keywords: spec.keywords } }
              : p,
          );
          return `gets +${gain}/+${spec.toughness * others}`;
        }
        /*
         * Written as a fresh `tempBoost` object on every permanent it touches,
         * never mutated in place: `frame` shallow-copies each permanent into
         * its snapshot, so a boost edited in place would retroactively change
         * the numbers in frames the player has already watched.
         *
         * Stacks rather than replaces, so two Goreclaws are two attack
         * triggers and the board ends up +2/+2 — and so Goreclaw and Temmet on
         * the same swing both get paid.
         */
        let pumped = 0;
        opp.battlefield = opp.battlefield.map(p => {
          if (!isCreatureCard(p.card)) return p;
          if (spec.subtype && !typeLineOf(p).toLowerCase().includes(spec.subtype.toLowerCase())) return p;
          // Live power, counters and anthems included — see the spec's comment.
          if (spec.minPower !== undefined && livePower(p, opp.battlefield, opp.graveyard) < spec.minPower) return p;
          pumped++;
          const prior = p.tempBoost;
          return {
            ...p,
            tempBoost: {
              power: (prior?.power ?? 0) + spec.power,
              toughness: (prior?.toughness ?? 0) + spec.toughness,
              keywords: [...new Set([...(prior?.keywords ?? []), ...(spec.keywords ?? [])])],
              haste: prior?.haste || spec.haste,
            },
          };
        });
        if (pumped === 0) return null;
        // A pump can be all keywords and no stats — Legion Loyalist hands out
        // first strike and trample and changes nobody's size. Announcing that
        // as "+0/+0 and firstStrike" reads as a bug in the log.
        const granted = [...(spec.keywords ?? []), ...(spec.haste ? ['haste'] : [])];
        const body = spec.power === 0 && spec.toughness === 0
          ? granted.join(', ')
          : `+${spec.power}/+${spec.toughness}${spec.keywords?.length ? ` and ${spec.keywords.join(', ')}` : ''}`;
        return `gives ${pumped} creature${pumped === 1 ? '' : 's'} ${body}`;
      }

      case 'draw': {
        let drawn = 0;
        for (let i = 0; i < spec.count; i++) {
          if (opp.library.length === 0) break;
          opp.hand.push(opp.library.shift() as ScryfallCard);
          pendingDraws++;
          drawn++;
        }
        return drawn > 0 ? `draws ${drawn}` : null;
      }

      case 'selfMill': {
        let milled = 0;
        for (let i = 0; i < spec.count; i++) {
          if (opp.library.length === 0) break;
          opp.graveyard.push(opp.library.shift() as ScryfallCard);
          milled++;
        }
        return milled > 0 ? `mills ${milled}` : null;
      }

      case 'reanimate': {
        // Best body first — the graveyard is a resource and the bot spends it
        // on the biggest thing in there.
        const names: string[] = [];
        for (let i = 0; i < spec.count; i++) {
          let bestIdx = -1;
          for (let j = 0; j < opp.graveyard.length; j++) {
            if (!isCreatureCard(opp.graveyard[j])) continue;
            if (opp.graveyard[j] === sacrificedForSpell) continue;
            if (!reanimateMatches(opp.graveyard[j], spec.want)) continue;
            if (bestIdx < 0 || costOf(opp.graveyard[j]) > costOf(opp.graveyard[bestIdx])) bestIdx = j;
          }
          if (bestIdx < 0) break;
          const card = opp.graveyard[bestIdx];
          if (opp.battlefield.length >= MAX_BOARD) break;
          // Out of the graveyard FIRST: `addBody` runs the card's own arrival
          // trigger, and a Rot Hulk still sitting in the yard reanimated itself.
          opp.graveyard.splice(bestIdx, 1);
          addBody(card, { tapped: spec.tapped });
          names.push(card.name);
        }
        return names.length > 0 ? `returns ${describeNames(names)}` : null;
      }

      case 'recurExperience': {
        /*
         * "If that card's mana value is less than or equal to the number of
         * experience counters you have, return it to the battlefield.
         * Otherwise, put it into your hand."
         *
         * Best creature first either way, so an early Meren banks the bomb in
         * hand and a late one stands it straight back up.
         */
        const experience = opp.experience ?? 0;
        const names: string[] = [];
        for (let i = 0; i < spec.count; i++) {
          let bestIdx = -1;
          for (let j = 0; j < opp.graveyard.length; j++) {
            if (!isCreatureCard(opp.graveyard[j])) continue;
            if (bestIdx < 0 || costOf(opp.graveyard[j]) > costOf(opp.graveyard[bestIdx])) bestIdx = j;
          }
          if (bestIdx < 0) break;
          const card = opp.graveyard[bestIdx];
          if (costOf(card) <= experience) {
            if (opp.battlefield.length >= MAX_BOARD) break;
            // Same ordering rule as `reanimate` — see the note there.
            opp.graveyard.splice(bestIdx, 1);
            addBody(card);
            names.push(`${card.name} to the battlefield`);
          } else {
            opp.graveyard.splice(bestIdx, 1);
            opp.hand.push(card);
            names.push(`${card.name} to hand`);
          }
        }
        return names.length > 0 ? `returns ${names.join(', ')}` : null;
      }

      // Only ever reached from a death trigger, which resolves in deaths.ts
      // against the opponent it is rebuilding — there is no corpse here.
      case 'returnSelf':
        return null;

      case 'gainLifeSelf':
        pendingLifeGain += spec.amount;
        return `gains ${spec.amount} life`;

      case 'payLife':
        pendingLifeLoss += spec.amount;
        return `pays ${spec.amount} life`;

      case 'selfDiscard': {
        // A restricted discard can only pitch what the cost names.
        const eligible = opp.hand
          .map((card, index) => ({ card, index }))
          .filter(x => !spec.want || regrowMatches(x.card, spec.want));
        const n = Math.min(spec.count, eligible.length);
        if (n === 0) return null;
        // Worst first: a land it cannot use beats a spell it can.
        const order = eligible
          .sort((a, b) => (isLand(a.card) ? 0 : costOf(a.card) + 1) - (isLand(b.card) ? 0 : costOf(b.card) + 1));
        const going = new Set(order.slice(0, n).map(x => x.index));
        const names = order.slice(0, n).map(x => x.card.name);
        opp.graveyard.push(...opp.hand.filter((_, i) => going.has(i)));
        opp.hand = opp.hand.filter((_, i) => !going.has(i));
        return `discards ${describeNames(names)}`;
      }

      case 'populate': {
        // Copy the best token already on the board. `count` above the number of
        // tokens present means "one copy of each", which is Rhys's big ability.
        const tokens = opp.battlefield.filter(p => isTokenCard(p.card));
        if (tokens.length === 0) return null;
        let made = 0;
        if (spec.count >= tokens.length) {
          for (const t of tokens) {
            for (let i = 0; i < tokenMultiplier(opp.battlefield); i++) {
              if (!addBody(t.card)) break;
              made++;
            }
          }
        } else {
          const best = [...tokens].sort(
            (a, b) => livePower(b, opp.battlefield) - livePower(a, opp.battlefield),
          )[0];
          const n = spec.count * tokenMultiplier(opp.battlefield);
          for (let i = 0; i < n; i++) {
            if (!addBody(best.card)) break;
            made++;
          }
        }
        return made > 0 ? `populates ${made}` : null;
      }

      case 'regrow': {
        // Same taste as the tutor: something it knows how to use, then the
        // biggest thing. A regrow that returns a Mountain is a wasted card.
        const names: string[] = [];
        for (let i = 0; i < spec.count; i++) {
          const legal = opp.graveyard
            .map((card, index) => ({ card, index }))
            .filter(({ card }) => regrowMatches(card, spec.want));
          if (legal.length === 0) break;
          const score = (card: ScryfallCard) =>
            (lookupEffect(card.name) || lookupSelfEffect(card.name) ? 100 : 0) + costOf(card);
          const best = legal.reduce((a, b) => (score(b.card) > score(a.card) ? b : a));
          opp.graveyard.splice(best.index, 1);
          opp.hand.push(best.card);
          names.push(best.card.name);
        }
        return names.length > 0 ? `takes back ${describeNames(names)}` : null;
      }

      case 'amass': {
        if (spec.count <= 0) return null;
        // One Army, grown over and over — that is the whole point of the
        // mechanic, and it is why a deck full of amass reads as a single
        // enormous threat rather than as a wide board.
        let army = opp.battlefield.find(p => isArmyToken(p.card));
        if (!army) {
          const token = findToken(opp.tokens, 'Army');
          if (!token) return null;
          if (!addBody(token)) return null;
          army = opp.battlefield[opp.battlefield.length - 1];
        }
        const id = army.instanceId;
        opp.battlefield = opp.battlefield.map(p => (
          p.instanceId === id
            ? { ...p, counters: { ...p.counters, '+1/+1': (p.counters['+1/+1'] ?? 0) + spec.count } }
            : p
        ));
        const total = opp.battlefield.find(p => p.instanceId === id)?.counters['+1/+1'] ?? 0;
        return `amasses ${spec.count} (Army is ${total}/${total})`;
      }

      case 'fetchLand': {
        let made = 0;
        for (let i = 0; i < spec.count; i++) {
          const index = opp.library.findIndex(isLand);
          if (index < 0) break;
          const [land] = opp.library.splice(index, 1);
          // Landcycling finds the land but does not play it: it is the turn's
          // land drop, banked. Everything else goes straight onto the table.
          if (spec.to === 'hand') {
            opp.hand.push(land);
          } else {
            opp.battlefield.push({
              ...toPermanent(land),
              // A land is never summoning-sick, but it can arrive tapped.
              summoningSick: false,
              tapped: spec.tapped ?? false,
            });
          }
          made++;
        }
        if (made === 0) return null;
        const what = `${made} land${made > 1 ? 's' : ''}`;
        if (spec.to === 'hand') return `puts ${what} into hand`;
        // A fetched land is a land entering, so landfall sees it. Folded into
        // this spec's own label rather than given its own beat, so the trigger
        // cannot be logged before the spell that caused it.
        const triggered = landfallSelf(made);
        return [`fetches ${what}`, ...triggered].join(', ');
      }

      case 'tutor': {
        const found: string[] = [];
        for (let i = 0; i < spec.count; i++) {
          // Recomputed each pick: fetching one piece changes what is missing.
          const chasing = comboPiecesWanted(
            opp.battlefield.map(p => p.card.name),
            opp.hand.map(c => c.name),
          );

          const legal = opp.library
            .map((card, index) => ({ card, index }))
            .filter(({ card }) => {
              const t = getFrontFaceTypeLine(card).toLowerCase();
              if (spec.want?.name && card.name !== spec.want.name) return false;
              if (spec.want?.type && !t.includes(spec.want.type.toLowerCase())) return false;
              if (spec.want?.subtype && !t.includes(spec.want.subtype.toLowerCase())) return false;
              // A tutor that fetches a land is almost never the play.
              return !isLand(card);
            });
          if (legal.length === 0) break;

          // What a player would actually go and get, in order:
          //  1. the card that completes a line it is one piece from,
          //  2. a card the registry knows how to use — a body it can only stare
          //     at is worth less than a spell it can point at you,
          //  3. the most expensive thing left.
          const score = (card: ScryfallCard) => {
            // Completing a line beats starting one, but starting one still
            // beats fetching the biggest body in the deck.
            const away = chasing.get(card.name);
            const combo = away === 1 ? 1000 : away !== undefined ? 400 : 0;
            return combo
              + (lookupEffect(card.name) || lookupSelfEffect(card.name) ? 100 : 0)
              + costOf(card);
          };
          const best = legal.reduce((a, b) => (score(b.card) > score(a.card) ? b : a));

          opp.library.splice(best.index, 1);
          if (spec.to === 'battlefield') {
            if (!addBody(best.card)) break;
          } else {
            opp.hand.push(best.card);
            pendingDraws++;
          }
          found.push(best.card.name);
        }
        // Named out loud: a tutor you cannot see is indistinguishable from a
        // lucky draw, and knowing what they went and got is the whole tell.
        return found.length > 0 ? `searches up ${describeNames(found)}` : null;
      }

      case 'makeTokens': {
        const batch = makeTokenBatch(opp, spec.tokens);
        opp.battlefield.push(...batch.permanents);
        pendingArrivals.push(...batch.arrivals);
        // Said out loud — see TokenBatch.capped.
        const short = batch.capped > 0 ? ` (${batch.capped} more, board is full)` : '';
        if (batch.parts.length === 0) return batch.capped > 0 ? 'makes no tokens — board is full' : null;
        return `creates ${batch.parts.join(', ')}${short}`;
      }
    }
  };

  /**
   * Would this spec actually do anything right now? Checked before paying, so
   * a bot never taps out to populate with no tokens or to reanimate an empty
   * graveyard — and never burns Victimize for nothing.
   */
  const specWouldDo = (spec: BotSelfSpec): boolean => {
    switch (spec.kind) {
      case 'populate':   return opp.battlefield.some(p => isTokenCard(p.card));
      case 'reanimate':  return opp.graveyard.some(c => isCreatureCard(c) && reanimateMatches(c, spec.want));
      case 'regrow':     return opp.graveyard.some(c => regrowMatches(c, spec.want));
      case 'returnSelf': return false;
      // `gainLifeSelf` IS a payoff — a Pelakka Wurm's only spec is the life,
      // and returning false here would stop the bot ever casting it.
      case 'gainLifeSelf': return true;
      // These two are prices, not payoffs. Returning true made any ability
      // containing one permanently "worth paying for": Phyrexian Reclamation
      // activated four turns running with an empty graveyard, paying 2 life a
      // turn for nothing. Neither ever appears as an entry's only spec.
      case 'payLife':     return false;
      case 'selfDiscard': return false;
      case 'recurExperience': return opp.graveyard.some(isCreatureCard);
      case 'amass':      return opp.battlefield.some(p => isArmyToken(p.card))
        || (!!findToken(opp.tokens, 'Army') && opp.battlefield.length < MAX_BOARD);
      case 'fetchLand':  return opp.library.some(isLand);
      case 'draw':
      case 'selfMill':   return opp.library.length > 0;
      case 'tutor':      return opp.library.some(c => {
        if (spec.want?.name && c.name !== spec.want.name) return false;
        const t = getFrontFaceTypeLine(c).toLowerCase();
        if (spec.want?.type && !t.includes(spec.want.type.toLowerCase())) return false;
        if (spec.want?.subtype && !t.includes(spec.want.subtype.toLowerCase())) return false;
        return !isLand(c);
      });
      case 'makeTokens':   return opp.battlefield.length < MAX_BOARD;
      case 'reclaimLands': return opp.graveyard.some(isLand);
      // Worth it only if something on the board actually qualifies — a Goreclaw
      // swinging into an empty board should not read as a trigger that fired.
      case 'pump':         return opp.battlefield.some(p =>
        isCreatureCard(p.card)
        && (!spec.subtype || typeLineOf(p).toLowerCase().includes(spec.subtype.toLowerCase()))
        && (spec.minPower === undefined || livePower(p, opp.battlefield, opp.graveyard) >= spec.minPower),
      );
    }
  };

  /**
   * Run every spec on one entry and join what they did into a single line.
   *
   * A trigger that does two things is one event, so it reads as one: Teval
   * "mills 3, returns Swamp" rather than two frames a beat apart.
   */
  const applySpecs = (specs: BotSelfSpec[]): string | null => {
    const parts = specs.map(applySpec).filter((s): s is string => s !== null);
    return parts.length > 0 ? parts.join(', ') : null;
  };

  /** Any one of the specs doing something is enough to be worth paying for. */
  const anySpecWouldDo = (specs: BotSelfSpec[]): boolean => specs.some(specWouldDo);

  /**
   * The multiplier on a scaled player-facing effect — "X, where X is the
   * number of Zombies you control". Only the bot's own board can answer that,
   * which is why `resolveEffect` takes it rather than working it out.
   */
  const effectScale = (spec: BotEffectSpec, incoming?: ScryfallCard): number => {
    if (spec.kind !== 'drain') return 1;
    if (spec.perDevotion) {
      // `incoming` is the card being cast, still in hand while the cast is
      // being chosen but on the battlefield by the time the trigger resolves.
      // Without it a Gray Merchant on an empty board drained for nothing
      // instead of the 2 its own {3}{B}{B} is worth.
      const cards = opp.battlefield.map(p => p.card);
      return devotionTo(incoming ? [...cards, incoming] : cards, spec.perDevotion);
    }
    if (!spec.perSubtype) return 1;
    const want = spec.perSubtype.toLowerCase();
    return opp.battlefield.filter(p =>
      getFrontFaceTypeLine(p.card).toLowerCase().includes(want),
    ).length;
  };

  const applySelfEffect = (cardName: string): string | null => {
    const entry = lookupSelfEffect(cardName);
    if (!entry) return null;
    return applySpecs(specsOf(entry));
  };

  /**
   * Everything on the board that watches the bot cast an instant or sorcery —
   * see BOT_SPELL_TRIGGERS. Returns the log lines; the damage is billed onto
   * this beat through `pendingDrain`, the channel death triggers already use,
   * so a turn casting three spells under a Guttersnipe hits you once for six
   * rather than three times for two.
   *
   * The board is snapshotted before the loop because a trigger that makes a
   * token grows it, and a payoff must not feed itself the turn it lands.
   */
  const castTriggers = (spell: ScryfallCard): string[] => {
    const value = costOf(spell);
    // A creature spell is nobody's trigger here; everything else is fair game
    // for the `noncreature` watchers, and only instants and sorceries for the
    // magecraft ones.
    const creature = isCreatureCard(spell);
    const instantOrSorcery = !isPermanent(spell);
    const lines: string[] = [];
    for (const p of [...opp.battlefield]) {
      const trigger = BOT_SPELL_TRIGGERS[p.card.name];
      if (!trigger) continue;
      // A permanent spell is already on the board by the time this runs, so the
      // card that just arrived would otherwise watch itself being cast — and
      // God-Eternal Oketra is not on the battlefield when Oketra is cast.
      if (p.card.name === spell.name) continue;
      if (trigger.creatureOnly) {
        if (!creature) continue;
      } else if (trigger.noncreature ? creature : !instantOrSorcery) continue;
      if (trigger.minMana !== undefined && value < trigger.minMana) continue;
      if (trigger.damage) {
        pendingDrain += trigger.damage;
        lines.push(`${opp.name}'s ${p.card.name} deals ${trigger.damage} to you`);
      }
      const label = trigger.spec ? applySpecs(specsOf({ spec: trigger.spec })) : null;
      if (label) lines.push(`${opp.name}'s ${p.card.name} ${label}`);
    }
    return lines;
  };

  // ── Untap + draw ──
  // `tempBoost` is cleared here as a backstop. Combat resolution is what
  // normally ends an until-end-of-turn pump — see `clearTempBoosts` in the
  // store — and this catches the case where it never resolved, so no bot can
  // carry a pump into a second turn.
  opp.battlefield = opp.battlefield.map(p => ({
    ...p, tapped: false, summoningSick: false, tempBoost: undefined,
  }));
  const drawLogs: string[] = [];
  let drewForTurn = false;
  if (opp.library.length > 0) {
    opp.hand.push(opp.library.shift() as ScryfallCard);
    pendingDraws++;
    drewForTurn = true;
  } else if (!opp.decked) {
    // Logged once, then never again — a bot that can't draw isn't a loss here,
    // this is a goldfish, not a game with a win condition.
    opp.decked = true;
    drawLogs.push(`${opp.name} has no cards left to draw`);
  }
  // Floated rather than logged: three bots drawing every turn is twelve log
  // lines a turn cycle, but a card advantage you cannot see at all is worse.
  frame(drawLogs, [], [], drewForTurn ? 'Draws' : undefined);

  // ── Upkeep ──
  // Effects that bill you every turn just for still being there. Scaled ones
  // read the board as it stands, so The Scarab God hurts more the longer the
  // horde grows — which is the entire threat that card represents.
  for (const p of opp.battlefield) {
    const spec = BOT_RECURRING_EFFECTS[p.card.name];
    if (!spec) continue;
    const hit = pickTarget(spec, boards(), effectScale(spec));
    if (hit) {
      frame(
        [`${opp.name}'s ${p.card.name} triggers`, `${opp.name} hits ${hit.target}`],
        [hit.effect], [], p.card.name, undefined,
        { card: p.card, name: p.card.name, kind: 'trigger', label: describeEffect(hit.effect, hit.target) },
      );
    }
  }

  // ── Land ──
  const landIdx = opp.hand.findIndex(isLand);
  if (landIdx >= 0) {
    const land = opp.hand.splice(landIdx, 1)[0];
    opp.battlefield.push({ ...toPermanent(land), summoningSick: false });
    frame([`${opp.name} plays ${land.name}`], [], [], land.name, undefined, undefined, { card: land, from: 'hand', onStack: false });

    // Landfall that pays the bot — a Rampaging Baloths turning every land it
    // ramps into into another 4/4.
    for (const line of landfallSelf(1)) frame([line]);

    // Landfall. The engine plays one land a turn, so this is once a turn —
    // which is exactly the cadence that makes Ob Nixilis a clock rather than
    // a 3/3.
    for (const p of opp.battlefield) {
      const spec = BOT_LANDFALL_EFFECTS[p.card.name];
      if (!spec) continue;
      const hit = pickTarget(spec, boards(), effectScale(spec));
      if (hit) {
        frame(
          [`${opp.name}'s ${p.card.name} triggers on the land`, `${opp.name} hits ${hit.target}`],
          [hit.effect], [], p.card.name, undefined,
          { card: p.card, name: p.card.name, kind: 'trigger', label: describeEffect(hit.effect, hit.target) },
        );
      }
    }
  }

  // Lands, rocks and unsick mana creatures.
  /** Untapped mana right now — recomputed after every spell, since paying taps. */
  const availableMana = () =>
    opp.battlefield.reduce((sum, p) => sum + manaFrom(p, opp.graveyard), 0);
  /**
   * How the bot would pay for `card`, with `extra` generic on top for commander
   * tax. Plan before you mutate: the taps are battlefield indices, so a spell
   * that pushes a permanent first would be shown paying with itself.
   */
  const payFor = (card: ScryfallCard, extra = 0) => planPayment(
    opp.battlefield,
    requirementFor(card, effectiveCost(card, opp.battlefield) + extra),
    opp.graveyard,
  );
  /**
   * Turn a plan's sources sideways and pay whatever they eat.
   *
   * Every payment goes through here rather than through `applyTaps` directly,
   * because a source can cost more than a tap: Deathrite Shaman's mana ability
   * exiles a land from the graveyard, so a bot that ramped off it three turns
   * running should be three lands lighter. The lines land on the next frame —
   * see `pendingManaLogs` — since paying happens before the beat is built.
   */
  const spendTaps = (taps: number[]) => {
    for (const i of taps) {
      const eats = graveyardManaCost(opp.battlefield[i].card);
      if (!eats) continue;
      const idx = opp.graveyard.findIndex(eats);
      // Can't happen — `manaFrom` only counts the source while the graveyard
      // has what it eats — but a source that cannot pay makes no mana either,
      // so skipping is the right failure if it ever does.
      if (idx < 0) continue;
      const [fuel] = opp.graveyard.splice(idx, 1);
      opp.exile.push(fuel);
      pendingManaLogs.push(`${opp.name} exiles ${fuel.name} from their graveyard for mana`);
    }
    opp.battlefield = applyTaps(opp.battlefield, taps);
  };
  /**
   * Pay a bare number, for the registry costs that are one — a cycling cost, a
   * recursion cost, an activated ability. Colourless in both senses: nothing
   * here knows what colour the ability wanted, so it spends the least flexible
   * sources first and leaves the duals up for the spells that do.
   */
  const spendMana = (amount: number) => {
    if (amount <= 0) return;
    spendTaps(planPayment(opp.battlefield, genericCost(amount), opp.graveyard).taps);
  };
  /** Can the bot make the colours? The develop loop still checks the total first. */
  const canPay = (card: ScryfallCard, extra = 0) => payFor(card, extra).paid;
  /**
   * The bot's own power on board, right now. A function rather than a constant
   * because the commander lands between here and the interaction step, and a
   * bot that measured itself before casting its best creature read the table as
   * more threatening than it was.
   */
  const botPower = () => opp.battlefield
    .filter(p => isCreatureCard(p.card))
    .reduce((sum, p) => sum + livePower(p, opp.battlefield), 0);

  // ── Echo ──
  /*
   * "At the beginning of your upkeep, if this came under your control since the
   * beginning of your last upkeep, sacrifice it unless you pay its echo cost."
   *
   * Flagged on arrival and settled on the first upkeep that sees it, which is
   * what makes an echo creature a rental rather than a permanent the bot got to
   * keep for free — the Bone Shredder that shot something down on turn four was
   * still standing there on turn twelve.
   *
   * It sits here rather than up with the recurring triggers because paying is a
   * payment: it needs the mana helpers, and it has to come out of the pool
   * BEFORE the bot spends the turn, exactly as it would at a real upkeep.
   *
   * Whether to pay is the one real decision echo asks, and the bot answers it
   * the way a player does: keep the creature when the body is worth the mana,
   * let it go when it is not. A 1/1 flier is not worth {1}{B}{B} on the turn it
   * has already used its trigger, and a bot that paid anyway would be throwing
   * away a whole turn of mana to keep a card it no longer wants.
   */
  for (const p of opp.battlefield.filter(x => x.echoDue)) {
    // Cleared whatever happens next: echo bills once, not every upkeep.
    p.echoDue = false;
    const cost = echoCostOf(p.card);
    if (!cost) continue;
    const requirement = requirementForCost(cost);
    const worth = livePower(p, opp.battlefield) + liveToughness(p, opp.battlefield);
    const plan = isCreatureCard(p.card) && worth <= requirement.generic + requirement.pips.length
      ? { paid: false, taps: [] as number[] }
      : planPayment(opp.battlefield, requirement, opp.graveyard);
    if (plan.paid) {
      spendTaps(plan.taps);
      frame([`${opp.name} pays echo for ${p.card.name}`], [], [], `Echo · ${p.card.name}`);
    } else {
      const logs = bury([p.instanceId]);
      frame(
        [`${opp.name} doesn't pay echo and sacrifices ${p.card.name}`, ...logs],
        [], [], `Echo · ${p.card.name}`,
      );
    }
  }

  // ── Commander ──
  // It goes first: it is the card the deck is built around, and holding it back
  // to cast a cheaper spell first is never what the deck wants. Commander tax is
  // {2} per previous cast, which is why a bot that keeps losing it slows down.
  if (opp.command.length > 0) {
    const commander = opp.command[0];
    const tax = 2 * opp.commanderCasts;
    const plan = payFor(commander, tax);
    if (plan.paid) {
      opp.command = opp.command.slice(1);
      spendTaps(plan.taps);
      opp.battlefield.push(toPermanent(commander));
      arrive(commander);
      opp.commanderCasts += 1;
      frame([`${opp.name} casts ${commander.name}`], [], [], commander.name, undefined, undefined, { card: commander, from: 'command', onStack: true });
    }
  }

  // ── Interaction ──
  // Interaction gets first call on the mana, before the bot spends it developing.
  // Up to two spells a turn: one is too few for a control deck holding eight
  // mana, and unlimited would let it empty its hand the moment you commit.
  //
  // Unless it is holding a combo piece it can pay for. A combo deck that spends
  // every turn answering the board never assembles: measured against a goldfish
  // whose creatures regrow each turn, Mirror Break went off on turn nine with
  // interaction first and turn seven without. A real combo player in that spot
  // deploys the piece and keeps the removal for whatever tries to stop them.
  const holdingComboPiece = () => {
    const wanted = comboPiecesWanted(
      opp.battlefield.map(p => p.card.name),
      opp.hand.map(c => c.name),
    );
    return opp.hand.some(c =>
      // Only pieces still needed on the BATTLEFIELD — a finisher that stays in
      // hand is cast by the combo step itself, not by developing.
      BOT_COMBOS.some(combo => combo.onBattlefield.includes(c.name) && !wanted.has(c.name))
      && canPay(c),
    );
  };

  if (opp.resistance && !holdingComboPiece()) {
    for (let cast = 0; cast < MAX_INTERACTION_PER_TURN; cast++) {
      const play = chooseResistancePlay({
        hand: opp.hand,
        mana: availableMana(),
        // Infinity for a spell whose colours the bot can't make, which is how a
        // numeric chooser says "uncastable" without learning about pips.
        costFor: card => (canPay(card) ? effectiveCost(card, opp.battlefield) : Infinity),
        // Scaled drains are counted off the bot's own board, which only the
        // engine can see. Without this the cast path silently used a scale of
        // 1 while the upkeep and ability paths scaled properly.
        scaleFor: effectScale,
        board,
        botPower: botPower(),
        turn: input.turnsTaken + 1,
        aggression: opp.aggression,
        botCreatureToughness: opp.battlefield
          .filter(p => isCreatureCard(p.card))
          .map(p => ({
            toughness: liveToughness(p, opp.battlefield),
            indestructible: botKeywords(p, opp.battlefield, opp.graveyard).has('indestructible'),
          })),
        rivals: rivalReads,
      });
      if (!play) break;
      opp.hand.splice(play.handIndex, 1);
      // Tap what it cost, so their board shows the spend — before the spell
      // lands, so a mana rock can't help pay for itself.
      spendTaps(payFor(play.card).taps);
      if (play.staysOnBattlefield) {
        opp.battlefield.push(toPermanent(play.card));
        arrive(play.card);
      } else {
        opp.graveyard.push(play.card);
      }

      // A wrath is symmetrical. The bot's own creatures die too, through the
      // same path as any other death, so a Solemn caught in it still draws.
      const wipe = lookupEffect(play.card.name);
      const wipeLogs: string[] = [];
      if (wipe?.spec.kind === 'boardWipe' && !wipe.spec.oneSided) {
        const cap = wipe.spec.maxToughness;
        const dying = opp.battlefield.filter(
          p =>
            isCreatureCard(p.card) &&
            // Same rule `resolveEffect` applies to your board: a destroy-wipe
            // leaves an indestructible creature standing, a -X/-X one does not.
            (cap === undefined
              ? !botKeywords(p, opp.battlefield, opp.graveyard).has('indestructible')
              : liveToughness(p, opp.battlefield) <= cap),
        );
        wipeLogs.push(...bury(dying.map(p => p.instanceId)));
        // Necromantic Selection: the wrath, then the best body back out of it.
        if (wipe.spec.thenReanimate) {
          const label = applySpecs([{ kind: 'reanimate', count: wipe.spec.thenReanimate }]);
          if (label) wipeLogs.push(`${opp.name} ${label}`);
        }
      }
      // "Destroy all artifacts and enchantments" is everyone's — a Bane of
      // Progress takes the bot's own Sol Ring with it.
      if (wipe?.spec.kind === 'artifactSweep' && wipe.spec.symmetric) {
        const sweep = wipe.spec;
        const dying = opp.battlefield.filter(p => {
          const t = typeLineOf(p).toLowerCase();
          return t.includes('artifact') || (!!sweep.enchantments && t.includes('enchantment'));
        });
        wipeLogs.push(...bury(dying.map(p => p.instanceId)));
      }
      // "Each player sacrifices a creature" — the bot's turn to give one up,
      // and the Marauder itself is fair game, as it often is at a real table.
      if (wipe?.spec.kind === 'edict' && wipe.spec.symmetric) {
        const fodder = pickSacrificeFodder(opp);
        if (fodder) wipeLogs.push(`${opp.name} sacrifices ${fodder.card.name}`, ...bury([fodder.instanceId]));
      }

      // A removal spell feeds the payoffs exactly as a cantrip does, which is
      // the whole reason a spellslinger deck plays interaction. Permanents cast
      // from this step — an ETB Chupacabra — are creature spells and do not.
      const interactionTriggers = castTriggers(play.card);

      frame(
        [`${opp.name} casts ${play.reason}`, ...wipeLogs, ...interactionTriggers],
        play.effect ? [play.effect, ...play.extra] : [], [], play.card.name, undefined,
        play.effect
          ? {
              card: play.card,
              name: play.card.name,
              // An ETB permanent is already on their board by the time you see
              // this, so what is waiting is its trigger, not the spell.
              kind: play.staysOnBattlefield ? 'trigger' : 'spell',
              label: describeEffect(play.effect, play.target),
            }
          : undefined,
        { card: play.card, from: 'hand', onStack: true },
      );
    }
  }

  // ── Cycling ──
  // Before the develop loop, because the whole point of a cycler is that it is
  // played on a turn you could not afford the card itself. A `preferred` one is
  // pitched even when it is affordable: nobody hard-casts a six-mana Gempalm
  // Polluter, and a bot that did would read as one following a rule instead of
  // playing a deck.
  for (const card of [...opp.hand]) {
    const cycle = BOT_CYCLING[card.name];
    if (!cycle || cycle.cost > availableMana()) continue;
    const affordable = effectiveCost(card, opp.battlefield) <= availableMana();
    if (affordable && !cycle.preferred) continue;
    const specs = specsOf({ spec: cycle.spec ?? [] });
    const hit = cycle.effect
      ? pickTarget(cycle.effect, boards(), effectScale(cycle.effect))
      : null;
    // Nothing to fetch and nothing to hit means the card is worth more in hand.
    if (!hit && !anySpecWouldDo(specs)) continue;

    const i = opp.hand.findIndex(c => c === card);
    if (i < 0) continue;
    opp.hand.splice(i, 1);
    opp.graveyard.push(card);
    spendMana(cycle.cost);

    const logs = [`${opp.name} cycles ${card.name}`];
    const label = applySpecs(specs);
    if (label) logs.push(`${opp.name} ${label}`);
    if (hit) logs.push(`${opp.name} hits ${hit.target}`);
    frame(
      logs, hit ? [hit.effect] : [], [], label ?? `Cycles ${card.name}`, undefined,
      hit
        ? { card, name: card.name, kind: 'ability', label: describeEffect(hit.effect, hit.target) }
        : undefined,
      { card, from: 'hand', onStack: true },
    );
  }

  // ── Back from the dead ──
  // A Gravecrawler you killed last turn walks back onto the board. Cheap, and
  // the most legible "this deck does a thing" moment either precon has: the
  // only answer is to change the board state, not to kill it again.
  for (const card of [...opp.graveyard]) {
    const rec = BOT_RECURSION[card.name];
    if (!rec || rec.cost > availableMana()) continue;
    if (opp.battlefield.length >= MAX_BOARD) break;
    if (rec.requiresSubtype) {
      const want = rec.requiresSubtype.toLowerCase();
      const has = opp.battlefield.some(p =>
        isCreatureCard(p.card) && getFrontFaceTypeLine(p.card).toLowerCase().includes(want),
      );
      if (!has) continue;
    }
    const i = opp.graveyard.findIndex(c => c === card);
    if (i < 0) continue;
    opp.graveyard.splice(i, 1);
    spendMana(rec.cost);
    opp.battlefield.push({ ...toPermanent(card), tapped: rec.tapped ?? false });
    arrive(card);
    frame([`${opp.name} returns ${card.name} from the graveyard`], [], [], card.name, undefined, undefined, { card, from: 'graveyard', onStack: true });
  }

  // ── Develop ──
  // Keep casting while the mana lasts, one frame per spell, so a big turn plays
  // out as a sequence of plays instead of the whole board appearing at once.
  for (let cast = 0; cast < MAX_CASTS_PER_TURN; cast++) {
    const mana = availableMana();
    let bestIdx = -1;
    let bestScore = -1;
    opp.hand.forEach((card, i) => {
      // A non-permanent is castable only when the registry says what it does.
      // Everything else — the counterspells especially — stays in hand, and the
      // end-of-turn hand limit is what eventually clears it out.
      const self = lookupSelfEffect(card.name);
      if (isLand(card) || (!isPermanent(card) && !self)) return;
      // A 0/0 with nothing to define its size never dies here and attacks for
      // nothing — holding it is strictly better than four mana for clutter.
      if (arrivesDead(card, opp.battlefield, opp.graveyard)) return;
      // An additional cost the bot cannot pay is a card it cannot cast.
      if (self?.sacrifice === 'creature' && !opp.battlefield.some(p => isCreatureCard(p.card))) return;
      // Don't burn a spell that would fizzle. Victimize with an empty graveyard
      // is a card worth keeping, not a card worth casting.
      if (self && !isPermanent(card) && self.timing === undefined && !anySpecWouldDo(specsOf(self))) return;
      // A registry permanent is held back only while its effect has something to
      // hit. Once your board is empty it is just a body, and a bot that keeps it
      // in hand forever reads as a bot that has stopped playing.
      if (opp.resistance && hasLiveTarget(card.name, boards())) return;
      const cost = effectiveCost(card, opp.battlefield);
      if (cost > mana || !canPay(card)) return;
      // Cast the most expensive thing affordable — a rough proxy for "best
      // play" — except that a combo piece jumps the queue. The interaction
      // step already stands aside when the bot is holding a piece it can pay
      // for, and that sacrifice is wasted if develop then casts a 6-drop over
      // it and the piece sits in hand for another turn.
      const piece = BOT_COMBOS.some(combo => combo.onBattlefield.includes(card.name));
      const score = cost + (piece ? 100 : 0);
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    });
    if (bestIdx < 0) break;
    const spell = opp.hand.splice(bestIdx, 1)[0];
    spendTaps(payFor(spell).taps);

    // Pay any additional cost first, through the shared death path so the
    // sacrifice fires death triggers like any other death.
    const entry = lookupSelfEffect(spell.name);
    const sacLogs: string[] = [];
    if (entry?.sacrifice === 'creature') {
      // The same picker that answers your edicts, so a bot values its own
      // board one way whoever is asking.
      const fodder = pickSacrificeFodder(opp);
      if (fodder) {
        sacLogs.push(`${opp.name} sacrifices ${fodder.card.name}`, ...bury([fodder.instanceId]));
        // Ineligible for this spell's own reanimate — see `sacrificedForSpell`.
        sacrificedForSpell = fodder.card;
      }
    }

    // A permanent stays; a sorcery or instant does its thing and is done.
    if (isPermanent(spell)) {
      opp.battlefield.push(toPermanent(spell));
      arrive(spell);
    }

    // Combat-timed effects fire in the attack step, not on arrival.
    const label = entry && entry.timing === undefined ? applySelfEffect(spell.name) : null;
    sacrificedForSpell = null;

    // The spell goes to the graveyard AFTER it resolves, which is both the real
    // rule and the fix for a spell targeting itself: Mystic Retrieval sat in its
    // own legal-target pool and took itself back every turn, for ever.
    if (!isPermanent(spell)) {
      if (entry?.selfDestination === 'library') {
        // "Shuffle it into its owner's library" — a Blue Sun's Zenith left in
        // the graveyard was a draw-3 the deck's regrow effects could rebuy.
        opp.library.splice(Math.floor(opp.library.length / 2), 0, spell);
      } else {
        opp.graveyard.push(spell);
      }
    }

    // What the spell did to the bot's own board gets its own line. Four Warriors
    // used to arrive in silence — the log said "casts Secure the Wastes" and
    // nothing else, so a swarm appeared out of nowhere.
    const castLogs = [`${opp.name} casts ${spell.name}`, ...sacLogs];
    if (label) castLogs.push(`${opp.name} ${label}`);
    // After the spell's own effect, so a cantrip draws before the Drake it made
    // is announced — the order the two would actually resolve in.
    castLogs.push(...castTriggers(spell));
    frame(castLogs, [], [], label ?? spell.name, undefined, undefined, { card: spell, from: 'hand', onStack: true });
  }

  // ── Activated abilities ──
  // Whatever mana is left over goes into abilities on the board. This is where
  // Rhys makes elves, Trostani populates and Meren recurs — without it the
  // token and graveyard decks stop developing the moment their hand runs out.
  //
  // One activation per permanent per turn, most expensive affordable ability
  // first, so Rhys doubles the board when it can rather than making one elf.
  // Modes of the same card cost the same, and there the registry order decides
  // — see Deathrite Shaman, whose modes are written in the order a player
  // reaches for them.
  /**
   * The other creature an ability eats, or null when there is nothing fit to
   * feed it. 'creature' is the worst one, by the same picker that answers your
   * edicts; 'biggestCreature' is the best — and only when it is worth at least
   * four, because that mode exists for Jarad, whose drain is the sacrificed
   * creature's power, and a player does not trade a 2/2 for two life.
   */
  const fodderFor = (ability: BotActivatedEntry, sourceId: string): OpponentPermanent | null => {
    if (!ability.sacrifices) return null;
    const others = opp.battlefield.filter(p => p.instanceId !== sourceId && isCreatureCard(p.card));
    if (others.length === 0) return null;
    if (ability.sacrifices === 'biggestCreature') {
      const best = [...others].sort((a, b) => livePower(b, opp.battlefield) - livePower(a, opp.battlefield))[0];
      return livePower(best, opp.battlefield) >= 4 ? best : null;
    }
    const worst = pickSacrificeFodder(opp);
    return worst && worst.instanceId !== sourceId ? worst : others[0];
  };

  for (const source of opp.battlefield.filter(p => lookupActivated(p.card.name).length > 0)) {
    const live = opp.battlefield.find(p => p.instanceId === source.instanceId);
    if (!live || live.tapped) continue;
    // What it can pay with if the ability turns the source sideways: the
    // source itself is out. Deathrite Shaman is both a mana ability and a
    // tap ability, so on a board where it is the only mana left it would
    // otherwise tap for the {B} that pays for its own {B}, {T}.
    const manaWithoutSource = availableMana() - manaFrom(live, opp.graveyard);
    const options = lookupActivated(live.card.name)
      .filter(a => a.cost <= (a.tapsSource ? manaWithoutSource : availableMana()))
      // A tap ability needs the permanent to have been there since upkeep.
      .filter(a => !(a.tapsSource && live.summoningSick))
      // An ability that eats a card out of the graveyard is only live while
      // one is there to eat — which is the whole of what makes a toolbox a
      // toolbox: the graveyard decides which mode is legal.
      .filter(a => !a.exiles || opp.graveyard.some(graveyardCostMatcher(a.exiles)))
      // An ability that eats another creature needs one worth eating.
      .filter(a => !a.sacrifices || fodderFor(a, live.instanceId) !== null)
      // A player-facing ability is worth paying for when it has a target; a
      // self ability when at least one of its specs would do something.
      .filter(a => a.effect
        ? pickTarget(a.effect, boards(), effectScale(a.effect)) !== null
        : anySpecWouldDo(specsOf({ spec: a.spec ?? [] })))
      // Ramp-on-legs is held while it is still a useful blocker.
      .filter(a => a.only !== 'behindOnLands' || behindOnLands())
      // A Gate to the Afterlife is only worth cashing in on a deep graveyard.
      .filter(a => a.only !== 'graveyardStocked' || opp.graveyard.filter(isCreatureCard).length >= 6)
      // Stabilising is only a play when there is something to stabilise from.
      .filter(a => a.only !== 'lowLife' || opp.life <= LOW_LIFE)
      .sort((a, b) => b.cost - a.cost);
    if (options.length === 0) continue;

    const ability = options[0];
    // The tap is part of the price and it is paid first, so the mana that
    // pays the rest cannot come from the source that just turned sideways.
    if (ability.tapsSource) {
      opp.battlefield = opp.battlefield.map(p =>
        p.instanceId === live.instanceId ? { ...p, tapped: true } : p,
      );
    }
    // Pay before resolving, so the cost shows on their board either way.
    spendMana(ability.cost);
    // The other half of the price: the card named by `exiles` leaves the
    // graveyard for good. Said out loud, because which card went is the
    // information a player needs to know what the mode was.
    const costLogs: string[] = [];
    if (ability.exiles) {
      const idx = opp.graveyard.findIndex(graveyardCostMatcher(ability.exiles));
      if (idx >= 0) {
        const [fuel] = opp.graveyard.splice(idx, 1);
        opp.exile.push(fuel);
        costLogs.push(`${opp.name} exiles ${fuel.name} from their graveyard`);
      }
    }
    // The ability eats its source, or another creature. A death like any
    // other: through the shared path, so a Reaper watching the Elder go still
    // draws. The fodder is read BEFORE it dies, because for Jarad its power is
    // the size of the drain.
    const fodder = fodderFor(ability, live.instanceId);
    const fodderPower = fodder ? livePower(fodder, opp.battlefield) : 0;
    // Returning the source to hand is part of the cost, which is what stops a
    // once-per-cast ability being a once-per-turn engine — see `bouncesSelf`.
    const bounceLogs: string[] = [];
    if (ability.bouncesSelf) {
      const back = opp.battlefield.find(p => p.instanceId === live.instanceId);
      if (back) {
        opp.battlefield = opp.battlefield.filter(p => p.instanceId !== live.instanceId);
        opp.hand.push(back.card);
        bounceLogs.push(`${opp.name} returns ${back.card.name} to hand`);
      }
    }
    const sacLogs = [
      ...bounceLogs,
      ...(ability.sacrificesSelf ? bury([live.instanceId]) : []),
      ...(fodder ? [`${opp.name} sacrifices ${fodder.card.name}`, ...bury([fodder.instanceId])] : []),
    ];
    if (ability.effect) {
      const spec = ability.effect;
      // A drain "equal to the sacrificed creature's power" is scaled by the
      // creature it just ate; everything else by the board as usual.
      const scale = spec.kind === 'drain' && spec.perSacrificedPower ? fodderPower : effectScale(spec);
      // "Each opponent loses 2 life" is every seat, not the best one. Anything
      // else picks the victim worth hitting.
      const hits = spec.kind === 'drain' && spec.eachOpponent
        ? resolveEverywhere(spec, boards(), scale)
        : [pickTarget(spec, boards(), scale)].filter(
            (h): h is { effect: AppliedEffect; target: string } => h !== null,
          );
      if (hits.length > 0) {
        // "hits you" is wrong for an ability that touches nobody — the green
        // half of a Deathrite is a bot buying itself two life, not an attack.
        const what = spec.kind === 'gainLife'
          ? `${opp.name} gains ${spec.amount} life`
          : `${opp.name} hits ${hits.map(h => h.target).join(', ')}`;
        frame(
          [`${opp.name} activates ${live.card.name}`, ...costLogs, what, ...sacLogs],
          hits.map(h => h.effect), [], live.card.name, undefined,
          { card: live.card, name: live.card.name, kind: 'ability', label: describeEffect(hits[0].effect, hits[0].target) },
        );
      }
    } else {
      const label = applySpecs(specsOf({ spec: ability.spec ?? [] }));
      if (label) {
        frame([`${opp.name} activates ${live.card.name}`, ...costLogs, `${opp.name} ${label}`, ...sacLogs], [], [], label);
      }
    }
  }

  // ── Beginning of combat ──
  // Rabblemaster and Krenko make their goblins here, before attackers are
  // chosen, so the new bodies are summoning-sick this turn but block next turn.
  const combatSources = opp.battlefield.filter(p => {
    const entry = lookupSelfEffect(p.card.name);
    if (!entry || entry.timing !== 'combat') return false;
    if (p.tapped) return false;
    // An upkeep trigger mapped onto this beat has to wait a turn — see
    // BotSelfEntry.skipArrivalTurn. A real beginning-of-combat trigger
    // (Rabblemaster) does not, and neither does a planeswalker's loyalty.
    if (entry.skipArrivalTurn && p.summoningSick) return false;
    // A tap ability needs the permanent to have been there since your upkeep.
    return !(entry.tapsSource && p.summoningSick);
  });
  for (const source of combatSources) {
    const entry = lookupSelfEffect(source.card.name)!;
    const label = applySelfEffect(source.card.name);
    if (entry.tapsSource) {
      opp.battlefield = opp.battlefield.map(p =>
        p.instanceId === source.instanceId ? { ...p, tapped: true } : p,
      );
    }
    if (label) {
      frame([`${opp.name}'s ${source.card.name} triggers`, `${opp.name} ${label}`], [], [], label);
    }
  }

  // ── Combos ──
  // A deck whose plan is to assemble two cards and win has to be able to do
  // that, or its bracket is a lie. Nothing here is deduced from the cards: the
  // lines are written down in BOT_COMBOS, and this only decides when to fire.
  //
  // Armed on the turn it assembles, executed on the next. That window is the
  // whole point — a bot that silently wins is a loss screen, and the pieces are
  // face-up permanents you can answer.
  if (opp.resistance) {
    const live = liveCombos({
      battlefield: opp.battlefield.map(p => p.card.name),
      hand: opp.hand.map(c => c.name),
      mana: availableMana(),
    });
    const armed = new Set(opp.armedCombos ?? []);
    const ready = live.find(c => armed.has(c.id));

    if (ready) {
      spendMana(ready.mana);
      // The finisher leaves hand and is spent.
      for (const name of ready.inHand ?? []) {
        const i = opp.hand.findIndex(c => c.name === name);
        if (i >= 0) opp.graveyard.push(opp.hand.splice(i, 1)[0]);
      }
      opp.armedCombos = [...armed].filter(id => id !== ready.id);

      const logs = [`${opp.name} goes off: ${ready.name}`, ready.how];
      if (ready.outcome.kind === 'makeTokens') {
        const label = applySpec(ready.outcome);
        if (label) logs.push(`${opp.name} ${label}`);
        frame(logs, [], [], ready.name);
      } else {
        const effect: AppliedEffect = ready.outcome.kind === 'winTheGame'
          ? { ...EMPTY_EFFECT, lethal: true }
          : { ...EMPTY_EFFECT, lifeLoss: ready.outcome.amount };
        // A line has no single card behind it. Show a piece that is on the
        // board, so the stack still has a face rather than a bare name.
        const face = opp.battlefield.find(pp => ready.onBattlefield.includes(pp.card.name))?.card;
        frame(logs, [effect], [], ready.name, undefined, {
          card: face,
          name: ready.name,
          kind: 'combo',
          label: describeEffect(effect, 'you'),
        });
      }
    } else if (live.length > 0) {
      // Newly assembled: name it, so the window is one you can see.
      const fresh = live.filter(c => !armed.has(c.id));
      if (fresh.length > 0) {
        opp.armedCombos = [...armed, ...fresh.map(c => c.id)];
        frame(
          fresh.map(c => `${opp.name} has ${c.name} assembled — it goes off next turn`),
          [], [], 'Combo ready!',
        );
      }
    }

    // Pieces that left the board disarm the line they belonged to.
    if ((opp.armedCombos ?? []).length > 0) {
      const stillLive = new Set(liveCombos({
        battlefield: opp.battlefield.map(p => p.card.name),
        hand: opp.hand.map(c => c.name),
        // Mana is irrelevant to whether the pieces are still there.
        mana: Number.POSITIVE_INFINITY,
      }).map(c => c.id));
      const kept = (opp.armedCombos ?? []).filter(id => stillLive.has(id));
      if (kept.length !== (opp.armedCombos ?? []).length) {
        const broken = (opp.armedCombos ?? []).filter(id => !stillLive.has(id));
        opp.armedCombos = kept;
        const names = BOT_COMBOS.filter(c => broken.includes(c.id)).map(c => c.name);
        if (names.length > 0) {
          frame([`${opp.name}'s ${names.join(', ')} is broken up`], [], [], 'Combo broken');
        }
      }
    }
  }

  // ── Attack ──
  // Who first, then which creatures. A bot will turn on a wounded rival rather
  // than grind at the player behind four blockers, which is what a fourth
  // player at the table would do.
  const able = opp.battlefield.filter(
    p => isCreatureCard(p.card)
      && !p.tapped
      // Haste is the whole reason the keyword exists, and the attack step used
      // to ignore it — a card printed with haste sat out its first turn.
      && (!p.summoningSick || hasHaste(p, opp.battlefield)),
  );
  const target = chooseAttackTarget(
    {
      id: null,
      name: 'you',
      life: board.life,
      untappedCreatures: board.untappedCreatures,
      // The player's whole board, not just what is untapped — a tapped
      // attacker is still a threat that comes back next turn.
      threat: board.cards
        .filter(c => c.isCreature)
        .reduce((n, c) => n + Math.max(0, c.power), 0),
    },
    rivals,
    // What it could swing with, so it can spot a seat it is able to finish.
    able.reduce((n, p) => n + livePower(p, opp.battlefield, opp.graveyard), 0),
  );
  /**
   * Who could hurt this bot most next turn — the player or any rival — so
   * the reserve is sized against them rather than against whoever happens to
   * be attacked. Rival creature counts are untapped bodies, which is what the
   * store reports; close enough for sizing a reserve.
   */
  const seats = [
    {
      power: board.cards.filter(c => c.isCreature).reduce((n, c) => n + Math.max(0, c.power), 0),
      creatures: board.cards.filter(c => c.isCreature).length,
    },
    ...rivals.filter(r => r.life > 0).map(r => ({ power: r.threat ?? 0, creatures: r.untappedCreatures.length })),
  ];
  const threatFrom = seats.reduce((a, b) => (b.power > a.power ? b : a));

  const chosen = new Set(
    chooseAttackers({
      candidates: able.map(p => ({
        instanceId: p.instanceId,
        name: p.card.name,
        power: livePower(p, opp.battlefield, opp.graveyard),
        toughness: liveToughness(p, opp.battlefield, opp.graveyard),
        keywords: botKeywords(p, opp.battlefield, opp.graveyard),
      })),
      blockers: target.untappedCreatures,
      playerLife: target.life,
      aggression: opp.aggression,
      botLife: opp.life,
      threatFrom,
    }),
  );
  const attackers = able.filter(p => chosen.has(p.instanceId));
  const attackTarget: AttackTarget = target.id === null
    ? { kind: 'player' }
    : { kind: 'opponent', id: target.id, name: target.name };

  if (attackers.length > 0) {
    // ── Attack triggers ──
    // Fired before the attack frame, so the log reads cause then effect, and
    // only for creatures that actually swung: a Teval held home as a blocker
    // mills nothing, which is the difference between 'attack' and 'combat'.
    for (const a of attackers) {
      const entry = lookupSelfEffect(a.card.name);
      if (!entry) continue;
      // `onAttack` is the second trigger on a card whose `timing` belongs to
      // another beat — see BotSelfEntry.onAttack.
      const specs = entry.timing === 'attack' ? specsOf(entry)
        : entry.onAttack ? (Array.isArray(entry.onAttack) ? entry.onAttack : [entry.onAttack])
        : null;
      if (!specs) continue;
      // Battalion: the trigger needs a crowd, and this swing may not be one.
      if (entry.requiresAttackers && attackers.length < entry.requiresAttackers) continue;
      attackContext = { self: a, attackers };
      const label = applySpecs(specs);
      attackContext = null;
      if (label) {
        frame([`${opp.name}'s ${a.card.name} attacks`, `${opp.name} ${label}`], [], [], label);
      }
    }

    // Vigilance attacks without tapping — the same rule your own side follows.
    const tapping = new Set(
      // `botKeywords`, not `keywordsOf`: the latter reads printed keywords only,
      // so an Intangible Virtue's granted vigilance was ignored by the one step
      // that exists to honour it.
      attackers.filter(a => !botKeywords(a, opp.battlefield, opp.graveyard).has('vigilance')).map(a => a.instanceId),
    );
    opp.battlefield = opp.battlefield.map(p =>
      tapping.has(p.instanceId) ? { ...p, tapped: true } : p,
    );
    opp.turnsTaken = input.turnsTaken + 1;
    // No damage here — combat opens and waits for blocks. Whatever gets through
    // is worked out when the player resolves it.
    frame(
      [`${opp.name} attacks ${target.name} with ${describeAttackers(attackers.map(a => a.card))}`],
      [],
      attackers.map(a => a.instanceId),
      target.id === null ? 'Attacks!' : `Attacks ${target.name}!`,
      attackTarget,
    );
  } else {
    opp.turnsTaken = input.turnsTaken + 1;
    // Keep the counter on the last frame even when nothing attacked.
    if (frames.length > 0) frames[frames.length - 1].opponent.turnsTaken = opp.turnsTaken;
  }

  // ── Cleanup ──
  // Seven cards, like anyone else. Without this a control bot's hand grows all
  // game, because a counterspell has no stack to answer and can never be cast.
  // Uncastable cards first, then the most expensive — see `priority` below.
  if (opp.hand.length > 7) {
    /**
     * What to pitch first. A card the bot can never cast — an instant or
     * sorcery no registry has a script for, which in practice means the
     * counterspells — is worth nothing in hand, so it goes before anything
     * else. After that the most expensive card, since what is stuck is
     * usually what is dear. Pitching the bombs first while a Counterspell
     * sat in hand all game was the old order.
     */
    const uncastable = (c: ScryfallCard) =>
      !isLand(c) && !isPermanent(c)
      && !lookupSelfEffect(c.name) && !lookupEffect(c.name) && !BOT_CYCLING[c.name];
    const priority = (c: ScryfallCard) => (uncastable(c) ? 1000 : 0) + costOf(c);
    const discarded: string[] = [];
    while (opp.hand.length > 7) {
      let worstIdx = 0;
      for (let i = 1; i < opp.hand.length; i++) {
        if (priority(opp.hand[i]) > priority(opp.hand[worstIdx])) worstIdx = i;
      }
      discarded.push(opp.hand[worstIdx].name);
      opp.graveyard.push(opp.hand.splice(worstIdx, 1)[0]);
    }
    frame([`${opp.name} discards ${discarded.join(', ')}`], [], [], 'Discards');
  }

  return { final: opp, frames };
}
