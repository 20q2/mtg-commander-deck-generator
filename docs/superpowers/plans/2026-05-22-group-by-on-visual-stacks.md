# Group-by on visual stacks — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the fixed CMC column layout in the analyze visual stacks with a user-selectable Group dimension (`CMC | Theme | Role | Type | None`), keeping the creatures/noncreatures row split for every grouping except Type.

**Architecture:** Introduce a generic `Column` abstraction with a `matches(card)` predicate and a pure `getColumns(groupKey, ctx)` helper. Refactor `DeckBuildingArea` to derive its column dimension from `getColumns` rather than the hard-coded `activeCmcs` array. Persist the selected grouping to localStorage. Retire the `Theme` sort option (group-by-Theme replaces it). Move theme-chip gating from `sortKey === 'theme'` to `groupKey === 'theme'`.

**Tech Stack:** React 18 + TypeScript + Tailwind. No new libraries.

**Spec:** `docs/superpowers/specs/2026-05-22-group-by-on-visual-stacks-design.md`

**Note:** No automated test suite in this codebase. Each task ends with `npx tsc --noEmit` plus a visual smoke step in `npm run dev`.

---

## File map

| Path | Action |
|---|---|
| `src/components/analyze/groupColumns.ts` | Create — `GroupKey`, `Column`, `getColumns` pure helper |
| `src/components/analyze/DeckBuildingArea.tsx` | Modify — refactor to use columns; add group toolbar; remove Theme sort; gate chips on group |

---

## Task 1: Group column helper

**Files:**
- Create: `src/components/analyze/groupColumns.ts`

- [ ] **Step 1: Create the helper module**

Create `src/components/analyze/groupColumns.ts`:

