import type { ScryfallCard, DetectedCombo } from '@/types';
import { getFrontFaceTypeLine, isMdfcLand, isChannelLand } from '@/services/scryfall/client';

export type TrimReasonKey =
  | 'low-fit'
  | 'isolated'
  | 'off-curve'
  | 'redundant-role'
  | 'type-overflow'
  | 'anti-synergy'
  | 'lowest-relevancy'
  | 'combo-near-miss';

export interface TrimCandidate {
  card: ScryfallCard;
  reasonKey: TrimReasonKey;
  reasonLabel: string;
  reasonText: string;
  relevancy: number;
  inclusion: number;
  synergy: number;
  partition: 'land' | 'spell';
}

export interface TrimInput {
  cards: ScryfallCard[];
  commanderName: string;
  partnerCommanderName?: string;
  targetSize: number;
  targetLandCount: number;
  relevancyMap: Record<string, number>;
  inclusionMap: Record<string, number>;
  synergyMap: Record<string, number>;
  roleCounts: Record<string, number>;
  roleTargets: Record<string, number>;
  edhrecCurve: Record<number, number>;
  edhrecTypes: Record<string, number>;
  /** Per-card deck-internal synergy connectivity from the lift graph (see
   *  computeDeckConnectivity). Optional — when present, spell cut-ranking is
   *  re-weighted so cards weakly linked to the rest of the deck (synergy
   *  outliers) sort toward the cut, not just cards the commander rarely runs.
   *  Absent (scan not yet loaded) → falls back to pure relevancy ranking. */
  connectivityMap?: Record<string, number>;
  /** Combos detected in the deck. Combo protection is now baked into relevancyMap
   *  (see scoreRecommendation Component 5) — this is kept only for the
   *  `combo-near-miss` reason label when a near-miss piece does still get cut. */
  detectedCombos?: DetectedCombo[];
  /** User-pinned cards — hard-protected, never offered as cuts. */
  mustIncludeNames?: Set<string>;
}

export interface TrimResult {
  cuts: TrimCandidate[];
  allCandidates: TrimCandidate[];
  cutLands: number;
  cutSpells: number;
  effectiveLandTarget: number;
}

const TYPE_KEYS = ['creature', 'instant', 'sorcery', 'artifact', 'enchantment', 'planeswalker'] as const;
type TypeKey = (typeof TYPE_KEYS)[number];

const BASIC_LAND_NAMES = new Set([
  'Plains', 'Island', 'Swamp', 'Mountain', 'Forest',
  'Snow-Covered Plains', 'Snow-Covered Island', 'Snow-Covered Swamp',
  'Snow-Covered Mountain', 'Snow-Covered Forest',
  'Wastes',
]);

function isLand(card: ScryfallCard): boolean {
  return getFrontFaceTypeLine(card).toLowerCase().includes('land')
    || isMdfcLand(card)
    || isChannelLand(card);
}

function isBasicLand(card: ScryfallCard): boolean {
  return BASIC_LAND_NAMES.has(card.name);
}

function classifyType(card: ScryfallCard): TypeKey | null {
  const t = getFrontFaceTypeLine(card).toLowerCase();
  for (const k of TYPE_KEYS) if (t.includes(k)) return k;
  return null;
}

function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  const mod10 = n % 10;
  if (mod10 === 1) return `${n}st`;
  if (mod10 === 2) return `${n}nd`;
  if (mod10 === 3) return `${n}rd`;
  return `${n}th`;
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

const LABELS: Record<TrimReasonKey, string> = {
  'low-fit': 'Low fit',
  'isolated': 'Off-package',
  'off-curve': 'Off-curve',
  'redundant-role': 'Redundant',
  'type-overflow': 'Type-heavy',
  'anti-synergy': 'Anti-synergy',
  'lowest-relevancy': 'Lowest',
  'combo-near-miss': 'Combo piece',
};

