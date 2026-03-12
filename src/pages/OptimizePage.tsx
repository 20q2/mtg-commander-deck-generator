import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArchetypeDisplay } from '@/components/archetype/ArchetypeDisplay';
import { DeckCustomizer } from '@/components/customization/DeckCustomizer';
import { DeckDisplay, RemovedCardsDialog } from '@/components/deck/DeckDisplay';
import { GapAnalysisDisplay } from '@/components/deck/GapAnalysisDisplay';
import { ComboDisplay } from '@/components/deck/ComboDisplay';
import { TestHand } from '@/components/deck/TestHand';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ColorIdentity, CardTypeIcon, CommanderIcon } from '@/components/ui/mtg-icons';
import { useStore } from '@/store';
import { generateDeck } from '@/services/deckBuilder/deckGenerator';
import { getCardByName, getCardImageUrl, getCardsByNames, getFrontFaceTypeLine } from '@/services/scryfall/client';
import { fetchCommanderData, fetchPartnerCommanderData, formatCommanderNameForUrl } from '@/services/edhrec';
import { applyCommanderTheme, resetTheme } from '@/lib/commanderTheme';
import { loadUserLists } from '@/hooks/useUserLists';
import type { BracketLevel, BudgetOption, ThemeResult, UserCardList } from '@/types';
import { Loader2, Wand2, ArrowLeft, ExternalLink, List } from 'lucide-react';
import { trackEvent } from '@/services/analytics';

