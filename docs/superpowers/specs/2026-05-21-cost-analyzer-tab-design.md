# Cost Analyzer Tab — Design

**Date:** 2026-05-21
**Surface:** Deck Optimizer (analyze page + builder page)
**New tab key:** `cost`

## Purpose

Help users convert a deck to a target budget by surfacing cheaper, role-equivalent alternatives for cards they already have. The user controls a budget target; the tab proposes a **swap plan** of role-matched alternatives ranked by confidence and savings. Nothing changes in the deck until the user explicitly applies the plan.

## Scope (in / out)

**In scope (v1):**
- New `cost` tab in `DeckOptimizer` (`TabKey` extension).
- Budget slider + per-card flag threshold + projected total.
- Stable, sorted list of swap suggestions for non-protected cards.
- Confidence tiers (Drop-in / Sidegrade / Budget pick) with EDHREC inclusion delta.
- Separate Lands section with its own swap logic.
- Protected-cards section (commander, must-includes, basic lands).
- Atomic "Apply plan" action that batches the selected swaps through the existing swap pipeline.
- Works on both generated decks (uses `deck.swapCandidates`) and analyzed/pasted decks (uses `analysis.recommendations` from the cached EDHREC fetch).

**Out of scope (v1):**
- Cost-by-role breakdown chart (deferred; not action-driving).
- Upgrading toward a higher budget (this is a downgrade flow).
- Multi-currency conversion (uses the existing `currency` preference and `getCardPrice`).
- Swap-plan persistence across sessions (plan resets on tab leave).

## User Flow

