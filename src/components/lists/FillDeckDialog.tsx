import { useEffect, useMemo, useState } from 'react';
import { X, Sparkles } from 'lucide-react';
import type { GapAnalysisCard } from '@/types';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Drawer } from '@/components/ui/drawer';

const MAX_SUGGESTIONS = 20;

export interface FillDeckDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (cardNames: string[]) => void;
  gapAnalysis: GapAnalysisCard[];
  deckNames: Set<string>;
  sideboardNames: Set<string>;
  maybeboardNames: Set<string>;
  bannedNames: Set<string>;
  currentCount: number;
  targetSize: number;
  roleCounts: Record<string, number>;
  roleTargets: Record<string, number>;
}

export function FillDeckDialog(props: FillDeckDialogProps) {
  const {
    open,
    onClose,
    onConfirm,
    gapAnalysis,
    deckNames,
    sideboardNames,
    maybeboardNames,
    bannedNames,
    currentCount,
    targetSize,
    roleCounts,
    roleTargets,
  } = props;

  const shortfall = Math.max(0, targetSize - currentCount);

  // Filtered candidate pool: gapAnalysis minus anything already in the deck,
  // boards, or the user's banned list. Capped at MAX_SUGGESTIONS so the drawer
  // stays scannable.
  const candidates = useMemo(() => {
    const out: GapAnalysisCard[] = [];
    for (const card of gapAnalysis) {
      if (deckNames.has(card.name)) continue;
      if (sideboardNames.has(card.name)) continue;
      if (maybeboardNames.has(card.name)) continue;
      if (bannedNames.has(card.name)) continue;
      out.push(card);
      if (out.length >= MAX_SUGGESTIONS) break;
    }
    return out;
  }, [gapAnalysis, deckNames, sideboardNames, maybeboardNames, bannedNames]);

  // Roles with a current deficit — used to surface a hint chip on candidates
  // that would close one. Purely informational; does not change ordering.
  const deficitRoles = useMemo(() => {
    const set = new Set<string>();
    for (const [role, target] of Object.entries(roleTargets)) {
      if ((roleCounts[role] ?? 0) < target) set.add(role);
    }
    return set;
  }, [roleCounts, roleTargets]);

  const defaultsKey = useMemo(
    () => candidates.slice(0, shortfall).map(c => c.name).join('|'),
    [candidates, shortfall],
  );
  const [checked, setChecked] = useState<Set<string>>(new Set());
  useEffect(() => {
    setChecked(new Set(candidates.slice(0, shortfall).map(c => c.name)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultsKey]);

  // Auto-close when the deck is no longer short (user added cards via another flow,
  // or lowered the expected size while the drawer was open).
  useEffect(() => {
    if (open && shortfall <= 0) onClose();
  }, [open, shortfall, onClose]);

  if (shortfall <= 0) return null;

  return (
    <Drawer
      open={open}
      onClose={onClose}
      position="right"
      onPositionChange={() => {}}
      defaultSizePercent={29}
    >
      <div className="flex flex-col h-full">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 px-5 py-4 border-b border-border">
          <div>
            <h2 className="text-lg font-bold flex items-center gap-2 flex-wrap">
              <Sparkles className="w-4 h-4 text-violet-400" />
              Fill deck
              <span className="text-muted-foreground font-normal text-base">
                {currentCount} → {targetSize} cards
              </span>
            </h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              {shortfall} short of target — pick which to add
            </p>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 p-1 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            aria-label="Close fill drawer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 px-3 py-3 overflow-y-auto">
          {candidates.length === 0 ? (
            <div className="text-sm text-muted-foreground px-2 py-4">
              No more suggestions for this commander.
            </div>
          ) : (
            <ul className="space-y-2">
              {candidates.map((card) => {
                const isChecked = checked.has(card.name);
                const toggle = () => {
                  setChecked(prev => {
                    const next = new Set(prev);
                    if (next.has(card.name)) next.delete(card.name);
                    else next.add(card.name);
                    return next;
                  });
                };
                const role = card.role ?? '';
                const fillsGap = role && deficitRoles.has(role);
                const pct = Math.round(card.inclusion);
                const hue = (pct / 100) * 120;
                return (
                  <li
                    key={card.name}
                    data-state={isChecked ? 'active' : 'idle'}
                    className={[
                      'flex items-center gap-3 px-2 py-2 rounded-lg border transition-all duration-300 ease-out cursor-pointer',
                      'hover:bg-accent/40',
                      isChecked
                        ? 'opacity-100 border-violet-500/30 bg-violet-500/5'
                        : 'opacity-70 border-border/40 bg-card',
                    ].join(' ')}
                    onClick={toggle}
                  >
                    {/* Image thumbnail */}
                    <div className="shrink-0 w-12 h-16 rounded overflow-hidden bg-muted/30 border border-border/40">
                      {card.imageUrl && (
                        <img
                          src={card.imageUrl}
                          alt={card.name}
                          loading="lazy"
                          className="w-full h-full object-cover object-top"
                        />
                      )}
                    </div>

                    {/* Checkbox */}
                    <div onClick={(e) => e.stopPropagation()} className="shrink-0">
                      <Checkbox
                        checked={isChecked}
                        onCheckedChange={toggle}
                        aria-label={`Add ${card.name}`}
                      />
                    </div>

                    {/* Main column */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium truncate">{card.name}</span>
                        {card.roleLabel && (
                          <span className="text-[10px] font-semibold uppercase tracking-wide text-violet-300/80 bg-violet-500/10 border border-violet-500/30 rounded px-1.5 py-0.5 whitespace-nowrap">
                            {card.roleLabel}
                          </span>
                        )}
                        {fillsGap && card.roleLabel && (
                          <span className="text-[10px] font-semibold uppercase tracking-wide text-violet-300/80 whitespace-nowrap">
                            fills {card.roleLabel.toLowerCase()} gap
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5 truncate" title={card.typeLine}>
                        {card.typeLine}
                      </div>
                    </div>

                    {/* Stats column */}
                    <div className="shrink-0 text-right text-xs">
                      <div className="text-violet-300/80">rel {Math.round(card.synergy)}</div>
                      <div
                        style={{ color: `hsl(${hue}, 70%, 55%)` }}
                        title={`${pct}% of EDHREC decks include this card`}
                      >
                        {pct}%
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-2 px-5 py-3 border-t border-border">
          <div className="text-xs text-muted-foreground">
            {checked.size === shortfall
              ? `Filling to target — ${targetSize} cards`
              : `Adding ${checked.size} of ${shortfall} — leaves ${currentCount + checked.size}/${targetSize}`}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button
              onClick={() => onConfirm([...checked])}
              disabled={checked.size === 0}
            >
              Add {checked.size} card{checked.size === 1 ? '' : 's'}
            </Button>
          </div>
        </div>
      </div>
    </Drawer>
  );
}
