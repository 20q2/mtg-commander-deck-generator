import type { ScryfallCard } from '@/types';
import { getFrontFaceTypeLine } from '@/services/scryfall/client';
import { isLand, makeInstanceId } from '@/components/playtest/utils';
import { chooseResistancePlay, describeEffect, hasLiveTarget, resolveEffect, type AppliedEffect, type PlayerBoardRead } from '@/services/playtest/opponents/evaluate';
import {
  BOT_CYCLING,
  BOT_LANDFALL_EFFECTS,
  BOT_LANDFALL_SELF,
  BOT_RECURRING_EFFECTS,
  BOT_RECURSION,
  BOT_TRIGGERS,
  costOf,
  lookupActivated,
  lookupEffect,
  lookupSelfEffect,
  specsOf,
} from '@/services/playtest/opponents/effects';
import type { BotEffectSpec, BotSelfSpec, TokenSpec } from '@/services/playtest/opponents/effects';
import { arrivesDead, botKeywords, botPower as livePower, botToughness as liveToughness, effectiveCost, hasHaste, isCreatureCard, isTokenCard, tokenMultiplier } from '@/services/playtest/opponents/stats';
import { chooseAttackTarget, chooseAttackers, type AttackCandidate } from '@/services/playtest/opponents/combatChoices';
import { BOT_COMBOS, comboPiecesWanted, liveCombos } from '@/services/playtest/opponents/botCombos';
import { buryPermanents } from '@/services/playtest/opponents/deaths';
import { keywordsOf } from '@/services/playtest/combat';
import type { AttackTarget, Opponent, OpponentPermanent, StackSource, TurnFrame, TurnResult } from '@/components/playtest/opponentTypes';

/**
 * The bot turn loop. Pure: it takes an opponent plus a read of the player's board
 * and returns the next opponent, what happened, and any effects for the caller to
 * apply. Nothing here touches a store, which is what keeps the decision logic
 * testable and the coupling one-directional.
 *
 * Mana is deliberately approximated as "lands on the battlefield" with no colour
 * checking. Real coloured-mana correctness turns this into a rules engine, which
 * is explicitly out of scope — the bot is a goldfish opponent, not a referee.
 */

/** A do-nothing effect, for combo outcomes to fill in one field of. */
const EMPTY_EFFECT: AppliedEffect = {
  destroy: [], destination: 'graveyard', lifeLoss: 0, discard: 0,
};

/** Backstop on the develop loop so a mana-flooded board can't spin forever. */
const MAX_CASTS_PER_TURN = 5;

/** How many interaction spells a resisting bot casts in one turn. */
const MAX_INTERACTION_PER_TURN = 2;

/**
 * Hard ceiling on permanents a bot may control.
 *
 * Krenko doubles its goblins every combat, which is what the card does and is
 * correct — but a player who ignores it for eight turns had 300 tokens and by
 * twelve had 2,400, every one of them a card image in their seat. That is not
 * a hard game, it is a hung browser.
 *
 * Token creation stops at the cap. Nothing else does: the bot keeps casting
 * from hand, so hitting this looks like a board that has stopped growing rather
 * than a bot that has stopped playing.
 *
 * Lowered from 60 after measuring the goblin deck at 555 damage a game against
 * the other three decks' 25 to 84. Sixty permanents was not a difficulty
 * setting, it was a different game — and the cap is the one lever that bounds
 * the doubling without rewriting what Krenko does.
 */
const MAX_BOARD = 40;

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

/**
 * Net mana from a tap ability. "{T}: Add {C}{C}" is 2; "{1}, {T}: Add {U}{B}"
 * produces two but costs one, so it's 1; "{T}: Add one mana of any color" has
 * no symbols to count and is 1.
 *
 * No tap ability at all means no mana. That is the point of the rewrite: the
 * old version returned 1 for anything with a `produced_mana` field, so Skirk
 * Prospector — which has to sacrifice a goblin — was a free mana dork.
 */
function netManaFromText(text: string): number {
  const m = text.match(/([^\n:]*?)\{t\}[^:]*:\s*add\s+([^.\n]*)/i);
  if (!m) return 0;
  // `|| 1` covers "add one mana of any color", which writes no mana symbols.
  const produced = (m[2].match(/\{[^}]+\}/g) ?? []).length || 1;
  const genericCost = (m[1] ?? '').match(/\{(\d+)\}/);
  const spent = genericCost ? parseInt(genericCost[1], 10) : 0;
  return Math.max(0, produced - spent);
}

