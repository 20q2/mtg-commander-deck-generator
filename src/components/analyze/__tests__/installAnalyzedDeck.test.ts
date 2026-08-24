import { describe, it, expect, beforeEach } from 'vitest';
import { installAnalyzedDeck } from '../analyzeHydration';
import { useStore } from '@/store';
import type { GeneratedDeck, ScryfallCard, ThemeResult, EDHRECTheme } from '@/types';

/**
 * Loading a deck into the Inspector must not leave the Builder's session state behind.
 *
 * `selectedThemes` and `edhrecThemes` belong to the Foundry — the theme chips it had highlighted
 * when it last built something. The Inspector's header falls back to them when the deck in front of
 * it declares none of its own, and that fallback sits ABOVE auto-detection in the chain. So a deck
 * pasted after a Foundry build wore the Foundry's themes and the classifier's own read of it never
 * surfaced. Three of the four load lanes had open-coded the same setState and each missed the
 * clear; this pins it to the one function they now share.
 */
const card = (name: string): ScryfallCard =>
  ({ id: name, oracle_id: `oid-${name}`, name, cmc: 2, type_line: 'Creature' } as ScryfallCard);

const deck = (commanderName: string): GeneratedDeck =>
  ({
    commander: card(commanderName),
    partnerCommander: null,
    categories: { creatures: [card('Some Creature')] },
  } as unknown as GeneratedDeck);

const themeResult = (name: string): ThemeResult =>
  ({ name, slug: name.toLowerCase(), source: 'edhrec', isSelected: true } as ThemeResult);

const edhrecTheme = (name: string): EDHRECTheme =>
  ({ name, slug: name.toLowerCase(), count: 100, url: '' } as EDHRECTheme);

/** The Foundry has just built something and left its theme picks in the store. */
function seedBuilderSession() {
  useStore.setState({
    commander: card('Glissa, Herald of Predation'),
    partnerCommander: null,
    colorIdentity: ['B', 'G'],
    generatedDeck: deck('Glissa, Herald of Predation'),
    selectedThemes: [themeResult('Infect'), themeResult('Proliferate')],
    edhrecThemes: [edhrecTheme('Infect'), edhrecTheme('Proliferate')],
  });
}

describe('installAnalyzedDeck', () => {
  beforeEach(seedBuilderSession);

  it('clears the builder\'s selected themes', () => {
    installAnalyzedDeck(deck('Nath of the Gilt-Leaf'), ['B', 'G']);
    expect(useStore.getState().selectedThemes).toEqual([]);
  });

  it('clears the builder\'s EDHREC theme list', () => {
    installAnalyzedDeck(deck('Nath of the Gilt-Leaf'), ['B', 'G']);
    expect(useStore.getState().edhrecThemes).toEqual([]);
  });

  it('still clears them when the commander is unchanged — a re-paste is a new deck', () => {
    installAnalyzedDeck(deck('Glissa, Herald of Predation'), ['B', 'G']);
    expect(useStore.getState().selectedThemes).toEqual([]);
  });

  it('installs the deck it was given', () => {
    const next = deck('Nath of the Gilt-Leaf');
    installAnalyzedDeck(next, ['B', 'G']);
    const s = useStore.getState();
    expect(s.generatedDeck).toBe(next);
    expect(s.commander?.name).toBe('Nath of the Gilt-Leaf');
    expect(s.colorIdentity).toEqual(['B', 'G']);
  });

  it('leaves customization alone — those are the user\'s saved preferences, not deck state', () => {
    const before = useStore.getState().customization;
    installAnalyzedDeck(deck('Nath of the Gilt-Leaf'), ['B', 'G']);
    expect(useStore.getState().customization).toBe(before);
  });
});
