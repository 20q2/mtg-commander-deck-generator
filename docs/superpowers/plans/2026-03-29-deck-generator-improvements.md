# Deck Generator Improvements — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply optimizer lessons back into the generator — tempo slider, pacing-aware curves, tapland penalties, smart trim, and a post-generation fixup pass — so decks come out better on first generation without overriding EDHREC community data.

**Architecture:** Approach A — keep the existing EDHREC-driven pipeline intact, add a lightweight post-generation fixup pass for critical gaps, and fold in inline improvements (tapland penalties, pacing-aware curves, smart trim). A new tempo slider in the UI lets users override auto-detected pacing.

**Tech Stack:** React 18, TypeScript, Zustand, Tailwind CSS, shadcn/ui Slider component

**Spec:** `docs/superpowers/specs/2026-03-29-deck-generator-improvements-design.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/types/index.ts` | Modify | Add `Pacing` type, update `Customization` and `GeneratedDeck` interfaces |
| `src/store/index.ts` | Modify | Add `tempoAutoDetect` and `tempoPacing` defaults |
| `src/services/deckBuilder/roleTargets.ts` | Modify | Export `PACING_CURVE_MULTIPLIERS`, export `estimatePacingFromStats` |
| `src/services/deckBuilder/curveUtils.ts` | Modify | Accept pacing param in `calculateCurveTargets()`, apply multipliers |
| `src/services/deckBuilder/deckAnalyzer.ts` | Modify | Import `PACING_CURVE_MULTIPLIERS` from shared location |
| `src/services/deckBuilder/themeDetector.ts` | Modify | Remove `Pacing` type (moved to types/index.ts) |
| `src/services/deckBuilder/deckGenerator.ts` | Modify | Resolve pacing early, tapland penalties in lands, smart trim, fixup pass |
| `src/components/customization/DeckCustomizer.tsx` | Modify | Add tempo slider UI |

---

## Task 1: Types & Data Model Foundation

**Files:**
- Modify: `src/types/index.ts:391-420` (Customization), `src/types/index.ts:296` (GeneratedDeck.detectedPacing)
- Modify: `src/store/index.ts:173-202` (defaultCustomization)
- Modify: `src/services/deckBuilder/themeDetector.ts:8` (remove Pacing export)

- [ ] **Step 1: Add `Pacing` type to `src/types/index.ts`**

Add near the other type aliases (near line 388, before the `AdvancedTargets` interface):

```typescript
export type Pacing = 'aggressive-early' | 'fast-tempo' | 'balanced' | 'midrange' | 'late-game';
```

- [ ] **Step 2: Add tempo fields to `Customization` interface in `src/types/index.ts`**

Add two new fields before the closing brace of `Customization` (after `advancedTargets` on line 419):

```typescript
  tempoAutoDetect: boolean;
  tempoPacing: Pacing;
```

- [ ] **Step 3: Update `GeneratedDeck.detectedPacing` type in `src/types/index.ts`**

Change line 296 from:
```typescript
detectedPacing?: string;
```
to:
```typescript
detectedPacing?: Pacing;
```

Also add `Pacing` to the `GeneratedDeck` interface's imports if needed (it's in the same file so just the type reference is sufficient).

- [ ] **Step 4: Update `themeDetector.ts` to import `Pacing` instead of defining it**

In `src/services/deckBuilder/themeDetector.ts`, line 8, replace:
```typescript
export type Pacing = 'aggressive-early' | 'fast-tempo' | 'midrange' | 'late-game' | 'balanced';
```
with:
```typescript
import type { Pacing } from '@/types';
export type { Pacing };
```

The re-export preserves backward compatibility — existing imports from `themeDetector` continue to work.

- [ ] **Step 5: Update store defaults in `src/store/index.ts`**

Add to `defaultCustomization` (after `advancedTargets` on line 201):

```typescript
  tempoAutoDetect: true,
  tempoPacing: 'balanced' as const,
```

- [ ] **Step 6: Build verification**

Run: `npx tsc --noEmit`
Expected: No new type errors. Existing code that imports `Pacing` from `themeDetector` still works via re-export.

- [ ] **Step 7: Commit**

```bash
git add src/types/index.ts src/store/index.ts src/services/deckBuilder/themeDetector.ts
git commit -m "feat: add Pacing type and tempo customization fields"
```

---

## Task 2: Extract PACING_CURVE_MULTIPLIERS to Shared Location

**Files:**
- Modify: `src/services/deckBuilder/roleTargets.ts:145-151`
- Modify: `src/services/deckBuilder/deckAnalyzer.ts:564-570`

- [ ] **Step 1: Add `PACING_CURVE_MULTIPLIERS` to `roleTargets.ts`**

Add after the existing `PACING_ROLE_ADJUSTMENTS` constant (after line 151) in `src/services/deckBuilder/roleTargets.ts`:

