import type { RoleKey } from '@/services/tagger/client';
import { ROLE_LABELS } from '@/services/deckBuilder/roleTargets';
import type { BrewContext, BrewState, BrewRoute } from './brewTypes';
import { buildHealth, isComplete, typeKey } from './health';
import { detectNearMissCombos } from './combos';
import { leaningThemes } from './identity';

const ROLE_KEYS: RoleKey[] = ['ramp', 'removal', 'boardwipe', 'cardDraw'];

interface Deficit { key: string; kind: 'role' | 'type'; label: string; deficit: number; }

function roleTitle(role: RoleKey): string {
  return role === 'cardDraw' ? 'Add Card Draw'
    : role === 'boardwipe' ? 'Add a Board Wipe'
    : `Add ${ROLE_LABELS[role] ?? role}`;
}

/** How many candidates of a given role/type remain in the pool (not yet used). */
function poolHas(ctx: BrewContext, state: BrewState, predicate: (c: BrewContext['candidates'][number]) => boolean): number {
  const used = new Set(state.usedNames);
  return ctx.candidates.filter(c => !used.has(c.name) && predicate(c)).length;
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

  const health = buildHealth(ctx, state);
  const nearMiss = detectNearMissCombos(ctx, state);

  // Collect role + type deficits.
  const deficits: Deficit[] = [];
  for (const role of ROLE_KEYS) {
    const d = (ctx.roleTargets[role] ?? 0) - (health.roleCounts[role] ?? 0);
    if (d > 0 && poolHas(ctx, state, c => c.role === role) > 0) {
      deficits.push({ key: role, kind: 'role', label: roleTitle(role), deficit: d });
    }
  }
  for (const [type, target] of Object.entries(ctx.typeTargets)) {
    const d = target - (health.typeCounts[type] ?? 0);
    if (d > 0 && poolHas(ctx, state, c => typeKey(c.scryfall.type_line) === type) > 0) {
      deficits.push({ key: type, kind: 'type', label: `Add ${type.charAt(0).toUpperCase()}${type.slice(1)}s`, deficit: d });
    }
  }
  deficits.sort((a, b) => b.deficit - a.deficit);

  const fillRatio = ctx.nonLandTarget > 0 ? nonLandPicks / ctx.nonLandTarget : 0;
  // As the deck fills, prefer multi-slot nodes (bundle/lightning) so the session converges.
  const preferMulti = fillRatio >= 0.5;

  const routes: BrewRoute[] = [];
  const leaning = leaningThemes(ctx, state);
  const leanFlavor = leaning.length > 0 ? ` Fits your ${leaning[0]} plan.` : '';

  if (nearMiss.length > 0) {
    const count = Math.min(nearMiss.length, 3);
    routes.push({
      id: 'combo',
      type: 'combo',
      title: count === 1 ? 'Complete a Combo' : 'Combos',
      description: count === 1
        ? "You're a piece away from a combo."
        : `You're a piece away from ${count} combos.`,
      targetRole: null, targetType: null, tone: 'theme', tag: 'Combo',
      fills: nearMiss[0].missing.length,
    });
  }

  // Top deficit becomes the primary "need" route. Bundle if room + preferMulti, else draft.
  if (deficits[0]) {
    const top = deficits[0];
    const asBundle = preferMulti && poolHas(ctx, state, c => matchesDeficit(c, top)) >= 6;
    routes.push({
      id: `${asBundle ? 'bundle' : 'draft'}:${top.key}`,
      type: asBundle ? 'bundle' : 'draft',
      title: top.label,
      description: (asBundle ? 'Draft a coherent package of cards for this need.' : 'Draft one card for this need.') + leanFlavor,
      targetRole: top.kind === 'role' ? (top.key as RoleKey) : null,
      targetType: top.kind === 'type' ? top.key : null,
      tone: 'need',
      tag: 'Deck needs this',
      fills: asBundle ? 3 : 1,
    });
  }

  // Second deficit becomes a secondary route.
  if (deficits[1]) {
    const second = deficits[1];
    routes.push({
      id: `draft:${second.key}`,
      type: 'draft',
      title: second.label,
      description: 'Draft one card for this need.',
      targetRole: second.kind === 'role' ? (second.key as RoleKey) : null,
      targetType: second.kind === 'type' ? second.key : null,
      tone: 'neutral',
      fills: 1,
    });
  }

  // Always offer a Lightning round once we want to fill faster, or as a third option early.
  if (preferMulti || routes.length < 2) {
    routes.push({
      id: 'lightning',
      type: 'lightning',
      title: 'Lightning Round',
      description: 'Add five solid cards in one swoop. Build momentum.',
      targetRole: null, targetType: null, tone: 'neutral', tag: '+5 cards', fills: 5,
    });
  }

  // Exhaustion fallback: if nothing meaningful can be drafted (no deficit routes and the
  // pool can't feed a lightning round), surface the mana base / finish route rather than
  // a dead-end fork. Lightning needs available non-land candidates to be useful.
  const usedSet = new Set(state.usedNames);
  const draftableLeft = ctx.candidates.some(c => !usedSet.has(c.name) && !c.isLand);
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

function matchesDeficit(c: BrewContext['candidates'][number], d: Deficit): boolean {
  return d.kind === 'role' ? c.role === d.key : typeKey(c.scryfall.type_line) === d.key;
}