```ts
import type { ScryfallCard } from '@/types';
import { getFrontFaceTypeLine } from '@/services/scryfall/client';
import type { ThemeMembership } from './themeMembership';

export type GroupKey = 'cmc' | 'theme' | 'role' | 'type' | 'none';

export interface GroupOption {
  key: GroupKey;
  label: string;
}

export const GROUP_OPTIONS: GroupOption[] = [
  { key: 'cmc',   label: 'CMC'   },
  { key: 'theme', label: 'Theme' },
  { key: 'role',  label: 'Role'  },
  { key: 'type',  label: 'Type'  },
  { key: 'none',  label: 'None'  },
];

export interface Column {
  /** Stable React key + identity. */
  key: string;
  /** Header text. */
  label: string;
  /** True if a card belongs in this column. */
  matches: (card: ScryfallCard) => boolean;
}

export interface ColumnContext {
  themeMembership: ThemeMembership | null;
}

const CMC_LABELS = ['0', '1', '2', '3', '4', '5', '6', '7+'];

function cmcColumns(): Column[] {
  return CMC_LABELS.map((label, i) => ({
    key: `cmc:${i}`,
    label,
    matches: (card) => {
      const cmc = Math.min(Math.floor(card.cmc ?? 0), 7);
      return cmc === i;
    },
  }));
}

function themeColumns(ctx: ColumnContext): Column[] {
  const themes = ctx.themeMembership?.themes ?? [];
  const byCard = ctx.themeMembership?.byCard;
  const has = (card: ScryfallCard, idx: number) =>
    !!byCard?.get(card.name.toLowerCase())?.includes(idx);

  if (themes.length === 0) {
    // Defensive: shouldn't be reachable since the toolbar disables Theme
    // grouping when no themes are selected; fall back to "All" column.
    return [{ key: 'theme:all', label: 'All', matches: () => true }];
  }
  if (themes.length === 1) {
    return [
      { key: `theme:${themes[0].slug}`, label: themes[0].name, matches: (c) => has(c, 0) },
      { key: 'theme:off',                 label: 'Off-theme',     matches: (c) => !has(c, 0) },
    ];
  }
  return [
    { key: `theme:${themes[0].slug}`, label: themes[0].name,
      matches: (c) => has(c, 0) && !has(c, 1) },
    { key: 'theme:both',              label: 'Both',
      matches: (c) => has(c, 0) && has(c, 1) },
    { key: `theme:${themes[1].slug}`, label: themes[1].name,
      matches: (c) => has(c, 1) && !has(c, 0) },
    { key: 'theme:off',               label: 'Off-theme',
      matches: (c) => !has(c, 0) && !has(c, 1) },
  ];
}

function roleColumns(): Column[] {
  return [
    { key: 'role:ramp',     label: 'Ramp',    matches: (c) => c.deckRole === 'ramp' },
    { key: 'role:removal',  label: 'Removal', matches: (c) => c.deckRole === 'removal' },
    { key: 'role:wipe',     label: 'Wipes',   matches: (c) => c.deckRole === 'boardwipe' },
    { key: 'role:draw',     label: 'Draw',    matches: (c) => c.deckRole === 'cardDraw' },
    { key: 'role:other',    label: 'Other',
      matches: (c) => !c.deckRole || !['ramp', 'removal', 'boardwipe', 'cardDraw'].includes(c.deckRole) },
  ];
}

function typeOf(card: ScryfallCard): string {
  const t = getFrontFaceTypeLine(card).toLowerCase();
  if (t.includes('creature'))     return 'creature';
  if (t.includes('planeswalker')) return 'planeswalker';
  if (t.includes('battle'))       return 'battle';
  if (t.includes('artifact'))     return 'artifact';
  if (t.includes('enchantment'))  return 'enchantment';
  if (t.includes('instant'))      return 'instant';
  if (t.includes('sorcery'))      return 'sorcery';
  return 'other';
}

function typeColumns(): Column[] {
  return [
    { key: 'type:creature',     label: 'Creature',     matches: (c) => typeOf(c) === 'creature' },
    { key: 'type:planeswalker', label: 'Planeswalker', matches: (c) => typeOf(c) === 'planeswalker' },
    { key: 'type:battle',       label: 'Battle',       matches: (c) => typeOf(c) === 'battle' },
    { key: 'type:artifact',     label: 'Artifact',     matches: (c) => typeOf(c) === 'artifact' },
    { key: 'type:enchantment',  label: 'Enchantment',  matches: (c) => typeOf(c) === 'enchantment' },
    { key: 'type:instant',      label: 'Instant',      matches: (c) => typeOf(c) === 'instant' },
    { key: 'type:sorcery',      label: 'Sorcery',      matches: (c) => typeOf(c) === 'sorcery' },
    { key: 'type:other',        label: 'Other',        matches: (c) => typeOf(c) === 'other' },
  ];
}

export function getColumns(groupKey: GroupKey, ctx: ColumnContext): Column[] {
  switch (groupKey) {
    case 'cmc':   return cmcColumns();
    case 'theme': return themeColumns(ctx);
    case 'role':  return roleColumns();
    case 'type':  return typeColumns();
    case 'none':  return [{ key: 'all', label: 'All', matches: () => true }];
  }
}

/** True when the row split (creatures vs. noncreatures) should be collapsed
 *  for this grouping. Type grouping is the only case — each column already
 *  holds exactly one card type, so the row split is meaningless. */
export function shouldCollapseRows(groupKey: GroupKey): boolean {
  return groupKey === 'type';
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS for the new module (pre-existing errors in `DeckOptimizer.tsx` and `DeckBuildingArea.tsx:269` for the `fetch` LandCategory mismatch are unrelated).

- [ ] **Step 3: Commit**

```bash
git add src/components/analyze/groupColumns.ts
git commit -m "feat(analyze): groupColumns helper for grouping the visual stacks"
```

---

## Task 2: Refactor DeckBuildingArea to use Column[] (still defaulting to CMC)

This is a **mechanical refactor** with no user-visible change. Replace the hard-coded `activeCmcs` array with a generic `columns` derived from `getColumns('cmc', ...)`. The point is to keep this commit verifiable in isolation before turning on the new groupings.

**Files:**
- Modify: `src/components/analyze/DeckBuildingArea.tsx`

- [ ] **Step 1: Add imports**

Near the existing imports in `DeckBuildingArea.tsx`, add:

```ts
import { getColumns, type Column } from './groupColumns';
```

- [ ] **Step 2: Drop the `applyFilter`/`sortBy` path's CMC coupling**

Find `sortedBuckets` (~line 257). Replace the whole block — instead of starting from `buckets.creatures[i]` we'll now group from a flat array using `Column.matches`:

```ts
// Flat creature / noncreature lists (lands stay in their own view).
// We use the same exclude / filter rules as before, but ditch the CMC
// pre-bucketing so we can re-group per the current groupKey.
const flatCreatures = useMemo(() => buckets.creatures.flat(), [buckets]);
const flatNoncreatures = useMemo(() => buckets.noncreatures.flat(), [buckets]);