```typescript
/** Multipliers for mana curve phases by pacing. Used by both generator and analyzer. */
export const PACING_CURVE_MULTIPLIERS: Record<Pacing, { early: number; mid: number; late: number }> = {
  'aggressive-early': { early: 1.20, mid: 0.95, late: 0.75 },
  'fast-tempo':       { early: 1.12, mid: 1.00, late: 0.82 },
  'balanced':         { early: 1.00, mid: 1.00, late: 1.00 },
  'midrange':         { early: 0.92, mid: 1.10, late: 0.95 },
  'late-game':        { early: 0.85, mid: 0.95, late: 1.25 },
};
```

- [ ] **Step 2: Export `estimatePacingFromStats` in `roleTargets.ts`**

On line 160, change:
```typescript
function estimatePacingFromStats(manaCurve: Record<number, number>): Pacing {
```
to:
```typescript
export function estimatePacingFromStats(manaCurve: Record<number, number>): Pacing {
```

This function is currently only called internally by `getDynamicRoleTargets()`, but the generator needs to call it directly when `tempoAutoDetect` is true and balanced roles are off.

- [ ] **Step 3: Update `deckAnalyzer.ts` to import from shared location**

In `src/services/deckBuilder/deckAnalyzer.ts`, replace the local `PACING_MULTIPLIERS` definition (lines 564-570) with an import:

```typescript
import { PACING_CURVE_MULTIPLIERS } from './roleTargets';
```

Then update all references in `deckAnalyzer.ts` from `PACING_MULTIPLIERS` to `PACING_CURVE_MULTIPLIERS`. Find usages (grep for `PACING_MULTIPLIERS` in this file) and rename them all. The main usage is around line 655:
```typescript
const multipliers = pacing ? PACING_CURVE_MULTIPLIERS[pacing] : PACING_CURVE_MULTIPLIERS.balanced;
```

- [ ] **Step 4: Build verification**

Run: `npx tsc --noEmit`
Expected: No errors. The analyzer still works identically — same values, just imported.

- [ ] **Step 5: Commit**

```bash
git add src/services/deckBuilder/roleTargets.ts src/services/deckBuilder/deckAnalyzer.ts
git commit -m "refactor: extract PACING_CURVE_MULTIPLIERS to shared roleTargets module"
```

---

## Task 3: Pacing-Aware Curve Targets

**Files:**
- Modify: `src/services/deckBuilder/curveUtils.ts:61-101`
- Modify: `src/services/deckBuilder/deckGenerator.ts` (call site for `calculateCurveTargets`)

- [ ] **Step 1: Update `calculateCurveTargets()` signature in `curveUtils.ts`**

Add a `Pacing` import and an optional pacing parameter. Change lines 61-64 from:

```typescript
export function calculateCurveTargets(
  manaCurve: Record<number, number>,
  totalNonLandCards: number
): Record<number, number> {
```

to:

```typescript
import type { Pacing } from '@/types';
import { PACING_CURVE_MULTIPLIERS } from './roleTargets';

export function calculateCurveTargets(
  manaCurve: Record<number, number>,
  totalNonLandCards: number,
  pacing?: Pacing
): Record<number, number> {
```

(Move the imports to the top of the file with the other imports.)

- [ ] **Step 2: Apply pacing multipliers after computing base targets**

In `calculateCurveTargets()`, after the rounding adjustment (line 98) but before `return targets` (line 100), add:

```typescript
  // Apply pacing multipliers to shift curve shape (skip if balanced or not specified)
  if (pacing && pacing !== 'balanced') {
    const mult = PACING_CURVE_MULTIPLIERS[pacing];
    // Apply phase multipliers to each CMC bucket
    for (const cmc of cmcKeys) {
      const phase = cmc <= 2 ? 'early' : cmc <= 4 ? 'mid' : 'late';
      targets[cmc] = Math.round(targets[cmc] * mult[phase]);
    }
    // Re-normalize to maintain exact total
    let newTotal = Object.values(targets).reduce((a, b) => a + b, 0);
    const normDiff = totalNonLandCards - newTotal;
    if (normDiff !== 0) {
      const largest = cmcKeys.reduce((max, cmc) =>
        (targets[cmc] || 0) > (targets[max] || 0) ? cmc : max, cmcKeys[0]);
      targets[largest] = (targets[largest] || 0) + normDiff;
    }
  }
```

Also apply the same logic to the fallback curve (the early return block at lines 68-80). After computing the fallback targets, apply the same multiplier logic before returning. Replace lines 68-80:

```typescript
  if (Object.keys(percentages).length === 0) {
    // Fallback: balanced curve if no data
    const fallback: Record<number, number> = {
      0: Math.round(totalNonLandCards * 0.02),
      1: Math.round(totalNonLandCards * 0.12),
      2: Math.round(totalNonLandCards * 0.20),
      3: Math.round(totalNonLandCards * 0.25),
      4: Math.round(totalNonLandCards * 0.18),
      5: Math.round(totalNonLandCards * 0.12),
      6: Math.round(totalNonLandCards * 0.06),
      7: Math.round(totalNonLandCards * 0.05),
    };
    if (pacing && pacing !== 'balanced') {
      const mult = PACING_CURVE_MULTIPLIERS[pacing];
      for (const cmc of Object.keys(fallback).map(Number)) {
        const phase = cmc <= 2 ? 'early' : cmc <= 4 ? 'mid' : 'late';
        fallback[cmc] = Math.round(fallback[cmc] * mult[phase]);
      }
      let newTotal = Object.values(fallback).reduce((a, b) => a + b, 0);
      const normDiff = totalNonLandCards - newTotal;
      if (normDiff !== 0) {
        const largest = Object.keys(fallback).map(Number).reduce((max, cmc) =>
          (fallback[cmc] || 0) > (fallback[max] || 0) ? cmc : max, 3);
        fallback[largest] = (fallback[largest] || 0) + normDiff;
      }
    }
    return fallback;
  }
```

- [ ] **Step 3: Update call site in `deckGenerator.ts`**

Find where `calculateCurveTargets` is called in `deckGenerator.ts` (search for `calculateCurveTargets(`). Pass the resolved pacing, but **only when the user has NOT set custom curve percentages**:

```typescript
const curveTargets = calculateCurveTargets(
  edhrecData?.stats?.mana_curve ?? {},
  totalNonLandCards,
  customization.advancedTargets?.curvePercentages ? undefined : resolvedPacing
);
```

Note: `resolvedPacing` doesn't exist yet — it will be wired in Task 5. For now, add the parameter and pass `undefined` as a placeholder so the build doesn't break. Task 5 will replace `undefined` with `resolvedPacing`.

- [ ] **Step 4: Build verification**

Run: `npx tsc --noEmit`
Expected: No errors. With `undefined` pacing, behavior is identical to current.

- [ ] **Step 5: Commit**

```bash
git add src/services/deckBuilder/curveUtils.ts src/services/deckBuilder/deckGenerator.ts
git commit -m "feat: pacing-aware curve targets in calculateCurveTargets"
```

---

## Task 4: Tempo Slider UI

**Files:**
- Modify: `src/components/customization/DeckCustomizer.tsx:371-373` (insert between Non-Basic Lands and Budget accordion)

- [ ] **Step 1: Add imports**

In `src/components/customization/DeckCustomizer.tsx`, add to the existing imports:

```typescript
import type { Pacing } from '@/types';
```

- [ ] **Step 2: Add pacing label map constant**

Add a constant near the top of the file (after imports, before the component function):

```typescript
const PACING_LABELS: { value: Pacing; label: string }[] = [
  { value: 'aggressive-early', label: 'Aggressive' },
  { value: 'fast-tempo', label: 'Fast' },
  { value: 'balanced', label: 'Balanced' },
  { value: 'midrange', label: 'Midrange' },
  { value: 'late-game', label: 'Late Game' },
];
```

- [ ] **Step 3: Add the tempo section JSX**

Insert between line 371 (end of Non-Basic Lands `</div>`) and line 373 (Budget accordion). The section renders:
- Always: a "Tempo" label row with an "Auto-detect" toggle
- When auto-detect is ON: shows the detected pacing as a small badge
- When auto-detect is OFF: shows a 5-stop slider

```tsx
      {/* Tempo / Pacing */}
      <div>
        <div className="flex justify-between items-center mb-2">
          <label className="text-sm font-medium flex items-center gap-1.5">
            Tempo
            <InfoTooltip content="Controls the speed of the deck — aggressive decks want cheap cards and untapped lands, late-game decks prioritize haymakers." />
          </label>
          <button
            onClick={() => updateCustomization({ tempoAutoDetect: !customization.tempoAutoDetect })}
            className={`text-xs px-2 py-0.5 rounded-full border transition-colors ${
              customization.tempoAutoDetect
                ? 'bg-primary/15 border-primary/30 text-primary'
                : 'bg-muted border-border text-muted-foreground hover:text-foreground'
            }`}
          >
            Auto-detect{customization.tempoAutoDetect && edhrecStats?.detectedPacing ? `: ${PACING_LABELS.find(p => p.value === edhrecStats.detectedPacing)?.label ?? 'Balanced'}` : ''}
          </button>
        </div>
        {!customization.tempoAutoDetect && (
          <>
            <Slider
              value={PACING_LABELS.findIndex(p => p.value === customization.tempoPacing)}
              min={0}
              max={PACING_LABELS.length - 1}
              step={1}
              onChange={(value) => updateCustomization({ tempoPacing: PACING_LABELS[value].value })}
            />
            <div className="flex justify-between text-xs text-muted-foreground mt-1">
              <span>Aggressive</span>
              <span>Balanced</span>
              <span>Late Game</span>
            </div>
          </>
        )}
      </div>
```

