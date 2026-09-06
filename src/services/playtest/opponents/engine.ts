import type { ScryfallCard } from '@/types';
import { getFrontFaceTypeLine } from '@/services/scryfall/client';
import { isLand, makeInstanceId } from '@/components/playtest/utils';
import { chooseResistancePlay, hasLiveTarget, type AppliedEffect, type PlayerBoardRead } from '@/services/playtest/opponents/evaluate';
import { BOT_TRIGGERS, costOf, lookupEffect, lookupSelfEffect } from '@/services/playtest/opponents/effects';
import type { TokenSpec } from '@/services/playtest/opponents/effects';
import { botPower as livePower, botToughness as liveToughness, isCreatureCard, isTokenCard, tokenMultiplier } from '@/services/playtest/opponents/stats';
import { chooseAttackers } from '@/services/playtest/opponents/combatChoices';
import { keywordsOf } from '@/services/playtest/combat';
import type { Opponent, OpponentPermanent, TurnFrame, TurnResult } from '@/components/playtest/opponentTypes';

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

/** Backstop on the develop loop so a mana-flooded board can't spin forever. */
const MAX_CASTS_PER_TURN = 5;

/** How many interaction spells a resisting bot casts in one turn. */
const MAX_INTERACTION_PER_TURN = 2;

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

