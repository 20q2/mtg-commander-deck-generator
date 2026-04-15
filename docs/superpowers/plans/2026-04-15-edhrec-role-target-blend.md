# EDHREC-Informed Role Targets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make per-role target counts (ramp / removal / boardwipe / cardDraw) reflect the current commander's typical EDHREC build by blending EDHREC-derived counts 60/40 with the existing archetype-derived targets.

**Architecture:** Add a pure function `computeEdhrecRoleTargets(edhrecData)` that counts cards above a 25% inclusion threshold per role. Blend those counts with the archetype-derived targets inside `getDynamicRoleTargets()`. Persist a per-role breakdown on the generated deck. Expose a user-facing "EDHREC Match Strength" slider in Advanced Customization and a per-role tooltip in the deck stats sidebar that shows the math.

**Tech Stack:** TypeScript, React 18, Zustand, Tailwind + shadcn/ui (`<Tooltip>`). No new dependencies.

**Manual validation only.** Per user decision: automated tests with synthetic EDHREC fixtures would go stale and mostly test our math against itself. Each task still commits independently to enable clean bisect.

---

## File Structure

**Modified files:**
- `src/types/index.ts` — Add `RoleTargetBreakdown` interface, extend `AdvancedTargets` with two optional fields, add `roleTargetBreakdown` to `GeneratedDeck`.
- `src/services/deckBuilder/roleTargets.ts` — Add two named constants (`EDHREC_INCLUSION_THRESHOLD`, `EDHREC_BLEND_WEIGHT`), add `computeEdhrecRoleTargets()`, extend `getDynamicRoleTargets()` signature and return shape, blend the two signals.
- `src/services/deckBuilder/deckGenerator.ts` — Pass `edhrecData` and the two override fields into `getDynamicRoleTargets()`, persist the returned `breakdown` on the generated deck.
- `src/components/customization/AdvancedCustomization.tsx` — Add an "EDHREC Match Strength" slider inside the existing Role Targets section.
- `src/components/deck/DeckDisplay.tsx` — Wrap each per-role count/target display with a `<Tooltip>` that reads `generatedDeck.roleTargetBreakdown` and shows the EDHREC-typical / archetype / pacing breakdown.

No new files are created. All changes respect existing patterns and the constraints in `CLAUDE.md` (shadcn components for UI, never raw `<button>` / `<input>`, etc.).

---

## Task 1: Add types — `RoleTargetBreakdown`, `AdvancedTargets` extensions, `GeneratedDeck` field

**Files:**
- Modify: `src/types/index.ts`

- [ ] **Step 1: Add `RoleTargetBreakdown` interface**

Open `src/types/index.ts`. Find `export type Pacing = ...` at line 384. Immediately below it (before `export interface AdvancedTargets`), add:

```ts
// Per-role breakdown of how the final target count was derived.
// Used by the optimizer UI to show an "EDHREC-typical + archetype + pacing" tooltip.
export interface RoleTargetBreakdown {
  edhrecCount: number | null;   // null when no EDHREC data was passed in
  archetypeTarget: number;      // base × archetype multiplier (before blend, before pacing)
  pacingMultiplier: number;     // pacing multiplier applied after the blend
  blended: number;              // final target after blend + pacing + clamp
}
```

- [ ] **Step 2: Extend `AdvancedTargets`**

In the same file, find `export interface AdvancedTargets` (line 387). Change its body to:

```ts
export interface AdvancedTargets {
  curvePercentages: Record<number, number> | null;   // CMC bucket → percentage of non-land cards
  typePercentages: Record<string, number> | null;    // card type → percentage of non-land cards
  roleTargets: Record<string, number> | null;        // role → absolute count target (still wins outright when set)
  edhrecBlendWeight: number | null;                  // 0..1, null = default (0.6). 0 = archetype only, 1 = EDHREC only.
  edhrecInclusionThreshold: number | null;           // percent, null = default (25). Dev-only tuning knob.
}
```

- [ ] **Step 3: Extend `GeneratedDeck`**

Still in the same file, find `export interface GeneratedDeck` (line 271). Right after the `roleTargets?: Record<string, number>` line (line 285), add:

```ts
  roleTargetBreakdown?: Record<string, RoleTargetBreakdown>; // Per-role derivation when balanced roles mode was active
```

- [ ] **Step 4: Update any existing `AdvancedTargets` initializer**

Search the repo for places that construct `AdvancedTargets` or reset it to nulls. Starting points:

Run: `grep -rn "curvePercentages: null" src/` and `grep -rn "roleTargets: null" src/`.

Expected matches include `AdvancedCustomization.tsx:310` (`{ curvePercentages: null, typePercentages: null, roleTargets: null }`) and the Zustand store's default customization. Every such literal must add the two new fields:

```ts
advancedTargets: {
  curvePercentages: null,
  typePercentages: null,
  roleTargets: null,
  edhrecBlendWeight: null,
  edhrecInclusionThreshold: null,
}
```

Update each site to include the two new `null` fields. TypeScript will flag any missed ones when the project compiles.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: No errors. If any `AdvancedTargets` literal is missing the new fields, TypeScript will point it out — add the missing fields and re-run.

- [ ] **Step 6: Commit**

```bash
git add src/types/index.ts src/components/customization/AdvancedCustomization.tsx src/store/index.ts
git commit -m "types: RoleTargetBreakdown + EDHREC blend override fields"
```

(Only add files you actually changed — the `git add` line above covers the likely set. If other sites were updated, include them too.)

---

## Task 2: Add named constants to `roleTargets.ts`

**Files:**
- Modify: `src/services/deckBuilder/roleTargets.ts`

- [ ] **Step 1: Add the constants**

Open `src/services/deckBuilder/roleTargets.ts`. After the imports (after line 3 `import type { RoleKey } from '@/services/tagger/client';`), add:

```ts
// ─── EDHREC Blend Tuning ────────────────────────────────────────────
// Threshold for "cards in the typical deck for this commander" — a card above
// this inclusion % is played in roughly 1 of every 4 tracked decks.
export const EDHREC_INCLUSION_THRESHOLD = 25; // percent

// Weight for the EDHREC-derived role counts in the final blended target.
// Default 0.6 means 60% EDHREC / 40% archetype model. Overridable per-deck
// via customization.advancedTargets.edhrecBlendWeight.
export const EDHREC_BLEND_WEIGHT = 0.6;
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/services/deckBuilder/roleTargets.ts
git commit -m "roleTargets: add EDHREC blend tuning constants"
```

---

## Task 3: Implement `computeEdhrecRoleTargets()`

**Files:**
- Modify: `src/services/deckBuilder/roleTargets.ts`

- [ ] **Step 1: Update imports**

At the top of `src/services/deckBuilder/roleTargets.ts`, the existing type import is:

```ts
import { Archetype, type DeckFormat, type ThemeResult, type EDHRECCommanderStats } from '@/types';
```

Extend it to also import `EDHRECCommanderData` and add an import for `getCardRole`:

```ts
import { Archetype, type DeckFormat, type ThemeResult, type EDHRECCommanderStats, type EDHRECCommanderData } from '@/types';
import type { Pacing } from './themeDetector';
import { getCardRole, type RoleKey } from '@/services/tagger/client';
```

(Remove the old standalone `import type { RoleKey }` line since the combined import now covers it.)

- [ ] **Step 2: Add the function**

In the same file, directly below the constants added in Task 2 (and above `// ─── Theme → Archetype Mapping ──────────────────────────────────────`), add:

```ts
// ─── EDHREC-Derived Role Counts ─────────────────────────────────────
// For the current commander, count cards per role whose EDHREC inclusion
// meets the threshold. Lands are skipped (basics dominate the distribution
// and role classification doesn't apply). Cards whose role is undefined
// are assumed to be synergy/payoff pieces and correctly contribute nothing.
export function computeEdhrecRoleTargets(
  edhrecData: EDHRECCommanderData | null | undefined,
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
    if (!pool) continue;
    for (const card of pool) {
      if (card.inclusion < threshold) continue;
      const role = getCardRole(card.name);
      if (role) counts[role]++;
    }
  }

  return counts;
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/services/deckBuilder/roleTargets.ts
git commit -m "roleTargets: computeEdhrecRoleTargets"
```

