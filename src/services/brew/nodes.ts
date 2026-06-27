import { ROLE_LABELS } from '@/services/deckBuilder/roleTargets';
import { hasTag, isExtraTurn, isMassLandDenial } from '@/services/tagger/client';
import { getCardPrice } from '@/services/scryfall/client';
import type { ScryfallCard } from '@/types';
import type { BrewContext, BrewState, BrewRoute, BrewNode, BrewOption, BrewCandidate, ComboPiece, PickReason } from './brewTypes';
import { scoreCandidate, deckFill, IDENTITY_PHASE_FILL } from './scoring';
import { topIdentity, LEANING_THRESHOLD } from './identity';
import { seededJitter, seededPick, seededChance } from './jitter';
import { buildHealth, typeKey, pool } from './health';
import { detectNearMissCombos } from './combos';
import { relicBudgetCap } from './relics';
import { computeDeficits, matchesDeficit } from './routes';
import { CLUSTER_MIN_CONN } from './discovery';

const REASON_CAP = 5;

// Per-run jitter added to a card's offer score (not its health/event score). Big enough to reshuffle
// cards within a tier so different runs surface different-but-comparable cards; small enough that a
// genuinely worse card never leapfrogs a clearly better one. Inert when state.seed is falsy.
const JITTER_AMPLITUDE = 15;

// ~1-in-8 theme packs secretly hides a "gold card": the theme's defining payoff, revealed as a
// free windfall after the player takes the pack. Seeded (see rollGoldCard) so a given pack
// presentation always either has it or doesn't — stable across undo/re-render, no save-scumming.
const GOLD_CARD_CHANCE = 0.12;

/**
 * Roll the secret gold card for a theme pack. On a seeded hit, returns that theme's highest-ranked
 * signature card (its defining payoff) that's still draftable (`byName`) and not already shown on
 * screen (`excluded`); undefined when the roll misses or no eligible signature card remains.
 */
function rollGoldCard(state: BrewState, slug: string, signatures: string[], byName: Map<string, BrewCandidate>, excluded: Set<string>): BrewCandidate | undefined {
  if (!seededChance(state.seed, `gold:${slug}:${state.picks.length}`, GOLD_CARD_CHANCE)) return undefined;
  for (const name of signatures) {
    if (excluded.has(name)) continue;
    const c = byName.get(name);
    if (c) return c;
  }
  return undefined;
}

/** A card's score for ORDERING OFFERS — base score + a stable per-run nudge. */
function offerScore(ctx: BrewContext, state: BrewState, c: BrewCandidate): number {
  return scoreCandidate(ctx, state, c, matchingTagsFor(state, c)) + seededJitter(state.seed, c.name, JITTER_AMPLITUDE);
}

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
    !used.has(c.name) && !c.isLand && (cap == null || (parseFloat(getCardPrice(c.scryfall) ?? '') || 0) <= cap));
  const matches = available.filter(c => {
    if (route.targetRole) return c.role === route.targetRole;
    if (route.targetType) return typeKey(c.scryfall.type_line) === route.targetType;
    return true; // lightning/gamble: whole pool
  });
  // Score and sort desc. Theme affinity (accumulated by applyPick) is fed back in here via
  // matchingTags, so leaning into a theme floats that theme's cards up in every later route.
  // Per-run jitter (offerScore) breaks the otherwise-identical ordering so runs diverge.
  return [...matches].sort((a, b) => offerScore(ctx, state, b) - offerScore(ctx, state, a));
}

