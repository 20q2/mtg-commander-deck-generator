import type { ScryfallCard, EDHRECCommanderData, EDHRECCard, EDHRECTheme } from '@/types';
import type { CurveSlot } from './deckAnalyzer';
import { getKeywordsForTheme } from '@/services/edhrec/themeMapper';
import { getFrontFaceTypeLine } from '@/services/scryfall/client';

// ─── Types ───────────────────────────────────────────────────────────

export type Pacing = 'aggressive-early' | 'fast-tempo' | 'midrange' | 'late-game' | 'balanced';

export interface ThemeMatchResult {
  theme: EDHRECTheme;
  cardOverlap: number;
  themePoolSize: number;
  weightedOverlap: number;
  synergySum: number;
  keywordHits: number;
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
): ThemeMatchResult {
  const keywords = getKeywordsForTheme(theme.name);

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
    return { theme, cardOverlap: 0, themePoolSize, weightedOverlap: 0, synergySum: 0, keywordHits: 0, score: 0 };
  }

  // Signal 1: Card Overlap (40%)
  let cardOverlap = 0;
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
      synergySum += matched.synergy ?? 0;
    }
  }

  const overlapRatio = cardOverlap / deckNonBasicCount;
  const overlapScore = Math.min(overlapRatio * 150, 100); // 67% overlap → 100

  // Signal 2: Weighted Inclusion (30%)
  const inclusionNormalizer = cardOverlap > 0 ? cardOverlap * 50 : 1;
  const weightedScore = Math.min((weightedOverlap / inclusionNormalizer) * 100, 100);

  // Signal 3: Keyword Hits (30%)
  let keywordHits = 0;
  if (keywords.length > 0) {
    const lowerKeywords = keywords.map(k => k.toLowerCase());
    for (const card of nonBasicCards) {
      const oracle = (card.oracle_text || '').toLowerCase();
      const typeLine = (card.type_line || '').toLowerCase();
      for (const kw of lowerKeywords) {
        if (oracle.includes(kw) || typeLine.includes(kw)) {
          keywordHits++;
          break;
        }
      }
    }
  }
  const keywordRatio = keywordHits / deckNonBasicCount;
  const keywordScore = Math.min(keywordRatio * 150, 100);

  const score = overlapScore * 0.40 + weightedScore * 0.30 + keywordScore * 0.30;

  return {
    theme,
    cardOverlap,
    themePoolSize,
    weightedOverlap,
    synergySum,
    keywordHits,
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

const TRIBAL_TYPES = new Set([
  'elves', 'goblins', 'zombies', 'vampires', 'dragons', 'angels', 'demons',
  'wizards', 'warriors', 'rogues', 'clerics', 'soldiers', 'knights', 'merfolk',
  'spirits', 'dinosaurs', 'pirates', 'cats', 'dogs', 'beasts', 'elementals',
  'slivers', 'allies', 'humans', 'faeries', 'eldrazi', 'horrors', 'insects',
  'tyranids', 'hydras', 'werewolves', 'wolves', 'rats', 'squirrels', 'birds',
  'phoenixes', 'sphinxes', 'minotaurs', 'ninjas', 'samurai', 'fungi', 'treefolk',
  'apes', 'bears', 'snakes', 'spiders', 'shamans', 'druids', 'monks',
]);

export function generateStrategyLabel(themeName: string): string {
  const lower = themeName.toLowerCase().trim();

  const mapped = STRATEGY_LABEL_MAP[lower];
  if (mapped) return mapped;

  if (TRIBAL_TYPES.has(lower)) {
    const singular = lower.endsWith('ves')
      ? lower.slice(0, -3) + 'f'
      : lower.endsWith('ies')
        ? lower.slice(0, -3) + 'y'
        : lower.endsWith('xes') || lower.endsWith('ses')
          ? lower.slice(0, -2)
          : lower.endsWith('s')
            ? lower.slice(0, -1)
            : lower;
    return `${singular} tribal synergy`;
  }

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
  const prefix = hasUserOverride ? "You've declared that this is" : "We've detected that this is";

  if (!isConfident || matchedThemes.length === 0) {
    return `This ${b(shortName)} deck has a unique strategy with ${b(pacingLabel)}. Select a theme below for tailored recommendations.`;
  }

  if (hasSecondaryTheme && matchedThemes.length >= 2) {
    const secondLabel = generateStrategyLabel(matchedThemes[1].theme.name);
    return `${prefix} a ${b(shortName)} deck that focuses on ${b(pacingLabel)} and ${b(strategyLabel)}, with elements of ${b(secondLabel)}.`;
  }

  return `${prefix} a ${b(shortName)} deck built around ${b(strategyLabel)} with ${b(pacingLabel)}.`;
}

// ─── Main Orchestrator ───────────────────────────────────────────────

export function detectThemes(
  themes: EDHRECTheme[],
  themeDataMap: Map<string, EDHRECCommanderData>,
  currentCards: ScryfallCard[],
  curveAnalysis: CurveSlot[],
  commanderName: string,
): DetectedThemeResult {
  const evaluatedThemes: ThemeMatchResult[] = [];
  for (const theme of themes) {
    const data = themeDataMap.get(theme.slug);
    if (!data) continue;
    evaluatedThemes.push(scoreThemeMatch(theme, data, currentCards));
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
    ? generateStrategyLabel(matchedThemes[0].theme.name)
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
