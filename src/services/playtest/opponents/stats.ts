import type { ScryfallCard } from '@/types';
import { getFrontFaceTypeLine } from '@/services/scryfall/client';
import { isLand, makeInstanceId } from '@/components/playtest/utils';
import {
  BOT_DYNAMIC_STATS,
  costOf,
  graveyardStaticsOf,
  staticsOf,
  type BotStaticSpec,
  type TokenSpec,
} from '@/services/playtest/opponents/effects';
import { keywordsOf, type CombatKeyword } from '@/services/playtest/combat';
import { editedTypeLine } from '@/services/playtest/powerToughness';
import type { Opponent, OpponentPermanent } from '@/components/playtest/opponentTypes';

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

/**
 * Is this permanent a creature as it stands? Reads `typeLineOf`, so a land you
 * animated counts and a Lignified creature still does — the printed type line
 * stopped being the answer the moment edits could rewrite it.
 */
export function isCreaturePermanent(p: OpponentPermanent): boolean {
  return typeLineOf(p).toLowerCase().includes('creature');
}

function hasSubtype(typeLine: string, subtype: string): boolean {
  const line = typeLine.toLowerCase();
  // Every word has to be there: 'zombie token' is a Zombie that is a token,
  // which is how "Zombie tokens you control have flying" is written, and a
  // one-word subtype reads exactly as it always did.
  return subtype.toLowerCase().split(/\s+/).every(word => line.includes(word));
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

/**
 * The until-end-of-turn pump, if one is live — Goreclaw's attack trigger.
 *
 * Additive like a counter rather than replacing anything, which is the whole
 * reason it is not a `CardEdit`: a pumped Lord of Extinction is still sized by
 * the graveyard, it is just a point bigger than that for the turn.
 */
function tempDelta(p: OpponentPermanent, key: 'power' | 'toughness'): number {
  return p.tempBoost?.[key] ?? 0;
}

/**
 * Every anthem currently pumping this permanent, named.
 *
 * Named rather than summed because the player has to be told: a 1/1 attacking
 * as a 3/2 is unblockable-in-practice information, and "+1/+1 from Goblin
 * Chieftain" is the difference between that reading as a rule and reading as a
 * bug. `anthemBonus` is the sum of exactly this list, so the number on screen
 * and its explanation cannot drift apart.
 */
export function anthemSources(
  p: OpponentPermanent,
  battlefield: OpponentPermanent[],
): { name: string; power: number; toughness: number }[] {
  const out: { name: string; power: number; toughness: number }[] = [];
  for (const source of battlefield) {
    for (const spec of staticsOf(source.card.name)) {
      if (spec.kind !== 'anthem') continue;
      // Almost every lord says "OTHER creatures", so a source skips itself.
      if (source.instanceId === p.instanceId && !spec.includeSelf) continue;
      if (spec.subtype && !countsAs(typeLineOf(p), spec.subtype, battlefield)) continue;
      out.push({ name: source.card.name, power: spec.power, toughness: spec.toughness });
    }
  }
  return out;
}

/** What every anthem on the board adds to this one permanent. */
export function anthemBonus(
  p: OpponentPermanent,
  battlefield: OpponentPermanent[],
): { power: number; toughness: number } {
  return anthemSources(p, battlefield).reduce(
    (acc, a) => ({ power: acc.power + a.power, toughness: acc.toughness + a.toughness }),
    { power: 0, toughness: 0 },
  );
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
  const counted =
    spec.kind === 'flat'                  ? 1
    : spec.kind === 'ownGraveyardCreatures' ? graveyard.filter(isCreatureCard).length
    : spec.kind === 'ownGraveyardCards'   ? graveyard.length
    :                                       battlefield.filter(x => isLand(x.card)).length;
  const n = spec.max === undefined ? counted : Math.min(counted, spec.max);
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
    + tempDelta(p, 'power')
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
      + tempDelta(p, 'toughness')
      + anthemBonus(p, battlefield).toughness
      + (p.edit ? 0 : dynamicBonus(p, battlefield, graveyard).toughness),
  );
}

/**
 * The P/T the card itself shows.
 *
 * Deliberately blind to the edit, unlike `baseStat`. An edit is the loudest
 * reason live and printed disagree, so reading the rewrite as if it were
 * printed made a Frogified creature look untouched — `differs` came out false
 * and the badge drew in the plain "nothing to see" black.
 */
