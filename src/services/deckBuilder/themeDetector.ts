import type { ScryfallCard, EDHRECCommanderData, EDHRECCard, EDHRECTheme } from '@/types';
import type { CurveSlot } from './deckAnalyzer';
import { getFrontFaceTypeLine } from '@/services/scryfall/client';
import {
  MEMBERSHIP_WEIGHT, OVERLAP_WEIGHT, INCLUSION_WEIGHT, STAPLE_OVERLAP_CREDIT,
  type ThemeScore, type ThemeKind,
} from '@/services/themes';

// ─── Types ───────────────────────────────────────────────────────────

import type { Pacing } from '@/types';
export type { Pacing };

export interface ThemeMatchResult {
  theme: EDHRECTheme;
  cardOverlap: number;
  themePoolSize: number;
  weightedOverlap: number;
  synergySum: number;
  /** Deck cards belonging to this theme by the derived membership test. */
  memberCount: number;
  /** How membership was established: a literal card attribute, or characteristic oracle tags. */
  basis: 'literal' | 'tag' | 'none';
  /** Composite 0-100 */
  score: number;
}

export interface DetectedThemeResult {
  /** Top 1-2 themes above confidence threshold, sorted by score desc */
  matchedThemes: ThemeMatchResult[];
  /** All evaluated themes (up to 4), sorted by score desc */
  evaluatedThemes: ThemeMatchResult[];
  pacingLabel: string;
  pacing: Pacing;
  strategyLabel: string;
  detectionMessage: string;
  isConfident: boolean;
  hasSecondaryTheme: boolean;
}

// ─── Confidence thresholds ───────────────────────────────────────────

const PRIMARY_THRESHOLD = 30;
const SECONDARY_THRESHOLD = 20;
const SECONDARY_GAP_MAX = 15;

// ─── Pacing Detection ────────────────────────────────────────────────

export const PACING_PHRASE: Record<Pacing, string> = {
  'aggressive-early': 'early game aggression',
  'fast-tempo': 'a fast, low-curve game plan',
  'midrange': 'a steady midrange strategy',
  'late-game': 'a late-game value engine',
  'balanced': 'a versatile approach',
};

const AGGRO_KEYWORDS = new Set([
  'haste', 'first strike', 'double strike', 'menace',
  'trample', 'prowess', 'exalted',
]);

export function detectPacing(
  currentCards: ScryfallCard[],
  curveAnalysis: CurveSlot[],
): { pacing: Pacing; label: string } {
  const totalNonLand = curveAnalysis.reduce((sum, s) => sum + s.current, 0);
  if (totalNonLand === 0) return { pacing: 'balanced', label: 'a versatile approach' };

  const weightedCmc = curveAnalysis.reduce((sum, s) => sum + s.cmc * s.current, 0);
  const avgCmc = weightedCmc / totalNonLand;

  const earlyCount = curveAnalysis.filter(s => s.cmc <= 2).reduce((sum, s) => sum + s.current, 0);
  const earlyPct = earlyCount / totalNonLand;

  const lateCount = curveAnalysis.filter(s => s.cmc >= 5).reduce((sum, s) => sum + s.current, 0);
  const latePct = lateCount / totalNonLand;

  const midCount = curveAnalysis.filter(s => s.cmc >= 3 && s.cmc <= 4).reduce((sum, s) => sum + s.current, 0);
  const midPct = midCount / totalNonLand;

  // Scan for aggressive combat keywords on low-CMC creatures
  let aggroKeywordCount = 0;
  for (const card of currentCards) {
    if ((card.cmc ?? 99) > 3) continue;
    const typeLine = getFrontFaceTypeLine(card).toLowerCase();
    if (!typeLine.includes('creature')) continue;
    for (const kw of card.keywords || []) {
      if (AGGRO_KEYWORDS.has(kw.toLowerCase())) {
        aggroKeywordCount++;
        break;
      }
    }
  }
  const aggroKeywordPct = aggroKeywordCount / totalNonLand;

  if (avgCmc <= 2.4 && earlyPct >= 0.50 && aggroKeywordPct >= 0.08) {
    return { pacing: 'aggressive-early', label: 'early game aggression' };
  }
  if (avgCmc <= 2.7 && earlyPct >= 0.42) {
    return { pacing: 'fast-tempo', label: 'a fast, low-curve game plan' };
  }
  if (avgCmc >= 3.8 || latePct >= 0.28) {
    return { pacing: 'late-game', label: 'a late-game value engine' };
  }
  if (avgCmc >= 2.8 && avgCmc < 3.8 && midPct >= 0.30) {
    return { pacing: 'midrange', label: 'a steady midrange strategy' };
  }
  return { pacing: 'balanced', label: 'a versatile approach' };
}