Note: `edhrecStats?.detectedPacing` — check how the component currently accesses EDHREC stats. It likely comes from the store or from a prop. If it's not available here, the auto-detect label can simply show "Auto-detect" without the detected value, and that's fine. The important part is the toggle and slider work correctly. Investigate the component's existing data sources and use whatever provides EDHREC stats.

- [ ] **Step 4: Build verification**

Run: `npx tsc --noEmit` and `npx vite build`
Expected: No errors. The slider renders but doesn't affect generation yet (Task 5 wires it).

- [ ] **Step 5: Commit**

```bash
git add src/components/customization/DeckCustomizer.tsx
git commit -m "feat: add tempo slider UI to deck customizer"
```

---

## Task 5: Resolve Pacing Early in Generator

**Files:**
- Modify: `src/services/deckBuilder/deckGenerator.ts:1636` (pacing declaration), `src/services/deckBuilder/deckGenerator.ts:2276-2281` (pacing resolution)

This is the connective tissue — resolve pacing once at the top of `generateDeck()` and thread it to all consumers.

- [ ] **Step 1: Import `estimatePacingFromStats` and `Pacing` type**

In `src/services/deckBuilder/deckGenerator.ts`, add to imports (near line 32):

```typescript
import { getDynamicRoleTargets, estimatePacingFromStats } from './roleTargets';
```

(Replace the existing `import { getDynamicRoleTargets } from './roleTargets';`)

Also add `Pacing` to the type imports from `@/types` on line 1-21.

- [ ] **Step 2: Resolve pacing early**

Replace line 1636:
```typescript
let detectedPacing: string | undefined;
```

with:

```typescript
// Resolve pacing: user override > auto-detect from EDHREC stats > fallback
let resolvedPacing: Pacing = 'balanced';
if (!customization.tempoAutoDetect) {
  resolvedPacing = customization.tempoPacing;
} else if (edhrecData?.stats?.mana_curve) {
  resolvedPacing = estimatePacingFromStats(edhrecData.stats.mana_curve);
}
let detectedPacing: Pacing = resolvedPacing;
```

Note: `edhrecData` may not be loaded yet at line 1636 if it's fetched later. Check the generation flow — if EDHREC data loads later, move this resolution to right after `edhrecData` is available (likely around line 2270 where `getDynamicRoleTargets` is currently called). The key is: resolve `resolvedPacing` BEFORE `calculateCurveTargets` is called.

- [ ] **Step 3: Update the balanced roles block**

In the existing balanced roles block (lines 2276-2281), update to use `resolvedPacing` instead of getting pacing from `getDynamicRoleTargets`:

```typescript
    } else if (customization.balancedRoles) {
      const dynamic = getDynamicRoleTargets(format, context.selectedThemes, edhrecData?.stats);
      roleTargets = dynamic.targets;
      detectedArchetype = dynamic.archetype;
      // Pacing already resolved above — but if auto-detect, use the archetype-aware pacing from dynamic
      if (customization.tempoAutoDetect) {
        resolvedPacing = dynamic.pacing;
        detectedPacing = dynamic.pacing;
      }
    }
```

This way: when balanced roles is on AND auto-detect is on, we get the richer archetype-aware pacing from `getDynamicRoleTargets`. When balanced roles is off or the user overrides pacing, we use the simpler `estimatePacingFromStats` or the user's explicit choice.

- [ ] **Step 4: Wire pacing to `calculateCurveTargets` call**

Find the `calculateCurveTargets` call and replace the `undefined` placeholder from Task 3 with `resolvedPacing`:

```typescript
const curveTargets = calculateCurveTargets(
  edhrecData?.stats?.mana_curve ?? {},
  totalNonLandCards,
  customization.advancedTargets?.curvePercentages ? undefined : resolvedPacing
);
```

- [ ] **Step 5: Update final return to use `detectedPacing`**

The return statement on line 3552 already has `detectedPacing`. Since we changed its type from `string | undefined` to `Pacing`, this should just work. Verify the assignment.

- [ ] **Step 6: Build verification**

Run: `npx tsc --noEmit`
Expected: No errors. Pacing now flows from customization through to curve targets and the returned deck.

- [ ] **Step 7: Commit**

```bash
git add src/services/deckBuilder/deckGenerator.ts
git commit -m "feat: resolve pacing early in generator, wire to curve targets"
```

---

## Task 6: Tapland Penalties in Land Selection

**Files:**
- Modify: `src/services/deckBuilder/deckGenerator.ts:1113-1172` (`generateLands` and its call to `pickFromPrefetched`)

- [ ] **Step 1: Import `isTapland` in deckGenerator.ts**

Add `isTapland` to the tagger import on line 29:

```typescript
import { loadTaggerData, hasTaggerData, getCardRole, getCardSubtype, hasMultipleRoles, getRampSubtype, getRemovalSubtype, getBoardwipeSubtype, getCardDrawSubtype, isTapland, type RoleKey } from '@/services/tagger/client';
```

- [ ] **Step 2: Add tapland penalty constant**

Add near the top of `deckGenerator.ts` (after imports, with other constants):

```typescript
import type { Pacing } from '@/types';

const TAPLAND_PENALTIES: Record<Pacing, number> = {
  'aggressive-early': -30,
  'fast-tempo': -20,
  'balanced': -10,
  'midrange': -5,
  'late-game': 0,
};
```

- [ ] **Step 3: Build tapland penalty map before land picking**

In `generateLands()`, add a `pacing` parameter to the function signature (add it as the last parameter):

```typescript
  async function generateLands(
    edhrecLands: EDHRECCard[],
    colorIdentity: string[],
    count: number,
    usedNames: Set<string>,
    basicCount: number,
    format: DeckFormat,
    nonLandCards: ScryfallCard[],
    onProgress?: (message: string, percent: number) => void,
    bannedCards: Set<string> = new Set(),
    maxCardPrice: number | null = null,
    maxRarity: MaxRarity = null,
    maxCmc: number | null = null,
    budgetTracker: BudgetTracker | null = null,
    collectionNames?: Set<string>,
    currency: 'USD' | 'EUR' = 'USD',
    arenaOnly: boolean = false,
    scryfallQuery: string = '',
    preferredSet?: string,
    collectionStrategy: CollectionStrategy = 'full',
    collectionOwnedPercent: number = 100,
    ignoreOwnedBudget: boolean = false,
    pacing: Pacing = 'balanced'
  ): Promise<ScryfallCard[]> {
```

Then, after `landCardMap` is built (line 1169) but before `pickFromPrefetched` is called (line 1170), build a penalty map:

```typescript
    // Build tapland penalty map for pacing-aware land selection
    const landPenalties = new Map<string, number>();
    const basePenalty = TAPLAND_PENALTIES[pacing];
    if (basePenalty !== 0) {
      for (const [name, card] of landCardMap) {
        if (isTapland(name)) {
          // MDFC taplands get half penalty — the spell side compensates
          const penalty = isMdfcLand(card) ? Math.round(basePenalty / 2) : basePenalty;
          landPenalties.set(name, penalty);
        }
      }
    }
```

Then pass `landPenalties` as the `comboPriorityBoost` parameter in the `pickFromPrefetched` call on line 1170. The parameter is currently `undefined` — change it to `landPenalties.size > 0 ? landPenalties : undefined`:

```typescript
    const nonBasics = pickFromPrefetched(nonBasicEdhrecLands, landCardMap, nonBasicTarget, usedNames, colorIdentity, bannedCards, maxCardPrice, Infinity, { value: 0 }, maxRarity, maxCmc, budgetTracker, collectionNames, landPenalties.size > 0 ? landPenalties : undefined, currency, new Set(), arenaOnly, collectionStrategy, collectionOwnedPercent, ignoreOwnedBudget);
```

Note: `comboPriorityBoost` is really just a generic priority adjustment map (it adds to the priority score in `calculateCardPriority`). Negative values work as penalties. This reuse is clean because lands don't have combo boosts.

- [ ] **Step 4: Pass pacing to `generateLands()` at the call site**

Find where `generateLands()` is called in `generateDeck()` and add `resolvedPacing` as the last argument. Search for `generateLands(` in the file — it should be a single call site.

- [ ] **Step 5: Build verification**

Run: `npx tsc --noEmit`
Expected: No errors. Taplands in aggressive decks now get deprioritized during land selection.

- [ ] **Step 6: Commit**

```bash
git add src/services/deckBuilder/deckGenerator.ts
git commit -m "feat: tapland penalties in land selection based on pacing"
```

---

## Task 7: Smart Trim Phase

**Files:**
- Modify: `src/services/deckBuilder/deckGenerator.ts:2907-2928` (replace trim loop)

- [ ] **Step 1: Replace the trim loop**

Replace lines 2907-2928 (from `// If we have too many cards, trim` through the closing `}` of the while loop) with:

