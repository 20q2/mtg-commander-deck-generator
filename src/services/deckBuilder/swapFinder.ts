/**
 * Swap finder — "I picked up this card, what comes out?"
 *
 * Given one incoming card and a deck that is already at its target size, rank a
 * handful of cards that could come out for it. Each candidate arrives from a
 * DIFFERENT rationale rather than from successive rungs of one ladder, so the
 * player is comparing reasons ("it duplicates a role I'm full on" vs "it's the
 * weakest fit for my commander") instead of trusting a single opaque ranking.
 *
 * Every input here already lives on the enriched `GeneratedDeck` that the deck
 * view builds, so this stays synchronous and needs no `DeckAnalysis` and no
 * network call — the popover can open with its answer already in it.
 */

import type { ScryfallCard, DetectedCombo } from '@/types';
import { isAnyLand } from '@/services/scryfall/client';
import { getCardRole, type RoleKey } from '@/services/tagger/client';
import { ROLE_LABELS } from '@/services/deckBuilder/roleTargets';

/** Why a card is being offered as the cut. One per candidate, never repeated. */
export type CutRationale = 'role' | 'fit' | 'synergy' | 'curve';

/** One more card from the same category, for when the top pick isn't wanted. */
export interface AlternateCut {
  card: ScryfallCard;
  /** Per-card measurement, shown in the category list so it can be ranked by eye. */
  evidence: string;
}

export interface CutCandidate {
  card: ScryfallCard;
  rationale: CutRationale;
  /** One line, in the product's voice, naming why this card and not another. */
  reason: string;
  /** The measurement behind the reason. Rendered as the evidence figure. */
  evidence: string;
  /** Short name for the category, e.g. "Removal" — heads the alternates list. */
  categoryLabel: string;
  /**
   * The rest of the category, same ranking, best first. Agreeing with the
   * reason but not the card is the common case: "yes, too much removal, but not
   * THAT one". Picking one applies it directly. Excludes every card already
   * offered as a primary.
   */
  alternates: AlternateCut[];
}

/** A reason the card cannot be swapped in at all. */
export type SwapBlock =
  | { kind: 'already-in-deck' }
  | { kind: 'off-identity'; colors: string[] };

export interface SwapInPlan {
  /** Set when the swap is impossible; `candidates` is then empty. */
  block?: SwapBlock;
  /**
   * True when the deck is under target, so the card could simply be added.
   * Candidates are still returned — the user may want the trade anyway — but
   * the UI should say that cutting is optional here.
   */
  roomToAdd: boolean;
  /** How many cards short of target the deck is. 0 when at or over. */
  short: number;
  incomingRole: RoleKey | null;
  candidates: CutCandidate[];
}

export interface FindSwapOptions {
  incoming: ScryfallCard;
  /** Deck cards excluding the commander(s). */
  deckCards: ScryfallCard[];
  /** Every name in the deck, for the already-in-deck guard. */
  deckNames: Set<string>;
  commanderNames?: string[];
  /** Colors the commander(s) permit. Omit to skip the identity guard. */
  allowedColors?: Set<string>;
  /** The deck's target size (`list.deckSize`), commander included. */
  targetSize: number;
  /** The deck's current size, commander included. */
  currentSize: number;
  roleCounts?: Record<string, number>;
  roleTargets?: Record<string, number>;
  /** EDHREC synergy per card. A MISSING key means unknown, not zero. */
  cardSynergyMap?: Record<string, number>;
  /** Composite relevancy per card (raw). A missing key means unknown. */
  cardRelevancyMap?: Record<string, number>;
  mustIncludeNames?: Set<string>;
  detectedCombos?: DetectedCombo[];
  /** Maximum candidates to return. Default 4. */
  limit?: number;
}

/** Cards that must never be offered as the cut, whatever their numbers say. */
function buildProtectedNames(opts: FindSwapOptions): Set<string> {
  const protectedNames = new Set<string>();
  for (const name of opts.commanderNames ?? []) protectedNames.add(name);
  for (const name of opts.mustIncludeNames ?? []) protectedNames.add(name);
  // A combo piece is load-bearing for a line the player chose. Cutting one
  // silently breaks the combo the Inspector told them they had.
  for (const combo of opts.detectedCombos ?? []) {
    if (combo.isComplete) for (const name of combo.cards) protectedNames.add(name);
  }
  return protectedNames;
}

function roleOf(card: ScryfallCard): RoleKey | null {
  return getCardRole(card.name);
}

function labelFor(role: RoleKey): string {
  return ROLE_LABELS[role] ?? role;
}

/**
 * Ascending ranking over a signal that only some cards have. Cards with no
 * entry are dropped rather than treated as zero — the PR this replaces ranked
 * every card EDHREC had never heard of as the deck's worst card.
 */