// ─── Theme Scoring ───────────────────────────────────────────────────

export function scoreThemeMatch(
  theme: EDHRECTheme,
  themeData: EDHRECCommanderData,
  currentCards: ScryfallCard[],
  membership?: ThemeScore,
): ThemeMatchResult {
  // Build lookup from the theme's cardlists
  const themeCardMap = new Map<string, EDHRECCard>();
  for (const card of themeData.cardlists.allNonLand) {
    themeCardMap.set(card.name, card);
    if (card.name.includes(' // ')) themeCardMap.set(card.name.split(' // ')[0], card);
  }
  for (const card of themeData.cardlists.lands) {
    if (!themeCardMap.has(card.name)) themeCardMap.set(card.name, card);
  }
  const themePoolSize = themeCardMap.size;

  // Filter to non-basic-land cards
  const nonBasicCards = currentCards.filter(c => {
    const tl = getFrontFaceTypeLine(c).toLowerCase();
    return !(tl.includes('basic') && tl.includes('land'));
  });
  const deckNonBasicCount = nonBasicCards.length;

  if (deckNonBasicCount === 0) {
    return {
      theme, cardOverlap: 0, themePoolSize, weightedOverlap: 0, synergySum: 0,
      memberCount: 0, basis: 'none', score: 0,
    };
  }

  // Signal 1: Card Overlap, synergy-gated.
  //
  // A raw count credits a theme for every generic staple on its page. Theme pages hold ~300 cards,
  // mostly format goodstuff, so any deck in the right colors overlaps ALL of its commander's theme
  // pages heavily and the signal stops discriminating. EDHREC's per-card synergy separates the two
  // cases — it is ~0 for a card that appears on every page, high for one specific to this theme —
  // and it was already summed here and never used. `cardOverlap` stays a true count for display;
  // only the score consumes the gated credit.
  let cardOverlap = 0;
  let overlapCredit = 0;
  let weightedOverlap = 0;
  let synergySum = 0;

  for (const card of nonBasicCards) {
    let matched: EDHRECCard | undefined = themeCardMap.get(card.name);
    if (!matched && card.name.includes(' // ')) {
      matched = themeCardMap.get(card.name.split(' // ')[0]);
    }
    if (!matched && card.card_faces?.[0]?.name) {
      matched = themeCardMap.get(card.card_faces[0].name);
    }
    if (matched) {
      cardOverlap++;
      weightedOverlap += matched.inclusion;
      const synergy = matched.synergy ?? 0;
      synergySum += synergy;
      overlapCredit += synergy > 0 ? 1 : STAPLE_OVERLAP_CREDIT;
    }
  }

  const overlapRatio = overlapCredit / deckNonBasicCount;
  const overlapScore = Math.min(overlapRatio * 150, 100); // 67% synergy-bearing overlap → 100

  // Signal 2: Weighted Inclusion
  const inclusionNormalizer = cardOverlap > 0 ? cardOverlap * 50 : 1;
  const weightedScore = Math.min((weightedOverlap / inclusionNormalizer) * 100, 100);

  // Signal 3: Derived membership — how many of the deck's cards actually belong to this theme by
  // its own definition (a literal card attribute for tribal/mechanic/subtype themes, characteristic
  // oracle tags for archetypes). This is the signal that sees cards EDHREC's page never listed, and
  // the one that replaced a 530-line hand-maintained keyword map.
  //
  // Both EDHREC signals are popularity-biased in opposite directions — a goodstuff pile overlaps
  // every theme page, a budget Elves deck overlaps none — so membership corrects both. It is
  // weighted deliberately light for now; /theme-lab is where that weight gets earned.
  const membershipScore = membership?.membershipScore ?? 0;

  // Renormalize when membership is unavailable, so its absence doesn't silently deflate every score
  // (which would drag confident decks below the detection threshold).
  const totalWeight = membership
    ? OVERLAP_WEIGHT + INCLUSION_WEIGHT + MEMBERSHIP_WEIGHT
    : OVERLAP_WEIGHT + INCLUSION_WEIGHT;
  const score = (
    overlapScore * OVERLAP_WEIGHT
    + weightedScore * INCLUSION_WEIGHT
    + membershipScore * (membership ? MEMBERSHIP_WEIGHT : 0)
  ) / totalWeight;

  return {
    theme,
    cardOverlap,
    themePoolSize,
    weightedOverlap,
    synergySum,
    memberCount: membership?.members ?? 0,
    basis: membership?.memberCards[0]?.basis ?? 'none',
    score: Math.round(score * 10) / 10,
  };
}

