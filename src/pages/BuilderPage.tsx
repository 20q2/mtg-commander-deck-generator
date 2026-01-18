import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArchetypeDisplay } from '@/components/archetype/ArchetypeDisplay';
import { DeckCustomizer } from '@/components/customization/DeckCustomizer';
import { DeckDisplay } from '@/components/deck/DeckDisplay';
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
import { fetchCommanderThemes } from '@/services/edhrec';
import { ARCHETYPE_LABELS } from '@/lib/constants/archetypes';
import { applyCommanderTheme, resetTheme } from '@/lib/commanderTheme';
import type { ThemeResult } from '@/types';
import { Loader2, Wand2, ArrowLeft, RefreshCw } from 'lucide-react';

export function BuilderPage() {
  const { commanderName } = useParams<{ commanderName: string }>();
  const navigate = useNavigate();
  const [progress, setProgress] = useState('');
  const [isLoadingCommander, setIsLoadingCommander] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);

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

  // Apply commander color theme
  useEffect(() => {
    if (commander?.color_identity) {
      applyCommanderTheme(commander.color_identity);
    }

    // Reset theme when leaving the page
    return () => resetTheme();
  }, [commander?.color_identity]);

  const handleGenerate = async () => {
    if (!commander) return;

    setLoading(true, 'Starting deck generation...');
    setProgress('Initializing...');

    try {
      const deck = await generateDeck({
        commander,
        partnerCommander,
        colorIdentity,
        archetype: selectedArchetype,
        customization,
        selectedThemes,
        onProgress: (message) => setProgress(message),
      });

      setGeneratedDeck(deck);
    } catch (error) {
      console.error('Generation error:', error);
      setError(error instanceof Error ? error.message : 'Failed to generate deck');
    } finally {
      setLoading(false);
      setProgress('');
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

  const handleClearCommander = () => {
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

      {/* Commander Card Display */}
      <section className="mb-8">
        <Card className="w-full max-w-lg mx-auto animate-scale-in overflow-hidden bg-card/80 backdrop-blur-sm">
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
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={handleClearCommander}
                    className="shrink-0 h-8 w-8"
                  >
                    <RefreshCw className="w-4 h-4" />
                  </Button>
                </div>

                <p className="text-sm text-muted-foreground mt-1">
                  {commander.type_line}
                </p>

                {/* Color Identity */}
                <div className="mt-3">
                  <ColorIdentity colors={commander.color_identity} size="lg" />
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
      </section>

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
                <CardTitle className="text-lg flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center text-primary font-bold text-sm">
                    3
                  </div>
                  Customize
                </CardTitle>
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
            <p className="text-sm text-muted-foreground mt-3">
              Creates a complete {customization.deckFormat - (partnerCommander ? 1 : 0)}-card deck based on your preferences
            </p>
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
              <h2 className="text-xl font-bold">Deck Generated!</h2>
            </div>
          </div>
          <DeckDisplay />
        </section>
      )}
    </main>
  );
}