const columns: Column[] = useMemo(
  () => getColumns('cmc', { themeMembership }),
  [themeMembership],
);

const sortedColumns = useMemo(() => {
  const applyFilter = (col: ScryfallCard[]) => hideEnabled && highlightRoles
    ? col.filter(matchesActiveFilter)
    : col;
  return columns.map(col => ({
    column: col,
    creatures: sortBy(applyFilter(flatCreatures.filter(col.matches)), sortKey, sortDir, themeMembership),
    noncreatures: sortBy(applyFilter(flatNoncreatures.filter(col.matches)), sortKey, sortDir, themeMembership),
  }));
}, [columns, flatCreatures, flatNoncreatures, sortKey, sortDir, hideEnabled, highlightRoles, matchesActiveFilter, themeMembership]);

// Drop empty columns from the layout.
const activeColumns = useMemo(
  () => sortedColumns.filter(c => c.creatures.length > 0 || c.noncreatures.length > 0),
  [sortedColumns],
);

const gridTemplate = `repeat(${activeColumns.length}, minmax(0, 130px))`;
```

Delete the now-unused `sortedBuckets` and `activeCmcs` block (the lines you just replaced).

- [ ] **Step 3: Update column-count header**

Find the CMC header row (the `<div ... style={{ gridTemplateColumns: gridTemplate }}>` containing `{activeCmcs.map(i => ...)}`):

```tsx
{activeCmcs.map(i => (
  <div key={i} className="text-center font-semibold tabular-nums py-1">
    {COLUMN_LABELS[i]} <span className="text-muted-foreground/80 font-normal">({buckets.countsByCmc[i]})</span>
  </div>
))}
```

Replace with:

```tsx
{activeColumns.map(({ column, creatures, noncreatures }) => (
  <div key={column.key} className="text-center font-semibold tabular-nums py-1">
    {column.label}{' '}
    <span className="text-muted-foreground/80 font-normal">
      ({creatures.length + noncreatures.length})
    </span>
  </div>
))}
```

- [ ] **Step 4: Update both CurveRow instantiations**

The two `<CurveRow ... rowCards={sortedBuckets.creatures}` / `sortedBuckets.noncreatures` ... activeCmcs={activeCmcs} />` lines need to take row arrays in the new shape. Replace with:

```tsx
<CurveRow
  rowCards={activeColumns.map(c => c.creatures)}
  columnKeys={activeColumns.map(c => c.column.key)}
  gridTemplate={gridTemplate}
  onHover={handleHover} onSelect={setPreviewCard}
  dimNonRoles={highlightRoles && dimEnabled}
  activeRole={activeRole} activeCmcRange={activeCmcRange} activeRoleGroup={activeRoleGroup}
  removalNames={removalNames} showPrice={sortKey === 'price'}
  onCardAction={onCardAction} menuProps={menuProps}
  marginTopPercent={marginTopPercent}
  themeMembership={themeMembership}
/>
<CurveRow
  rowCards={activeColumns.map(c => c.noncreatures)}
  columnKeys={activeColumns.map(c => c.column.key)}
  gridTemplate={gridTemplate}
  onHover={handleHover} onSelect={setPreviewCard}
  dimNonRoles={highlightRoles && dimEnabled}
  activeRole={activeRole} activeCmcRange={activeCmcRange} activeRoleGroup={activeRoleGroup}
  removalNames={removalNames} showPrice={sortKey === 'price'}
  onCardAction={onCardAction} menuProps={menuProps}
  marginTopPercent={marginTopPercent}
  themeMembership={themeMembership}
/>
```

- [ ] **Step 5: Update CurveRow props**

Change `CurveRowProps` to take `columnKeys` instead of `activeCmcs`:

```ts
interface CurveRowProps {
  rowCards: ScryfallCard[][];
  columnKeys: string[];
  gridTemplate: string;
  // ...rest unchanged
}
```

Update the function signature and inner `.map`:

```tsx
function CurveRow({ rowCards, columnKeys, gridTemplate, onHover, onSelect, dimNonRoles, activeRole, activeCmcRange, activeRoleGroup, removalNames, showPrice, onCardAction, menuProps, marginTopPercent, themeMembership }: CurveRowProps) {
  return (
    <div className="grid justify-start gap-2 py-2 items-end" style={{ gridTemplateColumns: gridTemplate }}>
      {columnKeys.map((key, col) => (
        <CurveCell
          key={key}
          cards={rowCards[col]}
          cascadeIndex={col}
          onHover={onHover} onSelect={onSelect}
          dimNonRoles={dimNonRoles}
          activeRole={activeRole} activeCmcRange={activeCmcRange} activeRoleGroup={activeRoleGroup}
          removalNames={removalNames} showPrice={showPrice}
          onCardAction={onCardAction} menuProps={menuProps}
          marginTopPercent={marginTopPercent}
          themeMembership={themeMembership}
        />
      ))}
    </div>
  );
}
```

