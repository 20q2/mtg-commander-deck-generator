# Analyze Page Split Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the loaded-deck Analyze view into a resizable two-column layout — analyzer (`DeckOptimizer`) on the left, deck (`DeckBuildingArea`) on the right — at `lg+` widths, with a draggable divider that persists its position. Below `lg`, keep today's stacked layout.

**Architecture:** Wrap both components in a new `AnalyzeSplit` component built on `react-resizable-panels`. The component renders a stacked column layout below `lg` and a `PanelGroup` with a `PanelResizeHandle` at `lg+`. `AnalyzePage` shrinks accordingly. Drop the existing `!optimizeViewActive` gate that hides the deck during the optimize view — both panes stay visible in the split layout.

**Tech Stack:** React 18, TypeScript, Tailwind CSS, `react-resizable-panels` (new), existing Zustand store unchanged.

**Note on uncommitted changes:** At plan-writing time the working tree has uncommitted edits to `package.json`, `src/components/analyze/DeckBuildingArea.tsx`, `src/components/deck/optimizer/DeckOptimizer.tsx`, and `src/pages/AnalyzePage.tsx`. The plan assumes those edits stay; commit or stash them before starting if you want a clean baseline.

**Spec:** [docs/superpowers/specs/2026-05-20-analyze-page-split-layout-design.md](../specs/2026-05-20-analyze-page-split-layout-design.md)

---

## File Structure

- **New:** `src/components/analyze/AnalyzeSplit.tsx` — owns the split-vs-stack responsive layout, the `PanelGroup`, and the `PanelResizeHandle` styling. Accepts `analyzer` and `deck` as `ReactNode` props.
- **Modified:** `src/pages/AnalyzePage.tsx` — replaces the inline `DeckBuildingArea` + `DeckOptimizer` render with `<AnalyzeSplit analyzer={...} deck={...} />`. Drops `!optimizeViewActive &&` gate.
- **Modified:** `package.json` — adds `react-resizable-panels` dependency.

---

### Task 1: Install react-resizable-panels

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install the dependency**

Run:
```bash
npm install react-resizable-panels@^2.1.7
```

Expected: `package.json` gains `"react-resizable-panels": "^2.1.7"` under `dependencies`, and `package-lock.json` updates.

- [ ] **Step 2: Verify install**

Run:
```bash
npm ls react-resizable-panels
```

Expected: prints the installed version, no `UNMET DEPENDENCY` warning.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add react-resizable-panels dependency"
```

---

### Task 2: Create AnalyzeSplit component

**Files:**
- Create: `src/components/analyze/AnalyzeSplit.tsx`

- [ ] **Step 1: Create the component file**

Create `src/components/analyze/AnalyzeSplit.tsx` with the following contents:

```tsx
// src/components/analyze/AnalyzeSplit.tsx
import type { ReactNode } from 'react';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';

interface AnalyzeSplitProps {
  analyzer: ReactNode;
  deck: ReactNode;
}

/**
 * Responsive two-column layout for the loaded-deck Analyze view.
 *
 * - At `lg` (>=1024px) and up: renders a horizontally-split `PanelGroup` with
 *   a draggable divider. Default split is 55% analyzer / 45% deck, min 30%
 *   per side. The split ratio is persisted via the library's `autoSaveId`.
 * - Below `lg`: renders a single column with the deck above the analyzer,
 *   matching the pre-split layout order.
 *
 * Each pane scrolls independently at `lg+` so the analyzer's tab bar and the
 * deck's toolbar stay visible while the other side scrolls.
 */
