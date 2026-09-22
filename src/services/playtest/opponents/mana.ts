import type { ScryfallCard } from '@/types';
import { getFrontFaceTypeLine } from '@/services/scryfall/client';
import { isLand } from '@/components/playtest/utils';
import { isCreatureCard } from '@/services/playtest/opponents/stats';
import type { OpponentPermanent } from '@/components/playtest/opponentTypes';

/**
 * What a bot can pay for, and which permanents it taps to do it.
 *
 * This used to be a single number — "lands on the battlefield" — with colours
 * ignored on the grounds that colour correctness turns a goldfish into a rules
 * engine. It does not: a bot's mana base is a handful of permanents and a spell
 * has a handful of pips, so a greedy assignment settles it. The number-only
 * version was visible at the table, because the tap animation showed a Dimir
 * bot turning two Islands sideways to cast a black spell.
 *
 * What is still approximate, deliberately:
 *  - A source produces `amount` mana of ANY colour it can make, so "{T}: Add
 *    {U}{B}" reads as two mana that are each U or B rather than one of each.
 *  - Activated, cycling and recursion costs in the registry are plain numbers,
 *    so those are paid as generic. Only cards cast from hand or the command
 *    zone — which have a real `mana_cost` — are colour-checked.
 *  - A land that makes no mana at all still taps for one colourless, which is
 *    what it did before and keeps a Maze of Ith from stranding the bot.
 */

type ManaLetter = 'W' | 'U' | 'B' | 'R' | 'G' | 'C';

const BIT: Record<ManaLetter, number> = { W: 1, U: 2, B: 4, R: 8, G: 16, C: 32 };
/** "Add one mana of any colour" never includes colourless. */
const ANY_COLOR = BIT.W | BIT.U | BIT.B | BIT.R | BIT.G;

const BASIC_TYPES: Array<[string, ManaLetter]> = [
  ['plains', 'W'], ['island', 'U'], ['swamp', 'B'], ['mountain', 'R'], ['forest', 'G'],
];

function popcount(mask: number): number {
  let n = 0;
  for (let m = mask; m; m &= m - 1) n++;
  return n;
}

function maskOfLetters(letters: string[]): number {
  let mask = 0;
  for (const letter of letters) mask |= BIT[letter.toUpperCase() as ManaLetter] ?? 0;
  return mask;
}

/** A spell's cost split into the part any mana pays and the pips that aren't. */
export interface ManaRequirement {
  generic: number;
  /** One entry per coloured pip; the bitmask of colours that can pay it. */
  pips: number[];
}

/** The front face's cost. A split card's second half is not what's being cast. */
function frontManaCost(card: ScryfallCard): string {
  return (card.mana_cost ?? card.card_faces?.[0]?.mana_cost ?? '').split('//')[0];
}

/**
 * The coloured pips in a printed mana cost.
 *
 * Everything a bot can always pay counts as generic and is left out: {X} is
 * zero, phyrexian is two life, and the generic half of a {2/W} is never the
 * reason a spell is uncastable.
 */
export function pipsOf(card: ScryfallCard): number[] {
  const out: number[] = [];
  for (const token of frontManaCost(card).match(/\{[^}]+\}/g) ?? []) {
    const body = token.slice(1, -1).toUpperCase();
    if (/^\d+$/.test(body) || body === 'X' || body === 'Y' || body === 'Z' || body === 'S') continue;
    if (body.includes('/')) {
      const parts = body.split('/');
      if (parts.includes('P') || parts.some(p => /^\d+$/.test(p))) continue;
      const mask = maskOfLetters(parts);
      if (mask) out.push(mask);
      continue;
    }
    const bit = BIT[body as ManaLetter];
    if (bit) out.push(bit);
  }
  return out;
}

/** The colours devotion can be counted to. */
export type DevotionColor = 'W' | 'U' | 'B' | 'R' | 'G';

/**
 * Devotion to `color` — every mana symbol of that colour in the mana costs of
 * the permanents you control. A lone Gray Merchant is devotion 2 off its own
 * {3}{B}{B}, which is why the source has to be counted alongside the board.
 *
 * Deliberately not `pipsOf`. That one answers "what must the bot tap for", so
 * it drops the halves a bot can always pay some other way — phyrexian, and the
 * generic side of a {2/B}. Devotion counts both: a {B/P} printed on a permanent
 * is still a black mana symbol sitting on the battlefield. A hybrid {B/G}
 * counts once for black and once for green, which falls out of checking each
 * symbol per colour.
 */
export function devotionTo(cards: ScryfallCard[], color: DevotionColor): number {
  let n = 0;
  for (const card of cards) {
    for (const token of frontManaCost(card).match(/\{[^}]+\}/g) ?? []) {
      if (token.slice(1, -1).toUpperCase().split('/').includes(color)) n++;
    }
  }
  return n;
}

/**
 * What `card` demands when the bot is paying `total` for it.
 *
 * `total` comes from `effectiveCost` plus any commander tax, so cost reducers
 * and tax both land in the generic half — which is where they belong, since
 * neither can reduce a coloured pip. A reducer deep enough to undercut the pips
 * drops them, on the grounds that a registry cost override is a statement about
 * what the card costs and the printed pips are the thing being overridden.
 */