---

## Task 4: Blend EDHREC counts into `getDynamicRoleTargets()`

**Files:**
- Modify: `src/services/deckBuilder/roleTargets.ts`

- [ ] **Step 1: Extend the function signature and return shape**

Find the current `getDynamicRoleTargets` (line 233). Replace its full definition with:

```ts
export function getDynamicRoleTargets(
  format: DeckFormat,
  selectedThemes?: ThemeResult[],
  edhrecStats?: EDHRECCommanderStats,
  edhrecData?: EDHRECCommanderData | null,
  overrideBlendWeight?: number | null,
  overrideThreshold?: number | null,
): {
  targets: Record<RoleKey, number>;
  archetype: Archetype;
  pacing: Pacing;
  breakdown: Record<RoleKey, RoleTargetBreakdown>;
} {
  const base = getBaseRoleTargets(format);

  const archetype = inferArchetype(selectedThemes);
  const archetypeMults = ARCHETYPE_ROLE_MULTIPLIERS[archetype];

  const pacing: Pacing = edhrecStats?.manaCurve
    ? estimatePacingFromStats(edhrecStats.manaCurve)
    : 'balanced';
  const pacingMults = PACING_ROLE_ADJUSTMENTS[pacing];

  // EDHREC-derived counts (zero-filled when edhrecData is missing)
  const edhrecCounts = edhrecData
    ? computeEdhrecRoleTargets(edhrecData, overrideThreshold ?? EDHREC_INCLUSION_THRESHOLD)
    : null;

  const blendWeight = overrideBlendWeight ?? EDHREC_BLEND_WEIGHT;

  const result = {} as Record<RoleKey, number>;
  const breakdown = {} as Record<RoleKey, RoleTargetBreakdown>;
  let total = 0;

  for (const role of ROLE_KEYS) {
    const archetypeTarget = base[role] * archetypeMults[role];
    const blendedPrePacing = edhrecCounts
      ? blendWeight * edhrecCounts[role] + (1 - blendWeight) * archetypeTarget
      : archetypeTarget;
    const afterPacing = blendedPrePacing * pacingMults[role];

    const floor = role === 'boardwipe' ? 0 : 1;
    const finalCount = Math.max(floor, Math.round(afterPacing));
    result[role] = finalCount;
    total += finalCount;

    breakdown[role] = {
      edhrecCount: edhrecCounts ? edhrecCounts[role] : null,
      archetypeTarget: Math.round(archetypeTarget),
      pacingMultiplier: pacingMults[role],
      blended: finalCount,
    };
  }

  // Cap total to reasonable range (scaled by format)
  const maxTotal = Math.round(format * 0.35); // ~34 for 99
  const minTotal = Math.round(format * 0.28); // ~28 for 99

  if (total > maxTotal) {
    const scale = maxTotal / total;
    for (const role of ROLE_KEYS) {
      const floor = role === 'boardwipe' ? 0 : 1;
      result[role] = Math.max(floor, Math.round(result[role] * scale));
      breakdown[role].blended = result[role];
    }
  } else if (total < minTotal) {
    const scale = minTotal / total;
    for (const role of ROLE_KEYS) {
      result[role] = Math.round(result[role] * scale);
      breakdown[role].blended = result[role];
    }
  }

  console.log(
    `[DeckGen] Dynamic role targets: archetype=${archetype}, pacing=${pacing}, blend=${blendWeight}`,
    result,
    `(total=${Object.values(result).reduce((s, v) => s + v, 0)}, edhrecCounts=${edhrecCounts ? JSON.stringify(edhrecCounts) : 'null'})`,
  );

  return { targets: result, archetype, pacing, breakdown };
}
```

