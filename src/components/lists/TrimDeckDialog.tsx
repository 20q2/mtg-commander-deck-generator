import { useEffect, useMemo, useState } from 'react';
import { X, Scissors, Mountain, Minus, Plus } from 'lucide-react';
import { useAutoAnimate } from '@formkit/auto-animate/react';
import type { ScryfallCard } from '@/types';
import { planTrim, type TrimResult } from '@/services/deckBuilder/deckTrimmer';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Drawer } from '@/components/ui/drawer';
import { ManaCost } from '@/components/ui/mtg-icons';
import { getFrontFaceTypeLine, getCardImageUrl } from '@/services/scryfall/client';

export interface TrimDeckDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (cardNames: string[]) => void;
  cards: ScryfallCard[];
  commanderName: string;
  partnerCommanderName?: string;
  targetSize: number;
  relevancyMap: Record<string, number>;
  inclusionMap: Record<string, number>;
  synergyMap: Record<string, number>;
  roleCounts: Record<string, number>;
  roleTargets: Record<string, number>;
  edhrecCurve: Record<number, number>;
  edhrecTypes: Record<string, number>;
}

export function TrimDeckDialog(props: TrimDeckDialogProps) {
  const { open, onClose, onConfirm, cards, commanderName, partnerCommanderName, targetSize } = props;

  const currentLandCount = useMemo(
    () => cards.filter(c => getFrontFaceTypeLine(c).toLowerCase().includes('land')).length,
    [cards],
  );

  const [landTarget, setLandTarget] = useState<number>(Math.max(30, currentLandCount));

  const plan: TrimResult = useMemo(() => planTrim({
    cards,
    commanderName,
    partnerCommanderName,
    targetSize,
    targetLandCount: landTarget,
    relevancyMap: props.relevancyMap,
    inclusionMap: props.inclusionMap,
    synergyMap: props.synergyMap,
    roleCounts: props.roleCounts,
    roleTargets: props.roleTargets,
    edhrecCurve: props.edhrecCurve,
    edhrecTypes: props.edhrecTypes,
  }), [cards, commanderName, partnerCommanderName, targetSize, landTarget, props.relevancyMap, props.inclusionMap, props.synergyMap, props.roleCounts, props.roleTargets, props.edhrecCurve, props.edhrecTypes]);

  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [listRef] = useAutoAnimate<HTMLUListElement>({ duration: 280, easing: 'ease-in-out' });

  const defaultsKey = useMemo(() => plan.cuts.map(c => c.card.name).join('|'), [plan.cuts]);
  useEffect(() => {
    setChecked(new Set(plan.cuts.map(c => c.card.name)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultsKey]);

  useEffect(() => {
    if (open) setLandTarget(Math.max(30, currentLandCount));
  }, [open, currentLandCount]);

  const overage = cards.length - targetSize;

  // Auto-close if there's no overage to trim (e.g., parent already trimmed,
  // or expected size was raised while open).
  useEffect(() => {
    if (open && overage <= 0) onClose();
  }, [open, overage, onClose]);

  if (overage <= 0) return null;

  return (
    <Drawer open={open} onClose={onClose} position="right" onPositionChange={() => {}}>
      <div className="flex flex-col h-full">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 px-5 py-4 border-b border-border">
          <div>
            <h2 className="text-lg font-bold flex items-center gap-2">
              <Scissors className="w-4 h-4 text-violet-400" />
              Trim deck to {targetSize} cards
            </h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              {overage} cards over target — pick which ones to cut
            </p>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 p-1 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            aria-label="Close trim drawer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Controls strip */}
        <div className="flex items-center gap-3 px-5 py-3 border-b border-border bg-muted/30 text-sm">
          <Mountain className="w-4 h-4 text-muted-foreground shrink-0" />
          <span className="text-muted-foreground">Lands to keep</span>
          <div className="inline-flex items-center rounded-md border border-border bg-background overflow-hidden">
            <button
              type="button"
              onClick={() => setLandTarget(v => Math.max(30, v - 1))}
              disabled={landTarget <= 30}
              className="px-2 py-1 hover:bg-accent transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              aria-label="Decrease land target"
            >
              <Minus className="w-3 h-3" />
            </button>
            <span className="px-3 py-1 min-w-[2rem] text-center font-semibold tabular-nums">
              {landTarget}
            </span>
            <button
              type="button"
              onClick={() => setLandTarget(v => Math.min(currentLandCount, v + 1))}
              disabled={landTarget >= currentLandCount}
              className="px-2 py-1 hover:bg-accent transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              aria-label="Increase land target"
            >
              <Plus className="w-3 h-3" />
            </button>
          </div>
          <span className="text-xs text-violet-300/80">
            → cut {plan.cutLands}
          </span>
        </div>

        {plan.relaxedGuardrail && (
          <div className="mx-5 mt-3 px-3 py-2 rounded border border-amber-500/30 bg-amber-500/10 text-amber-300 text-xs">
            All low-relevancy cards fill role gaps — guardrail relaxed for the last few cuts.
          </div>
        )}

        {checked.size < overage && (
          <div className="mx-5 mt-3 px-3 py-2 rounded border border-amber-500/30 bg-amber-500/10 text-amber-300 text-xs">
            Will trim {checked.size} of {overage} cards — uncheck fewer cards, or raise the land target to make up the difference.
          </div>
        )}

        {/* Card list */}
        <div className="flex-1 px-3 py-3 overflow-y-auto">
          <ul ref={listRef} className="space-y-2">
            {plan.allCandidates.map((cand) => {
              const isChecked = checked.has(cand.card.name);
              const toggle = () => {
                setChecked((prev) => {
                  const next = new Set(prev);
                  const partition = cand.partition;
                  if (next.has(cand.card.name)) {
                    next.delete(cand.card.name);
                    if (next.size < overage) {
                      const replacement = plan.allCandidates.find(c =>
                        c.partition === partition &&
                        !next.has(c.card.name) &&
                        c.card.name !== cand.card.name
                      );
                      if (replacement) next.add(replacement.card.name);
                    }
                  } else {
                    next.add(cand.card.name);
                  }
                  return next;
                });
              };
              const imageUrl = getCardImageUrl(cand.card, 'small');
              return (
                <li
                  key={cand.card.name}
                  data-state={isChecked ? 'active' : 'kept'}
                  className={[
                    'flex items-center gap-3 px-2 py-2 rounded-lg border transition-all duration-300 ease-out cursor-pointer',
                    'hover:bg-accent/40',
                    isChecked
                      ? 'opacity-100 translate-x-0 border-violet-500/20 bg-card'
                      : 'opacity-50 translate-x-3 border-emerald-500/30 bg-emerald-500/5',
                  ].join(' ')}
                  onClick={toggle}
                >
                  {/* Image thumbnail */}
                  <div className="shrink-0 w-12 h-16 rounded overflow-hidden bg-muted/30 border border-border/40">
                    {imageUrl && (
                      <img
                        src={imageUrl}
                        alt={cand.card.name}
                        loading="lazy"
                        className="w-full h-full object-cover object-top"
                      />
                    )}
                  </div>

                  {/* Checkbox / Kept pill */}
                  <div onClick={(e) => e.stopPropagation()} className="shrink-0">
                    {isChecked ? (
                      <Checkbox checked={isChecked} onCheckedChange={toggle} aria-label={`Cut ${cand.card.name}`} />
                    ) : (
                      <button
                        onClick={toggle}
                        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide text-emerald-300 bg-emerald-500/10 border border-emerald-500/30 hover:bg-emerald-500/20 transition-colors"
                        aria-label={`Restore ${cand.card.name} to the cut list`}
                      >
                        Kept
                      </button>
                    )}
                  </div>

                  {/* Main column */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium truncate">{cand.card.name}</span>
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-violet-300/80 bg-violet-500/10 border border-violet-500/30 rounded px-1.5 py-0.5 whitespace-nowrap">
                        {cand.reasonLabel}
                      </span>
                      {cand.card.mana_cost && (
                        <span className="text-xs"><ManaCost cost={cand.card.mana_cost} /></span>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5 line-clamp-2" title={cand.reasonText}>
                      {cand.reasonText}
                    </div>
                  </div>

                  {/* Stats column */}
                  <div className="shrink-0 text-right text-xs">
                    <div className="text-violet-300/80">rel {cand.relevancy}</div>
                    {(() => {
                      const pct = Math.round(cand.inclusion);
                      const hue = (pct / 100) * 120; // 0%=red, 50%=yellow, 100%=green
                      return (
                        <div
                          style={{ color: `hsl(${hue}, 70%, 55%)` }}
                          title={`${pct}% of EDHREC decks include this card`}
                        >
                          {pct}%
                        </div>
                      );
                    })()}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-2 px-5 py-3 border-t border-border">
          <div className="text-xs text-muted-foreground">
            {checked.size === overage
              ? `Cutting ${plan.cutLands} land${plan.cutLands === 1 ? '' : 's'}, ${checked.size - plan.cutLands} spell${(checked.size - plan.cutLands) === 1 ? '' : 's'}`
              : `Trim ${checked.size} of ${overage} — leaves ${cards.length - checked.size}/${targetSize}`}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button onClick={() => onConfirm([...checked])} disabled={checked.size === 0}>
              Trim {checked.size} cards
            </Button>
          </div>
        </div>
      </div>
    </Drawer>
  );
}
