import type { ScryfallCard, DetectedCombo } from '@/types';
import { getFrontFaceTypeLine, isMdfcLand, isChannelLand } from '@/services/scryfall/client';

export type TrimReasonKey =
  | 'low-fit'
  | 'off-curve'
  | 'redundant-role'
  | 'type-overflow'
  | 'anti-synergy'
  | 'lowest-relevancy'
  | 'forced'
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
  /** Combos detected in the deck — pieces of complete combos are hard-protected;
   *  pieces of one-away near-misses are soft-protected (last-resort cuts only). */
  detectedCombos?: DetectedCombo[];
  /** User-pinned cards — hard-protected, never offered as cuts. */
  mustIncludeNames?: Set<string>;
}

export interface TrimResult {
  cuts: TrimCandidate[];
  allCandidates: TrimCandidate[];
  cutLands: number;
  cutSpells: number;
  relaxedGuardrail: boolean;
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
  'off-curve': 'Off-curve',
  'redundant-role': 'Redundant',
  'type-overflow': 'Type-heavy',
  'anti-synergy': 'Anti-synergy',
  'lowest-relevancy': 'Lowest',
  'forced': 'Forced cut',
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
}

function pickReason(
  card: ScryfallCard,
  ctx: ReasonContext,
): { key: TrimReasonKey; text: string } {
  const incl = ctx.inclusionMap[card.name] ?? 0;
  const syn = ctx.synergyMap[card.name] ?? 0;

  if (incl < 5 && syn <= 0) {
    return { key: 'low-fit', text: `Only ${incl.toFixed(0)}% of decks run this; no synergy bonus.` };
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

  // Combo protection:
  // - Complete combos: every piece is hard-protected (cutting one silently breaks
  //   the combo, which is exactly the failure mode this fixes).
  // - Near-miss combos (1 piece missing): existing pieces become "soft-protected"
  //   — eligible to cut only as a last resort, after every non-combo candidate.
  const softProtectedNames = new Set<string>();
  if (detectedCombos && detectedCombos.length > 0) {
    const deckNameSet = new Set(cards.map(c => c.name));
    for (const combo of detectedCombos) {
      if (combo.isComplete) {
        for (const name of combo.cards) if (deckNameSet.has(name)) protectedNames.add(name);
      } else if (combo.missingCards.length === 1) {
        for (const name of combo.cards) if (deckNameSet.has(name)) softProtectedNames.add(name);
      }
    }
    // Hard protection wins if a card is in both buckets.
    for (const n of protectedNames) softProtectedNames.delete(n);
  }

  // Protected from any cut: commanders + basic lands + must-includes + complete-combo pieces.
  const trimmable = cards.filter(c => !protectedNames.has(c.name) && !isBasicLand(c));
  const lands = trimmable.filter(isLand);
  const spells = trimmable.filter(c => !isLand(c));

  // User-facing land count includes basics (the user thinks "I have 36 lands").
  // Cuts can only come from the trimmable land pool (non-basics).
  const totalLandsIncludingBasics = cards.filter(c => !protectedNames.has(c.name) && isLand(c)).length;
  const currentSize = cards.filter(c => !protectedNames.has(c.name)).length;
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

  const ctx: ReasonContext = {
    cmcBuckets,
    typeCounts: typeCounts as Record<TypeKey, number>,
    edhrecCurve,
    edhrecTypes,
    roleCounts,
    roleTargets,
    inclusionMap,
    synergyMap,
  };

  const byRelevancy = (a: ScryfallCard, b: ScryfallCard) => {
    // Soft-protected (near-miss combo pieces) sort after everything else,
    // so they only get picked when no other candidates remain.
    const sa = softProtectedNames.has(a.name) ? 1 : 0;
    const sb = softProtectedNames.has(b.name) ? 1 : 0;
    if (sa !== sb) return sa - sb;
    const ra = relevancyMap[a.name] ?? 0;
    const rb = relevancyMap[b.name] ?? 0;
    if (ra !== rb) return ra - rb;
    const ia = inclusionMap[a.name] ?? 0;
    const ib = inclusionMap[b.name] ?? 0;
    if (ia !== ib) return ia - ib;
    if ((a.cmc ?? 0) !== (b.cmc ?? 0)) return (b.cmc ?? 0) - (a.cmc ?? 0);
    return a.name.localeCompare(b.name);
  };

  const sortedLands = [...lands].sort(byRelevancy);
  const sortedSpells = [...spells].sort(byRelevancy);

  const toCandidate = (card: ScryfallCard, partition: 'land' | 'spell', forced = false): TrimCandidate => {
    const isSoft = softProtectedNames.has(card.name);
    const { key, text } = isSoft
      ? { key: 'combo-near-miss' as TrimReasonKey, text: 'Piece of a one-away combo — cutting widens the gap.' }
      : forced
        ? { key: 'forced' as TrimReasonKey, text: 'Lowest relevancy (no safer cut available).' }
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

  const guardrailSafe = (card: ScryfallCard, livingCounts: Record<string, number>): boolean => {
    const role = card.deckRole;
    if (!role) return true;
    const target = roleTargets[role] ?? 0;
    return livingCounts[role] > target;
  };
  const livingCounts: Record<string, number> = { ...roleCounts };

  const spellCuts: TrimCandidate[] = [];
  for (const c of sortedSpells) {
    if (spellCuts.length >= cutSpells) break;
    if (!guardrailSafe(c, livingCounts)) continue;
    spellCuts.push(toCandidate(c, 'spell'));
    if (c.deckRole) livingCounts[c.deckRole]--;
  }

  let relaxedGuardrail = false;
  if (spellCuts.length < cutSpells) {
    relaxedGuardrail = true;
    const remaining = sortedSpells.filter(c => !spellCuts.some(sc => sc.card.name === c.name));
    for (const c of remaining) {
      if (spellCuts.length >= cutSpells) break;
      spellCuts.push(toCandidate(c, 'spell', true));
    }
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
    relaxedGuardrail,
    effectiveLandTarget,
  };
}