Key differences from the old implementation:
- Two new parameters: `edhrecData` and two overrides.
- When `edhrecData` is present, `blendedPrePacing = w × edhrec + (1 - w) × archetypeTarget`; when absent, `blendedPrePacing = archetypeTarget` (regression-safe).
- Per-role `breakdown` is built alongside `result`.
- When the total is clamped, `breakdown[role].blended` is updated to the final clamped value so tooltips stay honest.
- Log line adds `blend` weight and `edhrecCounts` for debugging.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: No errors in this file. Expect one error in `src/services/deckBuilder/deckGenerator.ts` because it destructures `{ targets, archetype, pacing }` without `breakdown` — that's fixed in Task 5.

- [ ] **Step 3: Commit**

```bash
git add src/services/deckBuilder/roleTargets.ts
git commit -m "roleTargets: blend EDHREC counts with archetype targets"
```

---

## Task 5: Update deckGenerator call site + persist breakdown

**Files:**
- Modify: `src/services/deckBuilder/deckGenerator.ts`

- [ ] **Step 1: Pass `edhrecData` and overrides; capture the breakdown**

Find the existing call at line 2326:

```ts
} else if (customization.balancedRoles) {
  const dynamic = getDynamicRoleTargets(format, context.selectedThemes, edhrecData?.stats);
  roleTargets = dynamic.targets;
  detectedArchetype = dynamic.archetype;
  // When auto-detect is on, prefer the richer archetype-aware pacing from getDynamicRoleTargets
  if (customization.tempoAutoDetect) {
    resolvedPacing = dynamic.pacing;
    detectedPacing = dynamic.pacing;
  }
}
```

Replace with:

```ts
} else if (customization.balancedRoles) {
  const dynamic = getDynamicRoleTargets(
    format,
    context.selectedThemes,
    edhrecData?.stats,
    edhrecData,
    customization.advancedTargets?.edhrecBlendWeight ?? null,
    customization.advancedTargets?.edhrecInclusionThreshold ?? null,
  );
  roleTargets = dynamic.targets;
  detectedArchetype = dynamic.archetype;
  roleTargetBreakdown = dynamic.breakdown;
  // When auto-detect is on, prefer the richer archetype-aware pacing from getDynamicRoleTargets
  if (customization.tempoAutoDetect) {
    resolvedPacing = dynamic.pacing;
    detectedPacing = dynamic.pacing;
  }
}
```

- [ ] **Step 2: Declare and persist `roleTargetBreakdown`**

At the top of `deckGenerator.ts`, find the existing import from `@/types` and add `RoleTargetBreakdown` to the imported names. For example, if the file has `import type { ... } from '@/types';`, add `RoleTargetBreakdown` to that list.

Near the top of the function (where `roleTargets`, `currentRoleCounts`, etc. are declared — search for `let roleTargets` to find the spot), add the declaration alongside `roleTargets`:

```ts
let roleTargetBreakdown: Record<RoleKey, RoleTargetBreakdown> | undefined;
```

- [ ] **Step 3: Attach the breakdown to the returned deck**

Scroll to the bottom of the function where the `GeneratedDeck` object is assembled (search for `roleTargets,` inside the returned object literal — there should only be one such assembly near the end of `generateDeck`). Add:

```ts
roleTargetBreakdown,
```

Immediately below the existing `roleTargets,` line.

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 5: Build**

Run: `npm run build`
Expected: Build succeeds.

- [ ] **Step 6: Commit**

```bash
git add src/services/deckBuilder/deckGenerator.ts
git commit -m "deckGenerator: wire EDHREC data + persist role breakdown"
```

---

## Task 6: Add "EDHREC Match Strength" slider in Advanced Customization

**Files:**
- Modify: `src/components/customization/AdvancedCustomization.tsx`

- [ ] **Step 1: Read the Role Targets section**

Read `src/components/customization/AdvancedCustomization.tsx` lines 585–645 to see the existing Role Targets `<section>` and the `SliderRow` component it uses.

Before editing, confirm these imports are already present at the top of the file: `Slider` or `SliderRow` component (in-file), and the `useStore` / `updateCustomization` hooks. If `SliderRow` is already used in this file (it is — see lines 522, 540, 572, 611), reuse it.

- [ ] **Step 2: Add a blend weight slider below the role sliders**

