import type { ScryfallCard } from '@/types';
import type { RoleKey } from '@/services/tagger/client';

/** How a theme is defined, and what to test a card against. */
export type ThemeKind =
  | { kind: 'mechanic'; match: string }   // match = keyword (lowercase); test card.keywords
  | { kind: 'tribal'; match: string }     // match = creature subtype (lowercase); test type_line subtypes
  | { kind: 'subtype'; match: string }    // match = permanent subtype, e.g. equipment/aura (lowercase); test type_line subtypes
  | { kind: 'curated'; match: string }    // match = CURATED_MECHANICS key; test oracle text
  | { kind: 'role'; match: RoleKey }      // functional category (Ramp, Card Draw…) → NOT a theme pack
  | { kind: 'archetype' };                // no concrete card attribute → statistical (tag-lift) gate

/**
 * The ONLY hand-maintained mechanic taxonomy: well-known mechanics Scryfall doesn't expose as
 * keywords. Kept intentionally tiny (user-approved). Keyed by the theme's lowercased display name;
 * value is an oracle-text test. Everything else comes from Scryfall's catalogs.
 */
export const CURATED_MECHANICS: Record<string, RegExp> = {
  '+1/+1 counters': /\+1\/\+1 counter/i,
  '-1/-1 counters': /-1\/-1 counter/i,
  'tokens': /\bcreates?\b[^.]*\btokens?\b/i,
};

/**
 * EDHREC theme names that are really FUNCTIONAL CATEGORIES, not strategies. A "Ramp" or "Card Draw"
 * theme page is a co-occurrence list of what those decks *play* (tutors, payoffs), so it makes a
 * terrible theme pack — the cards aren't the role. Classifying these as `role` keeps them OUT of
 * theme-pack generation; the deck seeks them through the deficit-gated need pack + the theme-tuned
 * synergy pack instead (themes early, answers later). Keyed by lowercased display name → RoleKey.
 */
export const ROLE_THEME_NAMES: Record<string, RoleKey> = {
  'ramp': 'ramp',
  'card draw': 'cardDraw', 'card advantage': 'cardDraw', 'draw': 'cardDraw',
  'removal': 'removal', 'spot removal': 'removal', 'targeted removal': 'removal',
  'board wipe': 'boardwipe', 'board wipes': 'boardwipe', 'boardwipes': 'boardwipe', 'wraths': 'boardwipe',
  'protection': 'protection',
};

/** Singular candidates for a plural theme name, to match Scryfall's singular creature types. */
function singulars(n: string): string[] {
  return [n, n.replace(/ies$/, 'y'), n.replace(/ves$/, 'f'), n.replace(/s$/, ''), n.replace(/es$/, '')];
}

/**
 * Classify one theme. Order: curated (our small exception list) → mechanic (Scryfall keywords) →
 * tribal (Scryfall creature types, matched on a singularized name) → archetype (fallback).
 */
export function classifyTheme(
  themeName: string, mechanics: Set<string>, creatureTypes: Set<string>, permanentSubtypes: Set<string>,
): ThemeKind {
  const n = themeName.toLowerCase().trim();
  // Functional categories first — so a "Protection" theme reads as the role, never the keyword ability.
  if (n in ROLE_THEME_NAMES) return { kind: 'role', match: ROLE_THEME_NAMES[n] };
  if (n in CURATED_MECHANICS) return { kind: 'curated', match: n };
  if (mechanics.has(n)) return { kind: 'mechanic', match: n };
  for (const cand of singulars(n)) if (creatureTypes.has(cand)) return { kind: 'tribal', match: cand };
  // Non-creature permanent subtypes (Equipment, Aura, Vehicle, Saga…): an "Equipment" theme should
  // ship Equipment, not the tag-lift co-occurrence pile — gate it on the literal type line like a tribe.
  for (const cand of singulars(n)) if (permanentSubtypes.has(cand)) return { kind: 'subtype', match: cand };
  return { kind: 'archetype' };
}

function hasKeyword(sc: ScryfallCard, kw: string): boolean {
  return (sc.keywords ?? []).some(k => k.toLowerCase() === kw);
}
function hasSubtype(sc: ScryfallCard, sub: string): boolean {
  // Subtypes are the words after the em-dash in the type line (e.g. "… — Elf Faerie Noble").
  const after = (sc.type_line ?? '').toLowerCase().split('—')[1] ?? '';
  return new RegExp(`\\b${sub.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(after);
}
function matchesCurated(sc: ScryfallCard, key: string): boolean {
  const re = CURATED_MECHANICS[key];
  if (!re) return false;
  const text = `${sc.oracle_text ?? ''} ${(sc.card_faces ?? []).map(f => f.oracle_text ?? '').join(' ')}`;
  return re.test(text);
}

/** Does this card deterministically belong to a mechanic/tribal/curated theme? (archetype/role → false). */
export function themeKindMatches(kind: ThemeKind, sc: ScryfallCard): boolean {
  switch (kind.kind) {
    case 'mechanic': return hasKeyword(sc, kind.match);
    case 'tribal': return hasSubtype(sc, kind.match);
    case 'subtype': return hasSubtype(sc, kind.match);
    case 'curated': return matchesCurated(sc, kind.match);
    // 'role' needs the tagger's role (BrewCandidate.role), which a ScryfallCard alone can't give —
    // and role themes never become theme packs, so no card-attribute test is meaningful here.
    default: return false;
  }
}