- [ ] **Step 6: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors (pre-existing `colorIdentity` and `fetch` errors remain — unrelated). Specifically check that `activeCmcs`, `sortedBuckets`, and `COLUMN_LABELS` are no longer referenced anywhere outside their declarations. Delete `COLUMN_LABELS` if it has no remaining users.

- [ ] **Step 7: Visual smoke**

Run: `npm run dev` (if not already running). Load any deck on the analyze page. Confirm:
- CMC columns render exactly as before (`0 (n) | 1 (n) | …`).
- Sort chips (Name/Color/Role/Theme/Price) still reorder cards within columns.
- Theme chips still appear on cards when sort = Theme (this gating moves in a later task).
- Lands view unchanged.

- [ ] **Step 8: Commit**

```bash
git add src/components/analyze/DeckBuildingArea.tsx
git commit -m "refactor(analyze): derive stack columns from getColumns helper"
```

---

## Task 3: Group selector toolbar UI

Adds the Group chip strip, state, persistence, and the disabled state for Theme when no themes are selected. Still wired to `groupKey = 'cmc'` for now (Task 4 turns on the other groupings).

**Files:**
- Modify: `src/components/analyze/DeckBuildingArea.tsx`

- [ ] **Step 1: Add the icon import**

In the existing lucide import line, add `LayoutGrid`:

```ts
import { ArrowUpDown, Sprout, Swords, Flame, BookOpen, ArrowUp, ArrowDown, LayoutGrid } from 'lucide-react';
```

- [ ] **Step 2: Add group constants and state**

Near the existing `SORT_STORAGE_KEY` / `SORT_DIR_STORAGE_KEY` constants in `DeckBuildingArea.tsx`, add:

```ts
const GROUP_STORAGE_KEY = 'analyze-play-area-group';
```

Add the import:

```ts
import { getColumns, type Column, type GroupKey, GROUP_OPTIONS, shouldCollapseRows } from './groupColumns';
```

(Replace the simpler import you added in Task 2.)

In the `DeckBuildingArea` function body, alongside the existing `sortKey` state, add:

```ts
const [groupKey, setGroupKey] = useState<GroupKey>(() => {
  const stored = localStorage.getItem(GROUP_STORAGE_KEY);
  if (stored === 'cmc' || stored === 'theme' || stored === 'role' || stored === 'type' || stored === 'none') {
    return stored;
  }
  return 'cmc';
});
useEffect(() => { localStorage.setItem(GROUP_STORAGE_KEY, groupKey); }, [groupKey]);
```

- [ ] **Step 3: Wire `groupKey` into the columns memo**

Update the columns memo to use `groupKey`:

```ts
const columns: Column[] = useMemo(
  () => getColumns(groupKey, { themeMembership }),
  [groupKey, themeMembership],
);
```

And add `groupKey` to the `sortedColumns` deps array (since `columns` depends on it):

```ts
}, [columns, flatCreatures, flatNoncreatures, sortKey, sortDir, hideEnabled, highlightRoles, matchesActiveFilter, themeMembership]);
```

(`columns` already covers `groupKey`.)

- [ ] **Step 4: Render the Group chip strip**

Find the sort chip strip block (`<div className="flex items-center gap-1"> <ArrowUpDown ... /> ... SORT_OPTIONS.map ...`). Just **before** it, in the same flex toolbar row, insert:

```tsx
{/* Group-by chip strip. Disables Theme when no themes are selected. */}
<div className="flex items-center gap-1">
  <LayoutGrid className="w-3 h-3 text-muted-foreground/50" />
  <div className="flex items-center border border-border/50 rounded-md overflow-hidden">
    {GROUP_OPTIONS.map((opt, i) => {
      const themeDisabled = opt.key === 'theme'
        && (!themeMembership || themeMembership.themes.length === 0);
      const active = groupKey === opt.key;
      return (
        <div key={opt.key} className="contents">
          {i > 0 && <div className="w-px h-3 bg-border/50" />}
          <button
            type="button"
            disabled={themeDisabled}
            onClick={() => setGroupKey(opt.key)}
            className={`text-[10px] px-2 py-0.5 inline-flex items-center gap-1 transition-colors ${
              active
                ? 'bg-accent text-foreground font-medium'
                : 'text-muted-foreground/60 hover:text-foreground hover:bg-accent/50'
            } ${themeDisabled ? 'opacity-40 pointer-events-none' : ''}`}
            aria-pressed={active}
            title={themeDisabled ? 'Select themes first' : `Group by ${opt.label.toLowerCase()}`}
          >
            {opt.label}
          </button>
        </div>
      );
    })}
  </div>
</div>
```

- [ ] **Step 5: Fall back when Theme grouping loses its themes**

Just below the `groupKey` localStorage effect, add:

```ts
useEffect(() => {
  if (groupKey === 'theme' && (!themeMembership || themeMembership.themes.length === 0)) {
    setGroupKey('cmc');
  }
}, [groupKey, themeMembership]);
```

- [ ] **Step 6: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 7: Visual smoke**

In dev server:
- Toolbar now shows `CMC | Theme | Role | Type | None` chips. CMC is selected.
- Theme chip is greyed and untappable until a deck with themes is loaded.
- Clicking other chips does *nothing visible yet* — Task 4 turns on the rendering.

- [ ] **Step 8: Commit**

```bash
git add src/components/analyze/DeckBuildingArea.tsx
git commit -m "feat(analyze): add Group selector toolbar (UI only)"
```

---

## Task 4: Turn on Theme / Role / Type / None groupings and collapse rows for Type

**Files:**
- Modify: `src/components/analyze/DeckBuildingArea.tsx`

- [ ] **Step 1: Conditionally render one row vs. two**

Find the two `<CurveRow ... />` calls (creatures then noncreatures) inside the spells view. Wrap them so that when `shouldCollapseRows(groupKey)` is true, render a single merged row.

Just above the JSX block:

```tsx
const collapseRows = shouldCollapseRows(groupKey);
const mergedRowCards = collapseRows
  ? activeColumns.map(c => [...c.creatures, ...c.noncreatures])
  : null;
```

Then replace the two `<CurveRow … />` calls with:

```tsx
{collapseRows ? (
  <CurveRow
    rowCards={mergedRowCards!}
    columnKeys={activeColumns.map(c => c.column.key)}
    gridTemplate={gridTemplate}
    onHover={handleHover} onSelect={setPreviewCard}
    dimNonRoles={highlightRoles && dimEnabled}
    activeRole={activeRole} activeCmcRange={activeCmcRange} activeRoleGroup={activeRoleGroup}
    removalNames={removalNames} showPrice={sortKey === 'price'}
    onCardAction={onCardAction} menuProps={menuProps}
    marginTopPercent={marginTopPercent}
    themeMembership={themeMembership}
  />
) : (
  <>
    <CurveRow
      rowCards={activeColumns.map(c => c.creatures)}
      columnKeys={activeColumns.map(c => c.column.key)}
      gridTemplate={gridTemplate}
      onHover={handleHover} onSelect={setPreviewCard}
      dimNonRoles={highlightRoles && dimEnabled}
      activeRole={activeRole} activeCmcRange={activeCmcRange} activeRoleGroup={activeRoleGroup}
      removalNames={removalNames} showPrice={sortKey === 'price'}
      onCardAction={onCardAction} menuProps={menuProps}
      marginTopPercent={marginTopPercent}
      themeMembership={themeMembership}
    />
    <CurveRow
      rowCards={activeColumns.map(c => c.noncreatures)}
      columnKeys={activeColumns.map(c => c.column.key)}
      gridTemplate={gridTemplate}
      onHover={handleHover} onSelect={setPreviewCard}
      dimNonRoles={highlightRoles && dimEnabled}
      activeRole={activeRole} activeCmcRange={activeCmcRange} activeRoleGroup={activeRoleGroup}
      removalNames={removalNames} showPrice={sortKey === 'price'}
      onCardAction={onCardAction} menuProps={menuProps}
      marginTopPercent={marginTopPercent}
      themeMembership={themeMembership}
    />
  </>
)}
```

- [ ] **Step 2: Move theme-chip gating from sort to group**

