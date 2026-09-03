import type { ScryfallCard } from '@/types';
import { getFrontFaceTypeLine } from '@/services/scryfall/client';
import { isLand, makeInstanceId } from '@/components/playtest/utils';
import { chooseResistancePlay, type AppliedEffect, type PlayerBoardRead } from '@/services/playtest/opponents/evaluate';
import { lookupEffect } from '@/services/playtest/opponents/effects';
import type { Opponent, OpponentPermanent, TurnResult } from '@/components/playtest/opponentTypes';

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
  const logs: string[] = [];
  const effects: AppliedEffect[] = [];
  const opp: Opponent = {
    ...input,
    library: [...input.library],
    hand: [...input.hand],
    graveyard: [...input.graveyard],
    battlefield: input.battlefield.map(p => ({ ...p })),
  };

  // ── Untap ──
  opp.battlefield = opp.battlefield.map(p => ({ ...p, tapped: false, summoningSick: false }));

  // ── Draw ──
  if (opp.library.length > 0) {
    opp.hand.push(opp.library.shift() as ScryfallCard);
  } else if (!opp.decked) {
    // Logged once, then never again — a bot that can't draw isn't a loss here,
    // this is a goldfish, not a game with a win condition.
    opp.decked = true;
    logs.push(`${opp.name} has no cards left to draw`);
  }

  // ── Land ──
  const landIdx = opp.hand.findIndex(isLand);
  if (landIdx >= 0) {
    const land = opp.hand.splice(landIdx, 1)[0];
    opp.battlefield.push({ ...toPermanent(land), summoningSick: false });
    logs.push(`${opp.name} plays ${land.name}`);
  }

  // Available mana is just the land count; everything is untapped at this point.
  const mana = opp.battlefield.filter(p => isLand(p.card)).length;
  const botPower = opp.battlefield
    .filter(p => isCreature(p.card))
    .reduce((sum, p) => sum + powerOf(p.card), 0);

  // ── Interaction ──
  let castSomething = false;
  if (opp.resistance) {
    const play = chooseResistancePlay({
      hand: opp.hand,
      mana,
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
      if (play.effect) effects.push(play.effect);
      logs.push(`${opp.name} casts ${play.reason}`);
      castSomething = true;
    }
  }

  // ── Develop ──
  // Only if no interaction fired — one spell a turn keeps the clock legible.
  if (!castSomething) {
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
    if (bestIdx >= 0) {
      const spell = opp.hand.splice(bestIdx, 1)[0];
      opp.battlefield.push(toPermanent(spell));
      logs.push(`${opp.name} casts ${spell.name}`);
    }
  }

  // ── Attack ──
  // Everything that can attack, does. There's no blocking model, so this reads as
  // a clock rather than combat — which is what a goldfish needs.
  const attackers = opp.battlefield.filter(
    p => isCreature(p.card) && !p.summoningSick && !p.tapped && powerOf(p.card) > 0,
  );
  let damageToPlayer = 0;
  if (attackers.length > 0) {
    const attackerIds = new Set(attackers.map(a => a.instanceId));
    damageToPlayer = attackers.reduce((sum, a) => sum + powerOf(a.card), 0);
    opp.battlefield = opp.battlefield.map(p =>
      attackerIds.has(p.instanceId) ? { ...p, tapped: true } : p,
    );
    logs.push(`${opp.name} attacks with ${attackers.map(a => a.card.name).join(', ')} for ${damageToPlayer}`);
  }

  opp.turnsTaken = input.turnsTaken + 1;
  return { opponent: opp, logs, damageToPlayer, effects };
}
