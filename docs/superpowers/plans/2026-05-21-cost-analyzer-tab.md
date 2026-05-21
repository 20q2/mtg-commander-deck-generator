# Cost Analyzer Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new "Cost" tab to the Deck Optimizer that helps users convert a deck to a budget target by suggesting role-equivalent cheaper alternatives, with an interactive plan-builder slider.

**Architecture:** Pure-function cost analyzer (`costAnalyzer.ts`) builds a sorted, role-grouped list of swap suggestions from `analysis.recommendations` (always available) and/or `deck.swapCandidates` (generated decks only). A new `CostTab.tsx` renders the budget slider, controls, swap rows, and protected section. Plan state lives in the tab; applying the plan delegates to the existing `onAddCards` + `onRemoveCards` callbacks the optimizer already accepts.

**Tech Stack:** React 18 + TypeScript, Tailwind, shadcn/ui (`<Slider>`, `<Button>`, `<Badge>`, `<Input>`, `<Card>`), lucide-react icons. No automated test framework exists in this repo — verification is via `npm run build` (TypeScript checks) plus manual browser QA on the dev server.

**Testing strategy:** Each implementation task ends with `npm run build` (must pass with no errors) and, where UI is touched, a short manual QA pass on the dev server. There is no Vitest/Jest in this project; do not add one.

---

## File Structure

**New files:**
- `src/services/deckBuilder/costAnalyzer.ts` — pure functions: `buildCostPlan`, `pickCheapestAlternative`, `classifyConfidence`, `autoCheckToTarget`, plus shared types.
- `src/components/deck/optimizer/CostTab.tsx` — top-level tab component (budget header, controls, lists, protected section, apply handler).
- `src/components/deck/optimizer/CostTab.SwapRow.tsx` — single swap row (checkbox, current → suggestion, savings, confidence chip, inclusion delta). Co-located file (not a folder) to match the rest of the optimizer directory.

**Modified files:**
- `src/components/deck/optimizer/constants.ts` — extend `TabKey`, push `Cost` into `TABS`, add slug mappings.
- `src/components/deck/optimizer/DeckOptimizer.tsx` — render `<CostTab>` for the `cost` tab key, pass cached analysis + deck info + callbacks.

---

## Conventions

- Currency: use `useStore` to read the user's `currency` preference and call `getCardPrice(card, currency)` everywhere prices are read. Treat `null` as "price unknown" and skip the card from the suggestion list (not from totals — count it as $0 in the deck total).
- Money formatting: `formatPrice(n: number) => '$' + n.toFixed(2)` (USD); for EUR, use a leading `€`. Add a small helper in `costAnalyzer.ts` to keep this consistent.
- Confidence palette: Drop-in = `emerald`, Sidegrade = `amber`, Budget pick = `rose`. Use `<Badge>` variants or inline class strings to match existing role badges in `RolesTab`.
- Savings emphasis color: violet (`text-violet-300/80`) per memory ("lavender is the relevance/synergy accent").
- Reuse `scryfallImg(name, version)` from `constants.ts` for any image needs.
- Never use raw `<button>`; always `<Button>`. Same for `<Input>` and `<Slider>`.

---

### Task 1: Add `cost` to TabKey and TABS

**Files:**
- Modify: `src/components/deck/optimizer/constants.ts`

- [ ] **Step 1: Add the DollarSign import**

In `src/components/deck/optimizer/constants.ts`, add `DollarSign` to the existing lucide-react import block (lines 1–5):

```ts
import {
  Sparkles, Sprout, Swords, Flame, BookOpen, Shield,
  LayoutDashboard, Mountain, BarChart3, Zap, Target, Crown,
  MapPin, Clock, Gauge, DollarSign,
} from 'lucide-react';
```

- [ ] **Step 2: Extend `TabKey`, `TABS`, and the slug maps**

Replace lines 40–66 with:

```ts
export type TabKey = 'overview' | 'roles' | 'lands' | 'curve' | 'bracket' | 'cost';

export const TABS: { key: TabKey; label: string; icon: typeof LayoutDashboard }[] = [
  { key: 'overview', label: 'Overview', icon: LayoutDashboard },
  { key: 'roles',    label: 'Roles',    icon: Shield as typeof LayoutDashboard },
  { key: 'lands',    label: 'Mana',     icon: Mountain as typeof LayoutDashboard },
  { key: 'curve',    label: 'Tempo',    icon: BarChart3 as typeof LayoutDashboard },
  { key: 'bracket',  label: 'Bracket',  icon: Gauge as typeof LayoutDashboard },
  { key: 'cost',     label: 'Cost',     icon: DollarSign as typeof LayoutDashboard },
];

export const TAB_SLUG_BY_KEY: Record<TabKey, string> = {
  overview: 'overview',
  roles:    'roles',
  lands:    'mana',
  curve:    'tempo',
  bracket:  'bracket',
  cost:     'cost',
};

export const TAB_KEY_BY_SLUG: Record<string, TabKey> = {
  overview: 'overview',
  roles:    'roles',
  mana:     'lands',
  tempo:    'curve',
  bracket:  'bracket',
  cost:     'cost',
};
```

- [ ] **Step 3: Verify the build**

