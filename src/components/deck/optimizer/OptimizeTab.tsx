import { useState, useMemo, useCallback } from 'react';
import {
  Wand2, ArrowLeft, Check, Sparkles, Zap,
  ArrowRightLeft, TrendingUp, TrendingDown,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { ScryfallCard } from '@/types';
import type { DeckAnalysis, OptimizeCard } from '@/services/deckBuilder/deckAnalyzer';
import { computeOptimizeSwaps } from '@/services/deckBuilder/deckAnalyzer';
import { getCardPrice, getCachedCard } from '@/services/scryfall/client';
import {
  scryfallImg,
  ROLE_BADGE_COLORS, ROLE_LABEL_ICONS,
} from './constants';

// ─── Reason category labels ─────────────────────────────────────────

const REMOVAL_CATEGORY_LABELS: Record<string, string> = {
  'low-synergy': 'Low Synergy',
  'curve-fix': 'Curve Fix',
  'low-inclusion': 'Low Inclusion',
  'tapland': 'Taplands',
  'excess-land': 'Excess Lands',
};

function getRemovalCategoryLabel(cat: string): string {
  if (cat.startsWith('excess:')) {
    const role = cat.split(':')[1];
    const labels: Record<string, string> = { ramp: 'Excess Ramp', removal: 'Excess Removal', boardwipe: 'Excess Board Wipes', cardDraw: 'Excess Card Draw' };
    return labels[role] || `Excess ${role}`;
  }
  return REMOVAL_CATEGORY_LABELS[cat] || cat;
}

const ADDITION_CATEGORY_LABELS: Record<string, string> = {
  'synergy': 'High Synergy',
  'theme': 'Theme Synergy',
  'mana-fix': 'Land Recommendations',
  'color-fix': 'Color Fixing',
};

function getAdditionCategoryLabel(cat: string): string {
  if (cat.startsWith('fills:')) {
    const role = cat.split(':')[1];
    const labels: Record<string, string> = { ramp: 'Fills Ramp Gap', removal: 'Fills Removal Gap', boardwipe: 'Fills Board Wipes Gap', cardDraw: 'Fills Card Draw Gap' };
    return labels[role] || `Fills ${role} gap`;
  }
  if (cat.startsWith('curve:')) {
    const phase = cat.split(':')[1];
    const labels: Record<string, string> = { early: 'Early Game Plays', mid: 'Mid Game Plays', late: 'Late Game Plays' };
    return labels[phase] || 'Curve Fill';
  }
  return ADDITION_CATEGORY_LABELS[cat] || cat;
}

// ─── Group cards by reasonCategory ──────────────────────────────────

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

// ─── Resolve price for removal cards from Scryfall cache ────────────

function resolvePrice(card: OptimizeCard): string | undefined {
  if (card.price) return card.price;
  const cached = getCachedCard(card.name);
  if (cached) return getCardPrice(cached) || undefined;
  return undefined;
}

// ─── Card Row ───────────────────────────────────────────────────────

function OptimizeCardRow({
  card, side, checked, onToggle, onPreview,
}: {
  card: OptimizeCard;
  side: 'remove' | 'add';
  checked: boolean;
  onToggle: (name: string) => void;
  onPreview: (name: string) => void;
}) {
  const pct = card.inclusion != null ? Math.round(card.inclusion) : null;
  const RIcon = card.roleLabel ? ROLE_LABEL_ICONS[card.roleLabel] : null;
  const badgeColor = card.roleLabel ? ROLE_BADGE_COLORS[card.roleLabel] : null;
  const price = resolvePrice(card);

  // Build info line: type + CMC (replaces redundant reason text)
  // Resolve primaryType from Scryfall cache when EDHREC gives us 'Unknown'
  let displayType = card.primaryType;
  if (!displayType || displayType === 'Unknown') {
    const cached = getCachedCard(card.name);
    if (cached) {
      const tl = (cached.card_faces?.[0]?.type_line ?? cached.type_line ?? '').split('—')[0].replace(/Legendary\s+/i, '').trim();
      if (tl) displayType = tl;
    }
  }
  const infoParts: string[] = [];
  if (displayType && displayType !== 'Unknown') infoParts.push(displayType);
  if (card.cmc != null && card.cmc > 0) infoParts.push(`CMC ${card.cmc}`);
  const infoLine = infoParts.join(' · ');

  return (
    <div
      className={`group flex items-center gap-2 py-1.5 px-2 rounded-lg border transition-all duration-200 cursor-pointer hover:bg-accent/40 ${
        !checked ? 'opacity-40' : ''
      } ${
        side === 'remove'
          ? 'border-red-500/10 hover:border-red-500/20'
          : 'border-emerald-500/10 hover:border-emerald-500/20'
      }`}
      onClick={() => onPreview(card.name)}
    >
      {/* Checkbox */}
      <button
        onClick={(e) => { e.stopPropagation(); onToggle(card.name); }}
        className={`shrink-0 w-4 h-4 rounded border-2 flex items-center justify-center transition-colors ${
          checked
            ? side === 'remove'
              ? 'bg-red-500/80 border-red-500/80 text-white'
              : 'bg-emerald-500/80 border-emerald-500/80 text-white'
            : 'border-muted-foreground/30 hover:border-muted-foreground/60'
        }`}
        title={checked ? 'Deselect' : 'Select'}
      >
        {checked && <Check className="w-2.5 h-2.5" />}
      </button>

      <img
        src={card.imageUrl || scryfallImg(card.name)}
        alt={card.name}
        className="w-8 h-auto rounded shadow-md shrink-0"
        loading="lazy"
        onError={(e) => { (e.target as HTMLImageElement).src = scryfallImg(card.name); }}
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-medium truncate">{card.name}</span>
          {RIcon && badgeColor && (
            <span className={`inline-flex items-center gap-0.5 text-[10px] font-bold px-1 py-px rounded-full shrink-0 ${badgeColor}`}>
              <RIcon className="w-2.5 h-2.5" />
              {card.roleLabel}
            </span>
          )}
          {card.isGameChanger && (
            <span className="text-[10px] font-bold text-amber-500/70 shrink-0" title="Game Changer (EDHREC)">GC</span>
          )}
          {card.isThemeSynergy && (
            <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-purple-400/70 shrink-0" title="High synergy with commander themes">
              <Zap className="w-2.5 h-2.5" />
              High Synergy
            </span>
          )}
        </div>
        <p className="text-[10px] text-muted-foreground truncate">{infoLine || card.reason}</p>
      </div>
      <div className="flex items-center gap-2 shrink-0 ml-auto">
        {price && (
          <span className="text-[10px] text-muted-foreground tabular-nums">${price}</span>
        )}
        {pct != null && (
          <span
            className="text-[10px] font-bold tabular-nums w-7 text-right"
            style={{ color: `hsl(${Math.min(pct / 50, 1) * 120}, 70%, 55%)` }}
          >
            {pct}%
          </span>
        )}
      </div>
    </div>
  );
}

// ─── Main OptimizeView Component ────────────────────────────────────

export interface OptimizeViewProps {
  analysis: DeckAnalysis;
  currentCards: ScryfallCard[];
  commanderName: string;
  partnerCommanderName?: string;
  cardInclusionMap?: Record<string, number>;
  mustIncludeNames: Set<string>;
  bannedNames: Set<string>;
  onApply: (removals: string[], additions: string[]) => void;
  onBack: () => void;
  onPreview: (name: string) => void;
}

export function OptimizeView({
  analysis, currentCards, commanderName, partnerCommanderName,
  cardInclusionMap, mustIncludeNames, bannedNames,
  onApply, onBack, onPreview,
}: OptimizeViewProps) {
  // Selected cards (checked = will be applied). Default: all checked.
  const [uncheckedRemovals, setUncheckedRemovals] = useState<Set<string>>(new Set());
  const [uncheckedAdditions, setUncheckedAdditions] = useState<Set<string>>(new Set());
  const [applied, setApplied] = useState(false);

  const allSwaps = useMemo(() =>
    computeOptimizeSwaps(analysis, currentCards, cardInclusionMap, commanderName, partnerCommanderName, mustIncludeNames, bannedNames),
    [analysis, currentCards, cardInclusionMap, commanderName, partnerCommanderName, mustIncludeNames, bannedNames]
  );

  const { removals, additions } = allSwaps;

  // Which cards are currently checked
  const checkedRemovals = useMemo(() => removals.filter(c => !uncheckedRemovals.has(c.name)), [removals, uncheckedRemovals]);
  const checkedAdditions = useMemo(() => additions.filter(c => !uncheckedAdditions.has(c.name)), [additions, uncheckedAdditions]);

  // Deck size awareness: don't push over target
  const targetDeckSize = analysis.manaBase.deckSize; // e.g. 99 for commander
  const currentDeckSize = currentCards.length;
  const projectedSize = currentDeckSize - checkedRemovals.length + checkedAdditions.length;
  const overBy = Math.max(0, projectedSize - targetDeckSize);
  // How many additions can actually be applied without exceeding target
  const effectiveAdditions = checkedAdditions.length - overBy;
  const totalChanges = checkedRemovals.length + Math.max(0, effectiveAdditions);

  const removalGroups = useMemo(() => groupByCategory(removals, getRemovalCategoryLabel), [removals]);
  const additionGroups = useMemo(() => groupByCategory(additions, getAdditionCategoryLabel), [additions]);

  const toggleRemoval = useCallback((name: string) => {
    setUncheckedRemovals(prev => {
      const next = new Set(prev);
      next.has(name) ? next.delete(name) : next.add(name);
      return next;
    });
  }, []);

  const toggleAddition = useCallback((name: string) => {
    setUncheckedAdditions(prev => {
      const next = new Set(prev);
      next.has(name) ? next.delete(name) : next.add(name);
      return next;
    });
  }, []);

  const handleApply = useCallback(() => {
    if (totalChanges === 0) return;
    setApplied(true);
    const rems = checkedRemovals.map(c => c.name);
    // Only add as many as fit within the target deck size
    const maxAdds = Math.max(0, targetDeckSize - currentDeckSize + rems.length);
    const adds = checkedAdditions.slice(0, maxAdds).map(c => c.name);
    setTimeout(() => onApply(rems, adds), 600);
  }, [totalChanges, checkedRemovals, checkedAdditions, onApply, targetDeckSize, currentDeckSize]);

  const priceDelta = useMemo(() => {
    let removedTotal = 0, addedTotal = 0;
    let hasAnyPrice = false;
    for (const c of checkedRemovals) {
      const p = resolvePrice(c);
      if (p) { removedTotal += parseFloat(p); hasAnyPrice = true; }
    }
    const maxAdds = Math.max(0, effectiveAdditions);
    for (const c of checkedAdditions.slice(0, maxAdds)) {
      const p = resolvePrice(c);
      if (p) { addedTotal += parseFloat(p); hasAnyPrice = true; }
    }
    if (!hasAnyPrice) return null;
    return addedTotal - removedTotal;
  }, [checkedRemovals, checkedAdditions, effectiveAdditions]);

  const noSwaps = removals.length === 0 && additions.length === 0;

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-primary/10">
            <Wand2 className="w-4 h-4 text-primary" />
          </div>
          <div>
            <h3 className="text-sm font-bold">Optimize Deck</h3>
            <p className="text-[11px] text-muted-foreground leading-snug mt-0.5">
              {noSwaps
                ? 'Your deck is well-optimized — no swaps needed right now.'
                : `${removals.length} potential swap${removals.length !== 1 ? 's' : ''} found. Select the ones you want to apply.`}
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={onBack}
          className="gap-1.5 text-xs"
        >
          <ArrowLeft className="w-3 h-3" />
          Back to Analysis
        </Button>
      </div>

      {/* Summary bar */}
      {!noSwaps && (
        <div className="flex items-center gap-3 px-3 py-2 rounded-lg bg-card/60 border border-border/30 text-xs">
          <div className="flex items-center gap-1.5">
            <TrendingDown className="w-3.5 h-3.5 text-red-400/70" />
            <span className="text-red-400/80 font-medium">-{checkedRemovals.length}</span>
            <span className="text-muted-foreground/60">selected</span>
          </div>
          <div className="w-px h-4 bg-border/40" />
          <div className="flex items-center gap-1.5">
            <TrendingUp className="w-3.5 h-3.5 text-emerald-400/70" />
            <span className="text-emerald-400/80 font-medium">
              +{Math.max(0, effectiveAdditions)}
              {overBy > 0 && <span className="text-amber-400/80 text-[10px] ml-0.5">/{checkedAdditions.length}</span>}
            </span>
            <span className="text-muted-foreground/60">selected</span>
          </div>
          <div className="w-px h-4 bg-border/40" />
          <div className="flex items-center gap-1.5">
            <ArrowRightLeft className="w-3.5 h-3.5 text-muted-foreground/50" />
            <span className="text-muted-foreground">
              {totalChanges} change{totalChanges !== 1 ? 's' : ''} will apply
            </span>
          </div>
          {overBy > 0 && (
            <>
              <div className="w-px h-4 bg-border/40" />
              <span className="text-amber-400/80 text-[10px]">
                {overBy} addition{overBy !== 1 ? 's' : ''} skipped (deck full)
              </span>
            </>
          )}
          <div className="ml-auto flex items-center gap-3">
            {priceDelta != null && (
              <>
                <span className={`tabular-nums text-[11px] ${priceDelta > 0 ? 'text-red-400/70' : priceDelta < 0 ? 'text-emerald-400/70' : 'text-muted-foreground/60'}`}>
                  {priceDelta > 0 ? '+' : ''}{priceDelta < 0 ? '−' : ''}{priceDelta < 0 ? '' : ''}${Math.abs(priceDelta).toFixed(2)}
                </span>
                <div className="w-px h-4 bg-border/40" />
              </>
            )}
            {(() => {
              const resultSize = currentDeckSize - checkedRemovals.length + Math.max(0, effectiveAdditions);
              const netChange = resultSize - currentDeckSize;
              if (netChange === 0) {
                return <span className="text-muted-foreground/60 tabular-nums">{resultSize}/{targetDeckSize}</span>;
              }
              return (
                <span className={`tabular-nums ${resultSize === targetDeckSize ? 'text-emerald-400/70' : 'text-amber-400/80'}`}>
                  Deck → {resultSize} cards
                </span>
              );
            })()}
          </div>
        </div>
      )}

      {/* Two-column swap view */}
      {!noSwaps && (
        <div className="grid grid-cols-2 gap-3">
          {/* REMOVE Column */}
          <div className="bg-red-500/[0.03] border border-red-500/15 rounded-lg p-3 space-y-3">
            <div className="flex items-center gap-2 pb-1.5 border-b border-red-500/10">
              <TrendingDown className="w-3.5 h-3.5 text-red-400/70" />
              <span className="text-xs font-semibold uppercase tracking-wider text-red-400/80">
                Remove ({removals.length})
              </span>
              <button
                onClick={() => {
                  const allUnchecked = removals.every(c => uncheckedRemovals.has(c.name));
                  setUncheckedRemovals(allUnchecked ? new Set() : new Set(removals.map(c => c.name)));
                }}
                className="ml-auto text-[10px] text-muted-foreground/40 hover:text-muted-foreground transition-colors"
              >
                {removals.every(c => uncheckedRemovals.has(c.name)) ? 'select all' : 'deselect all'}
              </button>
            </div>
            {removalGroups.map(group => (
              <div key={group.category}>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-red-400/50 mb-1 px-1">
                  {group.label} ({group.cards.length})
                </p>
                <div className="space-y-0.5">
                  {group.cards.map(card => (
                    <OptimizeCardRow
                      key={card.name}
                      card={card}
                      side="remove"
                      checked={!uncheckedRemovals.has(card.name)}
                      onToggle={toggleRemoval}
                      onPreview={onPreview}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* ADD Column */}
          <div className="bg-emerald-500/[0.03] border border-emerald-500/15 rounded-lg p-3 space-y-3">
            <div className="flex items-center gap-2 pb-1.5 border-b border-emerald-500/10">
              <TrendingUp className="w-3.5 h-3.5 text-emerald-400/70" />
              <span className="text-xs font-semibold uppercase tracking-wider text-emerald-400/80">
                Add ({additions.length})
              </span>
              <button
                onClick={() => {
                  const allUnchecked = additions.every(c => uncheckedAdditions.has(c.name));
                  setUncheckedAdditions(allUnchecked ? new Set() : new Set(additions.map(c => c.name)));
                }}
                className="ml-auto text-[10px] text-muted-foreground/40 hover:text-muted-foreground transition-colors"
              >
                {additions.every(c => uncheckedAdditions.has(c.name)) ? 'select all' : 'deselect all'}
              </button>
            </div>
            {additionGroups.map(group => (
              <div key={group.category}>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-emerald-400/50 mb-1 px-1">
                  {group.label} ({group.cards.length})
                </p>
                <div className="space-y-0.5">
                  {group.cards.map(card => (
                    <OptimizeCardRow
                      key={card.name}
                      card={card}
                      side="add"
                      checked={!uncheckedAdditions.has(card.name)}
                      onToggle={toggleAddition}
                      onPreview={onPreview}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Apply CTA */}
      {!noSwaps && (
        <div className="flex flex-col items-center gap-2 pt-2 pb-1">
          <Button
            onClick={handleApply}
            className={`btn-shimmer px-8 py-3 text-sm font-semibold gap-2.5 transition-all duration-300 ${
              applied ? 'bg-emerald-600 hover:bg-emerald-600 scale-95' : ''
            }`}
            disabled={applied || totalChanges === 0}
          >
            {applied ? (
              <>
                <Check className="w-4 h-4" />
                Applied!
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4" />
                Apply {totalChanges} Change{totalChanges !== 1 ? 's' : ''}
              </>
            )}
          </Button>
          {totalChanges > 0 && !applied && (
            <p className="text-[11px] text-muted-foreground/50">
              {checkedRemovals.length > 0 && `Remove ${checkedRemovals.length}`}
              {checkedRemovals.length > 0 && Math.max(0, effectiveAdditions) > 0 && ', '}
              {Math.max(0, effectiveAdditions) > 0 && `Add ${Math.max(0, effectiveAdditions)}`}
            </p>
          )}
          {totalChanges === 0 && !applied && (
            <p className="text-[11px] text-muted-foreground/50">
              Select cards to enable changes
            </p>
          )}
        </div>
      )}

      {/* Empty state */}
      {noSwaps && (
        <div className="flex flex-col items-center gap-3 py-8 px-4">
          <div className="p-3 rounded-full bg-emerald-500/10">
            <Check className="w-6 h-6 text-emerald-400" />
          </div>
          <div className="text-center">
            <p className="text-sm font-medium">Looking good!</p>
            <p className="text-xs text-muted-foreground mt-1 max-w-sm">
              The analyzer didn't find any clear improvements. Check the individual tabs for more detailed tuning.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={onBack}
            className="gap-1.5 text-xs mt-2"
          >
            <ArrowLeft className="w-3 h-3" />
            Back to Analysis
          </Button>
        </div>
      )}
    </div>
  );
}
