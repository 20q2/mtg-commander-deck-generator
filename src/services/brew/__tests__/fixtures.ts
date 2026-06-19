import type { ScryfallCard, EDHRECCard } from '@/types';
import type { RoleKey } from '@/services/tagger/client';
import type { BrewCandidate, BrewContext, BrewState } from '../brewTypes';

export function makeScryfall(over: Partial<ScryfallCard> & { name: string }): ScryfallCard {
  const slug = over.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  return {
    id: slug,
    oracle_id: slug + '-oracle',
    cmc: 2,
    type_line: 'Creature — Test',
    color_identity: ['G'],
    keywords: [],
    rarity: 'common',
    set: 'tst',
    set_name: 'Test Set',
    prices: { usd: '1.00' },
    legalities: { commander: 'legal' },
    ...over,
  } as ScryfallCard;
}

export function makeEdhrec(over: Partial<EDHRECCard> & { name: string }): EDHRECCard {
  return {
    sanitized: over.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    primary_type: 'Creature',
    inclusion: 50,
    num_decks: 1000,
    synergy: 0.2,
    ...over,
  };
}

export function makeCandidate(
  name: string,
  opts: { role?: RoleKey | null; subtype?: string | null; inclusion?: number; cmc?: number;
          type_line?: string; primary_type?: string; price?: string; isLand?: boolean;
          isThemeSynergyCard?: boolean; themeTags?: string[];
          discoveredVia?: string; coSynergy?: number;
          discoverySource?: 'lift' | 'coplay' | 'similar' } = {},
): BrewCandidate {
  const inclusion = opts.inclusion ?? 50;
  return {
    name,
    edhrec: makeEdhrec({ name, inclusion, primary_type: opts.primary_type ?? 'Creature',
      cmc: opts.cmc, isThemeSynergyCard: opts.isThemeSynergyCard }),
    scryfall: makeScryfall({ name, cmc: opts.cmc ?? 2, type_line: opts.type_line ?? 'Creature — Test',
      prices: { usd: opts.price ?? '1.00' }, isThemeSynergyCard: opts.isThemeSynergyCard }),
    role: opts.role ?? null,
    subtype: opts.subtype ?? null,
    inclusion,
    isLand: opts.isLand ?? false,
    themeTags: opts.themeTags ?? [],
    discoveredVia: opts.discoveredVia,
    coSynergy: opts.coSynergy,
    discoverySource: opts.discoverySource,
  };
}

export function makeContext(over: Partial<BrewContext> = {}): BrewContext {
  return {
    commander: makeScryfall({ name: 'Test Commander', type_line: 'Legendary Creature' }),
    partnerCommander: null,
    colorIdentity: ['G', 'W', 'B'],
    customization: {} as BrewContext['customization'],
    candidates: over.candidates ?? [],
    roleTargets: over.roleTargets ?? { ramp: 10, removal: 8, boardwipe: 3, cardDraw: 10 },
    typeTargets: over.typeTargets ?? { creature: 30, instant: 8, sorcery: 8, artifact: 6, enchantment: 5, planeswalker: 1 },
    curveTargets: over.curveTargets ?? { 1: 8, 2: 14, 3: 14, 4: 10, 5: 6, 6: 3, 7: 3 },
    landTarget: over.landTarget ?? 36,
    nonLandTarget: over.nonLandTarget ?? 63,
    combos: over.combos ?? [],
    themeNames: over.themeNames ?? {},
    themeSignatures: over.themeSignatures ?? {},
    ...over,
  };
}

export function makeState(over: Partial<BrewState> = {}): BrewState {
  return {
    picks: [],
    usedNames: [],
    themeAffinity: {},
    rerollsUsed: {},
    phase: 'nonland',
    history: [],
    discovered: [],
    seededNames: [],
    questionsAsked: 0,
    relics: [],
    comboWatch: [],
    firedEventIds: [],
    lastMomentPick: 0,
    moments: [],
    ...over,
  };
}
