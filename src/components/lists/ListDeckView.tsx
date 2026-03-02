import { useState, useEffect } from 'react';
import { ArrowLeft, Loader2, List } from 'lucide-react';
import { useStore } from '@/store';
import { getCardsByNames, getFrontFaceTypeLine } from '@/services/scryfall/client';
import { fetchCommanderCombos } from '@/services/edhrec/client';
import { applyCommanderTheme, resetTheme } from '@/lib/commanderTheme';
import { DeckDisplay } from '@/components/deck/DeckDisplay';
import { ComboDisplay } from '@/components/deck/ComboDisplay';
import type { UserCardList, ScryfallCard, GeneratedDeck, DeckCategory, DeckStats, DetectedCombo } from '@/types';

interface ListDeckViewProps {
  list: UserCardList;
  onBack: () => void;
  onViewAsList?: () => void;
}

function computeStatsFromCards(allCards: ScryfallCard[]): DeckStats {
  const nonLandCards = allCards.filter(
    card => !getFrontFaceTypeLine(card).toLowerCase().includes('land')
  );

  const manaCurve: Record<number, number> = {};
  nonLandCards.forEach(card => {
    const cmc = Math.min(Math.floor(card.cmc), 7);
    manaCurve[cmc] = (manaCurve[cmc] || 0) + 1;
  });

  const totalCmc = nonLandCards.reduce((sum, card) => sum + card.cmc, 0);
  const averageCmc = nonLandCards.length > 0 ? totalCmc / nonLandCards.length : 0;

  const colorDistribution: Record<string, number> = {};
  allCards.forEach(card => {
    const colors = card.colors || [];
    if (colors.length === 0) {
      colorDistribution['C'] = (colorDistribution['C'] || 0) + 1;
    } else {
      colors.forEach(color => {
        colorDistribution[color] = (colorDistribution[color] || 0) + 1;
      });
    }
  });

  const typeDistribution: Record<string, number> = {};
  allCards.forEach(card => {
    const typeLine = getFrontFaceTypeLine(card).toLowerCase();
    if (typeLine.includes('land')) typeDistribution['Land'] = (typeDistribution['Land'] || 0) + 1;
    else if (typeLine.includes('creature')) typeDistribution['Creature'] = (typeDistribution['Creature'] || 0) + 1;
    else if (typeLine.includes('instant')) typeDistribution['Instant'] = (typeDistribution['Instant'] || 0) + 1;
    else if (typeLine.includes('sorcery')) typeDistribution['Sorcery'] = (typeDistribution['Sorcery'] || 0) + 1;
    else if (typeLine.includes('artifact')) typeDistribution['Artifact'] = (typeDistribution['Artifact'] || 0) + 1;
    else if (typeLine.includes('enchantment')) typeDistribution['Enchantment'] = (typeDistribution['Enchantment'] || 0) + 1;
    else if (typeLine.includes('planeswalker')) typeDistribution['Planeswalker'] = (typeDistribution['Planeswalker'] || 0) + 1;
    else if (typeLine.includes('battle')) typeDistribution['Battle'] = (typeDistribution['Battle'] || 0) + 1;
  });

  return {
    totalCards: allCards.length,
    averageCmc: Math.round(averageCmc * 100) / 100,
    manaCurve,
    colorDistribution,
    typeDistribution,
  };
}

function getArtCropUrl(card: ScryfallCard | null): string | null {
  if (!card) return null;
  if (card.image_uris?.art_crop) return card.image_uris.art_crop;
  if (card.card_faces?.[0]?.image_uris?.art_crop) return card.card_faces[0].image_uris.art_crop;
  if (card.image_uris?.normal) return card.image_uris.normal;
  return null;
}

