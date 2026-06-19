import type { RoleKey } from '@/services/tagger/client';
import { hasTag, isTutor } from '@/services/tagger/client';
import type { BrewContext, BrewState } from './brewTypes';
import { typeKey } from './health';

export interface RadarAxis { key: string; label: string; current: number; target: number; fill: number; }
export interface CurveBar { cmc: number; current: number; target: number; }
export interface TypeBar { key: string; current: number; target: number; }
export interface DeckStats { radar: RadarAxis[]; curve: CurveBar[]; types: TypeBar[]; rounded: boolean; }

const TUTOR_TARGET = 4;
const PROTECTION_TARGET = 3;
const ROUNDED_THRESHOLD = 0.66;

// Canonical card-type order for the "card types" bars. Lands are the mana base (their own node) and
// the curve already covers nonland counts by CMC, so they're omitted here.
const TYPE_ORDER = ['creature', 'instant', 'sorcery', 'artifact', 'enchantment', 'planeswalker', 'battle'];

const ROLE_AXES: { key: RoleKey; label: string }[] = [
  { key: 'ramp', label: 'Ramp' },
  { key: 'removal', label: 'Removal' },
  { key: 'boardwipe', label: 'Wipes' },
  { key: 'cardDraw', label: 'Draw' },
];

function axis(key: string, label: string, current: number, target: number): RadarAxis {
  return { key, label, current, target, fill: target > 0 ? Math.min(1, current / target) : 0 };
}

/**
 * The "Your deck so far" snapshot: a six-axis radar (role coverage + tutors/protection) and the
 * current-vs-expected mana curve. Pure; derived entirely from picks + ctx targets.
 */
export function computeDeckStats(ctx: BrewContext, state: BrewState): DeckStats {
  const roleCounts: Record<string, number> = { ramp: 0, removal: 0, boardwipe: 0, cardDraw: 0 };
  let tutors = 0;
  let protection = 0;
  const curveCurrent: Record<number, number> = {};
  const typeCurrent: Record<string, number> = {};

  for (const p of state.picks) {
    if (p.role && roleCounts[p.role] !== undefined) roleCounts[p.role] += 1;
    if (isTutor(p.name)) tutors += 1;
    if (hasTag(p.name, 'protection')) protection += 1;
    const tk = typeKey(p.card.type_line);
    typeCurrent[tk] = (typeCurrent[tk] ?? 0) + 1;
    if (tk !== 'land') {
      const bucket = Math.min(7, Math.round(p.card.cmc ?? 0));
      curveCurrent[bucket] = (curveCurrent[bucket] ?? 0) + 1;
    }
  }

  const radar: RadarAxis[] = [
    ...ROLE_AXES.map(a => axis(a.key, a.label, roleCounts[a.key], ctx.roleTargets[a.key] ?? 0)),
    axis('tutor', 'Tutors', tutors, TUTOR_TARGET),
    axis('protection', 'Protection', protection, PROTECTION_TARGET),
  ];

  const curve: CurveBar[] = Object.keys(ctx.curveTargets)
    .map(Number)
    .sort((a, b) => a - b)
    .map(cmc => ({ cmc, current: curveCurrent[cmc] ?? 0, target: ctx.curveTargets[cmc] }));

  // Card-type coverage: each targeted type (and any type we've picked into) as a current-vs-target bar.
  const types: TypeBar[] = TYPE_ORDER
    .filter(key => (ctx.typeTargets[key] ?? 0) > 0 || (typeCurrent[key] ?? 0) > 0)
    .map(key => ({ key, current: typeCurrent[key] ?? 0, target: ctx.typeTargets[key] ?? 0 }));

  const rounded = radar.every(a => a.fill >= ROUNDED_THRESHOLD);
  return { radar, curve, types, rounded };
}