```typescript
  // ── Smart Trim: priority-aware, role-aware, combo-aware ──
  const MUST_INCLUDE_BOOST = 10000;
  const COMBO_TRIM_BOOST = 200;
  const ROLE_DEFICIT_TRIM_BOOST = 50;
  const ROLE_SURPLUS_TRIM_PENALTY = -30;

  let currentCount = countAllCards();
  if (currentCount > targetDeckSize) {
    // Build a flat list of all non-land cards with their category and trim resistance
    const trimCandidates: { card: ScryfallCard; category: DeckCategory; trimResistance: number }[] = [];

    // Collect must-include names and combo card names for protection checks
    const mustIncludeSet = new Set([
      ...customization.mustIncludeCards.map(n => n.toLowerCase()),
      ...customization.tempMustIncludeCards.map(n => n.toLowerCase()),
    ]);

    for (const cat of Object.keys(categories) as DeckCategory[]) {
      for (const card of categories[cat]) {
        let resistance = card.edhrecPriority ?? card.inclusion ?? 0;

        // Untouchable: must-include cards
        if (mustIncludeSet.has(card.name.toLowerCase())) {
          resistance += MUST_INCLUDE_BOOST;
        }

        // Soft-protected: combo pieces
        if (comboCardNames.has(card.name)) {
          resistance += COMBO_TRIM_BOOST;
        }

        // Role-aware: protect deficit roles, expose surplus roles
        if (roleTargets) {
          const role = getCardRole(card.name);
          if (role) {
            const target = roleTargets[role] ?? 0;
            const current = currentRoleCounts[role] ?? 0;
            if (current <= target) {
              resistance += ROLE_DEFICIT_TRIM_BOOST;
            } else if (current >= target + 3) {
              resistance += ROLE_SURPLUS_TRIM_PENALTY;
            }
          }
        }

        trimCandidates.push({ card, category: cat, trimResistance: resistance });
      }
    }

    // Sort ascending: lowest resistance = first to trim
    trimCandidates.sort((a, b) => a.trimResistance - b.trimResistance);

    // Trim from the bottom
    const excess = currentCount - targetDeckSize;
    const toRemove = trimCandidates.slice(0, excess);

    // Build removal sets per category for efficient filtering
    const removeByCategory = new Map<DeckCategory, Set<ScryfallCard>>();
    for (const { card, category } of toRemove) {
      if (!removeByCategory.has(category)) removeByCategory.set(category, new Set());
      removeByCategory.get(category)!.add(card);
    }

    // Apply removals
    for (const [cat, removeSet] of removeByCategory) {
      categories[cat] = categories[cat].filter(c => !removeSet.has(c));
    }

    // Update role counts for trimmed role cards
    if (roleTargets) {
      for (const { card } of toRemove) {
        const role = getCardRole(card.name);
        if (role && currentRoleCounts[role] > 0) {
          currentRoleCounts[role]--;
        }
      }
    }
  }
```

- [ ] **Step 2: Verify `comboCardNames` is in scope**

Check that `comboCardNames` (the `Set<string>` built at line 1574) is accessible at the trim phase location (line ~2910). It's declared inside `generateDeck()` so it should be in scope. If combos are disabled (`comboCount === 0`), the set is empty, which is fine — the `.has()` check just returns false.

- [ ] **Step 3: Verify `edhrecPriority` or `inclusion` exists on cards**

The trim resistance uses `card.edhrecPriority ?? card.inclusion ?? 0`. Check what property stores the EDHREC priority on `ScryfallCard`. The cards picked by `pickFromPrefetched` are sorted by `calculateCardPriority()` which uses `inclusion` and `synergy` from the `EDHRECCard`, but those values may not be stamped onto the `ScryfallCard` object. If not, we need an alternative.

Look at the `ScryfallCard` type — check for `inclusion`, `synergy`, or similar fields. If the priority isn't stored on the card, we can use the card's position in its category array as a proxy (cards are added in priority order, so index 0 = highest priority). In that case, use:

```typescript
// Cards are in priority order within each category (highest first)
let resistance = categories[cat].length - categories[cat].indexOf(card);
```

Adjust the approach based on what fields are actually available on `ScryfallCard`.

- [ ] **Step 4: Build verification**

Run: `npx tsc --noEmit`
Expected: No errors. The trim is now role-aware, combo-aware, and protects must-includes.

- [ ] **Step 5: Commit**

```bash
git add src/services/deckBuilder/deckGenerator.ts
git commit -m "feat: smart trim phase with role/combo/must-include awareness"
```

---

## Task 8: Post-Generation Fixup Pass

**Files:**
- Modify: `src/services/deckBuilder/deckGenerator.ts` (add `applyFixups()` function, call it before the return)

This is the largest task. The fixup function runs after trimming and before building the deck score.

- [ ] **Step 1: Add the `applyFixups` function**

Add a new function inside `generateDeck()` (as a closure, so it has access to `categories`, `roleTargets`, `currentRoleCounts`, `comboCardNames`, etc.). Place it after the trim phase and fill phase, before the deck score computation (around line 3340).

