import type { RecommendedCard } from '@/services/deckBuilder/deckAnalyzer';
import type { ScryfallCard } from '@/types';
import { clusterScore, isStaple, type LiftCandidate } from './liftClusters';
import { getCardRole, getAllCardRoles, isUtilityLand, isTapland } from '@/services/tagger/client';
import { matchedThemeNames, themeMatchFor, type ThemeFit } from '@/services/deckBuilder/themeFit';
import { ROLE_LABELS } from '@/services/deckBuilder/roleTargets';

/** How loud the cluster signal is on the recommendation score scale (role boost ~= 75, inclusion <= 100).
 *  At 90 a top cluster-only card (+15 deficit) reaches ~105 — able to out-rank many inclusion picks so it
 *  actually surfaces, not just re-order silently. */
export const CLUSTER_WEIGHT = 90;
/**
 * How loud card-intrinsic theme fit is on the same scale.
 *
 * Below CLUSTER_WEIGHT and below a top inclusion pick on purpose: being on-theme should lift a card
 * past its off-theme peers, not past a card that two-thirds of decks with this commander actually
 * play. Only `literal` evidence earns it — the card's own type line, keyword or rules text carries
 * the mechanic. A tag match is inferred from aggregate co-occurrence and can be wrong.
 */
export const THEME_WEIGHT = 60;
/**
 * Same idea for `tag` evidence — inferred from oracle-tag co-occurrence rather than read off the
 * card. Less than half of THEME_WEIGHT, and it never earns the inclusion-floor bypass in
 * computeOptimizeSwaps. The literal/tag asymmetry is about the COST of being wrong: a wrong tag
 * that nudges a suggestion up the list is cheap, a wrong tag that vetoes a cut is not.
 */
export const THEME_TAG_WEIGHT = 25;
/** A synthesized cluster-only card whose role is under target gets this nudge (mirrors role-fit in scoreRecommendation). */
const CLUSTER_ROLE_DEFICIT_BONUS = 15;
/** Only breadth clusters drive the blend — single-anchor "bombs" are excluded (design: high cluster over high lift). */
const MIN_CLUSTER_CONNECTIONS = 2;

export interface BlendOptions {
  /** Restrict synthesized (new) cards to this role — used for per-role suggestion lists. */
  roleFilter?: string;
  /** Deck roles currently under target; a synthesized card filling one gets a small bonus. */
  deficitRoles?: Set<string>;
  /** Names to never synthesize (e.g. banned). In-deck cards are already excluded by the scan. */
  excludeNames?: Set<string>;
  /** Cap the output length (default 30). */
  limit?: number;
  /**
   * Classifier theme fit for the deck's selected themes, covering the CANDIDATE cards — every
   * name that can appear in `recommendations` or in `candidates`. A fit built over the deck's own
   * cards makes this term silently inert: recommendations are by definition cards the deck does
   * not run, so none of them would ever be found in it. Omit to disable the theme term entirely.
   */
  themeFit?: ThemeFit | null;
}

function scryfallImage(card: ScryfallCard): string | undefined {
  return card.image_uris?.normal ?? card.card_faces?.[0]?.image_uris?.normal;
}

function scryfallPrice(card: ScryfallCard): string | undefined {
  const usd = card.prices?.usd;
  return usd ? Number(usd).toFixed(2) : undefined;
}

function frontType(card: ScryfallCard): string {
  return card.type_line?.split('—')[0].replace(/Legendary\s+/i, '').trim() || '';
}

/**
 * Blend the deck-wide lift "cluster" signal into a recommendation list.
 *
 * Cards commonly played with *many* of your deck cards (high clusterScore, connectionCount >= 2) rise;
 * broadly-played staples are excluded (the inclusion rank already covers them). Existing recommendations
 * that are also cluster candidates get a bounded bonus; cluster candidates the commander-centric list
 * never surfaced are synthesized in. Pure + deterministic — no fetching, safe to call in a memo.
 */
