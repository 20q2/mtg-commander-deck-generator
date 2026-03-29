# Deck Generator Improvements — Design Spec

**Date:** 2026-03-29
**Goal:** Apply lessons from the deck optimizer/analyzer back into the generator so decks come out better on first generation — without overriding EDHREC community data.

**Philosophy:** EDHREC data is the voice of the community and drives deck shape. We are guardrails against obvious pitfalls. The optimizer remains the "go deeper" tool for users who want fine control.

---

## 1. Tempo Slider UI

### Location
Main customizer panel (`DeckCustomizer.tsx`), always visible, positioned after the Non-Basic Lands slider and before the accordion sections.

### Behavior
- **Default state:** "Auto-detect" toggle is ON. A label shows the detected pacing (e.g., "Detected: Balanced") once EDHREC stats are available. Uses existing `estimatePacingFromStats()`.
- **When toggled OFF:** A 5-stop discrete slider appears:
  - Aggressive | Fast | Balanced | Midrange | Late-game
  - Defaults to whatever was auto-detected, so the user starts from a reasonable baseline.

### Data Model
New fields on `Customization` interface:
- `tempoAutoDetect: boolean` — default `true`
- `tempoPacing: Pacing` — default `'balanced'`

New type in `types/index.ts`:
```typescript
export type Pacing = 'aggressive-early' | 'fast-tempo' | 'balanced' | 'midrange' | 'late-game';
```

### Integration
- When `tempoAutoDetect` is true, the generator calls `estimatePacingFromStats()` as today.
- When false, it uses `customization.tempoPacing` directly.
- Pacing feeds into: role target multipliers (existing), curve target multipliers (new, Section 2), tapland penalty (new, Section 3), and fixup pass (Section 5).

---

## 2. Pacing-Aware Curve Targets

### What Changes
After computing base curve targets from EDHREC data (or fallback) in `curveUtils.ts`, apply pacing multipliers to shift the curve shape.

### Multipliers
Reuse the existing `PACING_MULTIPLIERS` from `deckAnalyzer.ts`, extracted to a shared location (`roleTargets.ts`):

| Pacing | Early (CMC 0-2) | Mid (CMC 3-4) | Late (CMC 5+) |
|--------|-----------------|---------------|----------------|
| aggressive-early | 1.20x | 0.95x | 0.75x |
| fast-tempo | 1.12x | 1.00x | 0.82x |
| balanced | 1.00x | 1.00x | 1.00x |
| midrange | 0.92x | 1.10x | 0.95x |
| late-game | 0.85x | 0.95x | 1.25x |

### Guardrails
- Multipliers are modest (0.75x–1.25x) — they nudge, not override.
- EDHREC data already reflects the commander's natural curve (e.g., Relentless Rats will naturally show heavy CMC-3 concentration).
- **If the user manually set curve percentages** (`advancedTargets.curvePercentages !== null`), pacing multipliers are skipped entirely. User's explicit targets win.
- After applying multipliers, targets are re-normalized to sum to 100% of non-land slots.

### Code Changes
- Extract `PACING_MULTIPLIERS` to `roleTargets.ts` (shared).
- `calculateCurveTargets()` in `curveUtils.ts` accepts optional `pacing: Pacing` parameter.
- When pacing is provided and no user-override exists, multiply each CMC bucket by the appropriate phase multiplier and re-normalize.

---

## 3. Tapland Penalties in Land Selection