1. User opens the Cost tab. The tab computes per-card cheapest in-role alternatives and renders the list sorted by confidence then savings.
2. User drags the budget slider to a target. The system auto-checks rows greedily — highest-confidence tier first, then largest absolute $ savings within tier — until projected total ≤ target. Dragging never hides, reorders, or removes rows.
3. User refines: toggles individual rows off (don't accept this swap) or on (accept this one even though target is already met). Projected total updates live.
4. User sets per-card flag threshold (default off). Cards above the threshold get a price-tag highlight in the list. This is *visual only* — does not change which swaps are checked.
5. User clicks **Apply plan**. All checked swaps are batched through `swapCard()` (or equivalent), the deck mutates, the tab refreshes with the new state.

## Layout

Single scrollable column with five regions, top to bottom:

### 1. Budget header (sticky)
- **Totals row:** `Current $X.XX → Projected $Y.YY (save $Z.ZZ)`. Projected updates live as plan toggles.
- **Slider:** range = `[sum of cheapest-alternative prices, current deck total]`. Reflects the realistic min/max for a downgrade.
- **Per-card flag input:** numeric input (`Over $X`), default empty (off). Highlights rows but does not filter.
- **Apply plan button:** primary CTA. Disabled if no rows checked. Shows count + savings: `Apply plan (8 swaps, save $142.30)`.

### 2. Controls strip
- **Confidence filter chips:** `Drop-in` / `Sidegrade` / `Budget pick`. Toggle to include/exclude tiers from the list. Default: Drop-in + Sidegrade on, Budget pick off.
- **Sort selector:** `Savings $` (default) / `Savings %` / `Price (high → low)`.

### 3. Spells section
- Header: `Spells (N suggestions)`.
- Each row (`SwapRow` component):
  - Left: checkbox, current card name + image hover, current price.
  - Arrow `→`.
  - Right: suggested replacement name + image hover, replacement price.
  - Trailing: `Save $X.XX` badge, confidence chip, inclusion delta `42% → 38%`, optional `⚠ different effect` micro-warning for Budget picks.
  - Hover/click on either card name opens `CardPreviewModal` (reuse existing).
  - Right-click on either card → existing `CardContextMenu`.

### 4. Lands section
- Header: `Lands (N suggestions)`.
- Same `SwapRow` layout, but alternative pool is computed from a lands-specific selector (see Land Swap Logic below).
- Empty state: "No cheaper lands match your color identity."

### 5. Protected section
- Header: `Protected (not swappable)` with count and `ⓘ` tooltip.
- Lists protected cards (commander, partner, must-includes, basic lands) as plain text chips. No swap UI.
- Purpose: explicitly answers "where's my commander / why isn't this one suggested?" before the user has to ask.

## Components & Files

### New
- `src/components/deck/optimizer/CostTab.tsx` — top-level tab component. Owns plan state (`Map<oldCardName, suggestedReplacementName>` + checked set), totals, slider, filters.
- `src/components/deck/optimizer/CostTab/SwapRow.tsx` — single swap row. Pure presentational, receives row data + toggle callback.
- `src/services/deckBuilder/costAnalyzer.ts` — pure functions:
  - `buildCostPlan(deck, analysis, opts) → CostPlan` — produces the full ranked list of swap rows for the deck.
  - `pickCheapestAlternative(card, candidatePool, opts) → SwapSuggestion | null` — per-card lookup; encapsulates the role-match + price-cheaper-than-current rule.
  - `classifyConfidence(currentCard, suggestion) → 'drop-in' | 'sidegrade' | 'budget'` — based on CMC delta and inclusion delta.
  - `autoCheckToTarget(rows, target) → Set<rowId>` — greedy plan-builder used by the slider.

### Modified
- `src/components/deck/optimizer/constants.ts` — add `'cost'` to `TabKey`, push `{ key: 'cost', label: 'Cost', icon: <DollarSign> }` into `TABS`, add slug mappings.
- `src/components/deck/optimizer/DeckOptimizer.tsx` — route `cost` tab to `<CostTab>`; pass the cached `analysis` and `cachedEdhrecDataRef.current`.

### Reused (no changes)
- `getSwapCandidatesForCard()` and `swapCard()` in `src/services/deckBuilder/cardSwap.ts`.
- `analysis.recommendations` from `analyzeDeck()`.
- `getCardPrice()` from `src/services/scryfall/client.ts`.
- `CardPreviewModal`, `CardContextMenu`.

## Data Flow

```
DeckOptimizer
  ├─ analysis: DeckAnalysis (cached)
  ├─ deck.swapCandidates (if generated) | undefined
  └─ cachedEdhrecDataRef.current (always present after first analyze)
        │
        ▼
CostTab.useMemo()
  └─ buildCostPlan({
       cards: currentCards,
       protectedNames: { commander, partner, mustIncludes, basicLands },
       candidatePoolByRole: deck.swapCandidates ?? deriveFromAnalysis(analysis.recommendations),
       landCandidatePool: filterLands(analysis.recommendations, colorIdentity),
       prices: Map<name, usd>,
     }) → CostPlan { spellRows, landRows, protected }
        │
        ▼
CostTab renders. User toggles checkboxes / drags slider → updates `checkedSet` and `projectedTotal`.
        │
        ▼
Apply plan → for each checked row: swapCard(deck, oldName, newName). Batched as one store action.
```

## Candidate Pool — Two Sources

**Generated decks:** prefer `deck.swapCandidates[role]`. These are pre-filtered by the generator and feel consistent with what the user saw at generation time.

**Analyzed/pasted decks:** synthesize from `analysis.recommendations`, grouping by `deckRole` (with subtype-aware filtering matching the existing `getSwapCandidatesForCard` fallback to `type:` buckets).

Both paths produce the same shape — `Map<RoleKey | 'type:creature' | ..., RecommendedCard[]>` — so `pickCheapestAlternative` is source-agnostic.

## Confidence Tiers

For a suggestion `S` replacing card `C`:
- **Drop-in:** same role *and* same subtype *and* `|S.cmc - C.cmc| ≤ 1` *and* `(C.inclusion - S.inclusion) ≤ 15` percentage points.
- **Sidegrade:** same role, but either subtype differs OR CMC delta > 1 OR inclusion delta is 15–35 points.
- **Budget pick:** same role only, inclusion delta > 35 points OR S has no inclusion data.

Thresholds live as named constants in `costAnalyzer.ts` for easy tuning.

## Land Swap Logic

Lands need their own pool because role tags don't apply cleanly. Rules for v1:
- Build a land pool from `analysis.recommendations` (`type_line` includes "Land") plus `cachedEdhrecDataRef.current.lands`.
- For each non-basic land in the deck:
  - Filter pool to lands matching the deck's color identity.
  - Match category: dual lands → dual lands; utility → utility (use a small classifier on type line + oracle text — keywords: "Search your library for a", "enters tapped", "Add one mana").
  - Pick cheapest match below current land's price.
- Fetches and shocks are not "Drop-in" candidates for tapped duals — classify those swaps as Sidegrade at best.

## Slider Behavior (precise)

Let `R = ordered rows by (confidence rank: drop-in=0, sidegrade=1, budget=2 — only included if filter on), then savings desc`. Let `target` = current slider value.

```
autoCheckToTarget(rows R, target T):
  checked = ∅
  total = currentTotal
  for row in R:
    if total ≤ T: break
    if row.confidence is excluded by filter: continue
    checked.add(row)
    total -= row.savings
  return checked
```

User toggles after dragging are sticky — the next drag re-runs auto-check from scratch, **except** the user's explicit unchecks within the current slider session are remembered as a `manuallyExcluded` set and not re-checked. Apply plan or slider release without drag clears the manual exclusions.

## Edge Cases & Error Handling

- **No EDHREC data loaded yet:** tab shows a loading state until `analysis` is ready (same gate the other tabs use).
- **Deck total already ≤ slider target:** projected = current, no rows auto-checked, "You're already on budget." inline note.
- **Price missing for a card:** treat as $0 in totals, suppress from suggestions list (can't compute savings).
- **All alternatives more expensive than the card:** no row produced; card is silently excluded from the list (it's not a budget concern).
- **Suggestion already in the deck:** filtered out by `pickCheapestAlternative` (re-checks against current deck contents on every recompute).
- **User clicks Apply, swap fails mid-batch (e.g. card not found):** continue the batch, collect failures, toast the count. Successful swaps stay.

## Visual Style

Matches existing optimizer tab conventions:
- `Card` containers for each section.
- Confidence chips use `<Badge>` with semantic variants — Drop-in = emerald, Sidegrade = amber, Budget = rose.
- Savings amount uses the existing lavender/violet accent (`text-violet-300/80`) consistent with the relevance/synergy color (per memory).
- Slider uses `<Slider>` from shadcn.
- Apply button uses `<Button className="btn-shimmer">` (primary CTA pattern from memory).
- Per-card flag highlight: subtle rose-tinted left border on the row, not a full-row recolor.

## Testing Notes

- Snapshot/render tests for `CostTab` against a fixture deck + analysis.
- Unit tests for `costAnalyzer.ts` functions (pure, easy to test):
  - `pickCheapestAlternative` honors role match, price-cheaper rule, in-deck exclusion.
  - `classifyConfidence` returns the right tier for boundary cases.
  - `autoCheckToTarget` greedy correctness + filter respect.
- Manual QA on (a) a generated bracket-4 deck, (b) a pasted Moxfield decklist via the analyze page.

## Open Questions

None at design time. Tuning thresholds (confidence boundaries, default filter state) can be revised after dogfooding.