// ─── Strategy Labels ─────────────────────────────────────────────────

const STRATEGY_LABEL_MAP: Record<string, string> = {
  'tokens':           'heavy token synergy',
  'go wide':          'a go-wide token strategy',
  '+1/+1 counters':   'a +1/+1 counter strategy',
  '-1/-1 counters':   'a -1/-1 counter strategy',
  'counters':         'a counter-based strategy',
  'proliferate':      'a proliferate strategy',
  'aristocrats':      'an aristocrats sacrifice strategy',
  'sacrifice':        'sacrifice synergy',
  'voltron':          'a voltron equipment strategy',
  'equipment':        'an equipment-focused strategy',
  'auras':            'an aura-based strategy',
  'spellslinger':     'a spellslinger strategy',
  'storm':            'a storm combo strategy',
  'superfriends':     'a superfriends planeswalker strategy',
  'reanimator':       'a graveyard reanimation strategy',
  'graveyard':        'graveyard synergy',
  'mill':             'a mill strategy',
  'blink':            'an ETB blink strategy',
  'flicker':          'a flicker strategy',
  'clones':           'a clone/copy strategy',
  'landfall':         'a landfall strategy',
  'lands':            'a lands-matter strategy',
  'artifacts':        'an artifact synergy strategy',
  'treasures':        'a treasure token strategy',
  'enchantress':      'an enchantress strategy',
  'aggro':            'aggressive combat pressure',
  'combat':           'a combat-focused strategy',
  'extra combat':     'an extra combat strategy',
  'extra turns':      'an extra turns strategy',
  'control':          'a control strategy',
  'stax':             'a stax control strategy',
  'lifegain':         'life gain synergy',
  'life gain':        'life gain synergy',
  'wheels':           'a wheel/discard strategy',
  'infect':           'an infect strategy',
  'energy':           'an energy counter strategy',
  'group hug':        'a group hug strategy',
  'group slug':       'a group slug strategy',
  'combo':            'a combo-focused strategy',
  'card draw':        'a card-draw engine strategy',
  'tribal':           'a tribal strategy',
  'topdeck':          'a topdeck manipulation strategy',
  'top deck':         'a topdeck manipulation strategy',
  'chaos':            'a chaos strategy',
  'big mana':         'a big mana strategy',
  'ramp':             'a heavy ramp strategy',
  'food':             'a food token strategy',
  'draw':             'a card-draw engine strategy',
  'discard':          'a discard strategy',
  'power matters':    'a power-matters strategy',
  'toughness matters':'a toughness-matters strategy',
  'mutate':           'a mutate strategy',
  'morph':            'a morph/face-down strategy',
  'vehicles':         'a vehicles strategy',
  'modular':          'a modular artifact strategy',
  'sagas':            'a saga-based strategy',
  'legendary matters':'a legendary-matters strategy',
  'partner':          'a partner strategy',
  'experience counters': 'an experience counter strategy',
};

/**
 * Phrase a theme as a strategy.
 *
 * The map above stays because "an aristocrats sacrifice strategy" reads better than what any rule
 * would generate. Everything else is derived: `kind` comes from Scryfall's own catalogs, so every
 * creature type in Magic gets a correct tribal phrasing rather than the 45 that used to be listed
 * here by hand — and a Praetors or Tyranid deck reads as well as an Elves one.
 */
export function generateStrategyLabel(themeName: string, kind?: ThemeKind): string {
  const lower = themeName.toLowerCase().trim();

  const mapped = STRATEGY_LABEL_MAP[lower];
  if (mapped) return mapped;

  // `match` is already Scryfall's singular form ("elf", "sliver"), so no de-pluralizing guesswork.
  if (kind?.kind === 'tribal') return `${kind.match} tribal synergy`;
  if (kind?.kind === 'subtype' || kind?.kind === 'cardType') return `a ${kind.match}-focused strategy`;

  return `${lower} synergy`;
}

