# Theme chips on visual stacks — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show per-theme chips on each card in the analyze-page visual stacks and add a "Theme" sort option, so the user can see at a glance which deck cards earn the membership counts in the THEMES popover.

**Architecture:** Compute a `themeMembership` map in `DeckOptimizer` from data already in `themeDataCacheRef`, scoped to the currently selected themes (`primaryThemeSlug` / `secondaryThemeSlug`). Lift that map up to `AnalyzePage` via a new callback, then pass it into `DeckBuildingArea`, which renders a small numbered chip per matching theme on each card and exposes a new `Theme` sort key.

**Tech Stack:** React 18 + TypeScript + Tailwind. No new libraries.

**Spec:** `docs/superpowers/specs/2026-05-22-theme-chips-on-stacks-design.md`

**Note:** This codebase has no automated test suite. Each task ends with manual verification in the dev server (`npm run dev`) plus type-check (`npx tsc --noEmit`). When a task makes no UI change on its own (data plumbing), verification is the type-check + a `console.log` sanity probe that gets removed before commit.

---

## File map

| Path | Action |
|---|---|
| `src/components/analyze/themeMembership.ts` | Create — types + `buildThemeMembership` helper |
| `src/components/deck/optimizer/DeckOptimizer.tsx` | Modify — compute membership, fire `onThemeMembershipChange` callback |
| `src/pages/AnalyzePage.tsx` | Modify — hold `themeMembership` state, wire callback, pass to `DeckBuildingArea` |
| `src/components/analyze/DeckBuildingArea.tsx` | Modify — accept prop, render chips, add `theme` sort key, conditionally show option |

---

## Task 1: Theme membership types and helper

**Files:**
- Create: `src/components/analyze/themeMembership.ts`

- [ ] **Step 1: Create the helper module**

Create `src/components/analyze/themeMembership.ts`:

