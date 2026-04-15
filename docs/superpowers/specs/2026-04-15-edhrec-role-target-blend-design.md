# EDHREC-Informed Role Targets — Design

**Date:** 2026-04-15
**Status:** Spec approved, pending implementation plan

## Problem

The current role-target system (`getDynamicRoleTargets()` in `src/services/deckBuilder/roleTargets.ts`) combines a format-based baseline (e.g., ramp=10 for 99-card decks) with two multipliers: one derived from the detected archetype (15 buckets like AGGRO, TRIBAL, CONTROL) and one from tempo pacing.

This produces a one-size-fits-all template per archetype bucket. For commanders whose "typical" builds deviate sharply from their archetype bucket, the targets are structurally wrong. The canonical failure case is an elf tribal commander: mapped to `TRIBAL` with a neutral `ramp: 1.0` multiplier, yielding a target of ~10 ramp — while the actual typical elf deck runs 15–20 ramp cards (every mana dork elf counts). The generator picks 10 ramp cards and stops, capped below what the strategy wants.

Archetype multipliers are inherently coarse (15 buckets for thousands of commanders). Per-commander EDHREC data is strictly more granular signal and already available in the app.

## Goal

Make role targets reflect the specific commander's typical build, blended with the existing normative archetype/pacing model. Success criterion: opening the Deck Optimizer on an elf commander shows a visibly higher ramp target than on a non-elf commander of the same archetype-bucket-neutral profile.

## Non-goals

- Replacing the archetype detector or pacing estimator. Both stay.
- Changing card selection scoring. Only the role *targets* (caps) change.
- Adjusting type-distribution or curve targets.
- Using EDHREC theme-page cardlists. Only the commander's page is used; themes continue to influence output via the existing archetype detector.
- Automated tests with synthetic EDHREC fixtures (manual validation only; fixtures would go stale and mostly test our math against itself).

## Approach

Compute EDHREC-derived role counts from the commander's EDHREC cardlists by counting, per role, the number of cards whose `inclusion ≥ 25%` and whose `getCardRole(name)` matches that role. Blend those counts 60/40 (EDHREC / archetype) with the existing archetype-derived targets. Pacing multipliers and the total-cap clamp still apply, after the blend.

The 25% inclusion threshold is the operational proxy for "cards in the typical deck" — inclusion percentage on EDHREC is the fraction of tracked decks that run a card, so cards above 25% are cards played in at least 1 of every 4 decks for this commander. This sidesteps the need to literally simulate an average deck (which would add fiddly edge cases around type distribution and dedup) while producing near-identical output.

Cards not matching one of the four tracked roles (`ramp`, `removal`, `boardwipe`, `cardDraw`) are assumed to be synergy/payoff pieces and correctly contribute nothing to role targets.

## Architecture

### New function: `computeEdhrecRoleTargets`

Location: `src/services/deckBuilder/roleTargets.ts`.

```ts
export function computeEdhrecRoleTargets(
  edhrecData: EDHRECCommanderData | null,
  threshold: number = EDHREC_INCLUSION_THRESHOLD,
): Record<RoleKey, number> {
  const counts: Record<RoleKey, number> = { ramp: 0, removal: 0, boardwipe: 0, cardDraw: 0 };
  if (!edhrecData?.cardlists) return counts;

  const pools = [
    edhrecData.cardlists.creatures,
    edhrecData.cardlists.instants,
    edhrecData.cardlists.sorceries,
    edhrecData.cardlists.artifacts,
    edhrecData.cardlists.enchantments,
    edhrecData.cardlists.planeswalkers,
  ];

  for (const pool of pools) {
    for (const card of pool ?? []) {
      if (card.inclusion < threshold) continue;
      const role = getCardRole(card.name);
      if (role) counts[role]++;
    }
  }

  return counts;
}
```

Key behaviors:
- Lands are skipped (inclusion distribution is not meaningful there; basics dominate).
- EDHREC pools are type-partitioned, so no cross-pool deduplication is needed.
- An empty or null `edhrecData` returns all-zero counts, which the blend treats as "EDHREC contributes nothing" (effectively falling back to archetype-dominant behavior naturally).

