import type { RoleKey } from '@/services/tagger/client';
import type { ScryfallCard } from '@/types';
import { getCardPrice } from '@/services/scryfall/client';
import type { BrewContext, BrewState, BrewHealth } from './brewTypes';

const ROLE_KEYS: RoleKey[] = ['ramp', 'removal', 'boardwipe', 'cardDraw', 'protection'];

/** Map a Scryfall/EDHREC primary type to a typeTargets key. */
export function typeKey(typeLine: string): string {
  const t = typeLine.toLowerCase();
  if (t.includes('creature')) return 'creature';
  if (t.includes('instant')) return 'instant';
  if (t.includes('sorcery')) return 'sorcery';
  if (t.includes('artifact')) return 'artifact';
  if (t.includes('enchantment')) return 'enchantment';
  if (t.includes('planeswalker')) return 'planeswalker';
  if (t.includes('land')) return 'land';
  return 'other';
}

/** The full candidate pool: the setup pool plus any cards discovered mid-session. */
export function pool(ctx: BrewContext, state: BrewState): BrewContext['candidates'] {
  return state.discovered.length > 0 ? [...ctx.candidates, ...state.discovered] : ctx.candidates;
}

function priceUsd(card: ScryfallCard): number {
  return parseFloat(getCardPrice(card) ?? '') || 0;
}

export function buildHealth(ctx: BrewContext, state: BrewState): BrewHealth {
  const roleCounts: Record<RoleKey, number> = { ramp: 0, removal: 0, boardwipe: 0, cardDraw: 0, protection: 0 };
  const typeCounts: Record<string, number> = {};
  let deckScore = 0;
  let estCostUsd = 0;
  let themeCards = 0;

  for (const p of state.picks) {
    if (p.role && ROLE_KEYS.includes(p.role)) roleCounts[p.role] += 1;
    const tk = typeKey(p.card.type_line);
    typeCounts[tk] = (typeCounts[tk] ?? 0) + 1;
    deckScore += p.inclusion;
    estCostUsd += priceUsd(p.card);
    // theme density uses the EDHREC theme-synergy flag stamped on the scryfall card if present
    if (p.card.isThemeSynergyCard) themeCards += 1;
  }

  // curve verdict: compare avg cmc of picks vs a healthy band
  const nonLandPicks = state.picks.filter(p => typeKey(p.card.type_line) !== 'land');
  const avgCmc = nonLandPicks.length
    ? nonLandPicks.reduce((s, p) => s + (p.card.cmc ?? 0), 0) / nonLandPicks.length
    : 0;
  const curveVerdict: BrewHealth['curveVerdict'] =
    avgCmc === 0 ? 'healthy' : avgCmc < 2.4 ? 'low' : avgCmc > 3.4 ? 'high' : 'healthy';

  const cardCount = state.picks.length;
  const themeDensity = cardCount ? Math.round((themeCards / cardCount) * 100) : 0;

  return {
    cardCount,
    nonLandTarget: ctx.nonLandTarget,
    deckScore,
    roleCounts,
    roleTargets: ctx.roleTargets,
    typeCounts,
    typeTargets: ctx.typeTargets,
    estCostUsd,
    themeDensity,
    curveVerdict,
  };
}

/**
 * Tolerance: nonland targets are "satisfied" when picks reach this share of nonLandTarget.
 * Deliberately below 1.0 so the run ends a touch sooner (less decision fatigue) and hands more of
 * the deck to generateDeck — which, post-WS1, now fills that tail in line with the run's identity.
 */
export const NONLAND_COMPLETE_RATIO = 0.85;

export function isComplete(ctx: BrewContext, state: BrewState): boolean {
  if (state.phase === 'done') return true;
  // Engine considers the nonland phase finishable once we've nearly hit the nonland target.
  const nonLandPicks = state.picks.filter(p => !p.card.type_line.toLowerCase().includes('land')).length;
  return nonLandPicks >= Math.floor(ctx.nonLandTarget * NONLAND_COMPLETE_RATIO);
}
