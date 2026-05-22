import { useState, useCallback, useRef } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CollectionImporter } from '@/components/collection/CollectionImporter';
import { searchCommanders } from '@/services/scryfall/client';
import type { ScryfallCard } from '@/types';

export interface PasteLaneResult {
  cardNames: string[];
  commanderName: string;
  partnerCommanderName?: string;
}

interface PasteLaneProps {
  onAnalyze: (result: PasteLaneResult) => void;
  loading: boolean;
}

export function PasteLane({ onAnalyze, loading }: PasteLaneProps) {
  const [importedCards, setImportedCards] = useState<string[]>([]);
  const [legendaries, setLegendaries] = useState<ScryfallCard[]>([]);
  const [commanderCard, setCommanderCard] = useState<ScryfallCard | null>(null);
  const [fallbackQuery, setFallbackQuery] = useState('');
  const [fallbackResults, setFallbackResults] = useState<ScryfallCard[]>([]);
  const [fallbackSearching, setFallbackSearching] = useState(false);

  // The CollectionImporter fires onLegendariesDetected FIRST, then auto-fires
  // onCommanderDetected with the first legendary. If multiple legendaries were
  // detected (and no `*CMDR*` marker was present) we want the user to pick
  // explicitly — so we use a ref to know about multi-legendary state at the
  // moment onCommanderDetected runs.
  const legendariesRef = useRef<ScryfallCard[]>([]);

  const handleImportCards = useCallback((validatedNames: string[]) => {
    setImportedCards(validatedNames);
    return { added: validatedNames.length, updated: 0 };
  }, []);

  const handleCommanderDetected = useCallback((card: ScryfallCard) => {
    // Suppress the importer's auto-pick when multiple legendaries are present.
    // The *CMDR* marker path still works because the marker fires onCommanderDetected
    // BEFORE legendaries are scanned (so legendariesRef is still empty here).
    if (legendariesRef.current.length > 1) return;
    setCommanderCard(card);
  }, []);

  const handleLegendariesDetected = useCallback((found: ScryfallCard[]) => {
    legendariesRef.current = found;
    setLegendaries(found);
  }, []);

  const runFallbackSearch = useCallback(async (q: string) => {
    setFallbackQuery(q);
    if (q.trim().length < 2) { setFallbackResults([]); return; }
    setFallbackSearching(true);
    try {
      const results = await searchCommanders(q.trim());
      setFallbackResults(results.slice(0, 8));
    } finally {
      setFallbackSearching(false);
    }
  }, []);

  const showLegendaryPicker = legendaries.length > 1 && !commanderCard;
  const showFallback = importedCards.length > 0 && legendaries.length === 0 && !commanderCard;
  const canAnalyze = importedCards.length > 0 && commanderCard !== null && !loading;

  return (
    <div className="space-y-4">
      <CollectionImporter
        label=""
        textareaClassName="min-h-[180px]"
        onImportCards={handleImportCards}
        onCommanderDetected={handleCommanderDetected}
        onLegendariesDetected={handleLegendariesDetected}
      />

      {showLegendaryPicker && (
        <div className="rounded-lg border border-border/40 bg-card/30 p-3">
          <p className="text-xs text-muted-foreground mb-2">
            Multiple legendary creatures detected — pick the commander:
          </p>
          <div className="flex flex-wrap gap-2">
            {legendaries.map(card => (
              <button
                key={card.name}
                onClick={() => setCommanderCard(card)}
                className="text-xs px-2.5 py-1.5 rounded-md border border-border/50 hover:bg-accent hover:border-primary/50 transition-colors"
              >
                {card.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {showFallback && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 space-y-2">
          <p className="text-xs text-amber-400/90">
            We couldn't find a commander in this list — pick one to analyze.
          </p>
          <input
            type="text"
            value={fallbackQuery}
            onChange={(e) => runFallbackSearch(e.target.value)}
            placeholder="Search for a commander…"
            className="w-full bg-card/50 border border-border/50 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
          />
          {fallbackSearching && (
            <p className="text-xs text-muted-foreground flex items-center gap-1.5">
              <Loader2 className="w-3 h-3 animate-spin" />
              Searching…
            </p>
          )}
          {fallbackResults.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {fallbackResults.map(c => (
                <button
                  key={c.name}
                  onClick={() => setCommanderCard(c)}
                  className="text-xs px-2.5 py-1.5 rounded-md border border-border/50 hover:bg-accent hover:border-primary/50 transition-colors"
                >
                  {c.name}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {commanderCard && (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-400/90">
          Commander: <span className="font-semibold text-emerald-300">{commanderCard.name}</span>
        </div>
      )}

      <div className="flex justify-end">
        <Button
          onClick={() => {
            if (!commanderCard) return;
            const names = importedCards.includes(commanderCard.name)
              ? importedCards
              : [commanderCard.name, ...importedCards];
            onAnalyze({ cardNames: names, commanderName: commanderCard.name });
          }}
          disabled={!canAnalyze}
          className="btn-shimmer"
          title={!commanderCard ? 'Pick a commander to check this list' : 'Check this deck'}
        >
          {loading ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Checking…
            </>
          ) : (
            <>Check →</>
          )}
        </Button>
      </div>
    </div>
  );
}
