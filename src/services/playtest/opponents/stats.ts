import type { ScryfallCard } from '@/types';
import { getFrontFaceTypeLine } from '@/services/scryfall/client';
import { isLand } from '@/components/playtest/utils';
import {
  BOT_DYNAMIC_STATS,
  costOf,
  graveyardStaticsOf,
  staticsOf,
  type BotStaticSpec,
} from '@/services/playtest/opponents/effects';
import { keywordsOf, type CombatKeyword } from '@/services/playtest/combat';
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

/**
 * The type line to judge a permanent by — the edited one when it has been
 * rewritten, so a Lignified creature stops answering to Goblin lords and starts
 * answering to Treefolk ones.
 */
export function typeLineOf(p: OpponentPermanent): string {
  return p.edit?.typeLine ?? getFrontFaceTypeLine(p.card);
}

function hasSubtype(typeLine: string, subtype: string): boolean {
  return typeLine.toLowerCase().includes(subtype.toLowerCase());
}

/** Is a Maskwood Nexus out, making every subtype test pass? */
function everyTypeActive(battlefield: OpponentPermanent[]): boolean {
  return battlefield.some(p =>
    staticsOf(p.card.name).some(spec => spec.kind === 'allCreatureTypes'),
  );
}

/**
 * Does this creature count as `subtype` right now? Normally a type-line test,
 * but a "creatures you control are every creature type" effect makes it always
 * true — which is the whole reason that card is in a tribal deck.
 */
function countsAs(
  typeLine: string,
  subtype: string,
  battlefield: OpponentPermanent[],
): boolean {
  return hasSubtype(typeLine, subtype) || everyTypeActive(battlefield);
}

/** The stat to build from: the edit's if it has one, otherwise what's printed. */
function baseStat(p: OpponentPermanent, key: 'power' | 'toughness'): number {
  return p.edit ? p.edit[key] : printedStat(p.card, key);
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
    for (const spec of staticsOf(source.card.name)) {
      if (spec.kind !== 'anthem') continue;
      // Almost every lord says "OTHER creatures", so a source skips itself.
      if (source.instanceId === p.instanceId && !spec.includeSelf) continue;
      if (spec.subtype && !countsAs(typeLineOf(p), spec.subtype, battlefield)) continue;
      power += spec.power;
      toughness += spec.toughness;
    }
  }
  return { power, toughness };
}

/**
 * What a `*` in the printed stats is actually worth right now.
 *
 * `graveyard` is optional so the many callers that do not care need not thread
 * it through, but the three that decide combat — the engine, the store and the
 * combat preview — all have it and all pass it.
 */
function dynamicBonus(
  p: OpponentPermanent,
  battlefield: OpponentPermanent[],
  graveyard: ScryfallCard[],
): { power: number; toughness: number } {
  const spec = BOT_DYNAMIC_STATS[p.card.name];
  if (!spec) return { power: 0, toughness: 0 };
  const n =
    spec.kind === 'ownGraveyardCreatures' ? graveyard.filter(isCreatureCard).length
    : spec.kind === 'ownGraveyardCards'   ? graveyard.length
    :                                       battlefield.filter(x => isLand(x.card)).length;
  return { power: spec.power * n, toughness: spec.toughness * n };
}

/** Power as it stands: printed, plus counters, plus anthems, plus any `*`. */
export function botPower(
  p: OpponentPermanent,
  battlefield: OpponentPermanent[],
  graveyard: ScryfallCard[] = [],
): number {
  return baseStat(p, 'power')
    + counterDelta(p)
    + anthemBonus(p, battlefield).power
    // An edit replaces a characteristic-defining `*` outright, so there's
    // nothing left for the graveyard/land count to define.
    + (p.edit ? 0 : dynamicBonus(p, battlefield, graveyard).power);
}

/** Toughness as it stands. Never below 0 — nothing has negative toughness on screen. */
export function botToughness(
  p: OpponentPermanent,
  battlefield: OpponentPermanent[],
  graveyard: ScryfallCard[] = [],
): number {
  return Math.max(
    0,
    baseStat(p, 'toughness')
      + counterDelta(p)
      + anthemBonus(p, battlefield).toughness
      + (p.edit ? 0 : dynamicBonus(p, battlefield, graveyard).toughness),
  );
}

/**
 * What this card costs the bot with its board as it stands.
 *
 * Always use this rather than `costOf` at a cast site: a deck built around its
 * cost reducer curves out a whole turn behind without it.
 */
