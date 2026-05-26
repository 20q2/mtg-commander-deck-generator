import { ReactNode, useMemo } from 'react';
import { TrendingDown, TrendingUp } from 'lucide-react';
import type { OptimizeCard } from '@/services/deckBuilder/deckAnalyzer';
import { ROLE_LABELS } from '@/services/deckBuilder/roleTargets';
import { Checkbox } from '@/components/ui/checkbox';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { OptimizeTile, type TileSide } from './OptimizeTile';

type TriState = boolean | 'indeterminate';

function triStateFor(names: string[], uncheckedNames: Set<string>): TriState {
  if (names.length === 0) return false;
  const uncheckedHere = names.filter(n => uncheckedNames.has(n)).length;
  if (uncheckedHere === 0) return true;
  if (uncheckedHere === names.length) return false;
  return 'indeterminate';
}

const REMOVAL_CATEGORY_LABELS: Record<string, string> = {
  'low-synergy': 'Low Synergy',
  'curve-fix': 'Curve Fix',
  'low-inclusion': 'Low Inclusion',
  'tapland': 'Taplands',
  'excess-land': 'Excess Lands',
  'balance': 'Balance to Deck Size',
};

const ADDITION_CATEGORY_LABELS: Record<string, string> = {
  'combo-enabler': 'Combo Enablers',
  'synergy': 'High Synergy',
  'theme': 'Theme Synergy',
  'mana-fix': 'Land Recommendations',
  'color-fix': 'Color Fixing',
  'from-combos': 'From Combos',
};

function getRemovalCategoryLabel(cat: string): string {
  if (cat.startsWith('excess:')) {
    const role = cat.split(':')[1];
    const label = ROLE_LABELS[role as keyof typeof ROLE_LABELS];
    return label ? `Excess ${label}` : `Excess ${role}`;
  }
  return REMOVAL_CATEGORY_LABELS[cat] || cat;
}

function getAdditionCategoryLabel(cat: string): string {
  if (cat.startsWith('fills:')) {
    const role = cat.split(':')[1];
    const label = ROLE_LABELS[role as keyof typeof ROLE_LABELS];
    return label ? `Fills ${label} Gap` : `Fills ${role} gap`;
  }
  if (cat.startsWith('curve:')) {
    const phase = cat.split(':')[1];
    const labels: Record<string, string> = { early: 'Early Game Plays', mid: 'Mid Game Plays', late: 'Late Game Plays' };
    return labels[phase] || 'Curve Fill';
  }
  return ADDITION_CATEGORY_LABELS[cat] || cat;
}

interface CardGroup {
  category: string;
  label: string;
  cards: OptimizeCard[];
}

function groupByCategory(cards: OptimizeCard[], labelFn: (cat: string) => string): CardGroup[] {
  const map = new Map<string, OptimizeCard[]>();
  for (const card of cards) {
    const existing = map.get(card.reasonCategory) || [];
    existing.push(card);
    map.set(card.reasonCategory, existing);
  }
  return Array.from(map.entries()).map(([cat, cards]) => ({
    category: cat,
    label: labelFn(cat),
    cards,
  }));
}

export interface OptimizeColumnProps {
  side: TileSide;
  cards: OptimizeCard[];
  uncheckedNames: Set<string>;
  activeName: string | null;
  totalCount: number;
  onTileClick: (name: string) => void;
  onToggleChecked: (name: string) => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  onSelectGroup: (names: string[]) => void;
  onDeselectGroup: (names: string[]) => void;
  /** Optional renderer for the inline drill-down panel inserted below the active tile's group. */
  renderDrilldown: (card: OptimizeCard) => ReactNode;
}

const SIDE_HEADER: Record<TileSide, {
  label: string;
  Icon: typeof TrendingDown;
  tintText: string;
  cardBg: string;
  stickyBg: string;
}> = {
  remove: {
    label: 'REMOVE',
    Icon: TrendingDown,
    tintText: 'text-red-400/90',
    cardBg: 'bg-red-500/[0.08]',
    stickyBg: 'bg-red-950/55',
  },
  add: {
    label: 'ADD',
    Icon: TrendingUp,
    tintText: 'text-emerald-400/90',
    cardBg: 'bg-emerald-500/[0.08]',
    stickyBg: 'bg-emerald-950/55',
  },
};