function rankByWeakest(
  cards: ScryfallCard[],
  signal: Record<string, number> | undefined,
): { card: ScryfallCard; value: number }[] {
  if (!signal) return [];
  return cards
    .filter(c => c.name in signal)
    .map(c => ({ card: c, value: signal[c.name] }))
    .sort((a, b) => a.value - b.value);
}

/** The role the deck is furthest over target on, if any. */
function mostOverTargetRole(
  counts: Record<string, number> | undefined,
  targets: Record<string, number> | undefined,
): { role: RoleKey; over: number } | null {
  if (!counts || !targets) return null;
  let best: { role: RoleKey; over: number } | null = null;
  for (const role of Object.keys(targets) as RoleKey[]) {
    const over = (counts[role] ?? 0) - targets[role];
    if (over <= 0) continue;
    if (!best || over > best.over) best = { role, over };
  }
  return best;
}

function formatSynergy(value: number): string {
  const pct = Math.round(value * 100);
  return `${pct > 0 ? '+' : ''}${pct}% synergy`;
}

export function findSwapCandidates(opts: FindSwapOptions): SwapInPlan {
  const { incoming, deckCards, deckNames, targetSize, currentSize } = opts;
  const incomingRole = roleOf(incoming);
  const short = Math.max(0, targetSize - currentSize);
  const base: SwapInPlan = { roomToAdd: short > 0, short, incomingRole, candidates: [] };

  if (deckNames.has(incoming.name)) return { ...base, block: { kind: 'already-in-deck' } };

  if (opts.allowedColors) {
    const offending = (incoming.color_identity ?? []).filter(c => !opts.allowedColors!.has(c));
    if (offending.length > 0) return { ...base, block: { kind: 'off-identity', colors: offending } };
  }

  const protectedNames = buildProtectedNames(opts);
  // Lands are their own balance problem — cutting one to fit a spell quietly
  // changes the mana base, which is not the trade the player is making here.
  const pool = deckCards.filter(c => !isAnyLand(c) && !protectedNames.has(c.name));
  if (pool.length === 0) return base;

  const { roleCounts, roleTargets, cardSynergyMap, cardRelevancyMap } = opts;
  const ALTERNATES = 8;

  // Each rationale yields a RANKED list, not a winner: the head becomes the
  // offered cut and the tail becomes that category's "more like this". Agreeing
  // with a reason while rejecting its card is the ordinary case.
  type Ranked = {
    cards: ScryfallCard[];
    /**
     * The row's sentence. Card-aware because the curve saving differs per card;
     * only ever called for the head, since alternates are applied directly from
     * the flyout rather than promoted into the row.
     */
    reasonFor: (c: ScryfallCard) => string;
    /** Evidence for the headline pick — explains why the CATEGORY is in play. */
    evidenceFor: (c: ScryfallCard) => string;
    /**
     * Evidence inside the category's own list. Must discriminate between cards:
     * the role categories' headline figure is a deck-level count, identical for
     * every member, so the list falls back to what actually ranked them.
     */
    altEvidenceFor: (c: ScryfallCard) => string;
  };
  const drafts: { rationale: CutRationale; categoryLabel: string; ranked: Ranked }[] = [];

  // ── Rationale 1: role ───────────────────────────────────────────────────
  // If the incoming card fills a role the deck is already full on, the honest
  // cut is like-for-like. If it fills a role the deck is SHORT on, cutting
  // another of that role would undo the upgrade — so cut from whatever role is
  // most over target instead.
  if (roleCounts && roleTargets) {
    const rankRole = (role: RoleKey) => {
      const inRole = pool.filter(c => roleOf(c) === role);
      const byRelevancy = rankByWeakest(inRole, cardRelevancyMap);
      const usingRelevancy = byRelevancy.length > 0;
      const ranked = usingRelevancy ? byRelevancy : rankByWeakest(inRole, cardSynergyMap);
      const value = new Map(ranked.map(r => [r.card.name, r.value]));
      // Cards the signal has never heard of still belong to the role; they go
      // last rather than being dropped from the category entirely.
      const seen = new Set(ranked.map(r => r.card.name));
      return {
        cards: [...ranked.map(r => r.card), ...inRole.filter(c => !seen.has(c.name))],
        perCard: (c: ScryfallCard) => {
          const v = value.get(c.name);
          if (v == null) return 'no data';
          return usingRelevancy ? `relevancy ${Math.round(v)}` : formatSynergy(v);
        },
      };
    };

    const sameRoleIsFull = incomingRole
      && roleTargets[incomingRole] != null
      && (roleCounts[incomingRole] ?? 0) >= roleTargets[incomingRole];

    if (incomingRole && sameRoleIsFull) {
      const count = roleCounts[incomingRole] ?? 0;
      const target = roleTargets[incomingRole];
      const label = labelFor(incomingRole);
      const ranked = rankRole(incomingRole);
      drafts.push({
        rationale: 'role',
        categoryLabel: label,
        ranked: {
          cards: ranked.cards,
          reasonFor: () => `Same role, and you're already at ${count} ${label.toLowerCase()}.`,
          evidenceFor: () => `${count} / ${target} ${label.toLowerCase()}`,
          altEvidenceFor: ranked.perCard,
        },
      });
    } else {
      const over = mostOverTargetRole(roleCounts, roleTargets);
      if (over) {
        const label = labelFor(over.role);
        const ranked = rankRole(over.role);
        drafts.push({
          rationale: 'role',
          categoryLabel: label,
          ranked: {
            cards: ranked.cards,
            reasonFor: () => `Your ${label.toLowerCase()} is ${over.over} over target — this is the slot to spend.`,
            evidenceFor: () => `${roleCounts[over.role] ?? 0} / ${roleTargets[over.role]} ${label.toLowerCase()}`,
            altEvidenceFor: ranked.perCard,
          },
        });
      }
    }
  }

  // ── Rationale 2: weakest fit for this commander ─────────────────────────
  const byFit = rankByWeakest(pool, cardRelevancyMap);
  if (byFit.length) {
    const value = new Map(byFit.map(r => [r.card.name, r.value]));
    drafts.push({
      rationale: 'fit',
      categoryLabel: 'Weakest fit',
      ranked: (() => { const f = (c: ScryfallCard) => `relevancy ${Math.round(value.get(c.name) ?? 0)}`;
        return {
          cards: byFit.map(r => r.card),
          reasonFor: () => 'Weakest fit for this commander of anything in the deck.',
          evidenceFor: f, altEvidenceFor: f,
        }; })(),
    });
  }

  // ── Rationale 3: lowest EDHREC synergy ──────────────────────────────────
  const bySynergy = rankByWeakest(pool, cardSynergyMap);
  if (bySynergy.length) {
    const value = new Map(bySynergy.map(r => [r.card.name, r.value]));
    drafts.push({
      rationale: 'synergy',
      categoryLabel: 'Lowest synergy',
      ranked: (() => { const f = (c: ScryfallCard) => formatSynergy(value.get(c.name) ?? 0);
        return {
          cards: bySynergy.map(r => r.card),
          reasonFor: () => 'Decks with this commander play it least often of your cards.',
          evidenceFor: f, altEvidenceFor: f,
        }; })(),
    });
  }

  // ── Rationale 4: curve pressure ─────────────────────────────────────────
  // Only worth offering when the incoming card is materially cheaper than the
  // top of the curve; otherwise the swap does nothing for the curve.
  const incomingCmc = incoming.cmc ?? 0;
  const byCurve = [...pool].sort((a, b) => (b.cmc ?? 0) - (a.cmc ?? 0))
    .filter(c => (c.cmc ?? 0) - incomingCmc >= 2);
  if (byCurve.length) {
    drafts.push({
      rationale: 'curve',
      categoryLabel: 'Top of curve',
      ranked: (() => { const f = (c: ScryfallCard) => `${Math.round(c.cmc ?? 0)} MV`;
        return {
          cards: byCurve,
          // The saving is per card, so it is recomputed rather than quoted.
          reasonFor: (c) => `Top of your curve, and ${incoming.name} costs ${Math.round((c.cmc ?? 0) - incomingCmc)} less.`,
          evidenceFor: f, altEvidenceFor: f,
        }; })(),
    });
  }

  // Each rationale claims its best card that no earlier one took, so the four
  // rows stay four distinct cards.
  const claimed = new Set<string>();
  const candidates: CutCandidate[] = [];
  for (const draft of drafts) {
    const head = draft.ranked.cards.find(c => !claimed.has(c.name));
    if (!head) continue;
    claimed.add(head.name);
    candidates.push({
      card: head,
      rationale: draft.rationale,
      reason: draft.ranked.reasonFor(head),
      evidence: draft.ranked.evidenceFor(head),
      categoryLabel: draft.categoryLabel,
      alternates: [],
    });
    if (candidates.length >= (opts.limit ?? 4)) break;
  }

  // Alternates are filled only after every primary is known, so no row offers a
  // card that is already the headline of another row.
  for (let i = 0; i < candidates.length; i++) {
    const draft = drafts.find(d => d.rationale === candidates[i].rationale)!;
    candidates[i].alternates = draft.ranked.cards
      .filter(c => !claimed.has(c.name))
      .slice(0, ALTERNATES)
      .map(c => ({ card: c, evidence: draft.ranked.altEvidenceFor(c) }));
  }

  return { ...base, candidates };
}