export function takeTurn(input: Opponent, playerBoard: PlayerBoardRead): TurnResult {
  const frames: TurnFrame[] = [];
  const opp: Opponent = {
    ...input,
    library: [...input.library],
    hand: [...input.hand],
    graveyard: [...input.graveyard],
    command: [...input.command],
    battlefield: input.battlefield.map(p => ({ ...p })),
  };

  /** Capture the board as it stands, as one beat of the turn. */
  const frame = (
    logs: string[],
    effects: AppliedEffect[] = [],
    attackers: string[] = [],
    blurb?: string,
  ) => {
    // Triggers are billed against the board as it stands at the end of the
    // beat, so a Purphoros cast alongside its goblins counts them.
    const selfDamage = etbDamage(opp.battlefield, pendingCreatures);
    pendingCreatures = 0;
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
      logs: selfDamage > 0 ? [...logs, `${opp.name} deals ${selfDamage} to you`] : logs,
      effects,
      attackers,
      blurb,
      selfDamage,
    });
  };

  /**
   * Creatures that arrived since the last frame. Read and reset by `frame`, so
   * every beat bills its own triggers exactly once.
   */
  let pendingCreatures = 0;

  /**
   * Apply a card's effect on the bot's own board — tokens and draw. Returns a
   * short label for the frame, or null when nothing happened. Called for cast
   * effects and again for the combat-timed ones.
   */
  const applySelfEffect = (cardName: string): string | null => {
    const entry = lookupSelfEffect(cardName);
    if (!entry) return null;

    if (entry.spec.kind === 'draw') {
      let drawn = 0;
      for (let i = 0; i < entry.spec.count; i++) {
        if (opp.library.length === 0) break;
        opp.hand.push(opp.library.shift() as ScryfallCard);
        drawn++;
      }
      return drawn > 0 ? `Draws ${drawn}` : null;
    }

    let made = 0;
    for (const spec of entry.spec.tokens) {
      const card = findToken(opp.tokens, spec.name);
      if (!card) continue;
      const n = tokenCount(spec, opp.battlefield);
      for (let i = 0; i < n; i++) {
        opp.battlefield.push(toPermanent(card));
        made++;
      }
    }
    pendingCreatures += made;
    return made > 0 ? `+${made} token${made > 1 ? 's' : ''}` : null;
  };

  // ── Untap + draw ──
  opp.battlefield = opp.battlefield.map(p => ({ ...p, tapped: false, summoningSick: false }));
  const drawLogs: string[] = [];
  if (opp.library.length > 0) {
    opp.hand.push(opp.library.shift() as ScryfallCard);
  } else if (!opp.decked) {
    // Logged once, then never again — a bot that can't draw isn't a loss here,
    // this is a goldfish, not a game with a win condition.
    opp.decked = true;
    drawLogs.push(`${opp.name} has no cards left to draw`);
  }
  frame(drawLogs);

  // ── Land ──
  const landIdx = opp.hand.findIndex(isLand);
  if (landIdx >= 0) {
    const land = opp.hand.splice(landIdx, 1)[0];
    opp.battlefield.push({ ...toPermanent(land), summoningSick: false });
    frame([`${opp.name} plays ${land.name}`], [], [], land.name);
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
    const price = costOf(commander) + tax;
    if (price <= availableMana()) {
      opp.command = opp.command.slice(1);
      opp.battlefield = tapForMana(opp.battlefield, price);
      opp.battlefield.push(toPermanent(commander));
      if (isCreatureCard(commander)) pendingCreatures += 1;
      opp.commanderCasts += 1;
      frame([`${opp.name} casts ${commander.name}`], [], [], commander.name);
    }
  }

  // ── Interaction ──
  // Interaction gets first call on the mana, before the bot spends it developing.
  // Up to two spells a turn: one is too few for a control deck holding eight
  // mana, and unlimited would let it empty its hand the moment you commit.
  if (opp.resistance) {
    for (let cast = 0; cast < MAX_INTERACTION_PER_TURN; cast++) {
      const play = chooseResistancePlay({
        hand: opp.hand,
        mana: availableMana(),
        board: playerBoard,
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
        if (isCreatureCard(play.card)) pendingCreatures += 1;
      } else {
        opp.graveyard.push(play.card);
      }
      // Tap what it cost, so their board shows the spend.
      opp.battlefield = tapForMana(opp.battlefield, costOf(play.card));

      // A wrath is symmetrical. The bot's own creatures die too — tokens simply
      // cease to exist, and its commander goes back to the command zone.
      const wipe = lookupEffect(play.card.name);
      if (wipe?.spec.kind === 'boardWipe') {
        const cap = wipe.spec.maxToughness;
        const dying = opp.battlefield.filter(
          p =>
            isCreatureCard(p.card) &&
            (cap === undefined || liveToughness(p, opp.battlefield) <= cap),
        );
        const ids = new Set(dying.map(p => p.instanceId));
        opp.graveyard.push(
          ...dying
            .filter(p => !isTokenCard(p.card) && p.card.name !== opp.commanderName)
            .map(p => p.card),
        );
        opp.command.push(
          ...dying.filter(p => p.card.name === opp.commanderName).map(p => p.card),
        );
        opp.battlefield = opp.battlefield.filter(p => !ids.has(p.instanceId));
      }

      frame([`${opp.name} casts ${play.reason}`], play.effect ? [play.effect] : [], [], play.card.name);
    }
  }

  // ── Develop ──
  // Keep casting while the mana lasts, one frame per spell, so a big turn plays
  // out as a sequence of plays instead of the whole board appearing at once.
  for (let cast = 0; cast < MAX_CASTS_PER_TURN; cast++) {
    const mana = availableMana();
    let bestIdx = -1;
    let bestCmc = -1;
    opp.hand.forEach((card, i) => {
      // A non-permanent is castable only when the registry says what it does.
      // Everything else — the counterspells especially — stays in hand, and the
      // end-of-turn hand limit is what eventually clears it out.
      if (isLand(card) || (!isPermanent(card) && !lookupSelfEffect(card.name))) return;
      // A registry permanent is held back only while its effect has something to
      // hit. Once your board is empty it is just a body, and a bot that keeps it
      // in hand forever reads as a bot that has stopped playing.
      if (opp.resistance && hasLiveTarget(card.name, playerBoard)) return;
      const cost = costOf(card);
      // Cast the most expensive thing affordable — a rough proxy for "best play".
      if (cost <= mana && cost > bestCmc) {
        bestCmc = cost;
        bestIdx = i;
      }
    });
    if (bestIdx < 0) break;
    const spell = opp.hand.splice(bestIdx, 1)[0];
    opp.battlefield = tapForMana(opp.battlefield, costOf(spell));

    // A permanent stays; a sorcery or instant does its thing and is done.
    if (isPermanent(spell)) {
      opp.battlefield.push(toPermanent(spell));
      if (isCreatureCard(spell)) pendingCreatures += 1;
    } else {
      opp.graveyard.push(spell);
    }

    // Combat-timed effects fire in the attack step, not on arrival.
    const entry = lookupSelfEffect(spell.name);
    const label = entry && entry.timing !== 'combat' ? applySelfEffect(spell.name) : null;

    frame([`${opp.name} casts ${spell.name}`], [], [], label ?? spell.name);
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
    if (label) frame([`${opp.name}'s ${source.card.name} triggers`], [], [], label);
  }

  // ── Attack ──
  // Everything that can attack, does. There's no blocking model, so this reads as
  // a clock rather than combat — which is what a goldfish needs.
  const able = opp.battlefield.filter(
    p => isCreatureCard(p.card) && !p.summoningSick && !p.tapped,
  );
  const chosen = new Set(
    chooseAttackers({
      candidates: able.map(p => ({
        instanceId: p.instanceId,
        name: p.card.name,
        power: livePower(p, opp.battlefield),
        toughness: liveToughness(p, opp.battlefield),
        keywords: keywordsOf(p.card),
      })),
      blockers: playerBoard.untappedCreatures,
      playerLife: playerBoard.life,
      aggression: opp.aggression,
    }),
  );
  const attackers = able.filter(p => chosen.has(p.instanceId));

  if (attackers.length > 0) {
    // Vigilance attacks without tapping — the same rule your own side follows.
    const tapping = new Set(
      attackers.filter(a => !keywordsOf(a.card).has('vigilance')).map(a => a.instanceId),
    );
    opp.battlefield = opp.battlefield.map(p =>
      tapping.has(p.instanceId) ? { ...p, tapped: true } : p,
    );
    opp.turnsTaken = input.turnsTaken + 1;
    // No damage here — combat opens and waits for blocks. Whatever gets through
    // is worked out when the player resolves it.
    frame(
      [`${opp.name} attacks with ${attackers.map(a => a.card.name).join(', ')}`],
      [],
      attackers.map(a => a.instanceId),
      'Attacks!',
    );
  } else {
    opp.turnsTaken = input.turnsTaken + 1;
    // Keep the counter on the last frame even when nothing attacked.
    if (frames.length > 0) frames[frames.length - 1].opponent.turnsTaken = opp.turnsTaken;
  }

  // ── Cleanup ──
  // Seven cards, like anyone else. Without this a control bot's hand grows all
  // game, because a counterspell has no stack to answer and can never be cast.
  // The most expensive card goes first: what is stuck is usually what is dear.
  if (opp.hand.length > 7) {
    const discarded: string[] = [];
    while (opp.hand.length > 7) {
      let worstIdx = 0;
      for (let i = 1; i < opp.hand.length; i++) {
        if (costOf(opp.hand[i]) > costOf(opp.hand[worstIdx])) worstIdx = i;
      }
      discarded.push(opp.hand[worstIdx].name);
      opp.graveyard.push(opp.hand.splice(worstIdx, 1)[0]);
    }
    frame([`${opp.name} discards ${discarded.join(', ')}`], [], [], 'Discards');
  }

  return { final: opp, frames };
}
