import { useState, useMemo, useCallback, useEffect } from 'react';
import {
  Plus, Minus, ChevronDown, ChevronRight,
  Palette, FlipHorizontal2, Info,
  Loader2, Sparkles, Mountain, Sprout, Scissors, ArrowUpDown,
} from 'lucide-react';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import type { ScryfallCard } from '@/types';
import type { DeckAnalysis, RecommendedCard, AnalyzedCard, ManaBaseAnalysis, ManaSourcesAnalysis } from '@/services/deckBuilder/deckAnalyzer';
import { getFrontFaceTypeLine, isMdfcLand, isChannelLand, searchMdfcLands, getChannelLandsForColors, getCardsByNames } from '@/services/scryfall/client';
import { getCardRole, getAllCardRoles, isUtilityLand } from '@/services/tagger/client';
import { useStore } from '@/store';
import {
  scryfallImg, edhrecRankToInclusion,
  VERDICT_STYLES, FIXING_GRADE_STYLES, COLOR_BARS,
  tileGradeStyles, ROLE_LABELS,
  type LandSection, type CollapsibleGroup,
} from './constants';
import { AnalyzedCardRow, CollapsibleCardGroups, type CardAction, type CardRowMenuProps } from './shared';
import { SuggestionCardGrid, CutCardGrid } from './OverviewTab';
import { ManaTrajectorySparkline } from './CurveTab';

// ═══════════════════════════════════════════════════════════════════════
// LANDS TAB Components
// ═══════════════════════════════════════════════════════════════════════

export function getMdfcGrade(count: number): { letter: string; color: string } {
  if (count >= 6) return { letter: 'A', color: 'text-emerald-400' };
  if (count >= 3) return { letter: 'B', color: 'text-sky-400' };
  if (count >= 1) return { letter: 'C', color: 'text-amber-400' };
  return { letter: 'F', color: 'text-red-400' };
}

export function getManaBaseGrade(mb: ManaBaseAnalysis): { letter: string; color: string; bgColor: string } {
  const sweetSpot = mb.probLand2to3;
  if (mb.verdict === 'ok' && sweetSpot >= 0.48) return { letter: 'A', color: 'text-emerald-400', bgColor: 'bg-emerald-500/15' };
  if (mb.verdict === 'ok' || (mb.verdict === 'slightly-low' && sweetSpot >= 0.45)) return { letter: 'B', color: 'text-sky-400', bgColor: 'bg-sky-500/15' };
  if (mb.verdict === 'slightly-low' || mb.verdict === 'high') return { letter: 'C', color: 'text-amber-400', bgColor: 'bg-amber-500/15' };
  if (mb.verdict === 'low') return { letter: 'D', color: 'text-orange-400', bgColor: 'bg-orange-500/15' };
  return { letter: 'F', color: 'text-red-400', bgColor: 'bg-red-500/15' };
}

export function getMdfcStatus(count: number): {
  label: string; color: string; bgColor: string;
  border: string; bg: string; titleColor: string; message: string;
} {
  if (count === 0) return {
    label: 'NONE', color: 'text-amber-400', bgColor: 'bg-amber-500/15',
    border: 'border-amber-500/40', bg: 'bg-amber-500/10', titleColor: 'text-amber-400',
    message: 'No MDFC spell/lands yet. MDFCs act as both a spell and a land, reducing flood risk while still providing action.',
  };
  if (count <= 2) return {
    label: 'FEW', color: 'text-amber-400', bgColor: 'bg-amber-500/15',
    border: 'border-amber-500/30', bg: 'bg-amber-500/5', titleColor: 'text-amber-400/80',
    message: `${count} MDFC${count > 1 ? 's' : ''} in your deck. Running 3–6 MDFCs gives noticeably better consistency.`,
  };
  if (count <= 5) return {
    label: 'GOOD', color: 'text-emerald-400', bgColor: 'bg-emerald-500/15',
    border: 'border-emerald-500/30', bg: 'bg-emerald-500/5', titleColor: 'text-emerald-400',
    message: `${count} MDFCs — solid flexibility without feeling forced.`,
  };
  return {
    label: 'GREAT', color: 'text-sky-400', bgColor: 'bg-sky-500/15',
    border: 'border-sky-500/30', bg: 'bg-sky-500/5', titleColor: 'text-sky-400',
    message: `${count} MDFCs — excellent flexibility. Every one replaces a dead land draw with a live spell.`,
  };
}

export function LandSummaryStrip({
  analysis, activeSection, onSectionClick, mdfcInDeckCount, channelLandCount,
}: {
  analysis: DeckAnalysis;
  activeSection: LandSection | null;
  onSectionClick: (section: LandSection) => void;
  mdfcInDeckCount: number;
  channelLandCount: number;
}) {
  const mb = analysis.manaBase;
  const cf = analysis.colorFixing;
  const coveredColors = cf.colorsNeeded.filter(c => (cf.sourcesPerColor[c] || 0) >= 5).length;
  const totalColors = cf.colorsNeeded.length;

  const landGrade = getManaBaseGrade(mb);
  const ms = analysis.manaSources;
  const sourceGradeColor = (FIXING_GRADE_STYLES[ms.grade] || FIXING_GRADE_STYLES.C).color;
  const fixGrade = cf.fixingGrade || 'C';
  const fixColor = (FIXING_GRADE_STYLES[fixGrade] || FIXING_GRADE_STYLES.C).color;
  const flexCount = mdfcInDeckCount + channelLandCount;
  const mdfcGrade = getMdfcGrade(flexCount);

  const tiles: { key: LandSection; icon: typeof Mountain; label: string; value: number; sub: string; grade: string; gradeColor: string; gradeBg: string; gradeBadgeBg: string }[] = [
    {
      key: 'landCount', icon: Mountain, label: 'Land Count',
      value: mb.currentLands,
      sub: (() => {
        const parts = [`of ${mb.adjustedSuggestion} suggested`];
        if (cf.utilityLands?.length) parts.push(`${cf.utilityLands.length} utility`);
        if (mb.taplandCount > 0) parts.push(`${mb.taplandCount} tapland`);
        return parts.join(' · ');
      })(),
      grade: landGrade.letter, gradeColor: landGrade.color,
      gradeBg: tileGradeStyles(landGrade.letter).bg,
      gradeBadgeBg: tileGradeStyles(landGrade.letter).bgColor,
    },
    {
      key: 'manaSources', icon: Sprout, label: 'Mana Production',
      value: ms.totalRamp,
      sub: `${ms.producers} producers · ${ms.earlyRamp} early`,
      grade: ms.grade, gradeColor: sourceGradeColor,
      gradeBg: tileGradeStyles(ms.grade).bg,
      gradeBadgeBg: tileGradeStyles(ms.grade).bgColor,
    },
    {
      key: 'fixing', icon: Palette, label: 'Color Fixing',
      value: cf.fixingLands.length + cf.manaFixCards.length,
      sub: totalColors > 0 ? `${coveredColors}/${totalColors} colors covered` : 'colorless deck',
      grade: totalColors > 0 ? fixGrade : '-', gradeColor: totalColors > 0 ? fixColor : 'text-muted-foreground',
      gradeBg: totalColors > 0 ? tileGradeStyles(fixGrade).bg : '',
      gradeBadgeBg: totalColors > 0 ? tileGradeStyles(fixGrade).bgColor : '',
    },
    {
      key: 'mdfc', icon: FlipHorizontal2, label: 'Flex Lands',
      value: flexCount,
      sub: channelLandCount > 0 && mdfcInDeckCount > 0
        ? `${mdfcInDeckCount} MDFC · ${channelLandCount} channel`
        : flexCount >= 3 ? 'good flexibility' : flexCount > 0 ? 'room to add more' : 'none yet',
      grade: mdfcGrade.letter, gradeColor: mdfcGrade.color,
      gradeBg: tileGradeStyles(mdfcGrade.letter).bg,
      gradeBadgeBg: tileGradeStyles(mdfcGrade.letter).bgColor,
    },
  ];

  return (
    <div className="-mx-3 sm:-mx-4 -mt-3 sm:-mt-4 grid grid-cols-2 sm:grid-cols-4 border-b border-border/30">
      {tiles.map((tile, i) => {
        const Icon = tile.icon;
        const isActive = activeSection === tile.key;
        return (
          <button
            key={tile.key}
            onClick={() => onSectionClick(tile.key)}
            className={`p-2.5 text-left transition-all hover:bg-card/80 ${
              i % 2 !== 0 ? 'border-l border-l-border/30' : ''
            } ${i < 2 ? 'border-b border-b-border/30 sm:border-b-0' : ''} ${
              i > 0 ? 'sm:border-l sm:border-l-border/30' : ''
            } ${isActive ? tile.gradeBg : ''}`}
          >
            <div className="flex items-center gap-1.5 mb-1.5">
              <Icon className={`w-4 h-4 ${isActive ? tile.gradeColor : 'text-muted-foreground'}`} />
              <span className={`text-xs font-semibold uppercase tracking-wider truncate ${isActive ? 'text-foreground' : 'text-muted-foreground'}`}>{tile.label}</span>
              <span className={`text-sm font-black ml-auto px-1.5 py-0.5 rounded ${tile.gradeColor} ${tile.gradeBadgeBg}`}>{tile.grade}</span>
            </div>
            <div className="flex items-baseline justify-between gap-1.5 mb-1.5">
              <span className={`text-xl font-bold tabular-nums leading-none ${tile.gradeColor}`}>
                {tile.value}
              </span>
              <span className="text-[11px] text-muted-foreground truncate text-right">{tile.sub}</span>
            </div>
          </button>
        );
      })}
    </div>
  );
}

// ─── Grade Info Popover ──────────────────────────────────────────
export function GradeInfoPopover({ children }: { children: React.ReactNode }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          onClick={(e) => e.stopPropagation()}
          className="ml-auto p-0.5 rounded hover:bg-accent/60 text-muted-foreground/40 hover:text-muted-foreground transition-colors"
          title="How this is graded"
        >
          <Info className="w-3 h-3" />
        </button>
      </PopoverTrigger>
      <PopoverContent side="bottom" align="end" className="w-72 p-3 text-xs text-muted-foreground leading-relaxed space-y-2" onClick={(e) => e.stopPropagation()}>
        {children}
      </PopoverContent>
    </Popover>
  );
}

