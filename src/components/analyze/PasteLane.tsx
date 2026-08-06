import { useState, useCallback, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CollectionImporter } from '@/components/collection/CollectionImporter';
import { searchCommanders, getCardImageUrl, getCardByName } from '@/services/scryfall/client';
import { CardTypeIcon } from '@/components/ui/mtg-icons';
import type { ScryfallCard } from '@/types';

export interface PasteLaneResult {
  cardNames: string[];
  commanderName: string;
  partnerCommanderName?: string;
}

interface PasteLaneProps {
  onAnalyze: (result: PasteLaneResult) => void;
  loading: boolean;
  /** Prefill from `/analyze?c=`. */
  initialText?: string;
  /** From `?commander=` — wins over *CMDR* / auto-detect. */
  initialCommander?: string;
  /** After import, call onAnalyze once if a commander is resolved. */
  autoAnalyze?: boolean;
}

function namesMatch(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

export function PasteLane({ onAnalyze, loading, initialText, initialCommander, autoAnalyze }: PasteLaneProps) {
  const [importedCards, setImportedCards] = useState<string[]>([]);
  const [legendaries, setLegendaries] = useState<ScryfallCard[]>([]);
  const [commanderCard, setCommanderCard] = useState<ScryfallCard | null>(null);
  const [fallbackQuery, setFallbackQuery] = useState('');
  const [fallbackResults, setFallbackResults] = useState<ScryfallCard[]>([]);
  const [fallbackSearching, setFallbackSearching] = useState(false);
  const [hoverPreview, setHoverPreview] = useState<{ card: ScryfallCard; top: number; left: number; below: boolean } | null>(null);

  // CollectionImporter fires onLegendariesDetected, then auto-picks the first
  // legendary via onCommanderDetected. With multiple legendaries (and no *CMDR*
  // / ?commander=) we want the user to pick — legendariesRef tells us that.
  const legendariesRef = useRef<ScryfallCard[]>([]);
  const hasExplicitCommander = !!initialCommander?.trim();
  const autoAnalyzeRanRef = useRef(false);
  const onAnalyzeRef = useRef(onAnalyze);
  onAnalyzeRef.current = onAnalyze;

  const handleImportCards = useCallback((validatedNames: string[]) => {
    setImportedCards(validatedNames);
    return { added: validatedNames.length, updated: 0 };
  }, []);

  const handleCommanderDetected = useCallback((card: ScryfallCard) => {
    if (hasExplicitCommander) return;
    // *CMDR* fires before legendaries are scanned (ref still empty) so it still wins.
    if (legendariesRef.current.length > 1) return;
    setCommanderCard(card);
  }, [hasExplicitCommander]);

  const handleLegendariesDetected = useCallback((found: ScryfallCard[]) => {
    legendariesRef.current = found;
    setLegendaries(found);
  }, []);

  // Resolve ?commander= from the imported legendaries, else Scryfall.
  useEffect(() => {
    const name = initialCommander?.trim();
    if (!name || commanderCard) return;

    const fromList = legendaries.find(c => namesMatch(c.name, name))
      ?? legendariesRef.current.find(c => namesMatch(c.name, name));
    if (fromList) {
      setCommanderCard(fromList);
      return;
    }

    // Wait for the auto-import to finish before a network lookup (avoids racing
    // the importer and briefly showing the "no commander" fallback).
    if (initialText?.trim() && importedCards.length === 0 && legendaries.length === 0) return;

    let cancelled = false;
    getCardByName(name, true)
      .then(card => { if (!cancelled) setCommanderCard(card); })
      .catch(() => { /* leave picker UI */ });
    return () => { cancelled = true; };
  }, [initialCommander, commanderCard, importedCards.length, legendaries, initialText]);

  // Auto-inspect once we have cards + a commander. Ambiguous lists stay on the picker.
  useEffect(() => {
    if (!autoAnalyze || autoAnalyzeRanRef.current || loading) return;
    if (!importedCards.length || !commanderCard) return;
    autoAnalyzeRanRef.current = true;
    const names = importedCards.some(n => namesMatch(n, commanderCard.name))
      ? importedCards
      : [commanderCard.name, ...importedCards];
    onAnalyzeRef.current({ cardNames: names, commanderName: commanderCard.name });
  }, [autoAnalyze, importedCards, commanderCard, loading]);

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

  const handleChipHover = useCallback((card: ScryfallCard, e: React.MouseEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const isDesktop = window.innerWidth >= 768;
    setHoverPreview({
      card,
      top: isDesktop ? rect.bottom + 8 : rect.top - 8,
      left: rect.left + rect.width / 2,
      below: isDesktop,
    });
  }, []);

  const renderCommanderChip = useCallback((card: ScryfallCard, onClick: () => void) => (
    <button
      key={card.name}
      onClick={onClick}
      onMouseEnter={(e) => handleChipHover(card, e)}
      onMouseLeave={() => setHoverPreview(null)}
      className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border border-border/50 hover:bg-accent hover:border-primary/50 transition-colors"
    >
      <CardTypeIcon type="commander" size="sm" className="text-amber-300/90 opacity-90" />
      {card.name}
    </button>
  ), [handleChipHover]);

  const showLegendaryPicker = legendaries.length > 1 && !commanderCard;
  const showFallback = importedCards.length > 0 && legendaries.length === 0 && !commanderCard;
  const canAnalyze = importedCards.length > 0 && commanderCard !== null && !loading;

  return (
    <div className="space-y-4">
      <CollectionImporter
        label="Decklist"
        textareaClassName="min-h-[180px]"
        onImportCards={handleImportCards}
        onCommanderDetected={handleCommanderDetected}
        onLegendariesDetected={handleLegendariesDetected}
        initialText={initialText}
        autoImport={!!initialText?.trim()}
      />

      {showLegendaryPicker && (
        <div className="rounded-lg border border-border/40 bg-card/30 p-3">
          <p className="text-xs text-muted-foreground mb-2">
            Multiple legendary creatures detected — pick the commander:
          </p>
          <div className="flex flex-wrap gap-2">
            {legendaries.map(card => renderCommanderChip(card, () => setCommanderCard(card)))}
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
              {fallbackResults.map(c => renderCommanderChip(c, () => setCommanderCard(c)))}
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
            const names = importedCards.some(n => namesMatch(n, commanderCard.name))
              ? importedCards
              : [commanderCard.name, ...importedCards];
            onAnalyze({ cardNames: names, commanderName: commanderCard.name });
          }}
          disabled={!canAnalyze}
          className="btn-shimmer"
          title={!commanderCard ? 'Pick a commander to inspect this list' : 'Inspect this deck'}
        >
          {loading ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Inspecting…
            </>
          ) : (
            <>Inspect →</>
          )}
        </Button>
      </div>

      {hoverPreview && createPortal(
        <div
          className="pointer-events-none fixed z-[110] animate-fade-in"
          style={{
            top: hoverPreview.top,
            left: hoverPreview.left,
            transform: hoverPreview.below ? 'translate(-50%, 0)' : 'translate(-50%, -100%)',
          }}
        >
          <img
            src={getCardImageUrl(hoverPreview.card, 'normal')}
            alt={hoverPreview.card.name}
            className="w-48 rounded-lg shadow-2xl border border-white/10"
          />
        </div>,
        document.body
      )}
    </div>
  );
}