export function deriveReasons(ctx: BrewContext, state: BrewState, c: BrewCandidate, comboFinishers?: Set<string>): PickReason[] {
  const reasons: PickReason[] = [];
  // Headline call-outs first — the things worth knowing even off the combo screen.
  const finishers = comboFinishers ?? comboFinishersFor(ctx, state);
  if (finishers.has(c.name)) reasons.push({ kind: 'combo', label: 'Finishes a combo', value: 100 });
  // Combo glue: a card that recurs across the commander's combos (not a near-miss finisher right now,
  // but a piece worth knowing about). The finisher call-out above is louder, so skip this when both apply.
  else {
    const comboCount = ctx.comboPieceCounts[c.name] ?? 0;
    if (comboCount >= 2) reasons.push({ kind: 'comboPiece', label: `In ${comboCount} combos`, value: 55 });
  }
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
    if ((c.connectionCount ?? 0) >= 2) {
      // A whole-deck cluster find — louder + more informative than a single-seed lift.
      reasons.push({ kind: 'lift', label: `${c.connectionCount} of your cards want this`, value: 100 });
    } else if (c.discoverySource === 'lift') {
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
  // Loudest reason first (by magnitude) so the headline "why" leads and the cap drops the weakest.
  return reasons.sort((a, b) => (b.value ?? 0) - (a.value ?? 0)).slice(0, REASON_CAP);
}

function toOption(ctx: BrewContext, state: BrewState, cards: BrewCandidate[], id: string, label: string | undefined, comboFinishers: Set<string>): BrewOption {
  return { id, label, cards, reasons: cards.map(c => deriveReasons(ctx, state, c, comboFinishers)) };
}

/** Cards draftable right now (unused, non-land, in budget), best-scored first. */
function scoredPool(ctx: BrewContext, state: BrewState): BrewCandidate[] {
  const used = new Set(state.usedNames);
  const cap = relicBudgetCap(state.relics);
  const avail = pool(ctx, state).filter(c =>
    !used.has(c.name) && !c.isLand && (cap == null || (parseFloat(getCardPrice(c.scryfall) ?? '') || 0) <= cap));
  return [...avail].sort((a, b) => offerScore(ctx, state, b) - offerScore(ctx, state, a));
}

/**
 * Take up to n cards matching pred, skipping anything already claimed by another pack. `scored` is
 * already in offer-score order; an optional `rank` (lower = earlier) re-orders the matches before
 * taking — used to pull a theme's *defining* (signature-synergy) cards to the front of its pack so a
 * "Raise the Dead" pack shows reanimation payoffs, not whatever staples happen to sit on the page.
 * Stable sort: cards with the same rank keep their offer-score order.
 */
function takeCards(scored: BrewCandidate[], taken: Set<string>, n: number, pred: (c: BrewCandidate) => boolean = () => true, rank?: (c: BrewCandidate) => number): BrewCandidate[] {
  const matching = scored.filter(c => !taken.has(c.name) && pred(c));
  if (rank) matching.sort((a, b) => rank(a) - rank(b));
  return matching.slice(0, n);
}

/** Commander theme slugs with at least a couple of draftable cards, most-stocked first. */
function availableThemeSlugs(ctx: BrewContext, scored: BrewCandidate[]): string[] {
  const counts: Record<string, number> = {};
  for (const c of scored) for (const t of c.themeTags) if (ctx.themeNames[t]) counts[t] = (counts[t] ?? 0) + 1;
  return Object.entries(counts).filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).map(([s]) => s);
}

const BUNDLE_MIN = 2;          // a bundle needs at least this many cards to "feel like" a strategy
const BUNDLE_MAX = 3;          // cap so one decision doesn't fill too many slots at once
const BUNDLE_COUNT = 3;        // packs offered per node

/**
 * Evocative names for bundles, keyed by role, card type, or theme slug. Deterministic and testable;
 * any key without an entry falls back to the cluster's plain subject label (e.g. "Tokens").
 */
const BUNDLE_FLAVOR: Record<string, string> = {
  // roles
  ramp: 'Fuel the Engine', removal: 'Clean Sweep', boardwipe: 'Scorched Earth', cardDraw: 'Draw Deep', protection: 'Stand Firm',
  // card types
  creature: 'Field an Army', instant: 'Hold Up Answers', sorcery: 'Big Plays',
  artifact: 'The Engine', enchantment: 'Lasting Power', planeswalker: 'Call in Allies',
  // common theme slugs
  tokens: 'Raise an Army', sacrifice: 'Feed the Machine', aristocrats: 'Feed the Machine',
  counters: 'Grow Tall', '+1-+1-counters': 'Grow Tall', lifegain: 'Drain the Table',
  spellslinger: 'Cast a Storm', 'spells-matter': 'Cast a Storm', reanimator: 'Raise the Dead',
  graveyard: 'Raise the Dead', mill: 'Erode the Library', blink: 'Flicker and Flux',
  equipment: 'Suit Up', auras: 'Suit Up', voltron: 'Suit Up', landfall: 'Grow the Land',
  lands: 'Grow the Land', ramp_theme: 'Fuel the Engine', stax: 'Lock It Down', control: 'Take the Reins',
};