function detectCombosInDeck(
  combos: { comboId: string; cards: { name: string; id: string }[]; results: string[]; deckCount: number; bracket: string }[],
  allCardNames: Set<string>,
  commanderCard: ScryfallCard | null,
  partnerCard: ScryfallCard | null,
): DetectedCombo[] | undefined {
  if (combos.length === 0) return undefined;

  const detected = combos
    .map(combo => {
      const comboCardNames = combo.cards.map(c => c.name);
      const missingCards = comboCardNames.filter(name => !allCardNames.has(name));
      return {
        comboId: combo.comboId,
        cards: comboCardNames,
        results: combo.results,
        isComplete: missingCards.length === 0,
        missingCards,
        deckCount: combo.deckCount,
        bracket: combo.bracket,
      };
    })
    .filter(dc => dc.isComplete || dc.missingCards.length <= 2);

  // Float commander combos to the top within each completeness group
  const commanderNames = new Set<string>();
  if (commanderCard) {
    commanderNames.add(commanderCard.name);
    if (commanderCard.name.includes(' // ')) commanderNames.add(commanderCard.name.split(' // ')[0]);
  }
  if (partnerCard) {
    commanderNames.add(partnerCard.name);
    if (partnerCard.name.includes(' // ')) commanderNames.add(partnerCard.name.split(' // ')[0]);
  }

  detected.sort((a, b) => {
    if (a.isComplete !== b.isComplete) return a.isComplete ? -1 : 1;
    const aHasCommander = a.cards.some(n => commanderNames.has(n));
    const bHasCommander = b.cards.some(n => commanderNames.has(n));
    if (aHasCommander !== bHasCommander) return aHasCommander ? -1 : 1;
    return b.deckCount - a.deckCount;
  });

  return detected.length > 0 ? detected : undefined;
}