export function OptimizePage() {
  const { listId } = useParams<{ listId: string }>();
  const navigate = useNavigate();
  const [progress, setProgress] = useState('');
  const [progressPercent, setProgressPercent] = useState(0);
  const [isLoadingCommander, setIsLoadingCommander] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [noDataForSettings, setNoDataForSettings] = useState(false);
  const [showRemovedCards, setShowRemovedCards] = useState(false);
  const [optimizeList, setOptimizeList] = useState<UserCardList | null>(null);
  const [typeBreakdown, setTypeBreakdown] = useState<Record<string, number>>({});

  const {
    commander,
    partnerCommander,
    colorIdentity,
    selectedThemes,
    customization,
    generatedDeck,
    isLoading,
    loadingMessage,
    themesLoading,
    setCommander,
    setPartnerCommander,
    updateCustomization,
    setEdhrecThemes,
    setEdhrecNumDecks,
    setEdhrecLandSuggestion,
    setSelectedThemes,
    setThemesLoading,
    setThemesError,
    setGeneratedDeck,
    setLoading,
    setError,
    reset,
  } = useStore();

  // Scroll to top on mount
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  // Load list and commander
  useEffect(() => {
    if (!listId) {
      navigate('/lists');
      return;
    }

    const lists = loadUserLists();
    const list = lists.find(l => l.id === listId);
    if (!list || !list.commanderName) {
      navigate('/lists');
      return;
    }

    setOptimizeList(list);

    // Compute type breakdown and set land count from original deck
    if (list.cards.length > 0) {
      getCardsByNames(list.cards).then(cardMap => {
        const breakdown: Record<string, number> = {};
        let landCount = 0;
        let basicLandCount = 0;
        for (const name of list.cards) {
          const card = cardMap.get(name);
          if (!card) continue;
          const typeLine = getFrontFaceTypeLine(card).toLowerCase();
          let mainType = 'Other';
          if (typeLine.includes('creature')) mainType = 'Creature';
          else if (typeLine.includes('instant')) mainType = 'Instant';
          else if (typeLine.includes('sorcery')) mainType = 'Sorcery';
          else if (typeLine.includes('artifact')) mainType = 'Artifact';
          else if (typeLine.includes('enchantment')) mainType = 'Enchantment';
          else if (typeLine.includes('land')) {
            mainType = 'Land';
            landCount++;
            if (typeLine.includes('basic')) basicLandCount++;
          }
          else if (typeLine.includes('planeswalker')) mainType = 'Planeswalker';
          else if (typeLine.includes('battle')) mainType = 'Battle';
          breakdown[mainType] = (breakdown[mainType] ?? 0) + 1;
        }
        setTypeBreakdown(breakdown);

        // Set land count from original deck so EDHREC doesn't override it
        if (landCount > 0) {
          updateCustomization({
            landCount,
            nonBasicLandCount: landCount - basicLandCount,
          });
          useStore.setState({ userEditedLands: true });
        }
      });
    }

    async function loadCommander() {
      if (!list!.commanderName) return;

      // Clear stale themes from any previous session immediately
      setSelectedThemes([]);

      const decodedName = list!.commanderName;
      let card = commander?.name === decodedName ? commander : null;

      if (!card) {
        setIsLoadingCommander(true);
        try {
          card = await getCardByName(decodedName, true);
          if (!card) {
            navigate('/lists');
            return;
          }
          setCommander(card);
          setImageLoaded(false);
        } catch (error) {
          console.error('Failed to load commander:', error);
          navigate('/lists');
          return;
        } finally {
          setIsLoadingCommander(false);
        }
      }

      // Load partner if present
      if (list!.partnerCommanderName) {
        const partnerName = list!.partnerCommanderName;
        if (partnerCommander?.name !== partnerName) {
          try {
            const partnerCard = await getCardByName(partnerName, true);
            if (partnerCard) {
              setPartnerCommander(partnerCard);
            }
          } catch (error) {
            console.error('Failed to load partner commander:', error);
          }
        }
      }

      // Always fetch fresh EDHREC themes for build-from-deck flow
      // (don't skip even if commander is cached — themes may be stale from a previous session)
      setThemesLoading(true);
      setThemesError(null);

      try {
        const bracketLevel = customization.bracketLevel !== 'all' ? customization.bracketLevel : undefined;
        const data = await fetchCommanderData(card.name, undefined, bracketLevel);
        const themes = data.themes;

        const { landDistribution } = data.stats;
        const suggestedLands = Math.round(landDistribution.total);
        const suggestedNonBasic = Math.round(landDistribution.nonbasic);
        if (suggestedLands > 0) {
          if (!useStore.getState().userEditedLands) {
            updateCustomization({
              landCount: suggestedLands,
              nonBasicLandCount: suggestedNonBasic,
            });
          }
          setEdhrecLandSuggestion({
            landCount: suggestedLands,
            nonBasicLandCount: suggestedNonBasic,
          });
        }

        setEdhrecNumDecks(data.stats.numDecks || null);

        if (themes.length > 0) {
          setEdhrecThemes(themes);
          const themeResults: ThemeResult[] = themes.map((t, index) => ({
            name: t.name,
            source: 'edhrec' as const,
            slug: t.slug,
            deckCount: t.count,
            popularityPercent: t.popularityPercent,
            isSelected: index < 2,
          }));
          setSelectedThemes(themeResults);
        } else {
          setThemesError('No themes found on EDHREC');
        }
      } catch {
        setThemesError('Could not fetch EDHREC themes');
      } finally {
        setThemesLoading(false);
      }
    }

    loadCommander();
  }, [listId]);

  // Re-fetch themes when bracket level or budget option changes
  const prevBracketRef = useRef<BracketLevel>(customization.bracketLevel);
  const prevBudgetOptRef = useRef<BudgetOption>(customization.budgetOption);

  useEffect(() => {
    const currentBracket = customization.bracketLevel;
    const currentBudget = customization.budgetOption;
    const prevBracket = prevBracketRef.current;
    const prevBudget = prevBudgetOptRef.current;

    prevBracketRef.current = currentBracket;
    prevBudgetOptRef.current = currentBudget;

    if (!commander || (currentBracket === prevBracket && currentBudget === prevBudget)) return;
    setNoDataForSettings(false);

    const { themeSource, themesError } = useStore.getState();
    if (themeSource !== 'edhrec' && !themesError) return;

    async function refreshThemesForBracket() {
      setThemesLoading(true);
      setThemesError(null);

      const previouslySelectedSlugs = new Set(
        selectedThemes.filter(t => t.isSelected && t.slug).map(t => t.slug!)
      );

      try {
        const bracketLevel = currentBracket !== 'all' ? currentBracket : undefined;
        const budgetOpt = currentBudget !== 'any' ? currentBudget : undefined;
        const data = partnerCommander
          ? await fetchPartnerCommanderData(commander!.name, partnerCommander.name, budgetOpt, bracketLevel)
          : await fetchCommanderData(commander!.name, budgetOpt, bracketLevel);
        const themes = data.themes;

        let scaleFactor = 1;
        if (budgetOpt && data.stats.numDecks > 0) {
          const anyData = partnerCommander
            ? await fetchPartnerCommanderData(commander!.name, partnerCommander.name, undefined, bracketLevel)
            : await fetchCommanderData(commander!.name, undefined, bracketLevel);
          if (anyData.stats.numDecks > 0) {
            scaleFactor = data.stats.numDecks / anyData.stats.numDecks;
          }
        }

        const { landDistribution } = data.stats;
        const suggestedLands = Math.round(landDistribution.total);
        const suggestedNonBasic = Math.round(landDistribution.nonbasic);
        if (suggestedLands > 0) {
          if (!useStore.getState().userEditedLands) {
            updateCustomization({
              landCount: suggestedLands,
              nonBasicLandCount: suggestedNonBasic,
            });
          }
          setEdhrecLandSuggestion({
            landCount: suggestedLands,
            nonBasicLandCount: suggestedNonBasic,
          });
        }

        setEdhrecNumDecks(data.stats.numDecks || null);

        if (themes.length > 0) {
          setEdhrecThemes(themes);

          const newSlugs = new Set(themes.map(t => t.slug));
          const lost = selectedThemes
            .filter(t => t.isSelected && t.slug && !newSlugs.has(t.slug))
            .map(t => t.name);

          if (lost.length > 0) {
            setToastMessage(`${lost.join(', ')} ${lost.length === 1 ? 'was' : 'were'} deselected — not available with current settings`);
          }

          const themeResults: ThemeResult[] = themes.map((t) => ({
            name: t.name,
            source: 'edhrec' as const,
            slug: t.slug,
            deckCount: Math.round(t.count * scaleFactor),
            popularityPercent: t.popularityPercent,
            isSelected: previouslySelectedSlugs.has(t.slug),
          }));

          setSelectedThemes(themeResults);
        } else {
          setNoDataForSettings(true);
          setThemesError('No EDHREC themes available for this combination');
          const lostNames = selectedThemes.filter(t => t.isSelected).map(t => t.name);
          if (lostNames.length > 0) {
            setToastMessage(`${lostNames.join(', ')} ${lostNames.length === 1 ? 'was' : 'were'} deselected — not available with current settings`);
          }
        }
      } catch {
        console.warn('[OptimizePage] No EDHREC data for this bracket/budget combination');
        setNoDataForSettings(true);
        setThemesError('No EDHREC data available for this combination');
        setEdhrecNumDecks(null);
        setToastMessage('No EDHREC data for this combination of bracket and budget');
      } finally {
        setThemesLoading(false);
      }
    }

    refreshThemesForBracket();
  }, [customization.bracketLevel, customization.budgetOption, commander?.name]);

  // Apply commander color theme
  useEffect(() => {
    if (colorIdentity.length > 0) {
      applyCommanderTheme(colorIdentity);
    }
    return () => resetTheme();
  }, [colorIdentity]);

  // Auto-dismiss toast
  useEffect(() => {
    if (!toastMessage) return;
    const timer = setTimeout(() => setToastMessage(null), 5000);
    return () => clearTimeout(timer);
  }, [toastMessage]);

  const handleGenerate = async () => {
    const { commander: cmd, partnerCommander: partner, colorIdentity: colors, customization: cust, selectedThemes: themes, generatedDeck: currentDeck } = useStore.getState();
    if (!cmd || !optimizeList) return;
    const isRegeneration = currentDeck !== null;

    // Get the deck cards (minus commander/partner) to pass as optimization cards
    // Lands are included so the user's original land base is preserved as must-includes;
    // the generator will only fill remaining land slots with generated lands.
    const commanderNames = new Set<string>();
    commanderNames.add(cmd.name);
    if (partner) commanderNames.add(partner.name);
    const deckCards = optimizeList.cards.filter(name => !commanderNames.has(name));

    setLoading(true, 'Starting deck optimization...');
    setProgress('Initializing...');
    setProgressPercent(0);

    try {
      let collectionNames: Set<string> | undefined;
      if (cust.collectionMode) {
        const { getCollectionNameSet } = await import('@/services/collection/db');
        collectionNames = await getCollectionNameSet();
        if (collectionNames.size === 0) {
          setError('Collection mode is enabled but your collection is empty. Import your collection first.');
          setLoading(false);
          return;
        }
      }

      const deck = await generateDeck({
        commander: cmd,
        partnerCommander: partner,
        colorIdentity: colors,
        customization: cust,
        selectedThemes: themes,
        collectionNames,
        optimizeDeckCards: deckCards,
        onProgress: (message, percent) => {
          setProgress(message);
          setProgressPercent(percent);
        },
      });

      deck.builtFromCollection = !!cust.collectionMode;
      if (!isRegeneration) {
        updateCustomization({ tempBannedCards: [], tempMustIncludeCards: [] });
      }

      // Compute which original deck cards were removed (compare full original list)
      const finalCardNames = new Set(
        Object.values(deck.categories).flat().map(c => c.name)
      );
      if (deck.commander) finalCardNames.add(deck.commander.name);
      if (deck.partnerCommander) finalCardNames.add(deck.partnerCommander.name);
      // Also match front-face names for DFCs
      for (const name of finalCardNames) {
        if (name.includes(' // ')) finalCardNames.add(name.split(' // ')[0]);
      }
      deck.removedFromDeck = optimizeList.cards.filter(name => !commanderNames.has(name) && !finalCardNames.has(name));

      setGeneratedDeck(deck);
      trackEvent('deck_optimized', {
        commanderName: cmd.name,
        partnerName: partner?.name,
        listName: optimizeList.name,
        originalCardCount: optimizeList.cards.length,
        deckFormat: cust.deckFormat,
        themes: themes.filter(t => t.isSelected).map(t => t.name),
        totalCards: deck.stats.totalCards,
        isRegeneration,
      });
    } catch (error) {
      console.error('Optimization error:', error);
      setError(error instanceof Error ? error.message : 'Failed to optimize deck');
    } finally {
      setLoading(false);
      setProgress('');
      setProgressPercent(0);
    }
  };

  const handleBack = () => {
    if (generatedDeck) {
      setGeneratedDeck(null);
      return;
    }
    reset();
    navigate(`/lists/${listId}/deck-view`);
  };

  // Compute card count delta for the header
  const targetSize = customization.deckFormat;
  const currentCardCount = optimizeList ? optimizeList.cards.length : 0;
  const delta = currentCardCount - targetSize;

  if (isLoadingCommander || !optimizeList) {
    return (
      <main className="flex-1 container mx-auto px-4 py-8">
        <div className="flex flex-col items-center justify-center py-20">
          <Loader2 className="w-10 h-10 animate-spin text-primary mb-4" />
          <p className="text-muted-foreground">Loading deck...</p>
        </div>
      </main>
    );
  }

  if (!commander) {
    return null;
  }

  return (
    <main className="flex-1 container mx-auto px-4 py-8">
      {/* Back Button */}
      <Button
        variant="ghost"
        onClick={handleBack}
        className="mb-6 -ml-2"
      >
        <ArrowLeft className="w-4 h-4 mr-2" />
        {generatedDeck ? 'Back to Settings' : 'Back to Deck'}
      </Button>

      {/* Deck Info Header - only show during customization */}
      {!generatedDeck && (
        <section className="mb-8">
          <div className="w-full mx-auto max-w-2xl">
            <Card className="animate-scale-in overflow-hidden bg-card/80 backdrop-blur-sm">
              <CardContent className="p-0">
                <div className="flex">
                  {/* Commander Image */}
                  <div className="relative w-40 shrink-0">
                    {!imageLoaded && (
                      <div className="absolute inset-0 shimmer rounded-l-xl" />
                    )}
                    <img
                      src={getCardImageUrl(commander, 'normal')}
                      alt={commander.name}
                      className={`w-full h-full object-cover rounded-l-xl transition-opacity duration-300 ${
                        imageLoaded ? 'opacity-100' : 'opacity-0'
                      }`}
                      onLoad={() => setImageLoaded(true)}
                    />
                  </div>

                  {/* Deck Details */}
                  <div className="flex-1 p-4 flex flex-col">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-xs text-muted-foreground uppercase tracking-wider font-medium">Building from Deck</p>
                        <h3 className="font-bold text-lg leading-tight mt-0.5">
                          {optimizeList.name}
                        </h3>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => navigate(`/lists/${optimizeList.id}/deck-view`)}
                          className="shrink-0 h-8 w-8 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-primary hover:bg-accent transition-colors"
                          title="View list"
                        >
                          <List className="w-4 h-4" />
                        </button>
                        <a
                          href={`https://edhrec.com/commanders/${formatCommanderNameForUrl(commander.name)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="shrink-0 h-8 w-8 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-primary hover:bg-accent transition-colors"
                          title="View on EDHREC"
                        >
                          <ExternalLink className="w-4 h-4" />
                        </a>
                      </div>
                    </div>

                    <p className="text-sm text-muted-foreground mt-1 flex items-center gap-1">
                      <CommanderIcon size={14} className="opacity-60" />
                      {commander.name}
                      {partnerCommander && ` & ${partnerCommander.name}`}
                    </p>

                    {/* Type Breakdown */}
                    {Object.keys(typeBreakdown).length > 0 && (
                      <div className="flex items-center gap-1.5 mt-2">
                        {Object.entries(typeBreakdown)
                          .sort((a, b) => b[1] - a[1])
                          .map(([type, count]) => (
                            <span
                              key={type}
                              className="inline-flex items-center gap-0.5 text-[11px] text-muted-foreground/70"
                              title={type}
                            >
                              <CardTypeIcon type={type} size="sm" className="opacity-50 text-[10px]" />
                              {count}
                            </span>
                          ))}
                      </div>
                    )}

                    {/* Color Identity */}
                    <div className="mt-2">
                      <ColorIdentity colors={colorIdentity} size="lg" />
                    </div>

                    {/* Card Count & Delta */}
                    <div className="mt-auto pt-3">
                      <div className="flex items-center gap-2 text-sm">
                        <span className="font-medium">{currentCardCount} cards</span>
                        {delta > 0 && (
                          <span className="text-xs px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-500">
                            {delta} {delta === 1 ? 'card' : 'cards'} will be removed
                          </span>
                        )}
                        {delta < 0 && (
                          <span className="text-xs px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-500">
                            {Math.abs(delta)} new {Math.abs(delta) === 1 ? 'card' : 'cards'} will be added
                          </span>
                        )}
                        {delta === 0 && (
                          <span className="text-xs px-1.5 py-0.5 rounded bg-green-500/15 text-green-500">
                            exactly {targetSize}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </section>
      )}

      {/* Step 2/3: Customization */}
      {!generatedDeck && (
        <section className="mb-8 animate-slide-up">
          <div className="grid md:grid-cols-2 gap-6">
            {/* Archetype */}
            <Card className="bg-card/80 backdrop-blur-sm flex flex-col">
              <CardHeader className="pb-3">
                <CardTitle className="text-lg flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center text-primary font-bold text-sm">
                    2
                  </div>
                  Archetype
                </CardTitle>
              </CardHeader>
              <CardContent className="flex-1 flex flex-col">
                <ArchetypeDisplay />
              </CardContent>
            </Card>

            {/* Customization */}
            <Card className="bg-card/80 backdrop-blur-sm">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center text-primary font-bold text-sm">
                      3
                    </div>
                    Customize
                  </CardTitle>
                  <button
                    onClick={() => {
                      const { bannedCards, mustIncludeCards, banLists, currency } = useStore.getState().customization;
                      useStore.getState().updateCustomization({
                        deckFormat: 99,
                        landCount: 37,
                        nonBasicLandCount: 15,
                        maxCardPrice: null,
                        deckBudget: null,
                        budgetOption: 'any',
                        gameChangerLimit: 'unlimited',
                        bracketLevel: 'all',
                        maxRarity: null,
                        tinyLeaders: false,
                        collectionMode: false,
                        arenaOnly: false,
                        comboCount: 0,
                        hyperFocus: false,
                        bannedCards,
                        banLists,
                        mustIncludeCards,
                        currency,
                        appliedExcludeLists: [],
                        appliedIncludeLists: [],
                      });
                    }}
                    className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
                    title="Reset all customization options to defaults"
                  >
                    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="1 4 1 10 7 10" />
                      <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
                    </svg>
                    Reset
                  </button>
                </div>
              </CardHeader>
              <CardContent>
                <DeckCustomizer />
              </CardContent>
            </Card>
          </div>

          {/* Generate Button */}
          <div className="mt-8 text-center">
            <Button
              size="lg"
              onClick={handleGenerate}
              disabled={isLoading || themesLoading || noDataForSettings}
              className="min-w-56 h-14 text-lg btn-shimmer hover-lift"
            >
              {themesLoading ? (
                <>
                  <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                  Loading EDHREC data...
                </>
              ) : noDataForSettings ? (
                <>
                  No EDHREC data — adjust bracket or budget
                </>
              ) : isLoading ? (
                <>
                  <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                  {progress || loadingMessage}
                </>
              ) : (
                <>
                  <Wand2 className="w-5 h-5 mr-2" />
                  Build From Deck
                </>
              )}
            </Button>
            {isLoading && progressPercent > 0 && (
              <div className="mt-4 w-64 mx-auto">
                <div className="h-2 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary rounded-full"
                    style={{
                      width: `${progressPercent}%`,
                      transition: 'width 600ms cubic-bezier(0.4, 0, 0.2, 1)',
                    }}
                  />
                </div>
                <p className="text-xs text-muted-foreground mt-1">{progressPercent}% complete</p>
              </div>
            )}
            {!isLoading && (
              <p className="text-sm text-muted-foreground mt-3">
                Keeps your cards where possible, {delta > 0 ? 'trims' : 'fills'} to {customization.deckFormat - (partnerCommander ? 1 : 0)} cards
              </p>
            )}
          </div>
        </section>
      )}

      {/* Deck Display */}
      {generatedDeck && (
        <section>
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-green-500/20 flex items-center justify-center text-green-500 font-bold text-sm">
                ✓
              </div>
              <h2 className="text-xl font-bold">
                Built from {optimizeList.name}
                {(() => {
                  const originalCount = optimizeList.cards.length;
                  const finalCount = generatedDeck.stats.totalCards;
                  const diff = finalCount - originalCount;
                  const removed = generatedDeck.removedFromDeck;
                  if (diff > 0) return <span className="text-sm font-normal text-blue-400 ml-2">+{diff} {diff === 1 ? 'card' : 'cards'} added</span>;
                  if (diff < 0 && removed && removed.length > 0) return (
                    <button onClick={() => setShowRemovedCards(true)} className="text-sm font-normal text-amber-400 ml-2 hover:underline cursor-pointer">
                      {removed.length} {removed.length === 1 ? 'card' : 'cards'} removed
                    </button>
                  );
                  if (diff < 0) return <span className="text-sm font-normal text-amber-400 ml-2">{Math.abs(diff)} {Math.abs(diff) === 1 ? 'card' : 'cards'} removed</span>;
                  return null;
                })()}
              </h2>
            </div>
          </div>
          <DeckDisplay onRegenerate={handleGenerate} hideRegenerate regenerateProgress={isLoading ? progressPercent : undefined} regenerateMessage={isLoading ? progress : undefined}>
            {generatedDeck.detectedCombos && generatedDeck.detectedCombos.length > 0 && (
              <ComboDisplay combos={generatedDeck.detectedCombos} onRegenerate={handleGenerate} />
            )}
            <TestHand />
          </DeckDisplay>
          {generatedDeck.gapAnalysis && generatedDeck.gapAnalysis.length > 0 && (
            <GapAnalysisDisplay cards={generatedDeck.gapAnalysis} />
          )}
        </section>
      )}
      {showRemovedCards && generatedDeck?.removedFromDeck && (
        <RemovedCardsDialog removedCards={generatedDeck.removedFromDeck} onClose={() => setShowRemovedCards(false)} />
      )}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 px-4 py-2 bg-amber-500/90 text-white text-sm rounded-lg shadow-lg animate-fade-in max-w-sm">
          {toastMessage}
        </div>
      )}
    </main>
  );
}