// Role needs keep an accurate, evocative name (a Removal pack genuinely IS a "Clean Sweep"); type
// needs stay plain ("Creatures") so the name never promises a strategy the cards don't actually share.
const ROLE_NEED_SLUGS = new Set(['ramp', 'removal', 'boardwipe', 'cardDraw', 'protection']);

/** Cluster key like 'need:removal' | 'theme:tokens' | 'discovery' | 'pack:a' → its display title. */
function bundleName(ctx: BrewContext, key: string, fallbackLabel: string): string {
  const [kind, slug] = key.split(':');
  if (kind === 'theme') return BUNDLE_FLAVOR[slug] ?? ctx.themeNames[slug] ?? fallbackLabel;
  if (kind === 'need') return ROLE_NEED_SLUGS.has(slug) ? (BUNDLE_FLAVOR[slug] ?? fallbackLabel) : fallbackLabel;
  return fallbackLabel;   // discovery / pack:* keep their plain labels
}

/** A candidate cluster key: a theme slug, a subtype, or a role — anything that makes a coherent group. */
interface Cluster {
  key: string;
  label: string;
  flavor: BrewOption['flavor'];
  match: (c: BrewCandidate) => boolean;
  priority: number;            // higher = surfaced first (deficit/lean bias)
  rank?: (c: BrewCandidate) => number;   // optional within-pack ordering (lower = earlier); see takeCards
}

/**
 * Pick a theme cluster OUTSIDE the current top-2 leans to guarantee one "explore" slot per pack.
 * Without this, the highest-affinity theme wins a bundle on nearly every node and the deck converges
 * on the same 1-2 themes every run. The choice is seeded (varies run-to-run) and rotates by pick
 * count so consecutive packs surface different directions. Returns null when every theme is already
 * a lead (or there are no spare themes) — then the normal priority order fills all slots.
 */
