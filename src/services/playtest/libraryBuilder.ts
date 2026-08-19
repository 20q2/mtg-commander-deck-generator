import type { ScryfallCard, GeneratedDeck } from '@/types';
import { getCardsByNames } from '@/services/scryfall/client';
import { fisherYates } from '@/components/playtest/utils';
import type { SourceInput, Zones } from '@/components/playtest/types';

export interface BuildResult {
  zones: Zones;
  commanderNames: string[];
  name: string;
  kind: 'list' | 'generated' | 'pasted' | 'shared';
}

const EMPTY_ZONES: Zones = { library: [], hand: [], graveyard: [], exile: [], command: [] };

export async function buildLibrary(input: SourceInput): Promise<BuildResult> {
  if (input.kind === 'generated') {
    return buildFromGenerated(input.deck);
  }
  if (input.kind === 'pasted') {
    return buildFromNames({
      cardNames: input.cardNames,
      commanderNames: [input.commanderName, input.partnerCommanderName].filter((n): n is string => !!n),
      // A pasted deck has no name of its own; the commander is the best handle,
      // and a commander-less paste is legal here (empty command zone).
      name: input.commanderName ?? (input.origin === 'shared' ? 'Shared deck' : 'Pasted deck'),
      kind: input.origin === 'shared' ? 'shared' : 'pasted',
    });
  }
  const { list } = input;
  return buildFromNames({
    cardNames: list.cards,
    commanderNames: [list.commanderName, list.partnerCommanderName].filter((n): n is string => !!n),
    name: list.name,
    kind: 'list',
  });
}

function buildFromGenerated(deck: GeneratedDeck): BuildResult {
  const command: ScryfallCard[] = [];
  if (deck.commander) command.push(deck.commander);
  if (deck.partnerCommander) command.push(deck.partnerCommander);

  const all = Object.values(deck.categories).flat();
  // Defensive: if commander somehow leaked into categories, drop it
  const commanderNamesSet = new Set(command.map(c => c.name));
  const libraryPool = all.filter(c => !commanderNamesSet.has(c.name));

  const library = fisherYates(libraryPool);

  return {
    zones: { ...EMPTY_ZONES, library, command },
    commanderNames: command.map(c => c.name),
    name: deck.commander?.name ?? 'Generated Deck',
    kind: 'generated',
  };
}

/**
 * Shared path for the two name-only sources (saved lists and pasted decks): fetch
 * every card, split commanders into the command zone, shuffle the rest.
 */
async function buildFromNames(args: {
  cardNames: string[];
  commanderNames: string[];
  name: string;
  kind: 'list' | 'pasted' | 'shared';
}): Promise<BuildResult> {
  const { cardNames, commanderNames, name, kind } = args;

  const allNames = Array.from(new Set([...cardNames, ...commanderNames]));
  const cardMap = await getCardsByNames(allNames);

  const command: ScryfallCard[] = [];
  for (const commanderName of commanderNames) {
    const c = cardMap.get(commanderName);
    if (c) command.push(c);
  }

  const commanderSet = new Set(commanderNames);
  // cardNames stores card NAMES with duplicates as repeated entries (no quantity field)
  const libraryPool: ScryfallCard[] = [];
  for (const cardName of cardNames) {
    if (commanderSet.has(cardName)) continue; // commanders go to command zone, not library
    const c = cardMap.get(cardName);
    if (c) libraryPool.push(c);
  }

  const library = fisherYates(libraryPool);

  return {
    zones: { ...EMPTY_ZONES, library, command },
    commanderNames,
    name,
    kind,
  };
}