export function LandRatingSummary({ analysis }: { analysis: DeckAnalysis }) {
  const [expanded, setExpanded] = useState(true);
  const mb = analysis.manaBase;
  const vs = VERDICT_STYLES[mb.verdict] || VERDICT_STYLES['ok'];
  const grade = getManaBaseGrade(mb);

  const avgLands = mb.deckSize ? 7 * (mb.currentLands / mb.deckSize) : 0;
  const segments = [
    { label: '0', pct: mb.probLand0, color: 'bg-red-500', text: 'text-red-400' },
    { label: '1', pct: mb.probLand1, color: 'bg-amber-500', text: 'text-amber-400' },
    { label: '2-3', pct: mb.probLand2to3, color: 'bg-emerald-500', text: 'text-emerald-400' },
    { label: '4+', pct: mb.probLand4plus, color: 'bg-sky-500', text: 'text-sky-400' },
  ];

  return (
    <div className="-mx-3 sm:-mx-4 -mt-3 px-3 sm:px-4 pt-3 pb-3 space-y-3 border-b border-border/30">
      <div
        role="button"
        tabIndex={0}
        className="w-full text-[11px] font-semibold uppercase tracking-wider text-foreground/80 px-0.5 flex items-center gap-1 hover:text-foreground/80 transition-colors cursor-pointer select-none"
        onClick={() => setExpanded(prev => !prev)}
      >
        {expanded ? <ChevronDown className="w-3 h-3 text-muted-foreground" /> : <ChevronRight className="w-3 h-3 text-muted-foreground" />}
        <Mountain className="w-3 h-3" />
        Summary
        <GradeInfoPopover>
          <p className="font-semibold text-foreground/80">Land Count Grading</p>
          <p>Suggested count uses EDHREC average, adjusted up if ramp is weak (+1 decent, +2 low), floored at 33% of deck size.</p>
          <p><span className="font-semibold text-emerald-400">A</span> — On target with ≥48% chance of 2–3 lands in opening hand</p>
          <p><span className="font-semibold text-sky-400">B</span> — On target, or slightly low with ≥45% sweet spot</p>
          <p><span className="font-semibold text-amber-400">C</span> — Slightly low or slightly high</p>
          <p><span className="font-semibold text-orange-400">D</span> — Noticeably below suggestion (3+ lands short)</p>
          <p><span className="font-semibold text-red-400">F</span> — Critically low (below 33% of deck size)</p>
        </GradeInfoPopover>
      </div>
      {expanded && <>
        <div className={`border rounded-lg p-2.5 ${vs.border} ${vs.bg}`}>
          <div className="flex items-center gap-3">
            <div className={`flex items-center justify-center w-12 h-12 rounded-lg ${grade.bgColor} shrink-0`}>
              <span className={`text-2xl font-black leading-none ${grade.color}`}>{grade.letter}</span>
            </div>
            <div className="flex-1 min-w-0 flex items-center justify-center">
              <p className="text-sm text-muted-foreground leading-snug text-center">{mb.verdictMessage}</p>
            </div>
          </div>
        </div>

        <div>
          <div className="flex items-baseline justify-between mb-2">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Opening Hand</p>
            <p className="text-[11px] text-muted-foreground/70">avg <span className="font-semibold text-foreground/70">{avgLands.toFixed(1)}</span> lands</p>
          </div>
          <div className="flex gap-1.5">
            {segments.map(seg => {
              const pctNum = Math.round(seg.pct * 100);
              return (
                <div key={seg.label} className="flex flex-col items-center gap-1" style={{ flex: `${Math.max(pctNum, 8)} 0 0` }}>
                  <div className={`w-full h-2.5 rounded-full ${seg.color}`} />
                  <span className={`text-[10px] font-semibold tabular-nums leading-none ${seg.text}`}>{pctNum}%</span>
                  <span className="text-[9px] text-muted-foreground/50 leading-none">{seg.label} lands</span>
                </div>
              );
            })}
          </div>
        </div>
      </>}
    </div>
  );
}