Inside the Role Targets `<section>` (line 591), directly below the closing `</div>` of the `<div className="space-y-0.5">` block that contains the role `SliderRow`s (just before the section's closing `</section>` at line 640), add:

```tsx
<div className="border-t border-border/30 mt-3 pt-3">
  <div className="flex items-center gap-2 mb-1">
    <span className="text-xs text-foreground/80">EDHREC Match Strength</span>
    <span className="relative group">
      <Info className="w-3 h-3 text-muted-foreground/40 cursor-help" />
      <span className="absolute left-full top-1/2 -translate-y-1/2 ml-1.5 w-56 px-2.5 py-1.5 rounded bg-popover border border-border text-[10px] text-popover-foreground leading-tight opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50 shadow-lg">
        How closely role targets follow this commander's typical EDHREC build vs the generic archetype model. 0% = archetype only, 100% = EDHREC only. Default 60%.
      </span>
    </span>
  </div>
  <SliderRow
    label="Weight"
    value={Math.round(((advancedTargets.edhrecBlendWeight ?? EDHREC_BLEND_WEIGHT)) * 100)}
    min={0}
    max={100}
    color={ROLE_COLORS.other}
    unit="%"
    onChange={(v) => commitToStore({ edhrecBlendWeight: v / 100 })}
  />
</div>
```

- [ ] **Step 3: Import the constant**

At the top of the file, add the following to the existing import from `@/services/deckBuilder/roleTargets` (or create the import if none exists):

```ts
import { EDHREC_BLEND_WEIGHT } from '@/services/deckBuilder/roleTargets';
```

Also ensure `Info` is imported from `lucide-react` (it already is — see line 628's usage).

- [ ] **Step 4: Update `commitToStore` to accept the new field**

Find `commitToStore` in the same file (near line 293). It currently passes a partial `AdvancedTargets` patch. Ensure its type accepts the new `edhrecBlendWeight` field. If its type is `Partial<AdvancedTargets>`, no change is needed — the new field is automatically allowed.

- [ ] **Step 5: Include the new field in `resetRoles`**

Find `resetRoles` (near line 306). It currently calls `commitToStore({ roleTargets: null })`. Extend to also reset the blend weight:

```ts
const resetRoles = useCallback(() => {
  commitToStore({ roleTargets: null, edhrecBlendWeight: null });
}, [commitToStore]);
```

(Match the existing signature/naming style — this step describes the intent.)

- [ ] **Step 6: Typecheck + build**

Run: `npx tsc --noEmit && npm run build`
Expected: Both succeed.

- [ ] **Step 7: Commit**

```bash
git add src/components/customization/AdvancedCustomization.tsx
git commit -m "customization: EDHREC Match Strength slider"
```

---

## Task 7: Add per-role tooltip in DeckDisplay

**Files:**
- Modify: `src/components/deck/DeckDisplay.tsx`

- [ ] **Step 1: Confirm Tooltip imports**

Open `src/components/deck/DeckDisplay.tsx`. Search for existing `import { Tooltip` or `from '@/components/ui/tooltip'`. If not already imported, add:

```ts
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
```

- [ ] **Step 2: Wrap the count/target `<span>` with a Tooltip**

Find the role button block at lines 1872–1924. The count/target span is at line 1883:

```tsx
<span className={met ? 'text-emerald-500' : 'text-amber-500'}>
  {count}{import.meta.env.DEV && <> / {target}</>}
</span>
```

Replace that span with:

```tsx
<TooltipProvider delayDuration={200}>
  <Tooltip>
    <TooltipTrigger asChild>
      <span className={met ? 'text-emerald-500 cursor-help' : 'text-amber-500 cursor-help'}>
        {count}{import.meta.env.DEV && <> / {target}</>}
      </span>
    </TooltipTrigger>
    <TooltipContent side="left" className="max-w-[260px] text-[11px] leading-snug">
      {(() => {
        const bd = generatedDeck.roleTargetBreakdown?.[key];
        if (!bd) {
          return <span>Target: {target}</span>;
        }
        return (
          <div className="space-y-0.5">
            <div className="font-semibold">Target: {bd.blended}</div>
            {bd.edhrecCount !== null && (
              <div>EDHREC-typical: <span className="tabular-nums">{bd.edhrecCount}</span> cards tagged {label.toLowerCase()} above threshold</div>
            )}
            <div>Archetype baseline: <span className="tabular-nums">{bd.archetypeTarget}</span>{generatedDeck.detectedArchetype ? ` (${generatedDeck.detectedArchetype})` : ''}</div>
            <div>Pacing: <span className="tabular-nums">×{bd.pacingMultiplier.toFixed(2)}</span>{generatedDeck.detectedPacing ? ` (${generatedDeck.detectedPacing})` : ''}</div>
          </div>
        );
      })()}
    </TooltipContent>
  </Tooltip>
</TooltipProvider>
```

- [ ] **Step 3: Typecheck + build**

Run: `npx tsc --noEmit && npm run build`
Expected: Both succeed.

- [ ] **Step 4: Commit**

```bash
git add src/components/deck/DeckDisplay.tsx
git commit -m "deckDisplay: per-role breakdown tooltip"
```

---

## Task 8: Manual validation

No automated tests. Walk through each check and confirm expected behavior before declaring done.

- [ ] **Step 1: Start the dev server**

Run: `npm run dev`
Open the local URL.

- [ ] **Step 2: Elf commander — ramp target should be noticeably elevated**

1. On the home page, search for an elf tribal commander. Good options: `Ezuri, Renegade Leader` or `Marwyn, the Nurturer`.
2. Generate a deck.
3. In the right-side Deck Roles panel, hover the ramp count.
4. **Expected:** Tooltip shows an "EDHREC-typical: N cards tagged ramp above threshold" line with N in the range of roughly 12–20.
5. **Expected:** Final target is visibly higher than 10 (the old archetype-only baseline).

- [ ] **Step 3: Non-ramp-heavy commander — ramp target stays reasonable**

1. Generate a deck for a commander whose typical build is not ramp-saturated — e.g., `Atraxa, Grand Unifier` or `Edgar Markov`.
2. Hover the ramp count.
3. **Expected:** EDHREC-typical count is lower (roughly 6–12). Final target is within a couple of cards of 10.

- [ ] **Step 4: Blend weight = 0 regression check**

1. Open Advanced Customization.
2. Scroll to Role Targets section → EDHREC Match Strength slider.
3. Drag to 0%.
4. Regenerate the deck.
5. Hover the ramp count.
6. **Expected:** The "EDHREC-typical" line still shows (informational), but the Target matches the Archetype baseline × pacing exactly. This confirms the override path works and disabling the blend reproduces pre-change behavior.

- [ ] **Step 5: Blend weight = 100 sanity check**

1. With the same deck, drag EDHREC Match Strength to 100%.
2. Regenerate.
3. Hover any role count.
4. **Expected:** Target approximately equals `round(EDHREC-typical × pacingMultiplier)`, clamped within the `maxTotal`/`minTotal` envelope.

- [ ] **Step 6: No EDHREC data fallback**

1. Find a commander that hits the "no EDHREC data" path. If one isn't easily reproducible, disable network in DevTools and hit a cached-miss commander.
2. Generate.
3. Hover any role count.
4. **Expected:** Tooltip omits the "EDHREC-typical" line entirely, showing only Archetype + Pacing (target equals the pre-change value).

- [ ] **Step 7: Console sanity log**

Open the browser console during generation. **Expected:** A line like `[DeckGen] Dynamic role targets: archetype=TRIBAL, pacing=fast-tempo, blend=0.6 { ... } (total=32, edhrecCounts={...})`.

- [ ] **Step 8: Declare complete**

If all checks pass, mark the feature complete. If any check fails, file the failure with specifics and return to the relevant earlier task.

---

## Rollback plan

Each task is its own commit. If a specific behavior regresses, `git revert <commit-hash>` the relevant task commit. Tasks 1–5 are the mechanical path (data wiring + math); Tasks 6–7 are UI surfaces. Reverting only Task 4 (`blend EDHREC counts`) disables the blend while keeping the plumbing in place for later re-enable.