Run: `npm run build`
Expected: succeeds with no TypeScript errors. (DeckOptimizer's tab-switch may now show an exhaustiveness warning for the `cost` case — that's fine, it will be handled in Task 7. If TS errors with "not assignable" on a `TabKey` switch, take note of the file/line for Task 7.)

- [ ] **Step 4: Commit**

```bash
git add src/components/deck/optimizer/constants.ts
git commit -m "feat(optimizer): add cost tab key and metadata"
```

---

### Task 2: Shared types and helpers in `costAnalyzer.ts`

**Files:**
- Create: `src/services/deckBuilder/costAnalyzer.ts`

- [ ] **Step 1: Create the file with shared types and `formatPrice`**

```ts
// src/services/deckBuilder/costAnalyzer.ts
import type { ScryfallCard } from '@/types';
import type { RecommendedCard } from './deckAnalyzer';

export type Confidence = 'drop-in' | 'sidegrade' | 'budget';

export interface SwapSuggestion {
  /** Replacement card name (always a string; image/cmc looked up via Scryfall cache). */
  name: string;
  /** Price in selected currency. Null if unknown (suggestion will not be offered). */
  price: number;
  /** EDHREC inclusion 0..100 for the suggestion. May be 0 if unknown. */
  inclusion: number;
  cmc?: number;
}

export interface SwapRow {
  /** Stable id used as a React key and in the checkedSet. */
  id: string;
  /** The card currently in the deck. */
  current: ScryfallCard;
  currentPrice: number;
  currentInclusion: number; // 0 if unknown
  /** The suggested replacement. */
  suggestion: SwapSuggestion;
  savings: number; // currentPrice - suggestion.price (always > 0)
  confidence: Confidence;
  category: 'spell' | 'land';
}

export interface CostPlan {
  /** Total of all non-basic-land card prices currently in the deck (basics ≈ $0.05). */
  currentTotal: number;
  /** Min reachable total assuming every row is swapped. */
  minTotal: number;
  spellRows: SwapRow[];
  landRows: SwapRow[];
  /** Cards intentionally excluded from suggestions, shown to the user for transparency. */
  protected: { name: string; reason: 'commander' | 'must-include' | 'basic-land' | 'no-price' }[];
}

export interface BuildCostPlanOptions {
  /** Names of cards locked in (must-include). */
  mustIncludeNames: Set<string>;
  /** Names already on sideboard/maybeboard — suggestions must not duplicate these. */
  excludeFromSuggestions: Set<string>;
  /** Currency code, passed through to price formatting display layer. */
  currency: 'USD' | 'EUR';
}

const CURRENCY_PREFIX: Record<'USD' | 'EUR', string> = { USD: '$', EUR: '€' };

export function formatPrice(amount: number, currency: 'USD' | 'EUR' = 'USD'): string {
  return `${CURRENCY_PREFIX[currency]}${amount.toFixed(2)}`;
}

/** Parse a Scryfall price string ("12.34") into a number, or null if missing/invalid. */
export function parsePrice(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}
```

- [ ] **Step 2: Run the build**

Run: `npm run build`
Expected: succeeds. The file is exported types + helpers only; no consumers yet.

- [ ] **Step 3: Commit**

```bash
git add src/services/deckBuilder/costAnalyzer.ts
git commit -m "feat(cost): scaffold costAnalyzer types and price helpers"
```

---

### Task 3: `classifyConfidence` function

**Files:**
- Modify: `src/services/deckBuilder/costAnalyzer.ts`

- [ ] **Step 1: Append `classifyConfidence` to costAnalyzer.ts**

Add at the bottom of the file:

```ts
const DROP_IN_INCLUSION_BAND = 15;   // percentage points
const SIDEGRADE_INCLUSION_BAND = 35;
const DROP_IN_CMC_BAND = 1;

/**
 * Classify a swap suggestion by how close it is to the card it replaces.
 * - drop-in: very close (CMC ±1 AND inclusion within 15pts AND same role implied by caller)
 * - sidegrade: still same role, but CMC or inclusion delta is noticeable
 * - budget: same role but inclusion gap is large (or unknown)
 *
 * Same-role is assumed — caller must pre-filter the candidate pool by role.
 */
export function classifyConfidence(
  currentInclusion: number,
  currentCmc: number | undefined,
  suggestion: SwapSuggestion,
): Confidence {
  const inclusionDelta = currentInclusion - suggestion.inclusion;
  const cmcDelta = currentCmc != null && suggestion.cmc != null
    ? Math.abs(currentCmc - suggestion.cmc)
    : Infinity;

  if (
    cmcDelta <= DROP_IN_CMC_BAND &&
    inclusionDelta <= DROP_IN_INCLUSION_BAND &&
    suggestion.inclusion > 0
  ) {
    return 'drop-in';
  }
  if (inclusionDelta <= SIDEGRADE_INCLUSION_BAND && suggestion.inclusion > 0) {
    return 'sidegrade';
  }
  return 'budget';
}
```

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/services/deckBuilder/costAnalyzer.ts
git commit -m "feat(cost): add classifyConfidence"
```

---

### Task 4: `pickCheapestAlternative` function

**Files:**
- Modify: `src/services/deckBuilder/costAnalyzer.ts`

- [ ] **Step 1: Append `pickCheapestAlternative`**

Add at the bottom of the file:

```ts
/**
 * From a role-matched candidate pool, return the cheapest candidate strictly cheaper
 * than `currentPrice` and not already in the deck or excluded.
 *
 * `pool` items must already share the role/category of the card being replaced —
 * this function does NOT enforce role match.
 */