export function AnalyzeSplit({ analyzer, deck }: AnalyzeSplitProps) {
  return (
    <>
      {/* Stacked layout: mobile / tablet (<lg) */}
      <div className="lg:hidden">
        {deck}
        {analyzer}
      </div>

      {/* Split layout: lg and up */}
      <div className="hidden lg:block h-[calc(100vh-180px)] px-2 sm:px-3 lg:px-4">
        <PanelGroup
          direction="horizontal"
          autoSaveId="analyze-split"
          className="h-full"
        >
          <Panel defaultSize={55} minSize={30} className="overflow-y-auto pr-2">
            {analyzer}
          </Panel>
          <PanelResizeHandle className="group relative w-2 flex items-center justify-center cursor-col-resize">
            <span
              aria-hidden
              className="block h-full w-px bg-border/40 transition-colors group-hover:bg-violet-400/60 group-data-[resize-handle-active]:bg-violet-400/60"
            />
          </PanelResizeHandle>
          <Panel defaultSize={45} minSize={30} className="overflow-y-auto pl-2">
            {deck}
          </Panel>
        </PanelGroup>
      </div>
    </>
  );
}
```

Notes:
- `h-[calc(100vh-180px)]` reserves room for the global header (~56–64px) plus the `CommanderStrip` (~80–100px) plus page padding. Tune this constant in Task 5 once you can see the rendered layout.
- The library applies the attribute `data-resize-handle-active` while dragging — the Tailwind arbitrary `data-[resize-handle-active]:` selector targets it for the violet highlight.
- The `lg:hidden` / `hidden lg:block` pair is the simplest way to guarantee the resizable layout never runs at narrow widths (the library would try to apply its sizing math otherwise).

- [ ] **Step 2: Type-check**

Run:
```bash
npx tsc --noEmit
```

Expected: no errors related to `AnalyzeSplit.tsx`.

- [ ] **Step 3: Commit**

```bash
git add src/components/analyze/AnalyzeSplit.tsx
git commit -m "feat(analyze): AnalyzeSplit component for resizable two-column layout"
```

---

### Task 3: Wire AnalyzeSplit into AnalyzePage

**Files:**
- Modify: `src/pages/AnalyzePage.tsx`

- [ ] **Step 1: Import AnalyzeSplit**

Open `src/pages/AnalyzePage.tsx`. Just below the existing `import { DeckBuildingArea } from '@/components/analyze/DeckBuildingArea';` line, add:

```ts
import { AnalyzeSplit } from '@/components/analyze/AnalyzeSplit';
```

- [ ] **Step 2: Replace the stacked render block with AnalyzeSplit**

In the `if (deckLoaded) { ... }` branch, locate this block (around the end of the `return`):

```tsx
{generatedDeck.commander && (
  <>
    {!optimizeViewActive && (
      <DeckBuildingArea
        currentCards={Object.values(generatedDeck.categories).flat()}
        excludeNames={(() => {
          const s = new Set<string>();
          if (generatedDeck.commander) s.add(generatedDeck.commander.name);
          if (generatedDeck.partnerCommander) s.add(generatedDeck.partnerCommander.name);
          return s;
        })()}
        highlightRoles={activeAnalyzerTab === 'roles'}
        activeRole={activeAnalyzerTab === 'roles' ? activeOptimizerRole : null}
      />
    )}
    <DeckOptimizer
      commanderName={generatedDeck.commander.name}
      partnerCommanderName={generatedDeck.partnerCommander?.name}
      currentCards={Object.values(generatedDeck.categories).flat()}
      deckSize={analyzerDeckSize}
      roleCounts={generatedDeck.roleCounts || {}}
      roleTargets={generatedDeck.roleTargets || {}}
      categories={generatedDeck.categories}
      cardInclusionMap={generatedDeck.cardInclusionMap}
      activeTab={activeAnalyzerTab}
      onTabChange={handleAnalyzerTabChange}
      onAddCards={handleAddCardsToAnalyzerDeck}
      onRemoveCards={handleRemoveCardsFromAnalyzerDeck}
    />
  </>
)}
```

Replace it with:

```tsx
{generatedDeck.commander && (
  <AnalyzeSplit
    analyzer={
      <DeckOptimizer
        commanderName={generatedDeck.commander.name}
        partnerCommanderName={generatedDeck.partnerCommander?.name}
        currentCards={Object.values(generatedDeck.categories).flat()}
        deckSize={analyzerDeckSize}
        roleCounts={generatedDeck.roleCounts || {}}
        roleTargets={generatedDeck.roleTargets || {}}
        categories={generatedDeck.categories}
        cardInclusionMap={generatedDeck.cardInclusionMap}
        activeTab={activeAnalyzerTab}
        onTabChange={handleAnalyzerTabChange}
        onAddCards={handleAddCardsToAnalyzerDeck}
        onRemoveCards={handleRemoveCardsFromAnalyzerDeck}
      />
    }
    deck={
      <DeckBuildingArea
        currentCards={Object.values(generatedDeck.categories).flat()}
        excludeNames={(() => {
          const s = new Set<string>();
          if (generatedDeck.commander) s.add(generatedDeck.commander.name);
          if (generatedDeck.partnerCommander) s.add(generatedDeck.partnerCommander.name);
          return s;
        })()}
        highlightRoles={activeAnalyzerTab === 'roles'}
        activeRole={activeAnalyzerTab === 'roles' ? activeOptimizerRole : null}
      />
    }
  />
)}
```

Two things changed:
1. `DeckBuildingArea` is no longer gated on `!optimizeViewActive` — both panes stay visible.
2. The `<>` fragment is replaced with the `<AnalyzeSplit>` wrapper.

The `optimizeViewActive` state and its `useEffect` listener stay intact (they still drive `activeOptimizerRole` for role highlighting on the deck pane).

- [ ] **Step 3: Type-check**

Run:
```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Lint**

Run:
```bash
npm run lint
```

Expected: no new lint errors in `AnalyzePage.tsx` or `AnalyzeSplit.tsx`.

- [ ] **Step 5: Commit**

