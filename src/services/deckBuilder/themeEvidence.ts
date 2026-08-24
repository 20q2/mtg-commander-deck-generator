import type { ThemeMatchResult } from './themeDetector';

/**
 * How a detected theme explains itself to the user — in one place, because three surfaces now say
 * it (the deck view's picker, the Inspector's theme prompt, and the Adjust popover) and this
 * codebase's recurring failure is one idea implemented three times and drifting.
 *
 * The wording is deliberately NOT the composite score. That is an internal 0-100 that reads like a
 * percentage, so a thoroughly confident 36 looked like a failing grade. What a user can actually
 * check is how many of their own cards carry the theme — they can open the deck and count.
 */

/** Kinds where the card IS the thing, rather than having it. */
const IS_KINDS = new Set(['subtype', 'tribal', 'cardType']);

/** One line: how many of the user's cards back this theme, and on what basis. */
export function themeEvidence(m: ThemeMatchResult): string {
  if (m.literalCount > 0) {
    // "17 of your cards are Auras", not "carry Auras" — for a subtype or a tribe the cards ARE the
    // thing. A mechanic or a counter type is something a card has.
    const verb = m.themeKind && IS_KINDS.has(m.themeKind) ? 'are' : 'carry';
    return `${m.literalCount} of your cards ${verb} ${m.theme.name}`;
  }
  if (m.memberCount > 0) {
    return `${m.memberCount} of your cards play like ${m.theme.name}`;
  }
  // No card-level evidence at all — the verdict rests on EDHREC page overlap. Say that, rather than
  // dressing page presence up as fit.
  return `${m.cardOverlap} of your cards show up in ${m.theme.name} decks`;
}

/** How many member names fit on one line of a narrow panel. */
const NAMES_SHOWN = 3;

/**
 * The receipts. A user handed "17 of your cards are Auras" on a land-ramp deck counted seven and
 * reported it as a bug — the count was exact, but every one of the seventeen was a mana Aura
 * (Utopia Sprawl, Wild Growth) that doesn't feel like one. Naming three collapses that
 * misunderstanding into a glance; the full list goes in the tooltip.
 */
export function memberPreview(m: ThemeMatchResult): { text: string; full: string } | null {
  if (m.memberNames.length === 0) return null;
  const shown = m.memberNames.slice(0, NAMES_SHOWN);
  const rest = m.memberNames.length - shown.length;
  return {
    text: shown.join(', ') + (rest > 0 ? ` +${rest} more` : ''),
    full: m.memberNames.join(', '),
  };
}