/** How much mana this permanent can make right now. */
function manaFrom(p: OpponentPermanent): number {
  if (p.tapped) return 0;
  if (isLand(p.card)) return 1;
  if ((p.card.produced_mana?.length ?? 0) === 0) return 0;
  // A mana creature can't tap the turn it arrives.
  if (isCreatureCard(p.card) && p.summoningSick) return 0;
  return netManaFromText(p.card.oracle_text ?? '');
}

/**
 * Tap sources to pay `amount`. Lands go first, then rocks, then creatures —
 * tapping a creature costs an attacker, so it's the last resort.
 */
function tapForMana(battlefield: OpponentPermanent[], amount: number): OpponentPermanent[] {
  if (amount <= 0) return battlefield;
  const priority = (p: OpponentPermanent) =>
    isLand(p.card) ? 0 : isCreatureCard(p.card) ? 2 : 1;
  const order = battlefield
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => manaFrom(p) > 0)
    .sort((a, b) => priority(a.p) - priority(b.p));

  const tapped = new Set<number>();
  let remaining = amount;
  for (const { p, i } of order) {
    if (remaining <= 0) break;
    remaining -= manaFrom(p);
    tapped.add(i);
  }
  return battlefield.map((p, i) => (tapped.has(i) ? { ...p, tapped: true } : p));
}

function toPermanent(card: ScryfallCard): OpponentPermanent {
  return {
    instanceId: makeInstanceId(),
    card,
    tapped: false,
    // Only creatures care, but tracking it uniformly keeps the attack step simple.
    summoningSick: true,
    counters: {},
  };
}

/**
 * Find a token in the deck's fetched pool. Matched on name first, then on the
 * type line, so a spec asking for a 'Goblin' finds "Goblin" and would also find
 * a differently-named goblin token if a deck ever had one.
 *
 * A miss returns undefined and the token is simply not made. That is the right
 * failure: a Scryfall hiccup should cost the bot a token, not crash its turn.
 */
function findToken(pool: ScryfallCard[], name: string): ScryfallCard | undefined {
  const want = name.toLowerCase();
  return (
    pool.find(t => t.name.toLowerCase() === want) ??
    pool.find(t => getFrontFaceTypeLine(t).toLowerCase().includes(want))
  );
}

/** A Zombie Army token — the single permanent every `amass` piles onto. */
function isArmyToken(card: ScryfallCard): boolean {
  const t = getFrontFaceTypeLine(card).toLowerCase();
  return t.includes('token') && t.includes('army');
}

/**
 * How many of a token to make. A fixed count, unless the spec counts a subtype
 * already on the board — Krenko makes one goblin per goblin. Either way it is
 * multiplied by any token doublers the bot controls.
 */
function tokenCount(spec: TokenSpec, battlefield: OpponentPermanent[]): number {
  const base = spec.countPerSubtype
    ? battlefield.filter(p =>
        getFrontFaceTypeLine(p.card).toLowerCase().includes(spec.countPerSubtype!.toLowerCase()),
      ).length
    : spec.count;
  return base * tokenMultiplier(battlefield);
}

/**
 * Damage the player takes when `count` creatures arrive on this board. Every
 * trigger fires for every creature, tokens included, which is the entire
 * reason a goblin deck with an Impact Tremors out is scary.
 */
