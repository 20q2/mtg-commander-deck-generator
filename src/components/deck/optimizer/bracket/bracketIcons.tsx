import {
  Zap, Infinity as InfinityIcon, Mountain, Hourglass, FileSearch,
  Gauge, TrendingDown, Swords, type LucideIcon,
} from 'lucide-react';
import type { SoftKey } from './bracketViewModel';

/**
 * Subject icons for the bracket panel.
 *
 * These identify *what is being measured*; the coloured bracket number beside
 * them says what it means. Two jobs, two marks — the icon is what your eye
 * finds, the number is what it tells you.
 *
 * Reused rather than invented where the app already has a meaning:
 *   Infinity  — combos, everywhere from ComboDisplay to the brew screens
 *   Mountain  — lands
 *   Swords    — the removal role (see ROLE_ICON in DeckBuildingArea)
 * Deliberately avoided: Sparkles (reserved), Tags (theme picker),
 * Telescope (archetype), Crown (commander).
 */
export const GATE_ICON: Record<string, LucideIcon> = {
  gameChangers: Zap,          // warps the game the turn it resolves
  combos:       InfinityIcon,
  landDenial:   Mountain,
  extraTurns:   Hourglass,
  tutorDensity: FileSearch,   // go and find it in your library
};

export const CRITERION_ICON: Record<SoftKey, LucideIcon> = {
  fastMana:    Gauge,         // how quickly the deck gets going
  tutors:      FileSearch,    // echoes the tutor-density gate on purpose
  cmc:         TrendingDown,  // a lower curve scores higher
  interaction: Swords,
};