```typescript
  // ── Post-Generation Fixup Pass (light touch) ──
  function applyFixups(
    allNonLandPool: EDHRECCard[],
    landPool: EDHRECCard[],
    cardMap: Map<string, ScryfallCard>,
    landCardMap: Map<string, ScryfallCard>,
    pacing: Pacing,
  ) {
    const MAX_TOTAL_SWAPS = 5;
    let totalSwaps = 0;

    // Helper: find the lowest-priority non-protected card in the deck
    function findWeakestCard(filter?: (card: ScryfallCard, cat: DeckCategory) => boolean): { card: ScryfallCard; category: DeckCategory } | null {
      let weakest: { card: ScryfallCard; category: DeckCategory; priority: number } | null = null;
      const mustIncludeSet = new Set([
        ...customization.mustIncludeCards.map(n => n.toLowerCase()),
        ...customization.tempMustIncludeCards.map(n => n.toLowerCase()),
      ]);

      for (const cat of Object.keys(categories) as DeckCategory[]) {
        const cards = categories[cat];
        for (let i = cards.length - 1; i >= 0; i--) {
          const card = cards[i];
          // Skip protected cards
          if (mustIncludeSet.has(card.name.toLowerCase())) continue;
          if (comboCardNames.has(card.name)) continue;
          if (filter && !filter(card, cat)) continue;

          const priority = cards.length - i; // Position-based: end of array = lowest priority
          if (!weakest || priority < weakest.priority) {
            weakest = { card, category: cat, priority };
          }
        }
      }
      return weakest ? { card: weakest.card, category: weakest.category } : null;
    }

    // Helper: remove a card from its category
    function removeCard(card: ScryfallCard, category: DeckCategory) {
      categories[category] = categories[category].filter(c => c !== card);
      usedNames.delete(card.name);
      // Update role counts
      const role = getCardRole(card.name);
      if (role && currentRoleCounts[role] > 0) currentRoleCounts[role]--;
    }

    // Helper: add a card to the appropriate category
    function addCard(card: ScryfallCard) {
      stampRoleSubtypes(card);
      const role = getCardRole(card.name);
      const typeLine = (card.type_line || '').toLowerCase();

      if (typeLine.includes('creature')) {
        categories.creatures.push(card);
      } else if (role === 'boardwipe') {
        categories.boardWipes.push(card);
      } else if (role === 'removal') {
        categories.singleRemoval.push(card);
      } else if (role === 'ramp') {
        categories.ramp.push(card);
      } else if (role === 'cardDraw') {
        categories.cardDraw.push(card);
      } else {
        categories.synergy.push(card);
      }
      usedNames.add(card.name);
      if (role) currentRoleCounts[role] = (currentRoleCounts[role] || 0) + 1;
    }

    // Helper: find best candidate from EDHREC pool for a given role
    function findCandidate(role: RoleKey, pool: EDHRECCard[]): ScryfallCard | null {
      const sorted = [...pool]
        .filter(c => !usedNames.has(c.name) && getCardRole(c.name) === role)
        .sort((a, b) => calculateCardPriority(b) - calculateCardPriority(a));

      for (const candidate of sorted) {
        const card = cardMap.get(candidate.name);
        if (card) return card;
      }
      return null;
    }

    // ── 5a: Critical Role Deficits ──
    if (roleTargets) {
      const roleKeys: RoleKey[] = ['ramp', 'removal', 'boardwipe', 'cardDraw'];
      for (const role of roleKeys) {
        if (totalSwaps >= MAX_TOTAL_SWAPS) break;
        const target = roleTargets[role] ?? 0;
        const current = currentRoleCounts[role] ?? 0;
        // Only fix critically short: ≤50% of target
        if (target > 0 && current <= target * 0.5) {
          const deficit = target - current;
          const swapsForRole = Math.min(deficit, 2, MAX_TOTAL_SWAPS - totalSwaps);
          for (let i = 0; i < swapsForRole; i++) {
            // Find weakest non-role card
            const weak = findWeakestCard((card) => getCardRole(card.name) !== role);
            if (!weak) break;
            // Find best replacement with the needed role
            const replacement = findCandidate(role, allNonLandPool);
            if (!replacement) break;

            removeCard(weak.card, weak.category);
            addCard(replacement);
            // Move removed card to swap candidates
            if (swapCandidates) {
              const key = `type:${(weak.card.type_line || 'unknown').split(' ')[0].toLowerCase()}`;
              if (!swapCandidates[key]) swapCandidates[key] = [];
              swapCandidates[key].push(weak.card);
            }
            totalSwaps++;
          }
        }
      }
    }

    // ── 5b: Dead CMC Slots ──
    if (!customization.tinyLeaders && !customization.advancedTargets?.curvePercentages) {
      for (const targetCmc of [1, 2]) {
        if (totalSwaps >= MAX_TOTAL_SWAPS) break;
        // Count non-land cards at this CMC
        const cardsAtCmc = Object.values(categories).flat().filter(c => (c.cmc ?? 0) === targetCmc).length;
        if (cardsAtCmc === 0) {
          // Find most overfull CMC bucket
          const cmcCounts: Record<number, number> = {};
          for (const cards of Object.values(categories)) {
            for (const card of cards) {
              const cmc = card.cmc ?? 0;
              cmcCounts[cmc] = (cmcCounts[cmc] || 0) + 1;
            }
          }
          const overfullCmc = Object.entries(cmcCounts)
            .filter(([cmc]) => Number(cmc) !== targetCmc)
            .sort(([, a], [, b]) => b - a)[0];

          if (overfullCmc) {
            // Find weakest card in overfull bucket (not protected)
            const weak = findWeakestCard((card) => (card.cmc ?? 0) === Number(overfullCmc[0]));
            if (weak) {
              // Find replacement at dead CMC
              const candidates = [...allNonLandPool]
                .filter(c => !usedNames.has(c.name) && cardMap.has(c.name))
                .filter(c => {
                  const card = cardMap.get(c.name)!;
                  return (card.cmc ?? 0) === targetCmc;
                })
                .sort((a, b) => calculateCardPriority(b) - calculateCardPriority(a));

              if (candidates.length > 0) {
                const replacement = cardMap.get(candidates[0].name)!;
                removeCard(weak.card, weak.category);
                addCard(replacement);
                if (swapCandidates) {
                  const key = `type:${(weak.card.type_line || 'unknown').split(' ')[0].toLowerCase()}`;
                  if (!swapCandidates[key]) swapCandidates[key] = [];
                  swapCandidates[key].push(weak.card);
                }
                totalSwaps++;
              }
            }
          }
        }
      }
    }

    // ── 5c: Tapland Ratio Fix (aggressive/fast decks only) ──
    // NOTE: This fixup needs access to the lands array from generateLands().
    // Check whether lands are stored in `categories` (e.g., categories.lands)
    // or as a separate local variable. If the lands array is accessible:
    //   1. Count taplands via isTapland()
    //   2. If tapland ratio > 40%, find the lowest-inclusion taplands
    //   3. Swap up to 3 for untapped alternatives from landPool/landCardMap
    // If lands aren't accessible at this point, SKIP this fixup —
    // the tapland penalty in Task 6 already reduces taplands during selection,
    // and the optimizer catches remaining issues post-generation.
  }
```

