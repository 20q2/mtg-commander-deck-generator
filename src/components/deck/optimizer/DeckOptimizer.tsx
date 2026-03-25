import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import {
  Loader2, Sparkles, ShoppingCart, RefreshCw,
  Scissors, RotateCcw, Zap,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { ScryfallCard } from '@/types';
import { fetchCommanderData, fetchPartnerCommanderData, fetchCommanderThemeData, fetchPartnerThemeData } from '@/services/edhrec/client';
import { detectThemes, generateStrategyLabel, buildDetectionMessage, PACING_PHRASE, type DetectedThemeResult, type Pacing } from '@/services/deckBuilder/themeDetector';
import { loadTaggerData, getCardRole } from '@/services/tagger/client';
import { analyzeDeck, type DeckAnalysis, type RecommendedCard, type AnalyzedCard, type CurvePhase } from '@/services/deckBuilder/deckAnalyzer';
import { recomputeRoleTargetsForPacing } from '@/services/deckBuilder/roleTargets';
import { getCardByName, getCardsByNames, getCardPrice, getFrontFaceTypeLine, isMdfcLand } from '@/services/scryfall/client';
import { CardPreviewModal } from '@/components/ui/CardPreviewModal';
import { type CardAction } from '@/components/deck/DeckDisplay';
import { useStore } from '@/store';
import { useUserLists } from '@/hooks/useUserLists';

import { type DeckOptimizerProps, type TabKey, type LandSection, TABS, PACING_LABELS, edhrecRankToInclusion } from './constants';
import { CutRow, RecommendationRow } from './shared';
import { DeckHealthStrip } from './OverviewTab';
import { RolesTabContent } from './RolesTab';
import { LandsTabContent } from './LandsTab';
import { CurveSummaryStrip, ManaCurveLineChart, CmcCardList, CurveInsights, PhaseCardDisplay, ManaTrajectorySparkline } from './CurveTab';
import { BracketTabContent } from './BracketTab';

// ═══════════════════════════════════════════════════════════════════════
// Main Component
// ═══════════════════════════════════════════════════════════════════════
export function DeckOptimizer({
  commanderName,
  partnerCommanderName,
  currentCards,
  deckSize,
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
}: DeckOptimizerProps) {
  const [analysis, setAnalysis] = useState<DeckAnalysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addedCards, setAddedCards] = useState<Set<string>>(new Set());
  const [previewCard, setPreviewCard] = useState<ScryfallCard | null>(null);
  const cachedEdhrecDataRef = useRef<import('@/types').EDHRECCommanderData | null>(null);
  const prevCardCountRef = useRef(currentCards.length);
  const [activeTab, setActiveTab] = useState<TabKey>('overview');
  const [activeRole, setActiveRole] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<LandSection | null>(null);
  const [activeCurvePhases, setActiveCurvePhases] = useState<Set<CurvePhase>>(new Set());
  const [selectedCmc, setSelectedCmc] = useState<number | null>(null);

  // Theme detection state
  const [themeDetection, setThemeDetection] = useState<DetectedThemeResult | null>(null);
  const [themeLoading, setThemeLoading] = useState(false);
  const [primaryThemeSlug, setPrimaryThemeSlug] = useState<string | null>(null);
  const [secondaryThemeSlug, setSecondaryThemeSlug] = useState<string | null>(null);
  const themeDataCacheRef = useRef<Map<string, import('@/types').EDHRECCommanderData>>(new Map());
  const themeEnhancedDataRef = useRef<import('@/types').EDHRECCommanderData | null>(null);

  // User-overridable tempo (null = use auto-detected)
  const [userPacing, setUserPacing] = useState<Pacing | null>(null);
  const detectedPacingRef = useRef<Pacing | null>(null);

  // The effective pacing: user override > auto-detected
  const effectivePacing: Pacing | undefined = userPacing ?? analysis?.pacing ?? undefined;

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
      setActiveCurvePhases(new Set(analysis.curvePhases.map(p => p.phase)));
    }
  }, [analysis]); // eslint-disable-line react-hooks/exhaustive-deps

  const totalRecCost = useMemo(() => {
    if (!analysis) return 0;
    return analysis.recommendations
      .filter(r => !addedCards.has(r.name))
      .reduce((sum, r) => sum + (r.price ? parseFloat(r.price) || 0 : 0), 0);
  }, [analysis, addedCards]);


  /** Build inclusion map from EDHREC data, handling DFC front-face lookups. */
  const buildInclusionMap = useCallback((edhrecData: import('@/types').EDHRECCommanderData): Record<string, number> => {
    if (cardInclusionMap) return cardInclusionMap;
    const built: Record<string, number> = {};
    const indexCard = (name: string, inclusion: number) => {
      built[name] = inclusion;
      if (name.includes(' // ')) built[name.split(' // ')[0]] = inclusion;
    };
    for (const c of edhrecData.cardlists.allNonLand) indexCard(c.name, c.inclusion);
    for (const c of edhrecData.cardlists.lands) indexCard(c.name, c.inclusion);
    for (const card of currentCards) {
      if (card.name.includes(' // ') && built[card.name] === undefined) {
        const front = card.name.split(' // ')[0];
        if (built[front] !== undefined) built[card.name] = built[front];
      }
    }
    return built;
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

  // When user changes pacing, re-run full analysis with adjusted role targets
  const handlePacingChange = useCallback((newPacing: Pacing | null) => {
    setUserPacing(newPacing);

    const cachedBase = cachedEdhrecDataRef.current;
    if (!cachedBase || !analysis) {
      rebuildBannerMessage({ pacingOverride: newPacing });
      return;
    }

    // Recompute role targets for the new pacing
    const detPacing = detectedPacingRef.current ?? 'balanced';
    const newTargets = newPacing
      ? recomputeRoleTargetsForPacing(roleTargets, detPacing, newPacing)
      : roleTargets; // null = reset to detected

    const storeColorIdentity = useStore.getState().colorIdentity;
    const baseInclusionMap = buildInclusionMap(cachedBase);

    const baseResult = analyzeDeck(
      cachedBase, currentCards, roleCounts, newTargets, deckSize,
      baseInclusionMap, storeColorIdentity, newPacing ?? undefined,
    );

    // If theme-enhanced data exists, merge its recommendations
    const themeData = themeEnhancedDataRef.current;
    if (themeData) {
      const themeInclusionMap = buildInclusionMap(themeData);
      const themeResult = analyzeDeck(
        themeData, currentCards, roleCounts, newTargets, deckSize,
        themeInclusionMap, storeColorIdentity, newPacing ?? undefined,
      );
      const mergedRecs = mergeRecommendations(baseResult.recommendations, themeResult.recommendations);
      const mergedRoleBreakdowns = baseResult.roleBreakdowns.map((baseRb, idx) => {
        const themeRb = themeResult.roleBreakdowns[idx];
        if (!themeRb) return baseRb;
        return { ...baseRb, suggestedReplacements: mergeRecommendations(baseRb.suggestedReplacements, themeRb.suggestedReplacements, 15) };
      });
      const mergedLandRecs = mergeRecommendations(baseResult.landRecommendations, themeResult.landRecommendations, 15);
      setAnalysis({ ...baseResult, recommendations: mergedRecs, roleBreakdowns: mergedRoleBreakdowns, landRecommendations: mergedLandRecs });
    } else {
      setAnalysis(baseResult);
    }

    rebuildBannerMessage({ pacingOverride: newPacing });
  }, [analysis, rebuildBannerMessage, roleTargets, currentCards, roleCounts, deckSize, buildInclusionMap, mergeRecommendations]);

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
      const storeColorIdentity = useStore.getState().colorIdentity;

      const baseResult = analyzeDeck(
        edhrecData,
        currentCards,
        roleCounts,
        roleTargets,
        deckSize,
        effectiveInclusionMap,
        storeColorIdentity,
      );

      // Enrich recommendations with Scryfall prices/colors
      const allRecs: RecommendedCard[] = [
        ...baseResult.recommendations,
        ...baseResult.landRecommendations,
        ...(baseResult.colorFixing.fixingRecommendations || []),
        ...baseResult.roleBreakdowns.flatMap(rb => rb.suggestedReplacements),
      ];
      const needsFetch = [...new Set(allRecs.filter(r => !r.price || !r.producedColors?.length).map(r => r.name))];

      if (needsFetch.length > 0) {
        try {
          const scryfallCards = await getCardsByNames(needsFetch);
          const priceMap = new Map<string, string>();
          const colorMap = new Map<string, string[]>();
          for (const [name, card] of scryfallCards) {
            const p = getCardPrice(card);
            if (p) priceMap.set(name, p);
            const produced = (card.produced_mana || []).filter((c: string) => ['W', 'U', 'B', 'R', 'G'].includes(c));
            if (produced.length > 0) {
              colorMap.set(name, [...new Set(produced)]);
            } else if (card.color_identity?.length) {
              colorMap.set(name, card.color_identity.map((c: string) => c.toUpperCase()));
            }
          }
          for (const rec of allRecs) {
            if (!rec.price) rec.price = priceMap.get(rec.name) || undefined;
            if (!rec.producedColors?.length) rec.producedColors = colorMap.get(rec.name) || undefined;
          }
        } catch { /* prices/colors are nice-to-have */ }
      }

      detectedPacingRef.current = baseResult.pacing;
      setAnalysis(baseResult);
      setAddedCards(new Set());
      setLoading(false); // Dashboard visible NOW

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

          const themeInclusionMap = buildInclusionMap(bestThemeData);
          const themeResult = analyzeDeck(
            bestThemeData,
            currentCards,
            roleCounts,
            roleTargets,
            deckSize,
            themeInclusionMap,
            storeColorIdentity,
          );

          // Theme drives; base staples (50%+ inclusion) backfill
          const finalRecs = mergeThemeWithBaseStaples(themeResult.recommendations, baseResult.recommendations);
          const finalRoleBreakdowns = themeResult.roleBreakdowns.map((themeRb, idx) => {
            const baseRb = baseResult.roleBreakdowns[idx];
            if (!baseRb) return themeRb;
            return { ...themeRb, suggestedReplacements: mergeThemeWithBaseStaples(themeRb.suggestedReplacements, baseRb.suggestedReplacements, 15) };
          });
          const finalLandRecs = mergeThemeWithBaseStaples(themeResult.landRecommendations, baseResult.landRecommendations, 15);

          setAnalysis(prev => prev ? {
            ...prev,
            recommendations: finalRecs,
            roleBreakdowns: finalRoleBreakdowns,
            landRecommendations: finalLandRecs,
          } : prev);

          // Enrich new theme-only recs with prices
          const newRecs = finalRecs.filter((r: RecommendedCard) => !r.price);
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
              setAnalysis(prev => prev ? { ...prev } : prev);
            } catch { /* non-critical */ }
          }
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

  // Re-run analysis when cards change (add/remove) if we have cached EDHREC data
  useEffect(() => {
    if (!cachedEdhrecDataRef.current || !analysis) return;
    if (currentCards.length === prevCardCountRef.current) return;
    prevCardCountRef.current = currentCards.length;

    const baseData = cachedEdhrecDataRef.current;
    const storeColorIdentity = useStore.getState().colorIdentity;
    const baseInclusionMap = buildInclusionMap(baseData);

    const baseResult = analyzeDeck(
      baseData,
      currentCards,
      roleCounts,
      effectiveRoleTargets,
      deckSize,
      baseInclusionMap,
      storeColorIdentity,
      userPacing ?? undefined,
    );

    // If theme-enhanced data exists, merge its recommendations
    const themeData = themeEnhancedDataRef.current;
    if (themeData) {
      const themeInclusionMap = buildInclusionMap(themeData);
      const themeResult = analyzeDeck(
        themeData,
        currentCards,
        roleCounts,
        effectiveRoleTargets,
        deckSize,
        themeInclusionMap,
        storeColorIdentity,
        userPacing ?? undefined,
      );

      const mergedRecs = mergeRecommendations(baseResult.recommendations, themeResult.recommendations);
      const mergedRoleBreakdowns = baseResult.roleBreakdowns.map((baseRb, idx) => {
        const themeRb = themeResult.roleBreakdowns[idx];
        if (!themeRb) return baseRb;
        return { ...baseRb, suggestedReplacements: mergeRecommendations(baseRb.suggestedReplacements, themeRb.suggestedReplacements, 15) };
      });
      const mergedLandRecs = mergeRecommendations(baseResult.landRecommendations, themeResult.landRecommendations, 15);

      setAnalysis({ ...baseResult, recommendations: mergedRecs, roleBreakdowns: mergedRoleBreakdowns, landRecommendations: mergedLandRecs });
    } else {
      setAnalysis(baseResult);
    }
  }, [currentCards, roleCounts, effectiveRoleTargets, deckSize, cardInclusionMap, analysis, buildInclusionMap, mergeRecommendations, userPacing]);

  const handleAddCard = (name: string) => {
    if (!onAddCards) return;
    onAddCards([name], 'deck');
    pushDeckHistory({ action: 'add', cardName: name });
    setAddedCards(prev => new Set([...prev, name]));
  };

  const handlePreview = async (name: string) => {
    try {
      const card = await getCardByName(name);
      if (card) setPreviewCard(card);
    } catch { /* silently fail */ }
  };

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

    const storeColorIdentity = useStore.getState().colorIdentity;

    // No themes → revert to base-only analysis
    if (!primary && !secondary) {
      themeEnhancedDataRef.current = null;
      const baseInclusionMap = buildInclusionMap(cachedBase);
      const baseResult = analyzeDeck(cachedBase, currentCards, roleCounts, effectiveRoleTargets, deckSize, baseInclusionMap, storeColorIdentity, userPacing ?? undefined);

      setAnalysis(prev => prev ? {
        ...prev,
        recommendations: baseResult.recommendations,
        roleBreakdowns: baseResult.roleBreakdowns,
        landRecommendations: baseResult.landRecommendations,
      } : prev);

      // Restore detection message (still reflects user tempo override if any)
      rebuildBannerMessage({ primarySlug: null, secondarySlug: null });
      setThemeLoading(false);
      return;
    }

    setThemeLoading(true);

    // Base analysis (for staple backfill — only high-inclusion cards leak through)
    const baseInclusionMap = buildInclusionMap(cachedBase);
    const baseResult = analyzeDeck(cachedBase, currentCards, roleCounts, effectiveRoleTargets, deckSize, baseInclusionMap, storeColorIdentity, userPacing ?? undefined);

    // Primary theme → main data source, backfilled with base staples
    try {
      const primaryData = await fetchThemeData(primary!);
      themeEnhancedDataRef.current = primaryData;
      const primaryIncMap = buildInclusionMap(primaryData);
      const primaryResult = analyzeDeck(primaryData, currentCards, roleCounts, effectiveRoleTargets, deckSize, primaryIncMap, storeColorIdentity, userPacing ?? undefined);

      // Theme drives recommendations; base staples (50%+ inclusion) backfill gaps
      let finalRecs = mergeThemeWithBaseStaples(primaryResult.recommendations, baseResult.recommendations);
      let finalRoleBreakdowns = primaryResult.roleBreakdowns.map((themeRb, idx) => {
        const baseRb = baseResult.roleBreakdowns[idx];
        if (!baseRb) return themeRb;
        return { ...themeRb, suggestedReplacements: mergeThemeWithBaseStaples(themeRb.suggestedReplacements, baseRb.suggestedReplacements, 15) };
      });
      let finalLandRecs = mergeThemeWithBaseStaples(primaryResult.landRecommendations, baseResult.landRecommendations, 15);

      // Secondary theme supplements the primary
      if (secondary) {
        try {
          const secondaryData = await fetchThemeData(secondary);
          const secondaryIncMap = buildInclusionMap(secondaryData);
          const secondaryResult = analyzeDeck(secondaryData, currentCards, roleCounts, effectiveRoleTargets, deckSize, secondaryIncMap, storeColorIdentity, userPacing ?? undefined);

          finalRecs = mergeRecommendations(finalRecs, secondaryResult.recommendations);
          finalRoleBreakdowns = finalRoleBreakdowns.map((rb, idx) => {
            const themeRb = secondaryResult.roleBreakdowns[idx];
            if (!themeRb) return rb;
            return { ...rb, suggestedReplacements: mergeRecommendations(rb.suggestedReplacements, themeRb.suggestedReplacements, 15) };
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
      } : prev);
    } catch (err) {
      console.error('[DeckOptimizer] Failed to fetch primary theme data:', err);
      setThemeLoading(false);
      return;
    }

    // Update banner detection message
    rebuildBannerMessage({ primarySlug: primary, secondarySlug: secondary });

    setThemeLoading(false);
  }, [analysis, commanderName, currentCards, roleCounts, effectiveRoleTargets, deckSize, buildInclusionMap, mergeRecommendations, mergeThemeWithBaseStaples, themeDetection, fetchThemeData, rebuildBannerMessage, userPacing]);

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
  const { customization, updateCustomization, pushDeckHistory } = useStore();
  const storeSelectedThemes = useStore(s => s.selectedThemes);
  const usedThemes = useStore(s => s.generatedDeck?.usedThemes);
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

  // --- Cut candidates for over-target decks ---
  const BASIC_LANDS = useMemo(() => new Set([
    'Plains', 'Island', 'Swamp', 'Mountain', 'Forest',
    'Snow-Covered Plains', 'Snow-Covered Island', 'Snow-Covered Swamp',
    'Snow-Covered Mountain', 'Snow-Covered Forest', 'Wastes',
  ]), []);
  const deckExcess = currentCards.length - deckSize;
  const [removedCutCards, setRemovedCutCards] = useState<Set<string>>(new Set());
  const [skippedCutCards, setSkippedCutCards] = useState<Set<string>>(new Set());
  const [excludeLandsFromCuts, setExcludeLandsFromCuts] = useState(false);
  const [showCutsView, setShowCutsView] = useState(true);
  const toggleCutsView = useCallback((val: boolean) => {
    const scrollY = window.scrollY;
    setShowCutsView(val);
    requestAnimationFrame(() => window.scrollTo({ top: scrollY }));
  }, []);
  const cutCandidates = useMemo(() => {
    if (deckExcess <= 0) return [];
    const inclusionMap = cardInclusionMap ?? {};
    const dismissed = new Set([...removedCutCards, ...skippedCutCards]);
    const candidates = currentCards
      .filter(c => {
        if (BASIC_LANDS.has(c.name) || c.name === commanderName || c.name === partnerCommanderName) return false;
        if (menuProps.mustIncludeNames.has(c.name)) return false;
        if (dismissed.has(c.name)) return false;
        if (excludeLandsFromCuts && (getFrontFaceTypeLine(c).toLowerCase().includes('land') || isMdfcLand(c))) return false;
        return true;
      })
      .map(c => {
        // For lands, use the higher of commander-specific inclusion and global edhrec_rank
        // so format staples (e.g. Urborg) aren't suggested as cuts for new/niche commanders
        const isLand = getFrontFaceTypeLine(c).toLowerCase().includes('land') || isMdfcLand(c);
        const cmdInclusion = inclusionMap[c.name] ?? null;
        const globalInclusion = edhrecRankToInclusion(c.edhrec_rank);
        const inclusion = isLand
          ? Math.max(cmdInclusion ?? 0, globalInclusion ?? 0) || null
          : cmdInclusion ?? globalInclusion ?? null;
        const role = c.deckRole || getCardRole(c.name);
        return { card: c, inclusion, role, roleLabel: role ? ({ ramp: 'Ramp', removal: 'Removal', boardwipe: 'Board Wipes', cardDraw: 'Card Advantage' }[role] || role) : undefined } as AnalyzedCard;
      })
      .sort((a, b) => {
        // Cards filling a role deficit are harder to cut — push them down
        const aRole = a.card.deckRole || getCardRole(a.card.name);
        const bRole = b.card.deckRole || getCardRole(b.card.name);
        const aFillsDeficit = aRole && analysis?.roleDeficits.some(rd => rd.role === aRole && rd.deficit > 0);
        const bFillsDeficit = bRole && analysis?.roleDeficits.some(rd => rd.role === bRole && rd.deficit > 0);
        if (aFillsDeficit && !bFillsDeficit) return 1;
        if (!aFillsDeficit && bFillsDeficit) return -1;
        // Lower inclusion = better cut candidate
        return (a.inclusion ?? 0) - (b.inclusion ?? 0);
      });
    // Ensure "other candidates" below the top box fills complete rows of 3
    const otherCount = Math.ceil(Math.max(15 - deckExcess, 6) / 3) * 3;
    return candidates.slice(0, deckExcess + otherCount);
  }, [currentCards, deckSize, deckExcess, cardInclusionMap, commanderName, partnerCommanderName, BASIC_LANDS, analysis, menuProps.mustIncludeNames, excludeLandsFromCuts, removedCutCards, skippedCutCards]);

  const handleRemoveCutCard = useCallback((card: ScryfallCard) => {
    onRemoveCards?.([card.name]);
    pushDeckHistory({ action: 'remove', cardName: card.name });
    setRemovedCutCards(prev => new Set([...prev, card.name]));
  }, [onRemoveCards, pushDeckHistory]);

  const handleCutAll = useCallback(() => {
    const toCut = cutCandidates.slice(0, deckExcess);
    if (toCut.length === 0) return;
    onRemoveCards?.(toCut.map(ac => ac.card.name));
    for (const ac of toCut) pushDeckHistory({ action: 'remove', cardName: ac.card.name });
    setRemovedCutCards(prev => new Set([...prev, ...toCut.map(ac => ac.card.name)]));
  }, [cutCandidates, deckExcess, onRemoveCards, pushDeckHistory]);

  const handleSkipCutCard = useCallback((card: ScryfallCard) => {
    setSkippedCutCards(prev => new Set([...prev, card.name]));
  }, []);

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

  // --- Pre-analysis: prominent CTA ---
  if (!analysis && !loading) {
    return (
      <div className="mt-8 flex flex-col items-center gap-3">
        <p className="text-xs text-muted-foreground text-center max-w-sm">
          Check your deck's roles, mana base, and curve against EDHREC data with tailored suggestions to fill gaps
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
      <div className="mt-8 p-6 rounded-xl border border-border/30 bg-card/30 backdrop-blur-sm">
        <div className="flex flex-col items-center gap-4 py-8">
          <div className="relative">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
            <Sparkles className="absolute -top-1 -right-1 w-3 h-3 text-primary/50 animate-pulse" />
          </div>
          <div className="text-center">
            <p className="text-sm font-medium">Analyzing your deck...</p>
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
  // Dashboard Render
  // ═════════════════════════════════════════════════════════════════════
  return (
    <div className="mt-6 rounded-xl border border-border/40 bg-card/40 backdrop-blur-sm overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border/30 bg-gradient-to-r from-primary/5 to-transparent">
        <div className="flex items-center gap-2">
          <div className="p-1 rounded-md bg-primary/10">
            <Sparkles className="w-3.5 h-3.5 text-primary" />
          </div>
          <h3 className="text-sm font-bold">Deck Analysis (Early Access)</h3>
        </div>
        <button
          onClick={handleOptimize}
          className="flex items-center gap-1.5 px-2 py-1 text-xs rounded-lg border border-border/50 hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
        >
          <RefreshCw className="w-3 h-3" />
          Re-analyze
        </button>
      </div>

      {/* Tab Bar */}
      <div className="flex items-center gap-0.5 px-3 py-1.5 border-b border-border/20 bg-card/30 overflow-x-auto">
        {TABS.map(tab => {
          const isActive = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                isActive
                  ? 'bg-primary/15 text-primary'
                  : 'text-muted-foreground hover:text-foreground hover:bg-accent/40'
              }`}
            >
              <tab.icon className="w-3.5 h-3.5" />
              {tab.label}
            </button>
          );
        })}
        <span className="ml-auto flex items-center gap-2 text-xs text-muted-foreground whitespace-nowrap">
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
      </div>

      {/* Tab Content */}
      <div className="p-3 sm:p-4">

        {/* ── OVERVIEW TAB ── */}
        {activeTab === 'overview' && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-purple-500/20 bg-purple-500/5">
              <Sparkles className="w-3.5 h-3.5 text-purple-400/80 shrink-0" />
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                <span className="font-medium text-purple-400/80">Early Access</span> — analysis results may change as this feature is refined with feedback.
              </p>
            </div>
            <DeckHealthStrip
              analysis={analysis}
              onNavigate={setActiveTab}
              onNavigateRole={setActiveRole}
              deckExcess={deckExcess !== 0 ? deckExcess : undefined}
              detection={themeDetection}
              themeLoading={themeLoading}
              allThemes={cachedEdhrecDataRef.current?.themes || []}
              primaryThemeSlug={primaryThemeSlug}
              secondaryThemeSlug={secondaryThemeSlug}
              onThemeSelect={handleThemeSelect}
              detectedPacing={detectedPacingRef.current ?? analysis.pacing}
              userPacing={userPacing}
              onPacingChange={handlePacingChange}
            />

            <div className="bg-card/60 border border-border/30 rounded-lg p-3">
              {/* Cuts View */}
              {deckExcess > 0 && cutCandidates.length > 0 && showCutsView ? (
                <>
                  <div className="flex items-center gap-2 mb-1.5">
                    <Scissors className="w-3 h-3 text-red-400/70" />
                    <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Recommended Cuts
                    </span>
                    <span className="text-[11px] text-muted-foreground">({cutCandidates.length})</span>
                    <span className="ml-auto flex items-center gap-2">
                      <span className="text-xs text-red-400/60">{deckExcess} over target</span>
                      <div className="flex items-center border border-border/50 rounded-md overflow-hidden">
                        <button
                          onClick={() => toggleCutsView(true)}
                          className="flex items-center gap-1 text-[10px] px-2 py-0.5 transition-colors bg-red-500/15 text-red-400 font-medium"
                        >
                          <Scissors className="w-2.5 h-2.5" />
                          Cuts
                        </button>
                        <div className="w-px h-3 bg-border/50" />
                        <button
                          onClick={() => toggleCutsView(false)}
                          className="flex items-center gap-1 text-[10px] px-2 py-0.5 transition-colors text-muted-foreground/50 hover:text-muted-foreground hover:bg-accent/50"
                        >
                          <Sparkles className="w-2.5 h-2.5" />
                          Suggestions
                        </button>
                      </div>
                    </span>
                  </div>
                  <div className="flex items-center gap-3 mb-1.5 ml-0.5">
                    <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-muted-foreground cursor-pointer transition-colors">
                      <input
                        type="checkbox"
                        checked={excludeLandsFromCuts}
                        onChange={(e) => setExcludeLandsFromCuts(e.target.checked)}
                        className="rounded border-border/50 w-3 h-3 accent-primary"
                      />
                      Exclude lands
                    </label>
                    {skippedCutCards.size > 0 && (
                      <button
                        onClick={() => setSkippedCutCards(new Set())}
                        className="flex items-center gap-1 text-[11px] text-muted-foreground/50 hover:text-muted-foreground transition-colors"
                      >
                        <RotateCcw className="w-2.5 h-2.5" />
                        Reset {skippedCutCards.size} skipped
                      </button>
                    )}
                  </div>
                  {/* Top X cuts (where X = cards over target) in a highlighted box */}
                  <div className="rounded-lg border border-red-500/25 bg-red-500/5 p-1.5 mb-2">
                    <div className="flex items-center justify-between mb-1 px-1">
                      <p className="text-[10px] font-medium text-red-400/80 uppercase tracking-wider">
                        Cut these {Math.min(deckExcess, cutCandidates.length)} to hit {deckSize}
                      </p>
                      <button
                        onClick={handleCutAll}
                        className="flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium rounded border border-red-500/30 text-red-400/80 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                      >
                        <Scissors className="w-2.5 h-2.5" />
                        Cut all
                      </button>
                    </div>
                    <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-x-2 gap-y-0.5">
                      {cutCandidates.slice(0, deckExcess).map((ac) => (
                        <CutRow
                          key={ac.card.name}
                          ac={ac}
                          onRemove={handleRemoveCutCard}
                          onSkip={handleSkipCutCard}
                          onPreview={() => handlePreview(ac.card.name)}
                          onCardAction={handleCardAction}
                          menuProps={menuProps}
                          cardInclusionMap={cardInclusionMap}
                        />
                      ))}
                    </div>
                  </div>
                  {/* Remaining candidates below the divider */}
                  {cutCandidates.length > deckExcess && (
                    <>
                      <div className="flex items-center gap-2 mb-1 px-1">
                        <div className="flex-1 h-px bg-border/30" />
                        <span className="text-[10px] text-muted-foreground/40 uppercase tracking-wider">Other candidates</span>
                        <div className="flex-1 h-px bg-border/30" />
                      </div>
                      <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-x-2 gap-y-0.5">
                        {cutCandidates.slice(deckExcess).map((ac) => (
                          <CutRow
                            key={ac.card.name}
                            ac={ac}
                            onRemove={handleRemoveCutCard}
                            onSkip={handleSkipCutCard}
                            onPreview={() => handlePreview(ac.card.name)}
                            onCardAction={handleCardAction}
                            menuProps={menuProps}
                            cardInclusionMap={cardInclusionMap}
                          />
                        ))}
                      </div>
                    </>
                  )}
                </>
              ) : (
                /* Recommendations View */
                <>
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Recommended Cards
                    </span>
                    <span className="text-[11px] text-muted-foreground">({analysis.recommendations.length})</span>
                    <span className="ml-auto flex items-center gap-2">
                      <span className="flex items-center gap-1 text-xs text-muted-foreground/50">
                        <ShoppingCart className="w-3 h-3" />
                        ~${totalRecCost.toFixed(2)}
                      </span>
                      {deckExcess > 0 && cutCandidates.length > 0 && (
                        <div className="flex items-center border border-border/50 rounded-md overflow-hidden">
                          <button
                            onClick={() => toggleCutsView(true)}
                            className="flex items-center gap-1 text-[10px] px-2 py-0.5 transition-colors text-muted-foreground/50 hover:text-muted-foreground hover:bg-accent/50"
                          >
                            <Scissors className="w-2.5 h-2.5" />
                            Cuts
                          </button>
                          <div className="w-px h-3 bg-border/50" />
                          <button
                            onClick={() => toggleCutsView(false)}
                            className="flex items-center gap-1 text-[10px] px-2 py-0.5 transition-colors bg-accent text-foreground font-medium"
                          >
                            <Sparkles className="w-2.5 h-2.5" />
                            Suggestions
                          </button>
                        </div>
                      )}
                    </span>
                  </div>
                  <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-x-2 gap-y-0.5">
                    {analysis.recommendations.map((rec, i) => (
                      <RecommendationRow
                        key={rec.name}
                        card={rec}
                        rank={i}
                        onAdd={() => handleAddCard(rec.name)}
                        onPreview={() => handlePreview(rec.name)}
                        added={addedCards.has(rec.name)}
                        onCardAction={handleCardAction}
                        menuProps={menuProps}
                      />
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
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
          const cmdr = useStore.getState().commander;
          const partner = useStore.getState().partnerCommander;
          const totalNonLand = analysis.curveAnalysis.reduce((s, sl) => s + sl.current, 0);
          const drawCount = roleCounts.cardDraw ?? 0;
          const allPhasesActive = activeCurvePhases.size === analysis.curvePhases.length;
          const selectedPhases = analysis.curvePhases.filter(p => activeCurvePhases.has(p.phase));
          return (
            <div className="space-y-3">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                <CurveInsights
                  curveAnalysis={analysis.curveAnalysis}
                  curvePhases={analysis.curvePhases}
                  manaSources={analysis.manaSources}
                  manaTrajectory={analysis.manaTrajectory}
                  commanderCmc={cmdr?.cmc ?? 0}
                  partnerCmc={partner?.cmc}
                  commanderName={commanderName}
                  partnerName={partnerCommanderName}
                  totalNonLand={totalNonLand}
                  drawCount={drawCount}
                  taplandCount={analysis.manaBase.taplandCount}
                  landCount={analysis.manaBase.currentLands}
                />
                <div className="bg-card/60 border border-border/30 rounded-lg p-3">
                  <ManaTrajectorySparkline trajectory={analysis.manaTrajectory} />
                </div>
              </div>
              <CurveSummaryStrip
                phases={analysis.curvePhases}
                activePhases={activeCurvePhases}
                onPhaseClick={(phase: CurvePhase) => {
                  setActiveCurvePhases(prev => {
                    const next = new Set(prev);
                    if (next.has(phase)) next.delete(phase);
                    else next.add(phase);
                    return next;
                  });
                }}
              />
              <ManaCurveLineChart
                curveAnalysis={analysis.curveAnalysis}
                pacing={effectivePacing}
                activePhases={allPhasesActive ? undefined : activeCurvePhases}
                selectedCmc={selectedCmc}
                onCmcClick={(cmc: number) => setSelectedCmc(prev => prev === cmc ? null : cmc)}
              />
              {selectedCmc !== null && (
                <CmcCardList
                  curveBreakdowns={analysis.curveBreakdowns}
                  selectedCmc={selectedCmc}
                  onPreview={handlePreview}
                  onClose={() => setSelectedCmc(null)}
                  onCardAction={handleCardAction}
                  menuProps={menuProps}
                />
              )}
              {selectedPhases.length > 0 ? (
                <PhaseCardDisplay
                  phases={selectedPhases}
                  onPreview={handlePreview}
                  onCardAction={handleCardAction}
                  menuProps={menuProps}
                />
              ) : (
                <div className="bg-card/60 border border-border/30 rounded-lg p-6 text-center">
                  <p className="text-xs text-muted-foreground">Select Early, Mid, or Late Game above to view cards by role</p>
                </div>
              )}
            </div>
          );
        })()}

        {/* ── BRACKET TAB ── */}
        {activeTab === 'bracket' && (
          <BracketTabContent onPreview={handlePreview} />
        )}

      </div>

      <CardPreviewModal card={previewCard} onClose={() => setPreviewCard(null)} />
    </div>
  );
}
