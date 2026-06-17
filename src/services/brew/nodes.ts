import { ROLE_LABELS } from '@/services/deckBuilder/roleTargets';
import { hasTag, isExtraTurn, isMassLandDenial } from '@/services/tagger/client';
import type { ScryfallCard } from '@/types';
import type { BrewContext, BrewState, BrewRoute, BrewNode, BrewOption, BrewCandidate, ComboPiece, PickReason } from './brewTypes';
import { scoreCandidate } from './scoring';
import { buildHealth, typeKey, pool } from './health';
import { detectNearMissCombos } from './combos';
import { relicBudgetCap } from './relics';
import { computeDeficits, matchesDeficit } from './routes';

const REASON_CAP = 5;

/** Names that single-handedly complete a near-miss combo (its last missing piece). */
function comboFinishersFor(ctx: BrewContext, state: BrewState): Set<string> {
  const set = new Set<string>();
  for (const nm of detectNearMissCombos(ctx, state)) {
    if (nm.missing.length === 1) set.add(nm.missing[0]);
  }
  return set;
}

/** Extra "good to know" flags from the tagger that a player would want surfaced on a pick. */
function flagReasons(c: BrewCandidate): PickReason[] {
  const out: PickReason[] = [];
  if (isExtraTurn(c.name)) out.push({ kind: 'tag', label: 'Extra Turn' });
  if (isMassLandDenial(c.name)) out.push({ kind: 'tag', label: 'Land Denial' });
  if (hasTag(c.name, 'tutor')) out.push({ kind: 'tag', label: 'Tutor' });
  if (hasTag(c.name, 'graveyard-hate')) out.push({ kind: 'tag', label: 'Graveyard Hate' });
  return out;
}