### What Changes
During `generateLands()`, taplands receive a priority penalty scaled by pacing. MDFC taplands get half penalty (they're taplands but the spell side compensates).

### Penalty Table

| Pacing | Regular tapland | MDFC tapland |
|--------|----------------|--------------|
| aggressive-early | -30 | -15 |
| fast-tempo | -20 | -10 |
| balanced | -10 | -5 |
| midrange | -5 | -3 |
| late-game | 0 | 0 |

### How Applied
When sorting non-basic land candidates by EDHREC priority in `generateLands()`:
1. Check `isTapland()` (already available from tagger data)
2. Check `isMdfcLand()` (already available)
3. Subtract the appropriate penalty from the card's EDHREC priority score

A tapland with 60% inclusion in an aggressive deck scores 30 after penalty — it can still make the cut if inclusion is high enough, but loses to an untapped alternative at similar inclusion. We never hard-block taplands.

### Detection
- `isTapland()` from tagger data — already exists in `tagger/client.ts`
- `isMdfcLand()` — already exists in `deckGenerator.ts`

---

## 4. Smart Trim Phase

### What Changes
Replace the current blunt category-order trim with a priority-aware trim that respects roles, combos, and must-includes.

### Protection Tiers

1. **Untouchable** (never trimmed):
   - Commanders
   - Must-include cards (`customization.mustIncludeCards`)
   - Basic lands (already not trimmed)

2. **Soft-protected** (large anti-trim boost):
   - Combo pieces: +200 to effective trim priority

3. **Role-aware**:
   - Card fills a role that is at or below target: +50 to trim priority
   - Card fills a role that is 3+ over target: -30 to trim priority (more trim-eligible)

4. **Everything else**: Trimmed by lowest original priority first

### Algorithm
1. Collect ALL non-land, non-commander cards into a single list
2. Score each: `trimResistance = originalPriority + comboBoost + roleBoost + mustIncludeBoost`
3. Sort ascending (lowest resistance = first to cut)
4. Trim from the bottom until at target deck size

### What This Fixes
- Must-include cards can no longer be accidentally trimmed
- Combo pieces survive unless deck is massively overfull
- Ramp creatures won't get cut when ramp is below target
- Surplus board wipes (5 when target is 3) become trim-eligible before deficit ramp cards

---

## 5. Post-Generation Fixup Pass

### What Changes
After the existing pipeline finishes (picking, trimming, lands, stamping), a new `applyFixups()` function runs. Light touch — fixes critical gaps only.

### Checks (in order)

#### 5a. Critical Role Deficits
**Trigger:** Any role at ≤50% of its target (e.g., ≤4 removal when target is 8).

**Action:** For each critically short role:
1. Find the lowest-priority non-role, non-combo card in an overfull CMC slot
2. Swap it with the highest-priority available candidate that fills the deficit role from the remaining EDHREC pool
3. Cap at ~3-5 swaps total across all roles

#### 5b. Dead CMC Slots
**Trigger:** CMC 1 or CMC 2 has zero non-land cards AND:
- Deck is not Tiny Leaders (which caps at CMC 3 and has its own redistribution)
- User did not manually set curve targets (`advancedTargets.curvePercentages === null`)

**Action:** Swap 1-2 of the weakest cards from the most overfull CMC bucket for available cards at the dead CMC.

#### 5c. Tapland Ratio
**Trigger:** Taplands exceed 40% of total lands AND pacing is aggressive-early or fast-tempo.

**Action:** Swap the lowest-inclusion taplands for untapped alternatives from the remaining land pool. Cap at 3 swaps.

### What It Does NOT Check
- Color fixing (too complex for light touch — optimizer territory)
- Ramp-to-draw ratio (moderate issue, not critical)
- 3-CMC congestion (pacing-aware curve targets from Section 2 help, and we don't want to fight EDHREC data for decks that legitimately flood a CMC slot)

### Swap Mechanics
- Pulls from the same EDHREC candidate pools fetched during generation (no new API calls)
- Cards swapped out go into `swapCandidates` so the user can find them in the optimizer
- Cards swapped in get properly stamped with roles/subtypes via `stampRoleSubtypes()`
- Combo pieces have soft protection — never chosen as swap-out targets unless they're the absolute bottom of priority AND no other candidates exist
- `cardInclusionMap` and `deckScore` are updated to reflect swaps

### Transparency
Fixups run silently — no toast or log. The user sees a better deck. The optimizer tab is there for users who want to understand the analysis.

---

## 6. Pacing on GeneratedDeck (Connective Tissue)

### What Changes
Formalize pacing as a first-class resolved value early in generation.

### Type Changes
- Add `Pacing` type to `types/index.ts` (the 5-value union from Section 1)
- Change `GeneratedDeck.detectedPacing` from `string | undefined` to `Pacing`

### Resolution
Early in `generateDeck()`:
1. If `customization.tempoAutoDetect` is true → call `estimatePacingFromStats()` with EDHREC stats
2. If false → use `customization.tempoPacing`
3. Fallback: `'balanced'`

### Consumers
The resolved pacing is passed to:
- `getDynamicRoleTargets()` — existing, already uses pacing for role multipliers
- `calculateCurveTargets()` — new, applies pacing multipliers to curve (Section 2)
- `generateLands()` — new, applies tapland penalties (Section 3)
- `applyFixups()` — new, checks tapland ratio relative to pacing (Section 5)
- Stored on `GeneratedDeck.detectedPacing` for the optimizer/analyzer to read

---

## Files Touched (Estimated)

| File | Changes |
|------|---------|
| `src/types/index.ts` | Add `Pacing` type, update `Customization` interface, update `GeneratedDeck.detectedPacing` |
| `src/store/index.ts` | Add `tempoAutoDetect` and `tempoPacing` to default customization state + setter actions |
| `src/components/customization/DeckCustomizer.tsx` | Add tempo slider UI after Non-Basic Lands |
| `src/services/deckBuilder/roleTargets.ts` | Extract `PACING_MULTIPLIERS` here (shared constant) |
| `src/services/deckBuilder/curveUtils.ts` | Apply pacing multipliers in `calculateCurveTargets()` |
| `src/services/deckBuilder/deckGenerator.ts` | Resolve pacing early; tapland penalties in `generateLands()`; smart trim; `applyFixups()` function; pass pacing throughout |
| `src/services/deckBuilder/deckAnalyzer.ts` | Import `PACING_MULTIPLIERS` from shared location instead of defining locally |

---

## What We Explicitly Don't Do
- Don't override EDHREC data — multipliers nudge, penalties tax, but community data drives decisions
- Don't add color fixing analysis to generation — that's optimizer territory
- Don't add mana trajectory modeling — optimizer territory
- Don't fight legitimate curve shapes (Relentless Rats at CMC 3, storm at CMC 1-2) — EDHREC data naturally reflects these
- Don't add new API calls — fixups use already-fetched pools
- Don't surface fixup details to the user — the optimizer is there for that