interface ReasonContext {
  cmcBuckets: Record<number, number>;
  typeCounts: Record<TypeKey, number>;
  edhrecCurve: Record<number, number>;
  edhrecTypes: Record<string, number>;
  roleCounts: Record<string, number>;
  roleTargets: Record<string, number>;
  inclusionMap: Record<string, number>;
  synergyMap: Record<string, number>;
  /** Deck-relative connectivity percentile per spell (0 = least connected).
   *  Only populated when a lift scan is available. */
  connPercentile: Record<string, number>;
  hasConnectivity: boolean;
}

// A spell whose connectivity sits in the bottom fifth of the deck is a genuine
// synergy outlier — few of the cards you run co-play with it. Surfaced as its own
// reason so the user sees *why* it's a cut beyond raw popularity.
const ISOLATED_PERCENTILE = 0.2;

function pickReason(
  card: ScryfallCard,
  ctx: ReasonContext,
): { key: TrimReasonKey; text: string } {
  const incl = ctx.inclusionMap[card.name] ?? 0;
  const syn = ctx.synergyMap[card.name] ?? 0;

  if (incl < 5 && syn <= 0) {
    return { key: 'low-fit', text: `Only ${incl.toFixed(0)}% of decks run this; no synergy bonus.` };
  }

  // Synergy-graph outlier: the card is played, but almost none of your other
  // cards co-play with it — it sits outside the deck's packages.
  if (ctx.hasConnectivity && (ctx.connPercentile[card.name] ?? 1) < ISOLATED_PERCENTILE) {
    return {
      key: 'isolated',
      text: `Few of your cards synergize with this — it sits outside your deck's packages.`,
    };
  }

  const cmcBucket = Math.min(Math.floor(card.cmc ?? 0), 7);
  const actualBucket = ctx.cmcBuckets[cmcBucket] ?? 0;
  const targetBucket = ctx.edhrecCurve[cmcBucket] ?? 0;
  if (targetBucket >= 2 && actualBucket > targetBucket * 1.5) {
    return {
      key: 'off-curve',
      text: `Curve already heavy at CMC ${cmcBucket} (you have ${actualBucket}, average is ${targetBucket}).`,
    };
  }

  const role = card.deckRole;
  if (role && ctx.roleCounts[role] > (ctx.roleTargets[role] ?? 0)) {
    return {
      key: 'redundant-role',
      text: `${ordinal(ctx.roleCounts[role])} ${role} card — target is ${ctx.roleTargets[role]}.`,
    };
  }

  const type = classifyType(card);
  if (type) {
    const actualType = ctx.typeCounts[type] ?? 0;
    const targetType = ctx.edhrecTypes[type] ?? 0;
    if (targetType >= 5 && actualType >= targetType * 1.3) {
      return {
        key: 'type-overflow',
        text: `${type.charAt(0).toUpperCase() + type.slice(1)} slot is full (${actualType} vs. average of ${targetType}).`,
      };
    }
  }

  if (syn < -5) {
    return { key: 'anti-synergy', text: `Synergy score ${syn} — pulls against the commander's themes.` };
  }

  return { key: 'lowest-relevancy', text: 'Lowest relevancy score among remaining cards.' };
}

