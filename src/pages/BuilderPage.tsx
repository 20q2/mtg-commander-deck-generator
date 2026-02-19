import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArchetypeDisplay } from '@/components/archetype/ArchetypeDisplay';
import { DeckCustomizer } from '@/components/customization/DeckCustomizer';
import { DeckDisplay } from '@/components/deck/DeckDisplay';
import { PartnerSelector } from '@/components/commander/PartnerSelector';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ManaCost, ColorIdentity } from '@/components/ui/mtg-icons';
import { useStore } from '@/store';
import { generateDeck } from '@/services/deckBuilder/deckGenerator';
import { getCardByName, getCardImageUrl } from '@/services/scryfall/client';
import {
  detectArchetypes,
  getArchetypeDefaultCustomization,
} from '@/services/deckBuilder/archetypeDetector';
import { fetchCommanderThemes, fetchPartnerThemes, formatCommanderNameForUrl } from '@/services/edhrec';
import { ARCHETYPE_LABELS } from '@/lib/constants/archetypes';
import { applyCommanderTheme, resetTheme } from '@/lib/commanderTheme';
import type { ThemeResult } from '@/types';
import { Loader2, Wand2, ArrowLeft, ExternalLink } from 'lucide-react';

export function BuilderPage() {
  const { commanderName, partnerName } = useParams<{ commanderName: string; partnerName?: string }>();
  const navigate = useNavigate();
  const [progress, setProgress] = useState('');
  const [progressPercent, setProgressPercent] = useState(0);
  const [isLoadingCommander, setIsLoadingCommander] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [partnerImageLoaded, setPartnerImageLoaded] = useState(false);

  const {
    commander,
    partnerCommander,
    colorIdentity,
    selectedArchetype,
    selectedThemes,
    customization,
    generatedDeck,
    isLoading,
    loadingMessage,
    setCommander,
    setPartnerCommander,
    setDetectedArchetypes,
    updateCustomization,
    setEdhrecThemes,
    setSelectedThemes,
    setThemesLoading,
    setThemesError,
    setGeneratedDeck,
    setLoading,
    setError,
    reset,
  } = useStore();

  // Load commander from URL if not already loaded
  useEffect(() => {
    async function loadCommanderFromUrl() {
      if (!commanderName) {
        navigate('/');
        return;
      }

      const decodedName = decodeURIComponent(commanderName);

      // Check if we already have this commander in store (from search page)
      const hasCommanderCached = commander?.name === decodedName;

      // Use cached commander or fetch from API
      let card = hasCommanderCached ? commander : null;

      if (!card) {
        setIsLoadingCommander(true);
        try {
          card = await getCardByName(decodedName, true);
          if (!card) {
            navigate('/');
            return;
          }
          setCommander(card);
          setImageLoaded(false);
        } catch (error) {
          console.error('Failed to load commander:', error);
          navigate('/');
          return;
        } finally {
          setIsLoadingCommander(false);
        }
      }

      // Skip if we already have themes loaded for this commander
      if (hasCommanderCached && selectedThemes.length > 0) {
        return;
      }

      // Detect archetypes
      const archetypes = detectArchetypes(card);
      setDetectedArchetypes(archetypes);

      if (archetypes.length > 0) {
        const defaults = getArchetypeDefaultCustomization(archetypes[0].archetype);
        updateCustomization(defaults);
      }

      // Fetch EDHREC themes
      setThemesLoading(true);
      setThemesError(null);

      try {
        const themes = await fetchCommanderThemes(card.name);

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
          fallbackToLocalArchetypes(archetypes);
        }
      } catch {
        setThemesError('Could not fetch EDHREC themes');
        fallbackToLocalArchetypes(archetypes);
      } finally {
        setThemesLoading(false);
      }

      function fallbackToLocalArchetypes(archetypes: ReturnType<typeof detectArchetypes>) {
        if (archetypes.length > 0) {
          const localThemes: ThemeResult[] = archetypes.slice(0, 3).map((a, index) => ({
            name: ARCHETYPE_LABELS[a.archetype],
            source: 'local' as const,
            archetype: a.archetype,
            score: a.score,
            confidence: a.confidence,
            isSelected: index === 0,
          }));
          setSelectedThemes(localThemes);
        }
      }
    }

    loadCommanderFromUrl();
  }, [commanderName]);

  // Load partner commander from URL if present
  useEffect(() => {
    async function loadPartnerFromUrl() {
      if (!partnerName || !commander) return;

      const decodedPartnerName = decodeURIComponent(partnerName);

      // Check if we already have this partner in store
      if (partnerCommander?.name === decodedPartnerName) return;

      try {
        const partnerCard = await getCardByName(decodedPartnerName, true);
        if (partnerCard) {
          setPartnerCommander(partnerCard);
          setPartnerImageLoaded(false);
        }
      } catch (error) {
        console.error('Failed to load partner commander:', error);
      }
    }

    loadPartnerFromUrl();
  }, [partnerName, commander?.name]);

  // Update URL when partner commander changes
  useEffect(() => {
    if (!commander || !commanderName) return;

    const currentUrlPartner = partnerName ? decodeURIComponent(partnerName) : null;
    const storePartner = partnerCommander?.name ?? null;

    // Only update URL if the partner in store differs from URL
    if (storePartner !== currentUrlPartner) {
      const basePath = `/build/${encodeURIComponent(commander.name)}`;
      const newPath = storePartner
        ? `${basePath}/${encodeURIComponent(storePartner)}`
        : basePath;

      navigate(newPath, { replace: true });
    }
  }, [partnerCommander?.name, commander?.name, commanderName, partnerName, navigate]);

  // Apply commander color theme (uses combined color identity from both commanders)
  useEffect(() => {
    if (colorIdentity.length > 0) {
      applyCommanderTheme(colorIdentity);
    }

    // Reset theme when leaving the page
    return () => resetTheme();
  }, [colorIdentity]);

  // Reset partner image loaded state when partner changes
  useEffect(() => {
    setPartnerImageLoaded(false);
  }, [partnerCommander?.id]);

  // Track the previous partner to detect changes
  const prevPartnerRef = useRef<string | null>(null);

  // Re-fetch themes when partner commander changes
  useEffect(() => {
    const currentPartnerName = partnerCommander?.name ?? null;
    const prevPartnerName = prevPartnerRef.current;

    // Update ref for next comparison
    prevPartnerRef.current = currentPartnerName;

    // Skip if commander not loaded yet, or if partner hasn't actually changed
    if (!commander || currentPartnerName === prevPartnerName) {
      return;
    }

    async function refreshThemes() {
      setThemesLoading(true);
      setThemesError(null);

      try {
        let themes;
        if (partnerCommander) {
          // Fetch partner-specific themes
          themes = await fetchPartnerThemes(commander!.name, partnerCommander.name);
        } else {
          // Fetch single commander themes
          themes = await fetchCommanderThemes(commander!.name);
        }

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
          // Fall back to local archetypes
          const archetypes = detectArchetypes(commander!, partnerCommander ?? undefined);
          if (archetypes.length > 0) {
            const localThemes: ThemeResult[] = archetypes.slice(0, 3).map((a, index) => ({
              name: ARCHETYPE_LABELS[a.archetype],
              source: 'local' as const,
              archetype: a.archetype,
              score: a.score,
              confidence: a.confidence,
              isSelected: index === 0,
            }));
            setSelectedThemes(localThemes);
          }
        }
      } catch {
        setThemesError('Could not fetch EDHREC themes');
      } finally {
        setThemesLoading(false);
      }
    }

    refreshThemes();
  }, [partnerCommander?.name, commander?.name]);

  const handleGenerate = async () => {
    if (!commander) return;

    setLoading(true, 'Starting deck generation...');
    setProgress('Initializing...');
    setProgressPercent(0);

    try {
      const deck = await generateDeck({
        commander,
        partnerCommander,
        colorIdentity,
        archetype: selectedArchetype,
        customization,
        selectedThemes,
        onProgress: (message, percent) => {
          setProgress(message);
          setProgressPercent(percent);
        },
      });

      setGeneratedDeck(deck);
    } catch (error) {
      console.error('Generation error:', error);
      setError(error instanceof Error ? error.message : 'Failed to generate deck');
    } finally {
      setLoading(false);
      setProgress('');
      setProgressPercent(0);
    }
  };

  const handleBack = () => {
    // If viewing generated deck, go back to customization (steps 2/3)
    if (generatedDeck) {
      setGeneratedDeck(null);
      return;
    }
    // Otherwise, go back to home page (step 1)
    reset();
    navigate('/');
  };

  if (isLoadingCommander) {
    return (
      <main className="flex-1 container mx-auto px-4 py-8">
        <div className="flex flex-col items-center justify-center py-20">
          <Loader2 className="w-10 h-10 animate-spin text-primary mb-4" />
          <p className="text-muted-foreground">Loading commander...</p>
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
        {generatedDeck ? 'Back to Settings' : 'Back to Search'}
      </Button>

      {/* Commander Card Display - only show during customization */}
      {!generatedDeck && (
        <section className="mb-8">
          <div className={`w-full mx-auto ${partnerCommander ? 'max-w-3xl' : 'max-w-lg'}`}>
            <div className={`grid gap-4 ${partnerCommander ? 'md:grid-cols-2' : 'grid-cols-1'}`}>
              {/* Primary Commander Card */}
              <Card className="animate-scale-in overflow-hidden bg-card/80 backdrop-blur-sm">
                <CardContent className="p-0">
                  <div className="flex">
                    {/* Card Image */}
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

                    {/* Card Details */}
                    <div className="flex-1 p-4 flex flex-col">
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="font-bold text-lg leading-tight">
                          {commander.name}
                        </h3>
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

                      <p className="text-sm text-muted-foreground mt-1">
                        {commander.type_line}
                      </p>

                      {/* Color Identity - show combined when partner exists */}
                      <div className="mt-3">
                        <ColorIdentity colors={partnerCommander ? colorIdentity : commander.color_identity} size="lg" />
                      </div>

                      {/* Mana Cost */}
                      {commander.mana_cost && (
                        <div className="mt-auto pt-3 flex items-center gap-2">
                          <span className="text-xs text-muted-foreground">
                            Mana Cost:
                          </span>
                          <ManaCost cost={commander.mana_cost} />
                        </div>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Partner Commander Card (if selected) */}
              {partnerCommander && (
                <Card className="animate-scale-in overflow-hidden bg-card/80 backdrop-blur-sm">
                  <CardContent className="p-0">
                    <div className="flex">
                      {/* Card Image */}
                      <div className="relative w-40 shrink-0">
                        {!partnerImageLoaded && (
                          <div className="absolute inset-0 shimmer rounded-l-xl" />
                        )}
                        <img
                          src={getCardImageUrl(partnerCommander, 'normal')}
                          alt={partnerCommander.name}
                          className={`w-full h-full object-cover rounded-l-xl transition-opacity duration-300 ${
                            partnerImageLoaded ? 'opacity-100' : 'opacity-0'
                          }`}
                          onLoad={() => setPartnerImageLoaded(true)}
                        />
                      </div>

                      {/* Card Details */}
                      <div className="flex-1 p-4 flex flex-col">
                        <div className="flex items-start justify-between gap-2">
                          <h3 className="font-bold text-lg leading-tight">
                            {partnerCommander.name}
                          </h3>
                          <a
                            href={`https://edhrec.com/commanders/${formatCommanderNameForUrl(partnerCommander.name)}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="shrink-0 h-8 w-8 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-primary hover:bg-accent transition-colors"
                            title="View on EDHREC"
                          >
                            <ExternalLink className="w-4 h-4" />
                          </a>
                        </div>

                        <p className="text-sm text-muted-foreground mt-1">
                          {partnerCommander.type_line}
                        </p>

                        {/* Partner's individual color identity */}
                        <div className="mt-3">
                          <ColorIdentity colors={partnerCommander.color_identity} size="lg" />
                        </div>

                        {/* Mana Cost */}
                        {partnerCommander.mana_cost && (
                          <div className="mt-auto pt-3 flex items-center gap-2">
                            <span className="text-xs text-muted-foreground">
                              Mana Cost:
                            </span>
                            <ManaCost cost={partnerCommander.mana_cost} />
                          </div>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>

            {/* Partner Selector - only show for commanders that can have partners */}
            <div className="max-w-lg mx-auto">
              <PartnerSelector commander={commander} />
            </div>
          </div>
        </section>
      )}

      {/* Step 2/3: Customization */}
      {!generatedDeck && (
        <section className="mb-8 animate-slide-up">
          <div className="grid md:grid-cols-2 gap-6">
            {/* Archetype */}
            <Card className="bg-card/80 backdrop-blur-sm">
              <CardHeader className="pb-3">
                <CardTitle className="text-lg flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center text-primary font-bold text-sm">
                    2
                  </div>
                  Archetype
                </CardTitle>
              </CardHeader>
              <CardContent>
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
                      const { bannedCards, mustIncludeCards } = useStore.getState().customization;
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
                        bannedCards,
                        mustIncludeCards,
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
              disabled={isLoading}
              className="min-w-56 h-14 text-lg glow hover-lift"
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                  {progress || loadingMessage}
                </>
              ) : (
                <>
                  <Wand2 className="w-5 h-5 mr-2" />
                  Generate Deck
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
                Creates a complete {customization.deckFormat - (partnerCommander ? 1 : 0)}-card deck based on your preferences
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
                Deck generated for {commander.name}
                {partnerCommander && ` & ${partnerCommander.name}`}
              </h2>
            </div>
          </div>
          <DeckDisplay />
        </section>
      )}
    </main>
  );
}