**IMPLEMENTATION NOTE for 5c (tapland ratio):** This is the lowest-priority fixup. The tapland penalty in Task 6 already deprioritizes taplands during land selection. If wiring up land access for post-generation swaps proves complex, skip 5c entirely — the optimizer already catches remaining tapland issues.

- [ ] **Step 2: Call `applyFixups()` before deck score computation**

Insert the call around line 3343 (after combo detection, before deck score computation):

```typescript
  // Apply post-generation fixups (light touch)
  if (edhrecData) {
    applyFixups(
      edhrecData.cardlists.allNonLand,
      edhrecData.cardlists.lands,
      cardMap,
      landCardMap,
      resolvedPacing,
    );
  }
```

Note: `cardMap` and `landCardMap` need to be accessible at this point. Check their scope — `cardMap` is the main spell card map from the batch fetch, `landCardMap` is built inside `generateLands()`. If `landCardMap` isn't in scope at the fixup call site, the tapland ratio fix (5c) will need a different approach, or `landCardMap` needs to be returned/captured.

- [ ] **Step 3: Build verification**

Run: `npx tsc --noEmit`
Expected: No errors. The fixup pass silently improves decks with critical gaps.

- [ ] **Step 4: Manual testing**

1. Generate a deck with a commander known to have weak removal (e.g., a mono-green commander). Check that the fixup adds removal if critically short.
2. Generate an aggressive deck and verify the curve shifts toward cheaper cards.
3. Generate any deck and verify taplands are deprioritized in fast decks.
4. Verify must-include cards and combo pieces are never trimmed.

- [ ] **Step 5: Commit**

```bash
git add src/services/deckBuilder/deckGenerator.ts
git commit -m "feat: post-generation fixup pass for critical role deficits and dead CMC slots"
```

---

## Task 9: Final Build & Integration Verification

- [ ] **Step 1: Full build**

Run: `npx vite build`
Expected: Clean build with no errors.

- [ ] **Step 2: Dev server smoke test**

Run: `npx vite dev`

Test the following flow:
1. Search for a commander
2. Verify the Tempo section appears in the customizer with "Auto-detect" toggled on
3. Toggle auto-detect off — verify the 5-stop slider appears
4. Set pacing to "Aggressive"
5. Generate a deck
6. Verify the mana curve in the deck view skews toward cheaper cards
7. Open the optimizer — verify it reads the deck's pacing correctly

- [ ] **Step 3: Edge case testing**

1. Generate with Tiny Leaders enabled — verify pacing multipliers don't break the CMC-capped curve
2. Generate with custom curve percentages in Advanced — verify pacing multipliers are skipped
3. Generate with balanced roles OFF — verify pacing still resolves and affects curve/lands
4. Generate with combos = 3 — verify combo pieces survive the smart trim

- [ ] **Step 4: Final commit (if any fixes needed)**

```bash
git add -A
git commit -m "fix: address integration issues from deck generator improvements"
```
