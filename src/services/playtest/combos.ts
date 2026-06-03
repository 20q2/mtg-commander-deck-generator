import type { DetectedCombo, EDHRECCombo } from '@/types';
import { fetchCommanderCombos, fetchColorIdentityCombos } from '@/services/edhrec/client';
import type { SourceInput } from '@/components/playtest/types';

/**
 * Resolves the combos in this deck. For generated decks we already have a
 * `detectedCombos` array on the deck object (now includes off-commander combos).
 * For saved lists we re-run the same EDHREC commander-combo lookup + color-identity
 * combo lookup + deck-membership detection that ListDeckView uses, against the
 * union of every card name in the list.
 */
export async function resolveCombos(input: SourceInput): Promise<DetectedCombo[]> {
  if (input.kind === 'generated') {
    return input.deck.detectedCombos ?? [];
  }
  const list = input.list;
  if (!list.commanderName) return [];
  const allNames = new Set<string>([
    ...list.cards,
    list.commanderName,
    ...(list.partnerCommanderName ? [list.partnerCommanderName] : []),
  ]);
  try {
    const [commanderRaw, colorRaw] = await Promise.all([
      fetchCommanderCombos(list.commanderName).catch(() => [] as EDHRECCombo[]),
      fetchColorIdentityCombos(list.cachedColorIdentity ?? []).catch(() => [] as EDHRECCombo[]),
    ]);
    const commanderCombos: EDHRECCombo[] = commanderRaw.map(c => ({ ...c, source: 'commander' as const }));
    const colorCombos: EDHRECCombo[] = colorRaw.map(c => ({ ...c, source: 'color-identity' as const }));

    // Merge, dedupe by comboId — commander source wins on collision.
    const byId = new Map<string, EDHRECCombo>();
    for (const c of commanderCombos) byId.set(c.comboId, c);
    for (const c of colorCombos) if (!byId.has(c.comboId)) byId.set(c.comboId, c);

    return detectCombosInDeck([...byId.values()], allNames, list.commanderName, list.partnerCommanderName);
  } catch {
    return [];
  }
}

function detectCombosInDeck(
  combos: EDHRECCombo[],
  allCardNames: Set<string>,
  commanderName?: string,
  partnerName?: string,
): DetectedCombo[] {
  const detected = combos
    .map(combo => {
      const comboCardNames = combo.cards.map(c => c.name);
      const missingCards = comboCardNames.filter(name => !allCardNames.has(name));
      const source = combo.source ?? 'commander';
      return {
        comboId: combo.comboId,
        cards: comboCardNames,
        results: combo.results,
        isComplete: missingCards.length === 0,
        missingCards,
        deckCount: combo.deckCount,
        bracket: combo.bracket,
        source,
      } as DetectedCombo;
    })
    .filter(dc => dc.isComplete || dc.missingCards.length <= 2);

  const commanderSet = new Set<string>();
  if (commanderName) {
    commanderSet.add(commanderName);
    if (commanderName.includes(' // ')) commanderSet.add(commanderName.split(' // ')[0]);
  }
  if (partnerName) {
    commanderSet.add(partnerName);
    if (partnerName.includes(' // ')) commanderSet.add(partnerName.split(' // ')[0]);
  }

  detected.sort((a, b) => {
    if (a.isComplete !== b.isComplete) return a.isComplete ? -1 : 1;
    const aHasCommander = a.cards.some(n => commanderSet.has(n));
    const bHasCommander = b.cards.some(n => commanderSet.has(n));
    if (aHasCommander !== bHasCommander) return aHasCommander ? -1 : 1;
    return b.deckCount - a.deckCount;
  });

  return detected;
}
