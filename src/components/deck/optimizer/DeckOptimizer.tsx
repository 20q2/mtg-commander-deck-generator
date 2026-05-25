import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import {
  Loader2, Sparkles, RefreshCw,
  Zap, ArrowLeft,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';
import type { ScryfallCard } from '@/types';
import { fetchCommanderData, fetchPartnerCommanderData, fetchCommanderThemeData, fetchPartnerThemeData } from '@/services/edhrec/client';
import { detectThemes, generateStrategyLabel, buildDetectionMessage, PACING_PHRASE, type DetectedThemeResult, type Pacing } from '@/services/deckBuilder/themeDetector';
import { loadTaggerData } from '@/services/tagger/client';
import { analyzeDeck, getDeckSummaryData, type DeckAnalysis, type RecommendedCard, type CurvePhase } from '@/services/deckBuilder/deckAnalyzer';
import { recomputeRoleTargetsForPacing } from '@/services/deckBuilder/roleTargets';
import { getCardByName, getCardsByNames, getCardPrice, WUBRG } from '@/services/scryfall/client';
import { CardPreviewModal } from '@/components/ui/CardPreviewModal';
import { type CardAction } from '@/components/deck/DeckDisplay';
import { useStore } from '@/store';
import { useUserLists } from '@/hooks/useUserLists';
import { buildThemeMembership } from '@/components/analyze/themeMembership';

import { type DeckOptimizerProps, type TabKey, type LandSection, TABS, PACING_LABELS, HEALTH_GRADE_STYLES, BRACKET_COLORS } from './constants';
import { AdjustPopoverContent } from './OverviewTab';
import { DashboardSummary } from './DashboardSummary';
import { buildDashboardWarnings } from '@/services/deckBuilder/dashboardWarnings';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { RolesTabContent } from './RolesTab';
import { LandsTabContent } from './LandsTab';
import { CurveSummaryStrip, ManaCurveLineChart, CurveDetailPanel, type RoleGroupKey, ROLE_GROUP_ORDER } from './CurveTab';
import { BracketTabContent } from './BracketTab';
import { CostTab } from './CostTab';
import { OptimizeTabContent } from './optimize/OptimizeTabContent';

// ═══════════════════════════════════════════════════════════════════════
// Main Component
// ═══════════════════════════════════════════════════════════════════════
export function DeckOptimizer({
  commanderName,
  partnerCommanderName,
  currentCards,
  deckSize: propDeckSize,
  roleCounts,
  roleTargets,
  cardInclusionMap,
  onAddCards,
  onRemoveCards,
  onRemoveFromBoard,
  onAddBasicLand: onAddBasicLandProp,
  onRemoveBasicLand: onRemoveBasicLandProp,
  sideboardNames,
  maybeboardNames,
  activeTab: controlledActiveTab,
  onTabChange,
  getTabHref,
  initialSelectedCmc,
  commander,
  partnerCommander,
  colorIdentity: commanderColorIdentity,
  sourceLabel,
  onChangeDeck,
  onThemeMembershipChange,
  onMisfitNamesChange,
  onFocusedMisfitChange,
  onSaveAsDeck,
  onOpenInDeckView,
}: DeckOptimizerProps) {
  const [analysis, setAnalysis] = useState<DeckAnalysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addedCards, setAddedCards] = useState<Set<string>>(new Set());
  const [previewCard, setPreviewCard] = useState<ScryfallCard | null>(null);
  const cachedEdhrecDataRef = useRef<import('@/types').EDHRECCommanderData | null>(null);
  const prevCardKeyRef = useRef(currentCards.map(c => c.name).join('\0'));
  const [internalActiveTab, setInternalActiveTab] = useState<TabKey>('overview');
  const activeTab = controlledActiveTab ?? internalActiveTab;
  const setActiveTab = useCallback((tab: TabKey) => {
    if (onTabChange) onTabChange(tab);
    if (controlledActiveTab === undefined) setInternalActiveTab(tab);
    if (tab === 'cost') {
      document.dispatchEvent(new CustomEvent('analyze-set-sort', { detail: { sortKey: 'price' } }));
    }
  }, [onTabChange, controlledActiveTab]);
  const [activeRole, setActiveRole] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<LandSection | null>(null);
  const [activeCurvePhases, setActiveCurvePhases] = useState<Set<CurvePhase>>(new Set());
  const [activeRoleGroups, setActiveRoleGroups] = useState<Set<RoleGroupKey>>(new Set([ROLE_GROUP_ORDER[0]]));
  const [selectedCmc, setSelectedCmc] = useState<number | null>(null);
  // Apply `initialSelectedCmc` whenever the prop changes (e.g. when the user
  // clicks a CMC column in the play area). null clears the focus.
  useEffect(() => {
    if (initialSelectedCmc !== undefined) {
      setSelectedCmc(initialSelectedCmc);
    }
  }, [initialSelectedCmc]);
  // Listen for "See more" from deck grade badge
  const handleOptimizeRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    const handler = () => { handleOptimizeRef.current?.(); };
    document.addEventListener('deck-optimizer-open', handler);
    return () => document.removeEventListener('deck-optimizer-open', handler);
  }, []);

  // Listen for re-analyze requests from external triggers
  // (e.g. the Re-analyze button rendered by CommanderStrip on /analyze).
  // handleOptimize already runs a full fresh analysis — same hook the
  // old in-component Re-analyze button used.
  useEffect(() => {
    const handler = () => { handleOptimizeRef.current?.(); };
    document.addEventListener('deck-optimizer-reanalyze', handler);
    return () => document.removeEventListener('deck-optimizer-reanalyze', handler);
  }, []);

  // When AnalyzePage adds cards via the UI, it dispatches 'analyze-cards-added'
  // with the added card names so we can patch the store with real EDHREC
  // inclusion/synergy instead of the 0 that AnalyzePage would stamp.
  useEffect(() => {
    const handler = (e: Event) => {
      const names: string[] = (e as CustomEvent<{ names?: string[] }>).detail?.names ?? [];
      if (names.length === 0) return;
      const edhrecData = cachedEdhrecDataRef.current;
      if (!edhrecData) return;
      const deck = useStore.getState().generatedDeck;
      if (!deck) return;

      // Build a lookup from the EDHREC payload (allNonLand + lands).
      const edhrecInclusion: Record<string, number> = {};
      const edhrecSynergy: Record<string, number> = {};
      const indexCard = (c: { name: string; inclusion: number; synergy?: number }) => {
        edhrecInclusion[c.name] = c.inclusion;
        if (c.synergy != null) edhrecSynergy[c.name] = c.synergy;
        // Also index front face of DFCs.
        if (c.name.includes(' // ')) {
          const front = c.name.split(' // ')[0];
          edhrecInclusion[front] = c.inclusion;
          if (c.synergy != null) edhrecSynergy[front] = c.synergy;
        }
      };
      for (const c of edhrecData.cardlists.allNonLand) indexCard(c);
      for (const c of edhrecData.cardlists.lands) indexCard(c);

      let changed = false;
      const newInclusionMap = { ...(deck.cardInclusionMap ?? {}) };
      const newSynergyMap = deck.cardSynergyMap ? { ...deck.cardSynergyMap } : undefined;
      let scoreDelta = 0;

      for (const name of names) {
        const realInclusion = edhrecInclusion[name];
        if (realInclusion != null && newInclusionMap[name] === 0) {
          // Correct the stamped-zero with the real EDHREC value.
          scoreDelta += realInclusion; // previously added 0, now add the real value
          newInclusionMap[name] = realInclusion;
          changed = true;
        }
        const realSynergy = edhrecSynergy[name];
        if (realSynergy != null && newSynergyMap && newSynergyMap[name] === 0) {
          newSynergyMap[name] = realSynergy;
          changed = true;
        }
      }

      if (changed) {
        useStore.setState({
          generatedDeck: {
            ...deck,
            cardInclusionMap: newInclusionMap,
            cardSynergyMap: newSynergyMap,
            deckScore: (deck.deckScore ?? 0) + scoreDelta,
          },
        });
      }
    };
    document.addEventListener('analyze-cards-added', handler);
    return () => document.removeEventListener('analyze-cards-added', handler);
  }, []);

  // Card key of the last completed analysis. Compared against currentCards
  // each render to surface a "dirty" indicator on the Re-analyze button
  // when the deck has changed since the last analysis snapshot.
  const [analyzedCardKey, setAnalyzedCardKey] = useState<string>('');
  // Auto-trigger the initial analysis once on mount so users don't have to
  // click "Analyze Deck" every time the page loads.
  const hasAutoAnalyzedRef = useRef(false);

  // Theme detection state
  const [themeDetection, setThemeDetection] = useState<DetectedThemeResult | null>(null);
  const [, setThemeLoading] = useState(false);
  const [primaryThemeSlug, setPrimaryThemeSlug] = useState<string | null>(null);
  const [secondaryThemeSlug, setSecondaryThemeSlug] = useState<string | null>(null);
  const themeDataCacheRef = useRef<Map<string, import('@/types').EDHRECCommanderData>>(new Map());
  const themeEnhancedDataRef = useRef<import('@/types').EDHRECCommanderData | null>(null);

  // Notify parent (AnalyzePage) when the user's selected themes change so it can
  // tag cards with the matching theme chips in the visual stacks.
  useEffect(() => {
    if (!onThemeMembershipChange) return;
    const findTheme = (slug: string | null) => {
      if (!slug) return null;
      const match = themeDetection?.evaluatedThemes.find(t => t.theme.slug === slug);
      return match ? { slug, name: match.theme.name } : null;
    };
    const primary = findTheme(primaryThemeSlug);
    const secondary = findTheme(secondaryThemeSlug);
    if (!primary && !secondary) {
      onThemeMembershipChange(null);
      return;
    }
    const membership = buildThemeMembership(primary, secondary, themeDataCacheRef.current);
    onThemeMembershipChange(membership);
  }, [primaryThemeSlug, secondaryThemeSlug, themeDetection, onThemeMembershipChange]);

  // Emit the misfit name set so the deck-building area can highlight matching cards.
  useEffect(() => {
    if (!onMisfitNamesChange) return;
    const names = new Set<string>();
    for (const m of analysis?.misfits ?? []) names.add(m.card.name);
    onMisfitNamesChange(names);
  }, [analysis, onMisfitNamesChange]);

  // User-overridable tempo (null = use auto-detected)
  const [userPacing, setUserPacing] = useState<Pacing | null>(null);
  const detectedPacingRef = useRef<Pacing | null>(null);

  // User-overridable land target (null = use auto-computed)
  const [userLandTarget, setUserLandTarget] = useState<number | null>(null);

  // User-overridable intended deck size (null = use loaded deck's actual size)
  const [userDeckSize, setUserDeckSize] = useState<number | null>(null);
  const deckSize = userDeckSize ?? propDeckSize;

  // Store subscriptions used inside the analysis handlers below — declared
  // here so handlers can reference them in their dep arrays.
  const colorIdentity = useStore(s => s.colorIdentity);
  const pushDeckHistory = useStore(s => s.pushDeckHistory);

  // The effective pacing: user override > theme-detected > base analysis
  const effectivePacing: Pacing | undefined = userPacing ?? themeDetection?.pacing ?? analysis?.pacing ?? undefined;

  // Role targets adjusted for user pacing override
  const effectiveRoleTargets = useMemo(() => {
    if (!userPacing) return roleTargets;
    const detectedPacing = detectedPacingRef.current ?? 'balanced';
    return recomputeRoleTargetsForPacing(roleTargets, detectedPacing, userPacing);
  }, [roleTargets, userPacing]);


  // Rebuild the detection banner message reflecting user overrides
  const rebuildBannerMessage = useCallback((opts: {
    pacingOverride?: Pacing | null;
    primarySlug?: string | null;
    secondarySlug?: string | null;
  } = {}) => {
    setThemeDetection(prev => {
      if (!prev) return prev;
      const allThemes = cachedEdhrecDataRef.current?.themes || [];
      const primary = opts.primarySlug !== undefined ? opts.primarySlug : primaryThemeSlug;
      const secondary = opts.secondarySlug !== undefined ? opts.secondarySlug : secondaryThemeSlug;
      const pacingVal = opts.pacingOverride !== undefined ? opts.pacingOverride : userPacing;
      const hasUserOverride = pacingVal != null || primary !== prev.matchedThemes[0]?.theme.slug;

      const pacingKey = pacingVal ?? detectedPacingRef.current ?? prev.pacing;
      const pacingLabel = PACING_PHRASE[pacingKey] || prev.pacingLabel;

      const dummyMatch = (slug: string) => {
        const t = allThemes.find(th => th.slug === slug);
        return t ? { theme: t, cardOverlap: 0, themePoolSize: 0, weightedOverlap: 0, synergySum: 0, keywordHits: 0, score: 0 } : null;
      };
      const matchedThemes = [primary, secondary].filter(Boolean).map(s => dummyMatch(s!)).filter(Boolean) as import('@/services/deckBuilder/themeDetector').ThemeMatchResult[];
      const strategyLabel = primary ? generateStrategyLabel(allThemes.find(t => t.slug === primary)?.name || '') : prev.strategyLabel;

      const newMessage = buildDetectionMessage(
        commanderName, matchedThemes, pacingLabel, strategyLabel,
        matchedThemes.length > 0 || prev.isConfident, matchedThemes.length >= 2,
        hasUserOverride,
      );
      return { ...prev, detectionMessage: newMessage, strategyLabel, pacingLabel };
    });
  }, [commanderName, primaryThemeSlug, secondaryThemeSlug, userPacing]);

  // Reset theme state when commander changes
  useEffect(() => {
    setThemeDetection(null);
    setThemeLoading(false);
    setPrimaryThemeSlug(null);
    setSecondaryThemeSlug(null);
    setUserPacing(null);
    detectedPacingRef.current = null;
    themeDataCacheRef.current = new Map();
    themeEnhancedDataRef.current = null;
  }, [commanderName, partnerCommanderName]);

  // Initialize sub-tab defaults once when analysis arrives
  useEffect(() => {
    if (!analysis) return;
    if (activeRole === null && analysis.roleBreakdowns.length > 0) {
      setActiveRole(analysis.roleBreakdowns[0].role);
    }
    if (activeSection === null) {
      setActiveSection('landCount');
    }
    if (activeCurvePhases.size === 0 && analysis.curvePhases.length > 0) {
      setActiveCurvePhases(new Set([analysis.curvePhases[0].phase]));
    }
  }, [analysis]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Build inclusion map from EDHREC data, handling DFC front-face lookups.
   *  The EDHREC-derived portion is cached per data reference (it doesn't
   *  change once fetched) so we don't re-iterate ~3000 entries on every
   *  card-add re-analysis. */
  const inclusionMapCacheRef = useRef(new WeakMap<import('@/types').EDHRECCommanderData, Record<string, number>>());
  const buildInclusionMap = useCallback((edhrecData: import('@/types').EDHRECCommanderData): Record<string, number> => {
    if (cardInclusionMap) return cardInclusionMap;
    let base = inclusionMapCacheRef.current.get(edhrecData);
    if (!base) {
      base = {};
      const indexCard = (name: string, inclusion: number) => {
        base![name] = inclusion;
        if (name.includes(' // ')) base![name.split(' // ')[0]] = inclusion;
      };
      for (const c of edhrecData.cardlists.allNonLand) indexCard(c.name, c.inclusion);
      for (const c of edhrecData.cardlists.lands) indexCard(c.name, c.inclusion);
      inclusionMapCacheRef.current.set(edhrecData, base);
    }
    // Layer on DFC entries from the current deck — cheap (only DFCs in deck).
    let withDfc: Record<string, number> | null = null;
    for (const card of currentCards) {
      if (card.name.includes(' // ') && base[card.name] === undefined) {
        const front = card.name.split(' // ')[0];
        if (base[front] !== undefined) {
          if (!withDfc) withDfc = { ...base };
          withDfc[card.name] = base[front];
        }
      }
    }
    return withDfc ?? base;
  }, [cardInclusionMap, currentCards]);

  /** Merge two recommendation pools (e.g. primary + secondary theme).
   *  `primary` recs are the main source; `secondary` supplements.
   *  Cards in both pools get a synergy boost. */
  const mergeRecommendations = useCallback((
    primary: RecommendedCard[],
    secondary: RecommendedCard[],
    limit = 30,
  ): RecommendedCard[] => {
    const merged = new Map<string, RecommendedCard>();

    for (const rec of primary) {
      merged.set(rec.name, { ...rec });
    }
    for (const rec of secondary) {
      if (merged.has(rec.name)) {
        // In both pools → boost score (strong cross-theme signal)
        const existing = merged.get(rec.name)!;
        merged.set(rec.name, { ...existing, score: (existing.score ?? 0) + 20 });
      } else {
        merged.set(rec.name, { ...rec });
      }
    }

    return Array.from(merged.values())
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
      .slice(0, limit);
  }, []);

  /** Theme-first merge: theme data drives, base staples (inclusion >= 50%) backfill.
   *  Cards in both theme + base get boosted (on-theme AND widely played). */
  const mergeThemeWithBaseStaples = useCallback((
    themeRecs: RecommendedCard[],
    baseRecs: RecommendedCard[],
    limit = 30,
  ): RecommendedCard[] => {
    const merged = new Map<string, RecommendedCard>();

    // Theme recs are the primary pool
    for (const rec of themeRecs) {
      merged.set(rec.name, { ...rec, isThemeSynergy: true });
    }

    // Base cards: boost overlapping cards, backfill high-inclusion staples
    for (const rec of baseRecs) {
      if (merged.has(rec.name)) {
        // On-theme AND a commander staple → strong signal, boost
        const existing = merged.get(rec.name)!;
        merged.set(rec.name, { ...existing, score: (existing.score ?? 0) + 25 });
      } else if (rec.inclusion >= 50) {
        // High-inclusion staple not in theme pool → backfill (no theme tag)
        merged.set(rec.name, { ...rec, isThemeSynergy: false });
      }
      // Base cards below 50% inclusion that aren't on-theme → dropped
    }

    return Array.from(merged.values())
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
      .slice(0, limit);
  }, []);

  /** Run base + (optional) theme analysis and merge results.
   *  Returns null when no cached EDHREC data is available.
   *
   *  `baseOnly: true` skips the theme analyzeDeck call, halving the work for
   *  card-add/remove updates. Role counts, curve, and the cards-filling-this-role
   *  list all come from baseResult either way; only suggestedReplacements
   *  loses its theme bias until the next full re-analyze. */
  const runAnalysisFor = useCallback((opts: {
    targets: Record<string, number>;
    pacing?: Pacing;
    landTarget?: number;
    baseOnly?: boolean;
  }) => {
    const baseData = cachedEdhrecDataRef.current;
    if (!baseData) return null;

    const commanderNamesForAnalyze = partnerCommanderName ? [commanderName, partnerCommanderName] : [commanderName];
    const baseInclusionMap = buildInclusionMap(baseData);
    const baseResult = analyzeDeck({
      edhrecData: baseData, currentCards, roleCounts, roleTargets: opts.targets, deckSize,
      cardInclusionMap: baseInclusionMap, colorIdentity,
      overridePacing: opts.pacing, overrideLandTarget: opts.landTarget,
      commanderNames: commanderNamesForAnalyze,
    });

    const themeData = themeEnhancedDataRef.current;
    if (!themeData || opts.baseOnly) return baseResult;

    const themeInclusionMap = buildInclusionMap(themeData);
    const themeResult = analyzeDeck({
      edhrecData: themeData, currentCards, roleCounts, roleTargets: opts.targets, deckSize,
      cardInclusionMap: themeInclusionMap, colorIdentity,
      overridePacing: opts.pacing, overrideLandTarget: opts.landTarget,
      commanderNames: commanderNamesForAnalyze,
    });
    const mergedRecs = mergeRecommendations(baseResult.recommendations, themeResult.recommendations);
    const mergedRoleBreakdowns = baseResult.roleBreakdowns.map((baseRb, idx) => {
      const themeRb = themeResult.roleBreakdowns[idx];
      if (!themeRb) return baseRb;
      return { ...baseRb, suggestedReplacements: mergeRecommendations(baseRb.suggestedReplacements, themeRb.suggestedReplacements) };
    });
    const mergedLandRecs = mergeRecommendations(baseResult.landRecommendations, themeResult.landRecommendations, 15);
    return { ...baseResult, recommendations: mergedRecs, roleBreakdowns: mergedRoleBreakdowns, landRecommendations: mergedLandRecs };
  }, [currentCards, roleCounts, deckSize, buildInclusionMap, mergeRecommendations, colorIdentity]);

  // When user adjusts the intended deck size, re-run analysis. The new
  // deckSize takes effect on the next render via the `deckSize` derivation
  // above, but runAnalysisFor closes over the *current* render's deckSize —
  // so we schedule the re-run after state has flushed.
  const handleDeckSizeChange = useCallback((newSize: number | null) => {
    setUserDeckSize(newSize);
  }, []);

  // Re-run analysis whenever the effective deckSize changes via user override.
  useEffect(() => {
    if (!analysis) return;
    const result = runAnalysisFor({
      targets: effectiveRoleTargets,
      pacing: userPacing ?? undefined,
      landTarget: userLandTarget ?? undefined,
    });
    if (result) setAnalysis(result);
    // We deliberately only react to userDeckSize here — other deps would
    // double-fire the analysis loop that already exists for them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userDeckSize]);

  // When user changes land target, re-run analysis with the new override
  const handleLandTargetChange = useCallback((newTarget: number | null) => {
    setUserLandTarget(newTarget);
    if (!analysis) return;
    const result = runAnalysisFor({
      targets: effectiveRoleTargets,
      pacing: userPacing ?? undefined,
      landTarget: newTarget ?? undefined,
    });
    if (result) setAnalysis(result);
  }, [analysis, effectiveRoleTargets, userPacing, runAnalysisFor]);

  // When user changes pacing, re-run full analysis with adjusted role targets
  const handlePacingChange = useCallback((newPacing: Pacing | null) => {
    setUserPacing(newPacing);
    if (!analysis) {
      rebuildBannerMessage({ pacingOverride: newPacing });
      return;
    }
    const detPacing = detectedPacingRef.current ?? 'balanced';
    const newTargets = newPacing
      ? recomputeRoleTargetsForPacing(roleTargets, detPacing, newPacing)
      : roleTargets;
    const result = runAnalysisFor({
      targets: newTargets,
      pacing: newPacing ?? undefined,
      landTarget: userLandTarget ?? undefined,
    });
    if (result) setAnalysis(result);
    rebuildBannerMessage({ pacingOverride: newPacing });
  }, [analysis, rebuildBannerMessage, roleTargets, userLandTarget, runAnalysisFor]);

  const handleOptimize = async () => {
    setLoading(true);
    setError(null);
    setThemeDetection(null);
    setPrimaryThemeSlug(null);
    setSecondaryThemeSlug(null);
    themeDataCacheRef.current = new Map();
    themeEnhancedDataRef.current = null;

    try {
      // ── Phase 1: Base analysis (blocking) ──
      await loadTaggerData();
      const edhrecData = partnerCommanderName
        ? await fetchPartnerCommanderData(commanderName, partnerCommanderName)
        : await fetchCommanderData(commanderName);
      cachedEdhrecDataRef.current = edhrecData;

      const effectiveInclusionMap = buildInclusionMap(edhrecData);

      const storedDeck = useStore.getState().generatedDeck;
      const baseResult = analyzeDeck({
        edhrecData,
        currentCards,
        roleCounts,
        roleTargets,
        deckSize,
        cardInclusionMap: effectiveInclusionMap,
        colorIdentity,
        overrideLandTarget: userLandTarget ?? undefined,
        cardSynergyMap: storedDeck?.cardSynergyMap,
        gapCandidates: storedDeck?.gapAnalysis,
        commanderNames: partnerCommanderName ? [commanderName, partnerCommanderName] : [commanderName],
      });

      // Enrich recommendations with Scryfall prices/colors
      const allRecs: RecommendedCard[] = [
        ...baseResult.recommendations,
        ...baseResult.landRecommendations,
        ...(baseResult.colorFixing.fixingRecommendations || []),
        ...baseResult.roleBreakdowns.flatMap(rb => rb.suggestedReplacements),
      ];
      const needsFetch = [...new Set(allRecs.filter(r => !r.price || !r.producedColors?.length || r.cmc == null).map(r => r.name))];

      if (needsFetch.length > 0) {
        try {
          const scryfallCards = await getCardsByNames(needsFetch);
          const priceMap = new Map<string, string>();
          const colorMap = new Map<string, string[]>();
          const cmcMap = new Map<string, number>();
          for (const [name, card] of scryfallCards) {
            const p = getCardPrice(card);
            if (p) priceMap.set(name, p);
            if (card.cmc != null) cmcMap.set(name, card.cmc);
            const produced = (card.produced_mana || []).filter((c: string) => (WUBRG as readonly string[]).includes(c));
            if (produced.length > 0) {
              colorMap.set(name, [...new Set(produced)]);
            } else if (card.color_identity?.length) {
              colorMap.set(name, card.color_identity.map((c: string) => c.toUpperCase()));
            }
          }
          for (const rec of allRecs) {
            if (!rec.price) rec.price = priceMap.get(rec.name) || undefined;
            if (!rec.producedColors?.length) rec.producedColors = colorMap.get(rec.name) || undefined;
            if (rec.cmc == null) rec.cmc = cmcMap.get(rec.name);
          }
        } catch { /* prices/colors are nice-to-have */ }
      }

      detectedPacingRef.current = baseResult.pacing;
      setAnalysis(baseResult);
      setAddedCards(new Set());
      setLoading(false); // Dashboard visible NOW

      // Emit grade to sidebar so both display the same result
      const baseSummary = getDeckSummaryData(baseResult);
      document.dispatchEvent(new CustomEvent('deck-optimizer-grade', {
        detail: { letter: baseSummary.gradeLetter, headline: baseSummary.headline },
      }));

      // ── Phase 2: Theme detection (non-blocking) ──
      const topThemes = (edhrecData.themes || []).slice(0, 4);
      if (topThemes.length === 0) return; // no themes available

      setThemeLoading(true);

      // Fetch theme-specific EDHREC data (sequential for rate limiting)
      const themeDataMap = new Map<string, import('@/types').EDHRECCommanderData>();
      for (const theme of topThemes) {
        try {
          const data = partnerCommanderName
            ? await fetchPartnerThemeData(commanderName, partnerCommanderName, theme.slug)
            : await fetchCommanderThemeData(commanderName, theme.slug);
          themeDataMap.set(theme.slug, data);
        } catch (err) {
          console.warn(`[DeckOptimizer] Failed to fetch theme data for ${theme.slug}:`, err);
        }
      }
      themeDataCacheRef.current = themeDataMap;

      if (themeDataMap.size === 0) {
        setThemeLoading(false);
        return;
      }

      // Run detection
      const detection = detectThemes(
        topThemes,
        themeDataMap,
        currentCards,
        baseResult.curveAnalysis,
        commanderName,
      );
      setThemeDetection(detection);

      // If confident, enhance recommendations with theme data
      if (detection.isConfident && detection.matchedThemes.length > 0) {
        const bestSlug = detection.matchedThemes[0].theme.slug;
        const bestThemeData = themeDataMap.get(bestSlug);
        setPrimaryThemeSlug(bestSlug);
        // If secondary theme detected, set it too
        if (detection.hasSecondaryTheme && detection.matchedThemes.length >= 2) {
          setSecondaryThemeSlug(detection.matchedThemes[1].theme.slug);
        }

        if (bestThemeData) {
          themeEnhancedDataRef.current = bestThemeData;

          // Build theme membership for plan score computation
          const secondarySlugForMembership = detection.hasSecondaryTheme && detection.matchedThemes.length >= 2
            ? detection.matchedThemes[1].theme.slug
            : null;
          const primaryThemeInfo = { slug: bestSlug, name: detection.matchedThemes[0].theme.name };
          const secondaryThemeInfo = secondarySlugForMembership
            ? { slug: secondarySlugForMembership, name: detection.matchedThemes[1].theme.name }
            : null;
          const themeMembershipForScore = buildThemeMembership(primaryThemeInfo, secondaryThemeInfo, themeDataCacheRef.current);
          const storedDeckForTheme = useStore.getState().generatedDeck;

          const themeInclusionMap = buildInclusionMap(bestThemeData);
          const themeResult = analyzeDeck({
            edhrecData: bestThemeData,
            currentCards,
            roleCounts,
            roleTargets,
            deckSize,
            cardInclusionMap: themeInclusionMap,
            colorIdentity,
            overrideLandTarget: userLandTarget ?? undefined,
            themeMembership: themeMembershipForScore,
            primaryThemeData: bestThemeData,
            planName: primaryThemeInfo.name,
            cardSynergyMap: storedDeckForTheme?.cardSynergyMap,
            gapCandidates: storedDeckForTheme?.gapAnalysis,
            commanderNames: partnerCommanderName ? [commanderName, partnerCommanderName] : [commanderName],
          });

          // Theme drives; base staples (50%+ inclusion) backfill
          const finalRecs = mergeThemeWithBaseStaples(themeResult.recommendations, baseResult.recommendations);
          const finalRoleBreakdowns = themeResult.roleBreakdowns.map((themeRb, idx) => {
            const baseRb = baseResult.roleBreakdowns[idx];
            if (!baseRb) return themeRb;
            return { ...themeRb, suggestedReplacements: mergeThemeWithBaseStaples(themeRb.suggestedReplacements, baseRb.suggestedReplacements) };
          });
          const finalLandRecs = mergeThemeWithBaseStaples(themeResult.landRecommendations, baseResult.landRecommendations, 15);

          // Enrich theme-only recs with prices BEFORE committing the analysis.
          // Rows are React.memo'd, so mutating rec.price after setAnalysis
          // wouldn't trigger a re-render — prices must be in place when the
          // new rec objects first land in state.
          const allFinalRecs: RecommendedCard[] = [
            ...finalRecs,
            ...finalLandRecs,
            ...finalRoleBreakdowns.flatMap(rb => rb.suggestedReplacements),
          ];
          const newRecs = allFinalRecs.filter(r => !r.price);
          if (newRecs.length > 0) {
            try {
              const cards = await getCardsByNames(newRecs.map(r => r.name));
              for (const rec of newRecs) {
                const card = cards.get(rec.name);
                if (card) {
                  const p = getCardPrice(card);
                  if (p) rec.price = p;
                }
              }
            } catch { /* non-critical */ }
          }

          setAnalysis(prev => prev ? {
            ...prev,
            recommendations: finalRecs,
            roleBreakdowns: finalRoleBreakdowns,
            landRecommendations: finalLandRecs,
            planScore: themeResult.planScore,
            misfits: themeResult.misfits,
          } : prev);
        }
      }

      setThemeLoading(false);
    } catch (err) {
      setError('Failed to fetch EDHREC data. Please try again.');
      console.error('[DeckOptimizer]', err);
      setLoading(false);
      setThemeLoading(false);
    }
  };

  handleOptimizeRef.current = handleOptimize;

  // Auto-fire the initial analysis once on mount when we have a commander.
  useEffect(() => {
    if (hasAutoAnalyzedRef.current) return;
    if (analysis || loading || !commanderName) return;
    hasAutoAnalyzedRef.current = true;
    handleOptimizeRef.current?.();
  }, [commanderName, analysis, loading]);

  // Re-run analysis when cards change (add/remove). Runs synchronously on
  // each card-key change so the role panel updates instantly. Skips theme
  // re-analysis (baseOnly) to keep this path snappy — the user gets fresh
  // role counts and rb.cards instantly, and a full theme re-merge happens
  // on the next explicit Re-analyze.
  const hasAnalysis = analysis != null;
  useEffect(() => {
    if (!cachedEdhrecDataRef.current || !hasAnalysis) return;
    const cardKey = currentCards.map(c => c.name).join('\0');
    if (cardKey === prevCardKeyRef.current) return;
    prevCardKeyRef.current = cardKey;
    const result = runAnalysisFor({
      targets: effectiveRoleTargets,
      pacing: userPacing ?? undefined,
      landTarget: userLandTarget ?? undefined,
      baseOnly: true,
    });
    if (result) setAnalysis(result);
  }, [currentCards, effectiveRoleTargets, userPacing, userLandTarget, hasAnalysis, runAnalysisFor]);

  // Snapshot the card key whenever a new analysis lands, so we can show a
  // "deck has changed since last analysis" indicator on the Re-analyze button.
  useEffect(() => {
    if (analysis) {
      setAnalyzedCardKey(currentCards.map(c => c.name).join('\0'));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analysis]);

  const handleAddCard = useCallback((name: string) => {
    if (!onAddCards) return;
    onAddCards([name], 'deck');
    pushDeckHistory({ action: 'add', cardName: name });
    setAddedCards(prev => new Set([...prev, name]));
  }, [onAddCards, pushDeckHistory]);

  const handlePreview = useCallback(async (name: string) => {
    try {
      const card = await getCardByName(name);
      if (card) setPreviewCard(card);
    } catch { /* silently fail */ }
  }, []);

  // Fetch theme data helper (cached)
  const fetchThemeData = useCallback(async (slug: string) => {
    let data = themeDataCacheRef.current.get(slug);
    if (!data) {
      data = partnerCommanderName
        ? await fetchPartnerThemeData(commanderName, partnerCommanderName, slug)
        : await fetchCommanderThemeData(commanderName, slug);
      themeDataCacheRef.current.set(slug, data);
    }
    return data;
  }, [commanderName, partnerCommanderName]);

  // Apply theme selection — uses theme data directly (base only when no themes selected)
  const applyThemeSelection = useCallback(async (primary: string | null, secondary: string | null) => {
    const cachedBase = cachedEdhrecDataRef.current;
    if (!cachedBase || !analysis) return;

    // Helper to resolve slug → theme info (name) from evaluated themes
    const findThemeInfo = (slug: string | null) => {
      if (!slug) return null;
      const match = themeDetection?.evaluatedThemes.find(t => t.theme.slug === slug);
      return match ? { slug, name: match.theme.name } : null;
    };

    // No themes → revert to base-only analysis
    if (!primary && !secondary) {
      themeEnhancedDataRef.current = null;
      const baseInclusionMap = buildInclusionMap(cachedBase);
      const storedDeckForBase = useStore.getState().generatedDeck;
      const baseResult = analyzeDeck({
        edhrecData: cachedBase, currentCards, roleCounts, roleTargets: effectiveRoleTargets, deckSize,
        cardInclusionMap: baseInclusionMap, colorIdentity,
        overridePacing: userPacing ?? undefined, overrideLandTarget: userLandTarget ?? undefined,
        cardSynergyMap: storedDeckForBase?.cardSynergyMap,
        gapCandidates: storedDeckForBase?.gapAnalysis,
        commanderNames: partnerCommanderName ? [commanderName, partnerCommanderName] : [commanderName],
      });

      setAnalysis(prev => prev ? {
        ...prev,
        recommendations: baseResult.recommendations,
        roleBreakdowns: baseResult.roleBreakdowns,
        landRecommendations: baseResult.landRecommendations,
        planScore: baseResult.planScore,
        misfits: baseResult.misfits,
      } : prev);

      // Restore detection message (still reflects user tempo override if any)
      rebuildBannerMessage({ primarySlug: null, secondarySlug: null });
      setThemeLoading(false);
      return;
    }

    setThemeLoading(true);

    // Base analysis (for staple backfill — only high-inclusion cards leak through)
    const baseInclusionMap = buildInclusionMap(cachedBase);
    const baseResult = analyzeDeck({
      edhrecData: cachedBase, currentCards, roleCounts, roleTargets: effectiveRoleTargets, deckSize,
      cardInclusionMap: baseInclusionMap, colorIdentity,
      overridePacing: userPacing ?? undefined, overrideLandTarget: userLandTarget ?? undefined,
      commanderNames: partnerCommanderName ? [commanderName, partnerCommanderName] : [commanderName],
    });

    // Primary theme → main data source, backfilled with base staples
    try {
      const primaryData = await fetchThemeData(primary!);
      themeEnhancedDataRef.current = primaryData;
      const primaryIncMap = buildInclusionMap(primaryData);
      const storedDeckForTheme = useStore.getState().generatedDeck;

      // Resolve theme info (name) for plan scoring
      const primaryThemeInfo = findThemeInfo(primary);
      const secondaryThemeInfo = findThemeInfo(secondary);
      const themeMembershipForScore = buildThemeMembership(primaryThemeInfo, secondaryThemeInfo, themeDataCacheRef.current);
      const planNameForScore = primaryThemeInfo?.name ?? null;

      const primaryResult = analyzeDeck({
        edhrecData: primaryData, currentCards, roleCounts, roleTargets: effectiveRoleTargets, deckSize,
        cardInclusionMap: primaryIncMap, colorIdentity,
        overridePacing: userPacing ?? undefined, overrideLandTarget: userLandTarget ?? undefined,
        themeMembership: themeMembershipForScore,
        primaryThemeData: primaryData,
        planName: planNameForScore,
        cardSynergyMap: storedDeckForTheme?.cardSynergyMap,
        gapCandidates: storedDeckForTheme?.gapAnalysis,
        commanderNames: partnerCommanderName ? [commanderName, partnerCommanderName] : [commanderName],
      });

      // Theme drives recommendations; base staples (50%+ inclusion) backfill gaps
      let finalRecs = mergeThemeWithBaseStaples(primaryResult.recommendations, baseResult.recommendations);
      let finalRoleBreakdowns = primaryResult.roleBreakdowns.map((themeRb, idx) => {
        const baseRb = baseResult.roleBreakdowns[idx];
        if (!baseRb) return themeRb;
        return { ...themeRb, suggestedReplacements: mergeThemeWithBaseStaples(themeRb.suggestedReplacements, baseRb.suggestedReplacements) };
      });
      let finalLandRecs = mergeThemeWithBaseStaples(primaryResult.landRecommendations, baseResult.landRecommendations, 15);

      // Secondary theme supplements the primary
      if (secondary) {
        try {
          const secondaryData = await fetchThemeData(secondary);
          const secondaryIncMap = buildInclusionMap(secondaryData);
          const secondaryResult = analyzeDeck({
            edhrecData: secondaryData, currentCards, roleCounts, roleTargets: effectiveRoleTargets, deckSize,
            cardInclusionMap: secondaryIncMap, colorIdentity,
            overridePacing: userPacing ?? undefined, overrideLandTarget: userLandTarget ?? undefined,
          });

          finalRecs = mergeRecommendations(finalRecs, secondaryResult.recommendations);
          finalRoleBreakdowns = finalRoleBreakdowns.map((rb, idx) => {
            const themeRb = secondaryResult.roleBreakdowns[idx];
            if (!themeRb) return rb;
            return { ...rb, suggestedReplacements: mergeRecommendations(rb.suggestedReplacements, themeRb.suggestedReplacements) };
          });
          finalLandRecs = mergeRecommendations(finalLandRecs, secondaryResult.landRecommendations, 15);
        } catch (err) {
          console.error('[DeckOptimizer] Failed to fetch secondary theme data:', err);
        }
      }

      setAnalysis(prev => prev ? {
        ...prev,
        recommendations: finalRecs,
        roleBreakdowns: finalRoleBreakdowns,
        landRecommendations: finalLandRecs,
        planScore: primaryResult.planScore,
        misfits: primaryResult.misfits,
      } : prev);
    } catch (err) {
      console.error('[DeckOptimizer] Failed to fetch primary theme data:', err);
      setThemeLoading(false);
      return;
    }

    // Update banner detection message
    rebuildBannerMessage({ primarySlug: primary, secondarySlug: secondary });

    setThemeLoading(false);
  }, [analysis, currentCards, roleCounts, effectiveRoleTargets, deckSize, buildInclusionMap, mergeRecommendations, mergeThemeWithBaseStaples, fetchThemeData, rebuildBannerMessage, userPacing, userLandTarget, colorIdentity, themeDetection]);

  // Sequential-pick theme selection handler
  const handleThemeSelect = useCallback(async (slug: string) => {
    let newPrimary = primaryThemeSlug;
    let newSecondary = secondaryThemeSlug;

    if (slug === primaryThemeSlug) {
      // Deselect primary → promote secondary
      newPrimary = secondaryThemeSlug;
      newSecondary = null;
    } else if (slug === secondaryThemeSlug) {
      // Deselect secondary
      newSecondary = null;
    } else if (!primaryThemeSlug) {
      // No primary → set as primary
      newPrimary = slug;
    } else if (!secondaryThemeSlug) {
      // Primary exists, no secondary → set as secondary
      newSecondary = slug;
    } else {
      // Both exist → replace secondary
      newSecondary = slug;
    }

    setPrimaryThemeSlug(newPrimary);
    setSecondaryThemeSlug(newSecondary);
    await applyThemeSelection(newPrimary, newSecondary);
  }, [primaryThemeSlug, secondaryThemeSlug, applyThemeSelection]);

  // Context menu support
  const customization = useStore(s => s.customization);
  const updateCustomization = useStore(s => s.updateCustomization);
  const storeSelectedThemes = useStore(s => s.selectedThemes);
  const usedThemes = useStore(s => s.generatedDeck?.usedThemes);
  const bracketLevel = useStore(s => s.generatedDeck?.bracketEstimation?.bracket);
  const displayThemeNames = useMemo(() => {
    // 1. If user selected themes in the optimizer, show those
    if (primaryThemeSlug || secondaryThemeSlug) {
      const allThemes = cachedEdhrecDataRef.current?.themes || [];
      const names: string[] = [];
      if (primaryThemeSlug) {
        const match = allThemes.find(t => t.slug === primaryThemeSlug);
        if (match) names.push(match.name);
      }
      if (secondaryThemeSlug) {
        const match = allThemes.find(t => t.slug === secondaryThemeSlug);
        if (match) names.push(match.name);
      }
      if (names.length > 0) return names;
    }
    // 2. Store-selected themes from BuilderPage
    const selected = storeSelectedThemes.filter(t => t.isSelected).map(t => t.name);
    if (selected.length > 0) return selected;
    // 3. Themes baked into the generated deck
    if (usedThemes && usedThemes.length > 0) return usedThemes;
    // 4. Auto-detected themes
    if (themeDetection?.matchedThemes?.length) return themeDetection.matchedThemes.map(t => t.theme.name);
    return undefined;
  }, [primaryThemeSlug, secondaryThemeSlug, storeSelectedThemes, usedThemes, themeDetection]);
  const { lists: userLists, updateList, createList } = useUserLists();

  const handleCardAction = useCallback((card: ScryfallCard, action: CardAction) => {
    const name = card.name;
    switch (action.type) {
      case 'remove':
        onRemoveCards?.([name]);
        pushDeckHistory({ action: 'remove', cardName: name });
        setAddedCards(prev => { const next = new Set(prev); next.delete(name); return next; });
        break;
      case 'addToDeck':
        onAddCards?.([name], 'deck');
        pushDeckHistory({ action: 'add', cardName: name });
        setAddedCards(prev => new Set([...prev, name]));
        break;
      case 'sideboard': {
        if (sideboardNames?.includes(name)) {
          onRemoveFromBoard?.(name, 'sideboard');
          pushDeckHistory({ action: 'remove', cardName: name });
        } else {
          onAddCards?.([name], 'sideboard');
          pushDeckHistory({ action: 'sideboard', cardName: name });
        }
        break;
      }
      case 'maybeboard': {
        if (maybeboardNames?.includes(name)) {
          onRemoveFromBoard?.(name, 'maybeboard');
          pushDeckHistory({ action: 'remove', cardName: name });
        } else {
          onAddCards?.([name], 'maybeboard');
          pushDeckHistory({ action: 'maybeboard', cardName: name });
        }
        break;
      }
      case 'mustInclude': {
        const current = customization.mustIncludeCards;
        const has = current.includes(name);
        updateCustomization({ mustIncludeCards: has ? current.filter(n => n !== name) : [...current, name] });
        break;
      }
      case 'exclude': {
        const currentBanned = customization.bannedCards;
        const hasBan = currentBanned.includes(name);
        updateCustomization({ bannedCards: hasBan ? currentBanned.filter(n => n !== name) : [...currentBanned, name] });
        break;
      }
      case 'addToList': {
        const list = userLists.find(l => l.id === action.listId);
        if (list && !list.cards.includes(name)) {
          updateList(action.listId, { cards: [...list.cards, name] });
        }
        break;
      }
      case 'createListAndAdd': {
        createList(action.listName, [name]);
        break;
      }
    }
  }, [customization, updateCustomization, userLists, updateList, createList, onAddCards, onRemoveCards, onRemoveFromBoard, sideboardNames, maybeboardNames, pushDeckHistory]);

  const menuProps = useMemo(() => ({
    userLists,
    mustIncludeNames: new Set(customization.mustIncludeCards),
    bannedNames: new Set(customization.bannedCards),
    sideboardNames: new Set(sideboardNames || []),
    maybeboardNames: new Set(maybeboardNames || []),
  }), [userLists, customization.mustIncludeCards, customization.bannedCards, sideboardNames, maybeboardNames]);

  const deckExcess = currentCards.length - deckSize;

  // True when the deck cards differ from what was analyzed — drives the
  // "this is stale, re-run me" gold treatment on the Re-analyze button.
  const currentCardKey = useMemo(() => currentCards.map(c => c.name).join('\0'), [currentCards]);
  const isAnalysisDirty = analysis != null && analyzedCardKey !== '' && analyzedCardKey !== currentCardKey;

  // Broadcast analyzer state so an external Re-analyze button (rendered
  // by CommanderStrip on /analyze) can reflect dirty/loading visuals.
  useEffect(() => {
    // For the Tempo (curve) tab, surface the selected phase + role group so
    // the play area on the right can desaturate non-matching cards the same
    // way the Roles tab does.
    const curvePhase = activeTab === 'curve' && activeCurvePhases.size === 1
      ? [...activeCurvePhases][0] : null;
    // A clicked CMC column overrides the phase range — narrow filter wins
    // so the play area zooms to just that column.
    const curvePhaseRange: [number, number] | null = activeTab === 'curve' && selectedCmc != null
      ? [selectedCmc, selectedCmc]
      : (activeTab === 'curve' && curvePhase != null
          ? analysis?.curvePhases.find(p => p.phase === curvePhase)?.cmcRange ?? null
          : null);
    const curveRoleGroup = activeTab === 'curve' && activeRoleGroups.size === 1
      ? [...activeRoleGroups][0] : null;
    document.dispatchEvent(new CustomEvent('deck-optimizer-state', {
      detail: {
        dirty: isAnalysisDirty, loading, hasAnalysis: !!analysis, activeTab, activeRole,
        activeCmcRange: curvePhaseRange,
        activeRoleGroup: curveRoleGroup,
      },
    }));
  }, [isAnalysisDirty, loading, analysis, activeTab, activeRole, activeCurvePhases, activeRoleGroups, selectedCmc]);

  // Per-tab rollup grades shown in the tab bar — same letters as the
  // overview summary card so the user sees consistent grading at a glance.
  // Bracket has no rollup grade (uses level 1-5 instead) so it's omitted.
  const tabGrades = useMemo<Partial<Record<TabKey, string>>>(() => {
    if (!analysis) return {};
    return {
      overview: getDeckSummaryData(analysis, deckExcess).gradeLetter,
      roles: analysis.rolesGrade.letter,
      lands: analysis.manaGrade.letter,
      curve: analysis.curveGrade.letter,
    };
  }, [analysis, deckExcess]);

  // Total deck price for the Cost tab sidebar badge. Cheap sum across cards.
  const deckTotalPrice = useMemo(() => {
    let total = 0;
    for (const card of currentCards) {
      const raw = getCardPrice(card);
      const n = raw != null ? Number(raw) : NaN;
      if (Number.isFinite(n)) total += n;
    }
    return total;
  }, [currentCards]);
  const costBadgeLabel = useMemo(() => {
    if (deckTotalPrice >= 1000) return `$${(deckTotalPrice / 1000).toFixed(1)}k`;
    return `$${Math.round(deckTotalPrice)}`;
  }, [deckTotalPrice]);
  const handleBasicLandAdd = useMemo(() => {
    const base = onAddBasicLandProp ?? (onAddCards ? (name: string) => onAddCards([name], 'deck') : undefined);
    if (!base) return undefined;
    return (name: string) => { base(name); pushDeckHistory({ action: 'add', cardName: name }); };
  }, [onAddBasicLandProp, onAddCards, pushDeckHistory]);

  const handleBasicLandRemove = useMemo(() => {
    const base = onRemoveBasicLandProp ?? (onRemoveCards ? (name: string) => onRemoveCards([name]) : undefined);
    if (!base) return undefined;
    return (name: string) => { base(name); pushDeckHistory({ action: 'remove', cardName: name }); };
  }, [onRemoveBasicLandProp, onRemoveCards, pushDeckHistory]);

  const handleApplyOptimize = useCallback((removals: string[], additions: string[]) => {
    // ListsPage handlers use getListById() to read fresh state from the shared
    // module-level list store, so sequential remove+add is safe (no stale closure).
    onRemoveCards?.(removals);
    for (const name of removals) pushDeckHistory({ action: 'remove', cardName: name });
    if (additions.length > 0) {
      onAddCards?.(additions, 'deck');
      for (const name of additions) pushDeckHistory({ action: 'add', cardName: name });
    }
    setAddedCards(new Set());
  }, [onRemoveCards, onAddCards, pushDeckHistory]);

  // --- Pre-analysis: prominent CTA ---
  if (!analysis && !loading) {
    return (
      <div id="deck-optimizer" className="mt-8 flex flex-col items-center gap-3">
        <p className="text-xs text-muted-foreground text-center max-w-sm">
          Inspect your deck's roles, mana base, and curve against EDHREC data with tailored suggestions to fill gaps
        </p>
        <Button
          onClick={handleOptimize}
          className="btn-shimmer px-8 py-3 text-sm font-semibold gap-2.5"
          disabled={loading}
        >
          <Sparkles className="w-4 h-4" />
          Analyze Deck
        </Button>
      </div>
    );
  }

  // --- Loading ---
  if (loading) {
    return (
      <div id="deck-optimizer" className="flex-1 min-h-[60vh] flex items-center justify-center p-8">
        <div className="flex flex-col items-center gap-4 p-8 rounded-xl border border-border/30 bg-card/30 backdrop-blur-sm">
          <div className="relative">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
            <Sparkles className="absolute -top-1 -right-1 w-3 h-3 text-primary/50 animate-pulse" />
          </div>
          <div className="text-center">
            <p className="text-sm font-medium">Inspecting your deck...</p>
            <p className="text-xs text-muted-foreground mt-1">Fetching EDHREC data for {commanderName}</p>
          </div>
        </div>
      </div>
    );
  }

  // --- Error ---
  if (error) {
    return (
      <div className="mt-8 p-6 rounded-xl border border-red-500/20 bg-red-500/5 text-center">
        <p className="text-sm text-red-400 mb-3">{error}</p>
        <button
          onClick={handleOptimize}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-border hover:bg-accent text-muted-foreground hover:text-foreground transition-colors mx-auto"
        >
          <RefreshCw className="w-3 h-3" />
          Try Again
        </button>
      </div>
    );
  }

  if (!analysis) return null;

  // ═════════════════════════════════════════════════════════════════════
  // Derived values for DashboardSummary
  // ═════════════════════════════════════════════════════════════════════
  const _findThemeInfo = (slug: string | null) => {
    if (!slug) return null;
    const match = themeDetection?.evaluatedThemes.find(t => t.theme.slug === slug);
    return match ? { slug, name: match.theme.name } : null;
  };
  const dashboardThemeMembership = buildThemeMembership(
    _findThemeInfo(primaryThemeSlug),
    _findThemeInfo(secondaryThemeSlug),
    themeDataCacheRef.current,
  );
  const dashboardPrimaryThemeData = primaryThemeSlug
    ? (themeDataCacheRef.current.get(primaryThemeSlug) ?? null)
    : null;

  // ═════════════════════════════════════════════════════════════════════
  // Dashboard Render
  // ═════════════════════════════════════════════════════════════════════
  const themePacingStrip = (
    themeDetection && analysis ? (
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            title="Click to adjust themes & tempo"
            className="flex items-center gap-2 text-xs text-muted-foreground whitespace-nowrap px-2 py-1 rounded-md hover:bg-accent/40 hover:text-foreground transition-colors cursor-pointer"
          >
            {effectivePacing && (
              <span className="flex items-center gap-1">
                <Zap className="w-3 h-3" />
                {PACING_LABELS[effectivePacing] || 'Balanced'}
              </span>
            )}
            {effectivePacing && displayThemeNames && displayThemeNames.length > 0 && (
              <span className="text-border">|</span>
            )}
            {displayThemeNames && displayThemeNames.length > 0
              ? `Theme${displayThemeNames.length > 1 ? 's' : ''}: ${displayThemeNames.join(', ')}`
              : 'No themes selected'}
          </button>
        </PopoverTrigger>
        <PopoverContent side="bottom" align="end" className="w-80 p-0">
          <AdjustPopoverContent
            analysis={analysis}
            detection={themeDetection}
            allThemes={cachedEdhrecDataRef.current?.themes || []}
            primaryThemeSlug={primaryThemeSlug}
            secondaryThemeSlug={secondaryThemeSlug}
            onThemeSelect={handleThemeSelect}
            userLandTarget={userLandTarget}
            onLandTargetChange={handleLandTargetChange}
            deckSize={deckSize}
            userDeckSize={userDeckSize}
            onDeckSizeChange={handleDeckSizeChange}
            detectedPacing={detectedPacingRef.current ?? undefined}
            userPacing={userPacing}
            onPacingChange={handlePacingChange}
          />
        </PopoverContent>
      </Popover>
    ) : (
      <span className="flex items-center gap-2 text-xs text-muted-foreground whitespace-nowrap">
        {effectivePacing && (
          <span className="flex items-center gap-1">
            <Zap className="w-3 h-3" />
            {PACING_LABELS[effectivePacing] || 'Balanced'}
          </span>
        )}
        {effectivePacing && displayThemeNames && displayThemeNames.length > 0 && (
          <span className="text-border">|</span>
        )}
        {displayThemeNames && displayThemeNames.length > 0
          ? `Theme${displayThemeNames.length > 1 ? 's' : ''}: ${displayThemeNames.join(', ')}`
          : 'No themes selected'}
      </span>
    )
  );

  return (
    <div id="deck-optimizer" className="flex flex-1 min-h-0 border-b-4 border-border/60 lg:border-b-0">
      {/* Vertical sidebar */}
      <aside className="w-12 shrink-0 flex flex-col items-stretch border-r border-border/40 bg-background/60">
          <TooltipProvider delayDuration={200}>
          {onChangeDeck && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={onChangeDeck}
                  aria-label="Inspect a different deck"
                  className="flex items-center justify-center min-h-[52px] text-muted-foreground hover:text-foreground hover:bg-accent/20 border-b border-border/40 transition-colors"
                >
                  <ArrowLeft className="w-5 h-5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">Check a different deck</TooltipContent>
            </Tooltip>
          )}
          {TABS.filter(t => t.key !== 'cost').map(tab => {
            const isActive = activeTab === tab.key;
            const tabGrade = tabGrades[tab.key];
            const gradeStyle = tabGrade ? (HEALTH_GRADE_STYLES[tabGrade] || HEALTH_GRADE_STYLES.C) : null;
            const bracketBadge = tab.key === 'bracket' && bracketLevel ? BRACKET_COLORS[bracketLevel] : null;
            const misfitCount = tab.key === 'optimize' ? (analysis?.misfits?.length ?? 0) : 0;
            const tabHref = getTabHref?.(tab.key);
            return (
              <Tooltip key={tab.key}>
                <TooltipTrigger asChild>
                  <a
                    href={tabHref ?? '#'}
                    onClick={(e) => {
                      e.preventDefault();
                      setActiveTab(tab.key);
                    }}
                    aria-label={tab.label}
                    aria-current={isActive ? 'page' : undefined}
                    className={`relative flex flex-col items-center justify-center gap-1 py-3 transition-all duration-200 no-underline ${
                      isActive
                        ? 'text-primary bg-accent/30'
                        : 'text-muted-foreground hover:text-foreground hover:bg-accent/20'
                    }`}
                  >
                    {isActive && (
                      <span className="absolute left-0 top-2 bottom-2 w-0.5 rounded-r-sm bg-primary" />
                    )}
                    <tab.icon className={`w-5 h-5 transition-transform duration-200 ${isActive ? 'scale-110' : ''}`} />
                    {gradeStyle && (
                      <span className={`text-[9px] font-bold leading-none px-1 py-0.5 rounded tabular-nums ${gradeStyle.color} ${gradeStyle.badgeBg}`}>
                        {tabGrade}
                      </span>
                    )}
                    {bracketBadge && (
                      <span className={`text-[9px] font-bold leading-none px-1 py-0.5 rounded tabular-nums ${bracketBadge.text} ${bracketBadge.bg}`}>
                        {bracketLevel}
                      </span>
                    )}
                    {misfitCount > 0 && (
                      <span className="text-[9px] font-bold leading-none px-1 py-0.5 rounded tabular-nums text-rose-300 bg-rose-500/25">
                        {misfitCount}
                      </span>
                    )}
                  </a>
                </TooltipTrigger>
                <TooltipContent side="right">{tab.label}</TooltipContent>
              </Tooltip>
            );
          })}
          <div className="flex-1" />
          {(() => {
            const costTab = TABS.find(t => t.key === 'cost');
            if (!costTab) return null;
            const isActive = activeTab === 'cost';
            const costHref = getTabHref?.('cost');
            return (
              <Tooltip>
                <TooltipTrigger asChild>
                  <a
                    href={costHref ?? '#'}
                    onClick={(e) => {
                      e.preventDefault();
                      setActiveTab('cost');
                    }}
                    aria-label={costTab.label}
                    aria-current={isActive ? 'page' : undefined}
                    className={`relative flex flex-col items-center justify-center gap-1 py-3 transition-all duration-200 no-underline ${
                      isActive
                        ? 'text-primary bg-accent/30'
                        : 'text-muted-foreground hover:text-foreground hover:bg-accent/20'
                    }`}
                  >
                    {isActive && (
                      <span className="absolute left-0 top-2 bottom-2 w-0.5 rounded-r-sm bg-primary" />
                    )}
                    <costTab.icon className={`w-5 h-5 transition-transform duration-200 ${isActive ? 'scale-110' : ''}`} />
                    {deckTotalPrice > 0 && (
                      <span className="text-[9px] font-bold leading-none px-1 py-0.5 rounded tabular-nums text-violet-300 bg-violet-500/20">
                        {costBadgeLabel}
                      </span>
                    )}
                  </a>
                </TooltipTrigger>
                <TooltipContent side="right">{costTab.label}</TooltipContent>
              </Tooltip>
            );
          })()}
          </TooltipProvider>
        </aside>

      <div className="flex-1 min-w-0 min-h-0 flex flex-col">
        {/* Themes / Pacing strip above tab content */}
        {themePacingStrip && (
          <div className="flex items-center justify-between gap-2 px-2 sm:px-4 py-2 min-h-[52px] border-b border-border/40 bg-background/40">
            <div className="flex items-center gap-2 min-w-0">
              {(() => {
                const activeTabInfo = TABS.find(t => t.key === activeTab);
                if (!activeTabInfo) return null;
                const Icon = activeTabInfo.icon;
                return (
                  <>
                    <Icon className="w-4 h-4 text-primary/70 shrink-0" />
                    <span className="text-sm font-bold uppercase tracking-wider">{activeTabInfo.label}</span>
                  </>
                );
              })()}
            </div>
            <div className="flex items-center gap-2 shrink-0">
            {themePacingStrip}
            {analysis && (
              <button
                onClick={handleOptimize}
                disabled={loading}
                title={isAnalysisDirty ? 'Deck has changed since the last analysis — click to refresh' : 'Re-run analysis'}
                className={`flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-lg border transition-colors ${
                  isAnalysisDirty
                    ? 'border-amber-500/60 bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 animate-pulse'
                    : 'border-border/50 bg-card/50 hover:bg-accent text-muted-foreground hover:text-foreground'
                } disabled:opacity-60 disabled:pointer-events-none`}
              >
                {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                Re-analyze
              </button>
            )}
            </div>
          </div>
        )}

        {/* Tab Content */}
        <div className={`flex-1 min-h-0 overflow-y-auto ${activeTab === 'optimize' ? 'p-0' : 'p-3 sm:p-4'} ${activeTab === 'roles' ? 'flex flex-col' : ''} ${activeTab === 'cost' ? 'pt-0 sm:pt-0' : ''}`}>

        {/* ── OVERVIEW TAB ── */}
        {activeTab === 'overview' && commander && (
          <DashboardSummary
            commander={commander}
            partnerCommander={partnerCommander}
            colorIdentity={commanderColorIdentity}
            sourceLabel={sourceLabel ?? ''}
            analysis={analysis}
            cards={currentCards}
            themeMembership={dashboardThemeMembership}
            primaryThemeData={dashboardPrimaryThemeData}
            planName={dashboardThemeMembership?.themes?.[0]?.name ?? null}
            sampleSize={cachedEdhrecDataRef.current?.stats?.numDecks ?? null}
            warnings={buildDashboardWarnings({
              analysis,
              cards: currentCards,
              deckTarget: deckSize,
            })}
            adjustContent={
              themeDetection && cachedEdhrecDataRef.current?.themes ? (
                <AdjustPopoverContent
                  analysis={analysis}
                  detection={themeDetection}
                  allThemes={cachedEdhrecDataRef.current?.themes ?? []}
                  primaryThemeSlug={primaryThemeSlug}
                  secondaryThemeSlug={secondaryThemeSlug}
                  onThemeSelect={handleThemeSelect}
                  userLandTarget={userLandTarget}
                  onLandTargetChange={handleLandTargetChange}
                  deckSize={deckSize}
                  userDeckSize={userDeckSize}
                  onDeckSizeChange={handleDeckSizeChange}
                  detectedPacing={detectedPacingRef.current ?? analysis.pacing}
                  userPacing={userPacing}
                  onPacingChange={handlePacingChange}
                />
              ) : undefined
            }
            onNavigate={setActiveTab}
            onSaveAsDeck={onSaveAsDeck}
            onOpenInDeckView={onOpenInDeckView}
            cardSynergyMap={useStore.getState().generatedDeck?.cardSynergyMap}
            detectedCombos={useStore.getState().generatedDeck?.detectedCombos ?? []}
            deckTarget={deckSize}
            roleBreakdowns={analysis.roleBreakdowns}
            curvePhases={analysis.curvePhases}
          />
        )}

        {/* ── ROLES TAB ── */}
        {activeTab === 'roles' && (
          <RolesTabContent
            roleBreakdowns={analysis.roleBreakdowns}
            activeRole={activeRole}
            onRoleChange={setActiveRole}
            onPreview={handlePreview}
            onAdd={handleAddCard}
            addedCards={addedCards}
            onCardAction={handleCardAction}
            menuProps={menuProps}
          />
        )}

        {/* ── LANDS TAB ── */}
        {activeTab === 'lands' && (
          <LandsTabContent
            analysis={analysis}
            activeSection={activeSection}
            onSectionChange={setActiveSection}
            onPreview={handlePreview}
            onAdd={handleAddCard}
            addedCards={addedCards}
            currentCards={currentCards}
            onCardAction={handleCardAction}
            menuProps={menuProps}
            onAddBasicLand={handleBasicLandAdd}
            onRemoveBasicLand={handleBasicLandRemove}
            cardInclusionMap={cardInclusionMap}
          />
        )}

        {/* ── CURVE TAB ── */}
        {activeTab === 'curve' && (() => {
          const allPhasesActive = activeCurvePhases.size === analysis.curvePhases.length;
          const selectedPhases = analysis.curvePhases.filter(p => activeCurvePhases.has(p.phase));
          return (
            <div className="space-y-3">
              <ManaCurveLineChart
                curveAnalysis={analysis.curveAnalysis}
                curveBreakdowns={analysis.curveBreakdowns}
                pacing={effectivePacing}
                activePhases={allPhasesActive ? undefined : activeCurvePhases}
                selectedCmc={selectedCmc}
                onCmcClick={(cmc: number) => setSelectedCmc(prev => prev === cmc ? null : cmc)}
              />
              <CurveSummaryStrip
                phases={analysis.curvePhases}
                activePhases={activeCurvePhases}
                onPhaseClick={(phase: CurvePhase) => {
                  const scrollY = window.scrollY;
                  setActiveCurvePhases(new Set([phase]));
                  requestAnimationFrame(() => window.scrollTo({ top: scrollY, behavior: 'instant' }));
                }}
                activeRoleGroups={activeRoleGroups}
                onRoleGroupClick={(group: RoleGroupKey) => {
                  const scrollY = window.scrollY;
                  setActiveRoleGroups(prev => prev.has(group) && prev.size === 1 ? new Set() : new Set([group]));
                  requestAnimationFrame(() => window.scrollTo({ top: scrollY, behavior: 'instant' }));
                }}
              />
              {selectedPhases.length > 0 ? (
                <CurveDetailPanel
                  phases={selectedPhases}
                  roleBreakdowns={analysis.roleBreakdowns}
                  activeRoleGroups={activeRoleGroups}
                  addedCards={addedCards}
                  onAdd={(name: string) => {
                    onAddCards?.([name], 'deck');
                    setAddedCards(prev => new Set([...prev, name]));
                  }}
                  onPreview={handlePreview}
                  onCardAction={handleCardAction}
                  menuProps={menuProps}
                  allRecommendations={analysis.recommendations}
                />
              ) : (
                <div className="bg-card/60 border border-border/30 rounded-lg p-6 text-center">
                  <p className="text-xs text-muted-foreground">Select Early, Mid, or Late Game above to view cards by role</p>
                </div>
              )}
            </div>
          );
        })()}

        {/* ── OPTIMIZE TAB ── */}
        {activeTab === 'optimize' && analysis && (
          <OptimizeTabContent
            analysis={analysis}
            currentCards={currentCards}
            commanderName={commanderName}
            partnerCommanderName={partnerCommanderName}
            cardInclusionMap={cardInclusionMap}
            mustIncludeNames={menuProps.mustIncludeNames}
            bannedNames={menuProps.bannedNames}
            detectedCombos={useStore.getState().generatedDeck?.detectedCombos ?? []}
            onApply={handleApplyOptimize}
            onPreviewCard={handlePreview}
            onFocusedMisfitChange={onFocusedMisfitChange}
          />
        )}

        {/* ── BRACKET TAB ── */}
        {activeTab === 'bracket' && (
          <BracketTabContent onPreview={handlePreview} />
        )}

        {activeTab === 'cost' && (
          <CostTab
            commanderName={commanderName}
            partnerCommanderName={partnerCommanderName}
            currentCards={currentCards}
            analysis={analysis}
            sideboardNames={sideboardNames ?? []}
            maybeboardNames={maybeboardNames ?? []}
            onPreviewCard={handlePreview}
            onApplyPlan={async (removeNames, addNames) => {
              // Suggestions may come from EDHREC recommendations that have never
              // been hydrated into the Scryfall cache. Some consumers of
              // onAddCards (notably AnalyzePage) look the card up via
              // getCachedCard and silently skip names that miss — so prefetch
              // first to make the add actually happen.
              await getCardsByNames(addNames);
              onRemoveCards?.(removeNames);
              for (const n of removeNames) pushDeckHistory({ action: 'remove', cardName: n });
              onAddCards?.(addNames, 'deck');
              for (const n of addNames) pushDeckHistory({ action: 'add', cardName: n });
            }}
          />
        )}

        </div>
      </div>

      <CardPreviewModal card={previewCard} onClose={() => setPreviewCard(null)} />
    </div>
  );
}
