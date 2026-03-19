import type { ScryfallCard, EDHRECCommanderData, EDHRECCard } from '@/types';
import { getCardRole, cardMatchesRole, getAllCardRoles, type RoleKey } from '@/services/tagger/client';
import { getFrontFaceTypeLine } from '@/services/scryfall/client';
import { calculateCurvePercentages } from './curveUtils';

export interface RoleDeficit {
  role: string;
  label: string;
  current: number;
  target: number;
  deficit: number;
}

export interface CurveSlot {
  cmc: number;
  current: number;
  target: number;
  delta: number; // positive = over, negative = under
}

export type LandVerdict = 'critically-low' | 'low' | 'ok' | 'slightly-low' | 'high';

export interface ManaBaseAnalysis {
  currentLands: number;
  suggestedLands: number;
  adjustedSuggestion: number; // EDHREC avg nudged up, or down if ramp is strong
  currentBasic: number;
  currentNonbasic: number;
  suggestedBasic: number;
  suggestedNonbasic: number;
  rampCount: number; // total ramp-role cards in deck
  manaProducerCount: number; // mana dorks + mana rocks specifically
  verdict: LandVerdict;
  verdictMessage: string;
}

export interface TypeSlot {
  type: string;
  current: number;
  target: number;
  delta: number;
}

export interface RecommendedCard {
  name: string;
  inclusion: number;
  synergy: number;
  role?: string;
  roleLabel?: string;
  allRoles?: string[];
  allRoleLabels?: string[];
  fillsDeficit: boolean;
  primaryType: string;
  imageUrl?: string;
  price?: string;
}

export interface AnalyzedCard {
  card: ScryfallCard;
  inclusion: number | null;
  role?: string;
  roleLabel?: string;
  subtype?: string;
  subtypeLabel?: string;
}

export interface RoleBreakdown {
  role: string;
  label: string;
  current: number;
  target: number;
  deficit: number;
  cards: AnalyzedCard[];
  suggestedReplacements: RecommendedCard[];
}

export interface CurveBreakdown {
  cmc: number;
  current: number;
  target: number;
  delta: number;
  cards: AnalyzedCard[];
}

export interface DeckAnalysis {
  roleDeficits: RoleDeficit[];
  curveAnalysis: CurveSlot[];
  manaBase: ManaBaseAnalysis;
  typeAnalysis: TypeSlot[];
  recommendations: RecommendedCard[];
  roleBreakdowns: RoleBreakdown[];
  curveBreakdowns: CurveBreakdown[];
  landCards: AnalyzedCard[];
  rampCards: AnalyzedCard[];
  landRecommendations: RecommendedCard[];
}

const ROLE_LABELS: Record<string, string> = {
  ramp: 'Ramp',
  removal: 'Removal',
  boardwipe: 'Board Wipes',
  cardDraw: 'Card Advantage',
};

/**
 * Analyze a deck against EDHREC data.
 * Returns deficits, curve/type analysis, mana base insights, and card recommendations.
 */
