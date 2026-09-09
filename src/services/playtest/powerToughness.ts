import { isDoubleFacedCard } from '@/services/scryfall/client';
import type { BattlefieldCard, CardEdit } from '@/components/playtest/types';

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