function printedPT(p: OpponentPermanent): string {
  const power = p.card.power ?? p.card.card_faces?.[0]?.power ?? '0';
  const toughness = p.card.toughness ?? p.card.card_faces?.[0]?.toughness ?? '0';
  return `${power}/${toughness}`;
}

/**
 * What a bot's creature is right now, against what its card says, and why.
 *
 * The display half of `botPower`/`botToughness`, kept beside them so there is
 * no second opinion about a creature's size. Every caller that draws a bot's
 * creature uses this: a 1/1 Legion Loyalist attacking as a 3/2 because a lord
 * and a Bushwhacker are on the board is a fact you have to be able to see
 * BEFORE you decide what blocks it, and the only place a player looks for a
 * creature's size is the corner of its card.
 *
 * `differs` is a string comparison against the printed text, so a `*` always
 * counts as different — which is the point, since a star is not a size you
 * can block against.
 */
export interface BotPT {
  printed: string;
  live: string;
  differs: boolean;
  /** Which kind of change dominates, for the badge's colour. */
  reason: 'edit' | 'temp' | 'static';
  /** The rewritten type line, when an edit changed it. */
  typeLine: string | null;
  /** One line per thing doing it, for the tooltip. */
  sources: string[];
}

export function botPT(
  p: OpponentPermanent,
  battlefield: OpponentPermanent[],
  graveyard: ScryfallCard[] = [],
): BotPT | null {
  if (!isCreatureCard(p.card) && !p.edit) return null;
  const printed = printedPT(p);
  const live = `${botPower(p, battlefield, graveyard)}/${botToughness(p, battlefield, graveyard)}`;

  const sources: string[] = [];
  if (p.edit) sources.push(`Rewritten as a ${p.edit.power}/${p.edit.toughness}`);
  const counters = counterDelta(p);
  if (counters !== 0) sources.push(`${counters > 0 ? '+' : '−'}${Math.abs(counters)}/${counters > 0 ? '+' : '−'}${Math.abs(counters)} in counters`);
  for (const a of anthemSources(p, battlefield)) {
    sources.push(`${a.name} +${a.power}/+${a.toughness}`);
  }
  if (p.tempBoost) {
    const { power, toughness, keywords } = p.tempBoost;
    const stats = power || toughness ? `+${power}/+${toughness}` : '';
    const gained = keywords?.length ? `${stats ? ' and ' : ''}${keywords.join(', ')}` : '';
    sources.push(`Until end of turn: ${stats}${gained}`);
  }
  if (!p.edit && BOT_DYNAMIC_STATS[p.card.name]) sources.push('Size is read off the board');

  return {
    printed,
    live,
    differs: printed !== live,
    reason: p.edit ? 'edit' : p.tempBoost ? 'temp' : 'static',
    typeLine: editedTypeLine(p.card, p.edit),
    sources,
  };
}

/**
 * Keywords this creature has that its own card does not print.
 *
 * The other half of what a player cannot see. Legion Loyalist's battalion
 * trigger hands first strike to a whole goblin board, and a first striker
 * blocked by something that cannot kill it first takes no damage at all —
 * which, unannounced, reads as the damage maths being broken.
 */