export function pickCheapestAlternative(
  pool: RecommendedCard[],
  currentPrice: number,
  excludeNames: Set<string>,
): SwapSuggestion | null {
  let best: SwapSuggestion | null = null;
  for (const cand of pool) {
    if (excludeNames.has(cand.name)) continue;
    const price = parsePrice(cand.price);
    if (price == null) continue;
    if (price >= currentPrice) continue;
    if (best && price >= best.price) continue;
    best = {
      name: cand.name,
      price,
      inclusion: cand.inclusion ?? 0,
      cmc: cand.cmc,
    };
  }
  return best;
}
```

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/services/deckBuilder/costAnalyzer.ts
git commit -m "feat(cost): add pickCheapestAlternative"
```

---

### Task 5: `autoCheckToTarget` (greedy slider helper)

**Files:**
- Modify: `src/services/deckBuilder/costAnalyzer.ts`

- [ ] **Step 1: Append `autoCheckToTarget`**

```ts
const CONFIDENCE_RANK: Record<Confidence, number> = {
  'drop-in': 0,
  sidegrade: 1,
  budget: 2,
};

/**
 * Greedy plan-builder: from `rows`, pick a set of row ids whose cumulative savings
 * bring `currentTotal` to ≤ `target`. Iterates rows in confidence-then-savings order.
 *
 * Respects the `enabledConfidences` set (rows with disabled confidence are skipped).
 * Respects `manuallyExcluded` — those rows are never picked even if needed.
 *
 * If the target is unreachable, returns all eligible rows (best effort).
 */
export function autoCheckToTarget(
  rows: SwapRow[],
  currentTotal: number,
  target: number,
  enabledConfidences: Set<Confidence>,
  manuallyExcluded: Set<string>,
): Set<string> {
  const picked = new Set<string>();
  if (currentTotal <= target) return picked;

  const ordered = [...rows].sort((a, b) => {
    const c = CONFIDENCE_RANK[a.confidence] - CONFIDENCE_RANK[b.confidence];
    if (c !== 0) return c;
    return b.savings - a.savings;
  });

  let total = currentTotal;
  for (const row of ordered) {
    if (total <= target) break;
    if (!enabledConfidences.has(row.confidence)) continue;
    if (manuallyExcluded.has(row.id)) continue;
    picked.add(row.id);
    total -= row.savings;
  }
  return picked;
}
```

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/services/deckBuilder/costAnalyzer.ts
git commit -m "feat(cost): add autoCheckToTarget greedy planner"
```

---

### Task 6: `buildCostPlan` (the main composer)

**Files:**
- Modify: `src/services/deckBuilder/costAnalyzer.ts`

- [ ] **Step 1: Append imports and the main function**

At the top of `costAnalyzer.ts`, extend the imports:

```ts
import type { ScryfallCard } from '@/types';
import type { RecommendedCard, DeckAnalysis } from './deckAnalyzer';
import { isAnyLand, BASIC_LAND_NAMES, getCardPrice } from '@/services/scryfall/client';
```

(Add `BASIC_LAND_NAMES` and `getCardPrice` to the existing scryfall imports — it likely needs verification at usage time that `BASIC_LAND_NAMES` is exported. If it's not, fall back to a local set: `new Set(['Plains','Island','Swamp','Mountain','Forest','Wastes'])`.)

At the bottom of the file:

```ts
/**
 * Build the full cost-analysis plan for a deck.
 *
 * Candidate pools:
 *  - Spells: `analysis.recommendations` grouped by role (or by primary type when role is missing).
 *  - Lands: lands from `analysis.recommendations` whose `primaryType` includes 'Land'.
 *
 * Always uses `analysis.recommendations` so this works for both generated and pasted decks.
 * (Generated decks also have `deck.swapCandidates` but the recommendations pool is a
 *  strict superset of useful candidates and is always present alongside analysis.)
 */