```ts
import type { EDHRECCommanderData } from '@/types';

/**
 * Theme membership for cards in the current deck, scoped to the user's
 * currently selected themes (primary + optional secondary). Theme indices
 * match the order chips appear in the THEMES popover:
 *   0 = primary (violet chip "1")
 *   1 = secondary (amber chip "2")
 */
export interface ThemeMembership {
  themes: { slug: string; name: string }[];
  /** lowercased card name → indices into `themes` */
  byCard: Map<string, number[]>;
}

/** Normalize a card name for case-insensitive lookup. */
export function themeKey(name: string): string {
  return name.toLowerCase();
}

/**
 * Build a membership map from selected-theme data. Pass `null` for slugs
 * that aren't selected; the corresponding theme slot is omitted.
 *
 * `themeData` is the same map cached in `DeckOptimizer.themeDataCacheRef`.
 * Theme names come from each EDHRECCommanderData's matching `themes` entry
 * (each fetched theme dataset has its own commander/theme metadata).
 */
export function buildThemeMembership(
  primary: { slug: string; name: string } | null,
  secondary: { slug: string; name: string } | null,
  themeData: Map<string, EDHRECCommanderData>,
): ThemeMembership {
  const selected: { slug: string; name: string }[] = [];
  if (primary) selected.push(primary);
  if (secondary) selected.push(secondary);

  const byCard = new Map<string, number[]>();
  selected.forEach((theme, idx) => {
    const data = themeData.get(theme.slug);
    if (!data) return;
    const stamp = (cardName: string) => {
      const key = themeKey(cardName);
      const existing = byCard.get(key);
      if (existing) existing.push(idx);
      else byCard.set(key, [idx]);
    };
    for (const c of data.allNonLand ?? []) stamp(c.name);
    for (const c of data.lands ?? []) stamp(c.name);
  });

  return { themes: selected, byCard };
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS (no errors).

If errors reference `EDHRECCommanderData.allNonLand` / `lands`, open `src/types/index.ts`, find the `EDHRECCommanderData` interface, and confirm the field names. Adjust accordingly (they may be `cards`/`landCards` or similar). The spec assumes the same shape the optimizer reads in `buildInclusionMap`.

- [ ] **Step 3: Commit**

```bash
git add src/components/analyze/themeMembership.ts
git commit -m "feat(analyze): themeMembership helper for per-theme card tagging"
```

---

## Task 2: Compute membership in DeckOptimizer and expose via callback

**Files:**
- Modify: `src/components/deck/optimizer/DeckOptimizer.tsx`

- [ ] **Step 1: Add the import**

Near the existing imports at the top of `DeckOptimizer.tsx`, add:

```ts
import { buildThemeMembership, type ThemeMembership } from '@/components/analyze/themeMembership';
```

- [ ] **Step 2: Add the callback prop**

The component's props are declared via `DeckOptimizerProps` in `./constants`. Open `src/components/deck/optimizer/constants.ts` and add to the interface (alongside the other optional callbacks like `onAddCards`, `onTabChange`):

```ts
onThemeMembershipChange?: (membership: ThemeMembership | null) => void;
```

Add the import at the top of `constants.ts`:

```ts
import type { ThemeMembership } from '@/components/analyze/themeMembership';
```

Then in `DeckOptimizer.tsx`, destructure the new prop in the function signature (it lives in the existing destructuring block at the top of the component):

```ts
onThemeMembershipChange,
```

- [ ] **Step 3: Compute membership and notify when selected themes change**

Find where `primaryThemeSlug` and `secondaryThemeSlug` are declared (around line 109-110). Below the existing analyzeDeck `useMemo` chain — anywhere after `themeDetection` state is declared but before the JSX returns — add this effect:

```ts
useEffect(() => {
  if (!onThemeMembershipChange) return;
  // Find display names from themeDetection (which holds the matched ThemeMatchResult objects).
  const findTheme = (slug: string | null) => {
    if (!slug) return null;
    const match = themeDetection?.evaluatedThemes.find(t => t.theme.slug === slug);
    return match ? { slug, name: match.theme.name } : null;
  };
  const primary = findTheme(primaryThemeSlug);
  const secondary = findTheme(secondaryThemeSlug);
  if (!primary && !secondary) {
    onThemeMembershipChange(null);
    return;
  }
  const membership = buildThemeMembership(primary, secondary, themeDataCacheRef.current);
  onThemeMembershipChange(membership);
}, [primaryThemeSlug, secondaryThemeSlug, themeDetection, onThemeMembershipChange]);
```

Notes:
- `themeDataCacheRef.current` is read directly because the cache is populated synchronously inside the same render path that sets `themeDetection`; by the time `themeDetection` is non-null, the cache has data for at least the matched themes.
- We pass `null` when no themes are selected so the consumer can clear chips/sort.

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Sanity probe in dev server**

Temporarily add at the bottom of the effect (before the closing brace):

```ts
console.log('[theme-membership] primary=', primary?.name, 'secondary=', secondary?.name,
            'cards=', membership ? membership.byCard.size : 0);
