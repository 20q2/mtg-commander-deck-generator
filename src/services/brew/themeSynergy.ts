import type { ScryfallCard } from '@/types';
import type { RoleKey } from '@/services/tagger/client';
import { themeKindMatches, type ThemeKind } from './themeKind';

/**
 * A theme the deck is leaning into, resolved to its concrete kind — the input the synergy detectors
 * key off. `singular` is the Scryfall creature type / mechanic key ("elf"); `label` is the display
 * name, usually plural ("Elves"). Archetype themes carry no concrete attribute, so most detectors
 * skip them (there's nothing literal in the oracle text to match against).
 */
export interface LeaningTheme {
  slug: string;
  label: string;
  singular: string;
  kind: ThemeKind;
}

/**
 * A functional card whose ROLE fits the deck specifically because of a leaning theme: a board wipe
 * that spares your tribe, ramp or draw keyed to it. This is the "why this answer" — the sharpest
 * reason a removal/ramp/draw card belongs, versus a generic staple.
 */
export interface ThemeSynergy {
  role: RoleKey;   // the functional role the card fills
  slug: string;    // the leaning theme it synergizes with
  label: string;   // reason-chip text ("Spares your Elves")
}

function oracleTextOf(card: ScryfallCard): string {
  return (card.oracle_text ?? (card.card_faces ?? []).map(f => f.oracle_text ?? '').join('\n')).toLowerCase();
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Word alternation ("elf"/"elves") for a tribal theme's type; [] for non-tribal themes. */
function typeWords(lt: LeaningTheme): string[] {
  if (lt.kind.kind !== 'tribal') return [];
  return [...new Set([lt.singular.toLowerCase(), lt.label.toLowerCase()])].filter(Boolean);
}

/** A regex-safe alternation of a tribe's word forms, e.g. `(?:elf|elves)`. */
function typeAlt(words: string[]): string {
  return `(?:${words.map(esc).join('|')})`;
}

/**
 * Detect a functional synergy between this card and one of the deck's leaning themes. Priority order
 * mirrors payoff: a tribe-sparing board wipe (the flagship "aha") first, then one-sided wipes, then
 * theme-tied ramp, then theme-tied draw. Returns the first (strongest) hit, or undefined when the
 * card is a generic answer or nothing is leaning. Best-effort oracle-text matching — a miss just
 * degrades to the pre-synergy behavior (a plain role card), never a wrong claim.
 */
export function detectThemeSynergy(
  card: ScryfallCard, role: RoleKey | null | undefined, leaning: LeaningTheme[],
): ThemeSynergy | undefined {
  if (leaning.length === 0) return undefined;
  const text = oracleTextOf(card);
  const tribal = leaning.filter(lt => lt.kind.kind === 'tribal');

  // 1. Tribe-sparing board wipe — sweeps the table but leaves your creature type standing.
  //    "destroy all non-Elf creatures" / "non-Elf creatures get -3/-3".
  for (const lt of tribal) {
    const T = typeAlt(typeWords(lt));
    const sweepAround = new RegExp(`(?:destroy|exile)[^.\\n]*\\bnon[- ]?${T}\\b`);
    const shrinkAround = new RegExp(`\\bnon[- ]?${T}\\b[^.\\n]*gets?\\s+[-−]\\d`);
    if (sweepAround.test(text) || shrinkAround.test(text)) {
      return { role: 'boardwipe', slug: lt.slug, label: `Spares your ${lt.label}` };
    }
  }
  // 1b. One-sided wipe — hits only what you DON'T control, so your whole board survives. Only worth
  //     surfacing when the deck leans a creature tribe (a go-wide board is what makes it a blowout).
  if (tribal.length) {
    const oneSided = /(?:destroy|exile)[^.\n]*creatures?\s+(?:you don['’]t control|your opponents control)|creatures?\s+(?:you don['’]t control|your opponents control)[^.\n]*gets?\s+[-−]\d/;
    if (oneSided.test(text)) {
      return { role: 'boardwipe', slug: tribal[0].slug, label: 'Spares your board' };
    }
  }
  // 2. Theme-tied ramp — an on-tribe mana dork (ramps AND triggers your tribe) or mana keyed to it.
  if (role === 'ramp') {
    for (const lt of leaning) {
      if (rampSynergy(card, text, lt)) return { role: 'ramp', slug: lt.slug, label: `Ramps your ${lt.label}` };
    }
  }
  // 3. Theme-tied draw — card advantage keyed to the theme ("whenever an Elf enters… draw").
  if (role === 'cardDraw') {
    for (const lt of leaning) {
      if (drawSynergy(text, lt)) return { role: 'cardDraw', slug: lt.slug, label: `Draws off your ${lt.label}` };
    }
  }
  return undefined;
}

/** Ramp that specifically reinforces the theme: an on-mechanic/on-tribe producer, or mana per member. */
function rampSynergy(card: ScryfallCard, text: string, lt: LeaningTheme): boolean {
  if (lt.kind.kind === 'archetype') return false;
  if (themeKindMatches(lt.kind, card)) return true;             // an Elf that taps for mana, etc.
  const words = typeWords(lt);
  if (words.length && new RegExp(`add\\b[^.\\n]*for each ${typeAlt(words)}\\b`).test(text)) return true;
  return false;
}

/** Card draw keyed to the theme's tribe — payoff that grows with how wide you've gone. */
function drawSynergy(text: string, lt: LeaningTheme): boolean {
  const words = typeWords(lt);
  if (words.length === 0) return false;
  const T = typeAlt(words);
  return new RegExp(`whenever (?:a |an |another )?${T}\\b[^.\\n]*draw`).test(text)
    || new RegExp(`draw[^.\\n]*for each ${T}\\b`).test(text)
    || new RegExp(`${T}\\b[^.\\n]*you control[^.\\n]*draw`).test(text);
}
