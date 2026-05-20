import { useState, useCallback, useRef, useEffect } from 'react';
import { ArrowLeft, Bookmark, Check, X, ExternalLink, RefreshCw, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ColorIdentity } from '@/components/ui/mtg-icons';
import { useUserLists } from '@/hooks/useUserLists';
import { trackEvent } from '@/services/analytics';
import { getCardImageUrl } from '@/services/scryfall/client';
import type { GeneratedDeck, UserCardList } from '@/types';

export type AnalyzeSource =
  | { kind: 'paste' }
  | { kind: 'list'; listId: string; listName: string }
  | { kind: 'generated' };

interface CommanderStripProps {
  deck: GeneratedDeck;
  colorIdentity: string[];
  source: AnalyzeSource;
  onChangeDeck: () => void;
  onSavedAsList?: (newList: UserCardList) => void;
}

function getCommanderArtUrl(deck: GeneratedDeck): string | null {
  const c = deck.commander;
  if (!c) return null;
  return c.image_uris?.art_crop
    ?? c.card_faces?.[0]?.image_uris?.art_crop
    ?? getCardImageUrl(c, 'normal');
}

export function CommanderStrip({ deck, colorIdentity, source, onChangeDeck, onSavedAsList }: CommanderStripProps) {
  const { createList } = useUserLists();
  const [showSaveInput, setShowSaveInput] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [savedListId, setSavedListId] = useState<string | null>(null);
  const [savedDisplayName, setSavedDisplayName] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Analyzer state mirrored from DeckOptimizer via custom event.
  const [analyzerState, setAnalyzerState] = useState<{ dirty: boolean; loading: boolean; hasAnalysis: boolean }>({
    dirty: false, loading: false, hasAnalysis: false,
  });
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ dirty: boolean; loading: boolean; hasAnalysis: boolean }>).detail;
      if (detail) setAnalyzerState(detail);
    };
    document.addEventListener('deck-optimizer-state', handler);
    return () => document.removeEventListener('deck-optimizer-state', handler);
  }, []);

  const handleReanalyze = useCallback(() => {
    document.dispatchEvent(new CustomEvent('deck-optimizer-reanalyze'));
  }, []);

  const cardCount = (() => {
    let n = deck.commander ? 1 : 0;
    if (deck.partnerCommander) n += 1;
    for (const cards of Object.values(deck.categories)) n += cards.length;
    return n;
  })();

  const handleSaveOpen = useCallback(() => {
    if (savedListId) return;
    const today = new Date().toISOString().slice(0, 10);
    const defaultName = source.kind === 'generated'
      ? `${deck.commander?.name ?? 'Untitled'} — Analyzed ${today}`
      : '';
    setSaveName(defaultName);
    setShowSaveInput(true);
    setTimeout(() => inputRef.current?.select(), 0);
  }, [source.kind, deck.commander, savedListId]);

  const handleSaveCommit = useCallback(() => {
    const name = saveName.trim();
    if (!name) return;
    const cardNames: string[] = [];
    if (deck.commander) cardNames.push(deck.commander.name);
    if (deck.partnerCommander) cardNames.push(deck.partnerCommander.name);
    for (const cards of Object.values(deck.categories)) {
      for (const c of cards) cardNames.push(c.name);
    }
    const newList = createList(name, cardNames, '', {
      type: 'deck',
      commanderName: deck.commander?.name,
      partnerCommanderName: deck.partnerCommander?.name,
      deckSize: cardNames.length,
    });
    setSavedListId(newList.id);
    setSavedDisplayName(name);
    setShowSaveInput(false);
    trackEvent('analyze_deck_saved', { listName: name, cardCount: cardNames.length, source: source.kind });
    onSavedAsList?.(newList);
  }, [saveName, deck, createList, source.kind, onSavedAsList]);

  const sourceLabel = (() => {
    if (savedListId && savedDisplayName) return `From "${savedDisplayName}"`;
    if (source.kind === 'paste') return 'Pasted';
    if (source.kind === 'generated') return 'Generated';
    return `From "${source.listName}"`;
  })();
  const showSaveButton = (source.kind === 'paste' || source.kind === 'generated') && !savedListId;

  const artUrl = getCommanderArtUrl(deck);

  return (
    <div className="mb-2">
      <div className="rounded-xl border border-border/40 bg-card/40 backdrop-blur-sm flex items-center gap-3 p-2.5">
        <div className="w-16 h-16 shrink-0 rounded-lg overflow-hidden bg-muted/30">
          {artUrl && <img src={artUrl} alt={deck.commander?.name ?? ''} className="w-full h-full object-cover" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-semibold truncate">{deck.commander?.name ?? 'No commander'}</p>
            <span className="text-[10px] font-medium uppercase tracking-wider px-1.5 py-0.5 rounded bg-primary/15 text-primary">
              {sourceLabel}
            </span>
          </div>
          <div className="flex items-center gap-2 mt-1">
            <ColorIdentity colors={colorIdentity} size="sm" />
            <span className="text-xs text-muted-foreground">{cardCount} cards</span>
          </div>
          <button
            onClick={onChangeDeck}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1 mt-1"
          >
            <ArrowLeft className="w-3 h-3" />
            Analyze a different deck
          </button>
        </div>
        <div className="flex items-center gap-2">
          {analyzerState.hasAnalysis && (
            <button
              onClick={handleReanalyze}
              disabled={analyzerState.loading}
              title={analyzerState.dirty ? 'Deck has changed since the last analysis — click to refresh' : 'Re-run analysis'}
              className={`flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-lg border transition-colors ${
                analyzerState.dirty
                  ? 'border-amber-500/60 bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 animate-pulse'
                  : 'border-border/50 bg-card/50 hover:bg-accent text-muted-foreground hover:text-foreground'
              } disabled:opacity-60 disabled:pointer-events-none`}
            >
              {analyzerState.loading
                ? <Loader2 className="w-3 h-3 animate-spin" />
                : <RefreshCw className="w-3 h-3" />}
              Re-analyze
            </button>
          )}
          {source.kind === 'list' && !savedListId && (
            <a
              href={`#/lists/${source.listId}/deck-view`}
              className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
              title="Open original list"
            >
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          )}
          {showSaveButton && !showSaveInput && (
            <Button size="sm" variant="outline" onClick={handleSaveOpen}>
              <Bookmark className="w-3.5 h-3.5 mr-1.5" />
              Save to My Lists
            </Button>
          )}
          {savedListId && (
            <span className="text-xs text-emerald-400 inline-flex items-center gap-1">
              <Check className="w-3.5 h-3.5" />
              Saved
            </span>
          )}
          {showSaveInput && (
            <form
              className="flex items-center gap-1.5"
              onSubmit={(e) => { e.preventDefault(); handleSaveCommit(); }}
            >
              <input
                ref={inputRef}
                type="text"
                value={saveName}
                onChange={(e) => setSaveName(e.target.value)}
                placeholder="List name"
                className="bg-card/50 border border-border/50 rounded-md px-2.5 py-1 text-xs w-48 focus:outline-none focus:ring-1 focus:ring-primary/50"
                onKeyDown={(e) => { if (e.key === 'Escape') { setShowSaveInput(false); setSaveName(''); } }}
              />
              <button
                type="submit"
                disabled={!saveName.trim()}
                className="p-1 rounded-md text-emerald-400 hover:bg-accent disabled:opacity-50"
                title="Save"
              >
                <Check className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => { setShowSaveInput(false); setSaveName(''); }}
                className="p-1 rounded-md text-muted-foreground hover:text-red-400 hover:bg-accent"
                title="Cancel"
              >
                <X className="w-4 h-4" />
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
