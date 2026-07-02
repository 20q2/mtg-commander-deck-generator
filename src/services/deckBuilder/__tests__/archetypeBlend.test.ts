import { describe, it, expect } from 'vitest';
import {
  archetypeWeight,
  blendArchetypeData,
  buildArchetypeSourceLabel,
  ARCHETYPE_WEIGHT_MIN,
  ARCHETYPE_WEIGHT_MAX,
  ARCHETYPE_INJECT_CAP,
} from '../archetypeBlend';
import type { EDHRECCard, EDHRECCommanderData } from '@/types';

function card(name: string, inclusion: number, extra: Partial<EDHRECCard> = {}): EDHRECCard {
  return { name, sanitized: name.toLowerCase(), primary_type: 'Creature', inclusion, num_decks: 100, ...extra };
}

function emptyCardlists(): EDHRECCommanderData['cardlists'] {
  return { creatures: [], instants: [], sorceries: [], artifacts: [], enchantments: [], planeswalkers: [], lands: [], allNonLand: [] };
}

describe('archetypeWeight', () => {
  it('uses max weight for thin or unknown data', () => {
    expect(archetypeWeight(0)).toBe(ARCHETYPE_WEIGHT_MAX);
    expect(archetypeWeight(50)).toBe(ARCHETYPE_WEIGHT_MAX);
    expect(archetypeWeight(10)).toBe(ARCHETYPE_WEIGHT_MAX);
  });

  it('uses min weight for healthy data', () => {
    expect(archetypeWeight(500)).toBe(ARCHETYPE_WEIGHT_MIN);
    expect(archetypeWeight(50000)).toBe(ARCHETYPE_WEIGHT_MIN);
  });

  it('interpolates monotonically between the bounds', () => {
    const w150 = archetypeWeight(150);
    const w300 = archetypeWeight(300);
    expect(w150).toBeGreaterThan(w300);
    expect(w150).toBeLessThan(ARCHETYPE_WEIGHT_MAX);
    expect(w300).toBeGreaterThan(ARCHETYPE_WEIGHT_MIN);
  });
});

describe('blendArchetypeData', () => {
  it('marks overlap without touching commander inclusion', () => {
    const commanderPool = emptyCardlists();
    const shared = card('Ghostly Prison', 40);
    commanderPool.enchantments.push(shared);
    commanderPool.allNonLand.push(shared);

    const tagPool = emptyCardlists();
    tagPool.enchantments.push(card('Ghostly Prison', 75));

    const result = blendArchetypeData(commanderPool, [{ pool: tagPool, sourceLabel: 'Golgari · Pillow Fort (80 decks)' }], 1000);

    expect(result.overlapCount).toBeGreaterThan(0);
    expect(shared.archetypeOverlap).toBe(true);
    expect(shared.inclusion).toBe(40); // commander data is ground truth
    expect(shared.fromArchetype).toBeUndefined();
  });

  it('injects archetype-only cards at the adaptive discount with provenance', () => {
    const commanderPool = emptyCardlists();
    const tagPool = emptyCardlists();
    tagPool.enchantments.push(card('Propaganda', 80));

    blendArchetypeData(commanderPool, [{ pool: tagPool, sourceLabel: 'Golgari · Pillow Fort (80 decks)' }], 1000);

    expect(commanderPool.enchantments).toHaveLength(1);
    const injected = commanderPool.enchantments[0];
    expect(injected.fromArchetype).toBe(true);
    expect(injected.archetypeSource).toBe('Golgari · Pillow Fort (80 decks)');
    expect(injected.inclusion).toBeCloseTo(80 * ARCHETYPE_WEIGHT_MIN);
    // Injected non-lands also join allNonLand
    expect(commanderPool.allNonLand.map(c => c.name)).toContain('Propaganda');
  });

  it('injects near full weight when commander-theme data is thin', () => {
    const commanderPool = emptyCardlists();
    const tagPool = emptyCardlists();
    tagPool.creatures.push(card('Poison-Tip Archer', 60));

    blendArchetypeData(commanderPool, [{ pool: tagPool, sourceLabel: 'src' }], 20);

    expect(commanderPool.creatures[0].inclusion).toBeCloseTo(60 * ARCHETYPE_WEIGHT_MAX);
  });

  it('caps injection per category', () => {
    const commanderPool = emptyCardlists();
    const tagPool = emptyCardlists();
    for (let i = 0; i < ARCHETYPE_INJECT_CAP + 10; i++) {
      tagPool.creatures.push(card(`Filler ${i}`, 50 - i * 0.1));
    }

    blendArchetypeData(commanderPool, [{ pool: tagPool, sourceLabel: 'src' }], 20);

    expect(commanderPool.creatures).toHaveLength(ARCHETYPE_INJECT_CAP);
  });

  it('dedupes injections across multiple tag pools and skips null pools', () => {
    const commanderPool = emptyCardlists();
    const mk = () => {
      const p = emptyCardlists();
      p.instants.push(card('Heroic Intervention', 55));
      return p;
    };

    const result = blendArchetypeData(
      commanderPool,
      [{ pool: mk(), sourceLabel: 'a' }, null, { pool: mk(), sourceLabel: 'b' }],
      20
    );

    expect(commanderPool.instants).toHaveLength(1);
    expect(result.injectedCount).toBe(1);
  });

  it('keeps lists sorted by inclusion descending after blending', () => {
    const commanderPool = emptyCardlists();
    const low = card('Weak Card', 5);
    commanderPool.creatures.push(low);
    commanderPool.allNonLand.push(low);
    const tagPool = emptyCardlists();
    tagPool.creatures.push(card('Strong Staple', 90));

    blendArchetypeData(commanderPool, [{ pool: tagPool, sourceLabel: 'src' }], 20);

    const inclusions = commanderPool.creatures.map(c => c.inclusion);
    expect(inclusions).toEqual([...inclusions].sort((a, b) => b - a));
  });
});

describe('buildArchetypeSourceLabel', () => {
  it('formats color, theme, and deck count', () => {
    expect(buildArchetypeSourceLabel(['B', 'G'], 'Pillow Fort', 80)).toBe('Golgari · Pillow Fort (80 decks)');
  });

  it('capitalizes hyphenated color slugs', () => {
    expect(buildArchetypeSourceLabel(['W', 'U', 'B', 'R', 'G'], 'Tokens', 1234)).toContain('Five-Color · Tokens');
  });
});
