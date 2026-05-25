// src/components/deck/optimizer/dashboard/NextBestMove.tsx
import { useState } from 'react';
import { Lightbulb, ArrowRight, AlertTriangle, Sparkles, X } from 'lucide-react';
import type { ScryfallCard, PlanScore, Misfit, GapAnalysisCard, DetectedCombo } from '@/types';
import type { RoleBreakdown, CurvePhaseAnalysis } from '@/services/deckBuilder/deckAnalyzer';
import type { TabKey } from '../constants';

export interface NextBestMoveProps {
  planScore?: PlanScore;
  misfits?: Misfit[];
  gapAnalysis?: GapAnalysisCard[];
  roleBreakdowns?: RoleBreakdown[];
  curvePhases?: CurvePhaseAnalysis[];
  detectedCombos?: DetectedCombo[];
  /** Number of cards over deck target (positive = over, negative = under). */
  deckExcess: number;
  commander: ScryfallCard;
  onNavigate: (tab: TabKey) => void;
}

interface Suggestion {
  id: string;
  tier: 1 | 2 | 3;
  /** Card name recommended (used for dedup across suggestions). */
  cardName?: string;
  message: React.ReactNode;
  navigateTo: TabKey;
  navLabel: string;
}

function buildSuggestions(props: NextBestMoveProps): Suggestion[] {
  const { planScore, misfits, gapAnalysis, roleBreakdowns, curvePhases, detectedCombos, deckExcess } = props;
  if (!planScore) return [];

  const candidates: Suggestion[] = [];

  // ── Tier 1: Critical structural issues ──────────────────────────────

  // trim-over-target
  if (deckExcess > 0 && misfits && misfits.length > 0) {
    const worst = misfits[0];
    const replacement = worst.suggestedReplacement;
    candidates.push({
      id: `trim-${worst.card.name}`,
      tier: 1,
      cardName: worst.card.name,
      message: (
        <>
          Trim <strong className="text-rose-300">{worst.card.name}</strong> — you're{' '}
          <strong>{deckExcess}</strong> card{deckExcess !== 1 ? 's' : ''} over target
          {replacement && (
            <>. Consider swapping in <strong className="text-violet-300">{replacement.name}</strong> ({Math.round(replacement.inclusion)}% of decks)</>
          )}
          {!replacement && <>.{' '}</>}
        </>
      ),
      navigateTo: 'cardFit',
      navLabel: 'Card Fit',
    });
  }

  // fill-under-target
  if (deckExcess < 0 && gapAnalysis && gapAnalysis.length > 0) {
    const topGap = gapAnalysis[0];
    const abs = Math.abs(deckExcess);
    candidates.push({
      id: `fill-${topGap.name}`,
      tier: 1,
      cardName: topGap.name,
      message: (
        <>
          Add <strong className="text-violet-300">{topGap.name}</strong> — you're{' '}
          <strong>{abs}</strong> card{abs !== 1 ? 's' : ''} under target, and this one's in{' '}
          {Math.round(topGap.inclusion)}% of decks.
        </>
      ),
      navigateTo: 'cardFit',
      navLabel: 'Card Fit',
    });
  }

  // ── Tier 2: Quality — sub-score weak areas ───────────────────────────

  type SubKey = 'strategy' | 'roles' | 'tempo' | 'cardFit';
  const subOrder: SubKey[] = ['cardFit', 'roles', 'tempo', 'strategy'];

  // Collect sub-scores below 75 (non-partial), sorted worst-first
  const weakSubs: { key: SubKey; value: number }[] = [];
  for (const k of subOrder) {
    const s = planScore.subscores[k];
    if (!s.partial && s.value < 75) {
      weakSubs.push({ key: k, value: s.value });
    }
  }
  weakSubs.sort((a, b) => a.value - b.value);

  // Track suggested card names to avoid cross-suggestion dupes
  const suggestedCards = new Set<string>(candidates.map(c => c.cardName).filter(Boolean) as string[]);

  for (const { key: weakest } of weakSubs) {
    if (weakest === 'cardFit') {
      // Only generate if not already covered by tier-1 trim/fill suggestions
      const alreadyCovered = candidates.some(c => c.navigateTo === 'cardFit' && c.tier === 1);
      if (!alreadyCovered) {
        if (misfits && misfits.length > 0) {
          const worst = misfits[0];
          const replacement = worst.suggestedReplacement;
          if (!suggestedCards.has(worst.card.name)) {
            candidates.push({
              id: `cardfit-trim-${worst.card.name}`,
              tier: 2,
              cardName: worst.card.name,
              message: (
                <>
                  Card Fit is weak — <strong className="text-rose-300">{worst.card.name}</strong> doesn't fit your plan
                  {replacement && !suggestedCards.has(replacement.name) && (
                    <>. Try <strong className="text-violet-300">{replacement.name}</strong> ({Math.round(replacement.inclusion)}% of decks) instead</>
                  )}
                  .
                </>
              ),
              navigateTo: 'cardFit',
              navLabel: 'Card Fit',
            });
            suggestedCards.add(worst.card.name);
          }
        } else if (gapAnalysis && gapAnalysis.length > 0) {
          const top = gapAnalysis.find(g => !suggestedCards.has(g.name));
          if (top) {
            candidates.push({
              id: `cardfit-gap-${top.name}`,
              tier: 2,
              cardName: top.name,
              message: (
                <>
                  Card Fit is weak — try adding <strong className="text-violet-300">{top.name}</strong>, played in {Math.round(top.inclusion)}% of decks like this.
                </>
              ),
              navigateTo: 'cardFit',
              navLabel: 'Card Fit',
            });
            suggestedCards.add(top.name);
          }
        }
      }
    }

    if (weakest === 'roles' && roleBreakdowns) {
      // Find role with lowest current/target ratio and a deficit
      let worstRole: RoleBreakdown | null = null;
      let worstRatio = Infinity;
      for (const rb of roleBreakdowns) {
        const deficit = rb.target - rb.current;
        if (deficit <= 0) continue;
        const target = rb.target || 1;
        const ratio = rb.current / target;
        if (ratio < worstRatio) {
          worstRatio = ratio;
          worstRole = rb;
        }
      }
      if (worstRole) {
        const sameRoleGap = gapAnalysis?.find(g => g.role === worstRole!.role && !suggestedCards.has(g.name));
        candidates.push({
          id: `role-${worstRole.role}`,
          tier: 2,
          cardName: sameRoleGap?.name,
          message: (
            <>
              Light on <strong className="text-foreground">{worstRole.label}</strong> ({worstRole.current} of {worstRole.target})
              {sameRoleGap
                ? <>. Try <strong className="text-violet-300">{sameRoleGap.name}</strong> ({Math.round(sameRoleGap.inclusion)}% inclusion).</>
                : <> — add more {worstRole.label.toLowerCase()} pieces.</>
              }
            </>
          ),
          navigateTo: 'roles',
          navLabel: 'Roles',
        });
        if (sameRoleGap) suggestedCards.add(sameRoleGap.name);
      }
    }

    if (weakest === 'tempo' && curvePhases) {
      // Find weakest curve phase by current/target ratio
      let worstPhase: CurvePhaseAnalysis | null = null;
      let worstRatio = Infinity;
      for (const phase of curvePhases) {
        const target = phase.target || 1;
        const ratio = phase.current / target;
        if (ratio < worstRatio) {
          worstRatio = ratio;
          worstPhase = phase;
        }
      }
      if (worstPhase) {
        const deficit = Math.max(0, worstPhase.target - worstPhase.current);
        const [minCmc, maxCmc] = worstPhase.cmcRange;
        // Try to find a gap card in the weak phase's CMC range
        const phaseGap = gapAnalysis?.find(
          g => g.cmc != null && g.cmc >= minCmc && g.cmc <= maxCmc && !suggestedCards.has(g.name)
        );
        candidates.push({
          id: `tempo-${worstPhase.phase}`,
          tier: 2,
          cardName: phaseGap?.name,
          message: (
            <>
              <strong className="text-sky-300">{worstPhase.label}</strong> is light ({worstPhase.current} cards, target {worstPhase.target}{deficit > 0 ? `, ${deficit} short` : ''})
              {phaseGap
                ? <>. <strong className="text-violet-300">{phaseGap.name}</strong> (CMC {phaseGap.cmc}) fits this window.</>
                : <>. Look for cards in the CMC {minCmc}–{maxCmc} range.</>
              }
            </>
          ),
          navigateTo: 'curve',
          navLabel: 'Tempo',
        });
        if (phaseGap) suggestedCards.add(phaseGap.name);
      }
    }

    if (weakest === 'strategy') {
      // Highest-synergy gap card not yet suggested
      const themeGap = gapAnalysis?.find(g => g.synergy > 0 && !suggestedCards.has(g.name));
      if (themeGap) {
        candidates.push({
          id: `strategy-${themeGap.name}`,
          tier: 2,
          cardName: themeGap.name,
          message: (
            <>
              Strategy is thin — <strong className="text-violet-300">{themeGap.name}</strong> would help (synergy +{themeGap.synergy.toFixed(2)}, played in {Math.round(themeGap.inclusion)}% of builds).
            </>
          ),
          navigateTo: 'cardFit',
          navLabel: 'Card Fit',
        });
        suggestedCards.add(themeGap.name);
      }
    }
  }

  // ── Tier 3: Polish — near-miss combos ───────────────────────────────

  if (detectedCombos) {
    const nearMiss = detectedCombos.find(c => !c.isComplete && c.missingCards.length === 1);
    if (nearMiss) {
      const missing = nearMiss.missingCards[0];
      const result = nearMiss.results[0] ?? 'this combo';
      if (!suggestedCards.has(missing)) {
        candidates.push({
          id: `combo-${nearMiss.comboId}`,
          tier: 3,
          cardName: missing,
          message: (
            <>
              Complete the <strong className="text-foreground">{result}</strong> combo — you're 1 card away (<strong className="text-violet-300">{missing}</strong>).
            </>
          ),
          navigateTo: 'cardFit',
          navLabel: 'Card Fit',
        });
        suggestedCards.add(missing);
      }
    }
  }

  // ── Dedup by id, sort by tier (stable), take top 3 ──────────────────
  const seenIds = new Set<string>();
  const deduped = candidates.filter(c => {
    if (seenIds.has(c.id)) return false;
    seenIds.add(c.id);
    return true;
  });
  deduped.sort((a, b) => a.tier - b.tier);
  return deduped;
}

