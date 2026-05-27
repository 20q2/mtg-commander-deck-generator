import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Scissors } from 'lucide-react';
import { useAutoAnimate } from '@formkit/auto-animate/react';
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

        {/* Controls strip */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 border-b border-border bg-muted/30">
          <label className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Keep</span>
            <input
              type="number"
              min={30}
              max={currentLandCount}
              value={landTarget}
              onChange={(e) => setLandTarget(parseInt(e.target.value, 10) || 0)}
              onBlur={(e) => {
                const v = parseInt(e.target.value, 10) || 0;
                const clamped = Math.max(30, Math.min(currentLandCount, v));
                if (clamped !== v) setLandTarget(clamped);
              }}
              className="w-16 px-2 py-1 rounded border border-border bg-background text-center"
              aria-label="Land count to keep"
            />
            <span className="text-muted-foreground">lands</span>
            <span className="text-xs text-violet-300/80">
              → cut {plan.cutLands} land{plan.cutLands === 1 ? '' : 's'}
            </span>
          </label>
          <div className="text-xs text-muted-foreground">
            Cutting <span className="font-semibold text-foreground">{overage}</span> cards —
            <span className="font-semibold text-foreground"> {plan.cutLands}</span> lands,
            <span className="font-semibold text-foreground"> {plan.cutSpells}</span> spells
          </div>
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
        <div className="px-5 py-3 max-h-[50vh] overflow-y-auto">
          <ul ref={listRef} className="space-y-1">
            {plan.allCandidates.map((cand) => {
              const isChecked = checked.has(cand.card.name);
              const toggle = () => {
                setChecked((prev) => {
                  const next = new Set(prev);
                  const partition = cand.partition;
                  if (next.has(cand.card.name)) {
                    next.delete(cand.card.name);
                    const desiredCount = overage;
                    if (next.size < desiredCount) {
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
              return (
                <li
                  key={cand.card.name}
                  data-state={isChecked ? 'active' : 'kept'}
                  className={[
                    'flex items-center gap-3 px-2 rounded transition-all duration-300 ease-out',
                    'hover:bg-accent/40',
                    isChecked
                      ? 'py-1.5 opacity-100 translate-x-0'
                      : 'py-1 opacity-40 translate-x-6 bg-emerald-500/5',
                  ].join(' ')}
                >
                  {isChecked ? (
                    <Checkbox checked={isChecked} onCheckedChange={toggle} aria-label={`Cut ${cand.card.name}`} />
                  ) : (
                    <button
                      onClick={toggle}
                      className="shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide text-emerald-300 bg-emerald-500/10 border border-emerald-500/30 hover:bg-emerald-500/20 transition-colors"
                      aria-label={`Restore ${cand.card.name} to the cut list`}
                    >
                      Kept
                    </button>
                  )}
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