export function grantedKeywords(
  p: OpponentPermanent,
  battlefield: OpponentPermanent[],
  graveyard: ScryfallCard[] = [],
): CombatKeyword[] {
  const printed = keywordsOf(p.card, p.edit);
  return [...botKeywords(p, battlefield, graveyard)].filter(k => !printed.has(k));
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
      if (spec.minPower !== undefined && printedStat(card, 'power') < spec.minPower) continue;
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
  // An until-end-of-turn grant — a kicked Goblin Bushwhacker. The registry
  // comment used to say a temporary haste grant had nowhere to live; `tempBoost`
  // is exactly that place, and the pump spec already writes keywords into it.
  if (p.tempBoost?.haste) return true;
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
  // A pump's keywords come first, and survive `loseAbilities`. Unlike a lord's
  // static — which a Frogified creature simply no longer answers to — this is a
  // one-shot grant that lands AFTER whatever rewrote the creature, so Goreclaw
  // hands trample to a thing that has been turned into a Frog.
  for (const k of p.tempBoost?.keywords ?? []) out.add(k);
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

/**
 * End an until-end-of-turn pump across a seat's whole board.
 *
 * Called when combat resolves rather than at the end of the bot's turn, and the
 * order is the reason: the bot declares its attack and then STOPS, waiting for
 * you to block. Clearing at the end of the turn loop would have taken Goreclaw's
 * +1/+1 off the attackers before you ever saw them, so the trigger would have
 * fired, logged, and changed nothing about the combat it exists for.
 *
 * Returns the seat unchanged when nothing is pumped, so the store's `set` does
 * not churn every board every combat.
 */
export function clearTempBoosts(opp: Opponent): Opponent {
  if (!opp.battlefield.some(p => p.tempBoost)) return opp;
  return {
    ...opp,
    battlefield: opp.battlefield.map(p => (p.tempBoost ? { ...p, tempBoost: undefined } : p)),
  };
}

/** Token counts are multiplied by this. Two doublers make four times as many. */
export function tokenMultiplier(battlefield: OpponentPermanent[]): number {
  const doublers = battlefield.filter(
    p => staticsOf(p.card.name).some(spec => spec.kind === 'tokenDoubler'),
  ).length;
  return 2 ** doublers;
}

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
export const MAX_BOARD = 40;

/**
 * Find a token in the deck's fetched pool. Matched on name first, then on the
 * type line, so a spec asking for a 'Goblin' finds "Goblin" and would also find
 * a differently-named goblin token if a deck ever had one.
 *
 * A miss returns undefined and the token is simply not made. That is the right
 * failure: a Scryfall hiccup should cost the bot a token, not crash its turn.
 */
export function findToken(
  pool: ScryfallCard[],
  name: string,
  want?: { power?: string; toughness?: string; keyword?: string },
): ScryfallCard | undefined {
  const wanted = name.toLowerCase();
  const named = pool.filter(t => t.name.toLowerCase() === wanted);
  const candidates = named.length > 0
    ? named
    : pool.filter(t => getFrontFaceTypeLine(t).toLowerCase().includes(wanted));
  if (candidates.length === 0) return undefined;
  if (!want) return candidates[0];
  // An exact match on what the spec described, falling back to the first of the
  // name rather than nothing: a pool missing the exact token should still make
  // something, the way it did before sizes were part of the match.
  const exact = candidates.find(t =>
    (want.power === undefined || t.power === want.power)
    && (want.toughness === undefined || t.toughness === want.toughness)
    && (want.keyword === undefined
      || (t.keywords ?? []).some(k => k.toLowerCase() === want.keyword!.toLowerCase())),
  );
  return exact ?? candidates[0];
}

/**
 * How many of a token to make. A fixed count, unless the spec counts a subtype
 * already on the board — Krenko makes one goblin per goblin. Either way it is
 * multiplied by any token doublers the bot controls.
 */
export function tokenCount(spec: TokenSpec, battlefield: OpponentPermanent[]): number {
  const base = spec.countPerSubtype
    ? battlefield.filter(p =>
        getFrontFaceTypeLine(p.card).toLowerCase().includes(spec.countPerSubtype!.toLowerCase()),
      ).length
    : spec.count;
  return base * tokenMultiplier(battlefield);
}

/** Tokens a spec would make right now, ready to be put on the board. */
export interface TokenBatch {
  /** New permanents, in arrival order. */
  permanents: OpponentPermanent[];
  /** The card behind each permanent — what the ETB triggers watch arrive. */
  arrivals: ScryfallCard[];
  /** "2 Goblins, Beast" — the log's half of the sentence. */
  parts: string[];
  /**
   * Tokens the board cap refused.
   *
   * Worth saying out loud: a Krenko that makes one goblin instead of twenty-nine
   * reads as a counting bug to anyone watching the log, and the cap is the only
   * reason. Silent truncation cost an auditor a whole pass.
   */
  capped: number;
}

/**
 * Work out a token spec against a bot's board without touching it.
 *
 * Pure so that both sides can use it: the engine pushes the result onto the
 * board it is mutating, and a death trigger folds it into the new opponent it
 * is building. Before this existed only the engine could make tokens, which
 * quietly made every token-making death trigger a no-op — a Mogg War Marshal
 * sacrificed to echo left no goblin behind.
 */
export function makeTokenBatch(
  o: Pick<Opponent, 'tokens' | 'battlefield'>,
  specs: TokenSpec[],
): TokenBatch {
  const batch: TokenBatch = { permanents: [], arrivals: [], parts: [], capped: 0 };
  for (const spec of specs) {
    const card = findToken(o.tokens, spec.name, spec);
    if (!card) continue;
    // Room left under the cap, counting what this batch has already placed, so
    // a doubling engine plateaus instead of running away with the frame rate.
    const room = Math.max(0, MAX_BOARD - o.battlefield.length - batch.permanents.length);
    const wanted = tokenCount(spec, o.battlefield);
    const n = Math.min(wanted, room);
    batch.capped += wanted - n;
    for (let i = 0; i < n; i++) {
      batch.permanents.push(toPermanent(card));
      batch.arrivals.push(card);
    }
    if (n > 0) batch.parts.push(n > 1 ? `${n} ${card.name}s` : card.name);
  }
  return batch;
}

/**
 * Does this card arrive sideways?
 *
 * Read off the oracle text, not a registry: "enters tapped" is on hundreds of
 * cards a bot deck can contain — every Guildgate, Triome, Temple and bounce
 * land, and half the two-and-three-mana rocks — and a per-card list would be
 * out of date the week it was written. Nothing on the bot's side used to read
 * those words at all, so a Worn Powerstone was cast and tapped for two on the
 * same turn.
 *
 * Two things it deliberately gets wrong in the bot's favour:
 *
 *  - "…unless you pay 2 life" / "…unless you control two or more other lands"
 *    reads as untapped. Shocklands, checklands and fast lands are conditional,
 *    and the condition is met more often than not by the turn a bot plays one.
 *  - A clause about OTHER permanents entering tapped is not about this card, so
 *    the subject has to be the card itself — "Worn Powerstone enters tapped" or
 *    the newer "This artifact enters tapped", never Amulet of Vigor's "Whenever
 *    a permanent you control enters tapped".
 */
export function entersTapped(card: ScryfallCard): boolean {
  const text = card.oracle_text ?? card.card_faces?.[0]?.oracle_text ?? '';
  if (!text) return false;
  const self = card.name.split('//')[0].trim().toLowerCase();
  // Clause by clause: a card can say it enters tapped in one sentence and talk
  // about something else entirely in the next.
  for (const clause of text.split(/\n|\.\s+/)) {
    const m = clause.match(/^(.*?)\benters(?: the battlefield)? tapped\b/i);
    if (!m) continue;
    if (/\bunless\b/i.test(clause)) continue;
    const subject = m[1].trim().toLowerCase();
    if (subject === self || /^this\b/.test(subject)) return true;
  }
  return false;
}

/**
 * A card arriving on a bot's battlefield.
 *
 * Shared rather than written out wherever a permanent lands, because the two
 * copies of this that used to exist — one in the engine, one in the death
 * handler — are exactly how a card would come back from the graveyard ignoring
 * a rule the engine had learned.
 */
export function toPermanent(card: ScryfallCard): OpponentPermanent {
  return {
    instanceId: makeInstanceId(),
    card,
    tapped: entersTapped(card),
    // Only creatures care, but tracking it uniformly keeps the attack step simple.
    summoningSick: true,
    counters: {},
    // Set here rather than at each cast site for the same reason as the rest of
    // this function: a Bone Shredder reanimated out of the graveyard rents
    // itself out again, exactly as it did the first time.
    echoDue: echoCostOf(card) !== null,
  };
}

/**
 * The echo cost printed on a card, or null if it has none.
 *
 * Echo is the one upkeep cost in the bot pool that is a real decision — "you
 * rent this creature for a turn" — and skipping it turned every echo card into
 * a permanent the bot got to keep for free. It is read off the card rather
 * than curated because the cost is printed in a fixed shape on every one of
 * them, which is the same reason `keywordsOf` reads `card.keywords`.
 *
 * The keyword gate comes first so nothing else matching the word "echo" in a
 * rules paragraph — a card NAMED Echo of Eons, a reminder line quoting the
 * keyword — is mistaken for one. Pre-errata printings that never spelled the
 * cost out mean "the same as its mana cost", which is what the fallback says.
 */
export function echoCostOf(card: ScryfallCard): string | null {
  if (!(card.keywords ?? []).some(k => k.toLowerCase() === 'echo')) return null;
  const text = card.oracle_text ?? card.card_faces?.[0]?.oracle_text ?? '';
  const match = text.match(/Echo\s+((?:\{[^}]+\})+)/);
  if (match) return match[1];
  return (card.mana_cost ?? card.card_faces?.[0]?.mana_cost ?? '') || null;
}