function etbDamage(battlefield: OpponentPermanent[], count: number): number {
  if (count <= 0) return 0;
  let per = 0;
  for (const p of battlefield) {
    const spec = BOT_TRIGGERS[p.card.name];
    if (spec?.kind === 'creatureEtbDamage') per += spec.amount;
  }
  return per * count;
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

  /** Take what an effect does out of the bot's view, so later picks skip it. */
  const spend = (effect: AppliedEffect) => {
    if (effect.destroy.length > 0) {
      const gone = new Set(effect.destroy);
      board.cards = board.cards.filter(c => !gone.has(c.instanceId));
      board.untappedCreatures = board.untappedCreatures.filter(c => !gone.has(c.instanceId));
    }
    board.handSize = Math.max(0, board.handSize - effect.discard);
    board.life = Math.max(0, board.life - effect.lifeLoss);
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
  ) => {
    effects.forEach(spend);
    // Triggers are billed against the board as it stands at the end of the
    // beat, so a Purphoros cast alongside its goblins counts them.
    const etb = etbDamage(opp.battlefield, pendingCreatures);
    const selfDamage = etb + pendingDrain;
    pendingCreatures = 0;
    pendingDrain = 0;
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
      logs: etb > 0 ? [...logs, `${opp.name} deals ${etb} to you`] : logs,
      effects,
      attackers,
      blurb,
      attackTarget,
      selfDamage,
      source,
    });
  };

  /**
   * Creatures that arrived since the last frame. Read and reset by `frame`, so
   * every beat bills its own triggers exactly once.
   */
  let pendingCreatures = 0;

  /**
   * Bill the ETB triggers for a card arriving on the bot's board.
   *
   * Creatures only: a Gate to the Afterlife tutoring God-Pharaoh's Gift onto
   * the battlefield was charging you for Corpse Knight over an artifact. And
   * never the trigger source itself — every card in BOT_TRIGGERS says
   * "another creature", so Purphoros does not see its own arrival.
   */
  const arrive = (card: ScryfallCard) => {
    if (isCreatureCard(card) && !BOT_TRIGGERS[card.name]) pendingCreatures += 1;
  };

  /**
   * Life the player loses to the bot's own death triggers this beat — a
   * Judith or a Plague Belcher paid off by a wrath or a sacrifice. Billed
   * the same way ETB trigger damage is, straight onto the frame.
   */
  let pendingDrain = 0;

  /**
   * Kill some of the bot's own permanents — a wrath, a sacrifice — through
   * the same path the store uses for combat deaths, so their death triggers
   * fire. Returns the trigger log lines for the frame.
   */
  const bury = (ids: string[]): string[] => {
    const { opponent, lifeLoss, logs } = buryPermanents(opp, ids);
    opp.battlefield = opponent.battlefield;
    opp.graveyard = opponent.graveyard;
    opp.command = opponent.command;
    opp.hand = opponent.hand;
    opp.library = opponent.library;
    pendingDrain += lifeLoss;
    return logs;
  };

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
  const addBody = (card: ScryfallCard): boolean => {
    if (opp.battlefield.length >= MAX_BOARD) return false;
    opp.battlefield.push(toPermanent(card));
    arrive(card);
    return true;
  };

  const applySpec = (spec: BotSelfSpec): string | null => {
    switch (spec.kind) {
      case 'reclaimLands': {
        // Lands come back worst-first is wrong — a land is a land, so take
        // them in the order they were milled. Straight onto the battlefield is
        // mana this turn; to hand is a land drop banked for a later one.
        const names: string[] = [];
        for (let i = 0; i < spec.count; i++) {
          const idx = opp.graveyard.findIndex(isLand);
          if (idx < 0) break;
          const card = opp.graveyard.splice(idx, 1)[0];
          if (spec.to === 'hand') {
            opp.hand.push(card);
          } else {
            if (opp.battlefield.length >= MAX_BOARD) break;
            opp.battlefield.push({ ...toPermanent(card), tapped: spec.tapped ?? false });
          }
          names.push(card.name);
        }
        if (names.length === 0) return null;
        return spec.to === 'hand'
          ? `returns ${describeNames(names)} to hand`
          : `returns ${describeNames(names)} from the graveyard`;
      }

      case 'draw': {
        let drawn = 0;
        for (let i = 0; i < spec.count; i++) {
          if (opp.library.length === 0) break;
          opp.hand.push(opp.library.shift() as ScryfallCard);
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
            if (bestIdx < 0 || costOf(opp.graveyard[j]) > costOf(opp.graveyard[bestIdx])) bestIdx = j;
          }
          if (bestIdx < 0) break;
          const card = opp.graveyard[bestIdx];
          if (!addBody(card)) break;
          opp.graveyard.splice(bestIdx, 1);
          names.push(card.name);
        }
        return names.length > 0 ? `returns ${describeNames(names)}` : null;
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
            .filter(({ card }) => !isLand(card));
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
          opp.battlefield.push({
            ...toPermanent(land),
            // A land is never summoning-sick, but it can arrive tapped.
            summoningSick: false,
            tapped: spec.tapped ?? false,
          });
          made++;
        }
        return made > 0 ? `fetches ${made} land${made > 1 ? 's' : ''}` : null;
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
          }
          found.push(best.card.name);
        }
        // Named out loud: a tutor you cannot see is indistinguishable from a
        // lucky draw, and knowing what they went and got is the whole tell.
        return found.length > 0 ? `searches up ${describeNames(found)}` : null;
      }

      case 'makeTokens': {
        const parts: string[] = [];
        for (const tspec of spec.tokens) {
          const card = findToken(opp.tokens, tspec.name);
          if (!card) continue;
          // Room left under the cap, so a doubling engine plateaus instead of
          // running away with the frame rate.
          const room = Math.max(0, MAX_BOARD - opp.battlefield.length);
          const n = Math.min(tokenCount(tspec, opp.battlefield), room);
          for (let i = 0; i < n; i++) {
            opp.battlefield.push(toPermanent(card));
          }
          pendingCreatures += n;
          if (n > 0) parts.push(n > 1 ? `${n} ${card.name}s` : card.name);
        }
        return parts.length > 0 ? `creates ${parts.join(', ')}` : null;
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
      case 'reanimate':  return opp.graveyard.some(isCreatureCard);
      case 'regrow':     return opp.graveyard.some(c => !isLand(c));
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
  const effectScale = (spec: BotEffectSpec): number => {
    if (spec.kind !== 'drain' || !spec.perSubtype) return 1;
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

  // ── Untap + draw ──
  opp.battlefield = opp.battlefield.map(p => ({ ...p, tapped: false, summoningSick: false }));
  const drawLogs: string[] = [];
  let drewForTurn = false;
  if (opp.library.length > 0) {
    opp.hand.push(opp.library.shift() as ScryfallCard);
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
    const hit = resolveEffect(spec, board, effectScale(spec));
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
    frame([`${opp.name} plays ${land.name}`], [], [], land.name);

    // Landfall that pays the bot — a Rampaging Baloths turning every land it
    // ramps into into another 4/4.
    for (const p of opp.battlefield) {
      const spec = BOT_LANDFALL_SELF[p.card.name];
      if (!spec) continue;
      const label = applySpecs(Array.isArray(spec) ? spec : [spec]);
      if (label) {
        frame([`${opp.name}'s ${p.card.name} triggers on the land`, `${opp.name} ${label}`], [], [], label);
      }
    }

    // Landfall. The engine plays one land a turn, so this is once a turn —
    // which is exactly the cadence that makes Ob Nixilis a clock rather than
    // a 3/3.
    for (const p of opp.battlefield) {
      const spec = BOT_LANDFALL_EFFECTS[p.card.name];
      if (!spec) continue;
      const hit = resolveEffect(spec, board, effectScale(spec));
      if (hit) {
        frame(
          [`${opp.name}'s ${p.card.name} triggers on the land`, `${opp.name} hits ${hit.target}`],
          [hit.effect], [], p.card.name, undefined,
          { card: p.card, name: p.card.name, kind: 'trigger', label: describeEffect(hit.effect, hit.target) },
        );
      }
    }
  }

  // Lands, rocks and unsick mana creatures. Colours are still ignored — that's
  // the standing approximation — but ramp now actually ramps.
  /** Untapped mana right now — recomputed after every spell, since paying taps. */
  const availableMana = () => opp.battlefield.reduce((sum, p) => sum + manaFrom(p), 0);
  /**
   * The bot's own power on board, right now. A function rather than a constant
   * because the commander lands between here and the interaction step, and a
   * bot that measured itself before casting its best creature read the table as
   * more threatening than it was.
   */
  const botPower = () => opp.battlefield
    .filter(p => isCreatureCard(p.card))
    .reduce((sum, p) => sum + livePower(p, opp.battlefield), 0);

  // ── Commander ──
  // It goes first: it is the card the deck is built around, and holding it back
  // to cast a cheaper spell first is never what the deck wants. Commander tax is
  // {2} per previous cast, which is why a bot that keeps losing it slows down.
  if (opp.command.length > 0) {
    const commander = opp.command[0];
    const tax = 2 * opp.commanderCasts;
    const price = effectiveCost(commander, opp.battlefield) + tax;
    if (price <= availableMana()) {
      opp.command = opp.command.slice(1);
      opp.battlefield = tapForMana(opp.battlefield, price);
      opp.battlefield.push(toPermanent(commander));
      arrive(commander);
      opp.commanderCasts += 1;
      frame([`${opp.name} casts ${commander.name}`], [], [], commander.name);
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
      && effectiveCost(c, opp.battlefield) <= availableMana(),
    );
  };

  if (opp.resistance && !holdingComboPiece()) {
    for (let cast = 0; cast < MAX_INTERACTION_PER_TURN; cast++) {
      const play = chooseResistancePlay({
        hand: opp.hand,
        mana: availableMana(),
        costFor: card => effectiveCost(card, opp.battlefield),
        board,
        botPower: botPower(),
        turn: input.turnsTaken + 1,
        aggression: opp.aggression,
        botCreatureToughness: opp.battlefield
          .filter(p => isCreatureCard(p.card))
          .map(p => liveToughness(p, opp.battlefield)),
      });
      if (!play) break;
      opp.hand.splice(play.handIndex, 1);
      if (play.staysOnBattlefield) {
        opp.battlefield.push(toPermanent(play.card));
        arrive(play.card);
      } else {
        opp.graveyard.push(play.card);
      }
      // Tap what it cost, so their board shows the spend.
      opp.battlefield = tapForMana(opp.battlefield, effectiveCost(play.card, opp.battlefield));

      // A wrath is symmetrical. The bot's own creatures die too, through the
      // same path as any other death, so a Solemn caught in it still draws.
      const wipe = lookupEffect(play.card.name);
      const wipeLogs: string[] = [];
      if (wipe?.spec.kind === 'boardWipe' && !wipe.spec.oneSided) {
        const cap = wipe.spec.maxToughness;
        const dying = opp.battlefield.filter(
          p =>
            isCreatureCard(p.card) &&
            (cap === undefined || liveToughness(p, opp.battlefield) <= cap),
        );
        wipeLogs.push(...bury(dying.map(p => p.instanceId)));
      }

      frame(
        [`${opp.name} casts ${play.reason}`, ...wipeLogs],
        play.effect ? [play.effect] : [], [], play.card.name, undefined,
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
      ? resolveEffect(cycle.effect, board, effectScale(cycle.effect))
      : null;
    // Nothing to fetch and nothing to hit means the card is worth more in hand.
    if (!hit && !anySpecWouldDo(specs)) continue;

    const i = opp.hand.findIndex(c => c === card);
    if (i < 0) continue;
    opp.hand.splice(i, 1);
    opp.graveyard.push(card);
    opp.battlefield = tapForMana(opp.battlefield, cycle.cost);

    const logs = [`${opp.name} cycles ${card.name}`];
    const label = applySpecs(specs);
    if (label) logs.push(`${opp.name} ${label}`);
    if (hit) logs.push(`${opp.name} hits ${hit.target}`);
    frame(
      logs, hit ? [hit.effect] : [], [], label ?? `Cycles ${card.name}`, undefined,
      hit
        ? { card, name: card.name, kind: 'ability', label: describeEffect(hit.effect, hit.target) }
        : undefined,
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
    opp.battlefield = tapForMana(opp.battlefield, rec.cost);
    opp.battlefield.push({ ...toPermanent(card), tapped: rec.tapped ?? false });
    arrive(card);
    frame([`${opp.name} returns ${card.name} from the graveyard`], [], [], card.name);
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
      // Don't burn a spell that would fizzle. Victimize with an empty graveyard
      // is a card worth keeping, not a card worth casting.
      if (self && !isPermanent(card) && self.timing === undefined && !anySpecWouldDo(specsOf(self))) return;
      // A registry permanent is held back only while its effect has something to
      // hit. Once your board is empty it is just a body, and a bot that keeps it
      // in hand forever reads as a bot that has stopped playing.
      if (opp.resistance && hasLiveTarget(card.name, board)) return;
      const cost = effectiveCost(card, opp.battlefield);
      if (cost > mana) return;
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
    opp.battlefield = tapForMana(opp.battlefield, effectiveCost(spell, opp.battlefield));

    // A permanent stays; a sorcery or instant does its thing and is done.
    if (isPermanent(spell)) {
      opp.battlefield.push(toPermanent(spell));
      arrive(spell);
    } else {
      opp.graveyard.push(spell);
    }

    // Combat-timed effects fire in the attack step, not on arrival.
    const entry = lookupSelfEffect(spell.name);
    const label = entry && entry.timing === undefined ? applySelfEffect(spell.name) : null;

    // What the spell did to the bot's own board gets its own line. Four Warriors
    // used to arrive in silence — the log said "casts Secure the Wastes" and
    // nothing else, so a swarm appeared out of nowhere.
    const castLogs = [`${opp.name} casts ${spell.name}`];
    if (label) castLogs.push(`${opp.name} ${label}`);
    frame(castLogs, [], [], label ?? spell.name);
  }

  // ── Activated abilities ──
  // Whatever mana is left over goes into abilities on the board. This is where
  // Rhys makes elves, Trostani populates and Meren recurs — without it the
  // token and graveyard decks stop developing the moment their hand runs out.
  //
  // One activation per permanent per turn, most expensive affordable ability
  // first, so Rhys doubles the board when it can rather than making one elf.
  for (const source of opp.battlefield.filter(p => lookupActivated(p.card.name).length > 0)) {
    const live = opp.battlefield.find(p => p.instanceId === source.instanceId);
    if (!live || live.tapped) continue;
    const options = lookupActivated(live.card.name)
      .filter(a => a.cost <= availableMana())
      // A tap ability needs the permanent to have been there since upkeep.
      .filter(a => !(a.tapsSource && live.summoningSick))
      // A player-facing ability is worth paying for when it has a target; a
      // self ability when at least one of its specs would do something.
      .filter(a => a.effect
        ? resolveEffect(a.effect, board, effectScale(a.effect)) !== null
        : anySpecWouldDo(specsOf({ spec: a.spec ?? [] })))
      // Ramp-on-legs is held while it is still a useful blocker.
      .filter(a => a.only !== 'behindOnLands' || behindOnLands())
      // A Gate to the Afterlife is only worth cashing in on a deep graveyard.
      .filter(a => a.only !== 'graveyardStocked' || opp.graveyard.filter(isCreatureCard).length >= 6)
      .sort((a, b) => b.cost - a.cost);
    if (options.length === 0) continue;

    const ability = options[0];
    // Pay before resolving, so the cost shows on their board either way.
    opp.battlefield = tapForMana(opp.battlefield, ability.cost);
    if (ability.tapsSource) {
      opp.battlefield = opp.battlefield.map(p =>
        p.instanceId === live.instanceId ? { ...p, tapped: true } : p,
      );
    }
    // The ability eats its source. A death like any other: through the shared
    // path, so a Reaper watching the Elder go still draws.
    const sacLogs = ability.sacrificesSelf ? bury([live.instanceId]) : [];
    if (ability.effect) {
      const hit = resolveEffect(ability.effect, board, effectScale(ability.effect));
      if (hit) {
        frame(
          [`${opp.name} activates ${live.card.name}`, `${opp.name} hits ${hit.target}`, ...sacLogs],
          [hit.effect], [], live.card.name, undefined,
          { card: live.card, name: live.card.name, kind: 'ability', label: describeEffect(hit.effect, hit.target) },
        );
      }
    } else {
      const label = applySpecs(specsOf({ spec: ability.spec ?? [] }));
      if (label) {
        frame([`${opp.name} activates ${live.card.name}`, `${opp.name} ${label}`, ...sacLogs], [], [], label);
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
      opp.battlefield = tapForMana(opp.battlefield, ready.mana);
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
      if (entry?.timing !== 'attack') continue;
      const label = applySpecs(specsOf(entry));
      if (label) {
        frame([`${opp.name}'s ${a.card.name} attacks`, `${opp.name} ${label}`], [], [], label);
      }
    }

    // Vigilance attacks without tapping — the same rule your own side follows.
    const tapping = new Set(
      attackers.filter(a => !keywordsOf(a.card, a.edit).has('vigilance')).map(a => a.instanceId),
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
