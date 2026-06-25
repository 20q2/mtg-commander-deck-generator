import type { EDHRECCombo, DetectedCombo } from '@/types';

/**
 * Build a card-name → combos map for SpellChroma previews.
 *
 * SpellChroma decks have no commander, so combos come from the color-identity
 * combo page (fetchColorIdentityCombos). Every combo is mapped onto each of its
 * cards — we don't filter by how many pieces are missing, since the point here
 * is discovery: "this card is a piece in these combos." Completeness is measured
 * against the currently-loaded deck (if any) so combos already assembled in the
 * deck surface as complete; the rest show as potential.
 */
export function buildCardComboMap(
  combos: EDHRECCombo[],
  deckNames: Set<string>,
): Map<string, DetectedCombo[]> {
  const map = new Map<string, DetectedCombo[]>();
  for (const combo of combos) {
    const comboCardNames = combo.cards.map(c => c.name);
    const missingCards = comboCardNames.filter(n => !deckNames.has(n));
    const detected: DetectedCombo = {
      comboId: combo.comboId,
      cards: comboCardNames,
      results: combo.results,
      isComplete: missingCards.length === 0,
      missingCards,
      deckCount: combo.deckCount,
      bracket: combo.bracket,
      source: combo.source ?? 'color-identity',
    };
    for (const name of comboCardNames) {
      const front = name.includes(' // ') ? name.split(' // ')[0] : name;
      const existing = map.get(front);
      if (existing) existing.push(detected);
      else map.set(front, [detected]);
    }
  }
  return map;
}