const MAX_SHOWN = 3;

const TIER_ICONS = {
  1: AlertTriangle,
  2: Lightbulb,
  3: Sparkles,
} as const;

const TIER_ICON_COLORS = {
  1: 'text-amber-400',
  2: 'text-violet-300',
  3: 'text-sky-400',
} as const;

export function NextBestMove(props: NextBestMoveProps) {
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const allSuggestions = buildSuggestions(props);
  const visible = allSuggestions.filter(s => !dismissed.has(s.id)).slice(0, MAX_SHOWN);
  if (visible.length === 0) return null;

  const dismiss = (id: string) => {
    setDismissed(prev => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  };

  return (
    <div className="rounded-xl border border-violet-500/40 bg-gradient-to-br from-violet-500/10 via-violet-500/5 to-transparent p-4">
      <div className="flex items-center gap-1.5 mb-3">
        <Lightbulb className="w-3.5 h-3.5 text-violet-300" />
        <span className="text-[10px] uppercase tracking-wider font-semibold text-violet-300/80">
          Suggested next steps
        </span>
      </div>
      <div className="space-y-1.5">
        {visible.map((s, i) => {
          const Icon = TIER_ICONS[s.tier];
          const iconColor = TIER_ICON_COLORS[s.tier];
          return (
            <div
              key={s.id}
              className="group flex items-start gap-3 p-2 -mx-2 rounded-md hover:bg-violet-500/10 transition-colors"
            >
              <button
                type="button"
                onClick={() => props.onNavigate(s.navigateTo)}
                className="flex-1 min-w-0 flex items-start gap-3 text-left"
                aria-label={`Open ${s.navLabel}`}
              >
                <div className="shrink-0 mt-0.5 w-5 h-5 rounded-full bg-violet-500/20 text-violet-300 text-[10px] font-bold flex items-center justify-center">
                  {i + 1}
                </div>
                <div className="flex-1 min-w-0 text-sm text-foreground/95 leading-relaxed">
                  {s.message}
                </div>
                <div className="shrink-0 self-center flex items-center gap-1 text-[11px] text-violet-300/80 group-hover:text-violet-200 transition-colors">
                  <Icon className={`w-3 h-3 ${iconColor}`} />
                  {s.navLabel} <ArrowRight className="w-3 h-3 ml-0.5" />
                </div>
              </button>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); dismiss(s.id); }}
                aria-label="Dismiss suggestion"
                title="Dismiss"
                className="shrink-0 self-center p-1 rounded text-muted-foreground/60 hover:text-foreground hover:bg-violet-500/20 transition-colors"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
