import type { RoleKey } from '@/services/tagger/client';
import { ROLE_LABELS } from '@/services/deckBuilder/roleTargets';
import type { BrewContext, BrewState, BrewRoute } from './brewTypes';
import { buildHealth, isComplete, typeKey, pool } from './health';
import { detectNearMissCombos } from './combos';
import { leaningThemes } from './identity';

const ROLE_KEYS: RoleKey[] = ['ramp', 'removal', 'boardwipe', 'cardDraw'];

export interface Deficit {
  key: string;
  kind: 'role' | 'type';
  label: string;        // route title, e.g. "Add Removal"
  shortLabel: string;   // pack label, e.g. "Removal"
  deficit: number;
  current: number;      // how many of this role/type are already picked
  target: number;       // the role/type target
}

function roleTitle(role: RoleKey): string {
  return role === 'cardDraw' ? 'Add Card Draw'
    : role === 'boardwipe' ? 'Add a Board Wipe'
    : `Add ${ROLE_LABELS[role] ?? role}`;
}

// Why each category matters — flavor that teaches the deckbuilding role, not just "draft a card".
const ROLE_FLAVOR: Record<RoleKey, string> = {
  ramp: 'Ramp accelerates your mana so your threats land a turn ahead of the table.',
  removal: 'Spot removal answers the one card that would otherwise take over the game.',
  boardwipe: "A board wipe is your reset button — sweep the table when you've fallen behind.",
  cardDraw: 'Card draw refills your hand so you never run out of gas.',
};
const TYPE_FLAVOR: Record<string, string> = {
  creature: 'Creatures carry your attack and defense — the bodies that actually win the game.',
  instant: "Instants let you act on your opponents' turns: respond, protect, and set the pace.",
  sorcery: 'Sorceries deliver your biggest, game-swinging main-phase effects.',
  artifact: 'Artifacts add colorless utility and ramp that slot into any plan.',
  enchantment: 'Enchantments stick to the table and grind out value turn after turn.',
  planeswalker: 'Planeswalkers churn out advantage every turn and force answers.',
  battle: 'Battles drag the table into fights on your terms.',
  land: 'Lands fix and grow the mana base everything else runs on.',
};
function deficitFlavor(d: Deficit): string {
  return d.kind === 'role'
    ? ROLE_FLAVOR[d.key as RoleKey]
    : (TYPE_FLAVOR[d.key] ?? 'Shore up this part of your deck.');
}

/** How many candidates of a given role/type remain in the pool (not yet used). */
function poolHas(ctx: BrewContext, state: BrewState, predicate: (c: BrewContext['candidates'][number]) => boolean): number {
  const used = new Set(state.usedNames);
  return pool(ctx, state).filter(c => !used.has(c.name) && predicate(c)).length;
}

/** Plural, Capitalized type label ("sorcery" → "Sorceries"). */
function typeLabel(type: string): string {
  const plural = type.endsWith('y') ? `${type.slice(0, -1)}ies` : `${type}s`;
  return `${plural.charAt(0).toUpperCase()}${plural.slice(1)}`;
}

/**
 * Role + type deficits the pool can actually fill, biggest gap first. Shared by the fork (to flavor
 * the pack route) and the pack builder (to compose the "need" pack).
 */
export function computeDeficits(ctx: BrewContext, state: BrewState): Deficit[] {
  const health = buildHealth(ctx, state);
  const deficits: Deficit[] = [];
  for (const role of ROLE_KEYS) {
    const target = ctx.roleTargets[role] ?? 0;
    const current = health.roleCounts[role] ?? 0;
    const d = target - current;
    if (d > 0 && poolHas(ctx, state, c => c.role === role) > 0) {
      deficits.push({ key: role, kind: 'role', label: roleTitle(role), shortLabel: ROLE_LABELS[role] ?? role, deficit: d, current, target });
    }
  }
  for (const [type, target] of Object.entries(ctx.typeTargets)) {
    const current = health.typeCounts[type] ?? 0;
    const d = target - current;
    if (d > 0 && poolHas(ctx, state, c => typeKey(c.scryfall.type_line) === type) > 0) {
      deficits.push({ key: type, kind: 'type', label: `Add ${typeLabel(type)}`, shortLabel: typeLabel(type), deficit: d, current, target });
    }
  }
  deficits.sort((a, b) => b.deficit - a.deficit);
  return deficits;
}

