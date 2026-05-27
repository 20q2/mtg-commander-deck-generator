import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Scissors } from 'lucide-react';
import type { ScryfallCard } from '@/types';
import { planTrim, type TrimResult } from '@/services/deckBuilder/deckTrimmer';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { ManaCost } from '@/components/ui/mtg-icons';
import { getFrontFaceTypeLine } from '@/services/scryfall/client';

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

  const [landTarget, setLandTarget] = useState<number>(36);

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

  const defaultsKey = useMemo(() => plan.cuts.map(c => c.card.name).join('|'), [plan.cuts]);
  useEffect(() => {
    setChecked(new Set(plan.cuts.map(c => c.card.name)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultsKey]);

  useEffect(() => {
    if (open) setLandTarget(36);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  if (!open) return null;

  const overage = cards.length - targetSize;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm animate-fade-in overflow-y-auto p-4"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-2xl my-auto bg-card border border-border rounded-2xl shadow-2xl animate-scale-in"
        onClick={(e) => e.stopPropagation()}
      >
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
            aria-label="Close trim dialog"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Controls strip (filled in Task 5) */}
        <div className="px-5 py-3 border-b border-border bg-muted/30 text-sm text-muted-foreground">
          Land target: {landTarget} — controls wired in next step
        </div>

        {/* Card list */}
        <div className="px-5 py-3 max-h-[50vh] overflow-y-auto">
          <ul className="space-y-1">
            {plan.allCandidates.map((cand) => {
              const isChecked = checked.has(cand.card.name);
              const toggle = () => {
                setChecked((prev) => {
                  const next = new Set(prev);
                  if (next.has(cand.card.name)) next.delete(cand.card.name);
                  else next.add(cand.card.name);
                  return next;
                });
              };
              return (
                <li
                  key={cand.card.name}
                  data-state={isChecked ? 'active' : 'kept'}
                  className="flex items-center gap-3 px-2 py-1.5 rounded transition-all duration-300 hover:bg-accent/40 data-[state=kept]:opacity-40 data-[state=kept]:translate-x-6"
                >
                  <Checkbox checked={isChecked} onCheckedChange={toggle} aria-label={`Cut ${cand.card.name}`} />
                  <div className="shrink-0 w-16 text-xs">
                    {cand.card.mana_cost && <ManaCost cost={cand.card.mana_cost} />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium truncate">{cand.card.name}</span>
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-violet-300/80 bg-violet-500/10 border border-violet-500/30 rounded px-1.5 py-0.5">
                        {cand.reasonLabel}
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground truncate" title={cand.reasonText}>
                      {getFrontFaceTypeLine(cand.card)} · {cand.reasonText}
                    </div>
                  </div>
                  <div className="shrink-0 text-right text-xs">
                    <div className="text-violet-300/80">rel {cand.relevancy}</div>
                    <div className="text-muted-foreground">{cand.inclusion.toFixed(0)}%</div>
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
              : `Will trim ${checked.size} of ${overage} — deck will be ${cards.length - checked.size}/${targetSize}`}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button onClick={() => onConfirm([...checked])} disabled={checked.size === 0}>
              Trim {checked.size} cards
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
