import { getFrontFaceTypeLine, isDoubleFacedCard } from '@/services/scryfall/client';
import type { BattlefieldCard, CardEdit } from '@/components/playtest/types';
import type { ScryfallCard } from '@/types';

/** A sticker written as "8/8" (or "-1/-1") replaces the printed P/T entirely. */
const PT_STICKER = /^\s*(-?\d+)\s*\/\s*(-?\d+)\s*$/;

export interface ResolvedPT {
  /** Printed values, or the edit / sticker override if one is present. */
  base: string;
  /** Base with +1/+1 and -1/-1 counters applied. */
  modified: string;
  /** True when an edit or a text sticker replaced the printed values. */
  overridden: boolean;
  /** True specifically for a CardEdit — the amber pill is only for those. */
  edited: boolean;
}

/** Printed P/T for whichever face is currently showing. */
function printedPT(card: BattlefieldCard): { power: string; toughness: string } | null {
  const c = card.card;
  const backFace = card.flipped && isDoubleFacedCard(c) ? c.card_faces?.[1] : undefined;
  const power = backFace?.power ?? c.power ?? c.card_faces?.[0]?.power;
  const toughness = backFace?.toughness ?? c.toughness ?? c.card_faces?.[0]?.toughness;
  if (power === undefined || toughness === undefined) return null;
  return { power, toughness };
}

/**
 * Apply a counter delta to one half of a P/T. Characteristic-defining values like
 * "*" can't be added to, so they render as "*+2" rather than guessing a number.
 */
function applyDelta(value: string, delta: number): string {
  const n = parseInt(value, 10);
  if (Number.isNaN(n)) {
    if (delta === 0) return value;
    return `${value}${delta > 0 ? '+' : ''}${delta}`;
  }
  return String(n + delta);
}

/**
 * Displayed power/toughness for a battlefield card, or null for cards that have
 * none (lands, instants, most artifacts). Pure — no store or DOM access.
 */
export function resolvePT(card: BattlefieldCard): ResolvedPT | null {
  const override = (card.stickers ?? [])
    .map(s => s.text.match(PT_STICKER))
    .find((m): m is RegExpMatchArray => m !== null);

  let basePower: string;
  let baseToughness: string;
  // An edit outranks a sticker: it's the deliberate, structured version of the
  // same idea, so if both are present the dialog wins over the scribble.
  if (card.edit) {
    basePower = String(card.edit.power);
    baseToughness = String(card.edit.toughness);
  } else if (override) {
    basePower = override[1];
    baseToughness = override[2];
  } else {
    const printed = printedPT(card);
    if (!printed) return null;
    basePower = printed.power;
    baseToughness = printed.toughness;
  }

  const delta = (card.counters['+1/+1'] ?? 0) - (card.counters['-1/-1'] ?? 0);

  return {
    base: `${basePower}/${baseToughness}`,
    modified: `${applyDelta(basePower, delta)}/${applyDelta(baseToughness, delta)}`,
    overridden: !!override || !!card.edit,
    edited: !!card.edit,
  };
}

/**
 * The type line an edit has actually rewritten, or null if it left it alone.
 *
 * The rule both sides of the table draw the amber type bar from, because the
 * edit dialog seeds its field with the card's own type line: an edit that only
 * moved the numbers still carries a `typeLine`, and painting "Creature —
 * Goblin Soldier" over "Creature — Goblin Soldier" is an alarm about nothing.
 */
export function editedTypeLine(card: ScryfallCard, edit?: CardEdit): string | null {
  const next = edit?.typeLine?.trim();
  if (!next) return null;
  return next === getFrontFaceTypeLine(card).trim() ? null : next;
}

/**
 * The log line for an edit landing or being cleared. Both sides of the table
 * write it, so neither owns the wording.
 */
export function describeEdit(cardName: string, edit: CardEdit | null): string {
  if (!edit) return `${cardName} is itself again`;
  // "0/4 Treefolk" reads better than "0/4 Creature — Treefolk"; the subtypes
  // after the dash are the interesting half.
  const subtypes = edit.typeLine?.split('—').pop()?.trim();
  const body = subtypes ? `a ${edit.power}/${edit.toughness} ${subtypes}` : `a ${edit.power}/${edit.toughness}`;
  return `${cardName} is ${body}${edit.loseAbilities ? ' with no abilities' : ''}`;
}

