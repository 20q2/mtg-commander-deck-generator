import { Gauge, AlertTriangle, ChevronRight, Zap, Sparkles } from 'lucide-react';
import { useStore } from '@/store';
import { BRACKET_COLORS, BRACKET_LABELS, BRACKET_DESCRIPTIONS, scryfallImg } from './constants';
import type { BracketEstimation, BracketBreakdown } from '@/services/deckBuilder/bracketEstimator';
import type { DetectedCombo } from '@/types';

// ─── Clickable Card Chip ─────────────────────────────────────────────

function CardChip({ name, onPreview }: { name: string; onPreview: (name: string) => void }) {
  return (
    <button
      onClick={() => onPreview(name)}
      className="inline-flex items-center gap-1.5 py-0.5 px-1.5 rounded-md bg-accent/30 hover:bg-accent/60 transition-colors group"
    >
      <img
        src={scryfallImg(name)}
        alt=""
        className="w-5 h-auto rounded shadow-sm shrink-0"
        loading="lazy"
        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
      />
      <span className="text-[11px] text-foreground/80 group-hover:text-primary transition-colors">{name}</span>
    </button>
  );
}

// ─── Bracket Scale ───────────────────────────────────────────────────

function BracketScale({ activeBracket }: { activeBracket: number }) {
  return (
    <div className="flex flex-col gap-1.5">
      {[1, 2, 3, 4, 5].map(n => {
        const isActive = n === activeBracket;
        const colors = BRACKET_COLORS[n];
        return (
          <div
            key={n}
            className={`flex items-center gap-2.5 px-2.5 py-1.5 rounded-md transition-all ${
              isActive
                ? `${colors.bg} ${colors.border} border`
                : ''
            }`}
          >
            <span className={`text-sm font-bold tabular-nums w-4 text-center ${isActive ? colors.text : 'text-muted-foreground/30'}`}>{n}</span>
            <span className={`text-[11px] ${isActive ? `${colors.text} font-semibold` : 'text-muted-foreground/30'}`}>
              {BRACKET_LABELS[n]}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ─── Hard Floor Entry ────────────────────────────────────────────────

function HardFloorRow({ bracket, reason, detail, relatedCards, onPreview }: {
  bracket: number;
  reason: string;
  detail?: string;
  relatedCards: string[];
  onPreview: (name: string) => void;
}) {
  const colors = BRACKET_COLORS[bracket] || BRACKET_COLORS[3];
  return (
    <div className={`flex gap-3 p-2.5 border-l-2 ${colors.border.replace('/30', '/60')}`}>
      <div className="shrink-0 flex flex-col items-center gap-0.5">
        <AlertTriangle className={`w-3.5 h-3.5 ${colors.text}`} />
        <span className={`text-[11px] font-bold ${colors.text}`}>{bracket}+</span>
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium">{reason}</p>
        {detail && <p className="text-[10px] text-muted-foreground/70 leading-relaxed mt-0.5">{detail}</p>}
        {relatedCards.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1.5">
            {relatedCards.map(name => (
              <CardChip key={name} name={name} onPreview={onPreview} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Soft Score Bar (with inline card chips) ─────────────────────────

const SCORE_CATEGORY_COLORS: Record<string, string> = {
  fastMana: 'hsl(38, 80%, 55%)',     // amber
  tutors: 'hsl(200, 80%, 55%)',      // sky
  cmc: 'hsl(155, 60%, 45%)',         // emerald
  interaction: 'hsl(340, 65%, 55%)', // rose
};

function SoftScoreBar({ label, value, max, detail, colorKey, cardNames, onPreview }: {
  label: string;
  value: number;
  max: number;
  detail: string;
  colorKey: string;
  cardNames?: string[];
  onPreview: (name: string) => void;
}) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  const color = SCORE_CATEGORY_COLORS[colorKey] || SCORE_CATEGORY_COLORS.fastMana;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium">{label}</span>
        <span className="text-xs text-muted-foreground tabular-nums">{value} / {max}</span>
      </div>
      <div className="h-1.5 rounded-full bg-accent/40 overflow-hidden">
        <div
          className="h-full rounded-full animate-bar-grow"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
      <p className="text-[10px] text-muted-foreground/70">{detail}</p>
      {cardNames && cardNames.length > 0 && (
        <div className="flex flex-wrap gap-1 pt-0.5">
          {cardNames.map(name => (
            <CardChip key={name} name={name} onPreview={onPreview} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Combo Section ───────────────────────────────────────────────────

function ComboSection({ combos, onPreview }: { combos: DetectedCombo[]; onPreview: (name: string) => void }) {
  const completeCombos = combos.filter(c => c.isComplete);
  const early = completeCombos.filter(c => {
    const b = parseInt(c.bracket, 10);
    return !isNaN(b) && b >= 4;
  });
  const late = completeCombos.filter(c => {
    const b = parseInt(c.bracket, 10);
    return !isNaN(b) && b === 3;
  });

  if (completeCombos.length === 0) return null;

  const renderComboGroup = (label: string, comboList: DetectedCombo[], colorClass: string) => {
    if (comboList.length === 0) return null;
    return (
      <div className="space-y-1.5">
        <p className={`text-[11px] font-semibold uppercase tracking-wider ${colorClass}`}>
          {label} ({comboList.length})
        </p>
        {comboList.map((combo, i) => (
          <div key={combo.comboId || i} className="bg-card/40 border border-border/20 rounded-lg p-2">
            <div className="flex flex-wrap gap-1">
              {combo.cards.map((card, ci) => (
                <span key={card} className="inline-flex items-center">
                  <CardChip name={card} onPreview={onPreview} />
                  {ci < combo.cards.length - 1 && <span className="text-muted-foreground/30 mx-0.5">+</span>}
                </span>
              ))}
            </div>
            {combo.results.length > 0 && (
              <div className="flex items-start gap-1.5 mt-1.5">
                <ChevronRight className="w-3 h-3 text-muted-foreground/40 shrink-0 mt-0.5" />
                <p className="text-[10px] text-muted-foreground/70 leading-relaxed line-clamp-2">
                  {combo.results.join('. ')}
                </p>
              </div>
            )}
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="bg-card/60 border border-border/30 rounded-lg p-3 space-y-2">
      <div className="flex items-center gap-2">
        <Sparkles className="w-3.5 h-3.5 text-muted-foreground/60" />
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Combos</span>
        <span className="text-[11px] text-muted-foreground/60">({completeCombos.length} complete)</span>
      </div>
      {renderComboGroup('Early-Game (Bracket 4+)', early, 'text-orange-400')}
      {renderComboGroup('Late-Game (Bracket 3)', late, 'text-amber-400')}
    </div>
  );
}

// ─── Compact Calculation Summary ─────────────────────────────────────

function CalculationSummary({ est }: { est: BracketEstimation }) {
  const floor = est.hardFloors.length > 0
    ? Math.max(...est.hardFloors.map(f => f.bracket))
    : 1;
  const floorColors = BRACKET_COLORS[floor] || BRACKET_COLORS[1];
  const finalColors = BRACKET_COLORS[est.bracket];

  const wasElevatedTo5 = floor >= 4 && est.softScore >= 80 && est.bracket === 5;
  const wasElevatedBy1 = floor < 4 && est.softScore >= 66 && est.bracket === floor + 1;
  const wasElevated = wasElevatedTo5 || wasElevatedBy1;

  return (
    <div className="bg-card/60 border border-border/30 rounded-lg p-3">
      <div className="flex items-center gap-2 mb-2">
        <Gauge className="w-3.5 h-3.5 text-muted-foreground/60" />
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Result</span>
      </div>
      <div className="flex items-center gap-3 flex-wrap text-xs">
        <span className="text-muted-foreground">
          Hard floor: <span className={`font-bold ${floorColors.text}`}>{floor}</span>
        </span>
        <span className="text-muted-foreground/30">+</span>
        <span className="text-muted-foreground">
          Soft score: <span className="font-bold text-foreground/80">{est.softScore}/100</span>
        </span>
        {wasElevated && (
          <>
            <span className="text-muted-foreground/30">=</span>
            <span className="text-muted-foreground">
              {wasElevatedTo5
                ? <span className="text-red-400">Score {'\u2265'}80 + floor 4+ pushed to 5</span>
                : <span className={finalColors.text}>Score {'\u2265'}66 bumped {floor} {'\u2192'} {est.bracket}</span>
              }
            </span>
          </>
        )}
        <span className="text-muted-foreground/30">{'\u2192'}</span>
        <span className={`font-bold ${finalColors.text}`}>
          Bracket {est.bracket}
        </span>
      </div>
    </div>
  );
}

// ─── Soft Score Computation ──────────────────────────────────────────

function computeSoftComponents(b: BracketBreakdown) {
  return {
    fastMana: Math.min(40, b.fastManaCount * 8),
    tutors: Math.min(25, b.tutorCount * 5),
    cmc: Math.round(Math.min(20, Math.max(0, (3.5 - b.averageCmc) * 15))),
    interaction: Math.min(15, Math.max(0, (b.interactionCount - 8) * 2)),
  };
}

// ─── Get combo card names for hard floor display ─────────────────────

function getComboFloorCards(combos: DetectedCombo[] | undefined, floorReason: string): string[] {
  if (!combos) return [];
  const r = floorReason.toLowerCase();
  if (!r.includes('combo')) return [];
  const isEarly = r.includes('early');
  const relevant = combos.filter(c => {
    if (!c.isComplete) return false;
    const b = parseInt(c.bracket, 10);
    if (isNaN(b)) return false;
    return isEarly ? b >= 4 : b === 3;
  });
  const allCards = new Set<string>();
  for (const combo of relevant) {
    for (const card of combo.cards) allCards.add(card);
  }
  return [...allCards];
}

// ─── Main Export ─────────────────────────────────────────────────────

export function BracketTabContent({ onPreview }: { onPreview: (name: string) => void }) {
  const bracketEstimation = useStore(s => s.generatedDeck?.bracketEstimation);
  const detectedCombos = useStore(s => s.generatedDeck?.detectedCombos);

  if (!bracketEstimation) {
    return (
      <div className="bg-card/60 border border-border/30 rounded-lg p-6 text-center">
        <Gauge className="w-6 h-6 text-muted-foreground/40 mx-auto mb-2" />
        <p className="text-xs text-muted-foreground">Generate a deck to see bracket analysis</p>
      </div>
    );
  }

  const est = bracketEstimation;
  const colors = BRACKET_COLORS[est.bracket];
  const b = est.breakdown;
  const soft = computeSoftComponents(b);

  // Map hard floors to their related card names
  const floorCardMap = (floor: { bracket: number; reason: string }): string[] => {
    const r = floor.reason.toLowerCase();
    if (r.includes('game changer')) return b.gameChangerNames;
    if (r.includes('land denial')) return b.massLandDenialNames;
    if (r.includes('extra turn')) return b.extraTurnNames;
    if (r.includes('combo')) return getComboFloorCards(detectedCombos, floor.reason);
    return [];
  };

  // Threshold state
  const floor = est.hardFloors.length > 0
    ? Math.max(...est.hardFloors.map(f => f.bracket))
    : 1;
  const score66Met = est.softScore >= 66;
  const score80Met = est.softScore >= 80;

  return (
    <div className="space-y-3">

      {/* ── Header ── */}
      <div className="grid grid-cols-1 sm:grid-cols-[1fr,auto] gap-3">
        {/* Left: Rating + Hard Floors */}
        <div className="rounded-lg border border-border/30 bg-card/60 p-4 space-y-3">
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-lg ${colors.bg}`}>
              <Gauge className={`w-5 h-5 ${colors.text}`} />
            </div>
            <div>
              <div className="flex items-baseline gap-2">
                <span className={`text-2xl font-bold ${colors.text}`}>{est.bracket}</span>
                <span className={`text-sm font-semibold ${colors.text}`}>{est.label}</span>
              </div>
              <p className="text-xs text-muted-foreground/80">{BRACKET_DESCRIPTIONS[est.bracket]}</p>
            </div>
          </div>
          {est.hardFloors.length > 0 && (
            <div className="border-t border-border/20 pt-2.5 space-y-1.5">
              <div className="flex items-center gap-1.5">
                <AlertTriangle className="w-3 h-3 text-muted-foreground/60" />
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Hard Floors</span>
                <span className="text-[10px] text-muted-foreground/60">
                  — min bracket {floor} from {est.hardFloors.length} rule{est.hardFloors.length > 1 ? 's' : ''}
                </span>
              </div>
              <div className="space-y-1">
                {[...est.hardFloors]
                  .sort((a, b2) => b2.bracket - a.bracket)
                  .map((hf, i) => (
                    <HardFloorRow
                      key={i}
                      bracket={hf.bracket}
                      reason={hf.reason}
                      detail={hf.detail}
                      relatedCards={floorCardMap(hf)}
                      onPreview={onPreview}
                    />
                  ))}
              </div>
            </div>
          )}
        </div>
        {/* Right: Scale */}
        <div className="rounded-lg border border-border/30 bg-card/60 p-3 sm:min-w-[160px]">
          <BracketScale activeBracket={est.bracket} />
        </div>
      </div>

      {/* ── Soft Score with inline cards ── */}
      <div className="bg-card/60 border border-border/30 rounded-lg p-3 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Zap className="w-3.5 h-3.5 text-muted-foreground/60" />
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Soft Score</span>
          </div>
          <span className={`text-sm font-bold tabular-nums ${colors.text}`}>{est.softScore} / 100</span>
        </div>
        <p className="text-[10px] text-muted-foreground/70 leading-relaxed -mt-1.5">
          Measures how optimized your deck is within its bracket. Fast mana, tutors, low curve, and heavy interaction all add points.
          {est.softScore < 66 ? ' Your deck plays at a relaxed pace for its bracket.'
            : est.softScore < 80 ? ' Your deck is moderately tuned — consistent but not cutthroat.'
            : ' Your deck is highly optimized and will play at the top end of its bracket.'}
        </p>

        <div className="space-y-3">
          <SoftScoreBar
            label="Fast Mana"
            value={soft.fastMana}
            max={40}
            detail={b.fastManaCount > 0 ? `${b.fastManaCount} source${b.fastManaCount > 1 ? 's' : ''} \u00d7 8 pts` : 'No fast mana sources'}
            colorKey="fastMana"
            cardNames={b.fastManaNames}
            onPreview={onPreview}
          />
          <SoftScoreBar
            label="Tutors"
            value={soft.tutors}
            max={25}
            detail={b.tutorCount > 0 ? `${b.tutorCount} tutor${b.tutorCount > 1 ? 's' : ''} \u00d7 5 pts` : 'No tutors detected'}
            colorKey="tutors"
            cardNames={b.tutorNames}
            onPreview={onPreview}
          />
          <SoftScoreBar
            label="Low Average CMC"
            value={soft.cmc}
            max={20}
            detail={`Avg CMC ${b.averageCmc.toFixed(2)} ${b.averageCmc < 3.5 ? `(${(3.5 - b.averageCmc).toFixed(2)} below 3.5 threshold)` : '(no bonus above 3.5)'}`}
            colorKey="cmc"
            onPreview={onPreview}
          />
          <SoftScoreBar
            label="Interaction Density"
            value={soft.interaction}
            max={15}
            detail={b.interactionCount > 8 ? `${b.interactionCount} removal + wipes (${b.interactionCount - 8} above baseline of 8)` : `${b.interactionCount} removal + wipes (bonus starts above 8)`}
            colorKey="interaction"
            onPreview={onPreview}
          />
        </div>

        {/* Thresholds — compact inline */}
        <div className="border-t border-border/20 pt-2 flex flex-wrap gap-x-4 gap-y-1">
          <div className="flex items-center gap-1.5">
            <div className={`w-1.5 h-1.5 rounded-full ${score66Met ? 'bg-emerald-400' : 'bg-muted-foreground/20'}`} />
            <p className={`text-[11px] ${score66Met ? 'text-foreground/70' : 'text-muted-foreground/40'}`}>
              {'\u2265'}66 + floor {'<'}4: +1 bracket
              {score66Met && floor < 4 && <span className="text-emerald-400 ml-1">{'\u2714'}</span>}
              {score66Met && floor >= 4 && <span className="text-muted-foreground/40 ml-1">(floor too high)</span>}
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            <div className={`w-1.5 h-1.5 rounded-full ${score80Met ? 'bg-red-400' : 'bg-muted-foreground/20'}`} />
            <p className={`text-[11px] ${score80Met ? 'text-foreground/70' : 'text-muted-foreground/40'}`}>
              {'\u2265'}80 + floor 4+: cEDH
              {score80Met && floor >= 4 && <span className="text-red-400 ml-1">{'\u2714'}</span>}
              {!score80Met && <span className="text-muted-foreground/40 ml-1">({80 - est.softScore} more)</span>}
            </p>
          </div>
        </div>
      </div>

      {/* ── Combos (only if any exist) ── */}
      {detectedCombos && detectedCombos.some(c => c.isComplete) && (
        <ComboSection combos={detectedCombos} onPreview={onPreview} />
      )}

      {/* ── Calculation Result (compact) ── */}
      <CalculationSummary est={est} />
    </div>
  );
}