```bash
git add src/pages/AnalyzePage.tsx
git commit -m "feat(analyze): use AnalyzeSplit for two-column loaded-deck view"
```

---

### Task 4: Manual verification — split layout & resize

**Files:** none (browser testing)

- [ ] **Step 1: Start dev server**

Run:
```bash
npm run dev
```

- [ ] **Step 2: Verify split layout at desktop width**

1. Open the app in a browser at ≥1280px width.
2. Navigate to `/analyze` and load any deck (use the Lists lane or paste a quick list).
3. Confirm: analyzer (Overview / Roles / Mana tabs) renders on the **left**, deck (cards, toolbar) renders on the **right**, with a thin vertical divider between them.

If the divider is missing or the deck wraps under the analyzer at ≥1024px, return to Task 2 Step 1 and check the `lg:hidden` / `hidden lg:block` classes.

- [ ] **Step 3: Verify drag resize**

1. Hover the divider — cursor should change to `col-resize` and the divider should brighten to violet.
2. Drag the divider left and right. Both panes should resize smoothly.
3. Try to drag past the 30% minimum on either side — the panes should stop resizing rather than collapse.

- [ ] **Step 4: Verify persistence**

1. Drag the divider to roughly 70% / 30%.
2. Reload the page.
3. The divider should restore to the dragged position (saved under `react-resizable-panels:analyze-split` in localStorage).

- [ ] **Step 5: Verify independent scroll**

1. With a long deck loaded, scroll the right (deck) pane.
2. The left pane and its tab bar should remain anchored — only the deck list moves.
3. Switch to the Roles tab on the left; scroll the analyzer content. The deck on the right should remain anchored.

- [ ] **Step 6: Verify Optimize Deck no longer hides the deck**

1. With a deck loaded, click the **Optimize Deck** CTA on the Overview tab.
2. The optimize view should render in the **left pane only**. The deck pane on the right should remain visible (this is the behavior change from the spec).
3. Click whatever the optimizer's "back" / close affordance is to exit; both panes should return to normal.

- [ ] **Step 7: Verify Roles highlighting still works**

1. Click the **Roles** tab on the left.
2. Hover or click a role in the analyzer.
3. The right (deck) pane should highlight matching cards as it did before — the cross-pane `activeOptimizerRole` plumbing must still flow through.

- [ ] **Step 8: Verify mobile/tablet fallback**

1. In devtools, resize the viewport to 900px (below `lg=1024px`).
2. Layout should switch to the stacked column — deck on top, analyzer below — with no divider visible.
3. Resize back above 1024px; the split returns.

- [ ] **Step 9: Tune the height calc if needed**

If at desktop width either pane shows a double scrollbar (page scroll + pane scroll) or the panes get clipped above the bottom-nav area:

1. Open `src/components/analyze/AnalyzeSplit.tsx`.
2. Adjust the `h-[calc(100vh-180px)]` value — increase if clipped, decrease if there's empty space below.
3. Reload and re-verify.

- [ ] **Step 10: Commit any tuning changes**

If you tuned the height in Step 9:

```bash
git add src/components/analyze/AnalyzeSplit.tsx
git commit -m "fix(analyze): tune split pane viewport height"
```

If nothing changed, skip this step.

---

### Task 5: Final build verification

**Files:** none

- [ ] **Step 1: Production build**

Run:
```bash
npm run build
```

Expected: build succeeds, no TS errors, no new warnings from `AnalyzeSplit.tsx` or `AnalyzePage.tsx`.

- [ ] **Step 2: Smoke-test the production preview**

Run:
```bash
npm run preview
```

Open the printed URL, navigate to `/analyze`, load a deck, and re-confirm the desktop split renders correctly and the divider persists across a reload.

- [ ] **Step 3: Bump version**

Use the `bump-version` skill (or update `package.json` `version` from `1.2.27` → `1.2.28` manually) and add a user-facing patch note to `src/data/patchNotes.json`:

```json
{
  "version": "1.2.28",
  "notes": [
    "Analyze page now uses a side-by-side layout on wider screens with a draggable divider between the analyzer and the deck."
  ]
}
```

- [ ] **Step 4: Commit version bump**

```bash
git add package.json src/data/patchNotes.json
git commit -m "chore: bump version 1.2.28 — analyze split layout"
```

---

## Self-Review Notes

- **Spec coverage:** every requirement in the spec maps to a task — install (Task 1), split layout (Task 2), wiring + behavior change (Task 3), manual verification of all success criteria (Task 4), build verification + version bump (Task 5).
- **No placeholders:** all code blocks contain complete contents; no "TBD" or "fill in later".
- **Type consistency:** `AnalyzeSplit` props (`analyzer`, `deck`) are referenced consistently in Task 2 (definition) and Task 3 (usage).
- **Known tuning point:** the `h-[calc(100vh-180px)]` constant is an estimate; Task 4 Step 9 covers tuning it once the layout is visible.