```

Run: `npm run dev` (if not already running).
Load a deck on the analyze page, wait for theme detection to complete, and confirm the console logs something like:

```
[theme-membership] primary= Lifegain secondary= Lifedrain cards= 50
```

Then remove the `console.log`.

- [ ] **Step 6: Commit**

```bash
git add src/components/deck/optimizer/constants.ts src/components/deck/optimizer/DeckOptimizer.tsx
git commit -m "feat(optimizer): expose theme membership via onThemeMembershipChange"
```

---

## Task 3: Wire membership through AnalyzePage to DeckBuildingArea

**Files:**
- Modify: `src/pages/AnalyzePage.tsx`
- Modify: `src/components/analyze/DeckBuildingArea.tsx` (props only)

- [ ] **Step 1: Add membership state in AnalyzePage**

In `src/pages/AnalyzePage.tsx`, add the import alongside the others:

```ts
import type { ThemeMembership } from '@/components/analyze/themeMembership';
```

In the component body, near the other `useState` calls (e.g. `activeAnalyzerTab`), add:

```ts
const [themeMembership, setThemeMembership] = useState<ThemeMembership | null>(null);
```

- [ ] **Step 2: Wire callback into DeckOptimizer**

In the `<DeckOptimizer ... />` JSX (around line 532), add the new prop after the existing callbacks:

```tsx
onThemeMembershipChange={setThemeMembership}
```

- [ ] **Step 3: Pass membership into DeckBuildingArea**

In the `<DeckBuildingArea ... />` JSX (around line 548), add the prop after `menuProps`:

```tsx
themeMembership={themeMembership}
```

- [ ] **Step 4: Declare the prop on DeckBuildingArea**

In `src/components/analyze/DeckBuildingArea.tsx`, add to the imports:

```ts
import type { ThemeMembership } from './themeMembership';
```

Add to the `DeckBuildingAreaProps` interface (near `menuProps`):

```ts
themeMembership?: ThemeMembership | null;
```

Destructure it in the function signature, defaulting to `null`:

```ts
export function DeckBuildingArea({ ..., menuProps, themeMembership = null }: DeckBuildingAreaProps) {
```

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/pages/AnalyzePage.tsx src/components/analyze/DeckBuildingArea.tsx
git commit -m "feat(analyze): thread theme membership from optimizer to deck area"
```

---

## Task 4: Render theme chips on card tiles

**Files:**
- Modify: `src/components/analyze/DeckBuildingArea.tsx`

- [ ] **Step 1: Define chip styling constants**

Near the existing `ROLE_BADGE` / `ROLE_LABEL` constants in `DeckBuildingArea.tsx`, add:

```ts
// Per-theme chip color, matching the THEMES popover (violet = #1, amber = #2).
const THEME_CHIP_CLASS: string[] = [
  'bg-violet-500/90 text-violet-50 border border-violet-300/70',
  'bg-amber-500/90 text-amber-50 border border-amber-300/70',
];
```

- [ ] **Step 2: Compute theme indices for each card and pass them down**

Find the card-tile loop (around line 646 — `cards.map((card, idx) => { ... return <CurveCard ... />; })`). Just above the existing `role`/`badgeClass` lines, add:

```ts
const themeIndices = themeMembership?.byCard.get(card.name.toLowerCase()) ?? [];
```

Then pass to `<CurveCard ... />`:

```tsx
themeIndices={themeIndices}
themeNames={themeMembership?.themes.map(t => t.name) ?? []}
```

- [ ] **Step 3: Extend CurveCardProps and signature**

In the `CurveCardProps` interface (around line 701), add:

```ts
themeIndices: number[];
themeNames: string[];
```

In the `CurveCard` function destructure, add `themeIndices, themeNames`:

```ts
function CurveCard({
  card, idx, cascadeIndex, imgUrl, badgeClass, badgeLabel, BadgeIcon,
  flaggedForRemoval, dimForRemoval, dimForRole, dimForCurve, dimNonRoles,
  hasRemovals, showPrice, onSelect, onHover, onCardAction, menuProps,
  marginTopPercent, themeIndices, themeNames,
}: CurveCardProps) {
```

- [ ] **Step 4: Render the chips**

Inside the `<button>` element in `CurveCard`, after the closing of the `badgeLabel` block (after the `: null}` for the `Other` placeholder, around line 780), add the theme-chip strip in the **top-left** corner. (The role badge sits top-right; price sits top-left when showPrice is on. Stack the theme chips just below the price slot so they don't collide.)

```tsx
{themeIndices.length > 0 && (
  <span
    className="absolute left-1 z-10 flex items-center gap-0.5"
    style={{ top: showPrice ? '1.25rem' : '0.25rem' }}
  >
    {themeIndices.map(i => (
      <span
        key={i}
        title={themeNames[i] ?? ''}
        className={`inline-flex items-center justify-center w-3.5 h-3.5 text-[8px] font-bold rounded-full shadow-sm tabular-nums ${THEME_CHIP_CLASS[i] ?? THEME_CHIP_CLASS[0]}`}
      >
        {i + 1}
      </span>
    ))}
  </span>
)}
```

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Visual verification**

With `npm run dev` running:
1. Load a deck on the analyze page (e.g. the one in the screenshot: Sapling of Colfenor, themes Lifegain + Lifedrain).
2. Wait for theme detection to complete (THEMES popover shows "Lifegain" violet and "Lifedrain" amber).
3. Confirm small `1` (violet) and/or `2` (amber) dots appear on cards in the visual stacks.
4. Hover a dot — tooltip should show the theme name.
5. Cards in **both** themes show both dots side-by-side.
6. Cards in **neither** theme have no chip.
7. Toggling the price overlay on/off does not collide with the chips (chips shift down when price is on).
8. Reassign primary/secondary in the THEMES popover and confirm chips update accordingly within a frame or two.

- [ ] **Step 7: Commit**

```bash
git add src/components/analyze/DeckBuildingArea.tsx
git commit -m "feat(analyze): render per-theme chips on visual stack cards"
```

---

## Task 5: Add `Theme` sort option

**Files:**
- Modify: `src/components/analyze/DeckBuildingArea.tsx`

- [ ] **Step 1: Extend `SortKey` and `SORT_OPTIONS`**

Around line 68-75 in `DeckBuildingArea.tsx`, change:

```ts
type SortKey = 'name' | 'color' | 'role' | 'price';

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: 'name',  label: 'Name'  },
  { key: 'color', label: 'Color' },
  { key: 'role',  label: 'Role'  },
  { key: 'price', label: 'Price' },
];
```

to:

```ts
type SortKey = 'name' | 'color' | 'role' | 'theme' | 'price';

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: 'name',  label: 'Name'  },
  { key: 'color', label: 'Color' },
  { key: 'role',  label: 'Role'  },
  { key: 'theme', label: 'Theme' },
  { key: 'price', label: 'Price' },
];
```

- [ ] **Step 2: Add a default direction for `theme`**

In `DEFAULT_DIR` (around line 134), add:

```ts
const DEFAULT_DIR: Record<SortKey, SortDir> = {
  name: 'asc', color: 'asc', role: 'asc', theme: 'asc', price: 'desc',
};
```

- [ ] **Step 3: Extend the sort function to accept membership**

Change the `sortBy` signature (around line 106) to take an optional membership argument:

```ts
function sortBy(
  cards: ScryfallCard[],
  key: SortKey,
  dir: SortDir = 'asc',
  themeMembership: ThemeMembership | null = null,
): ScryfallCard[] {
  const out = [...cards];
  const sign = dir === 'asc' ? 1 : -1;
  if (key === 'name') {
    out.sort((a, b) => sign * a.name.localeCompare(b.name));
  } else if (key === 'color') {
    out.sort((a, b) => {
      const d = sign * (colorRank(a) - colorRank(b));
      return d !== 0 ? d : a.name.localeCompare(b.name);
    });
  } else if (key === 'role') {
    out.sort((a, b) => {
      const ar = a.deckRole ? (ROLE_PRIORITY[a.deckRole] ?? 99) : 99;
      const br = b.deckRole ? (ROLE_PRIORITY[b.deckRole] ?? 99) : 99;
      return ar !== br ? sign * (ar - br) : a.name.localeCompare(b.name);
    });
  } else if (key === 'theme') {
    // Group rank: both themes (0), primary only (1), secondary only (2), none (3).
    const rank = (c: ScryfallCard): number => {
      const idxs = themeMembership?.byCard.get(c.name.toLowerCase());
      if (!idxs || idxs.length === 0) return 3;
      const hasPrimary = idxs.includes(0);
      const hasSecondary = idxs.includes(1);
      if (hasPrimary && hasSecondary) return 0;
      if (hasPrimary) return 1;
      if (hasSecondary) return 2;
      return 3;
    };
    out.sort((a, b) => {
      const d = sign * (rank(a) - rank(b));
      return d !== 0 ? d : a.name.localeCompare(b.name);
    });
  } else if (key === 'price') {
    out.sort((a, b) => {
      const ap = parseFloat(getCardPrice(a) ?? '0');
      const bp = parseFloat(getCardPrice(b) ?? '0');
      return bp !== ap ? sign * (ap - bp) : a.name.localeCompare(b.name);
    });
  }
  return out;
}
```

- [ ] **Step 4: Pass membership to every `sortBy` call**

Find all `sortBy(...)` call sites in `DeckBuildingArea.tsx` (around lines 226-228 and 264). Update each to forward `themeMembership`:

```ts
creatures: buckets.creatures.map(col => sortBy(applyFilter(col), sortKey, sortDir, themeMembership)),
noncreatures: buckets.noncreatures.map(col => sortBy(applyFilter(col), sortKey, sortDir, themeMembership)),
lands: buckets.lands.map(col => sortBy(col, sortKey, sortDir, themeMembership)),
```

And the `.map(({ key, label }) => ({ key, label, cards: sortBy(groups[key], sortKey, sortDir) }))` site:

```ts
.map(({ key, label }) => ({ key, label, cards: sortBy(groups[key], sortKey, sortDir, themeMembership) }))
```

Also add `themeMembership` to the `useMemo` dependency arrays for these computations (e.g. the array that includes `[buckets, sortKey, sortDir, hideEnabled, highlightRoles, matchesActiveFilter]`).

- [ ] **Step 5: Hide the `Theme` chip when no membership**

Find where `SORT_OPTIONS` is rendered into the toolbar (search for `SORT_OPTIONS.map` inside the JSX). Filter it:

```tsx
{SORT_OPTIONS
  .filter(o => o.key !== 'theme' || (themeMembership && themeMembership.themes.length > 0))
  .map(o => (
    // existing chip JSX
  ))}
```

Also: if the user is currently sorted by `theme` and membership becomes null, fall back to `'name'`. Add this effect just after the `sortKey`/`sortDir` state declarations:

```ts
useEffect(() => {
  if (sortKey === 'theme' && (!themeMembership || themeMembership.themes.length === 0)) {
    setSortKey('name');
    setSortDir(DEFAULT_DIR.name);
  }
}, [sortKey, themeMembership]);
```

- [ ] **Step 6: Persist theme sort to localStorage like other keys**

Sort key persistence uses `SORT_STORAGE_KEY`. Find the reader that parses the stored value and add `'theme'` to the accepted set. Example (your current parser may differ):

```ts
const stored = localStorage.getItem(SORT_STORAGE_KEY);
if (stored === 'name' || stored === 'color' || stored === 'role' || stored === 'theme' || stored === 'price') {
  return stored;
}
```

- [ ] **Step 7: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 8: Visual verification**

With `npm run dev` running and a themed deck loaded:
1. Confirm `Theme` chip appears in the sort header alongside Name / Color / Role / Price.
2. Click `Theme` — cards re-sort so **both-themes** cards rise to the top of each column, then primary-only, then secondary-only, then untagged.
3. Toggle direction (click `Theme` again) — order reverses (untagged first).
4. Open the THEMES popover and **deselect both themes** (or pick a commander with no detected themes). The `Theme` chip disappears from the sort header, and if it was active, the view falls back to Name sort without errors.
5. Reload the page with `Theme` previously selected — sort persists via localStorage.
6. No console errors.

- [ ] **Step 9: Commit**

```bash
git add src/components/analyze/DeckBuildingArea.tsx
git commit -m "feat(analyze): add Theme sort option to visual stacks"
```

---

## Final review

- [ ] **Step 1: End-to-end smoke test**

With dev server running:
1. Load the analyze page with no deck → no errors.
2. Paste in a deck with themes Lifegain + Lifedrain → chips appear, sort works.
3. Reassign primary ↔ secondary themes via the THEMES popover → chip colors swap, sort updates.
4. Reanalyze (different commander, e.g. a deck with no confident themes) → chips disappear, Theme sort hides.
5. Re-paste original deck → chips return.

- [ ] **Step 2: Bump version**

This is a user-facing feature. Run the `bump-version` skill (or manually):
- Bump the patch version in `package.json`.
- Add an entry to `src/data/patchNotes.json` under the new version, e.g.:

```json
{
  "version": "x.y.z",
  "notes": [
    "Visual stacks now show small numbered chips on each card indicating which selected themes it belongs to.",
    "Added a Theme sort option that groups cards by theme membership."
  ]
}
```

- [ ] **Step 3: Final commit**

```bash
git add package.json src/data/patchNotes.json
git commit -m "chore: bump version for theme chips feature"
```

---

## Self-review notes (already applied)

- Every requirement in the spec maps to a task: data model (Task 1), per-card membership (Task 2 + 3), chip render (Task 4), sort option (Task 5), edge cases — one-theme / zero-themes / loading — handled in Task 5 step 5 and Task 4 step 4 (chip absent when index missing).
- Method names are consistent: `buildThemeMembership`, `themeMembership`, `byCard`, `themes`, `THEME_CHIP_CLASS`, `themeIndices`, `themeNames`.
- No placeholders; every code-changing step shows the actual code.
- Lands chip rendering: chips render in `CurveCard`, which is used for both spells and lands within `DeckBuildingArea`. Per the spec ("revisit if useful"), lands chips will appear too — this is acceptable and matches the data (theme pools do include lands).
