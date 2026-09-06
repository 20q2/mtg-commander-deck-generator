import type { ScryfallCard } from '@/types';
import { getFrontFaceTypeLine } from '@/services/scryfall/client';
import { BOT_STATICS } from '@/services/playtest/opponents/effects';
import type { OpponentPermanent } from '@/components/playtest/opponentTypes';

/**
 * Power, toughness and type questions about a bot's permanents.
 *
 * This exists because the answer is not a property of the card: it depends on
 * the counters on that permanent and on what else the bot controls. The engine,
 * the store and the combat strip all have to agree, and the only way to be sure
 * of that is one implementation none of them owns.
 */

export function isCreatureCard(card: ScryfallCard): boolean {
  return getFrontFaceTypeLine(card).toLowerCase().includes('creature');
}

export function isPermanentCard(card: ScryfallCard): boolean {
  const t = getFrontFaceTypeLine(card).toLowerCase();
  return (
    t.includes('creature') ||
    t.includes('artifact') ||
    t.includes('enchantment') ||
    t.includes('planeswalker')
  );
}

/** Scryfall token cards read "Token Creature — Goblin". Nothing else says Token. */
export function isTokenCard(card: ScryfallCard): boolean {
  return getFrontFaceTypeLine(card).toLowerCase().includes('token');
}

/** A printed stat as a number. Missing values and `*` both read as 0. */
export function printedStat(card: ScryfallCard, key: 'power' | 'toughness'): number {
  const raw = card[key] ?? card.card_faces?.[0]?.[key];
  const n = parseInt(raw ?? '', 10);
  return Number.isNaN(n) ? 0 : n;
}

function hasSubtype(card: ScryfallCard, subtype: string): boolean {
  return getFrontFaceTypeLine(card).toLowerCase().includes(subtype.toLowerCase());
}

/** Net +1/+1 counters, since -1/-1 counters cancel them out. */
function counterDelta(p: OpponentPermanent): number {
  return (p.counters['+1/+1'] ?? 0) - (p.counters['-1/-1'] ?? 0);
}

/** What every anthem on the board adds to this one permanent. */
export function anthemBonus(
  p: OpponentPermanent,
  battlefield: OpponentPermanent[],
): { power: number; toughness: number } {
  let power = 0;
  let toughness = 0;
  for (const source of battlefield) {
    const spec = BOT_STATICS[source.card.name];
    if (!spec || spec.kind !== 'anthem') continue;
    // Almost every lord says "OTHER creatures", so a source skips itself.
    if (source.instanceId === p.instanceId && !spec.includeSelf) continue;
    if (spec.subtype && !hasSubtype(p.card, spec.subtype)) continue;
    power += spec.power;
    toughness += spec.toughness;
  }
  return { power, toughness };
}

/** Power as it stands: printed, plus counters, plus anthems. */
export function botPower(p: OpponentPermanent, battlefield: OpponentPermanent[]): number {
  return printedStat(p.card, 'power') + counterDelta(p) + anthemBonus(p, battlefield).power;
}

/** Toughness as it stands. Never below 0 — nothing has negative toughness on screen. */
export function botToughness(p: OpponentPermanent, battlefield: OpponentPermanent[]): number {
  return Math.max(
    0,
    printedStat(p.card, 'toughness') + counterDelta(p) + anthemBonus(p, battlefield).toughness,
  );
}

/** Token counts are multiplied by this. Two doublers make four times as many. */
export function tokenMultiplier(battlefield: OpponentPermanent[]): number {
  const doublers = battlefield.filter(
    p => BOT_STATICS[p.card.name]?.kind === 'tokenDoubler',
  ).length;
  return 2 ** doublers;
}
