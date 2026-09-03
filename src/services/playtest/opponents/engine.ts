import type { ScryfallCard } from '@/types';
import { getFrontFaceTypeLine } from '@/services/scryfall/client';
import { isLand, makeInstanceId } from '@/components/playtest/utils';
import { chooseResistancePlay, type AppliedEffect, type PlayerBoardRead } from '@/services/playtest/opponents/evaluate';
import { lookupEffect } from '@/services/playtest/opponents/effects';
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

function isPermanent(card: ScryfallCard): boolean {
  const t = getFrontFaceTypeLine(card).toLowerCase();
  return (
    t.includes('creature') ||
    t.includes('artifact') ||
    t.includes('enchantment') ||
    t.includes('planeswalker')
  );
}

function isCreature(card: ScryfallCard): boolean {
  return getFrontFaceTypeLine(card).toLowerCase().includes('creature');
}

export function powerOf(card: ScryfallCard): number {
  const raw = card.power ?? card.card_faces?.[0]?.power;
  const n = parseInt(raw ?? '', 10);
  return Number.isNaN(n) ? 0 : n;
}

/**
 * Net mana from a tap ability. "{T}: Add {C}{C}" is 2; "{1}, {T}: Add {U}{B}"
 * produces two but costs one, so it's 1. Anything else that makes mana at all
 * counts as one — including "add one mana of any color", which has no symbols
 * to count.
 */
function netManaFromText(text: string): number {
  const m = text.match(/([^\n:]*?)\{t\}[^:]*:\s*add\s*((?:\{[^}]+\}\s*)+)/i);
  if (!m) return 1;
  const produced = (m[2].match(/\{[^}]+\}/g) ?? []).length;
  const genericCost = (m[1] ?? '').match(/\{(\d+)\}/);
  const spent = genericCost ? parseInt(genericCost[1], 10) : 0;
  return Math.max(1, produced - spent);
}

/** How much mana this permanent can make right now. */
function manaFrom(p: OpponentPermanent): number {
  if (p.tapped) return 0;
  if (isLand(p.card)) return 1;
  if ((p.card.produced_mana?.length ?? 0) === 0) return 0;
  // A mana creature can't tap the turn it arrives.
  if (isCreature(p.card) && p.summoningSick) return 0;
  return netManaFromText(p.card.oracle_text ?? '');
}

/**
 * Tap sources to pay `amount`. Lands go first, then rocks, then creatures —
 * tapping a creature costs an attacker, so it's the last resort.
 */
function tapForMana(battlefield: OpponentPermanent[], amount: number): OpponentPermanent[] {
  if (amount <= 0) return battlefield;
  const priority = (p: OpponentPermanent) =>
    isLand(p.card) ? 0 : isCreature(p.card) ? 2 : 1;
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

export function takeTurn(input: Opponent, playerBoard: PlayerBoardRead): TurnResult {
  const frames: TurnFrame[] = [];
  const opp: Opponent = {
    ...input,
    library: [...input.library],
    hand: [...input.hand],
    graveyard: [...input.graveyard],
    battlefield: input.battlefield.map(p => ({ ...p })),
  };

  /** Capture the board as it stands, as one beat of the turn. */
  const frame = (
    logs: string[],
    effects: AppliedEffect[] = [],
    attackers: string[] = [],
    blurb?: string,
  ) => {
    frames.push({
      opponent: {
        ...opp,
        library: [...opp.library],
        hand: [...opp.hand],
        graveyard: [...opp.graveyard],
        exile: [...opp.exile],
        battlefield: opp.battlefield.map(p => ({ ...p, counters: { ...p.counters } })),
      },
      logs,
      effects,
      attackers,
      blurb,
    });
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
  const botPower = opp.battlefield
    .filter(p => isCreature(p.card))
    .reduce((sum, p) => sum + powerOf(p.card), 0);

  // ── Interaction ──
  // Interaction gets first call on the mana, before the bot spends it developing.
  if (opp.resistance) {
    const play = chooseResistancePlay({
      hand: opp.hand,
      mana: availableMana(),
      board: playerBoard,
      botPower,
      turn: input.turnsTaken + 1,
      aggression: opp.aggression,
    });
    if (play) {
      opp.hand.splice(play.handIndex, 1);
      if (play.staysOnBattlefield) {
        opp.battlefield.push(toPermanent(play.card));
      } else {
        opp.graveyard.push(play.card);
      }
      // Tap what it cost, so their board shows the spend.
      opp.battlefield = tapForMana(opp.battlefield, play.card.cmc ?? 0);
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
      if (isLand(card) || !isPermanent(card)) return;
      // A registry permanent held back for its effect shouldn't be dumped out as
      // a vanilla body — resistance already had its chance at it this turn.
      if (opp.resistance && lookupEffect(card.name)) return;
      const cmc = card.cmc ?? 0;
      // Cast the most expensive thing affordable — a rough proxy for "best play".
      if (cmc <= mana && cmc > bestCmc) {
        bestCmc = cmc;
        bestIdx = i;
      }
    });
    if (bestIdx < 0) break;
    const spell = opp.hand.splice(bestIdx, 1)[0];
    opp.battlefield = tapForMana(opp.battlefield, spell.cmc ?? 0);
    opp.battlefield.push(toPermanent(spell));
    frame([`${opp.name} casts ${spell.name}`], [], [], spell.name);
  }

  // ── Attack ──
  // Everything that can attack, does. There's no blocking model, so this reads as
  // a clock rather than combat — which is what a goldfish needs.
  const attackers = opp.battlefield.filter(
    p => isCreature(p.card) && !p.summoningSick && !p.tapped && powerOf(p.card) > 0,
  );
  if (attackers.length > 0) {
    const attackerIds = new Set(attackers.map(a => a.instanceId));
    opp.battlefield = opp.battlefield.map(p =>
      attackerIds.has(p.instanceId) ? { ...p, tapped: true } : p,
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

  return { final: opp, frames };
}