// ─── Message Assembly ────────────────────────────────────────────────

export function buildDetectionMessage(
  commanderName: string,
  matchedThemes: ThemeMatchResult[],
  pacingLabel: string,
  strategyLabel: string,
  isConfident: boolean,
  hasSecondaryTheme: boolean,
  hasUserOverride?: boolean,
): string {
  const shortName = commanderName.includes(',')
    ? commanderName.split(',')[0].trim()
    : commanderName;

  const b = (text: string) => `<strong class="text-foreground/90">${text}</strong>`;
  const t = (text: string) => `<button type="button" data-theme-action="group" class="text-foreground/90 font-semibold hover:text-primary transition-colors cursor-pointer">${text}</button>`;
  const prefix = hasUserOverride ? "You've declared that this is" : "We've detected that this is";

  if (!isConfident || matchedThemes.length === 0) {
    return `This ${b(shortName)} deck has a unique strategy with ${b(pacingLabel)}. Select a theme using the adjust button for tailored recommendations.`;
  }

  if (hasSecondaryTheme && matchedThemes.length >= 2) {
    const secondLabel = generateStrategyLabel(matchedThemes[1].theme.name);
    return `${prefix} a ${b(shortName)} deck that focuses on ${b(pacingLabel)} and ${t(strategyLabel)}, with elements of ${t(secondLabel)}.`;
  }

  return `${prefix} a ${b(shortName)} deck built around ${t(strategyLabel)} with ${b(pacingLabel)}.`;
}

// ─── Main Orchestrator ───────────────────────────────────────────────

/**
 * @param membershipScores Phase A results by slug — derived membership, computed locally over the
 *        whole EDHREC taxonomy with no network. Optional: when absent (the tag index or Scryfall
 *        catalogs failed to load) detection falls back to the two EDHREC signals alone.
 */
export function detectThemes(
  themes: EDHRECTheme[],
  themeDataMap: Map<string, EDHRECCommanderData>,
  currentCards: ScryfallCard[],
  curveAnalysis: CurveSlot[],
  commanderName: string,
  membershipScores?: ReadonlyMap<string, ThemeScore>,
): DetectedThemeResult {
  const evaluatedThemes: ThemeMatchResult[] = [];
  for (const theme of themes) {
    const data = themeDataMap.get(theme.slug);
    if (!data) continue;
    const membership = membershipScores?.get(theme.slug);
    // A theme whose hard requirement the deck doesn't meet cannot be declared: a companion theme
    // without its companion (an all-creature deck satisfies Umori's restriction but isn't an Umori
    // deck without Umori), or an effect theme without the effect (a sacrifice deck isn't a Birthing
    // Pod deck without a pod). Dropped from evaluation entirely so it can't become the answer, while
    // remaining in the membership scores for anything that wants the signal.
    if (membership?.gateMissing) continue;
    evaluatedThemes.push(scoreThemeMatch(theme, data, currentCards, membership));
  }

  evaluatedThemes.sort((a, b) => b.score - a.score);

  const matchedThemes: ThemeMatchResult[] = [];
  let isConfident = false;
  let hasSecondaryTheme = false;

  if (evaluatedThemes.length > 0 && evaluatedThemes[0].score >= PRIMARY_THRESHOLD) {
    isConfident = true;
    matchedThemes.push(evaluatedThemes[0]);

    if (
      evaluatedThemes.length > 1 &&
      evaluatedThemes[1].score >= SECONDARY_THRESHOLD &&
      evaluatedThemes[0].score - evaluatedThemes[1].score <= SECONDARY_GAP_MAX
    ) {
      matchedThemes.push(evaluatedThemes[1]);
      hasSecondaryTheme = true;
    }
  }

  const { pacing, label: pacingLabel } = detectPacing(currentCards, curveAnalysis);

  const strategyLabel = matchedThemes.length > 0
    ? generateStrategyLabel(
        matchedThemes[0].theme.name,
        membershipScores?.get(matchedThemes[0].theme.slug)?.model.kind,
      )
    : 'a unique strategy';

  const detectionMessage = buildDetectionMessage(
    commanderName, matchedThemes, pacingLabel, strategyLabel, isConfident, hasSecondaryTheme,
  );

  return {
    matchedThemes,
    evaluatedThemes,
    pacingLabel,
    pacing,
    strategyLabel,
    detectionMessage,
    isConfident,
    hasSecondaryTheme,
  };
}