export function ListDeckView({ list, onBack, onViewAsList }: ListDeckViewProps) {
  const generatedDeck = useStore(s => s.generatedDeck);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [artUrl, setArtUrl] = useState<string | null>(null);
  const [artLoaded, setArtLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function buildAndSetDeck() {
      setLoading(true);
      setError(null);
      setArtUrl(null);
      setArtLoaded(false);

      try {
        const cardMap = await getCardsByNames(list.cards);
        if (cancelled) return;

        const cards: ScryfallCard[] = [];
        for (const name of list.cards) {
          const card = cardMap.get(name);
          if (card) cards.push(card);
        }

        if (cards.length === 0) {
          setError('Could not fetch card data for this list.');
          setLoading(false);
          return;
        }

        // Resolve commander(s) from metadata
        let commanderCard: ScryfallCard | null = null;
        let partnerCard: ScryfallCard | null = null;

        if (list.commanderName) {
          commanderCard = cardMap.get(list.commanderName) ?? null;
        }
        if (list.partnerCommanderName) {
          partnerCard = cardMap.get(list.partnerCommanderName) ?? null;
        }

        // Set commander art background
        setArtUrl(getArtCropUrl(commanderCard));

        // Separate commander(s) from the 99
        const commanderNames = new Set<string>();
        if (commanderCard) commanderNames.add(commanderCard.name);
        if (partnerCard) commanderNames.add(partnerCard.name);

        const deckCards = commanderNames.size > 0
          ? cards.filter(c => !commanderNames.has(c.name))
          : cards;

        const stats = computeStatsFromCards(deckCards);

        // Build name set for combo detection (include DFCs front face)
        const allDeckNames = new Set<string>();
        if (commanderCard) {
          allDeckNames.add(commanderCard.name);
          if (commanderCard.name.includes(' // ')) allDeckNames.add(commanderCard.name.split(' // ')[0]);
        }
        if (partnerCard) {
          allDeckNames.add(partnerCard.name);
          if (partnerCard.name.includes(' // ')) allDeckNames.add(partnerCard.name.split(' // ')[0]);
        }
        for (const c of deckCards) {
          allDeckNames.add(c.name);
          if (c.name.includes(' // ')) allDeckNames.add(c.name.split(' // ')[0]);
        }

        // Fetch combos from EDHREC if we have a commander
        let detectedCombos: DetectedCombo[] | undefined;
        if (commanderCard) {
          try {
            const combos = await fetchCommanderCombos(commanderCard.name);
            if (!cancelled) {
              detectedCombos = detectCombosInDeck(combos, allDeckNames, commanderCard, partnerCard);
            }
          } catch {
            // Combo fetch failed — not critical, continue without combos
          }
        }

        if (cancelled) return;

        // All non-commander cards go in 'synergy' — DeckDisplay flattens all categories anyway
        const categories: Record<DeckCategory, ScryfallCard[]> = {
          lands: [],
          ramp: [],
          cardDraw: [],
          singleRemoval: [],
          boardWipes: [],
          creatures: [],
          synergy: deckCards,
          utility: [],
        };

        const syntheticDeck: GeneratedDeck = {
          commander: commanderCard,
          partnerCommander: partnerCard,
          categories,
          stats,
          detectedCombos,
        };

        // Compute combined color identity from all cards
        const allColors = new Set<string>();
        for (const card of cards) {
          for (const c of card.color_identity || []) {
            allColors.add(c);
          }
        }

        // Set store state atomically — avoid setCommander(null) which resets generatedDeck
        const colorArray = [...allColors];
        useStore.setState({
          commander: commanderCard,
          colorIdentity: colorArray,
          generatedDeck: syntheticDeck,
        });

        // Apply commander color identity theme to borders/outlines
        if (colorArray.length > 0) {
          applyCommanderTheme(colorArray);
        }
      } catch {
        if (!cancelled) {
          setError('Failed to load card data. Please try again.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    buildAndSetDeck();

    return () => {
      cancelled = true;
      useStore.setState({ generatedDeck: null });
      resetTheme();
    };
  }, [list.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) {
    return (
      <div className="space-y-4">
        <button
          onClick={onBack}
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back
        </button>
        <div className="flex items-center justify-center gap-3 py-20">
          <Loader2 className="w-5 h-5 animate-spin text-primary" />
          <span className="text-sm text-muted-foreground">Loading deck view...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-4">
        <button
          onClick={onBack}
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back
        </button>
        <div className="text-center py-16 text-sm text-muted-foreground">{error}</div>
      </div>
    );
  }

  return (
    <>
      {/* Commander art background */}
      {artUrl && (
        <div className="fixed inset-0 z-0 overflow-hidden pointer-events-none">
          <div className={`absolute inset-0 transition-all duration-1000 ${artLoaded ? 'opacity-100' : 'opacity-0'}`}>
            <img
              src={artUrl}
              alt=""
              className="w-full h-[70vh] object-cover object-top blur-md scale-110 transition-all duration-700"
              onLoad={() => setArtLoaded(true)}
            />
          </div>
          <div className="absolute inset-0 bg-gradient-to-b from-transparent via-background/70 to-background" />
          <div className="absolute inset-0 bg-gradient-to-t from-background via-transparent to-background/30" />
          <div className="absolute inset-0 bg-background/15" />
          <div
            className="absolute inset-0"
            style={{ background: 'radial-gradient(ellipse at center top, transparent 0%, hsl(var(--background)) 70%)' }}
          />
        </div>
      )}

      <div className="relative z-10 space-y-4">
        <div className="flex items-center justify-between">
          <button
            onClick={onBack}
            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Back
          </button>
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-bold">{list.name}</h2>
            {onViewAsList && (
              <button
                onClick={onViewAsList}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-border hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
              >
                <List className="w-3.5 h-3.5" />
                View as List
              </button>
            )}
          </div>
        </div>
        <DeckDisplay readOnly />
        {generatedDeck?.detectedCombos && generatedDeck.detectedCombos.length > 0 && (
          <div className="flex gap-6">
            <div className="flex-1">
              <ComboDisplay combos={generatedDeck.detectedCombos} hideMustInclude />
            </div>
            <div className="hidden xl:block w-64 shrink-0" />
          </div>
        )}
      </div>
    </>
  );
}
