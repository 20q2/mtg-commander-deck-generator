import { ROLE_LABELS } from '@/services/deckBuilder/roleTargets';
import type { BrewContext, BrewState, BrewRoute, BrewNode, BrewOption, BrewCandidate, PickReason } from './brewTypes';
import { scoreCandidate } from './scoring';
import { buildHealth, typeKey } from './health';
import { detectNearMissCombos } from './combos';

const DRAFT_OPTIONS = 5;
const BUNDLE_SIZE = 3;
const LIGHTNING_PICKS = 5;
const PAYOFF_MAX = 40;

/** A short, single-line payoff tag for a combo (its first result, truncated). */
export function shortPayoff(results: string[]): string {
  const first = results[0]?.trim();
  if (!first) return 'Combo';
  return first.length > PAYOFF_MAX ? first.slice(0, PAYOFF_MAX).trimEnd() + '…' : first;
}

/** Tags of this candidate the player has already shown affinity for (themes ∪ subtype). */
function matchingTagsFor(state: BrewState, c: BrewCandidate): string[] {
  const tags = [...c.themeTags];
  if (c.subtype) tags.push(c.subtype);
  return tags.filter(t => (state.themeAffinity[t] ?? 0) > 0);
}

function availableFor(ctx: BrewContext, state: BrewState, route: BrewRoute): BrewCandidate[] {
  const used = new Set(state.usedNames);
  const pool = ctx.candidates.filter(c => !used.has(c.name) && !c.isLand);
  const matches = pool.filter(c => {
    if (route.targetRole) return c.role === route.targetRole;
    if (route.targetType) return typeKey(c.scryfall.type_line) === route.targetType;
    return true; // lightning/gamble: whole pool
  });
  // Score and sort desc. Theme affinity (accumulated by applyPick) is fed back in here via
  // matchingTags, so leaning into a theme floats that theme's cards up in every later route.
  return [...matches].sort((a, b) =>
    scoreCandidate(ctx, state, b, matchingTagsFor(state, b)) -
    scoreCandidate(ctx, state, a, matchingTagsFor(state, a)));
}

export function deriveReasons(ctx: BrewContext, state: BrewState, c: BrewCandidate): PickReason[] {
  const reasons: PickReason[] = [];
  reasons.push({ kind: 'synergy', label: `Synergy ${Math.round(c.inclusion)}`, value: c.inclusion });
  if (c.role) {
    const health = buildHealth(ctx, state);
    const deficit = (ctx.roleTargets[c.role] ?? 0) - (health.roleCounts[c.role] ?? 0);
    if (deficit > 0) reasons.push({ kind: 'role', label: `Fills ${ROLE_LABELS[c.role] ?? c.role}`, value: deficit });
  }
  const leaningTags = c.themeTags.filter(t => (state.themeAffinity[t] ?? 0) > 0);
  if (leaningTags.length > 0) {
    const label = leaningTags.map(slug => ctx.themeNames[slug] ?? slug).join(', ');
    reasons.push({ kind: 'theme', label: `On-theme: ${label}`, value: 1 });
  } else if (c.edhrec.isThemeSynergyCard) {
    reasons.push({ kind: 'theme', label: 'On-theme', value: 1 });
  }
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

/** ~1 in SPICE_EVERY draft screens drops a wildcard. Deterministic on decision count. */
const SPICE_EVERY = 8;
function spiceEligible(state: BrewState): boolean {
  return state.history.length % SPICE_EVERY === SPICE_EVERY - 1;
}

/**
 * A spicy wildcard: an underutilized (lowest-inclusion) unused card, to keep the player on their
 * toes and surface cards the recommendation engine would normally bury. Varies by decision count.
 */
function spiceCandidate(ctx: BrewContext, state: BrewState, exclude: Set<string>): BrewCandidate | null {
  const used = new Set(state.usedNames);
  const pool = ctx.candidates.filter(c => !used.has(c.name) && !c.isLand && !exclude.has(c.name));
  if (pool.length === 0) return null;
  const underutilized = [...pool].sort((a, b) => a.inclusion - b.inclusion);
  const span = Math.min(underutilized.length, 15);
  return underutilized[state.history.length % span] ?? underutilized[0];
}

export function openNode(ctx: BrewContext, state: BrewState, route: BrewRoute): BrewNode {
  const pool = availableFor(ctx, state, route);

  if (route.type === 'bundle') {
    return { routeId: route.id, type: 'bundle', prompt: `${route.title} — pick a package`,
      options: buildBundles(ctx, state, pool), canPass: false };
  }

  if (route.type === 'lightning') {
    // One click adds the top LIGHTNING_PICKS cards at once — matches the route's "+5 cards" promise.
    const five = pool.slice(0, LIGHTNING_PICKS);
    return { routeId: route.id, type: 'lightning', prompt: 'Lightning Round — add five at once',
      options: five.length > 0 ? [toOption(ctx, state, five, 'lightning')] : [],
      canPass: false };
  }

  if (route.type === 'gamble') {
    return { routeId: route.id, type: 'gamble', prompt: `${route.title} — take the bomb or pass`,
      options: pool.slice(0, 1).map((c, i) => toOption(ctx, state, [c], `g:${i}`)), canPass: true };
  }

  if (route.type === 'combo') {
    const byName = new Map(ctx.candidates.map(c => [c.name, c]));
    const options: BrewOption[] = [];
    for (const nm of detectNearMissCombos(ctx, state).slice(0, 3)) {
      const cards = nm.missing
        .map(n => byName.get(n))
        .filter((c): c is BrewCandidate => !!c);
      if (cards.length === 0) continue;
      // Combos read as a short payoff tag (option.label) — per-card synergy reasons are
      // suppressed to keep the pick list uncluttered.
      options.push({ id: `combo:${nm.comboId}`, label: shortPayoff(nm.results), cards, reasons: cards.map(() => []) });
    }
    return { routeId: route.id, type: 'combo', prompt: 'Complete a combo', options, canPass: true };
  }

  // draft: pick 1 of ~5, with a rare spicy wildcard swapped into the last slot.
  const options = pool.slice(0, DRAFT_OPTIONS).map((c, i) => toOption(ctx, state, [c], `d:${i}`));
  if (spiceEligible(state) && options.length > 0) {
    const shown = new Set(options.flatMap(o => o.cards.map(c => c.name)));
    const spice = spiceCandidate(ctx, state, shown);
    if (spice) options[options.length - 1] = { ...toOption(ctx, state, [spice], 'spice'), spicy: true };
  }
  return { routeId: route.id, type: route.type, prompt: `${route.title} — take one`, options, canPass: false };
}
