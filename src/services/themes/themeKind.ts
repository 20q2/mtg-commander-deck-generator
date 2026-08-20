import type { ScryfallCard } from '@/types';
import type { RoleKey } from '@/services/tagger/client';

/** How a theme is defined, and what to test a card against. */
export type ThemeKind =
  | { kind: 'mechanic'; match: string }   // match = keyword (lowercase); test card.keywords
  | { kind: 'tribal'; match: string }     // match = creature subtype (lowercase); test type_line subtypes
  | { kind: 'subtype'; match: string }    // match = permanent subtype, e.g. equipment/aura (lowercase); test type_line subtypes
  | { kind: 'cardType'; match: string }   // match = card TYPE, e.g. battle/planeswalker (lowercase); test type_line types
  | { kind: 'curated'; match: string }    // match = CURATED_MECHANICS key; test oracle text
  | { kind: 'counterType'; match: string } // match = counter kind ("experience"); test oracle text
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
  // "Commander Matters" cannot be learned from its EDHREC page: that page lists 294 cards, of which
  // only 8 reference a commander at all. It's full of legendary creatures (Kaalia, Nick Fury) —
  // commanders people BUILD AROUND, not cards that care about yours. Left to the tag-lift path it
  // resolved to `pp-counters-matter`, so every +1/+1 counters deck read as Commander Matters.
  // The literal test is unambiguous and catches the real payoffs: the free-spell cycle (Deadly
  // Rollick, Fierce Guardianship, Deflecting Swat), Jeska's Will, Commander ninjutsu, Lieutenant.
  'commander matters': /\bcommander(?:'s)?\b/i,
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

/**
 * MTG's card TYPES — a closed, near-static set (Battle was the last addition, 2023). Scryfall
 * publishes catalogs for sub-types but not for card types, so this is the second hand-maintained
 * list, kept just as small as CURATED_MECHANICS. Without it a "Battles" theme falls through to
 * `archetype`, whose co-occurrence membership yields the cards battle decks PLAY and not a single
 * Battle — the same failure the `role` kind fixed for "Ramp".
 *
 * Deliberately excludes the broad types (creature, land, instant, sorcery): those name a card's
 * shape rather than a strategy, and making them deterministic would let the cross-theme guard
 * (belongsToOtherKind) strip every creature out of the round's other packs.
 */
export const CARD_TYPES = new Set(['artifact', 'battle', 'enchantment', 'planeswalker']);

/** Escape a string for literal use inside a RegExp. */
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * "<Kind> Counters" themes name a counter that is literally printed on cards, so the theme is
 * DERIVED from its own name rather than curated: "Experience Counters" → /\bexperience\s+counter/.
 *
 * Worth a rule rather than more CURATED_MECHANICS entries because it generalises — it already
 * covers Experience (16 cards), Rad (21), Charge (87), Time (82), Spore (18) and Oil (47), and any
 * counter type printed in a future set works without a code change.
 *
 * Left to tag-lift these were badly wrong: Experience Counters resolved to cda-color /
 * synergy-legendary / refund / pp-counters-matter, so it matched Arcane Signet, The Great Henge and
 * every +1/+1 counters card while missing Ezuri, Mizzix and Meren entirely.
 *
 * Returns null for +1/+1 and -1/-1, whose names start with a non-word character so `\b` cannot
 * anchor — those two stay in CURATED_MECHANICS, which is checked first anyway.
 */
function counterTypeFromName(name: string): string | null {
  const m = /^(.+?)\s+counters?$/i.exec(name.trim());
  if (!m) return null;
  const kind = m[1].trim();
  if (!/^[a-z]/i.test(kind)) return null;
  return kind.toLowerCase();
}

/** Singular candidates for a plural theme name, to match Scryfall's singular creature types. */
function singulars(n: string): string[] {
  return [n, n.replace(/ies$/, 'y'), n.replace(/ves$/, 'f'), n.replace(/s$/, ''), n.replace(/es$/, '')];
}

/**
 * Stem candidates for a theme named as a gerund. Scryfall's own catalog is inconsistent about this:
 * it lists `waterbend`, `airbend` and `earthbend` as bare stems but `firebending` with the -ing. So
 * Firebending classified as a mechanic while its three siblings fell through to `archetype` and got
 * near-identical junk tag-lift definitions (Waterbending's included `earthbend`).
 *
 * Also rescues Voting → `vote`. The exact spelling is tried first, so a theme whose name IS a
 * keyword ("Cycling", "Training") never reaches the stem.
 */
function stems(n: string): string[] {
  return [n, n.replace(/ing$/, ''), n.replace(/ing$/, 'e')];
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
  // Before the keyword check: "Time Counters" must read as the counter, not as a "time" mechanic.
  const counterKind = counterTypeFromName(n);
  if (counterKind) return { kind: 'counterType', match: counterKind };
  for (const cand of stems(n)) if (mechanics.has(cand)) return { kind: 'mechanic', match: cand };
  // Card types before subtypes: a "Battles"/"Planeswalkers" theme must ship the literal type, and no
  // card type collides with a keyword or creature type.
  for (const cand of singulars(n)) if (CARD_TYPES.has(cand)) return { kind: 'cardType', match: cand };
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
function hasCardType(sc: ScryfallCard, type: string): boolean {
  // Card types are the words BEFORE the em-dash ("Battle — Siege", "Legendary Creature — Elf").
  // Check every face so an MDFC battle (Invasion of …) counts on either side.
  const lines = [sc.type_line ?? '', ...(sc.card_faces ?? []).map(f => f.type_line ?? '')];
  return lines.some(l => new RegExp(`\\b${type}\\b`).test(l.toLowerCase().split('—')[0] ?? ''));
}
function oracleText(sc: ScryfallCard): string {
  return `${sc.oracle_text ?? ''} ${(sc.card_faces ?? []).map(f => f.oracle_text ?? '').join(' ')}`;
}
function matchesCurated(sc: ScryfallCard, key: string): boolean {
  const re = CURATED_MECHANICS[key];
  if (!re) return false;
  return re.test(oracleText(sc));
}
function matchesCounterType(sc: ScryfallCard, kind: string): boolean {
  return new RegExp(`\\b${escapeRe(kind)}\\s+counter`, 'i').test(oracleText(sc));
}

/**
 * Plain-language description of the test a theme uses to decide membership, so any surface can say
 * WHY rather than only WHAT. Archetype themes have no literal test — their evidence is the
 * characteristic-tag list on the model — so they return null and the caller shows the tags instead.
 */
export function describeThemeTest(kind: ThemeKind): string | null {
  switch (kind.kind) {
    case 'mechanic': return `keyword "${kind.match}"`;
    case 'tribal': return `creature type "${kind.match}" on the type line`;
    case 'subtype': return `subtype "${kind.match}" on the type line`;
    case 'cardType': return `card type "${kind.match}"`;
    case 'curated': return `oracle text matches ${CURATED_MECHANICS[kind.match]?.source ?? kind.match}`;
    case 'counterType': return `oracle text mentions a "${kind.match} counter"`;
    case 'role': return `functional role (${kind.match}) — never treated as a theme`;
    default: return null;
  }
}

/** Does this card deterministically belong to a mechanic/tribal/curated theme? (archetype/role → false). */
export function themeKindMatches(kind: ThemeKind, sc: ScryfallCard): boolean {
  switch (kind.kind) {
    case 'mechanic': return hasKeyword(sc, kind.match);
    case 'tribal': return hasSubtype(sc, kind.match);
    case 'subtype': return hasSubtype(sc, kind.match);
    case 'cardType': return hasCardType(sc, kind.match);
    case 'curated': return matchesCurated(sc, kind.match);
    case 'counterType': return matchesCounterType(sc, kind.match);
    // 'role' needs the tagger's role (BrewCandidate.role), which a ScryfallCard alone can't give —
    // and role themes never become theme packs, so no card-attribute test is meaningful here.
    default: return false;
  }
}