const ELITE_PICKS = 4;
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
  const cap = relicBudgetCap(state.relics);   // Budget Brewer: pricey cards stop appearing
  const available = pool(ctx, state).filter(c =>
    !used.has(c.name) && !c.isLand && (cap == null || (parseFloat(c.scryfall.prices?.usd ?? '') || 0) <= cap));
  const matches = available.filter(c => {
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

export function deriveReasons(ctx: BrewContext, state: BrewState, c: BrewCandidate, comboFinishers?: Set<string>): PickReason[] {
  const reasons: PickReason[] = [];
  // Headline call-outs first — the things worth knowing even off the combo screen.
  const finishers = comboFinishers ?? comboFinishersFor(ctx, state);
  if (finishers.has(c.name)) reasons.push({ kind: 'combo', label: 'Finishes a combo', value: 100 });
  if (ctx.gameChangerNames instanceof Set && ctx.gameChangerNames.has(c.name)) reasons.push({ kind: 'gameChanger', label: 'Game Changer', value: 100 });
  // Why it fits the plan.
  if (c.role) {
    const health = buildHealth(ctx, state);
    const deficit = (ctx.roleTargets[c.role] ?? 0) - (health.roleCounts[c.role] ?? 0);
    if (deficit > 0) reasons.push({ kind: 'role', label: ROLE_LABELS[c.role] ?? c.role, value: deficit });
  }
  // We no longer surface a raw "Synergy NN" popularity chip — it was noise. The only "why it's
  // here" call-out left is for lift/co-play finds: a card the graph surfaced reads as its own
  // "Hidden synergy" so it's obvious it arrived via card-to-card lift, not commander popularity.
  if (c.discoveredVia) {
    const via = c.discoveredVia;
    if (c.discoverySource === 'lift') {
      reasons.push({ kind: 'lift', label: `Hidden synergy with ${via}`, value: c.coSynergy ?? 0 });
    } else {
      reasons.push({ kind: 'discovery', label: c.discoverySource === 'similar' ? `Similar to ${via}` : `Plays with ${via}`, value: c.coSynergy ?? 0 });
    }
  }
  const leaningTags = c.themeTags
    .filter(t => (state.themeAffinity[t] ?? 0) > 0)
    .sort((a, b) => (state.themeAffinity[b] ?? 0) - (state.themeAffinity[a] ?? 0));
  if (leaningTags.length > 0) {
    // Cap to the two strongest leans so the chip stays a chip — a deep build can match a dozen themes.
    const shown = leaningTags.slice(0, 2).map(slug => ctx.themeNames[slug] ?? slug);
    const extra = leaningTags.length - shown.length;
    reasons.push({ kind: 'theme', label: `On-theme: ${shown.join(', ')}${extra > 0 ? ` +${extra}` : ''}`, value: leaningTags.length });
  } else if (c.edhrec.isThemeSynergyCard) {
    reasons.push({ kind: 'theme', label: 'On-theme', value: 1 });
  }
  // Extra utility flags last — they fill out the picture when there's room.
  reasons.push(...flagReasons(c));
  return reasons.slice(0, REASON_CAP);
}

function toOption(ctx: BrewContext, state: BrewState, cards: BrewCandidate[], id: string, label: string | undefined, comboFinishers: Set<string>): BrewOption {
  return { id, label, cards, reasons: cards.map(c => deriveReasons(ctx, state, c, comboFinishers)) };
}

/** Cards draftable right now (unused, non-land, in budget), best-scored first. */
function scoredPool(ctx: BrewContext, state: BrewState): BrewCandidate[] {
  const used = new Set(state.usedNames);
  const cap = relicBudgetCap(state.relics);
  const avail = pool(ctx, state).filter(c =>
    !used.has(c.name) && !c.isLand && (cap == null || (parseFloat(c.scryfall.prices?.usd ?? '') || 0) <= cap));
  return [...avail].sort((a, b) =>
    scoreCandidate(ctx, state, b, matchingTagsFor(state, b)) - scoreCandidate(ctx, state, a, matchingTagsFor(state, a)));
}

/** Take up to n cards (best-first) matching pred, skipping anything already claimed by another pack. */
function takeCards(scored: BrewCandidate[], taken: Set<string>, n: number, pred: (c: BrewCandidate) => boolean = () => true): BrewCandidate[] {
  const out: BrewCandidate[] = [];
  for (const c of scored) {
    if (out.length >= n) break;
    if (taken.has(c.name) || !pred(c)) continue;
    out.push(c);
  }
  return out;
}

/** Commander theme slugs with at least a couple of draftable cards, most-stocked first. */
function availableThemeSlugs(ctx: BrewContext, scored: BrewCandidate[]): string[] {
  const counts: Record<string, number> = {};
  for (const c of scored) for (const t of c.themeTags) if (ctx.themeNames[t]) counts[t] = (counts[t] ?? 0) + 1;
  return Object.entries(counts).filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).map(([s]) => s);
}

const BUNDLE_MIN = 2;          // a bundle needs at least this many cards to "feel like" a strategy
const BUNDLE_MAX = 4;          // cap so one decision doesn't fill too many slots at once
const BUNDLE_COUNT = 3;        // packs offered per node

/** A candidate cluster key: a theme slug, a subtype, or a role — anything that makes a coherent group. */
interface Cluster {
  key: string;
  label: string;
  flavor: BrewOption['flavor'];
  match: (c: BrewCandidate) => boolean;
  priority: number;            // higher = surfaced first (deficit/lean bias)
}

/**
 * Build 2-3 coherent sub-strategy bundles from the draftable pool. Each bundle groups cards that
 * share a tag (a commander theme, a subtype, or — for the steering bundle — a deficit role/type),
 * named for what it does. The leading deficit always gets a bundle (flavor 'need') so the engine
 * still steers; leaning themes are prioritised so a committed deck keeps seeing its identity. Cards
 * are claimed greedily so no card appears in two bundles (the sacrifice is real).
 */
function clusterBundles(ctx: BrewContext, state: BrewState): BrewOption[] {
  const scored = scoredPool(ctx, state);
  if (scored.length === 0) return [];
  const finishers = comboFinishersFor(ctx, state);
  const deficits = computeDeficits(ctx, state);
  const topDeficit = deficits[0];
  const leanWeights = state.themeAffinity;

  const clusters: Cluster[] = [];
  // 1. The steering bundle — always address the leading deficit if one exists.
  if (topDeficit) {
    clusters.push({
      key: `need:${topDeficit.key}`,
      label: topDeficit.shortLabel,
      flavor: 'need',
      match: c => matchesDeficit(c, topDeficit),
      priority: 1_000_000 + topDeficit.deficit,
    });
  }
  // 2. Theme bundles — one per commander theme that has enough stock, leaning themes weighted up.
  for (const slug of availableThemeSlugs(ctx, scored)) {
    clusters.push({
      key: `theme:${slug}`,
      label: ctx.themeNames[slug] ?? slug,
      flavor: 'theme',
      match: c => c.themeTags.includes(slug),
      priority: 1_000 + (leanWeights[slug] ?? 0),
    });
  }
  // 3. A discovery bundle if lift/co-play finds are present (kept as its own coherent "hidden synergy").
  if (scored.some(c => c.discoveredVia)) {
    clusters.push({
      key: 'discovery',
      label: 'Hidden Synergy',
      flavor: 'discovery',
      match: c => !!c.discoveredVia,
      priority: 500,
    });
  }
  clusters.sort((a, b) => b.priority - a.priority);

  const taken = new Set<string>();
  const bundles: BrewOption[] = [];
  for (const cl of clusters) {
    if (bundles.length >= BUNDLE_COUNT) break;
    const cards = takeCards(scored, taken, BUNDLE_MAX, cl.match);
    if (cards.length < BUNDLE_MIN) continue;
    cards.forEach(c => taken.add(c.name));
    bundles.push({ ...toOption(ctx, state, cards, cl.key, cl.label, finishers), flavor: cl.flavor });
  }

  // Thin-pool guarantee: if fewer than two coherent clusters formed (e.g. a pool dominated by one
  // role), split the top cards into two generic bundles so the player still chooses between packages.
  if (bundles.length < 2) {
    const top = scored.slice(0, BUNDLE_MAX * 2);
    const half = Math.min(BUNDLE_MAX, Math.ceil(top.length / 2));
    const first = top.slice(0, half);
    const second = top.slice(half, half + BUNDLE_MAX);
    const split: BrewOption[] = [];
    if (first.length >= BUNDLE_MIN) split.push({ ...toOption(ctx, state, first, 'pack:a', 'Top Picks', finishers), flavor: 'value' });
    if (second.length >= BUNDLE_MIN) split.push({ ...toOption(ctx, state, second, 'pack:b', 'More Options', finishers), flavor: 'value' });
    if (split.length >= 2) return split;        // two splits beat one lonely cluster
  }
  return bundles;
}

/**
 * The routine pick: a round of 2-3 coherent sub-strategy bundles. The player picks one whole
 * package; the others move on (the sacrifice is real — see clusterBundles). Returns null only when
 * the pool is empty.
 */
export function buildPackNode(ctx: BrewContext, state: BrewState): BrewNode | null {
  const options = clusterBundles(ctx, state);
  if (options.length === 0) return null;
  return { routeId: 'bundle:pack', type: 'bundle', prompt: 'Choose one path — the others move on', options, canPass: false };
}

export function openNode(ctx: BrewContext, state: BrewState, route: BrewRoute): BrewNode {
  const finishers = comboFinishersFor(ctx, state);

  // The bundle route (and every auto-advance) opens a multi-bundle round.
  if (route.type === 'bundle') {
    return buildPackNode(ctx, state) ?? { routeId: route.id, type: 'bundle', prompt: route.title, options: [], canPass: false };
  }

  // The elite draft: one card per option, pick exactly one, lose the rest. The high-stakes beat.
  if (route.type === 'draft') {
    const top = availableFor(ctx, state, route).slice(0, ELITE_PICKS);
    return { routeId: route.id, type: 'draft', prompt: `${route.title} — take one, leave the rest`,
      options: top.map((c, i) => toOption(ctx, state, [c], `draft:${i}`, undefined, finishers)),
      canPass: false };
  }

  if (route.type === 'combo') {
    const byName = new Map(ctx.candidates.map(c => [c.name, c]));
    // Resolve owned combo pieces to their art: the commander, partner, and prior picks.
    const ownedArt = new Map<string, ScryfallCard>();
    ownedArt.set(ctx.commander.name, ctx.commander);
    if (ctx.partnerCommander) ownedArt.set(ctx.partnerCommander.name, ctx.partnerCommander);
    for (const p of state.picks) ownedArt.set(p.name, p.card);

    const options: BrewOption[] = [];
    for (const nm of detectNearMissCombos(ctx, state).slice(0, 3)) {
      const cards = nm.missing
        .map(n => byName.get(n))
        .filter((c): c is BrewCandidate => !!c);
      if (cards.length === 0) continue;
      // The owned half of the combo, shown for context (capped at 2 so a 3-piece combo doesn't sprawl).
      const comboHave: ComboPiece[] = nm.have
        .map(n => { const scryfall = ownedArt.get(n); return scryfall ? { name: n, scryfall } : null; })
        .filter((p): p is ComboPiece => !!p)
        .slice(0, 2);
      // Combos read as a short payoff tag (option.label) — per-card synergy reasons are
      // suppressed to keep the pick list uncluttered.
      options.push({ id: `combo:${nm.comboId}`, label: shortPayoff(nm.results), cards, reasons: cards.map(() => []), comboHave });
    }
    return { routeId: route.id, type: 'combo', prompt: 'Complete a combo', options, canPass: true };
  }

  // Any other route (e.g. manabase, which the fork routes straight to Finish) has no card screen.
  return { routeId: route.id, type: route.type, prompt: route.title, options: [], canPass: false };
}