### Modified function: `getDynamicRoleTargets`

Same file. New optional parameter `edhrecData: EDHRECCommanderData | null`. New returned `breakdown` field for UI consumption.

```ts
const EDHREC_INCLUSION_THRESHOLD = 25; // percent
const EDHREC_BLEND_WEIGHT = 0.6;       // 0 = archetype only, 1 = EDHREC only

export interface RoleTargetBreakdown {
  edhrecCount: number | null;   // null when no EDHREC data provided
  archetypeTarget: number;      // after base × archetype multiplier, before blend
  pacingMultiplier: number;
  blended: number;              // after blend, after pacing, after clamp
}

export function getDynamicRoleTargets(
  format: DeckFormat,
  selectedThemes?: ThemeResult[],
  edhrecStats?: EDHRECCommanderStats,
  edhrecData?: EDHRECCommanderData | null,
  overrideBlendWeight?: number,
  overrideThreshold?: number,
): {
  targets: Record<RoleKey, number>;
  archetype: Archetype;
  pacing: Pacing;
  breakdown: Record<RoleKey, RoleTargetBreakdown>;
}
```

Flow:

```
base_target (from format, unchanged)
  → × archetype_multiplier          = archetype_target
  → blend weight × edhrec_count + (1 - weight) × archetype_target
                                    = blended_pre_pacing
  → × pacing_multiplier             = final_target (pre-clamp)
  → clamp by maxTotal/minTotal      = returned target
```

Blend weight and threshold come from `overrideBlendWeight`/`overrideThreshold` if passed, else from the `EDHREC_BLEND_WEIGHT`/`EDHREC_INCLUSION_THRESHOLD` constants. When `edhrecData` is null or undefined, `edhrecCount` in the breakdown is `null` and the blend step is skipped (target = archetype_target).

Minimum floors stay the same: `ramp`, `removal`, `cardDraw` ≥ 1; `boardwipe` ≥ 0.

### Advanced override

New optional fields on `customization.advancedTargets` (defined in `src/types/index.ts`):

```ts
advancedTargets?: {
  roleTargets?: Record<RoleKey, number>;   // existing — still wins outright when set
  curvePercentages?: ...;                  // existing
  edhrecBlendWeight?: number;              // NEW — 0..1, overrides default 0.6
  edhrecInclusionThreshold?: number;       // NEW — percent, overrides default 25
};
```

When `advancedTargets.roleTargets` is set, the blend is skipped entirely (existing behavior, unchanged). When it's not set and `edhrecBlendWeight` / `edhrecInclusionThreshold` are provided, they override the constants. This matches how existing advanced knobs layer onto the default path.

UI exposure (in `src/components/customization/AdvancedCustomization.tsx`):
- `edhrecBlendWeight` is exposed as a single slider labeled "EDHREC Match Strength" with a brief explanatory tooltip. Range 0–1 rendered as 0–100%.
- `edhrecInclusionThreshold` is type-only, not in UI (dev-only tuning knob for now).

### Call site

`src/services/deckBuilder/deckGenerator.ts`, around line 2326:

```ts
} else if (customization.balancedRoles) {
  const dynamic = getDynamicRoleTargets(
    format,
    context.selectedThemes,
    edhrecData?.stats,
    edhrecData,
    customization.advancedTargets?.edhrecBlendWeight,
    customization.advancedTargets?.edhrecInclusionThreshold,
  );
  roleTargets = dynamic.targets;
  detectedArchetype = dynamic.archetype;
  roleTargetBreakdown = dynamic.breakdown;   // NEW — persisted on deck
  if (customization.tempoAutoDetect) {
    resolvedPacing = dynamic.pacing;
    detectedPacing = dynamic.pacing;
  }
}
```

The breakdown is stored on the generated deck object (new field on `GeneratedDeck`, e.g., `roleTargetBreakdown?: Record<RoleKey, RoleTargetBreakdown>`) so the UI can render tooltips without recomputing.

### UI tooltip