export function buildCostPlan(
  cards: ScryfallCard[],
  commanderName: string,
  partnerCommanderName: string | undefined,
  analysis: DeckAnalysis,
  opts: BuildCostPlanOptions,
): CostPlan {
  const localBasics = new Set(['Plains','Island','Swamp','Mountain','Forest','Wastes']);
  const isBasic = (name: string) => (BASIC_LAND_NAMES ?? localBasics).has(name);

  // ── Index candidates by role and as a flat land pool ──
  const byRole = new Map<string, RecommendedCard[]>();
  const landPool: RecommendedCard[] = [];
  for (const rec of analysis.recommendations) {
    const isLand = (rec.primaryType ?? '').includes('Land');
    if (isLand) landPool.push(rec);
    const key = rec.role ?? `type:${(rec.primaryType ?? 'other').toLowerCase()}`;
    if (!byRole.has(key)) byRole.set(key, []);
    byRole.get(key)!.push(rec);
  }

  // Names currently in deck — never suggest a card already in the deck
  const inDeckNames = new Set(cards.map(c => c.name));

  const spellRows: SwapRow[] = [];
  const landRows: SwapRow[] = [];
  const protectedList: CostPlan['protected'] = [];

  let currentTotal = 0;

  for (const card of cards) {
    const priceRaw = getCardPrice(card, opts.currency);
    const price = parsePrice(priceRaw);
    if (price != null) currentTotal += price;

    // ── Protected: commander, partner, must-include, basic land ──
    if (card.name === commanderName) {
      protectedList.push({ name: card.name, reason: 'commander' });
      continue;
    }
    if (partnerCommanderName && card.name === partnerCommanderName) {
      protectedList.push({ name: card.name, reason: 'commander' });
      continue;
    }
    if (opts.mustIncludeNames.has(card.name)) {
      protectedList.push({ name: card.name, reason: 'must-include' });
      continue;
    }
    if (isBasic(card.name)) {
      protectedList.push({ name: card.name, reason: 'basic-land' });
      continue;
    }
    if (price == null) {
      protectedList.push({ name: card.name, reason: 'no-price' });
      continue;
    }

    // ── Pick candidate pool ──
    const exclude = new Set<string>([
      card.name,
      ...inDeckNames,
      ...opts.excludeFromSuggestions,
    ]);
    const isLand = isAnyLand(card);
    const pool = isLand
      ? landPool
      : (card.deckRole ? (byRole.get(card.deckRole) ?? []) : []);

    const suggestion = pickCheapestAlternative(pool, price, exclude);
    if (!suggestion) continue;

    const currentInclusion = analysis.recommendations.find(r => r.name === card.name)?.inclusion ?? 0;
    const confidence = classifyConfidence(currentInclusion, card.cmc, suggestion);

    const row: SwapRow = {
      id: card.name,
      current: card,
      currentPrice: price,
      currentInclusion,
      suggestion,
      savings: price - suggestion.price,
      confidence,
      category: isLand ? 'land' : 'spell',
    };
    if (isLand) landRows.push(row);
    else spellRows.push(row);
  }

  // Min reachable: apply every row's savings
  const allSavings = [...spellRows, ...landRows].reduce((s, r) => s + r.savings, 0);
  const minTotal = Math.max(0, currentTotal - allSavings);

  // Default sort within each section: confidence then savings desc (matches autoCheck order)
  const sortRows = (rs: SwapRow[]) => rs.sort((a, b) => {
    const c = CONFIDENCE_RANK[a.confidence] - CONFIDENCE_RANK[b.confidence];
    return c !== 0 ? c : b.savings - a.savings;
  });
  sortRows(spellRows);
  sortRows(landRows);

  return { currentTotal, minTotal, spellRows, landRows, protected: protectedList };
}
```

- [ ] **Step 2: Verify `BASIC_LAND_NAMES` and `isAnyLand` are exported**

Run: `grep -n "export.*BASIC_LAND_NAMES\|export.*isAnyLand" src/services/scryfall/client.ts`
Expected: both names appear in `export` statements. If `BASIC_LAND_NAMES` is not exported, change the import to drop it (the local fallback set already covers it).

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: succeeds with no type errors.

- [ ] **Step 4: Commit**

```bash
git add src/services/deckBuilder/costAnalyzer.ts
git commit -m "feat(cost): add buildCostPlan composer"
```

---

### Task 7: SwapRow presentational component

**Files:**
- Create: `src/components/deck/optimizer/CostTab.SwapRow.tsx`

- [ ] **Step 1: Create the SwapRow file**

```tsx
// src/components/deck/optimizer/CostTab.SwapRow.tsx
import { ArrowRight } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { SwapRow as SwapRowData, Confidence } from '@/services/deckBuilder/costAnalyzer';
import { formatPrice } from '@/services/deckBuilder/costAnalyzer';
import { scryfallImg } from './constants';