/**
 * The type line a permanent answers to right now, rather than the one it was
 * printed with: the edit's rewrite if it has one, otherwise the face that is
 * currently showing.
 *
 * The player-side twin of `typeLineOf` on the bots' side. It exists because
 * every "is this a creature" gate on your half of the table was asking
 * `getFrontFaceTypeLine(card.card)` — so a Mutavault you had animated, or a
 * Westvale Abbey you had flipped into Ormendahl, was still a land to the
 * context menu, the attack arrow and the blocker check, while `resolvePT` and
 * the bots' read of your board had already moved on.
 */
export function liveTypeLine(card: BattlefieldCard): string {
  const edited = card.edit?.typeLine?.trim();
  if (edited) return edited;
  const c = card.card;
  if (card.flipped && isDoubleFacedCard(c)) {
    return c.card_faces?.[1]?.type_line ?? getFrontFaceTypeLine(c);
  }
  return getFrontFaceTypeLine(c);
}

/** Is this permanent a creature as it stands? The only question combat should ask. */
export function isCreatureNow(card: BattlefieldCard): boolean {
  return liveTypeLine(card).toLowerCase().includes('creature');
}

/**
 * The same type line with `Creature` added to it — what a land becomes when you
 * animate it. Seeds the edit dialog so "make this a creature" is a power and a
 * toughness rather than retyping the whole line.
 *
 * Supertypes and the subtypes after the dash are both kept, because a Forest
 * that stopped being a Forest would stop making green mana, and the amber type
 * bar is the only place you'd notice.
 */
export function animatedTypeLine(typeLine: string): string {
  if (typeLine.toLowerCase().includes('creature')) return typeLine;
  const dash = typeLine.indexOf('—');
  if (dash === -1) return `${typeLine.trim()} Creature`;
  return `${typeLine.slice(0, dash).trim()} Creature ${typeLine.slice(dash)}`;
}

/**
 * The card types the edit dialog lets you toggle — the five that can sit on a
 * permanent, in the order a type line prints them when a card has several.
 *
 * Instant and Sorcery are deliberately absent: nothing on the battlefield is
 * one, and the bots' read of your board only asks these five questions.
 */
export const EDITABLE_CARD_TYPES = ['Artifact', 'Creature', 'Enchantment', 'Land', 'Planeswalker'] as const;

export type EditableCardType = typeof EDITABLE_CARD_TYPES[number];

export interface ParsedTypeLine {
  /**
   * Words before the dash that aren't one of the five — supertypes (Legendary,
   * Basic, Snow) and Token. Kept verbatim and in place, because a Forest that
   * stopped being Basic stops making mana and a token that stopped saying Token
   * stops answering to "Zombie tokens you control get +1/+1".
   */
  others: string[];
  /** The toggleable types, in the order the line printed them. */
  types: EditableCardType[];
  /** Everything after the dash, as typed. */
  subtypes: string;
}

/**
 * Split a type line into the parts the edit dialog manipulates. An en dash or a
 * spaced hyphen is accepted alongside Scryfall's em dash, because the field used
 * to be free text and old edits were typed by hand.
 */
export function parseTypeLine(typeLine: string): ParsedTypeLine {
  const normalized = typeLine.replace(/\s-\s/g, ' — ');
  const dash = normalized.search(/[—–]/);
  const head = dash === -1 ? normalized : normalized.slice(0, dash);
  const subtypes = dash === -1 ? '' : normalized.slice(dash + 1).trim();

  const types: EditableCardType[] = [];
  const others: string[] = [];
  for (const word of head.trim().split(/\s+/).filter(Boolean)) {
    const hit = EDITABLE_CARD_TYPES.find(t => t.toLowerCase() === word.toLowerCase());
    if (hit) types.push(hit);
    else others.push(word);
  }
  return { others, types, subtypes };
}

/**
 * The inverse of `parseTypeLine`. Round-trips a line it didn't change, so an
 * edit that only moved the numbers doesn't read as a type rewrite to
 * `editedTypeLine` and light the amber bar over nothing.
 */
export function composeTypeLine({ others, types, subtypes }: ParsedTypeLine): string {
  const head = [...others, ...types].join(' ').trim();
  const tail = subtypes.trim();
  if (!head) return tail;
  return tail ? `${head} — ${tail}` : head;
}
