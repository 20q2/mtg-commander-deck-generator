import type { ScryfallCard } from '@/types';
import { getFrontFaceTypeLine } from '@/services/scryfall/client';
import { isLand, makeInstanceId } from '@/components/playtest/utils';
import type { Opponent, OpponentPermanent, TurnResult } from '@/components/playtest/opponentTypes';

/**
 * The bot turn loop. Pure: it takes an opponent and returns the next one plus
 * what happened, so the store stays a thin applier and this stays testable.
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

function powerOf(card: ScryfallCard): number {
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
  };
}

export function takeTurn(input: Opponent): TurnResult {
  const logs: string[] = [];
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

  // ── Cast ──
  // Available mana is just the land count; everything untapped at this point.
  const mana = opp.battlefield.filter(p => isLand(p.card)).length;
  let bestIdx = -1;
  let bestCmc = -1;
  opp.hand.forEach((card, i) => {
    if (isLand(card) || !isPermanent(card)) return;
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
    const names = attackers.map(a => a.card.name).join(', ');
    logs.push(`${opp.name} attacks with ${names} for ${damageToPlayer}`);
  }

  return { opponent: opp, logs, damageToPlayer };
}