In the Deck Optimizer's role-target display (confirmed during implementation — likely `BracketTab.tsx` or a sibling component), each role target gets a hover tooltip using the existing `<Tooltip>` component:

```
Target: 14

EDHREC-typical: 17 cards tagged ramp in the top-included list
Archetype baseline: 10 (Tribal)
Pacing: ×1.00 (balanced)
Blended: 14
```

When `breakdown[role].edhrecCount === null` (commander not on EDHREC, or EDHREC data not loaded), the "EDHREC-typical" line is omitted — tooltip shows only archetype + pacing, matching pre-change information content.

## Data flow

```
User selects commander
  → app fetches EDHREC commander data (existing)
  → deck generation runs
      → getDynamicRoleTargets(format, themes, edhrecStats, edhrecData, ...)
          → archetype detection (existing)
          → pacing estimation (existing)
          → computeEdhrecRoleTargets(edhrecData)  [NEW]
          → blend per role                        [NEW]
          → pacing multiply + clamp (existing)
          → return { targets, archetype, pacing, breakdown }
      → deck.roleTargetBreakdown stored on GeneratedDeck  [NEW]
  → Optimizer renders targets with tooltip reading breakdown  [NEW]
```

## Error handling / edge cases

- **No EDHREC data for commander.** `edhrecData` is null → `computeEdhrecRoleTargets` returns zero counts → blend is skipped (breakdown.edhrecCount set to `null`) → target = archetype_target. Tooltip hides the EDHREC line. Behavior is identical to pre-change.
- **EDHREC pool present but no cards above threshold for a role.** Count is 0 → blend resolves to `0.6 × 0 + 0.4 × archetype_target = 0.4 × archetype_target`, correctly signaling "this commander's typical deck runs little of this role." Acceptable; this is a legitimate signal.
- **Very sparse EDHREC data (e.g., 30 decks total).** Few cards clear 25% → small EDHREC counts → archetype dominates naturally. No special handling; the math self-damps. A `console.log` note when `numDecks < 100` helps debugging but doesn't change behavior.
- **`advancedTargets.roleTargets` set.** Entire blend path is skipped; user's explicit targets win. Unchanged.
- **`edhrecBlendWeight = 0`.** Equivalent to pre-change behavior (pure archetype path).
- **`edhrecBlendWeight = 1`.** Targets driven entirely by EDHREC counts, archetype ignored for counts but still reported in breakdown/logs.

## Validation

Manual validation (no automated tests — EDHREC data drifts and synthetic fixtures would be circular):

1. Pick a known elf commander (e.g., Ezuri, Renegade Leader). Open Optimizer. Ramp target should be visibly higher than pre-change and higher than a non-elf tribal commander.
2. Hover the ramp target. Tooltip shows an "EDHREC-typical: N cards" line alongside the archetype baseline.
3. Pick a non-elf, non-ramp-heavy commander (e.g., Atraxa, Grand Unifier). Ramp target stays reasonable, not artificially elevated.
4. Set `edhrecBlendWeight = 0` via Advanced Customization. Output matches pre-change behavior (regression check).
5. Pick an obscure commander with no EDHREC page (if possible). Tooltip omits the EDHREC line; targets fall back to archetype-only.

## Constants summary

```ts
const EDHREC_INCLUSION_THRESHOLD = 25;  // percent
const EDHREC_BLEND_WEIGHT = 0.6;        // 60% EDHREC, 40% archetype
```

Both overridable via `advancedTargets` fields. Both live as named exports at the top of `roleTargets.ts` for easy discovery.

## Files touched

- `src/services/deckBuilder/roleTargets.ts` — new function, modified signature, new return field, new constants.
- `src/services/deckBuilder/deckGenerator.ts` — call-site update (~line 2326), persist breakdown on deck.
- `src/types/index.ts` — `RoleTargetBreakdown` type, `GeneratedDeck.roleTargetBreakdown` field, `advancedTargets` additions.
- `src/components/customization/AdvancedCustomization.tsx` — new "EDHREC Match Strength" slider.
- `src/components/deck/optimizer/BracketTab.tsx` (or wherever role targets render in the optimizer) — tooltip on each target number.