Find the two `<CurveRow ... themeMembership={sortKey === 'theme' ? themeMembership : null} />` instantiations from the prior round. They no longer exist as-is after Task 2's refactor — instead, the `themeMembership` prop is now passed straight through. Change *both* (or the single merged) CurveRow calls in this view to gate on `groupKey`:

The `themeMembership` prop value for each `<CurveRow ... />` instantiation in the spells view should be:

```tsx
themeMembership={groupKey === 'theme' ? themeMembership : null}
```

Apply this to **all** `<CurveRow … />` calls in the spells view (the collapsed one and the two-row case).

Also update the **lands** view `<CurveCell ... themeMembership={...} />` line — same gate:

```tsx
themeMembership={groupKey === 'theme' ? themeMembership : null}
```

(Previously it was gated on `sortKey === 'theme'`.)

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Visual smoke**

In dev server with a Lifegain/Lifedrain deck loaded:
- **CMC group:** unchanged from today.
- **Theme group:** columns become `Lifegain | Both | Lifedrain | Off-theme`, each with creatures/noncreatures rows. Theme chips appear on cards. Cards in only one theme go in that column; both-theme cards cluster in the middle.
- **Role group:** columns become `Ramp | Removal | Wipes | Draw | Other`, with creatures/noncreatures rows. Many of the "Other" cards will be non-tagged lands or non-role spells.
- **Type group:** single row of stacks, one column per type. No row split.
- **None group:** single column "All", with creatures over noncreatures.
- Reloading the page preserves the choice via localStorage.
- Disabled Theme chip becomes tappable once themes are detected.

- [ ] **Step 5: Commit**

```bash
git add src/components/analyze/DeckBuildingArea.tsx
git commit -m "feat(analyze): wire up Theme/Role/Type/None groupings"
```

---

## Task 5: Retire `Theme` sort and migrate stored sort

The standalone `Theme` sort option is strictly worse than group-by-Theme. Remove it cleanly.

**Files:**
- Modify: `src/components/analyze/DeckBuildingArea.tsx`

- [ ] **Step 1: Remove `'theme'` from `SortKey` and `SORT_OPTIONS`**

Change:

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

to:

```ts
type SortKey = 'name' | 'color' | 'role' | 'price';

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: 'name',  label: 'Name'  },
  { key: 'color', label: 'Color' },
  { key: 'role',  label: 'Role'  },
  { key: 'price', label: 'Price' },
];
```

- [ ] **Step 2: Remove `theme` from `DEFAULT_DIR`**

Change:

```ts
const DEFAULT_DIR: Record<SortKey, SortDir> = {
  name: 'asc', color: 'asc', role: 'asc', theme: 'asc', price: 'desc',
};
```

to:

```ts
const DEFAULT_DIR: Record<SortKey, SortDir> = {
  name: 'asc', color: 'asc', role: 'asc', price: 'desc',
};
```

- [ ] **Step 3: Remove the `theme` branch from `sortBy`**

Delete the whole `else if (key === 'theme') { ... }` block in `sortBy`. The signature still takes `themeMembership` because group-by-Theme uses the membership map for column matching, not sort — but the `themeMembership` parameter on `sortBy` is now unused. Remove it:

