import type { DeckComposition } from '@/types';

export const BASE_DECK_COMPOSITION: DeckComposition = {
  lands: 37,
  ramp: 10,
  cardDraw: 10,
  singleRemoval: 8,
  boardWipes: 3,
  protection: 4,
  creatures: 20,
  synergy: 8,
  utility: 3,
};

// Deck format configurations
import type { DeckFormat, DeckFormatConfig } from '@/types';

export const DECK_FORMAT_CONFIGS: Record<DeckFormat, DeckFormatConfig> = {
  40: {
    size: 40,
    label: 'Brawl (40)',
    description: '39 cards + commander',
    defaultLands: 16,
    landRange: [14, 18],
    hasCommander: true,
    allowMultipleCopies: false,
  },
  60: {
    size: 60,
    label: 'Brawl (60)',
    description: '59 cards + commander',
    defaultLands: 23,
    landRange: [19, 27],
    hasCommander: true,
    allowMultipleCopies: false,
  },
  99: {
    size: 99,
    label: 'Commander (99)',
    description: '99 cards + commander',
    defaultLands: 37,
    landRange: [32, 42],
    hasCommander: true,
    allowMultipleCopies: false,
  },
};

// Helper to get format config for any deck size (known or custom)
export function getDeckFormatConfig(size: number): DeckFormatConfig {
  if (size in DECK_FORMAT_CONFIGS) {
    return DECK_FORMAT_CONFIGS[size];
  }
  // Interpolate sensible defaults for custom sizes
  const landRatio = size <= 50 ? 0.4 : size <= 70 ? 0.38 : 0.37;
  const defaultLands = Math.round((size - 1) * landRatio);
  return {
    size,
    label: `Custom (${size})`,
    description: `${size - 1} cards + commander`,
    defaultLands,
    landRange: [Math.max(1, Math.floor(defaultLands * 0.8)), Math.ceil(defaultLands * 1.2)] as [number, number],
    hasCommander: true,
    allowMultipleCopies: false,
  };
}

// Base deck composition for different formats (excluding commander/lands)
export const FORMAT_BASE_COMPOSITION: Record<DeckFormat, DeckComposition> = {
  40: {
    lands: 17,
    ramp: 2,
    cardDraw: 2,
    singleRemoval: 3,
    boardWipes: 0,
    protection: 1,
    creatures: 14,
    synergy: 2,
    utility: 0,
  },
  60: {
    lands: 24,
    ramp: 4,
    cardDraw: 4,
    singleRemoval: 4,
    boardWipes: 2,
    protection: 2,
    creatures: 16,
    synergy: 4,
    utility: 2,
  },
  99: BASE_DECK_COMPOSITION,
};