export function planTrim(input: TrimInput): TrimResult {
  const {
    cards, commanderName, partnerCommanderName,
    targetSize, targetLandCount,
    relevancyMap, inclusionMap, synergyMap,
    roleCounts, roleTargets,
    edhrecCurve, edhrecTypes,
    detectedCombos, mustIncludeNames,
  } = input;

  const protectedNames = new Set<string>();
  protectedNames.add(commanderName);
  if (partnerCommanderName) protectedNames.add(partnerCommanderName);

  // User-pinned cards are an explicit "keep this" signal — never offer for cut.
  if (mustIncludeNames) {
    for (const n of mustIncludeNames) protectedNames.add(n);
  }

  // Combo protection is now baked into relevancyMap (see scoreRecommendation
  // Component 5). Pieces of complete combos score high enough that they sort
  // to the top of the keep pile naturally; near-miss pieces are sticky but
  // cuttable as a last resort. No side-channel protection set needed.

  // Protected from any cut: commanders + basic lands + must-includes.
  const trimmable = cards.filter(c => !protectedNames.has(c.name) && !isBasicLand(c));
  const lands = trimmable.filter(isLand);
  const spells = trimmable.filter(c => !isLand(c));

  // User-facing land count includes basics (the user thinks "I have 36 lands").
  // Cuts can only come from the trimmable land pool (non-basics).
  // Size/land totals exclude commanders (targetSize is commander-exclusive) but
  // MUST count must-includes — pinned cards can't be cut, yet they occupy slots;
  // filtering them here understated the overage by the pinned count.
  const commanderNames = new Set([commanderName, ...(partnerCommanderName ? [partnerCommanderName] : [])]);
  const totalLandsIncludingBasics = cards.filter(c => !commanderNames.has(c.name) && isLand(c)).length;
  const currentSize = cards.filter(c => !commanderNames.has(c.name)).length;
  const overage = Math.max(0, currentSize - targetSize);

  const effectiveLandTarget = clamp(targetLandCount, 0, totalLandsIncludingBasics);
  // Cap at the non-basic land pool size — we can't cut more lands than exist as non-basics.
  const cutLands = Math.min(lands.length, Math.max(0, totalLandsIncludingBasics - effectiveLandTarget));
  const cutSpells = Math.max(0, overage - cutLands);

  const cmcBuckets: Record<number, number> = {};
  const typeCounts: Record<string, number> = {};
  for (const c of spells) {
    const b = Math.min(Math.floor(c.cmc ?? 0), 7);
    cmcBuckets[b] = (cmcBuckets[b] || 0) + 1;
    const t = classifyType(c);
    if (t) typeCounts[t] = (typeCounts[t] || 0) + 1;
  }

  // Deck-relative connectivity percentile per spell (0 = least connected). Built
  // over the trimmable spell pool so "outlier" means outlier *within this deck*,
  // not against some absolute scale. O(n²) but n ≈ 60 — negligible.
  const hasConnectivity = !!input.connectivityMap && Object.keys(input.connectivityMap).length > 0;
  const connPercentile: Record<string, number> = {};
  if (hasConnectivity) {
    const cm = input.connectivityMap!;
    const vals = spells.map(c => cm[c.name] ?? 0);
    for (const c of spells) {
      const v = cm[c.name] ?? 0;
      let below = 0, atOrBelow = 0;
      for (const x of vals) { if (x < v) below++; if (x <= v) atOrBelow++; }
      // Midrank handles ties (a cluster of zero-connectivity cards shares one percentile).
      connPercentile[c.name] = vals.length ? ((below + atOrBelow) / 2) / vals.length : 0.5;
    }
  }

  // Map a card's connectivity percentile to a relevancy-point adjustment in
  // [-SYN_ADJ_MAX, +SYN_ADJ_MAX]. Least-connected (percentile 0) loses the most,
  // pushing synergy outliers toward the cut; well-connected cards are protected.
  // ±35 is meaningful next to typical relevancy gaps but stays below combo/role
  // boosts (~80), so it re-ranks near-ties without overriding hard keeps.
  const SYN_ADJ_MAX = 35;
  const synergyAdj = (name: string) =>
    hasConnectivity ? ((connPercentile[name] ?? 0.5) - 0.5) * 2 * SYN_ADJ_MAX : 0;

  const ctx: ReasonContext = {
    cmcBuckets,
    typeCounts: typeCounts as Record<TypeKey, number>,
    edhrecCurve,
    edhrecTypes,
    roleCounts,
    roleTargets,
    inclusionMap,
    synergyMap,
    connPercentile,
    hasConnectivity,
  };

  const byRelevancy = (a: ScryfallCard, b: ScryfallCard) => {
    const ra = relevancyMap[a.name] ?? 0;
    const rb = relevancyMap[b.name] ?? 0;
    if (ra !== rb) return ra - rb;
    const ia = inclusionMap[a.name] ?? 0;
    const ib = inclusionMap[b.name] ?? 0;
    if (ia !== ib) return ia - ib;
    if ((a.cmc ?? 0) !== (b.cmc ?? 0)) return (b.cmc ?? 0) - (a.cmc ?? 0);
    return a.name.localeCompare(b.name);
  };

  // Spells rank by a synergy-aware keep score: relevancy nudged by connectivity.
  // Lands keep the pure-relevancy order (synergy connectivity is a spell signal;
  // lands are chosen by the land-target math, not the graph).
  const bySpellKeep = (a: ScryfallCard, b: ScryfallCard) => {
    const ka = (relevancyMap[a.name] ?? 0) + synergyAdj(a.name);
    const kb = (relevancyMap[b.name] ?? 0) + synergyAdj(b.name);
    if (ka !== kb) return ka - kb;
    return byRelevancy(a, b);
  };

  const sortedLands = [...lands].sort(byRelevancy);
  const sortedSpells = [...spells].sort(bySpellKeep);

  const toCandidate = (card: ScryfallCard, partition: 'land' | 'spell'): TrimCandidate => {
    // If the card is in a near-miss combo, surface that label — it's the most
    // informative thing to tell the user about a still-cut combo piece.
    const cardNameVariants = card.name.includes(' // ')
      ? [card.name, card.name.split(' // ')[0]]
      : [card.name];
    const isNearMissComboPiece = detectedCombos?.some(combo =>
      !combo.isComplete &&
      combo.missingCards.length === 1 &&
      combo.cards.some(cn => cardNameVariants.includes(cn))
    ) ?? false;
    const { key, text } = isNearMissComboPiece
      ? { key: 'combo-near-miss' as TrimReasonKey, text: 'Piece of a one-away combo — cutting widens the gap.' }
      : pickReason(card, ctx);
    return {
      card,
      reasonKey: key,
      reasonLabel: LABELS[key],
      reasonText: text,
      relevancy: relevancyMap[card.name] ?? 0,
      inclusion: inclusionMap[card.name] ?? 0,
      synergy: synergyMap[card.name] ?? 0,
      partition,
    };
  };

  const landCuts: TrimCandidate[] = [];
  for (const c of sortedLands) {
    if (landCuts.length >= cutLands) break;
    landCuts.push(toCandidate(c, 'land'));
  }

  // Role-scarcity guardrail is now baked into relevancyMap (see
  // scoreRecommendation Component 6). The only boardwipe naturally scores
  // high enough to sort out of the cut window; no separate livingCounts needed.
  const spellCuts: TrimCandidate[] = [];
  for (const c of sortedSpells) {
    if (spellCuts.length >= cutSpells) break;
    spellCuts.push(toCandidate(c, 'spell'));
  }

  const cuts = [...landCuts, ...spellCuts];

  const poolMin = Math.max(25, Math.ceil(overage * 1.5));
  // Only surface land candidates when we're actually cutting lands. Otherwise
  // the user shouldn't be seeing land options in the dialog at all.
  const landPoolWant = cutLands > 0
    ? Math.max(landCuts.length, Math.min(lands.length, Math.ceil(cutLands * 2)))
    : 0;
  const spellPoolWant = Math.max(spellCuts.length, poolMin - landPoolWant);

  const seenNames = new Set(cuts.map(c => c.card.name));
  const allCandidates: TrimCandidate[] = [...cuts];

  for (const c of sortedLands) {
    if (allCandidates.filter(x => x.partition === 'land').length >= landPoolWant) break;
    if (seenNames.has(c.name)) continue;
    allCandidates.push(toCandidate(c, 'land'));
    seenNames.add(c.name);
  }
  for (const c of sortedSpells) {
    if (allCandidates.filter(x => x.partition === 'spell').length >= spellPoolWant) break;
    if (seenNames.has(c.name)) continue;
    allCandidates.push(toCandidate(c, 'spell'));
    seenNames.add(c.name);
  }

  return {
    cuts,
    allCandidates,
    cutLands,
    cutSpells,
    effectiveLandTarget,
  };
}
