// src/components/deck/optimizer/dashboard/NextBestMove.tsx
import { useState } from 'react';
import { Lightbulb, ArrowRight, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { ScryfallCard, PlanScore, Misfit, GapAnalysisCard, DetectedCombo } from '@/types';
import type { RoleBreakdown, CurvePhaseAnalysis } from '@/services/deckBuilder/deckAnalyzer';
import { TABS, type TabKey } from '../constants';

// Map TabKey → its sidebar icon (so suggestion nav buttons look like the tabs they open)
const TAB_ICONS: Partial<Record<TabKey, LucideIcon>> = Object.fromEntries(
  TABS.map(t => [t.key, t.icon]),
);

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
  /** Mana base verdict from analysis.manaBase.verdict */
  manaVerdict?: 'critically-low' | 'low' | 'slightly-low' | 'ok' | 'high';
  /** Current land count */
  currentLands?: number;
  /** Adjusted land suggestion from analysis.manaBase.adjustedSuggestion */
  suggestedLands?: number;
  /** True when EDHREC data is limited for this commander */
  limitedData?: boolean;
}

interface Suggestion {
  id: string;
  tier: 1 | 2 | 3;
  /** Card name recommended (used for dedup across suggestions). */
  cardName?: string;
  message: React.ReactNode;
  navigateTo?: TabKey;
  navLabel?: string;
}

function buildSuggestions(props: NextBestMoveProps): Suggestion[] {
  const {
    planScore, misfits, gapAnalysis, roleBreakdowns, curvePhases, detectedCombos, deckExcess,
    manaVerdict, currentLands, suggestedLands, limitedData,
  } = props;
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
      navigateTo: 'optimize',
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
      navigateTo: 'optimize',
      navLabel: 'Card Fit',
    });
  }

  // mana starved (tier 1, critical)
  if (manaVerdict === 'critically-low' && currentLands != null && suggestedLands != null) {
    candidates.push({
      id: 'mana-starved',
      tier: 1,
      message: (
        <>
          Mana base is starved — only <strong>{currentLands}</strong> lands, deck wants{' '}
          <strong>{suggestedLands}+</strong>. Add lands or trim non-land cards.
        </>
      ),
      navigateTo: 'lands',
      navLabel: 'Mana',
    });
  }

  // mana light (tier 1)
  if ((manaVerdict === 'low' || manaVerdict === 'slightly-low') && currentLands != null && suggestedLands != null) {
    candidates.push({
      id: 'mana-low',
      tier: 1,
      message: (
        <>
          Mana may be light — <strong>{currentLands}</strong> lands vs target{' '}
          <strong>{suggestedLands}</strong>.
        </>
      ),
      navigateTo: 'lands',
      navLabel: 'Mana',
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
      const alreadyCovered = candidates.some(c => c.navigateTo === 'optimize' && c.tier === 1);
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
              navigateTo: 'optimize',
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
              navigateTo: 'optimize',
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
          navigateTo: 'optimize',
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
          navigateTo: 'optimize',
          navLabel: 'Card Fit',
        });
        suggestedCards.add(missing);
      }
    }
  }

  // mana heavy (tier 3, info)
  if (manaVerdict === 'high' && currentLands != null && suggestedLands != null) {
    candidates.push({
      id: 'mana-heavy',
      tier: 3,
      message: (
        <>
          Running heavy on lands (<strong>{currentLands}</strong>, deck wants ~<strong>{suggestedLands}</strong>).
        </>
      ),
      navigateTo: 'lands',
      navLabel: 'Mana',
    });
  }

  // limited data (tier 3, info)
  if (limitedData) {
    candidates.push({
      id: 'limited-data',
      tier: 3,
      message: <>Limited EDHREC data for this commander — some sub-scores excluded.</>,
    });
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

/** Numbered badge — neutral violet for all rows (priority is just ordering). */
const BADGE_STYLE = 'bg-violet-500/20 text-violet-200';

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
    <div className="rounded-xl border border-violet-500/40 bg-gradient-to-br from-violet-500/10 via-violet-500/5 to-transparent p-4 animate-fade-in">
      <div className="flex items-center gap-1.5 mb-3">
        <Lightbulb className="w-3.5 h-3.5 text-violet-300" />
        <span className="text-[11px] uppercase tracking-wider font-semibold text-violet-300/80">
          Suggested next steps
        </span>
      </div>
      <div className="flex flex-col gap-1">
        {visible.map((s, i) => (
          <div
            key={s.id}
            className="group relative flex items-stretch gap-1 rounded-md hover:bg-violet-500/5 transition-colors cascade-in"
            style={{ '--cascade-i': i } as React.CSSProperties}
          >
            {s.navigateTo ? (
              <button
                type="button"
                onClick={() => props.onNavigate(s.navigateTo!)}
                className="flex-1 min-w-0 flex items-start gap-3 text-left px-2 py-2"
                aria-label={`Open ${s.navLabel}`}
              >
                <div className={`shrink-0 mt-0.5 w-5 h-5 rounded-full text-[10px] font-bold flex items-center justify-center ${BADGE_STYLE}`}>
                  {i + 1}
                </div>
                <div className="flex-1 min-w-0 flex flex-col sm:flex-row sm:items-start gap-2 sm:gap-3">
                  <div className="flex-1 min-w-0 text-sm text-foreground leading-relaxed">
                    {s.message}
                  </div>
                  {(() => {
                    const TabIcon = TAB_ICONS[s.navigateTo!];
                    return (
                      <div className="shrink-0 self-start sm:self-center inline-flex items-center gap-1.5 px-2 py-1 rounded-md border border-violet-500/40 bg-violet-500/10 text-xs text-violet-200 group-hover:bg-violet-500/20 group-hover:text-violet-100 group-hover:border-violet-500/60 transition-colors whitespace-nowrap">
                        {TabIcon && <TabIcon className="w-3 h-3" />}
                        <span>{s.navLabel}</span>
                        <ArrowRight className="w-3 h-3" />
                      </div>
                    );
                  })()}
                </div>
              </button>
            ) : (
              <div className="flex-1 min-w-0 flex items-start gap-3 px-2 py-2">
                <div className={`shrink-0 mt-0.5 w-5 h-5 rounded-full text-[10px] font-bold flex items-center justify-center ${BADGE_STYLE}`}>
                  {i + 1}
                </div>
                <div className="flex-1 min-w-0 text-sm text-foreground leading-relaxed">
                  {s.message}
                </div>
              </div>
            )}
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); dismiss(s.id); }}
              aria-label="Dismiss suggestion"
              title="Dismiss"
              className="shrink-0 self-center p-1.5 rounded text-muted-foreground/80 hover:text-foreground hover:bg-violet-500/20 transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
