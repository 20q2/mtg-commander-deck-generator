import { ROLE_LABELS } from '@/services/deckBuilder/roleTargets';
import type { BrewContext, BrewState, BrewRoute, BrewNode, BrewOption, BrewCandidate, PickReason } from './brewTypes';
import { scoreCandidate } from './scoring';
import { buildHealth } from './health';

const DRAFT_OPTIONS = 5;
const BUNDLE_SIZE = 3;
const LIGHTNING_PICKS = 5;

function availableFor(ctx: BrewContext, state: BrewState, route: BrewRoute): BrewCandidate[] {
  const used = new Set(state.usedNames);
  const pool = ctx.candidates.filter(c => !used.has(c.name) && !c.isLand);
  const matches = pool.filter(c => {
    if (route.targetRole) return c.role === route.targetRole;
    if (route.targetType) return c.scryfall.type_line.toLowerCase().includes(route.targetType);
    return true; // lightning/gamble: whole pool
  });
  // Score and sort desc. (Plan 2 passes real matchingTags; here affinity is empty.)
  return [...matches].sort((a, b) => scoreCandidate(ctx, state, b) - scoreCandidate(ctx, state, a));
}

export function deriveReasons(ctx: BrewContext, state: BrewState, c: BrewCandidate): PickReason[] {
  const reasons: PickReason[] = [];
  reasons.push({ kind: 'synergy', label: `Synergy ${Math.round(c.inclusion)}`, value: c.inclusion });
  if (c.role) {
    const health = buildHealth(ctx, state);
    const deficit = (ctx.roleTargets[c.role] ?? 0) - (health.roleCounts[c.role] ?? 0);
    if (deficit > 0) reasons.push({ kind: 'role', label: `Fills ${ROLE_LABELS[c.role] ?? c.role}`, value: deficit });
  }
  if (c.edhrec.isThemeSynergyCard) reasons.push({ kind: 'theme', label: 'On-theme', value: 1 });
  return reasons;
}

function toOption(ctx: BrewContext, state: BrewState, cards: BrewCandidate[], id: string, label?: string): BrewOption {
  return { id, label, cards, reasons: cards.map(c => deriveReasons(ctx, state, c)) };
}

/** Group candidates into themed bundles by their subtype (fallback: sequential chunks). */
function buildBundles(ctx: BrewContext, state: BrewState, pool: BrewCandidate[]): BrewOption[] {
  const bySubtype = new Map<string, BrewCandidate[]>();
  for (const c of pool) {
    const key = c.subtype ?? 'mixed';
    if (!bySubtype.has(key)) bySubtype.set(key, []);
    bySubtype.get(key)!.push(c);
  }
  const groups = [...bySubtype.entries()].filter(([, cs]) => cs.length >= 2);
  const bundles: BrewOption[] = [];
  for (const [subtype, cs] of groups.slice(0, 3)) {
    bundles.push(toOption(ctx, state, cs.slice(0, BUNDLE_SIZE), `bundle:${subtype}`, labelForSubtype(subtype)));
  }
  // Fallback: if fewer than 2 coherent bundles, chunk the top pool into 2 generic bundles.
  if (bundles.length < 2) {
    const top = pool.slice(0, BUNDLE_SIZE * 2);
    return [
      toOption(ctx, state, top.slice(0, BUNDLE_SIZE), 'bundle:a', 'Top Picks'),
      toOption(ctx, state, top.slice(BUNDLE_SIZE, BUNDLE_SIZE * 2), 'bundle:b', 'Alternatives'),
    ].filter(o => o.cards.length >= 2);
  }
  return bundles;
}

function labelForSubtype(subtype: string): string {
  const map: Record<string, string> = {
    'spot-removal': 'Spot Removal', counterspell: 'Counterspells', bounce: 'Bounce',
    tutor: 'Tutors', wheel: 'Wheels', cantrip: 'Cantrips', 'card-draw': 'Card Draw',
    'mana-rock': 'Mana Rocks', 'mana-producer': 'Mana Dorks', 'cost-reducer': 'Cost Reducers',
    mixed: 'Mixed',
  };
  return map[subtype] ?? subtype;
}

export function openNode(ctx: BrewContext, state: BrewState, route: BrewRoute): BrewNode {
  const pool = availableFor(ctx, state, route);

  if (route.type === 'bundle') {
    return { routeId: route.id, type: 'bundle', prompt: `${route.title} — pick a package`,
      options: buildBundles(ctx, state, pool), canPass: false };
  }

  if (route.type === 'lightning') {
    return { routeId: route.id, type: 'lightning', prompt: 'Lightning Round — take one',
      options: pool.slice(0, DRAFT_OPTIONS).map((c, i) => toOption(ctx, state, [c], `lr:${i}`)),
      picksRemaining: LIGHTNING_PICKS, canPass: false };
  }

  if (route.type === 'gamble') {
    return { routeId: route.id, type: 'gamble', prompt: `${route.title} — take the bomb or pass`,
      options: pool.slice(0, 1).map((c, i) => toOption(ctx, state, [c], `g:${i}`)), canPass: true };
  }

  // draft (and combo handled in Plan 3): pick 1 of ~5
  return { routeId: route.id, type: route.type, prompt: `${route.title} — take one`,
    options: pool.slice(0, DRAFT_OPTIONS).map((c, i) => toOption(ctx, state, [c], `d:${i}`)), canPass: false };
}
