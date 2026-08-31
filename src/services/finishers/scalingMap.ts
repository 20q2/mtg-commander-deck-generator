/**
 * The one hand-written surface in the finisher model.
 *
 * `drain-static` cards each scale on a DIFFERENT board quantity — Gray Merchant on devotion,
 * Corrupt on Swamps, Blood Artist on deaths — and no oracle tag distinguishes them. This map says
 * which. It will always be incomplete; cards outside it resolve to `unknown` and are reported as
 * UNKNOWN with an explicit reason rather than silently scoring zero.
 *
 * `alt-win` cards get their precondition NAMED rather than evaluated. Checking "can this deck
 * actually empty its library" is a different and much harder problem, so the lab prints the
 * condition and lets you eyeball it.
 */

import type { DeckFuel } from '@/types';

export type ScalingVar =
  | 'devotion-w' | 'devotion-u' | 'devotion-b' | 'devotion-r' | 'devotion-g'
  | 'creatures'
  | 'swamps'
  | 'flat'
  | 'deaths'          // not modelled — needs a sac-loop simulation
  | 'lifegain-events' // not modelled — needs a lifegain-trigger count
  | 'unknown';

export interface ScalingRule { variable: ScalingVar; amount?: number }

/** Card name → what its drain scales on. */
export const SCALING_MAP: Record<string, ScalingRule> = {
  'Gray Merchant of Asphodel': { variable: 'devotion-b' },
  'Corrupt': { variable: 'swamps' },
  'Tendrils of Corruption': { variable: 'swamps' },
  'Kokusho, the Evening Star': { variable: 'flat', amount: 5 },
  'Blood Artist': { variable: 'deaths' },
  'Zulaport Cutthroat': { variable: 'deaths' },
  'Falkenrath Noble': { variable: 'deaths' },
  'Bastion of Remembrance': { variable: 'deaths' },
  'Cruel Celebrant': { variable: 'deaths' },
  'Vito, Thorn of the Dusk Rose': { variable: 'lifegain-events' },
  'Sanguine Bond': { variable: 'lifegain-events' },
  'Marauding Blight-Priest': { variable: 'lifegain-events' },
  'Epicure of Blood': { variable: 'lifegain-events' },
};

/** Card name → the condition it needs, printed verbatim in the lab. */
export const ALT_WIN_CONDITIONS: Record<string, string> = {
  "Thassa's Oracle": 'library empty or near-empty when it enters',
  'Laboratory Maniac': 'draw from an empty library',
  'Jace, Wielder of Mysteries': 'draw from an empty library',
  'Approach of the Second Sun': 'cast it twice, 7 mana each',
  'Felidar Sovereign': '40+ life at your upkeep',
  'Test of Endurance': '50+ life at your upkeep',
  'Revel in Riches': '10 Treasures at your upkeep',
  'Mechanized Production': '8 copies of one artifact',
  'Coalition Victory': 'all five colors on lands and creatures',
  "Maze's End": '10 Gates',
  'Simic Ascendancy': '20 growth counters',
  'Helix Pinnacle': '100 tower counters',
  'Darksteel Reactor': '20 charge counters',
  "Azor's Elocutors": '5 filibuster counters',
  'Chance Encounter': '10 luck counters',
  'Near-Death Experience': 'exactly 1 life at your upkeep',
  'Barren Glory': 'empty board and hand at your upkeep',
  'Epic Struggle': '20 creatures at your upkeep',
  'Happily Ever After': 'all five colors, 5+ card types, 50+ life',
  'Aetherflux Reservoir': '50+ life to pay for the 50-damage blast',
};

/** Resolve a scaling variable against the deck. `null` means "not modelled". */
export function resolveScaling(rule: ScalingRule, fuel: DeckFuel): number | null {
  switch (rule.variable) {
    case 'devotion-w': return fuel.devotion.W ?? 0;
    case 'devotion-u': return fuel.devotion.U ?? 0;
    case 'devotion-b': return fuel.devotion.B ?? 0;
    case 'devotion-r': return fuel.devotion.R ?? 0;
    case 'devotion-g': return fuel.devotion.G ?? 0;
    case 'creatures': return fuel.creatureCount;
    case 'swamps': return fuel.swampCount;
    case 'flat': return rule.amount ?? 0;
    default: return null; // deaths / lifegain-events / unknown
  }
}

/** Prose for the workings column when a variable isn't modelled. */
export function unmodelledReason(v: ScalingVar): string {
  if (v === 'deaths') return 'scales on creature deaths — needs a sac-loop model';
  if (v === 'lifegain-events') return 'scales on lifegain triggers — not counted yet';
  return 'scaling variable not in the curated map';
}