export function analyzeDeck(
  edhrecData: EDHRECCommanderData,
  currentCards: ScryfallCard[],
  roleCounts: Record<string, number>,
  roleTargets: Record<string, number>,
  deckSize: number,
  cardInclusionMap?: Record<string, number>,
): DeckAnalysis {
  // --- Role Deficits ---
  const roleDeficits: RoleDeficit[] = Object.entries(roleTargets).map(([role, target]) => {
    const current = roleCounts[role] || 0;
    return {
      role,
      label: ROLE_LABELS[role] || role,
      current,
      target,
      deficit: Math.max(0, target - current),
    };
  });

  // --- Mana Curve ---
  const nonLandCards = currentCards.filter(
    c => !getFrontFaceTypeLine(c).toLowerCase().includes('land')
  );
  const totalNonLand = nonLandCards.length;

  // Current curve
  const currentCurve: Record<number, number> = {};
  for (const card of nonLandCards) {
    const cmc = Math.min(Math.floor(card.cmc), 7);
    currentCurve[cmc] = (currentCurve[cmc] || 0) + 1;
  }

  // Target curve from EDHREC
  const edhrecCurvePercentages = calculateCurvePercentages(edhrecData.stats.manaCurve);
  const allCmcKeys = new Set([
    ...Object.keys(currentCurve).map(Number),
    ...Object.keys(edhrecCurvePercentages).map(Number),
  ]);

  const curveAnalysis: CurveSlot[] = [...allCmcKeys].sort((a, b) => a - b).map(cmc => {
    const current = currentCurve[cmc] || 0;
    const targetPct = edhrecCurvePercentages[cmc] || 0;
    const target = Math.round((targetPct / 100) * totalNonLand);
    return { cmc, current, target, delta: current - target };
  });

  // --- Mana Base (with smart land assessment) ---
  const landCards = currentCards.filter(
    c => getFrontFaceTypeLine(c).toLowerCase().includes('land')
  );
  const currentLands = landCards.length;
  const edhrecLands = edhrecData.stats.landDistribution.total || Math.round(deckSize * 0.37);
  const currentBasic = landCards.filter(c => {
    const tl = getFrontFaceTypeLine(c).toLowerCase();
    return /\bbasic\b/.test(tl);
  }).length;
  const currentNonbasic = currentLands - currentBasic;

  // Count mana production to decide if running fewer lands is justified
  const rampCount = roleCounts['ramp'] || 0;
  let manaProducerCount = 0;
  for (const card of currentCards) {
    if (card.rampSubtype === 'mana-producer' || card.rampSubtype === 'mana-rock') {
      manaProducerCount++;
    }
  }

  // Adjust land suggestion: nudge UP by 1-2 unless ramp is strong
  // "Strong ramp" = 10+ ramp cards AND 6+ mana producers (dorks/rocks)
  const hasStrongRamp = rampCount >= 10 && manaProducerCount >= 6;
  const hasDecentRamp = rampCount >= 7 && manaProducerCount >= 4;
  let adjustedSuggestion: number;
  if (hasStrongRamp) {
    // Strong mana base justifies running at or slightly below EDHREC avg
    adjustedSuggestion = edhrecLands;
  } else if (hasDecentRamp) {
    // Decent ramp — nudge up by 1
    adjustedSuggestion = edhrecLands + 1;
  } else {
    // Weak ramp — push lands up by 2
    adjustedSuggestion = edhrecLands + 2;
  }
  // Hard floor: never suggest below 33 lands (for 99-card) or 33% of deck
  const landFloor = Math.max(33, Math.round(deckSize * 0.33));
  adjustedSuggestion = Math.max(adjustedSuggestion, landFloor);

  // Verdict
  const landDelta = currentLands - adjustedSuggestion;
  let verdict: LandVerdict;
  let verdictMessage: string;
  if (currentLands < landFloor - 3) {
    verdict = 'critically-low';
    verdictMessage = `Running ${currentLands} lands is dangerously low. You're likely to miss land drops and fall behind. Consider adding ${adjustedSuggestion - currentLands}+ lands.`;
  } else if (landDelta <= -3) {
    verdict = 'low';
    verdictMessage = hasDecentRamp
      ? `${currentLands} lands is ${Math.abs(landDelta)} below suggested (${adjustedSuggestion}). Your ${rampCount} ramp pieces help, but you may still stumble on mana.`
      : `${currentLands} lands is risky with only ${rampCount} ramp cards. Consider adding ${Math.abs(landDelta)} lands.`;
  } else if (landDelta < 0) {
    verdict = 'slightly-low';
    verdictMessage = hasStrongRamp
      ? `${currentLands} lands with ${rampCount} ramp pieces (${manaProducerCount} producers) — your mana base can support this.`
      : `${currentLands} lands is a touch light. Adding ${Math.abs(landDelta)} more would improve consistency.`;
  } else if (landDelta > 3) {
    verdict = 'high';
    verdictMessage = `${currentLands} lands is ${landDelta} above the suggestion (${adjustedSuggestion}). You could cut a few for more spells.`;
  } else {
    verdict = 'ok';
    verdictMessage = hasStrongRamp
      ? `${currentLands} lands with ${rampCount} ramp pieces — solid mana base.`
      : `${currentLands} lands looks good for this deck.`;
  }

  const manaBase: ManaBaseAnalysis = {
    currentLands,
    suggestedLands: edhrecLands,
    adjustedSuggestion,
    currentBasic,
    currentNonbasic,
    suggestedBasic: edhrecData.stats.landDistribution.basic || 0,
    suggestedNonbasic: edhrecData.stats.landDistribution.nonbasic || 0,
    rampCount,
    manaProducerCount,
    verdict,
    verdictMessage,
  };

  // --- Type Distribution ---
  const currentTypes: Record<string, number> = {};
  for (const card of nonLandCards) {
    const tl = getFrontFaceTypeLine(card).toLowerCase();
    if (tl.includes('creature')) currentTypes['creature'] = (currentTypes['creature'] || 0) + 1;
    else if (tl.includes('instant')) currentTypes['instant'] = (currentTypes['instant'] || 0) + 1;
    else if (tl.includes('sorcery')) currentTypes['sorcery'] = (currentTypes['sorcery'] || 0) + 1;
    else if (tl.includes('artifact')) currentTypes['artifact'] = (currentTypes['artifact'] || 0) + 1;
    else if (tl.includes('enchantment')) currentTypes['enchantment'] = (currentTypes['enchantment'] || 0) + 1;
    else if (tl.includes('planeswalker')) currentTypes['planeswalker'] = (currentTypes['planeswalker'] || 0) + 1;
    else if (tl.includes('battle')) currentTypes['battle'] = (currentTypes['battle'] || 0) + 1;
  }

  const edhrecTotalNonLand = Object.entries(edhrecData.stats.typeDistribution)
    .filter(([k]) => k !== 'land')
    .reduce((sum, [, v]) => sum + v, 0);

  const typeAnalysis: TypeSlot[] = ['creature', 'instant', 'sorcery', 'artifact', 'enchantment', 'planeswalker']
    .map(type => {
      const current = currentTypes[type] || 0;
      const edhrecPct = edhrecTotalNonLand > 0
        ? (edhrecData.stats.typeDistribution[type as keyof typeof edhrecData.stats.typeDistribution] || 0) / edhrecTotalNonLand
        : 0;
      const target = Math.round(edhrecPct * totalNonLand);
      return { type, current, target, delta: current - target };
    })
    .filter(t => t.target > 0 || t.current > 0);

  // --- Recommendations ---
  const currentCardNames = new Set(currentCards.map(c => c.name));
  const deficitRoles = new Set(roleDeficits.filter(d => d.deficit > 0).map(d => d.role));

  const candidateMap = new Map<string, { card: EDHRECCard; source: 'nonland' | 'land' }>();

  for (const card of edhrecData.cardlists.allNonLand) {
    if (!currentCardNames.has(card.name)) {
      candidateMap.set(card.name, { card, source: 'nonland' });
    }
  }
  for (const card of edhrecData.cardlists.lands) {
    if (!currentCardNames.has(card.name) && !candidateMap.has(card.name)) {
      candidateMap.set(card.name, { card, source: 'land' });
    }
  }

  const recommendations: RecommendedCard[] = [...candidateMap.values()].map(({ card }) => {
    const role = getCardRole(card.name);
    const allRoles = getAllCardRoles(card.name);
    const fillsDeficit = role ? deficitRoles.has(role) : false;

    // Score: inclusion + deficit bonus + synergy bonus
    let score = card.inclusion;
    if (fillsDeficit) score += 20;
    if (card.synergy && card.synergy > 0.3) score += card.synergy * 15;

    const price = card.prices?.tcgplayer?.price
      ? card.prices.tcgplayer.price.toFixed(2)
      : card.prices?.cardkingdom?.price
        ? card.prices.cardkingdom.price.toFixed(2)
        : undefined;

    return {
      name: card.name,
      inclusion: card.inclusion,
      synergy: card.synergy || 0,
      role: role || undefined,
      roleLabel: role ? ROLE_LABELS[role] : undefined,
      allRoles: allRoles.length > 0 ? allRoles : undefined,
      allRoleLabels: allRoles.length > 0 ? allRoles.map(r => ROLE_LABELS[r] || r) : undefined,
      fillsDeficit,
      primaryType: card.primary_type,
      imageUrl: card.image_uris?.[0]?.normal,
      price,
      _score: score,
    };
  })
    // Sort by computed score descending
    .sort((a, b) => ((b as any)._score || 0) - ((a as any)._score || 0))
    .slice(0, 30)
    .map(({ _score, ...rest }: any) => rest as RecommendedCard);

  // --- Per-Card Breakdowns ---
  const incMap = cardInclusionMap || {};

  const SUBTYPE_LABELS: Record<string, string> = {
    'mana-producer': 'Mana Dork',
    'mana-rock': 'Mana Rock',
    'cost-reducer': 'Cost Reducer',
    'ramp': 'Ramp',
    'counterspell': 'Counter',
    'bounce': 'Bounce',
    'spot-removal': 'Spot Removal',
    'removal': 'Removal',
    'bounce-wipe': 'Bounce Wipe',
    'boardwipe': 'Board Wipe',
    'tutor': 'Tutor',
    'wheel': 'Wheel',
    'cantrip': 'Cantrip',
    'card-draw': 'Card Draw',
    'card-advantage': 'Card Advantage',
  };

  function makeAnalyzedCard(card: ScryfallCard): AnalyzedCard {
    const subtype = card.rampSubtype || card.removalSubtype || card.boardwipeSubtype || card.cardDrawSubtype;
    return {
      card,
      inclusion: incMap[card.name] ?? null,
      role: card.deckRole || undefined,
      roleLabel: card.deckRole ? ROLE_LABELS[card.deckRole] : undefined,
      subtype: subtype || undefined,
      subtypeLabel: subtype ? SUBTYPE_LABELS[subtype] || subtype : undefined,
    };
  }

  const sortByInclusion = (a: AnalyzedCard, b: AnalyzedCard) =>
    (b.inclusion ?? -1) - (a.inclusion ?? -1);

  // Role breakdowns — source from full candidate pool so every role gets suggestions
  // Build RecommendedCard objects for all candidates that fill at least one role
  const roleCandidates: RecommendedCard[] = [];
  const candidateRolesMap = new Map<string, RoleKey[]>();
  for (const [name, { card }] of candidateMap) {
    const allRoles = getAllCardRoles(name);
    if (allRoles.length === 0) continue;
    candidateRolesMap.set(name, allRoles);
    const role = getCardRole(name);
    const price = card.prices?.tcgplayer?.price
      ? card.prices.tcgplayer.price.toFixed(2)
      : card.prices?.cardkingdom?.price
        ? card.prices.cardkingdom.price.toFixed(2)
        : undefined;
    roleCandidates.push({
      name,
      inclusion: card.inclusion,
      synergy: card.synergy || 0,
      role: role || undefined,
      roleLabel: role ? ROLE_LABELS[role] : undefined,
      allRoles: allRoles.length > 0 ? allRoles : undefined,
      allRoleLabels: allRoles.length > 0 ? allRoles.map(r => ROLE_LABELS[r] || r) : undefined,
      fillsDeficit: role ? deficitRoles.has(role) : false,
      primaryType: card.primary_type,
      imageUrl: card.image_uris?.[0]?.normal,
      price,
    });
  }

  const roleBreakdowns: RoleBreakdown[] = Object.entries(roleTargets).map(([role, target]) => {
    const current = roleCounts[role] || 0;
    const deficit = Math.max(0, target - current);
    const roleCards = currentCards
      .filter(c => c.deckRole === role || cardMatchesRole(c.name, role as RoleKey))
      .map(makeAnalyzedCard)
      .sort(sortByInclusion);

    // Gather candidates that match this role, sorted by inclusion desc
    const seen = new Set<string>();
    const suggestedReplacements: RecommendedCard[] = [];
    const matching = roleCandidates
      .filter(rec => (candidateRolesMap.get(rec.name) || []).includes(role as RoleKey))
      .sort((a, b) => b.inclusion - a.inclusion);
    for (const rec of matching) {
      if (!seen.has(rec.name)) {
        seen.add(rec.name);
        suggestedReplacements.push(rec);
      }
      if (suggestedReplacements.length >= 15) break;
    }

    return {
      role,
      label: ROLE_LABELS[role] || role,
      current,
      target,
      deficit,
      cards: roleCards,
      suggestedReplacements,
    };
  });

  // Curve breakdowns
  const curveBreakdowns: CurveBreakdown[] = curveAnalysis.map(slot => {
    const cards = nonLandCards
      .filter(c => Math.min(Math.floor(c.cmc), 7) === slot.cmc)
      .map(makeAnalyzedCard)
      .sort(sortByInclusion);
    return { ...slot, cards };
  });

  // Land cards
  const analyzedLandCards: AnalyzedCard[] = landCards
    .map(makeAnalyzedCard)
    .sort(sortByInclusion);

  // Ramp cards
  const rampCards: AnalyzedCard[] = currentCards
    .filter(c => c.deckRole === 'ramp' || cardMatchesRole(c.name, 'ramp'))
    .map(makeAnalyzedCard)
    .sort(sortByInclusion);

  // Land recommendations from EDHREC
  const landRecommendations: RecommendedCard[] = edhrecData.cardlists.lands
    .filter(c => !currentCardNames.has(c.name))
    .sort((a, b) => b.inclusion - a.inclusion)
    .slice(0, 10)
    .map(card => {
      const role = getCardRole(card.name);
      const price = card.prices?.tcgplayer?.price
        ? card.prices.tcgplayer.price.toFixed(2)
        : card.prices?.cardkingdom?.price
          ? card.prices.cardkingdom.price.toFixed(2)
          : undefined;
      return {
        name: card.name,
        inclusion: card.inclusion,
        synergy: card.synergy || 0,
        role: role || undefined,
        roleLabel: role ? ROLE_LABELS[role] : undefined,
        fillsDeficit: false,
        primaryType: card.primary_type,
        imageUrl: card.image_uris?.[0]?.normal,
        price,
      };
    });

  return {
    roleDeficits,
    curveAnalysis,
    manaBase,
    typeAnalysis,
    recommendations,
    roleBreakdowns,
    curveBreakdowns,
    landCards: analyzedLandCards,
    rampCards,
    landRecommendations,
  };
}