export function effectiveCost(card: ScryfallCard, battlefield: OpponentPermanent[]): number {
  let reduction = 0;
  for (const source of battlefield) {
    for (const spec of staticsOf(source.card.name)) {
      if (spec.kind !== 'costReducer') continue;
      if (spec.subtype && !countsAs(getFrontFaceTypeLine(card), spec.subtype, battlefield)) continue;
      reduction += spec.amount;
    }
  }
  // A reducer never makes a spell free-er than free.
  return Math.max(0, costOf(card) - reduction);
}

/**
 * Can this creature attack the turn it arrived?
 *
 * The attack step skipped every summoning-sick creature, which meant a card
 * printed WITH haste could not attack the turn it landed — the keyword was read
 * for combat maths and ignored for the one thing it exists to do.
 */
export function hasHaste(p: OpponentPermanent, battlefield: OpponentPermanent[]): boolean {
  // Read off the raw card, not through `keywordsOf`: that narrows to the
  // keywords the damage maths cares about, and haste is not one of them.
  // A creature stripped of its abilities has no printed haste to read.
  if (!p.edit?.loseAbilities && (p.card.keywords ?? []).some(k => k.toLowerCase() === 'haste')) return true;
  return battlefield.some(source => staticsOf(source.card.name).some(spec =>
    spec.kind === 'grantsHaste' && (!spec.subtype || countsAs(typeLineOf(p), spec.subtype, battlefield)),
  ));
}

/**
 * The combat keywords a bot's creature has, printed ones plus anything its
 * controller's board or graveyard is granting.
 *
 * Use this instead of `keywordsOf` for anything on a bot's side. `keywordsOf`
 * reads one card in isolation, which is right for the player — nothing on the
 * player's side grants keywords — and wrong for a bot with a Wonder in the
 * yard, where the grant is the reason the deck wins.
 */
export function botKeywords(
  p: OpponentPermanent,
  battlefield: OpponentPermanent[],
  graveyard: ScryfallCard[] = [],
): Set<CombatKeyword> {
  const out = keywordsOf(p.card, p.edit);
  // A creature stripped of its abilities can't be granted them back by a lord.
  if (p.edit?.loseAbilities) return out;
  const grant = (spec: BotStaticSpec) => {
    if (spec.kind !== 'grantsKeyword') return;
    if (spec.subtype && !countsAs(typeLineOf(p), spec.subtype, battlefield)) return;
    out.add(spec.keyword);
  };
  for (const source of battlefield) staticsOf(source.card.name).forEach(grant);
  // The graveyard half is the whole point of Wonder: it works while dead.
  for (const card of graveyard) graveyardStaticsOf(card.name).forEach(grant);
  return out;
}

/**
 * Would this creature arrive as a 0/0 — a card no player would ever cast?
 *
 * Some creatures are printed 0/0 because something else defines their size:
 * Vizier of Many Faces enters as a copy of something, an Army grows on
 * counters. When the bot has no guidance for that card, the copy never happens
 * and it lands as a literal 0/0 — and since there are no state-based actions
 * here, nothing kills it. It sits on the board for the rest of the game
 * attacking for nothing, which reads as a bot that cannot count.
 *
 * A general rule rather than a per-card exclusion, because the shape recurs:
 * any unauthored 0/0 is a card the bot is better off holding. Anthems already
 * on the board count, so a lord genuinely does make it castable.
 */
export function arrivesDead(
  card: ScryfallCard,
  battlefield: OpponentPermanent[],
  graveyard: ScryfallCard[] = [],
): boolean {
  if (!isCreatureCard(card)) return false;
  // A `*` is a real size the registry defines; only a printed 0 is a problem.
  if (printedStat(card, 'toughness') > 0) return false;
  if (BOT_DYNAMIC_STATS[card.name]) return false;
  const arriving: OpponentPermanent = {
    instanceId: '__probe__', card, tapped: false, summoningSick: true, counters: {},
  };
  return botToughness(arriving, [...battlefield, arriving], graveyard) <= 0;
}

/** Token counts are multiplied by this. Two doublers make four times as many. */
export function tokenMultiplier(battlefield: OpponentPermanent[]): number {
  const doublers = battlefield.filter(
    p => staticsOf(p.card.name).some(spec => spec.kind === 'tokenDoubler'),
  ).length;
  return 2 ** doublers;
}