export function blendClusterIntoRecommendations(
  recommendations: RecommendedCard[],
  candidates: LiftCandidate[],
  opts: BlendOptions = {},
): RecommendedCard[] {
  const { roleFilter, deficitRoles, excludeNames, limit = 30, themeFit } = opts;

  // Eligible clusters: breadth-gated, staples removed (deck-specific tech only).
  const eligible = candidates.filter(
    c => c.connectionCount >= MIN_CLUSTER_CONNECTIONS && !isStaple(c.edges),
  );
  const maxCluster = eligible.reduce((m, c) => Math.max(m, clusterScore(c)), 0);
  // No early return when maxCluster is 0: there may still be a theme term to apply, and hitByName
  // simply stays empty. Returning here skipped theme fit entirely for decks with no lift clusters.

  /** Theme evidence for a CANDIDATE (a card not in the deck). Null when it belongs to none. */
  const themeInfo = (name: string) => {
    const hit = themeMatchFor(themeFit, name);
    if (!hit) return null;
    return {
      bonus: hit.basis === 'literal' ? THEME_WEIGHT : THEME_TAG_WEIGHT,
      themeMatched: matchedThemeNames(themeFit, name),
      themeBasis: hit.basis,
    };
  };

  const hitByName = new Map<string, { bonus: number; connections: number; cluster: number; card: ScryfallCard }>();
  for (const c of eligible) {
    const cluster = clusterScore(c);
    hitByName.set(c.card.name, {
      // Guarded: maxCluster is 0 only when every eligible cluster scored 0, which would divide by
      // zero and poison every downstream sort with NaN.
      bonus: maxCluster > 0 ? CLUSTER_WEIGHT * (cluster / maxCluster) : 0,
      connections: c.connectionCount,
      cluster,
      card: c.card,
    });
  }

  // 1. Re-score existing recommendations that are also clusters and/or on theme.
  const existingNames = new Set(recommendations.map(r => r.name));
  const rescored: RecommendedCard[] = recommendations.map(r => {
    const hit = hitByName.get(r.name);
    const theme = themeInfo(r.name);
    if (!hit && !theme) return r;
    return {
      ...r,
      score: (r.score ?? 0) + (hit?.bonus ?? 0) + (theme?.bonus ?? 0),
      // Carried, not just scored: computeOptimizeSwaps reads these to label the suggestion and to
      // waive the inclusion floor, and the drill-down shows the user WHICH theme it matched.
      ...(theme ? { themeMatched: theme.themeMatched, themeBasis: theme.themeBasis } : {}),
      ...(hit ? { clusterConnections: hit.connections, clusterScore: hit.cluster } : {}),
    };
  });

  // 2. Synthesize cluster-only cards the commander list never surfaced.
  const synthesized: RecommendedCard[] = [];
  for (const [name, hit] of hitByName) {
    if (existingNames.has(name)) continue;
    if (excludeNames?.has(name)) continue;
    const role = getCardRole(name) ?? undefined;
    if (roleFilter && role !== roleFilter) continue;
    const allRoles = getAllCardRoles(name);
    const fillsDeficit = role ? (deficitRoles?.has(role) ?? false) : false;
    const theme = themeInfo(name);
    synthesized.push({
      name,
      inclusion: 0,
      synergy: 0,
      role,
      roleLabel: role ? ROLE_LABELS[role] : undefined,
      allRoles: allRoles.length > 0 ? allRoles : undefined,
      allRoleLabels: allRoles.length > 0 ? allRoles.map(r => ROLE_LABELS[r] || r) : undefined,
      fillsDeficit,
      primaryType: frontType(hit.card),
      imageUrl: scryfallImage(hit.card),
      price: scryfallPrice(hit.card),
      score: hit.bonus + (fillsDeficit ? CLUSTER_ROLE_DEFICIT_BONUS : 0) + (theme?.bonus ?? 0),
      ...(theme ? { themeMatched: theme.themeMatched, themeBasis: theme.themeBasis } : {}),
      cmc: hit.card.cmc,
      isUtilityLand: isUtilityLand(name) || undefined,
      isTapland: isTapland(name) || undefined,
      clusterConnections: hit.connections,
      clusterScore: hit.cluster,
    });
  }

  return [...rescored, ...synthesized]
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, limit);
}
