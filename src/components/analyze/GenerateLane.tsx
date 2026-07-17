import { useCallback, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { CommanderSearch } from '@/components/commander/CommanderSearch';
import { generateDeck } from '@/services/deckBuilder/deckGenerator';
import { fetchCommanderData } from '@/services/edhrec/client';
import { useStore } from '@/store';
import { trackEvent } from '@/services/analytics';
import { TAB_KEY_BY_SLUG } from '@/components/deck/optimizer/constants';
import type { Customization, ScryfallCard, ThemeResult } from '@/types';

// Pristine customization used for "Generate & Inspect" — explicitly empties the
// user's banned/must-include lists and resets all preference-y fields so the
// inspector sees a stock build for the chosen commander. Numeric land counts
// get overwritten with EDHREC suggestions before generation.
function buildPristineCustomization(): Customization {
  return {
    deckFormat: 99,
    landCount: 37,
    nonBasicLandCount: 15,
    bannedCards: [],
    banLists: [],
    mustIncludeCards: [],
    tempBannedCards: [],
    tempMustIncludeCards: [],
    maxCardPrice: null,
    deckBudget: null,
    budgetOption: 'any',
    gameChangerLimit: 'unlimited',
    bracketLevel: 'all',
    allowedRarities: null,
    tinyLeaders: false,
    ignoreOwnedBudget: false,
    ignoreOwnedRarity: false,
    collectionMode: false,
    collectionStrategy: 'full',
    collectionOwnedPercent: 75,
    arenaOnly: false,
    scryfallQuery: '',
    comboCount: 1,
    hyperFocus: false,
    balancedRoles: true,
    currency: 'USD',
    appliedExcludeLists: [],
    appliedIncludeLists: [],
    advancedTargets: {
      curvePercentages: null,
      typePercentages: null,
      roleTargets: null,
      edhrecBlendWeight: null,
      edhrecInclusionThreshold: null,
    },
    tempoAutoDetect: true,
    tempoPacing: 'balanced',
  };
}

export function GenerateLane() {
  const navigate = useNavigate();
  // Deep-linking into the hub with a tab already in the URL (e.g. /analyze/lift-web)
  // should still land there once the deck finishes generating, not default to Overview.
  const { param1 } = useParams<{ param1?: string }>();
  const tabSlug = param1 && param1 in TAB_KEY_BY_SLUG ? param1 : 'overview';
  const [working, setWorking] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleSelectCommander = useCallback(async (card: ScryfallCard) => {
    setWorking(true);
    setError(null);
    setProgress('Loading commander data…');
    try {
      // Build with EDHREC theme context (first two themes auto-selected, like
      // the standard generate flow). We DON'T write themes back into the store
      // so the user's manual theme selections elsewhere stay intact.
      const data = await fetchCommanderData(card.name).catch(() => null);
      const themes = data?.themes ?? [];
      const selectedThemes: ThemeResult[] = themes.map((t, index) => ({
        name: t.name,
        source: 'edhrec' as const,
        slug: t.slug,
        deckCount: t.count,
        popularityPercent: t.popularityPercent,
        isSelected: index < 2,
      }));

      const pristine = buildPristineCustomization();

      // Seed EDHREC-suggested land counts when available so the deck isn't
      // wildly off-curve for this commander's color identity.
      const landDist = data?.stats.landDistribution;
      if (landDist && landDist.total > 0) {
        pristine.landCount = Math.round(landDist.total);
        pristine.nonBasicLandCount = Math.round(landDist.nonbasic);
      }

      const deck = await generateDeck({
        commander: card,
        partnerCommander: null,
        colorIdentity: card.color_identity,
        customization: pristine,
        selectedThemes,
        onProgress: (msg) => setProgress(msg),
      });

      // Write only deck-related session state. `customization` (the user's
      // saved preferences — banned cards, must-includes, budget, etc.) is
      // intentionally left alone. selectedThemes/edhrecThemes are cleared
      // because they would otherwise be stale from a prior commander session
      // and surface as the wrong theme labels in the inspector.
      useStore.setState({
        commander: card,
        partnerCommander: null,
        colorIdentity: card.color_identity,
        generatedDeck: deck,
        selectedThemes: [],
        edhrecThemes: [],
      });

      trackEvent('analyze_cta_clicked', { from: 'generate-lane-auto' });
      navigate(`/analyze/${tabSlug}`);
    } catch (e) {
      console.error('[GenerateLane] inline build failed', e);
      setError('Could not build a deck for this commander. Please try again.');
      setWorking(false);
    }
  }, [navigate, tabSlug]);

  if (working) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-10 text-center">
        <Loader2 className="w-8 h-8 text-violet-300/80 animate-spin" />
        <div className="text-sm font-medium">{progress || 'Building your deck…'}</div>
        <p className="text-xs text-muted-foreground max-w-sm">
          Using default settings — your banned, must-include, and customization preferences aren't applied.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground text-center">
        Pick a commander — we'll build a default deck and drop you straight onto the inspector. Your saved preferences aren't applied.
      </p>
      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2 text-sm text-red-400 text-center">
          {error}
        </div>
      )}
      <CommanderSearch onSelectCommander={handleSelectCommander} />
    </div>
  );
}