const CONFIDENCE_STYLE: Record<Confidence, { label: string; cls: string }> = {
  'drop-in':  { label: 'Drop-in',     cls: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30' },
  sidegrade:  { label: 'Sidegrade',   cls: 'bg-amber-500/20 text-amber-300 border-amber-500/30' },
  budget:     { label: 'Budget pick', cls: 'bg-rose-500/20 text-rose-300 border-rose-500/30' },
};

interface Props {
  row: SwapRowData;
  checked: boolean;
  onToggle: (id: string) => void;
  onPreviewCurrent: (name: string) => void;
  onPreviewSuggestion: (name: string) => void;
  /** Cards above this price get a rose left border. 0/undefined disables. */
  flagOverPrice?: number;
  currency: 'USD' | 'EUR';
}

export function SwapRow({
  row, checked, onToggle, onPreviewCurrent, onPreviewSuggestion, flagOverPrice, currency,
}: Props) {
  const style = CONFIDENCE_STYLE[row.confidence];
  const flagged = flagOverPrice != null && flagOverPrice > 0 && row.currentPrice > flagOverPrice;
  const inclusionDelta = `${Math.round(row.currentInclusion)}% → ${Math.round(row.suggestion.inclusion)}%`;

  return (
    <div
      className={[
        'flex items-center gap-3 px-3 py-2 rounded border bg-zinc-900/40 hover:bg-zinc-900/70 transition-colors',
        flagged ? 'border-l-4 border-l-rose-500/60 border-zinc-800' : 'border-zinc-800',
      ].join(' ')}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={() => onToggle(row.id)}
        className="h-4 w-4 accent-violet-500"
        aria-label={`Swap ${row.current.name} for ${row.suggestion.name}`}
      />

      {/* Current */}
      <button
        type="button"
        onClick={() => onPreviewCurrent(row.current.name)}
        className="flex items-center gap-2 min-w-0 flex-1 text-left hover:text-violet-300"
      >
        <img src={scryfallImg(row.current.name, 'small')} alt="" className="h-8 w-6 rounded-sm object-cover flex-shrink-0" />
        <span className="truncate text-sm text-zinc-200">{row.current.name}</span>
        <span className="text-xs text-zinc-400 tabular-nums">{formatPrice(row.currentPrice, currency)}</span>
      </button>

      <ArrowRight className="h-4 w-4 text-zinc-500 flex-shrink-0" />

      {/* Suggestion */}
      <button
        type="button"
        onClick={() => onPreviewSuggestion(row.suggestion.name)}
        className="flex items-center gap-2 min-w-0 flex-1 text-left hover:text-violet-300"
      >
        <img src={scryfallImg(row.suggestion.name, 'small')} alt="" className="h-8 w-6 rounded-sm object-cover flex-shrink-0" />
        <span className="truncate text-sm text-zinc-200">{row.suggestion.name}</span>
        <span className="text-xs text-zinc-400 tabular-nums">{formatPrice(row.suggestion.price, currency)}</span>
      </button>

      {/* Trailing meta */}
      <div className="flex items-center gap-2 flex-shrink-0">
        <span className="text-sm font-semibold text-violet-300/80 tabular-nums">
          Save {formatPrice(row.savings, currency)}
        </span>
        <Badge className={`text-xs border ${style.cls}`}>{style.label}</Badge>
        <span className="text-xs text-zinc-500 tabular-nums hidden md:inline">{inclusionDelta}</span>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/components/deck/optimizer/CostTab.SwapRow.tsx
git commit -m "feat(cost): SwapRow presentational component"
```

---

### Task 8: CostTab top-level component (no apply yet)

**Files:**
- Create: `src/components/deck/optimizer/CostTab.tsx`

This task wires up rendering, the slider, the filter chips, the per-card flag input, the protected section, and live projected total. The actual Apply-plan action is the next task.

- [ ] **Step 1: Create the CostTab file**

```tsx
// src/components/deck/optimizer/CostTab.tsx
import { useMemo, useState, useCallback } from 'react';
import { Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';
import type { ScryfallCard } from '@/types';
import type { DeckAnalysis } from '@/services/deckBuilder/deckAnalyzer';
import {
  buildCostPlan, autoCheckToTarget, formatPrice,
  type Confidence, type CostPlan,
} from '@/services/deckBuilder/costAnalyzer';
import { useStore } from '@/store';
import { SwapRow } from './CostTab.SwapRow';

interface CostTabProps {
  commanderName: string;
  partnerCommanderName?: string;
  currentCards: ScryfallCard[];
  analysis: DeckAnalysis | null;
  sideboardNames: string[];
  maybeboardNames: string[];
  onPreviewCard: (name: string) => void;
  /** Apply the plan: remove old names, add new names. Handled by Task 9. */
  onApplyPlan?: (removeNames: string[], addNames: string[]) => void;
}

const ALL_CONFIDENCES: Confidence[] = ['drop-in', 'sidegrade', 'budget'];
const DEFAULT_ENABLED: Confidence[] = ['drop-in', 'sidegrade'];

export function CostTab({
  commanderName, partnerCommanderName, currentCards, analysis,
  sideboardNames, maybeboardNames, onPreviewCard, onApplyPlan,
}: CostTabProps) {
  const currency = useStore(s => s.currency);
  const mustIncludeCards = useStore(s => s.mustIncludeCards);

  // Build the plan whenever the deck or analysis changes
  const plan: CostPlan | null = useMemo(() => {
    if (!analysis) return null;
    return buildCostPlan(currentCards, commanderName, partnerCommanderName, analysis, {
      mustIncludeNames: new Set(mustIncludeCards),
      excludeFromSuggestions: new Set([...sideboardNames, ...maybeboardNames]),
      currency,
    });
  }, [currentCards, commanderName, partnerCommanderName, analysis, mustIncludeCards, sideboardNames, maybeboardNames, currency]);

  // ── Plan state ──
  const [enabled, setEnabled] = useState<Set<Confidence>>(new Set(DEFAULT_ENABLED));
  const [target, setTarget] = useState<number | null>(null); // null = no auto-pick yet
  const [flagOver, setFlagOver] = useState<string>(''); // raw input
  const [manuallyExcluded, setManuallyExcluded] = useState<Set<string>>(new Set());
  const [manuallyIncluded, setManuallyIncluded] = useState<Set<string>>(new Set());

  // Combined checked set: (auto-picked by slider) ∪ manuallyIncluded \ manuallyExcluded
  const allRows = useMemo(() => plan ? [...plan.spellRows, ...plan.landRows] : [], [plan]);
  const autoChecked = useMemo(() => {
    if (!plan || target == null) return new Set<string>();
    return autoCheckToTarget(allRows, plan.currentTotal, target, enabled, manuallyExcluded);
  }, [plan, target, allRows, enabled, manuallyExcluded]);

  const checked = useMemo(() => {
    const s = new Set(autoChecked);
    for (const id of manuallyIncluded) s.add(id);
    for (const id of manuallyExcluded) s.delete(id);
    return s;
  }, [autoChecked, manuallyIncluded, manuallyExcluded]);

  const projectedTotal = useMemo(() => {
    if (!plan) return 0;
    let t = plan.currentTotal;
    for (const row of allRows) if (checked.has(row.id)) t -= row.savings;
    return t;
  }, [plan, allRows, checked]);

  // ── Handlers ──
  const toggleRow = useCallback((id: string) => {
    const isChecked = checked.has(id);
    if (isChecked) {
      setManuallyExcluded(prev => { const n = new Set(prev); n.add(id); return n; });
      setManuallyIncluded(prev => { const n = new Set(prev); n.delete(id); return n; });
    } else {
      setManuallyIncluded(prev => { const n = new Set(prev); n.add(id); return n; });
      setManuallyExcluded(prev => { const n = new Set(prev); n.delete(id); return n; });
    }
  }, [checked]);

  const toggleConfidence = useCallback((c: Confidence) => {
    setEnabled(prev => {
      const n = new Set(prev);
      if (n.has(c)) n.delete(c); else n.add(c);
      return n;
    });
  }, []);

  const applyPlan = useCallback(() => {
    if (!plan || !onApplyPlan) return;
    const removeNames: string[] = [];
    const addNames: string[] = [];
    for (const row of allRows) {
      if (!checked.has(row.id)) continue;
      removeNames.push(row.current.name);
      addNames.push(row.suggestion.name);
    }
    if (removeNames.length === 0) return;
    onApplyPlan(removeNames, addNames);
    // Reset local plan state after apply — the deck will re-render and the plan rebuilds
    setManuallyExcluded(new Set());
    setManuallyIncluded(new Set());
    setTarget(null);
  }, [plan, onApplyPlan, allRows, checked]);

  // ── Render ──
  if (!analysis || !plan) {
    return <div className="p-6 text-sm text-zinc-400">Analyzing deck cost…</div>;
  }

  const flagOverNum = (() => {
    const n = Number(flagOver);
    return Number.isFinite(n) && n > 0 ? n : undefined;
  })();

  const sliderMin = Math.floor(plan.minTotal);
  const sliderMax = Math.ceil(plan.currentTotal);
  const sliderValue = target ?? plan.currentTotal;

  return (
    <TooltipProvider>
      <div className="flex flex-col gap-4 p-4">

        {/* ── Budget header ── */}
        <section className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4 flex flex-col gap-3">
          <div className="flex items-baseline gap-3 flex-wrap">
            <span className="text-sm text-zinc-400">Current</span>
            <span className="text-xl font-semibold text-zinc-100 tabular-nums">{formatPrice(plan.currentTotal, currency)}</span>
            <span className="text-zinc-600">→</span>
            <span className="text-sm text-zinc-400">Projected</span>
            <span className="text-xl font-semibold text-violet-300 tabular-nums">{formatPrice(projectedTotal, currency)}</span>
            <span className="text-sm text-violet-300/70 tabular-nums">
              (save {formatPrice(Math.max(0, plan.currentTotal - projectedTotal), currency)})
            </span>
          </div>

          <div className="flex items-center gap-3">
            <span className="text-xs text-zinc-500 tabular-nums w-16">{formatPrice(sliderMin, currency)}</span>
            <Slider
              min={sliderMin}
              max={sliderMax}
              step={1}
              value={[sliderValue]}
              onValueChange={(v) => setTarget(v[0])}
              className="flex-1"
              aria-label="Budget target"
            />
            <span className="text-xs text-zinc-500 tabular-nums w-16 text-right">{formatPrice(sliderMax, currency)}</span>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <label className="flex items-center gap-2 text-xs text-zinc-400">
              <span>Flag cards over</span>
              <Input
                type="number"
                min={0}
                step="0.5"
                value={flagOver}
                onChange={e => setFlagOver(e.target.value)}
                placeholder="off"
                className="h-7 w-20 text-xs"
              />
              <Tooltip>
                <TooltipTrigger asChild><Info className="h-3.5 w-3.5 text-zinc-500" /></TooltipTrigger>
                <TooltipContent>Visually highlights rows whose current card price exceeds this amount. Does not change which swaps are checked.</TooltipContent>
              </Tooltip>
            </label>

            <div className="ml-auto flex items-center gap-2">
              <Button
                onClick={applyPlan}
                disabled={checked.size === 0}
                className="btn-shimmer"
              >
                Apply plan ({checked.size} swap{checked.size === 1 ? '' : 's'}, save {formatPrice(Math.max(0, plan.currentTotal - projectedTotal), currency)})
              </Button>
            </div>
          </div>
        </section>

        {/* ── Filter chips ── */}
        <section className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-zinc-500">Show:</span>
          {ALL_CONFIDENCES.map(c => {
            const on = enabled.has(c);
            const label = c === 'drop-in' ? 'Drop-in' : c === 'sidegrade' ? 'Sidegrade' : 'Budget pick';
            return (
              <button
                key={c}
                type="button"
                onClick={() => toggleConfidence(c)}
                className={[
                  'px-2.5 py-1 rounded-full text-xs border transition-colors',
                  on
                    ? c === 'drop-in'  ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                    : c === 'sidegrade' ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                    :                     'bg-rose-500/20 text-rose-300 border-rose-500/40'
                    : 'bg-zinc-900 text-zinc-500 border-zinc-700 hover:text-zinc-300',
                ].join(' ')}
              >
                {label}
              </button>
            );
          })}
        </section>

        {/* ── Spells ── */}
        <Section title="Spells" rows={plan.spellRows} emptyMsg="No cheaper spell alternatives found in role.">
          {plan.spellRows.filter(r => enabled.has(r.confidence)).map(row => (
            <SwapRow
              key={row.id}
              row={row}
              checked={checked.has(row.id)}
              onToggle={toggleRow}
              onPreviewCurrent={onPreviewCard}
              onPreviewSuggestion={onPreviewCard}
              flagOverPrice={flagOverNum}
              currency={currency}
            />
          ))}
        </Section>

        {/* ── Lands ── */}
        <Section title="Lands" rows={plan.landRows} emptyMsg="No cheaper lands match your color identity.">
          {plan.landRows.filter(r => enabled.has(r.confidence)).map(row => (
            <SwapRow
              key={row.id}
              row={row}
              checked={checked.has(row.id)}
              onToggle={toggleRow}
              onPreviewCurrent={onPreviewCard}
              onPreviewSuggestion={onPreviewCard}
              flagOverPrice={flagOverNum}
              currency={currency}
            />
          ))}
        </Section>

        {/* ── Protected ── */}
        {plan.protected.length > 0 && (
          <section className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-3">
            <div className="flex items-center gap-2 mb-2">
              <h3 className="text-sm font-medium text-zinc-300">Protected</h3>
              <Badge className="text-xs bg-zinc-800 text-zinc-400 border-zinc-700">{plan.protected.length}</Badge>
              <Tooltip>
                <TooltipTrigger asChild><Info className="h-3.5 w-3.5 text-zinc-500" /></TooltipTrigger>
                <TooltipContent>These cards aren't offered as swap targets. Reasons include: your commander, must-include list, basic lands, or missing price data.</TooltipContent>
              </Tooltip>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {plan.protected.map(p => (
                <Tooltip key={p.name}>
                  <TooltipTrigger asChild>
                    <span className="text-xs px-2 py-0.5 rounded bg-zinc-800 text-zinc-400 border border-zinc-700 cursor-default">
                      {p.name}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent className="capitalize">{p.reason.replace('-', ' ')}</TooltipContent>
                </Tooltip>
              ))}
            </div>
          </section>
        )}
      </div>
    </TooltipProvider>
  );
}

function Section({
  title, rows, emptyMsg, children,
}: { title: string; rows: unknown[]; emptyMsg: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-3">
      <h3 className="text-sm font-medium text-zinc-300 mb-2">
        {title} <span className="text-zinc-500 font-normal">({rows.length} suggestion{rows.length === 1 ? '' : 's'})</span>
      </h3>
      {rows.length === 0 ? (
        <div className="text-xs text-zinc-500 italic">{emptyMsg}</div>
      ) : (
        <div className="flex flex-col gap-1.5">{children}</div>
      )}
    </section>
  );
}
```

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: succeeds. (If the `Slider` component's `onValueChange` signature differs from `(v: number[]) => void` in this codebase, adjust accordingly — check `src/components/ui/slider.tsx`.)

- [ ] **Step 3: Commit**

```bash
git add src/components/deck/optimizer/CostTab.tsx
git commit -m "feat(cost): CostTab component with slider, filters, and rows"
```

---

### Task 9: Wire CostTab into DeckOptimizer

**Files:**
- Modify: `src/components/deck/optimizer/DeckOptimizer.tsx`

- [ ] **Step 1: Import the new tab**

Add to the existing imports near the other tab imports (around lines 22–28):

```ts
import { CostTab } from './CostTab';
```

- [ ] **Step 2: Find the tab-render switch and add the `cost` case**

Locate the JSX that renders the active tab content. Search for `activeTab === 'bracket'` to find the block. Add a sibling block for `cost`:

```tsx
{activeTab === 'cost' && (
  <CostTab
    commanderName={commanderName}
    partnerCommanderName={partnerCommanderName}
    currentCards={currentCards}
    analysis={analysis}
    sideboardNames={sideboardNames ?? []}
    maybeboardNames={maybeboardNames ?? []}
    onPreviewCard={(name) => {
      // Reuse existing preview pattern — load the card and show modal.
      // If a helper like `openPreview` already exists in this component, call it instead.
      import('@/services/scryfall/client').then(({ getCardByName }) => {
        getCardByName(name).then((c) => { if (c) setPreviewCard(c); });
      });
    }}
    onApplyPlan={(removeNames, addNames) => {
      onRemoveCards?.(removeNames);
      onAddCards?.(addNames, 'deck');
      pushDeckHistory?.();
    }}
  />
)}
```

If a `pushDeckHistory` symbol is not in scope here, omit that line — the existing add/remove handlers already snapshot history elsewhere; check the file to confirm. If there's already a centralized `openPreview(name)` helper in DeckOptimizer (search for `setPreviewCard` usages), use that instead of the inline dynamic import shown above.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: succeeds with no type errors. If TypeScript complains that the `TabKey` switch is non-exhaustive elsewhere, add an explicit `else if (activeTab === 'cost') return null;` or include the missing case.

- [ ] **Step 4: Manual QA**

Run: `npm run dev`

1. Open the app in the browser.
2. Generate a deck (or paste one into the Analyze page).
3. Click the **Cost** tab.
4. Confirm:
   - Current total and projected total render.
   - The slider min is well below max; dragging it left auto-checks rows top-down; projected total drops.
   - Toggling **Budget pick** off removes rose-chip rows from the auto-pick set.
   - Manually unchecking an auto-picked row keeps it unchecked even if you keep dragging.
   - Clicking a card name (current or suggestion) opens the preview modal.
   - Entering `5` in the per-card flag input adds a rose left border to rows whose current price > $5; clearing the input removes it.
   - The Protected section lists the commander and any must-includes/basics.
5. Click **Apply plan** with at least one row checked.
6. Confirm the deck has actually changed (other tabs reflect the new card list, and the Cost tab rebuilds with a lower current total).

- [ ] **Step 5: Commit**

```bash
git add src/components/deck/optimizer/DeckOptimizer.tsx
git commit -m "feat(cost): wire CostTab into DeckOptimizer with apply handler"
```

---

### Task 10: Polish — empty states, currency edge cases, and copy

**Files:**
- Modify: `src/components/deck/optimizer/CostTab.tsx`

- [ ] **Step 1: "Already on budget" inline note**

In `CostTab.tsx`, just under the totals row in the budget header, conditionally render a small reassurance message when there's nothing to do:

```tsx
{plan.currentTotal <= (target ?? plan.currentTotal) && checked.size === 0 && (
  <div className="text-xs text-emerald-300/80">You're already at or under your target.</div>
)}
```

- [ ] **Step 2: Hide slider when there are no rows**

Wrap the slider row in:

```tsx
{(plan.spellRows.length > 0 || plan.landRows.length > 0) && (
  /* …slider markup… */
)}
```

And below the totals, when no rows exist at all:

```tsx
{plan.spellRows.length === 0 && plan.landRows.length === 0 && (
  <div className="text-sm text-zinc-400">
    No cheaper alternatives found for any card in this deck.
  </div>
)}
```

- [ ] **Step 3: Build and manual QA**

Run: `npm run build` (expected: succeeds).

On the dev server, verify a tiny edge-case deck (e.g. all basics + commander) shows the "no alternatives" message and no slider.

- [ ] **Step 4: Commit**

```bash
git add src/components/deck/optimizer/CostTab.tsx
git commit -m "feat(cost): polish empty states and reassurance copy"
```

---

### Task 11: Final verification

- [ ] **Step 1: Full build**

Run: `npm run build`
Expected: succeeds with no errors and no new warnings beyond preexisting ones.

- [ ] **Step 2: Manual QA pass**

Run: `npm run dev` and run through this checklist on at least two decks (one generated, one pasted):

- [ ] Cost tab appears in the tab strip with the `$` icon.
- [ ] URL slug `/cost` (or whatever the analyze/builder route pattern uses) routes to the tab.
- [ ] Switching tabs preserves slider position within a session.
- [ ] Apply plan with 1 swap works.
- [ ] Apply plan with 5+ swaps works in a single click; deck total drops by the expected amount.
- [ ] Pasted deck (no `swapCandidates`) still gets suggestions via `analysis.recommendations`.
- [ ] Commander, partner (if any), must-includes, and basics are all in the Protected section.
- [ ] Toggling the Budget pick filter chip immediately removes those rows from the auto-pick.
- [ ] Currency = EUR (toggle in settings) shows `€` prefix everywhere.

- [ ] **Step 3: Final commit if any polish needed**

If the QA pass surfaced small issues, fix and commit:

```bash
git add -A
git commit -m "fix(cost): post-QA polish"
```

---

## Notes for the implementer

- **Why not reuse `getSwapCandidatesForCard` directly?** It only returns candidates for generated decks (where `deck.swapCandidates` is populated). Pasted decks use `analysis.recommendations`, which is a strict superset of the data and always present. To keep one code path for both, we always read from `analysis.recommendations`.
- **Performance:** `buildCostPlan` is O(cards × pool-size-per-role). For a 99-card deck with ~500 recommendations grouped by role, this is well under 50k comparisons — no memoization beyond the `useMemo` wrapper is needed.
- **Why no automated tests?** This project doesn't have Vitest/Jest set up. Don't add a framework here; rely on `npm run build` (strict TS) + manual QA. The pure functions in `costAnalyzer.ts` are written to be easily testable later if a framework is added.
- **If the optimizer already has a `setPreviewCard` helper**, prefer that over the dynamic import shown in Task 9, Step 2. Check around line 56 of `DeckOptimizer.tsx` where `previewCard` state is defined.

---

## Self-review (completed by author)

- Spec coverage: budget header, slider, per-card flag, confidence tiers, spells/lands split, protected section, apply plan, dual data source (generated + pasted) — all mapped to tasks 1–10.
- Cost-by-role chart was explicitly deferred in the spec; not in this plan.
- No placeholders, TBDs, or "implement later" steps.
- Type and function names consistent between tasks (`SwapRow`, `SwapSuggestion`, `CostPlan`, `autoCheckToTarget`, etc.).
- No automated tests because the repo has no test framework — explicitly noted in the header and per task.