export function requirementFor(card: ScryfallCard, total: number): ManaRequirement {
  const pips = pipsOf(card).slice(0, total);
  return { generic: Math.max(0, total - pips.length), pips };
}

/** A cost with no colour requirement — registry abilities, cycling, recursion. */
export function genericCost(amount: number): ManaRequirement {
  return { generic: amount, pips: [] };
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
  const genericCostPart = (m[1] ?? '').match(/\{(\d+)\}/);
  const spent = genericCostPart ? parseInt(genericCostPart[1], 10) : 0;
  return Math.max(0, produced - spent);
}

/** How much mana this permanent can make right now. */
export function manaFrom(p: OpponentPermanent): number {
  if (p.tapped) return 0;
  if (isLand(p.card)) return 1;
  if ((p.card.produced_mana?.length ?? 0) === 0) return 0;
  // A mana creature can't tap the turn it arrives.
  if (isCreatureCard(p.card) && p.summoningSick) return 0;
  return netManaFromText(p.card.oracle_text ?? '');
}

/**
 * Which colours a source can make.
 *
 * `produced_mana` is the answer whenever Scryfall gives one. The fallbacks are
 * for card data that has been trimmed — test fixtures especially — where a
 * Mountain would otherwise read as colourless and a red deck would sit on its
 * hand for twelve turns.
 */
export function producesMask(card: ScryfallCard): number {
  const produced = maskOfLetters(card.produced_mana ?? []);
  if (produced) return produced;

  const typeLine = getFrontFaceTypeLine(card).toLowerCase();
  let fromTypes = 0;
  for (const [subtype, letter] of BASIC_TYPES) {
    if (typeLine.includes(subtype)) fromTypes |= BIT[letter];
  }
  if (fromTypes) return fromTypes;

  const add = (card.oracle_text ?? '').match(/\{t\}[^:]*:\s*add\s+([^.\n]*)/i);
  if (add) {
    if (/any color/i.test(add[1])) return ANY_COLOR;
    const fromText = maskOfLetters((add[1].match(/\{([WUBRGC])\}/gi) ?? []).map(s => s[1]));
    if (fromText) return fromText;
  }
  return BIT.C;
}

interface Source {
  index: number;
  amount: number;
  mask: number;
  /** Tapping a creature costs an attacker, so it goes last. */
  priority: number;
}

function sourcesOf(battlefield: OpponentPermanent[]): Source[] {
  const out: Source[] = [];
  battlefield.forEach((p, index) => {
    const amount = manaFrom(p);
    if (amount <= 0) return;
    out.push({
      index,
      amount,
      mask: producesMask(p.card),
      priority: isLand(p.card) ? 0 : isCreatureCard(p.card) ? 2 : 1,
    });
  });
  return out;
}

export interface ManaPlan {
  /** Can the bot actually pay this? */
  paid: boolean;
  /** Battlefield indices to tap. Meaningful even when `paid` is false: the
   *  generic-only callers tap what they can, which is what they did before. */
  taps: number[];
}

/**
 * Work out which permanents to tap for `req`.
 *
 * Greedy, in the order that makes greed right here: the scarcest pip picks
 * first, and it picks the least flexible source that can pay it — so the
 * Swamp goes to the {B} and the Command Tower stays up for whatever else the
 * turn needs. Leftovers from a multi-mana source float and pay the generic.
 */
export function planPayment(
  battlefield: OpponentPermanent[],
  req: ManaRequirement,
): ManaPlan {
  const untapped = sourcesOf(battlefield);
  const taps: number[] = [];
  /** Mana already produced and unspent, as the colours it could still be. */
  const floating: number[] = [];
  let paid = true;

  const canPay = (mask: number) => untapped.filter(s => (s.mask & mask) !== 0).length;
  const pips = [...req.pips].sort((a, b) => canPay(a) - canPay(b) || popcount(a) - popcount(b));

  for (const pip of pips) {
    const held = floating.findIndex(m => (m & pip) !== 0);
    if (held >= 0) {
      floating.splice(held, 1);
      continue;
    }
    const options = untapped
      .filter(s => (s.mask & pip) !== 0)
      .sort((a, b) => a.priority - b.priority || popcount(a.mask) - popcount(b.mask) || a.amount - b.amount);
    if (options.length === 0) {
      paid = false;
      continue;
    }
    const pick = options[0];
    untapped.splice(untapped.indexOf(pick), 1);
    taps.push(pick.index);
    for (let i = 1; i < pick.amount; i++) floating.push(pick.mask);
  }

  let generic = req.generic;
  while (generic > 0 && floating.length > 0) {
    floating.pop();
    generic--;
  }
  const rest = [...untapped].sort(
    (a, b) => a.priority - b.priority || popcount(a.mask) - popcount(b.mask),
  );
  for (const source of rest) {
    if (generic <= 0) break;
    taps.push(source.index);
    generic -= source.amount;
  }
  return { paid: paid && generic <= 0, taps };
}

/** Turn the permanents a plan named sideways. */
export function applyTaps(
  battlefield: OpponentPermanent[],
  taps: number[],
): OpponentPermanent[] {
  if (taps.length === 0) return battlefield;
  const tapped = new Set(taps);
  return battlefield.map((p, i) => (tapped.has(i) ? { ...p, tapped: true } : p));
}