export function OptimizeColumn({
  side, cards, uncheckedNames, activeName, totalCount,
  onTileClick, onToggleChecked, onSelectAll, onDeselectAll,
  onSelectGroup, onDeselectGroup, renderDrilldown,
}: OptimizeColumnProps) {
  const labelFn = side === 'remove' ? getRemovalCategoryLabel : getAdditionCategoryLabel;
  const groups = useMemo(() => groupByCategory(cards, labelFn), [cards, labelFn]);
  const headerMeta = SIDE_HEADER[side];
  const columnState = triStateFor(cards.map(c => c.name), uncheckedNames);
  const columnAriaLabel = side === 'remove'
    ? (columnState === true ? 'Deselect all removals' : 'Select all removals')
    : (columnState === true ? 'Deselect all additions' : 'Select all additions');

  return (
    // No outer column backdrop or border — each section card stands on its own.
    <div className="space-y-3">
      {/* Column header — non-sticky; only group labels stick as the user scrolls. */}
      <div
        className={`px-3 py-2 rounded-xl ${headerMeta.stickyBg} flex items-center gap-2 shadow-md shadow-black/30`}
      >
        <headerMeta.Icon className={`w-3.5 h-3.5 ${headerMeta.tintText}`} />
        <span className={`text-xs font-semibold uppercase tracking-wider ${headerMeta.tintText}`}>
          {headerMeta.label} ({totalCount})
        </span>
        <Checkbox
          checked={columnState}
          onCheckedChange={() => (columnState === true ? onDeselectAll() : onSelectAll())}
          aria-label={columnAriaLabel}
          title={columnAriaLabel}
          className="ml-auto"
        />
      </div>

      {/* Each group is its own glassy card — no border. */}
      {groups.map(group => {
        const groupNames = group.cards.map(c => c.name);
        const groupState = triStateFor(groupNames, uncheckedNames);
        const groupAriaLabel = groupState === true
          ? `Deselect all in ${group.label}`
          : `Select all in ${group.label}`;
        return (
        <section
          key={group.category}
          className={`${headerMeta.cardBg} rounded-xl px-3 pt-0 pb-3`}
        >
          {/* Group label — sticky just below the plan header so the most recent menu title is always visible. */}
          <div className={`sticky top-[6.5rem] z-[5] -mx-3 px-3 py-1.5 mb-2 rounded-t-md ${headerMeta.stickyBg} backdrop-blur-md flex items-center gap-2`}>
            <span className={`text-[11px] font-semibold uppercase tracking-wider ${headerMeta.tintText}`}>
              {group.label}
            </span>
            <span className="text-[10px] text-foreground/60">{group.cards.length}</span>
            <Checkbox
              checked={groupState}
              onCheckedChange={() => (groupState === true ? onDeselectGroup(groupNames) : onSelectGroup(groupNames))}
              aria-label={groupAriaLabel}
              title={groupAriaLabel}
              className="ml-auto"
            />
          </div>

          {/* Each tile is the trigger for its own Popover — the drill-down
              floats anchored to the tile instead of breaking the grid layout. */}
          <div className="grid grid-cols-[repeat(auto-fill,minmax(70px,1fr))] gap-2">
            {group.cards.map(card => {
              const isActive = card.name === activeName;
              return (
                <Popover
                  key={card.name}
                  open={isActive}
                  onOpenChange={(open) => { if (!open && isActive) onTileClick(card.name); }}
                >
                  <PopoverTrigger asChild>
                    <OptimizeTile
                      card={card}
                      side={side}
                      checked={!uncheckedNames.has(card.name)}
                      active={isActive}
                      onClick={() => onTileClick(card.name)}
                      onToggleChecked={() => onToggleChecked(card.name)}
                    />
                  </PopoverTrigger>
                  <PopoverContent
                    side="right"
                    align="center"
                    sideOffset={12}
                    collisionPadding={16}
                    className="w-[440px] max-w-[calc(100vw-2rem)] p-0 border-none bg-transparent shadow-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-left-4 data-[state=open]:duration-200 data-[state=open]:ease-out data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-left-2 data-[state=closed]:duration-150"
                    onInteractOutside={(e) => {
                      const target = e.target as Element | null;
                      if (target?.closest('[data-card-preview-modal]')) e.preventDefault();
                    }}
                    onFocusOutside={(e) => {
                      const target = e.target as Element | null;
                      if (target?.closest('[data-card-preview-modal]')) e.preventDefault();
                    }}
                  >
                    {renderDrilldown(card)}
                  </PopoverContent>
                </Popover>
              );
            })}
          </div>
        </section>
        );
      })}

      {groups.length === 0 && (
        <p className="text-xs text-foreground/60 italic py-6 text-center">
          {side === 'remove' ? 'No cuts recommended.' : 'No additions recommended.'}
        </p>
      )}
    </div>
  );
}