export function LandCountDetail({
  analysis, onPreview, onAdd, addedCards, onCardAction, menuProps, colorIdentity, onAddBasicLand, onRemoveBasicLand, cardInclusionMap,
}: {
  analysis: DeckAnalysis;
  onPreview: (name: string) => void;
  onAdd: (name: string) => void;
  addedCards: Set<string>;
  onCardAction?: (card: ScryfallCard, action: CardAction) => void;
  menuProps?: CardRowMenuProps;
  colorIdentity: string[];
  onAddBasicLand?: (name: string) => void;
  onRemoveBasicLand?: (name: string) => void;
  cardInclusionMap?: Record<string, number>;
}) {
  const mb = analysis.manaBase;
  const hasSuggestions = analysis.landRecommendations.length > 0;
  const isOverTarget = mb.verdict === 'high';
  const excess = Math.max(0, mb.currentLands - mb.adjustedSuggestion);

  // Resolve inclusion map: prop > store > empty
  const storeInclusionMap = useStore(s => s.generatedDeck?.cardInclusionMap);
  const resolvedInclusionMap = cardInclusionMap || storeInclusionMap || {};

  // Split lands into MDFC, nonbasic, and basic groups
  const mdfcLands = analysis.landCards.filter(ac => isMdfcLand(ac.card))
    .sort((a, b) => (b.inclusion ?? 0) - (a.inclusion ?? 0));

  const mdfcNames = new Set(mdfcLands.map(ac => ac.card.name));

  const channelLands = analysis.landCards.filter(ac => {
    if (mdfcNames.has(ac.card.name)) return false;
    return isChannelLand(ac.card);
  }).sort((a, b) => (b.inclusion ?? 0) - (a.inclusion ?? 0));

  const channelNames = new Set(channelLands.map(ac => ac.card.name));

  const allNonbasicLands = analysis.landCards.filter(ac => {
    if (mdfcNames.has(ac.card.name)) return false;
    if (channelNames.has(ac.card.name)) return false;
    const tl = getFrontFaceTypeLine(ac.card).toLowerCase();
    return !/\bbasic\b/.test(tl);
  }).sort((a, b) => (b.inclusion ?? 0) - (a.inclusion ?? 0));

  const utilityLands = allNonbasicLands.filter(ac => isUtilityLand(ac.card.name));
  const utilityNames = new Set(utilityLands.map(ac => ac.card.name));
  const nonbasicLands = allNonbasicLands.filter(ac => !utilityNames.has(ac.card.name));

  const basicLands = analysis.landCards.filter(ac => {
    const tl = getFrontFaceTypeLine(ac.card).toLowerCase();
    return /\bbasic\b/.test(tl);
  });

  // Cut candidates: nonbasic lands excluding MDFCs and channel lands
  const [cutSortMode, setCutSortMode] = useState<'inclusion' | 'score'>('score');
  const cutCandidates = useMemo(() => {
    const filtered = nonbasicLands.filter(ac => !isChannelLand(ac.card));
    const getInclusion = (ac: AnalyzedCard) =>
      ac.inclusion ?? resolvedInclusionMap[ac.card.name] ?? edhrecRankToInclusion(ac.card.edhrec_rank) ?? 0;
    if (cutSortMode === 'inclusion') {
      filtered.sort((a, b) => getInclusion(a) - getInclusion(b));
    } else {
      // Sort by relevance score ascending (lowest score = weakest = most cuttable)
      filtered.sort((a, b) => (a.score ?? 0) - (b.score ?? 0));
    }
    const limit = Math.min(Math.max(excess + 4, 5), 15);
    return filtered.slice(0, limit);
  }, [nonbasicLands, resolvedInclusionMap, excess, cutSortMode]);

  const [showCuts, setShowCuts] = useState(isOverTarget);
  const [removedCards, setRemovedCards] = useState<Set<string>>(new Set());

  const handleRemoveCard = useCallback((card: ScryfallCard) => {
    onCardAction?.(card, { type: 'remove' });
    setRemovedCards(prev => new Set([...prev, card.name]));
  }, [onCardAction]);

  const hasRightColumn = hasSuggestions || (isOverTarget && cutCandidates.length > 0);

  // Group basics by name with count, including ×0 entries for all colors in identity
  const COLOR_TO_BASIC: Record<string, string> = { W: 'Plains', U: 'Island', B: 'Swamp', R: 'Mountain', G: 'Forest' };
  const basicCountMap = new Map<string, number>();
  // Seed with all basics for our color identity (including ×0)
  for (const c of colorIdentity) {
    const name = COLOR_TO_BASIC[c];
    if (name) basicCountMap.set(name, 0);
  }
  // Also seed Wastes for colorless commanders
  if (colorIdentity.length === 0) basicCountMap.set('Wastes', 0);
  for (const ac of basicLands) {
    basicCountMap.set(ac.card.name, (basicCountMap.get(ac.card.name) || 0) + 1);
  }
  const basicGroups = [...basicCountMap.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const totalBasicCount = basicGroups.reduce((sum, bg) => sum + bg.count, 0);

  const landCardGroups: CollapsibleGroup[] = [];
  if (mdfcLands.length > 0) landCardGroups.push({
    key: 'mdfc', label: 'MDFC', count: mdfcLands.length,
    content: (
      <div className="space-y-0.5">
        {mdfcLands.map(ac => (
          <AnalyzedCardRow key={ac.card.name} ac={ac} onPreview={onPreview} showDetails onCardAction={onCardAction} menuProps={menuProps} />
        ))}
      </div>
    ),
  });
  if (channelLands.length > 0) landCardGroups.push({
    key: 'channel', label: 'Channel', count: channelLands.length,
    content: (
      <div className="space-y-0.5">
        {channelLands.map(ac => (
          <AnalyzedCardRow key={ac.card.name} ac={ac} onPreview={onPreview} showDetails onCardAction={onCardAction} menuProps={menuProps} />
        ))}
      </div>
    ),
  });
  if (nonbasicLands.length > 0) landCardGroups.push({
    key: 'nonbasic', label: 'Nonbasic', count: nonbasicLands.length,
    content: (
      <div className="space-y-0.5">
        {nonbasicLands.map(ac => (
          <AnalyzedCardRow key={ac.card.name} ac={ac} onPreview={onPreview} showDetails onCardAction={onCardAction} menuProps={menuProps} />
        ))}
      </div>
    ),
  });
  if (utilityLands.length > 0) landCardGroups.push({
    key: 'utility', label: 'Utility', count: utilityLands.length,
    content: (
      <div className="space-y-0.5">
        {utilityLands.map(ac => (
          <AnalyzedCardRow key={ac.card.name} ac={ac} onPreview={onPreview} showDetails onCardAction={onCardAction} menuProps={menuProps} />
        ))}
      </div>
    ),
  });
  if (basicGroups.length > 0) landCardGroups.push({
    key: 'basic', label: 'Basic', count: totalBasicCount,
    content: (
      <div className="space-y-0.5">
        {basicGroups.map(bg => (
          <div
            key={bg.name}
            className={`flex items-center gap-2 py-1 px-1.5 rounded-lg transition-colors ${bg.count === 0 ? 'opacity-40' : 'cursor-pointer hover:bg-accent/40'}`}
            onClick={() => bg.count > 0 && onPreview(bg.name)}
          >
            <img src={scryfallImg(bg.name)} alt={bg.name} className="w-10 h-auto rounded shadow shrink-0" loading="lazy" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
            <div className="flex-1 min-w-0">
              <span className="text-sm truncate block">{bg.name}</span>
              <span className="text-[10px] text-muted-foreground">Land — Basic</span>
            </div>
            <div className="flex items-center gap-1 shrink-0" onClick={e => e.stopPropagation()}>
              <button className="w-5 h-5 flex items-center justify-center rounded bg-accent/40 hover:bg-accent text-muted-foreground hover:text-foreground transition-colors disabled:opacity-30 disabled:pointer-events-none" disabled={bg.count === 0} onClick={() => onRemoveBasicLand?.(bg.name)} title={`Remove a ${bg.name}`}>
                <Minus className="w-3 h-3" />
              </button>
              <span className="text-xs tabular-nums w-5 text-center font-medium">{bg.count}</span>
              <button className="w-5 h-5 flex items-center justify-center rounded bg-accent/40 hover:bg-accent text-muted-foreground hover:text-foreground transition-colors" onClick={() => onAddBasicLand?.(bg.name)} title={`Add a ${bg.name}`}>
                <Plus className="w-3 h-3" />
              </button>
            </div>
          </div>
        ))}
      </div>
    ),
  });

  return (
    <div className="-mx-3 sm:-mx-4 -mb-3 sm:-mb-4 bg-black/15 px-3 sm:px-4 py-3">
      <div className={`${hasRightColumn ? 'flex flex-col md:flex-row md:items-stretch gap-4' : ''}`}>
        {/* Left: rating summary + lands list */}
        <div className={`${hasRightColumn ? 'md:w-[30%] shrink-0' : 'w-full'} space-y-3`}>
              <LandRatingSummary analysis={analysis} />
              {analysis.landCards.length > 0 && (
                <CollapsibleCardGroups groups={landCardGroups} totalCount={analysis.landCards.length} />
              )}

              {/* Recently added from suggestions */}
              {(() => {
                const existingNames = new Set(analysis.landCards.map(ac => ac.card.name));
                const landRecNames = new Set(analysis.landRecommendations.map(r => r.name));
                const recentlyAdded = [...addedCards].filter(n => !existingNames.has(n) && landRecNames.has(n));
                if (recentlyAdded.length === 0) return null;
                return (
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-emerald-400/60 mb-0.5 px-0.5 flex items-center gap-1">
                      <Plus className="w-2.5 h-2.5" />
                      Recently Added ({recentlyAdded.length})
                    </p>
                    <div className="space-y-0.5">
                      {recentlyAdded.map(name => (
                        <div
                          key={name}
                          className="flex items-center gap-2 py-1 px-1.5 rounded-lg cursor-pointer hover:bg-accent/40 transition-colors"
                          onClick={() => onPreview(name)}
                        >
                          <img
                            src={scryfallImg(name)}
                            alt={name}
                            className="w-10 h-auto rounded shadow shrink-0"
                            loading="lazy"
                            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                          />
                          <span className="text-sm truncate flex-1 min-w-0">{name}</span>
                          <span className="text-[9px] font-bold px-1.5 py-px rounded-full bg-emerald-500/15 text-emerald-400 shrink-0">NEW</span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}
        </div>

        {/* Vertical divider */}
        {(hasSuggestions || (isOverTarget && cutCandidates.length > 0)) && <div className="hidden md:block w-px bg-border/30 shrink-0 -my-3" />}

        {/* Right: cut candidates or land suggestions */}
        {(hasSuggestions || (isOverTarget && cutCandidates.length > 0)) && (
          <div className="flex-1 min-w-0">
            {/* Toggle header */}
            {isOverTarget && cutCandidates.length > 0 && hasSuggestions ? (
              <div className="mb-2 px-0.5 space-y-1.5">
                <div className="flex items-center gap-2">
                  {showCuts && <span className="text-xs text-red-400/60">{excess} over target</span>}
                  <div className="flex items-center border border-border/50 rounded-md overflow-hidden ml-auto">
                    <button
                      onClick={() => setShowCuts(true)}
                      className={`flex items-center gap-1 text-[10px] px-2 py-0.5 transition-colors ${showCuts ? 'bg-red-500/15 text-red-400 font-medium' : 'text-muted-foreground/50 hover:text-muted-foreground hover:bg-accent/50'}`}
                    >
                      <Scissors className="w-2.5 h-2.5" />
                      Cuts
                    </button>
                    <div className="w-px h-3 bg-border/50" />
                    <button
                      onClick={() => setShowCuts(false)}
                      className={`flex items-center gap-1 text-[10px] px-2 py-0.5 transition-colors ${!showCuts ? 'bg-accent text-foreground font-medium' : 'text-muted-foreground/50 hover:text-muted-foreground hover:bg-accent/50'}`}
                    >
                      <Sparkles className="w-2.5 h-2.5" />
                      Suggestions
                    </button>
                  </div>
                </div>
                {showCuts ? (
                  <div className="flex items-center gap-2">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-red-400 flex items-center gap-1">
                      <Scissors className="w-3 h-3" />
                      Lands to Cut from Your Deck ({cutCandidates.length})
                    </p>
                    <div className="ml-auto flex items-center gap-1">
                      <ArrowUpDown className="w-3 h-3 text-muted-foreground/40" />
                      <div className="flex items-center border border-border/50 rounded-md overflow-hidden">
                        <button
                          onClick={() => setCutSortMode('score')}
                          className={`text-[10px] px-2 py-0.5 transition-colors ${cutSortMode === 'score' ? 'bg-accent text-foreground font-medium' : 'text-muted-foreground/50 hover:text-muted-foreground hover:bg-accent/50'}`}
                        >
                          Relevancy
                        </button>
                        <div className="w-px h-3 bg-border/50" />
                        <button
                          onClick={() => setCutSortMode('inclusion')}
                          className={`text-[10px] px-2 py-0.5 transition-colors ${cutSortMode === 'inclusion' ? 'bg-accent text-foreground font-medium' : 'text-muted-foreground/50 hover:text-muted-foreground hover:bg-accent/50'}`}
                        >
                          Inclusion
                        </button>
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : showCuts && cutCandidates.length > 0 ? (
              <div className="flex items-center gap-2 mb-2 px-0.5">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-red-400 flex items-center gap-1">
                  <Scissors className="w-3 h-3" />
                  Lands to Cut from Your Deck ({cutCandidates.length})
                </p>
                <div className="ml-auto flex items-center gap-1">
                  <ArrowUpDown className="w-3 h-3 text-muted-foreground/40" />
                  <div className="flex items-center border border-border/50 rounded-md overflow-hidden">
                    <button
                      onClick={() => setCutSortMode('score')}
                      className={`text-[10px] px-2 py-0.5 transition-colors ${cutSortMode === 'score' ? 'bg-accent text-foreground font-medium' : 'text-muted-foreground/50 hover:text-muted-foreground hover:bg-accent/50'}`}
                    >
                      Relevancy
                    </button>
                    <div className="w-px h-3 bg-border/50" />
                    <button
                      onClick={() => setCutSortMode('inclusion')}
                      className={`text-[10px] px-2 py-0.5 transition-colors ${cutSortMode === 'inclusion' ? 'bg-accent text-foreground font-medium' : 'text-muted-foreground/50 hover:text-muted-foreground hover:bg-accent/50'}`}
                    >
                      Inclusion
                    </button>
                  </div>
                </div>
              </div>
            ) : null}
            {/* Content */}
            {showCuts && cutCandidates.length > 0 ? (
              <CutCardGrid
                cards={cutCandidates}
                onRemove={handleRemoveCard}
                onPreview={onPreview}
                removedCards={removedCards}
                excess={excess}
                onCardAction={onCardAction}
                menuProps={menuProps}
                cardInclusionMap={resolvedInclusionMap}
                sortMode={cutSortMode}
              />
            ) : (
              <SuggestionCardGrid
                title={<>Suggested Lands ({analysis.landRecommendations.length})</>}
                cards={analysis.landRecommendations}
                onAdd={onAdd}
                onPreview={onPreview}
                addedCards={addedCards}
                deficit={Math.max(0, mb.adjustedSuggestion - mb.currentLands)}
                onCardAction={onCardAction}
                menuProps={menuProps}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Mana Production Detail Panel ───────────────────────────────────
export function ManaSourcesSummary({ ms, deckSize }: { ms: ManaSourcesAnalysis; deckSize: number }) {
  const [expanded, setExpanded] = useState(true);
  const gs = FIXING_GRADE_STYLES[ms.grade] || FIXING_GRADE_STYLES.C;

  return (
    <div className="-mx-3 sm:-mx-4 -mt-3 px-3 sm:px-4 pt-3 pb-3 space-y-3">
      <div
        role="button"
        tabIndex={0}
        className="w-full text-[11px] font-semibold uppercase tracking-wider text-foreground/80 px-0.5 flex items-center gap-1 hover:text-foreground/80 transition-colors cursor-pointer select-none"
        onClick={() => setExpanded(prev => !prev)}
      >
        {expanded ? <ChevronDown className="w-3 h-3 text-muted-foreground" /> : <ChevronRight className="w-3 h-3 text-muted-foreground" />}
        <Sprout className="w-3 h-3" />
        Summary
        <GradeInfoPopover>
          <p className="font-semibold text-foreground/80">Mana Production Grading</p>
          <p>Evaluates ramp count, early-game availability (CMC ≤ 2), and how many are mana producers (dorks/rocks).{deckSize !== 100 ? ` Scaled for ${deckSize}-card deck.` : ''}</p>
          <p><span className="font-semibold text-emerald-400">A</span> — {Math.round(10 * deckSize / 100)}+ ramp, {Math.round(5 * deckSize / 100)}+ early, {Math.round(6 * deckSize / 100)}+ producers</p>
          <p><span className="font-semibold text-sky-400">B</span> — {Math.round(8 * deckSize / 100)}+ ramp, {Math.round(3 * deckSize / 100)}+ early, {Math.round(4 * deckSize / 100)}+ producers</p>
          <p><span className="font-semibold text-amber-400">C</span> — {Math.round(6 * deckSize / 100)}+ ramp total</p>
          <p><span className="font-semibold text-orange-400">D</span> — {Math.round(4 * deckSize / 100)}+ ramp total</p>
          <p><span className="font-semibold text-red-400">F</span> — Fewer than {Math.round(4 * deckSize / 100)} ramp cards</p>
        </GradeInfoPopover>
      </div>
      {expanded && <>
        <div className={`border rounded-lg p-2.5 ${gs.border} ${gs.bg}`}>
          <div className="flex items-center gap-3">
            <div className={`flex items-center justify-center w-12 h-12 rounded-lg ${gs.bgColor} shrink-0`}>
              <span className={`text-2xl font-black leading-none ${gs.color}`}>{ms.grade}</span>
            </div>
            <div className="flex-1 min-w-0 flex items-center justify-center">
              <p className="text-sm text-muted-foreground leading-snug text-center">{ms.message}</p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3 text-[10px] text-muted-foreground/70 px-0.5">
          <span>{ms.earlyRamp} early <span className="text-muted-foreground/40">(CMC ≤ 2)</span></span>
          <span className="text-border">·</span>
          <span>avg ramp cost <span className="font-semibold text-foreground/80">{ms.avgRampCmc.toFixed(1)}</span></span>
        </div>
      </>}
    </div>
  );
}

export function ManaSourcesDetail({
  analysis, onPreview, onAdd, addedCards, onCardAction, menuProps,
}: {
  analysis: DeckAnalysis;
  onPreview: (name: string) => void;
  onAdd: (name: string) => void;
  addedCards: Set<string>;
  onCardAction?: (card: ScryfallCard, action: CardAction) => void;
  menuProps?: CardRowMenuProps;
}) {
  // Group ramp cards by subtype
  const groups: { key: string; label: string; cards: AnalyzedCard[] }[] = [];
  const dorks = analysis.rampCards.filter(ac => ac.card.rampSubtype === 'mana-producer');
  const rocks = analysis.rampCards.filter(ac => ac.card.rampSubtype === 'mana-rock');
  const reducers = analysis.rampCards.filter(ac => ac.card.rampSubtype === 'cost-reducer');
  const otherRamp = analysis.rampCards.filter(ac =>
    ac.card.rampSubtype !== 'mana-producer' && ac.card.rampSubtype !== 'mana-rock' && ac.card.rampSubtype !== 'cost-reducer'
  );
  if (dorks.length > 0) groups.push({ key: 'dorks', label: 'Mana Dorks', cards: dorks });
  if (rocks.length > 0) groups.push({ key: 'rocks', label: 'Mana Rocks', cards: rocks });
  if (reducers.length > 0) groups.push({ key: 'reducers', label: 'Cost Reducers', cards: reducers });
  if (otherRamp.length > 0) groups.push({ key: 'other', label: 'Other Ramp', cards: otherRamp });

  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(groups.map(g => [g.key, true]))
  );
  const toggleGroup = (key: string) => setOpenGroups(prev => ({ ...prev, [key]: !prev[key] }));

  // Get ramp suggestions from role breakdowns
  const rampRb = analysis.roleBreakdowns.find(rb => rb.role === 'ramp');
  const rampSuggestions = rampRb?.suggestedReplacements || [];
  const hasSuggestions = rampSuggestions.length > 0;

  return (
    <div className="-mx-3 sm:-mx-4 -mb-3 sm:-mb-4 bg-black/15 px-3 sm:px-4 py-3">
      <div className={`${hasSuggestions ? 'flex flex-col md:flex-row md:items-stretch gap-4' : ''}`}>
        {/* Left: summary + ramp cards grouped */}
        <div className={`${hasSuggestions ? 'md:w-[30%] shrink-0' : 'w-full'} space-y-3`}>
          <ManaSourcesSummary ms={analysis.manaSources} deckSize={analysis.manaBase.deckSize} />
          {analysis.manaTrajectory.length > 0 && (
            <div className="-mx-3 sm:-mx-4 px-3 sm:px-4 pb-3 border-b border-border/30">
              <ManaTrajectorySparkline trajectory={analysis.manaTrajectory} />
            </div>
          )}
          {groups.length > 0 ? groups.map(g => (
            <div key={g.key}>
              <button
                onClick={() => toggleGroup(g.key)}
                className="flex items-center gap-1 w-full text-left px-0.5 mb-1 hover:opacity-80 transition-opacity"
              >
                {openGroups[g.key] !== false ? <ChevronDown className="w-3 h-3 text-muted-foreground" /> : <ChevronRight className="w-3 h-3 text-muted-foreground" />}
                <span className="text-[11px] font-semibold uppercase tracking-wider text-foreground/80">
                  {g.label} ({g.cards.length})
                </span>
              </button>
              {openGroups[g.key] !== false && (
                <div className="space-y-0.5">
                  {g.cards.map(ac => (
                    <AnalyzedCardRow key={ac.card.name} ac={ac} onPreview={onPreview} showDetails onCardAction={onCardAction} menuProps={menuProps} />
                  ))}
                </div>
              )}
            </div>
          )) : (
            <p className="text-xs text-muted-foreground italic px-0.5">No ramp cards in deck</p>
          )}
          {/* Recently added from suggestions */}
          {(() => {
            const existingNames = new Set(analysis.rampCards.map(ac => ac.card.name));
            const suggNames = new Set(rampSuggestions.map(r => r.name));
            const recentlyAdded = [...addedCards].filter(n => !existingNames.has(n) && suggNames.has(n));
            if (recentlyAdded.length === 0) return null;
            return (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-emerald-400/60 mb-0.5 px-0.5 flex items-center gap-1">
                  <Plus className="w-2.5 h-2.5" />
                  Recently Added ({recentlyAdded.length})
                </p>
                <div className="space-y-0.5">
                  {recentlyAdded.map(name => (
                    <div key={name} className="flex items-center gap-2 py-1 px-1.5 rounded-lg cursor-pointer hover:bg-accent/40 transition-colors" onClick={() => onPreview(name)}>
                      <img src={scryfallImg(name)} alt={name} className="w-10 h-auto rounded shadow shrink-0" loading="lazy" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                      <span className="text-sm truncate flex-1 min-w-0">{name}</span>
                      <span className="text-[9px] font-bold px-1.5 py-px rounded-full bg-emerald-500/15 text-emerald-400 shrink-0">NEW</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}
        </div>

        {/* Vertical divider */}
        {hasSuggestions && <div className="hidden md:block w-px bg-border/30 shrink-0 -my-3" />}

        {/* Right: ramp suggestions */}
        {hasSuggestions && (
          <div className="flex-1 min-w-0">
            <SuggestionCardGrid
              title={<>Suggested Ramp ({rampSuggestions.length})</>}
              cards={rampSuggestions}
              onAdd={onAdd}
              onPreview={onPreview}
              addedCards={addedCards}
              deficit={rampRb?.deficit || 0}
              onCardAction={onCardAction}
              menuProps={menuProps}
            />
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Fixing Summary Box (accordion) ─────────────────────────────
export function FixingSummaryBox({ analysis }: { analysis: DeckAnalysis }) {
  const [expanded, setExpanded] = useState(true);
  const cf = analysis.colorFixing;
  const grade = cf.fixingGrade || 'C';
  const gs = FIXING_GRADE_STYLES[grade] || FIXING_GRADE_STYLES.C;

  return (
    <div className="-mx-3 sm:-mx-4 -mt-3 px-3 sm:px-4 pt-3 pb-3 space-y-3">
      <div
        role="button"
        tabIndex={0}
        className="w-full text-[11px] font-semibold uppercase tracking-wider text-foreground/80 px-0.5 flex items-center gap-1 hover:text-foreground/80 transition-colors cursor-pointer select-none"
        onClick={() => setExpanded(prev => !prev)}
      >
        {expanded ? <ChevronDown className="w-3 h-3 text-muted-foreground" /> : <ChevronRight className="w-3 h-3 text-muted-foreground" />}
        <Palette className="w-3 h-3" />
        Summary
        <GradeInfoPopover>
          <p className="font-semibold text-foreground/80">Color Fixing Grading</p>
          <p>Mono-color decks get auto-A. For 2+ colors, a composite 0–100 score from three factors:</p>
          <p><span className="text-foreground/70 font-medium">50%</span> — Color coverage (sources vs pip demand per color, capped at 130%)</p>
          <p><span className="text-foreground/70 font-medium">25%</span> — Worst-color penalty (any color below 60% of expected)</p>
          <p><span className="text-foreground/70 font-medium">25%</span> — Absolute adequacy (min sources per color vs target)</p>
          <p><span className="font-semibold text-emerald-400">A</span> ≥ 85 · <span className="font-semibold text-sky-400">B</span> ≥ 70 · <span className="font-semibold text-amber-400">C</span> ≥ 50 · <span className="font-semibold text-orange-400">D</span> ≥ 30 · <span className="font-semibold text-red-400">F</span> &lt; 30</p>
        </GradeInfoPopover>
      </div>
      {expanded && (
        <div className={`border rounded-lg p-2.5 ${gs.border} ${gs.bg}`}>
          <div className="flex items-center gap-3">
            <div className={`flex items-center justify-center w-12 h-12 rounded-lg ${gs.bgColor} shrink-0`}>
              <span className={`text-2xl font-black leading-none ${gs.color}`}>{grade}</span>
            </div>
            <div className="flex-1 min-w-0 flex items-center justify-center">
              <p className="text-sm text-muted-foreground leading-snug text-center">{cf.fixingGradeMessage || ''}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Color Fixing Detail Panel ───────────────────────────────────
export function FixingDetail({
  analysis, onPreview, onAdd, addedCards, onCardAction, menuProps, colorIdentity, onAddBasicLand, onRemoveBasicLand,
}: {
  analysis: DeckAnalysis;
  onPreview: (name: string) => void;
  onAdd: (name: string) => void;
  addedCards: Set<string>;
  onCardAction?: (card: ScryfallCard, action: CardAction) => void;
  menuProps?: CardRowMenuProps;
  colorIdentity: string[];
  onAddBasicLand?: (name: string) => void;
  onRemoveBasicLand?: (name: string) => void;
}) {
  const cf = analysis.colorFixing;
  const fixerRecs = cf.fixingRecommendations || [];
  const hasSuggestions = analysis.landRecommendations.length > 0 || fixerRecs.length > 0;
  const [fixersOpen, setFixersOpen] = useState(true);
  const [rampOpen, setRampOpen] = useState(true);
  const [multiColorOpen, setMultiColorOpen] = useState(true);
  const [monoColorOpen, setMonoColorOpen] = useState(false);
  const [colorlessOpen, setColorlessOpen] = useState(false);
  const [utilityOpen, setUtilityOpen] = useState(false);
  const [taplandOpen, setTaplandOpen] = useState(false);
  const [basicOpen, setBasicOpen] = useState(false);
  const [selectedColors, setSelectedColors] = useState<Set<string>>(new Set());

  // Derive mono-color and basic land groups
  const multiColorNames = new Set(cf.fixingLands.map(ac => ac.card.name));
  const colorlessNames = new Set(cf.colorlessOnly.map(ac => ac.card.name));

  const monoColorLands = useMemo(() =>
    analysis.landCards.filter(ac => {
      if (multiColorNames.has(ac.card.name) || colorlessNames.has(ac.card.name)) return false;
      const tl = getFrontFaceTypeLine(ac.card).toLowerCase();
      return !/\bbasic\b/.test(tl);
    }).sort((a, b) => (b.inclusion ?? 0) - (a.inclusion ?? 0)),
    [analysis.landCards, multiColorNames, colorlessNames]
  );

  const COLOR_TO_BASIC: Record<string, string> = { W: 'Plains', U: 'Island', B: 'Swamp', R: 'Mountain', G: 'Forest' };
  const basicCountMap = new Map<string, number>();
  for (const c of colorIdentity) {
    const name = COLOR_TO_BASIC[c];
    if (name) basicCountMap.set(name, 0);
  }
  if (colorIdentity.length === 0) basicCountMap.set('Wastes', 0);
  for (const ac of analysis.landCards) {
    const tl = getFrontFaceTypeLine(ac.card).toLowerCase();
    if (/\bbasic\b/.test(tl)) basicCountMap.set(ac.card.name, (basicCountMap.get(ac.card.name) || 0) + 1);
  }
  const basicGroups = [...basicCountMap.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const toggleColor = (color: string) => {
    setSelectedColors(prev => {
      const next = new Set(prev);
      if (next.has(color)) next.delete(color); else next.add(color);
      return next;
    });
  };

  // Sort land suggestions by how well they cover weak colors, then by inclusion
  const sortedLandSuggestions = useMemo(() => {
    if ((cf.colorsNeeded?.length || 0) < 2 || !cf.demandVsSupplyRatio) return analysis.landRecommendations;
    return [...analysis.landRecommendations].sort((a, b) => {
      const scoreA = (a.producedColors || []).reduce((s, c) => s + (cf.demandVsSupplyRatio[c] || 0), 0);
      const scoreB = (b.producedColors || []).reduce((s, c) => s + (cf.demandVsSupplyRatio[c] || 0), 0);
      if (scoreB !== scoreA) return scoreB - scoreA;
      return b.inclusion - a.inclusion;
    });
  }, [analysis.landRecommendations, cf.demandVsSupplyRatio, cf.colorsNeeded?.length]);

  // Filter suggestions by selected colors
  const matchesColorFilter = (colors: string[] | undefined) => {
    if (!colors || colors.length === 0) return false; // no color data = colorless, exclude
    return colors.some(c => selectedColors.has(c));
  };

  // Get produced colors from a card (for filtering left-column cards)
  const getCardProducedColors = (card: ScryfallCard): string[] => {
    const WUBRG = ['W', 'U', 'B', 'R', 'G'];
    const produced = card.produced_mana || [];
    const colors = [...new Set(produced.filter(c => WUBRG.includes(c)))];
    if (colors.length > 0) return colors;
    const oracle = (card.oracle_text || '').toLowerCase();
    if (oracle.includes('any color') || oracle.includes('any type')) return WUBRG;
    const found: string[] = [];
    if (oracle.includes('add {w}')) found.push('W');
    if (oracle.includes('add {u}')) found.push('U');
    if (oracle.includes('add {b}')) found.push('B');
    if (oracle.includes('add {r}')) found.push('R');
    if (oracle.includes('add {g}')) found.push('G');
    return found;
  };

  const cardMatchesColorFilter = (card: ScryfallCard) => {
    if (selectedColors.size === 0) return true;
    return getCardProducedColors(card).some(c => selectedColors.has(c));
  };

  const filteredLandSuggestions = useMemo(() => {
    if (selectedColors.size === 0) return sortedLandSuggestions;
    return sortedLandSuggestions.filter(r => matchesColorFilter(r.producedColors));
  }, [sortedLandSuggestions, selectedColors]);

  const filteredFixerRecs = useMemo(() => {
    if (selectedColors.size === 0) return fixerRecs;
    return fixerRecs.filter(r => matchesColorFilter(r.producedColors));
  }, [fixerRecs, selectedColors]);

  // Filtered left-column card lists
  const filteredManaFixCards = useMemo(() => cf.manaFixCards.filter(ac => cardMatchesColorFilter(ac.card)), [cf.manaFixCards, selectedColors]);
  const filteredRampCards = useMemo(() => cf.nonFixRampCards.filter(ac => cardMatchesColorFilter(ac.card)), [cf.nonFixRampCards, selectedColors]);
  const filteredFixingLands = useMemo(() => cf.fixingLands.filter(ac => cardMatchesColorFilter(ac.card)), [cf.fixingLands, selectedColors]);
  const filteredMonoColorLands = useMemo(() => monoColorLands.filter(ac => cardMatchesColorFilter(ac.card)), [monoColorLands, selectedColors]);
  const filteredColorlessLands = useMemo(() => cf.colorlessOnly.filter(ac => cardMatchesColorFilter(ac.card)), [cf.colorlessOnly, selectedColors]);
  const filteredUtilityLands = useMemo(() => (cf.utilityLands || []).filter(ac => cardMatchesColorFilter(ac.card)), [cf.utilityLands, selectedColors]);
  const filteredTaplands = useMemo(() => (cf.taplands || []).filter(ac => cardMatchesColorFilter(ac.card)), [cf.taplands, selectedColors]);
  const filteredBasicGroups = useMemo(() => {
    if (selectedColors.size === 0) return basicGroups;
    const BASIC_COLOR: Record<string, string> = { Plains: 'W', Island: 'U', Swamp: 'B', Mountain: 'R', Forest: 'G' };
    return basicGroups.filter(bg => BASIC_COLOR[bg.name] ? selectedColors.has(BASIC_COLOR[bg.name]) : false);
  }, [basicGroups, selectedColors]);

  return (
    <div className="-mx-3 sm:-mx-4 -mb-3 sm:-mb-4 bg-black/15 px-3 sm:px-4 py-3">
      <div className={`${hasSuggestions ? 'flex flex-col md:flex-row md:items-stretch gap-4' : ''}`}>
        {/* Left: fixing summary + mana fixers + multi-color + recently added */}
        <div className={`${hasSuggestions ? 'md:w-[30%] shrink-0' : 'w-full'} space-y-3`}>
          <FixingSummaryBox analysis={analysis} />

          {/* Demand vs Supply — per-color breakdown */}
          {(cf.colorsNeeded?.length || 0) >= 2 && (() => {
            const pipTotal = cf.pipDemandTotal || 1;
            const WUBRG = ['W', 'U', 'B', 'R', 'G'];
            const colors = [...(cf.colorsNeeded || [])].sort((a, b) => WUBRG.indexOf(a) - WUBRG.indexOf(b));
            return (
              <div>
              <div className="flex items-center gap-1 mb-1.5 px-0.5">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-foreground/80">Pip Demand</span>
                <GradeInfoPopover>
                  <p className="font-semibold text-foreground mb-1">Pip Demand vs Supply</p>
                  <p>Counts colored mana pips across your non-land cards, then checks if your sources (lands, dorks, rocks) match that distribution.</p>
                  <p>A color with 30 pips and 19 sources is healthy. Aim for roughly 1 source per 1.5–2 pips. Colors highlighted amber are undersupplied.</p>
                  <p className="text-muted-foreground/40">Click a color to filter cards and suggestions.</p>
                </GradeInfoPopover>
              </div>
              <div className="flex gap-1.5">
                {colors.map(color => {
                  const pips = cf.pipDemand?.[color] || 0;
                  const demandPct = Math.round((pips / pipTotal) * 100);
                  const ratio = cf.demandVsSupplyRatio?.[color] || 0;
                  const isWeak = ratio > 0.25;
                  return (
                    <button
                      key={color}
                      onClick={() => toggleColor(color)}
                      className={`flex-1 min-w-0 rounded-lg border p-1.5 transition-all cursor-pointer ${
                        selectedColors.has(color)
                          ? 'border-foreground/50 bg-foreground/10 ring-1 ring-foreground/20'
                          : isWeak ? 'border-amber-500/30 bg-amber-500/5 hover:bg-amber-500/10' : 'border-border/30 bg-card/30 hover:bg-card/50'
                      }`}
                    >
                      <div className="flex items-center justify-center gap-0.5">
                        <i className={`ms ms-${color.toLowerCase()} ms-cost text-sm`} />
                        <span className="text-[10px] text-muted-foreground font-medium">x</span>
                        <span className={`text-sm font-black tabular-nums leading-none ${selectedColors.has(color) ? 'text-foreground' : isWeak ? 'text-amber-400' : 'text-foreground'}`}>{pips}</span>
                      </div>
                      <p className="text-[9px] text-muted-foreground/50 text-center tabular-nums mb-0.5">{demandPct}% of demand</p>
                      <div className="h-1 rounded-full bg-accent/40 overflow-hidden mb-0.5">
                        <div className={`h-full rounded-full transition-all ${COLOR_BARS[color] || 'bg-foreground'}`} style={{ width: `${Math.min(100, Math.round(((cf.sourcesPerColor?.[color] || 0) / Math.max(pips, 1)) * 50))}%` }} />
                      </div>
                      <p className="text-[9px] text-muted-foreground/50 text-center tabular-nums">{cf.sourcesPerColor?.[color] || 0} sources</p>
                    </button>
                  );
                })}
              </div>
              </div>
            );
          })()}

          <div className="-mx-3 sm:-mx-4 border-b border-border/30" />

          {/* Mana Fixers (cards with mana-fix tag) */}
          {filteredManaFixCards.length > 0 && (
            <div>
              <button
                onClick={() => setFixersOpen(v => !v)}
                className="flex items-center gap-1 w-full text-left px-0.5 mb-1 hover:opacity-80 transition-opacity"
              >
                {fixersOpen ? <ChevronDown className="w-3 h-3 text-muted-foreground" /> : <ChevronRight className="w-3 h-3 text-muted-foreground" />}
                <span className="text-[11px] font-semibold uppercase tracking-wider text-foreground/80">
                  Mana Fixers ({filteredManaFixCards.length})
                </span>
              </button>
              {fixersOpen && (
                <div className="space-y-0.5">
                  {filteredManaFixCards.map(ac => (
                    <AnalyzedCardRow key={ac.card.name} ac={ac} onPreview={onPreview} showProducedMana showDetails onCardAction={onCardAction} menuProps={menuProps} />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Other Ramp (dorks, rocks, cost-reducers without mana-fix tag) */}
          {filteredRampCards.length > 0 && (
            <div>
              <button
                onClick={() => setRampOpen(v => !v)}
                className="flex items-center gap-1 w-full text-left px-0.5 mb-1 hover:opacity-80 transition-opacity"
              >
                {rampOpen ? <ChevronDown className="w-3 h-3 text-muted-foreground" /> : <ChevronRight className="w-3 h-3 text-muted-foreground" />}
                <span className="text-[11px] font-semibold uppercase tracking-wider text-foreground/80">
                  Ramp ({filteredRampCards.length})
                </span>
              </button>
              {rampOpen && (
                <div className="space-y-0.5">
                  {filteredRampCards.map(ac => (
                    <AnalyzedCardRow key={ac.card.name} ac={ac} onPreview={onPreview} showProducedMana showDetails onCardAction={onCardAction} menuProps={menuProps} />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Multi-color lands in deck */}
          {filteredFixingLands.length > 0 && (
            <div>
              <button
                onClick={() => setMultiColorOpen(v => !v)}
                className="flex items-center gap-1 w-full text-left px-0.5 mb-1 hover:opacity-80 transition-opacity"
              >
                {multiColorOpen ? <ChevronDown className="w-3 h-3 text-muted-foreground" /> : <ChevronRight className="w-3 h-3 text-muted-foreground" />}
                <span className="text-[11px] font-semibold uppercase tracking-wider text-foreground/80">
                  Multi-Color Lands ({filteredFixingLands.length})
                </span>
              </button>
              {multiColorOpen && (
                <div className="space-y-0.5">
                  {filteredFixingLands.map(ac => (
                    <AnalyzedCardRow key={ac.card.name} ac={ac} onPreview={onPreview} showProducedMana showDetails onCardAction={onCardAction} menuProps={menuProps} />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Mono-color lands */}
          {filteredMonoColorLands.length > 0 && (
            <div>
              <button
                onClick={() => setMonoColorOpen(v => !v)}
                className="flex items-center gap-1 w-full text-left px-0.5 mb-1 hover:opacity-80 transition-opacity"
              >
                {monoColorOpen ? <ChevronDown className="w-3 h-3 text-muted-foreground" /> : <ChevronRight className="w-3 h-3 text-muted-foreground" />}
                <span className="text-[11px] font-semibold uppercase tracking-wider text-foreground/80">
                  Other Lands ({filteredMonoColorLands.length})
                </span>
              </button>
              {monoColorOpen && (
                <div className="space-y-0.5">
                  {filteredMonoColorLands.map(ac => (
                    <AnalyzedCardRow key={ac.card.name} ac={ac} onPreview={onPreview} showProducedMana showDetails onCardAction={onCardAction} menuProps={menuProps} />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Utility lands (from Scryfall otag:utility-land) */}
          {filteredUtilityLands.length > 0 && (
            <div>
              <button
                onClick={() => setUtilityOpen(v => !v)}
                className="flex items-center gap-1 w-full text-left px-0.5 mb-1 hover:opacity-80 transition-opacity"
              >
                {utilityOpen ? <ChevronDown className="w-3 h-3 text-muted-foreground" /> : <ChevronRight className="w-3 h-3 text-muted-foreground" />}
                <span className="text-[11px] font-semibold uppercase tracking-wider text-foreground/80">
                  Utility Lands ({filteredUtilityLands.length})
                </span>
              </button>
              {utilityOpen && (
                <div className="space-y-0.5">
                  {filteredUtilityLands.map(ac => (
                    <AnalyzedCardRow key={ac.card.name} ac={ac} onPreview={onPreview} showProducedMana showDetails onCardAction={onCardAction} menuProps={menuProps} />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Taplands (ETB tapped) */}
          {filteredTaplands.length > 0 && (
            <div>
              <button
                onClick={() => setTaplandOpen(v => !v)}
                className="flex items-center gap-1 w-full text-left px-0.5 mb-1 hover:opacity-80 transition-opacity"
              >
                {taplandOpen ? <ChevronDown className="w-3 h-3 text-muted-foreground" /> : <ChevronRight className="w-3 h-3 text-muted-foreground" />}
                <span className="text-[11px] font-semibold uppercase tracking-wider text-foreground/80">
                  Taplands ({filteredTaplands.length})
                </span>
              </button>
              {taplandOpen && (
                <div className="space-y-0.5">
                  {filteredTaplands.map(ac => (
                    <AnalyzedCardRow key={ac.card.name} ac={ac} onPreview={onPreview} showProducedMana showDetails onCardAction={onCardAction} menuProps={menuProps} />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Colorless lands */}
          {filteredColorlessLands.length > 0 && (
            <div>
              <button
                onClick={() => setColorlessOpen(v => !v)}
                className="flex items-center gap-1 w-full text-left px-0.5 mb-1 hover:opacity-80 transition-opacity"
              >
                {colorlessOpen ? <ChevronDown className="w-3 h-3 text-muted-foreground" /> : <ChevronRight className="w-3 h-3 text-muted-foreground" />}
                <span className="text-[11px] font-semibold uppercase tracking-wider text-foreground/80">
                  Colorless Lands ({filteredColorlessLands.length})
                </span>
              </button>
              {colorlessOpen && (
                <div className="space-y-0.5">
                  {filteredColorlessLands.map(ac => (
                    <AnalyzedCardRow key={ac.card.name} ac={ac} onPreview={onPreview} showProducedMana showDetails onCardAction={onCardAction} menuProps={menuProps} />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Basic lands */}
          {filteredBasicGroups.length > 0 && (
            <div>
              <button
                onClick={() => setBasicOpen(v => !v)}
                className="flex items-center gap-1 w-full text-left px-0.5 mb-1 hover:opacity-80 transition-opacity"
              >
                {basicOpen ? <ChevronDown className="w-3 h-3 text-muted-foreground" /> : <ChevronRight className="w-3 h-3 text-muted-foreground" />}
                <span className="text-[11px] font-semibold uppercase tracking-wider text-foreground/80">
                  Basic ({filteredBasicGroups.reduce((sum, bg) => sum + bg.count, 0)})
                </span>
              </button>
              {basicOpen && (
                <div className="space-y-0.5">
                  {filteredBasicGroups.map(bg => (
                    <div
                      key={bg.name}
                      className={`flex items-center gap-2 py-1 px-1.5 rounded-lg transition-colors ${bg.count === 0 ? 'opacity-40' : 'cursor-pointer hover:bg-accent/40'}`}
                      onClick={() => bg.count > 0 && onPreview(bg.name)}
                    >
                      <img
                        src={scryfallImg(bg.name)}
                        alt={bg.name}
                        className="w-10 h-auto rounded shadow shrink-0"
                        loading="lazy"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                      />
                      <div className="flex-1 min-w-0">
                        <span className="text-sm truncate block">{bg.name}</span>
                        <span className="text-[10px] text-muted-foreground">Land — Basic</span>
                      </div>
                      <div className="flex items-center gap-1 shrink-0" onClick={e => e.stopPropagation()}>
                        <button
                          className="w-5 h-5 flex items-center justify-center rounded bg-accent/40 hover:bg-accent text-muted-foreground hover:text-foreground transition-colors disabled:opacity-30 disabled:pointer-events-none"
                          disabled={bg.count === 0}
                          onClick={() => onRemoveBasicLand?.(bg.name)}
                          title={`Remove a ${bg.name}`}
                        >
                          <Minus className="w-3 h-3" />
                        </button>
                        <span className="text-xs tabular-nums w-5 text-center font-medium">{bg.count}</span>
                        <button
                          className="w-5 h-5 flex items-center justify-center rounded bg-accent/40 hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
                          onClick={() => onAddBasicLand?.(bg.name)}
                          title={`Add a ${bg.name}`}
                        >
                          <Plus className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Recently added from suggestions */}
          {(() => {
            const existingNames = new Set([...cf.fixingLands, ...cf.colorlessOnly, ...cf.manaFixCards, ...cf.nonFixRampCards, ...monoColorLands].map(ac => ac.card.name));
            const suggNames = new Set([...analysis.landRecommendations, ...fixerRecs].map(r => r.name));
            const recentlyAdded = [...addedCards].filter(n => !existingNames.has(n) && suggNames.has(n));
            if (recentlyAdded.length === 0) return null;
            return (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-emerald-400/60 mb-0.5 px-0.5 flex items-center gap-1">
                  <Plus className="w-2.5 h-2.5" />
                  Recently Added ({recentlyAdded.length})
                </p>
                <div className="space-y-0.5">
                  {recentlyAdded.map(name => (
                    <div key={name} className="flex items-center gap-2 py-1 px-1.5 rounded-lg cursor-pointer hover:bg-accent/40 transition-colors" onClick={() => onPreview(name)}>
                      <img src={scryfallImg(name)} alt={name} className="w-10 h-auto rounded shadow shrink-0" loading="lazy" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                      <span className="text-sm truncate flex-1 min-w-0">{name}</span>
                      <span className="text-[9px] font-bold px-1.5 py-px rounded-full bg-emerald-500/15 text-emerald-400 shrink-0">NEW</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}
        </div>

        {/* Vertical divider */}
        {hasSuggestions && <div className="hidden md:block w-px bg-border/30 shrink-0 -my-3" />}

        {/* Right: land + fixer suggestions (color-weighted, filterable by pip selection) */}
        {hasSuggestions && (
          <div className="flex-1 min-w-0 space-y-4">
            {selectedColors.size > 0 ? (
              <p className="text-[10px] text-muted-foreground/50 px-0.5 flex items-center gap-1">
                Showing {[...selectedColors].map(c => <i key={c} className={`ms ms-${c.toLowerCase()} ms-cost text-xs`} />)} sources
              </p>
            ) : cf.weakestColor && (cf.colorsNeeded?.length || 0) >= 2 && cf.fixingGrade !== 'A' ? (
              <p className="text-[10px] text-muted-foreground/50 px-0.5 flex items-center gap-1">
                Prioritizing <i className={`ms ms-${cf.weakestColor.toLowerCase()} ms-cost text-xs`} /> sources
              </p>
            ) : null}
            {filteredFixerRecs.length > 0 && (
              <div>
                <SuggestionCardGrid
                  title={<>Suggested {(cf.colorsNeeded?.length || 0) >= 2 ? 'Fixers' : 'Ramp'} ({filteredFixerRecs.length})</>}
                  cards={filteredFixerRecs}
                  onAdd={onAdd}
                  onPreview={onPreview}
                  addedCards={addedCards}
                  onCardAction={onCardAction}
                  menuProps={menuProps}
                />
              </div>
            )}
            {filteredLandSuggestions.length > 0 && (
              <div>
                <SuggestionCardGrid
                  title={<>Suggested Lands ({filteredLandSuggestions.length})</>}
                  cards={filteredLandSuggestions}
                  onAdd={onAdd}
                  onPreview={onPreview}
                  addedCards={addedCards}
                  onCardAction={onCardAction}
                  menuProps={menuProps}
                />
              </div>
            )}
            {selectedColors.size > 0 && filteredFixerRecs.length === 0 && filteredLandSuggestions.length === 0 && (
              <p className="text-xs text-muted-foreground/40 text-center py-4">No suggestions produce the selected color{selectedColors.size > 1 ? 's' : ''}.</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Flex Lands Summary Box ──────────────────────────────────────
export function FlexLandSummaryBox({ mdfcCount, channelLandCount, totalAvailable, loading }: { mdfcCount: number; channelLandCount: number; totalAvailable: number; loading: boolean }) {
  const [expanded, setExpanded] = useState(true);
  const flexCount = mdfcCount + channelLandCount;
  const status = getMdfcStatus(flexCount);
  const grade = getMdfcGrade(flexCount);
  const gs = FIXING_GRADE_STYLES[grade.letter] || FIXING_GRADE_STYLES.C;

  return (
    <div className="-mx-3 sm:-mx-4 -mt-3 px-3 sm:px-4 pt-3 pb-3 space-y-3 border-b border-border/30">
      <div
        role="button"
        tabIndex={0}
        className="w-full text-[11px] font-semibold uppercase tracking-wider text-foreground/80 px-0.5 flex items-center gap-1 hover:text-foreground/80 transition-colors cursor-pointer select-none"
        onClick={() => setExpanded(prev => !prev)}
      >
        {expanded ? <ChevronDown className="w-3 h-3 text-muted-foreground" /> : <ChevronRight className="w-3 h-3 text-muted-foreground" />}
        <FlipHorizontal2 className="w-3 h-3" />
        Summary
        <GradeInfoPopover>
          <p className="font-semibold text-foreground/80">Flex Land Grading</p>
          <p>MDFCs and channel lands count as both a spell and a land, reducing flood risk. Recommended: 3–6 total.</p>
          <p><span className="font-semibold text-emerald-400">A</span> — 6+ flex lands</p>
          <p><span className="font-semibold text-sky-400">B</span> — 3–5 flex lands</p>
          <p><span className="font-semibold text-amber-400">C</span> — 1–2 flex lands</p>
          <p><span className="font-semibold text-red-400">F</span> — No flex lands</p>
        </GradeInfoPopover>
      </div>
      {expanded && <>
        <div className={`border rounded-lg p-2.5 ${gs.border} ${gs.bg}`}>
          <div className="flex items-center gap-3">
            <div className={`flex items-center justify-center w-12 h-12 rounded-lg ${gs.bgColor} shrink-0`}>
              <span className={`text-2xl font-black leading-none ${gs.color}`}>{grade.letter}</span>
            </div>
            <div className="flex-1 min-w-0 flex items-center justify-center">
              <p className="text-sm text-muted-foreground leading-snug text-center">{status.message}</p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3 text-[10px] text-muted-foreground/70 px-0.5 flex-wrap">
          <span>Target: <span className="font-semibold text-foreground/80">3–6</span></span>
          {channelLandCount > 0 && mdfcCount > 0 && (
            <><span className="text-border">·</span><span>{mdfcCount} MDFC + {channelLandCount} channel</span></>
          )}
          {!loading && <><span className="text-border">·</span><span>{totalAvailable} MDFCs in colors</span></>}
        </div>
      </>}
    </div>
  );
}

// ─── MDFC Lands Detail Panel ─────────────────────────────────────
export function MdfcDetail({
  analysis, mdfcSuggestions, totalMdfcAvailable, mdfcLoading, channelLandCards = [], currentCardNames = new Set<string>(), onPreview, onAdd, addedCards, onCardAction, menuProps, colorIdentity, onAddBasicLand, onRemoveBasicLand,
}: {
  analysis: DeckAnalysis;
  mdfcSuggestions: RecommendedCard[];
  totalMdfcAvailable: number;
  mdfcLoading: boolean;
  channelLandCards?: RecommendedCard[];
  currentCardNames?: Set<string>;
  onPreview: (name: string) => void;
  onAdd: (name: string) => void;
  addedCards: Set<string>;
  onCardAction?: (card: ScryfallCard, action: CardAction) => void;
  menuProps?: CardRowMenuProps;
  colorIdentity: string[];
  onAddBasicLand?: (name: string) => void;
  onRemoveBasicLand?: (name: string) => void;
}) {
  // Split lands into MDFC, channel, nonbasic, and basic groups
  const mdfcLands = analysis.landCards.filter(ac => isMdfcLand(ac.card))
    .sort((a, b) => (b.inclusion ?? 0) - (a.inclusion ?? 0));
  const mdfcNames = new Set(mdfcLands.map(ac => ac.card.name));

  const channelLands = analysis.channelLandsInDeck || [];
  const channelNames = new Set(channelLands.map(ac => ac.card.name));

  const nonbasicLands = analysis.landCards.filter(ac => {
    if (mdfcNames.has(ac.card.name)) return false;
    if (channelNames.has(ac.card.name)) return false;
    const tl = getFrontFaceTypeLine(ac.card).toLowerCase();
    return !/\bbasic\b/.test(tl);
  }).sort((a, b) => (b.inclusion ?? 0) - (a.inclusion ?? 0));

  const basicLands = analysis.landCards.filter(ac => {
    const tl = getFrontFaceTypeLine(ac.card).toLowerCase();
    return /\bbasic\b/.test(tl);
  });
  const COLOR_TO_BASIC: Record<string, string> = { W: 'Plains', U: 'Island', B: 'Swamp', R: 'Mountain', G: 'Forest' };
  const basicCountMap = new Map<string, number>();
  for (const c of colorIdentity) {
    const name = COLOR_TO_BASIC[c];
    if (name) basicCountMap.set(name, 0);
  }
  if (colorIdentity.length === 0) basicCountMap.set('Wastes', 0);
  for (const ac of basicLands) {
    basicCountMap.set(ac.card.name, (basicCountMap.get(ac.card.name) || 0) + 1);
  }
  const basicGroups = [...basicCountMap.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const totalBasicCount = basicGroups.reduce((sum, bg) => sum + bg.count, 0);

  // Count MDFCs added from suggestions (not already in analysis)
  const existingLandNames = new Set(analysis.landCards.map(ac => ac.card.name));
  const mdfcSuggNames = new Set(mdfcSuggestions.map(r => r.name));
  const addedMdfcNames = [...addedCards].filter(n => !existingLandNames.has(n) && mdfcSuggNames.has(n));
  const adjustedMdfcCount = analysis.mdfcsInDeck.length + addedMdfcNames.length;

  const fixLandGroups: CollapsibleGroup[] = [];
  if (mdfcLands.length > 0) fixLandGroups.push({
    key: 'mdfc', label: 'MDFC', count: mdfcLands.length,
    content: (
      <div className="space-y-0.5">
        {mdfcLands.map(ac => (
          <AnalyzedCardRow key={ac.card.name} ac={ac} onPreview={onPreview} showDetails onCardAction={onCardAction} menuProps={menuProps} />
        ))}
      </div>
    ),
  });
  if (channelLands.length > 0) fixLandGroups.push({
    key: 'channel', label: 'Channel', count: channelLands.length,
    content: (
      <div className="space-y-0.5">
        {channelLands.map(ac => (
          <AnalyzedCardRow key={ac.card.name} ac={ac} onPreview={onPreview} showDetails onCardAction={onCardAction} menuProps={menuProps} />
        ))}
      </div>
    ),
  });
  if (nonbasicLands.length > 0) fixLandGroups.push({
    key: 'nonbasic', label: 'Nonbasic', count: nonbasicLands.length,
    content: (
      <div className="space-y-0.5">
        {nonbasicLands.map(ac => (
          <AnalyzedCardRow key={ac.card.name} ac={ac} onPreview={onPreview} showDetails onCardAction={onCardAction} menuProps={menuProps} />
        ))}
      </div>
    ),
  });
  if (basicGroups.length > 0) fixLandGroups.push({
    key: 'basic', label: 'Basic', count: totalBasicCount,
    content: (
      <div className="space-y-0.5">
        {basicGroups.map(bg => (
          <div
            key={bg.name}
            className={`flex items-center gap-2 py-1 px-1.5 rounded-lg transition-colors ${bg.count === 0 ? 'opacity-40' : 'cursor-pointer hover:bg-accent/40'}`}
            onClick={() => bg.count > 0 && onPreview(bg.name)}
          >
            <img src={scryfallImg(bg.name)} alt={bg.name} className="w-10 h-auto rounded shadow shrink-0" loading="lazy" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
            <div className="flex-1 min-w-0">
              <span className="text-sm truncate block">{bg.name}</span>
              <span className="text-[10px] text-muted-foreground">Land — Basic</span>
            </div>
            <div className="flex items-center gap-1 shrink-0" onClick={e => e.stopPropagation()}>
              <button className="w-5 h-5 flex items-center justify-center rounded bg-accent/40 hover:bg-accent text-muted-foreground hover:text-foreground transition-colors disabled:opacity-30 disabled:pointer-events-none" disabled={bg.count === 0} onClick={() => onRemoveBasicLand?.(bg.name)} title={`Remove a ${bg.name}`}>
                <Minus className="w-3 h-3" />
              </button>
              <span className="text-xs tabular-nums w-5 text-center font-medium">{bg.count}</span>
              <button className="w-5 h-5 flex items-center justify-center rounded bg-accent/40 hover:bg-accent text-muted-foreground hover:text-foreground transition-colors" onClick={() => onAddBasicLand?.(bg.name)} title={`Add a ${bg.name}`}>
                <Plus className="w-3 h-3" />
              </button>
            </div>
          </div>
        ))}
      </div>
    ),
  });

  return (
    <div className="-mx-3 sm:-mx-4 -mb-3 sm:-mb-4 bg-black/15 px-3 sm:px-4 py-3">
      <div className="flex flex-col md:flex-row md:items-stretch gap-4">
        {/* Left: summary + all lands in deck */}
        <div className="md:w-[30%] shrink-0 space-y-3">
          <FlexLandSummaryBox
            mdfcCount={adjustedMdfcCount}
            channelLandCount={channelLands.length}
            totalAvailable={totalMdfcAvailable}
            loading={mdfcLoading}
          />

          {analysis.landCards.length > 0 ? (
            <CollapsibleCardGroups groups={fixLandGroups} totalCount={analysis.landCards.length} />
          ) : (
            <div className="text-xs text-muted-foreground px-0.5 space-y-1.5">
              <p className="italic">No lands in your deck yet.</p>
            </div>
          )}
          {/* Recently added from suggestions */}
          {(() => {
            const existingNames = new Set(analysis.landCards.map(ac => ac.card.name));
            const suggNames = new Set(mdfcSuggestions.map(r => r.name));
            const recentlyAdded = [...addedCards].filter(n => !existingNames.has(n) && suggNames.has(n));
            if (recentlyAdded.length === 0) return null;
            return (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-emerald-400/60 mb-0.5 px-0.5 flex items-center gap-1">
                  <Plus className="w-2.5 h-2.5" />
                  Recently Added ({recentlyAdded.length})
                </p>
                <div className="space-y-0.5">
                  {recentlyAdded.map(name => (
                    <div key={name} className="flex items-center gap-2 py-1 px-1.5 rounded-lg cursor-pointer hover:bg-accent/40 transition-colors" onClick={() => onPreview(name)}>
                      <img src={scryfallImg(name)} alt={name} className="w-10 h-auto rounded shadow shrink-0" loading="lazy" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                      <span className="text-sm truncate flex-1 min-w-0">{name}</span>
                      <span className="text-[9px] font-bold px-1.5 py-px rounded-full bg-emerald-500/15 text-emerald-400 shrink-0">NEW</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}
        </div>

        {/* Vertical divider */}
        <div className="hidden md:block w-px bg-border/30 shrink-0 -my-3" />

        {/* Right: channel lands callout + all available MDFCs */}
        <div className="flex-1 min-w-0 space-y-4">
          {/* Channel Lands */}
          {channelLandCards.length > 0 && channelLandCards.some(cl => !currentCardNames.has(cl.name) && !addedCards.has(cl.name)) && (
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-foreground/80 mb-1 px-0.5 flex items-center gap-1">
                <Sparkles className="w-3 h-3" />
                Channel Lands ({channelLandCards.length})
              </p>
              <p className="text-[10px] text-muted-foreground/50 mb-2 px-0.5">
                Lands that double as spells with virtually no downside. We recommend running every one you can.
              </p>
              <SuggestionCardGrid
                cards={channelLandCards}
                onAdd={onAdd}
                onPreview={onPreview}
                addedCards={new Set([...addedCards, ...Array.from(currentCardNames).filter(n => channelLandCards.some(cl => cl.name === n))])}
                onCardAction={onCardAction}
                menuProps={menuProps}
                hideSort
              />
            </div>
          )}

          <p className="text-[11px] font-semibold uppercase tracking-wider text-foreground/80 mb-2 px-0.5 flex items-center gap-1">
            <FlipHorizontal2 className="w-3 h-3" />
            All Available MDFCs {!mdfcLoading && `(${mdfcSuggestions.length})`}
          </p>
          {mdfcLoading ? (
            <div className="flex items-center gap-2 py-8 justify-center text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span className="text-xs">Searching Scryfall for MDFC lands...</span>
            </div>
          ) : mdfcSuggestions.length > 0 ? (
            <SuggestionCardGrid
              cards={mdfcSuggestions}
              onAdd={onAdd}
              onPreview={onPreview}
              addedCards={addedCards}
              deficit={0}
              onCardAction={onCardAction}
              menuProps={menuProps}
              hideSort
            />
          ) : (
            <p className="text-xs text-muted-foreground italic py-4 text-center">No MDFC lands found for your color identity</p>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Lands Tab Content Orchestrator ──────────────────────────────
export function LandsTabContent({
  analysis, activeSection, onSectionChange, onPreview, onAdd, addedCards, currentCards, onCardAction, menuProps, onAddBasicLand, onRemoveBasicLand, cardInclusionMap,
}: {
  analysis: DeckAnalysis;
  activeSection: LandSection | null;
  onSectionChange: (section: LandSection) => void;
  onPreview: (name: string) => void;
  onAdd: (name: string) => void;
  addedCards: Set<string>;
  currentCards: ScryfallCard[];
  onCardAction?: (card: ScryfallCard, action: CardAction) => void;
  menuProps?: CardRowMenuProps;
  onAddBasicLand?: (name: string) => void;
  onRemoveBasicLand?: (name: string) => void;
  cardInclusionMap?: Record<string, number>;
}) {
  const colorIdentity = useStore(s => s.colorIdentity);

  // Track basic land count adjustments (deltas from analysis baseline)
  const handleAddBasic = useCallback((name: string) => {
    onAddBasicLand?.(name);
  }, [onAddBasicLand]);
  const handleRemoveBasic = useCallback((name: string) => {
    onRemoveBasicLand?.(name);
  }, [onRemoveBasicLand]);

  // MDFC search — eager fetch on mount, store ALL results unfiltered
  const [allMdfcCards, setAllMdfcCards] = useState<RecommendedCard[]>([]);
  const [mdfcLoading, setMdfcLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setMdfcLoading(true);

    searchMdfcLands(colorIdentity).then(cards => {
      if (cancelled) return;
      const all: RecommendedCard[] = cards.map(card => {
        const frontName = card.card_faces?.[0]?.name || card.name;
        const role = getCardRole(frontName) || getCardRole(card.name);
        const allRoles = getAllCardRoles(frontName);
        if (allRoles.length === 0) { const r2 = getAllCardRoles(card.name); if (r2.length > 0) allRoles.push(...r2); }
        return {
          name: card.name,
          inclusion: edhrecRankToInclusion(card.edhrec_rank) ?? 0,
          synergy: 0,
          fillsDeficit: false,
          primaryType: card.type_line || '',
          imageUrl: card.card_faces?.[0]?.image_uris?.normal || card.image_uris?.normal,
          backImageUrl: card.card_faces?.[1]?.image_uris?.normal || undefined,
          price: card.prices?.usd || undefined,
          role: role || undefined,
          roleLabel: role ? ROLE_LABELS[role] : undefined,
          allRoleLabels: allRoles.length > 0 ? allRoles.map(r => ROLE_LABELS[r] || r) : undefined,
        };
      });
      setAllMdfcCards(all);
    }).catch(() => {
      if (!cancelled) setAllMdfcCards([]);
    }).finally(() => {
      if (!cancelled) setMdfcLoading(false);
    });

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [colorIdentity]);

  // Channel lands — fetch card data for prices/images
  const channelLandsForColors = useMemo(() => getChannelLandsForColors(colorIdentity), [colorIdentity]);
  const [channelLandCards, setChannelLandCards] = useState<RecommendedCard[]>([]);

  useEffect(() => {
    if (channelLandsForColors.length === 0) { setChannelLandCards([]); return; }
    let cancelled = false;
    const names = channelLandsForColors.map(cl => cl.name);
    getCardsByNames(names).then(cardMap => {
      if (cancelled) return;
      const cards: RecommendedCard[] = channelLandsForColors.map(cl => {
        const card = cardMap.get(cl.name);
        return {
          name: cl.name,
          inclusion: -1, // sentinel: no inclusion data
          synergy: 0,
          fillsDeficit: false,
          primaryType: card?.type_line || 'Legendary Land',
          imageUrl: card?.image_uris?.normal,
          price: card?.prices?.usd || undefined,
        };
      });
      setChannelLandCards(cards);
    }).catch(() => { if (!cancelled) setChannelLandCards([]); });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [colorIdentity]);

  // Filter suggestions: exclude cards currently in deck
  const currentCardNames = useMemo(() => new Set(currentCards.map(c => c.name)), [currentCards]);
  const mdfcSuggestions = useMemo(() =>
    allMdfcCards.filter(r => !currentCardNames.has(r.name) && !currentCardNames.has(r.name.split(' // ')[0])),
    [allMdfcCards, currentCardNames],
  );
  const totalMdfcAvailable = allMdfcCards.length;

  return (
    <div>
      <LandSummaryStrip
        analysis={analysis}
        activeSection={activeSection}
        onSectionClick={onSectionChange}
        mdfcInDeckCount={analysis.mdfcsInDeck.length}
        channelLandCount={(analysis.channelLandsInDeck || []).length}
      />
      {activeSection === 'landCount' && (
        <LandCountDetail analysis={analysis} onPreview={onPreview} onAdd={onAdd} addedCards={addedCards} onCardAction={onCardAction} menuProps={menuProps} colorIdentity={colorIdentity} onAddBasicLand={handleAddBasic} onRemoveBasicLand={handleRemoveBasic} cardInclusionMap={cardInclusionMap} />
      )}
      {activeSection === 'manaSources' && (
        <ManaSourcesDetail analysis={analysis} onPreview={onPreview} onAdd={onAdd} addedCards={addedCards} onCardAction={onCardAction} menuProps={menuProps} />
      )}
      {activeSection === 'fixing' && (
        <FixingDetail analysis={analysis} onPreview={onPreview} onAdd={onAdd} addedCards={addedCards} onCardAction={onCardAction} menuProps={menuProps} colorIdentity={colorIdentity} onAddBasicLand={handleAddBasic} onRemoveBasicLand={handleRemoveBasic} />
      )}
      {activeSection === 'mdfc' && (
        <MdfcDetail analysis={analysis} mdfcSuggestions={mdfcSuggestions} totalMdfcAvailable={totalMdfcAvailable} mdfcLoading={mdfcLoading} channelLandCards={channelLandCards} currentCardNames={currentCardNames} onPreview={onPreview} onAdd={onAdd} addedCards={addedCards} onCardAction={onCardAction} menuProps={menuProps} colorIdentity={colorIdentity} onAddBasicLand={handleAddBasic} onRemoveBasicLand={handleRemoveBasic} />
      )}
    </div>
  );
}