function chooseExplorationCluster(clusters: Cluster[], ctx: BrewContext, state: BrewState): Cluster | null {
  const leading = new Set(
    topIdentity(ctx, state, 2).filter(b => b.value >= LEANING_THRESHOLD).map(b => b.slug),
  );
  const candidates = clusters.filter(cl => cl.flavor === 'theme' && !leading.has(cl.key.slice('theme:'.length)));
  if (candidates.length === 0) return null;
  return seededPick(state.seed, `explore:${state.picks.length}`, candidates);
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
  const byName = new Map(scored.map(c => [c.name, c]));
  const finishers = comboFinishersFor(ctx, state);
  const deficits = computeDeficits(ctx, state);
  const topDeficit = deficits[0];
  const leanWeights = state.themeAffinity;

  // Signature ranking from the theme pages: themeSignatures[slug] is that theme's cards ordered by
  // EDHREC theme-synergy (the cards that DEFINE the theme, not staples merely played in it). We use
  // it to compose on-theme packs — a theme pack leads with its signature cards, and even the "need"
  // pack prefers cards that define one of the deck's themes over generic high-inclusion filler.
  const sigRankBySlug: Record<string, Map<string, number>> = {};
  const signatureSet = new Set<string>();
  for (const [slug, names] of Object.entries(ctx.themeSignatures)) {
    const m = new Map<string, number>();
    names.forEach((n, i) => { m.set(n, i); signatureSet.add(n); });
    sigRankBySlug[slug] = m;
  }
  const themeRank = (slug: string) => (c: BrewCandidate) => sigRankBySlug[slug]?.get(c.name) ?? Number.MAX_SAFE_INTEGER;
  const needRank = (c: BrewCandidate) => (signatureSet.has(c.name) ? 0 : 1);

  const clusters: Cluster[] = [];
  // 1. The steering "need" bundle — only once the deck is past its identity-building opening. Early
  //    packs stay theme-focused (the deck's direction forms first); deficit-filling + staples come
  //    after, so the player isn't handed a generic "Creatures"/"Removal" pack on turn one.
  if (topDeficit && deckFill(ctx, state) >= IDENTITY_PHASE_FILL) {
    clusters.push({
      key: `need:${topDeficit.key}`,
      label: topDeficit.shortLabel,
      flavor: 'need',
      match: c => matchesDeficit(c, topDeficit),
      priority: 1_000_000 + topDeficit.deficit,
      rank: needRank,
    });
  }
  // 2. Theme bundles — one per commander theme that has enough stock, leaning themes weighted up.
  //    Composed signature-first so the pack actually showcases the cards that define the theme.
  for (const slug of availableThemeSlugs(ctx, scored)) {
    clusters.push({
      key: `theme:${slug}`,
      label: ctx.themeNames[slug] ?? slug,
      flavor: 'theme',
      match: c => c.themeTags.includes(slug),
      priority: 1_000 + (leanWeights[slug] ?? 0),
      rank: themeRank(slug),
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
  // 4. A "cluster pack" once the foundation's set — cards the whole-deck lift web found are played
  //    alongside MANY of your picks. Priority above themes so it reliably enters the back-half
  //    rotation ("plays with your deck"); it supersedes the exploration slot once it's available.
  const hasClusterPack = scored.filter(c => (c.connectionCount ?? 0) >= CLUSTER_MIN_CONN).length >= BUNDLE_MIN;
  if (hasClusterPack) {
    clusters.push({
      key: 'cluster',
      label: 'Plays With Your Deck',
      flavor: 'discovery',
      match: c => (c.connectionCount ?? 0) >= CLUSTER_MIN_CONN,
      priority: 1_500,
    });
  }
  clusters.sort((a, b) => b.priority - a.priority);

  const taken = new Set<string>();
  // Two distinct themes can share one flavor name (e.g. graveyard + reanimator both → "Raise the
  // Dead"). Track titles already used this round so a second collision falls back to the plain
  // theme name, and the player never sees two identically-labelled packs side by side.
  const usedTitles = new Set<string>();
  // Keep each bundle's plain subject (cluster.label) alongside its option so we can fill the
  // "Closing:" line with the OTHER bundles' subjects after the set is chosen.
  const built: { option: BrewOption; subject: string }[] = [];
  const tryBuild = (cl: Cluster) => {
    if (built.length >= BUNDLE_COUNT || built.some(b => b.option.id === cl.key)) return;
    const cards = takeCards(scored, taken, BUNDLE_MAX, cl.match, cl.rank);
    if (cards.length < BUNDLE_MIN) return;
    cards.forEach(c => taken.add(c.name));
    const flavorTitle = bundleName(ctx, cl.key, cl.label);
    const title = usedTitles.has(flavorTitle) ? cl.label : flavorTitle;
    usedTitles.add(title);
    const option: BrewOption = { ...toOption(ctx, state, cards, cl.key, title, finishers), flavor: cl.flavor };
    // Theme packs may secretly hide their defining payoff (see rollGoldCard) — a rare free windfall.
    if (cl.flavor === 'theme') {
      const slug = cl.key.slice('theme:'.length);
      const gold = rollGoldCard(state, slug, ctx.themeSignatures[slug] ?? [], byName, taken);
      if (gold) { option.goldCard = gold; taken.add(gold.name); }
    }
    built.push({ option, subject: cl.label });
  };

  // Reserve one slot for an under-shown theme (variety) — UNLESS a cluster pack is available, in which
  // case that synergy pack takes the back-half rotation slot (via its priority) and we skip exploration.
  // The reserved bundle is built LAST so it only claims cards the higher-priority bundles passed on.
  const explore = hasClusterPack ? null : chooseExplorationCluster(clusters, ctx, state);
  const priorityCap = explore ? BUNDLE_COUNT - 1 : BUNDLE_COUNT;
  for (const cl of clusters) {
    if (built.length >= priorityCap) break;
    if (explore && cl.key === explore.key) continue;
    tryBuild(cl);
  }
  if (explore) tryBuild(explore);
  // Top up to BUNDLE_COUNT in priority order if the reserved slot couldn't form a bundle.
  for (const cl of clusters) tryBuild(cl);

  // Thin-pool guarantee: if fewer than two coherent clusters formed (e.g. a pool dominated by one
  // role), split the top cards into two generic bundles so the player still chooses between packages.
  if (built.length < 2) {
    const top = scored.slice(0, BUNDLE_MAX * 2);
    const half = Math.min(BUNDLE_MAX, Math.ceil(top.length / 2));
    const first = top.slice(0, half);
    const second = top.slice(half, half + BUNDLE_MAX);
    const split: BrewOption[] = [];
    if (first.length >= BUNDLE_MIN) split.push({ ...toOption(ctx, state, first, 'pack:a', 'Top Picks', finishers), flavor: 'value', closing: ['More Options'] });
    if (second.length >= BUNDLE_MIN) split.push({ ...toOption(ctx, state, second, 'pack:b', 'More Options', finishers), flavor: 'value', closing: ['Top Picks'] });
    if (split.length >= 2) return split;        // two splits beat one lonely cluster
    // No real cluster formed and the pool is too thin to split in two (e.g. a late-game pool
    // dominated by one already-filled role): still offer a single pack of what's left, so we never
    // return an empty/dead-end node while draftable cards remain.
    if (built.length === 0) {
      if (split.length === 1) return split;
      return [{ ...toOption(ctx, state, scored.slice(0, BUNDLE_MAX), 'pack:a', 'Top Picks', finishers), flavor: 'value' }];
    }
  }

  // Each bundle's "Pass on" line names the OTHER bundles by their displayed title (not the plain
  // subject) so a chip the player reads here matches a pack title they can see across the row.
  const titles = built.map(b => b.option.label ?? b.subject);
  return built.map((b, i) => ({ ...b.option, closing: titles.filter((_, j) => j !== i) }));
}

/**
 * The routine pick: a round of 2-3 coherent sub-strategy bundles. The player picks one whole
 * package; the others move on (the sacrifice is real — see clusterBundles). Returns null only when
 * the pool is empty.
 */
export function buildPackNode(ctx: BrewContext, state: BrewState): BrewNode | null {
  const options = clusterBundles(ctx, state);
  if (options.length === 0) return null;
  return { routeId: 'bundle:pack', type: 'bundle', prompt: 'Pick a Pack', options, canPass: false };
}

export function openNode(ctx: BrewContext, state: BrewState, route: BrewRoute): BrewNode {
  const finishers = comboFinishersFor(ctx, state);

  // The bundle route (and every auto-advance) opens a multi-bundle round.
  if (route.type === 'bundle') {
    return buildPackNode(ctx, state) ?? { routeId: route.id, type: 'bundle', prompt: route.title, options: [], canPass: false };
  }

  // Hidden Synergy: a focused draft of the lift/co-play finds the discovery pass surfaced for your
  // picks — take one piece of "secret tech." Distinct from the discovery bundle inside Open a Pack.
  if (route.id === 'draft:synergy') {
    const used = new Set(state.usedNames);
    const finds = pool(ctx, state)
      .filter(c => !used.has(c.name) && !c.isLand && !!c.discoveredVia)
      .sort((a, b) => offerScore(ctx, state, b) - offerScore(ctx, state, a))
      .slice(0, ELITE_PICKS);
    return { routeId: route.id, type: 'draft', prompt: 'Hidden Synergy — take one',
      options: finds.map((c, i) => toOption(ctx, state, [c], `syn:${i}`, undefined, finishers)),
      canPass: true };
  }

  // The elite draft: one card per option. Take as many standouts as you want; the rest are gone.
  if (route.type === 'draft') {
    const top = availableFor(ctx, state, route).slice(0, ELITE_PICKS);
    return { routeId: route.id, type: 'draft', prompt: `${route.title} — take your pick`,
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
      // Thread the full combo data onto the option so the "Details" popover can show every payoff
      // line + popularity with no extra work (prereqs/steps are lazy-fetched on open by comboId).
      options.push({ id: `combo:${nm.comboId}`, label: shortPayoff(nm.results), cards, reasons: cards.map(() => []), comboHave,
        comboId: nm.comboId, comboResults: nm.results, comboDeckCount: nm.deckCount });
    }
    return { routeId: route.id, type: 'combo', prompt: 'Complete a combo', options, canPass: true };
  }

  // Any other route (e.g. manabase, which the fork routes straight to Finish) has no card screen.
  return { routeId: route.id, type: route.type, prompt: route.title, options: [], canPass: false };
}
