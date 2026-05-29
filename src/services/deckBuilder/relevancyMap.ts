import type { GeneratedDeck, ScryfallCard, EDHRECCard } from '@/types';
import { scoreRecommendation, type ScoringContext } from './deckAnalyzer';
import { getFrontFaceTypeLine, isMdfcLand, isChannelLand } from '@/services/scryfall/client';

const BASIC_LAND_NAMES = new Set([
  'Plains', 'Island', 'Swamp', 'Mountain', 'Forest',
  'Snow-Covered Plains', 'Snow-Covered Island', 'Snow-Covered Swamp',
  'Snow-Covered Mountain', 'Snow-Covered Forest',
  'Wastes',
]);

const TYPE_KEYS = ['creature', 'instant', 'sorcery', 'artifact', 'enchantment', 'planeswalker'] as const;

const CHANNEL_LAND_BOOST = 40;
const MDFC_LAND_BOOST = 30;

/**
 * Rebuild the relevancy map from a deck's current state. Call this after any
 * mutation that changes deck composition (swap, add, trim) so contextual
 * relevancy (combo membership, role scarcity, curve/type balance) stays accurate.
 *
 * Cards lacking EDHREC data (no entry in cardInclusionMap) get a score of 0 —
 * matches the generator/enricher behavior. Pre-existing entries for cards not
 * in the deck (swap candidates, gap analysis cards) are preserved.
 */
export function rebuildRelevancyMap(deck: GeneratedDeck): Record<string, number> {
  const inclusionMap = deck.cardInclusionMap ?? {};
  const synergyMap = deck.cardSynergyMap ?? {};
  const metaMap = deck.cardEdhrecMetaMap ?? {};
  const roleCounts = deck.roleCounts ?? {};
  const roleTargets = deck.roleTargets ?? {};

  const allCards: ScryfallCard[] = Object.values(deck.categories).flat();
  const nonLandForScoring = allCards.filter(c =>
    !BASIC_LAND_NAMES.has(c.name) &&
    !getFrontFaceTypeLine(c).toLowerCase().includes('land')
  );

  const actualCurve: Record<number, number> = {};
  for (const c of nonLandForScoring) {
    const cmc = Math.min(Math.floor(c.cmc ?? 0), 7);
    actualCurve[cmc] = (actualCurve[cmc] || 0) + 1;
  }
  const edhrecCurve = deck.edhrecCurve ?? {};
  const curveAnalysis = Object.keys(edhrecCurve).map(Number).map(cmc => ({
    cmc,
    current: actualCurve[cmc] || 0,
    target: edhrecCurve[cmc] || 0,
    delta: (actualCurve[cmc] || 0) - (edhrecCurve[cmc] || 0),
  }));

  const actualTypes: Record<string, number> = {};
  for (const c of nonLandForScoring) {
    const t = getFrontFaceTypeLine(c).toLowerCase();
    const type = TYPE_KEYS.find(tp => t.includes(tp)) || 'other';
    actualTypes[type] = (actualTypes[type] || 0) + 1;
  }
  const edhrecTypes = deck.edhrecTypes ?? {};
  const typeAnalysis = TYPE_KEYS.map(type => ({
    type,
    current: actualTypes[type] || 0,
    target: edhrecTypes[type] || 0,
    delta: (actualTypes[type] || 0) - (edhrecTypes[type] || 0),
  }));

  const roleDeficits = Object.entries(roleTargets).map(([role, target]) => ({
    role,
    label: role,
    current: roleCounts[role] ?? 0,
    target,
    deficit: Math.max(0, target - (roleCounts[role] ?? 0)),
  }));

  const currentSubtypeCounts: Record<string, number> = {
    ...(deck.rampSubtypeCounts ?? {}),
    ...(deck.removalSubtypeCounts ?? {}),
    ...(deck.boardwipeSubtypeCounts ?? {}),
    ...(deck.cardDrawSubtypeCounts ?? {}),
  };

  const ctx: ScoringContext = {
    roleDeficits,
    curveAnalysis,
    typeAnalysis,
    currentSubtypeCounts,
    detectedCombos: deck.detectedCombos,
    roleCounts,
  };

  const relMap: Record<string, number> = {};
  for (const card of allCards) {
    if (BASIC_LAND_NAMES.has(card.name)) continue;
    const inclusion = inclusionMap[card.name];
    if (inclusion === undefined) { relMap[card.name] = 0; continue; }
    const meta = metaMap[card.name] ?? {};
    const pseudoEc: EDHRECCard = {
      name: card.name,
      sanitized: card.name,
      primary_type: meta.primary_type ?? '',
      inclusion,
      num_decks: 0,
      synergy: synergyMap[card.name] ?? 0,
      isThemeSynergyCard: meta.isThemeSynergyCard,
      isNewCard: meta.isNewCard,
      cmc: meta.cmc ?? card.cmc,
    };
    const role = (card.deckRole as Parameters<typeof scoreRecommendation>[1]) ?? null;
    const sub = card.rampSubtype || card.removalSubtype || card.boardwipeSubtype || card.cardDrawSubtype || null;
    let score = scoreRecommendation(pseudoEc, role, sub, ctx);
    if (isChannelLand(card)) score += CHANNEL_LAND_BOOST;
    else if (isMdfcLand(card)) score += MDFC_LAND_BOOST;
    relMap[card.name] = Math.round(score);
  }

  if (deck.cardRelevancyMap) {
    for (const [name, val] of Object.entries(deck.cardRelevancyMap)) {
      if (!(name in relMap)) relMap[name] = val;
    }
  }

  return relMap;
}