export function nextRoutes(ctx: BrewContext, state: BrewState): BrewRoute[] {
  // Phase transition: once nonland targets are essentially met, only offer the mana base.
  const nonLandPicks = state.picks.filter(p => !p.card.type_line.toLowerCase().includes('land')).length;
  if (state.phase !== 'lands' && isComplete(ctx, state)) {
    return [{
      id: 'manabase', type: 'manabase', title: 'Build the Mana Base',
      description: 'Choose a land style; we fill the rest to a clean curve.',
      targetRole: null, targetType: null, tone: 'neutral', fills: ctx.landTarget,
    }];
  }

  const nearMiss = detectNearMissCombos(ctx, state);
  const deficits = computeDeficits(ctx, state);

  const fillRatio = ctx.nonLandTarget > 0 ? nonLandPicks / ctx.nonLandTarget : 0;
  // As the deck fills, offer the rapid-fill Lightning round so the session converges.
  const preferMulti = fillRatio >= 0.5;

  const routes: BrewRoute[] = [];
  const leaning = leaningThemes(ctx, state);
  const leanFlavor = leaning.length > 0 ? ` Leaning into ${leaning[0]}.` : '';

  if (nearMiss.length > 0) {
    const count = Math.min(nearMiss.length, 3);
    routes.push({
      id: 'combo',
      type: 'combo',
      title: count === 1 ? 'Complete a Combo' : 'Combos',
      description: count === 1
        ? "Pop off and go infinite — you're one piece away from your engine."
        : `Pop off and go infinite — ${count} combos are within reach.`,
      targetRole: null, targetType: null, tone: 'theme', tag: 'Combo',
      fills: nearMiss[0].missing.length,
    });
  }

  // The primary way to pick is to open a package: one screen, three directions (a need, your
  // emerging theme, a hidden-synergy find) — pick a whole pack, not a single card.
  const usedSet = new Set(state.usedNames);
  const draftableLeft = pool(ctx, state).some(c => !usedSet.has(c.name) && !c.isLand);
  const topNeed = deficits[0];
  if (draftableLeft) {
    routes.push({
      id: 'bundle:pack',
      type: 'bundle',
      title: 'Open a Pack',
      description: topNeed ? `${deficitFlavor(topNeed)}${leanFlavor}` : `Three packages, three directions — pick what fits.${leanFlavor}`,
      targetRole: topNeed?.kind === 'role' ? (topNeed.key as RoleKey) : null,
      targetType: topNeed?.kind === 'type' ? topNeed.key : null,
      tone: 'need',
      tag: '3 cards',
      fills: 3,
    });
  }

  // Lightning fill — rapid convergence once the deck has shape, or as a second option early.
  if (preferMulti || routes.length < 2) {
    routes.push({
      id: 'lightning',
      type: 'lightning',
      title: 'Lightning Round',
      description: 'Add five solid cards in one swoop. Build momentum.',
      targetRole: null, targetType: null, tone: 'neutral', tag: '+5 cards', fills: 5,
    });
  }

  // Exhaustion fallback: if nothing meaningful can be drafted (no pack route and the pool can't
  // feed a lightning round), surface the mana base / finish route rather than a dead-end fork.
  const hasRealRoute = routes.some(r => r.type !== 'lightning') || draftableLeft;
  if (!hasRealRoute) {
    return [{
      id: 'manabase', type: 'manabase', title: 'Build the Mana Base',
      description: 'No more cards to draft — finish the deck and fill the mana base.',
      targetRole: null, targetType: null, tone: 'neutral', fills: ctx.landTarget,
    }];
  }

  return routes.slice(0, 3);
}

export function matchesDeficit(c: BrewContext['candidates'][number], d: Deficit): boolean {
  return d.kind === 'role' ? c.role === d.key : typeKey(c.scryfall.type_line) === d.key;
}
