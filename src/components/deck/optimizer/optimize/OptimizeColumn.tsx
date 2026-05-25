import { ReactNode, useMemo } from 'react';
import { TrendingDown, TrendingUp } from 'lucide-react';
import type { OptimizeCard } from '@/services/deckBuilder/deckAnalyzer';
import { ROLE_LABELS } from '@/services/deckBuilder/roleTargets';
import { OptimizeTile, type TileSide } from './OptimizeTile';

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
  onSelectAll: () => void;
  onDeselectAll: () => void;
  /** Optional renderer for the inline drill-down panel inserted below the active tile's group. */
  renderDrilldown: (card: OptimizeCard) => ReactNode;
}

const SIDE_HEADER: Record<TileSide, { label: string; Icon: typeof TrendingDown; tintText: string; tintBg: string; tintBorder: string }> = {
  remove: { label: 'REMOVE', Icon: TrendingDown,  tintText: 'text-red-400/80',     tintBg: 'bg-red-500/[0.03]',     tintBorder: 'border-red-500/15' },
  add:    { label: 'ADD',    Icon: TrendingUp,    tintText: 'text-emerald-400/80', tintBg: 'bg-emerald-500/[0.03]', tintBorder: 'border-emerald-500/15' },
};

export function OptimizeColumn({
  side, cards, uncheckedNames, activeName, totalCount,
  onTileClick, onSelectAll, onDeselectAll, renderDrilldown,
}: OptimizeColumnProps) {
  const labelFn = side === 'remove' ? getRemovalCategoryLabel : getAdditionCategoryLabel;
  const groups = useMemo(() => groupByCategory(cards, labelFn), [cards, labelFn]);
  const headerMeta = SIDE_HEADER[side];
  const allUnchecked = cards.length > 0 && cards.every(c => uncheckedNames.has(c.name));

  return (
    <div className={`${headerMeta.tintBg} border ${headerMeta.tintBorder} rounded-xl p-3 sm:p-4 space-y-4`}>
      <div className="flex items-center gap-2 pb-2 border-b border-border/20">
        <headerMeta.Icon className={`w-3.5 h-3.5 ${headerMeta.tintText}`} />
        <span className={`text-xs font-semibold uppercase tracking-wider ${headerMeta.tintText}`}>
          {headerMeta.label} ({totalCount})
        </span>
        <button
          type="button"
          onClick={() => (allUnchecked ? onSelectAll() : onDeselectAll())}
          className={`ml-auto text-[10px] font-medium px-2 py-1 rounded border transition-colors ${headerMeta.tintText} border-border/30 hover:border-border/60 hover:bg-accent/30`}
        >
          {allUnchecked ? 'Select all' : 'Deselect all'}
        </button>
      </div>

      {groups.map(group => (
        <section key={group.category}>
          <div className="flex items-baseline gap-2 mb-2 px-0.5">
            <span className={`text-[11px] font-semibold uppercase tracking-wider ${headerMeta.tintText}`}>
              {group.label}
            </span>
            <span className="text-[10px] text-muted-foreground/60">{group.cards.length}</span>
          </div>

          <div className="grid grid-cols-[repeat(auto-fill,minmax(70px,1fr))] gap-2">
            {group.cards.map(card => (
              <OptimizeTile
                key={card.name}
                card={card}
                side={side}
                checked={!uncheckedNames.has(card.name)}
                active={card.name === activeName}
                onClick={() => onTileClick(card.name)}
              />
            ))}
          </div>

          {(() => {
            const activeCard = group.cards.find(c => c.name === activeName);
            return activeCard ? <div className="mt-3">{renderDrilldown(activeCard)}</div> : null;
          })()}
        </section>
      ))}

      {groups.length === 0 && (
        <p className="text-xs text-muted-foreground/60 italic py-6 text-center">
          {side === 'remove' ? 'No cuts recommended.' : 'No additions recommended.'}
        </p>
      )}
    </div>
  );
}