```ts
function sortBy(cards: ScryfallCard[], key: SortKey, dir: SortDir = 'asc'): ScryfallCard[] {
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

- [ ] **Step 4: Update all `sortBy(...)` call sites**

In the `sortedColumns` memo, change:

```ts
creatures: sortBy(applyFilter(flatCreatures.filter(col.matches)), sortKey, sortDir, themeMembership),
noncreatures: sortBy(applyFilter(flatNoncreatures.filter(col.matches)), sortKey, sortDir, themeMembership),
```

to:

```ts
creatures: sortBy(applyFilter(flatCreatures.filter(col.matches)), sortKey, sortDir),
noncreatures: sortBy(applyFilter(flatNoncreatures.filter(col.matches)), sortKey, sortDir),
```

In the `landCategoryGroups` memo, change:

```ts
.map(({ key, label }) => ({ key, label, cards: sortBy(groups[key], sortKey, sortDir, themeMembership) }))
```

to:

```ts
.map(({ key, label }) => ({ key, label, cards: sortBy(groups[key], sortKey, sortDir) }))
```

And remove `themeMembership` from the dependency arrays of both memos *only if* it's no longer referenced elsewhere in the deps. (It's still threaded as a prop to children, so the variable stays.)

- [ ] **Step 5: Migrate stored sort key**

Update the sort-key initializer to coerce a stored `'theme'` to `'name'`:

```ts
const [sortKey, setSortKey] = useState<SortKey>(() => {
  const stored = localStorage.getItem(SORT_STORAGE_KEY);
  if (stored === 'name' || stored === 'color' || stored === 'role' || stored === 'price') return stored;
  return 'name';
});
```

(Drop the `stored === 'theme'` arm and the surrounding fallback effect.)

- [ ] **Step 6: Remove the "fall back to name when theme sort vanishes" effect**

Delete:

```ts
useEffect(() => {
  if (sortKey === 'theme' && (!themeMembership || themeMembership.themes.length === 0)) {
    setSortKey('name');
    setSortDir(DEFAULT_DIR.name);
  }
}, [sortKey, themeMembership]);
```

- [ ] **Step 7: Remove the `Theme` sort filter in the SORT_OPTIONS render**

Find:

```tsx
{SORT_OPTIONS
  .filter(o => o.key !== 'theme' || (themeMembership && themeMembership.themes.length > 0))
  .map((opt, i) => {
```

Change to:

```tsx
{SORT_OPTIONS.map((opt, i) => {
```

- [ ] **Step 8: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors. The `themeMembership` parameter is no longer used by `sortBy`. Confirm nothing else still references the removed `'theme'` literal.

- [ ] **Step 9: Visual smoke**

In dev server:
- Sort chip strip is now `Name | Color | Role | Price` (no Theme).
- Group strip works for all groupings.
- Old localStorage value `analyze-play-area-sort=theme` quietly upgrades to `name` on next visit.
- No console errors.

- [ ] **Step 10: Commit**

```bash
git add src/components/analyze/DeckBuildingArea.tsx
git commit -m "refactor(analyze): retire Theme sort option (superseded by Group by Theme)"
```

---

## Final review

- [ ] **Step 1: End-to-end smoke test**

With `npm run dev`:
1. Empty analyze page → no errors.
2. Paste a deck with confident themes (e.g. Lifegain + Lifedrain) → Group chip strip + Sort chip strip both visible. Theme chip enabled.
3. Click `Theme` → 4-column layout (`Lifegain | Both | Lifedrain | Off-theme`) with creature/noncreature rows. Card-level theme chips appear.
4. Click `Role` → 5-column role layout with rows.
5. Click `Type` → single-row layout with one column per type.
6. Click `None` → single "All" column, two-row.
7. Click `CMC` → original layout.
8. Switch the **Sort** independently (`Name`, `Color`, `Role`, `Price`) and verify it reorders inside each column.
9. Reload page → grouping and sort both persist.
10. Pick a commander with no detectable themes → Theme group chip greys out; if it was previously selected, view falls back to CMC.

- [ ] **Step 2: Bump version**

Run the `bump-version` skill (or manually):
- Bump patch version in `package.json`.
- Prepend an entry to `src/data/patchNotes.json`:

```json
{
  "version": "x.y.z",
  "notes": [
    "Analyze visual stacks now have a Group selector — split your deck by CMC, Theme, Role, Type, or None.",
    "Theme grouping replaces the old Theme sort; cards cluster into your selected themes plus Both / Off-theme."
  ]
}
```

- [ ] **Step 3: Final commit**

```bash
git add package.json src/data/patchNotes.json
git commit -m "chore: bump version for group-by selector"
```

---

## Self-review notes (already applied)

- Spec section coverage:
  - Toolbar UI → Task 3.
  - Column dimension via `getColumns` → Task 1 + Task 2 wiring.
  - Per-grouping column definitions (cmc/theme/role/type/none) → Task 1.
  - Row split preserved except Type → Task 1 (`shouldCollapseRows`) + Task 4 (renderer branch).
  - Sort interaction unchanged within columns → Task 2 keeps sort path; Task 5 removes the `Theme` sort.
  - Theme chip gating moves to `groupKey === 'theme'` → Task 4 step 2.
  - Persistence via `analyze-play-area-group` → Task 3.
  - Empty/loading states for Theme → Task 3 step 5 fallback effect.
  - Lands view untouched → confirmed (only the membership gate on its CurveCell flips from sort → group).
- Type/name consistency: `GroupKey`, `Column`, `getColumns`, `shouldCollapseRows`, `GROUP_STORAGE_KEY`, `GROUP_OPTIONS` consistent throughout.
- No placeholders; every code-changing step shows actual code.
