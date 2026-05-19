# Analyze Page — Design Spec

**Date:** 2026-05-19
**Status:** Approved, ready for implementation plan
**Version target:** 1.3.0 (minor — meaningful new surface)

## Summary

A new top-level page at `/analyze` that gives the existing `DeckOptimizer` component a dedicated home, repositioning ManaFoundry from "deck generator with analysis tacked on" to "deck workshop where you can generate *or* analyze." Today's inline analyzer (EA-gated, mounted at the bottom of `ListDeckView` and `BuilderPage`) is retired in favor of routing both flows into `/analyze`.

The page is a multi-source hub: users paste a decklist, pick from My Lists, or generate a fresh deck. Once a deck loads, the analyzer takes the full viewport width with a thin commander strip on top.

## Goals

1. Attract new users who arrive specifically to analyze an existing deck (no generation intent).
2. Give generated-deck users a deeper-feeling place to explore "why these choices were made."
3. Give the analyzer the room it needs — full-width, full-stage — instead of the cramped EA strip at the bottom of other pages.
4. Graduate the deck analyzer from EA to GA.

## Non-goals

- No internal changes to the `DeckOptimizer` component itself. This is purely relocation + a new on-ramp.
- No shareable analysis URLs (`/analyze/shared/<hash>`).
- No URL-based deck import (Moxfield / Archidekt URL fetching). Paste-only.
- No "compare two decks" mode.
- No mobile-specific analyzer redesign — uses existing responsive treatment.

## Navigation & identity

- New navbar order, **both desktop header and mobile bottom-tab:** `Generate · Analyze · Lists · Collection`.
- Mobile bottom-tab icon for Analyze: Lucide `Microscope`.
- Page route: `/analyze` (no path params for the common case; see "State handoff" for query params used by the bridge flows).
- The site tagline ("Generate, analyze, and optimize Commander decks instantly") stays — both verbs now have a home.
- The clickable logo continues to reset state and navigate to Generate (`/`).
- `/analyze` is **GA**, not EA-gated. The `ea-features-enabled` flag continues to govern other experimental features but no longer controls visibility of the deck analyzer.

## Empty (pre-load) state

When the page has no deck loaded:

- **Hero**
  - Title: "Analyze any Commander deck"
  - Subtitle: "See what's strong, what's missing, and why."
  - No commander-art background (there's no commander yet). Solid `bg-background` with the standard gradient treatment.
- **Three pill tabs** (a single tab is active at a time; content swaps below):
  - **Paste** (default on first visit; last-active lane persists in `localStorage` under key `analyze-active-lane`)
  - **My Lists**
  - **Generate**
- Pills use `role="tablist"` / `role="tab"` / `role="tabpanel"` ARIA semantics. `←/→` cycles tabs; `Enter` activates the lane's primary action when its content is focused.
- **"What we'll show you" strip** below the active lane: five small cards — Overview · Roles · Mana · Tempo · Bracket — each with a one-line description and the same color/icon treatment as the corresponding analyzer tab. This strip is hidden once a deck loads.

### Paste lane (default)

- Large textarea with placeholder: "Paste a decklist from Moxfield, Archidekt, or anywhere else…"
- Reuses the existing `CollectionImporter` text parser. The parser already handles common decklist formats and the `*CMDR*` marker.
- Primary button: "Analyze →" (disabled until input is non-empty AND a commander has been resolved).
- **Commander resolution flow** (after parse):
  1. If the parser found a `*CMDR*` marker → use that card as the commander.
  2. Else, detect legendaries in the parsed list. If exactly one → auto-select it as commander.
  3. Else, show a small commander picker filtered to the detected legendaries (same pattern as `ListCreateEditForm` legendary dropdown).
  4. If no legendaries detected → fall back to a Scryfall-autocomplete commander search input. Hint copy: "We couldn't find a commander in this list — pick one to analyze."
- The "Analyze →" button shows a spinner during parse → commander detection → tagger enrich → analyzer init. Total expected wall time: 2-4 sec on typical decks.

### My Lists lane

- A compact, scrollable grid of the user's saved lists from `useUserLists()`, filtered to lists with a defined `commanderName`.
- Reuses `ListCard` (the existing component) in a denser layout — same card art, name, commander, color identity.
- Click a list → loads it into the analyzer **ephemerally on this page** (does NOT navigate to `/lists/:id/deck-view`). Internally we hydrate via the same path `ListDeckView` uses today (enrich cards through tagger + Scryfall, compute role counts).
- Empty state: "No saved lists yet — paste a deck above, or generate one and come back."

### Generate lane

- Minimal: a commander search input (Scryfall autocomplete, same component as on `HomePage`) + button "Generate & Analyze".
- Clicking the button navigates to `/build/:commanderName?returnTo=analyze`. The deep configuration UI (themes, bracket, customization) stays on `BuilderPage` — **we do not duplicate it on `/analyze`**.
- After the user generates the deck on `BuilderPage`, the post-gen CTA (see "Generate → Analyze bridge") brings them back to `/analyze` with the deck pre-loaded.

## Deck-loaded state

When a deck is loaded into the analyzer (via any of the three lanes, or via the bridge):

- **Commander strip** (container-width, ~80px tall):
  - Small commander art (~64×64, cropped to art_crop or normal), commander name, color identity, total card count.
  - **Source pill** with one of three labels:
    - `Pasted`
    - `From "<list name>"` (linking back to the list view)
    - `Generated`
  - **"Save to My Lists" button:**
    - Shown for `Pasted` and `Generated` sources.
    - Hidden for `From <list>` (already saved).
    - For `Pasted`: opens a small inline name field (default: empty, required).
    - For `Generated`: defaults the save name to `<Commander> — Analyzed YYYY-MM-DD`. User can edit before confirming.
    - On save, creates a new entry via `useUserLists().createList` (or equivalent) and updates the source pill to `From "<saved name>"`.
  - **"← Analyze a different deck"** link:
    - Returns the page to the empty hub state.
    - If the current deck is ephemeral (pasted, unsaved), confirms first: "Discard this analysis? You haven't saved it." Saved/generated decks navigate back without prompt.
  - Commander art fades in as the page-level background using the existing `CommanderBackground` component from `App.tsx`.
- **Analyzer:** the existing `DeckOptimizer` component, rendered **full-width** (the `<main>` on `/analyze` opts out of `container mx-auto` and uses `px-4 sm:px-8 lg:px-12` so the viewport is filled to the page chrome). The 5-tab UI inside is unchanged.

### Partial / incomplete decks

- Any card count is analyzable. The existing `DeckOptimizer` already surfaces a deck-excess/shortfall indicator — we don't add new gating.
- No commander → `Analyze` button stays disabled with the hint copy above.

## Generate → Analyze bridge

The inline analyzer mounted today at the bottom of `ListDeckView` and (any parallel mount in) `BuilderPage` is retired. Both flows now route into `/analyze`.

### From BuilderPage (post-generation)

- After `generatedDeck` is set in the Zustand store, a new prominent CTA appears near the existing Export / Save actions: **"Analyze this deck"** with a Lucide `Microscope` icon.
- Clicking navigates to `/analyze`. On mount, `/analyze` reads `generatedDeck` from the Zustand store and hydrates the analyzer (no URL param needed — the store carries `roleCounts`, `roleTargets`, `cardInclusionMap`, themes, etc).
- The source pill on `/analyze` reads `Generated`. The "Save to My Lists" button is offered.

### From ListDeckView (opened saved list)

- The list-view toolbar gets the same **"Analyze this deck"** button.
- Clicking navigates to `/analyze?listId=<id>`. On mount, `/analyze` hydrates the list the same way `ListDeckView` does today.
- The source pill on `/analyze` reads `From "<list name>"` with a small link back to the list view. No "Save" button (already saved).

### State handoff summary

| Source | How `/analyze` finds the deck | URL |
|---|---|---|
| Paste | Local component state on `/analyze` | `/analyze` |
| My Lists lane (clicked on page) | Local component state on `/analyze`, hydrated from `getListById(id)` | `/analyze` |
| List view bridge | Query param + `getListById(id)` | `/analyze?listId=<id>` |
| BuilderPage bridge | Zustand `generatedDeck` | `/analyze` |
| Direct navigation with no state | Empty hub | `/analyze` |

If the user reaches `/analyze` directly (e.g. typed URL, link from elsewhere) with no Zustand `generatedDeck` and no `listId` param, the empty hub renders.

## Files affected

**New:**
- `src/pages/AnalyzePage.tsx` — the new page component (hub + loaded states).
- Possibly `src/components/analyze/PasteLane.tsx`, `src/components/analyze/ListsLane.tsx`, `src/components/analyze/GenerateLane.tsx`, `src/components/analyze/CommanderStrip.tsx`, `src/components/analyze/WhatYoullSeeStrip.tsx` if the page splits cleanly that way (final structure to be decided in the implementation plan).

**Modified:**
- `src/App.tsx`:
  - Add `<Route path="/analyze" element={...} />`.
  - Add Analyze to navbar (desktop header + mobile bottom-tab), reordered to `Generate · Analyze · Lists · Collection`.
- `src/pages/BuilderPage.tsx`:
  - Remove the EA-gated inline `<DeckOptimizer>` mount.
  - Add the "Analyze this deck" CTA after `generatedDeck` is set.
- `src/components/lists/ListDeckView.tsx`:
  - Remove the EA-gated inline `<DeckOptimizer>` mount at lines ~1429-1453.
  - Add the "Analyze this deck" CTA in the toolbar.
- `src/data/patchNotes.json` — new entry for 1.3.0.
- `package.json` — version bump to `1.3.0`.

**Unchanged:**
- `src/components/deck/optimizer/*` — the analyzer's internals are not modified.
- `src/services/deckBuilder/deckAnalyzer.ts` — unchanged.

## Analytics events

All via the existing `trackEvent` system:

- `analyze_page_viewed` — fires on page mount. Props: `{ source: 'direct' | 'from_generate' | 'from_list' }`. (`from_generate` / `from_list` inferred from the presence of Zustand state or `?listId`.)
- `analyze_deck_loaded` — fires when a deck enters the analyzer. Props: `{ source: 'paste' | 'list' | 'generated', cardCount, hasCommander }`.
- `analyze_deck_saved` — fires when a pasted (or generated, on this page) deck is saved to My Lists.
- `analyze_lane_switched` — fires when the user clicks a different pill tab. Props: `{ from, to }`.
- The existing `deck_analyzed` event continues to fire from inside `DeckOptimizer` — implicitly attributable to `/analyze` via the `page_viewed` event already on the route.

## Copy

| Surface | Copy |
|---|---|
| Page title (empty state) | "Analyze any Commander deck" |
| Subtitle | "See what's strong, what's missing, and why." |
| Paste textarea placeholder | "Paste a decklist from Moxfield, Archidekt, or anywhere else…" |
| Paste button (resolved) | "Analyze →" |
| Paste button (no commander) | "Pick a commander to analyze this list" (disabled) |
| My Lists empty | "No saved lists yet. Paste a deck above, or build one and come back." |
| Generate lane button | "Generate & Analyze" |
| Source pill — pasted | "Pasted" |
| Source pill — list | `From "<list name>"` |
| Source pill — generated | "Generated" |
| Bridge CTA (Builder + ListDeckView) | "Analyze this deck" (Lucide `Microscope` icon) |
| Discard confirmation | "Discard this analysis? You haven't saved it." |
| Save default name (generated) | `<Commander> — Analyzed YYYY-MM-DD` |
| What we'll show pillars | Overview · Roles · Mana · Tempo · Bracket |
| Patch notes (1.3.0) | "New Analyze page — paste, pick, or generate a deck to inspect its roles, mana, curve, and bracket." |

## Accessibility

- Pill tabs use `role="tablist"` / `role="tab"` / `role="tabpanel"`.
- `←/→` cycles tabs; `Enter` activates the lane's primary action when its content is focused.
- Commander strip is `role="region" aria-label="Currently analyzing"`.
- All buttons reachable by keyboard with visible focus rings (existing Tailwind treatment).

## Out of scope (parking lot for future work)

- Shareable analysis URLs (`/analyze/shared/<hash>` with serialized deck).
- URL-based imports from Moxfield / Archidekt / MTGGoldfish (vs. pasting text).
- "Compare two decks" mode.
- Analyzer internal improvements.
- Mobile-specific analyzer redesign.

## Open questions

None at spec time. All structural decisions resolved during brainstorming.
