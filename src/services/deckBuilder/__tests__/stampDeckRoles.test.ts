import { describe, it, expect, vi } from 'vitest';
import type { DeckCategory, ScryfallCard } from '@/types';

/**
 * Regression: the deck view's role badge (CN / DR / TU …) reads card.deckRole, but the
 * generator only stamped it on cards a selection stage handled itself. Cards that came
 * in through the Scryfall / collection / fallback fills were never stamped, so they
 * were counted and highlighted as Card Advantage (those counts come from live tagger
 * lookups) while their badge stayed blank.
 */

const ROLES: Record<string, string> = {
  Brainstorm: 'cardDraw',
  'Enlightened Tutor': 'cardDraw',
  'Sol Ring': 'ramp',
  'Command Tower': 'ramp',
};
const SUBTYPES: Record<string, string> = {
  Brainstorm: 'cantrip',
  'Enlightened Tutor': 'tutor',
  'Sol Ring': 'mana-rock',
  'Command Tower': 'ramp',
};

vi.mock('@/services/tagger/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/tagger/client')>();
  return {
    ...actual,
    getCardRole: (name: string) => ROLES[name] ?? null,
    hasMultipleRoles: () => false,
    getRampSubtype: (name: string) => (ROLES[name] === 'ramp' ? SUBTYPES[name] : null),
    getCardDrawSubtype: (name: string) => (ROLES[name] === 'cardDraw' ? SUBTYPES[name] : null),
    getRemovalSubtype: () => null,
    getBoardwipeSubtype: () => null,
    getProtectionSubtype: () => null,
  };
});

import { stampDeckRoles } from '../deckGenerator';

const card = (name: string, type_line: string): ScryfallCard =>
  ({ name, type_line, cmc: 1 }) as unknown as ScryfallCard;

const emptyCategories = (): Record<DeckCategory, ScryfallCard[]> => ({
  lands: [], ramp: [], cardDraw: [], singleRemoval: [],
  boardWipes: [], protection: [], creatures: [], synergy: [], utility: [],
});

describe('stampDeckRoles', () => {
  it('stamps role and subtype on non-land cards whichever category they landed in', () => {
    const categories = emptyCategories();
    const brainstorm = card('Brainstorm', 'Instant');
    const tutor = card('Enlightened Tutor', 'Instant');
    categories.synergy.push(brainstorm); // e.g. arrived through a fill that never stamps
    categories.utility.push(tutor);

    stampDeckRoles(categories);

    expect(brainstorm.deckRole).toBe('cardDraw');
    expect(brainstorm.cardDrawSubtype).toBe('cantrip');
    expect(tutor.deckRole).toBe('cardDraw');
    expect(tutor.cardDrawSubtype).toBe('tutor');
  });

  it('leaves lands alone so their utility-land tag is not displaced by a role badge', () => {
    const categories = emptyCategories();
    const tower = card('Command Tower', 'Land');
    categories.lands.push(tower);

    stampDeckRoles(categories);

    expect(tower.deckRole).toBeUndefined();
  });

  it('leaves cards with no tagger role unstamped', () => {
    const categories = emptyCategories();
    const bear = card('Grizzly Bears', 'Creature — Bear');
    categories.creatures.push(bear);

    stampDeckRoles(categories);

    expect(bear.deckRole).toBeUndefined();
  });
});
