# Land Cut Suggestions (Lands Tab)

**Date:** 2026-05-06
**Status:** Approved — ready for implementation plan

## Problem

When a deck has more lands than its target (`currentLands > effectiveLandTarget`), the Lands tab shows a flat list of cut candidates sorted by score, but:

- The user has to count rows to know how many to cut.
- There is no "Cut all" affordance to bulk-apply the top N.
- Excess basics are never surfaced as cuts (basics are excluded from `cutCandidates`).
- There is no guarantee the list contains at least N candidates if non-basics are scarce.

If the player asks the optimizer to bring lands down to target X, the UI must reliably hand them X concrete suggestions.

## Non-goals

- Not changing the additions / `scoreRecommendation` engine.
- Not changing the in-deck score formula (`inDeckScoreMap`) used to rank nonbasic cuts.
- Not coupling cuts to additions (cutting a land does not auto-add a spell). The user backfills via Suggestions / Optimize.
- Not touching the Overview Quick Cuts panel (which targets total deck size, not land count).

## Audit of existing code we rely on

- `inDeckScoreMap` — `deckAnalyzer.ts:1721-1751`. Composite cut-worthiness score: 50% commander inclusion + 25% global `edhrec_rank` + 25% synergy-boosted inclusion + role-deficit boost (skipped for lands). **Reused unchanged for nonbasic ranking.**
- `analysis.landCards` — already split downstream into MDFC / channel / utility / nonbasic / basic groups in `LandsTab.tsx:280-306`. Reused unchanged.
- `analysis.colorFixing.sourcesPerColor` and pip-demand data — used to pick which color of basic to cut first.
- `analysis.manaBase.adjustedSuggestion` — already incorporates user land-target overrides via `analyzeDeck(..., userLandTarget)`. Used as the effective target.
- Existing land cut UI (`LandsTab.tsx:308-322`) — replaced by the new selection helper.

## Behavior

**Trigger:** `currentLands > effectiveLandTarget`, where `effectiveLandTarget = userLandTarget ?? mb.adjustedSuggestion`.

**N = `currentLands - effectiveLandTarget`** (the number of cuts needed to hit target).

**Selection priority (in order, until N candidates are collected):**

1. **Surplus basics, down to a floor.**
   - `basicFloor = max(2, basicFetcherCount * 2)`, where `basicFetcherCount` = count of cards in the deck whose oracle text matches `/search.+library.+basic/i` (Cultivate, Kodama's Reach, Rampant Growth, Farseek, Three Visits, Nature's Lore, Skyshroud Claim, Harrow, Land Tax, etc.).
   - Within basics, cut from the most-oversupplied color first. Oversupply is measured as `currentBasicsForColor[c] - expectedBasicsForColor[c]`, where `expectedBasicsForColor[c]` is proportional to the pip demand share of color `c` in `colorFixing` (or evenly distributed across color identity if pip-demand is uniform).
   - Each surplus basic copy = one cut row, displayed with its current → next count (e.g., "Forest (8 → 7)").
   - Stop when total basics would drop below `basicFloor`.

2. **Weakest nonbasics**, using existing `inDeckScoreMap` ascending sort.
   - Excludes MDFC, channel lands, utility lands, must-include cards (current behavior).

3. **Last-resort fallback** (only if priorities 1+2 yielded fewer than N candidates):
   - Allow MDFCs and utility lands with a "loses spell flexibility" / "loses utility" warning badge.
   - Channel lands stay excluded — cutting them is too high cost.
   - If still under N after this fallback (extreme edge case), the panel surfaces only what is available; we never silently invent candidates.

**Other candidates:** Beyond the top-N box, surface up to ~6 additional candidates (next-weakest nonbasics) so the user can substitute if they prefer a different cut.

## UI

When triggered, the right column of the Lands tab uses the same two-tier layout as the Overview Quick Cuts panel:

- **Red-tinted top box:**
  - Header: "Cut these N to hit `effectiveLandTarget` lands"
  - `Cut all` button (bulk-applies the top N).
  - Subtle hint line: "Deck will be `currentTotal - N` cards after cuts" — makes the consequence explicit without coupling to additions.
  - Each row: same `CutRow` component used by Quick Cuts. Basic rows show "Forest (8 → 7)" style count delta.
  - Last-resort rows (MDFC/utility) show a small warning badge.

- **"Other candidates" section below:**
  - Same row component, no top-box styling.

The existing Cuts ↔ Suggestions toggle behavior in the Lands tab right column is preserved; this redesign only changes what the Cuts view renders.

When `currentLands <= effectiveLandTarget`, no cut box renders (existing behavior).

## Implementation

**New file:** `src/services/deckBuilder/landCutSelection.ts`
- Exports a pure function:
  ```
  selectLandCuts({
    landCards: AnalyzedCard[],
    nonLandCards: ScryfallCard[],     // for basic-fetcher scan
    colorFixing: ColorFixingAnalysis, // for pip-demand
    colorIdentity: string[],
    target: number,
    currentLands: number,
    mustIncludeNames: Set<string>,
  }): { topN: LandCut[]; others: LandCut[]; basicFloor: number; basicFetcherCount: number }
  ```
- `LandCut` is a small wrapper around `AnalyzedCard` with optional `{ kind: 'basic' | 'nonbasic' | 'fallback', warning?: string, beforeCount?: number, afterCount?: number }`.
- For nonbasic ranking the function uses `AnalyzedCard.score` (already stamped by `makeAnalyzedCard` from `inDeckScoreMap` — no recomputation needed).
- Pure / deterministic / unit-testable.

**Modified file:** `src/components/deck/optimizer/LandsTab.tsx`
- Replace the inline `cutCandidates` `useMemo` (lines 308-322) with a call to `selectLandCuts`.
- Render the top-N box + Cut all + Other candidates list using the existing `CutRow` and `CutCardGrid` patterns.
- Wire `Cut all` to call `onCardAction` with `{ type: 'remove' }` for each top-N card (basics route through `onRemoveBasicLand` instead).

**No changes to `deckAnalyzer.ts`.** Scores are already exposed per land via `analysis.landCards[i].score`.

## Risks and mitigations

- **Basic-fetcher detection over-/under-counts.** Oracle-text regex is approximate. Mitigation: simple regex catches the dominant cases (Cultivate-style); per-color demand is not modeled in v1, only total floor. Users can manually skip suggested basic cuts if a fetcher needs that specific color.
- **Cutting lands under-shoots deck size.** The "Deck will be X cards after cuts" hint makes the consequence explicit; the user is expected to backfill via Suggestions/Optimize.
- **Reusing `inDeckScoreMap` for basics gives misleading scores.** Mitigated by routing basics through their own selection path that ignores the score.
- **Color-pip-demand uneven decks** (e.g., GWB but only Plains pips matter): heuristic falls back to even-distribution if pip-demand is uniform; oversupply ranking degrades gracefully.

## Out of scope

- Auto-replacing cut lands with spells.
- Per-color basic floors driven by colored-fetcher detection (Land Tax demands Plains specifically).
- Adjusting the Overview Quick Cuts panel.
- Changing additions scoring or any part of `scoreRecommendation`.
