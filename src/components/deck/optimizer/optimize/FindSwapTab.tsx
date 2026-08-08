import { useState, useCallback, useRef, useEffect } from 'react';
import { Search, ArrowLeftRight, X, Loader2, ZoomIn, ExternalLink, Plus, ChevronRight, CheckCheck } from 'lucide-react';
import type { ScryfallCard } from '@/types';
import type { DeckAnalysis } from '@/services/deckBuilder/deckAnalyzer';
import { autocompleteCardName, getCardByName, getCardImageUrl, getCachedCard, getFrontFaceTypeLine } from '@/services/scryfall/client';
import { getCardRole, type RoleKey } from '@/services/tagger/client';
import { Button } from '@/components/ui/button';
import { ManaText } from '@/components/ui/mtg-icons';

// ---------------------------------------------------------------------------
// Swap-suggestion logic
// ---------------------------------------------------------------------------

const ROLE_LABELS: Record<RoleKey, string> = {
  ramp: 'Ramp',
  removal: 'Removal',
  boardwipe: 'Board Wipe',
  cardDraw: 'Card Draw',
  protection: 'Protection',
};

export interface SwapSuggestion {
  incoming: ScryfallCard;
  cut: ScryfallCard;
  cutReason: string;
  addReason: string;
}

export function suggestCutForCard(
  incoming: ScryfallCard,
  currentCards: ScryfallCard[],
  analysis: DeckAnalysis,
  synergyMap: Record<string, number> | undefined,
  alreadyCutNames: Set<string> = new Set(),
): SwapSuggestion | null {
  const nonLands = currentCards.filter(c => {
    const tl = getFrontFaceTypeLine(c).toLowerCase();
    return !tl.includes('land') && !alreadyCutNames.has(c.name);
  });

  if (nonLands.length === 0) return null;

  const incomingRole = getCardRole(incoming.name) as RoleKey | null;
  const misfitNames = new Set((analysis.misfits ?? []).map(m => m.card.name));
  const synScore = (card: ScryfallCard) => synergyMap?.[card.name] ?? 0;

  // Build ADD reason from deck context
  const buildAddReason = (): string => {
    const parts: string[] = [];
    if (incomingRole) {
      const roleLabel = ROLE_LABELS[incomingRole];
      const deficit = analysis.roleDeficits.find(d => d.role === incomingRole);
      if (deficit && deficit.deficit > 0) {
        parts.push(`Your deck needs ${deficit.deficit} more ${roleLabel.toLowerCase()} piece${deficit.deficit > 1 ? 's' : ''} — ${incoming.name} directly fills that gap.`);
      } else {
        parts.push(`${incoming.name} fills the ${roleLabel} role.`);
      }
    }
    const rec = analysis.recommendations.find(r => r.name === incoming.name);
    if (rec?.inclusion != null && rec.inclusion > 0) {
      parts.push(`Played in ${Math.round(rec.inclusion)}% of similar decks.`);
    }
    parts.push(`Fits your ${analysis.pacingLabel} strategy.`);
    return parts.join(' ');
  };

  const addReason = buildAddReason();

  // 1. Same-role misfits
  if (incomingRole) {
    const sameRoleMisfits = nonLands.filter(c => {
      const role = (c as ScryfallCard & { deckRole?: string }).deckRole ?? getCardRole(c.name);
      return role === incomingRole && misfitNames.has(c.name);
    });
    if (sameRoleMisfits.length > 0) {
      const cut = sameRoleMisfits.sort((a, b) => synScore(a) - synScore(b))[0];
      const misfit = analysis.misfits?.find(r => r.card.name === cut.name);
      const roleLabel = ROLE_LABELS[incomingRole];
      const misfitReason = misfit?.reasons[0]?.label;
      return {
        incoming, cut, addReason,
        cutReason: misfitReason
          ? `${misfitReason} — ${incoming.name} is a stronger ${roleLabel}.`
          : `Both fill the ${roleLabel} role; ${cut.name} scores lower in synergy with your strategy.`,
      };
    }
  }

  // 2. Same-role cards with lowest synergy
  if (incomingRole) {
    const sameRole = nonLands.filter(c => {
      const role = (c as ScryfallCard & { deckRole?: string }).deckRole ?? getCardRole(c.name);
      return role === incomingRole;
    });
    if (sameRole.length > 0) {
      const cut = sameRole.sort((a, b) => synScore(a) - synScore(b))[0];
      const roleLabel = ROLE_LABELS[incomingRole];
      return {
        incoming, cut, addReason,
        cutReason: `Both cards fill the ${roleLabel} role. ${cut.name} has the lowest synergy score (${(synScore(cut) * 100).toFixed(0)}%) among your ${roleLabel.toLowerCase()} pieces, making it the cleanest swap.`,
      };
    }
  }

  // 3. Any misfit with lowest synergy
  const misfits = nonLands.filter(c => misfitNames.has(c.name));
  if (misfits.length > 0) {
    const cut = misfits.sort((a, b) => synScore(a) - synScore(b))[0];
    const misfit = analysis.misfits?.find(r => r.card.name === cut.name);
    const misfitReason = misfit?.reasons[0]?.label;
    return {
      incoming, cut, addReason,
      cutReason: misfitReason
        ? `${misfitReason} — replacing it with ${incoming.name} keeps your deck count stable.`
        : `${cut.name} is already flagged as a cut candidate. Swapping it for ${incoming.name} keeps the deck at 100 cards.`,
    };
  }

  // 4. Lowest synergy non-land
  const cut = nonLands.sort((a, b) => synScore(a) - synScore(b))[0];
  return {
    incoming, cut, addReason,
    cutReason: `${cut.name} has the lowest synergy score (${(synScore(cut) * 100).toFixed(0)}%) in your deck and is the safest card to cut.`,
  };
}

// ---------------------------------------------------------------------------
// UI helpers
// ---------------------------------------------------------------------------

function scryfallImg(name: string, size: 'small' | 'normal') {
  return `https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(name)}&format=image&version=${size}`;
}

function cardImg(card: ScryfallCard, size: 'small' | 'normal'): string {
  const url = getCardImageUrl(card, size);
  return url || scryfallImg(card.name, size);
}

function resolveTypeLine(card: ScryfallCard): string {
  const cached = getCachedCard(card.name);
  const tl = (cached?.card_faces?.[0]?.type_line ?? cached?.type_line ?? card.type_line ?? '');
  return tl.split('—')[0].replace(/Legendary\s+/i, '').trim();
}

function ManaCostDisplay({ card }: { card: ScryfallCard }) {
  const mc = card.mana_cost ?? card.card_faces?.[0]?.mana_cost;
  if (!mc) return null;
  return <ManaText text={mc} className="text-sm leading-none shrink-0" />;
}

// ---------------------------------------------------------------------------
// SwapPairCard — one half of a swap pair
// ---------------------------------------------------------------------------

interface SwapPairCardProps {
  card: ScryfallCard;
  label: string;
  labelColor: string;
  reason: string;
  onPreview?: (name: string) => void;
}

function SwapPairCard({ card, label, labelColor, reason, onPreview }: SwapPairCardProps) {
  const img = cardImg(card, 'normal');
  const typeLine = resolveTypeLine(card);
  const scryfallUrl = `https://scryfall.com/search?q=!%22${encodeURIComponent(card.name)}%22`;

  return (
    <div className="flex gap-3">
      <button
        type="button"
        onClick={() => onPreview?.(card.name)}
        disabled={!onPreview}
        className="group/preview relative shrink-0 w-24 self-start rounded-lg overflow-hidden focus:outline-none disabled:cursor-default"
      >
        <img
          src={img}
          alt={card.name}
          className="w-full aspect-[5/7] rounded-lg shadow-lg transition-transform duration-200 group-hover/preview:scale-[1.02]"
          loading="lazy"
          onError={(e) => { (e.target as HTMLImageElement).src = scryfallImg(card.name, 'normal'); }}
        />
        {onPreview && (
          <span aria-hidden className="absolute inset-0 flex items-center justify-center bg-black/55 opacity-0 group-hover/preview:opacity-100 transition-opacity rounded-lg">
            <ZoomIn className="w-5 h-5 text-white drop-shadow" strokeWidth={2.5} />
          </span>
        )}
      </button>

      <div className="flex-1 min-w-0 flex flex-col gap-1.5">
        <div>
          <span className={`text-[10px] font-bold uppercase tracking-wider ${labelColor}`}>{label}</span>
          <div className="flex items-start gap-1.5 mt-0.5">
            <button
              type="button"
              onClick={() => onPreview?.(card.name)}
              className="text-sm font-semibold text-foreground hover:text-violet-300 transition-colors text-left leading-tight"
            >
              {card.name}
            </button>
            <ManaCostDisplay card={card} />
          </div>
          {typeLine && <p className="text-[11px] text-foreground/55 mt-0.5">{typeLine}</p>}
        </div>
        <p className="text-xs text-foreground/70 leading-snug">{reason}</p>
        <a
          href={scryfallUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="self-start inline-flex items-center gap-1 px-2 py-0.5 rounded border border-border/40 bg-muted/30 text-[11px] text-foreground/60 hover:text-foreground transition-colors"
        >
          <ExternalLink className="w-2.5 h-2.5" /> Scryfall
        </a>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SwapPairRow — one full swap (cut + add)
// ---------------------------------------------------------------------------

interface SwapPairRowProps {
  suggestion: SwapSuggestion;
  index: number;
  onPreview?: (name: string) => void;
  onApply: (remove: string, add: string) => void | Promise<void>;
  applied: boolean;
}

function SwapPairRow({ suggestion, index, onPreview, onApply, applied }: SwapPairRowProps) {
  const [applying, setApplying] = useState(false);

  const handle = useCallback(async () => {
    setApplying(true);
    try { await onApply(suggestion.cut.name, suggestion.incoming.name); }
    finally { setApplying(false); }
  }, [onApply, suggestion]);

  return (
    <div className={`bg-card/60 border rounded-xl p-3 sm:p-4 transition-opacity ${applied ? 'opacity-40 border-border/20' : 'border-border/30'}`}>
      {/* Header row */}
      <div className="flex items-center justify-between mb-3">
        <span className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider">Swap {index + 1}</span>
        <Button
          size="sm"
          onClick={handle}
          disabled={applying || applied}
          className="h-6 px-2.5 text-[11px] gap-1"
        >
          {applied
            ? <><CheckCheck className="w-3 h-3" /> Applied</>
            : applying
            ? <><Loader2 className="w-3 h-3 animate-spin" /> Applying…</>
            : <><ArrowLeftRight className="w-3 h-3" /> Apply</>}
        </Button>
      </div>

      {/* Cut + Add side-by-side */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
        <SwapPairCard
          card={suggestion.cut}
          label="Cut"
          labelColor="text-red-400"
          reason={suggestion.cutReason}
          onPreview={onPreview}
        />
        <SwapPairCard
          card={suggestion.incoming}
          label="Add"
          labelColor="text-emerald-400"
          reason={suggestion.addReason}
          onPreview={onPreview}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export interface FindSwapTabProps {
  currentCards: ScryfallCard[];
  analysis: DeckAnalysis;
  synergyMap?: Record<string, number>;
  onPreviewCard?: (name: string) => void;
  onApply: (remove: string, add: string) => void | Promise<void>;
}

type Phase = 'building' | 'resolving' | 'results';

export function FindSwapTab({ currentCards, analysis, synergyMap, onPreviewCard, onApply }: FindSwapTabProps) {
  // -- search state
  const [query, setQuery] = useState('');
  const [acSuggestions, setAcSuggestions] = useState<string[]>([]);
  const [acOpen, setAcOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // -- list + results state
  const [queued, setQueued] = useState<string[]>([]);
  const [phase, setPhase] = useState<Phase>('building');
  const [resolveError, setResolveError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<SwapSuggestion[]>([]);
  const [appliedSet, setAppliedSet] = useState<Set<number>>(new Set());

  // Autocomplete
  useEffect(() => {
    if (query.trim().length < 2) { setAcSuggestions([]); return; }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        const results = await autocompleteCardName(query.trim());
        setAcSuggestions(results.slice(0, 8));
        setAcOpen(true);
      } catch { setAcSuggestions([]); }
    }, 250);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query]);

  const addToQueue = useCallback((name: string) => {
    if (!queued.includes(name)) setQueued(prev => [...prev, name]);
    setQuery('');
    setAcSuggestions([]);
    setAcOpen(false);
    inputRef.current?.focus();
  }, [queued]);

  const removeFromQueue = useCallback((name: string) => {
    setQueued(prev => prev.filter(n => n !== name));
  }, []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && query.trim().length >= 2) {
      addToQueue(acSuggestions[0] ?? query.trim());
    }
    if (e.key === 'Escape') setAcOpen(false);
  }, [query, acSuggestions, addToQueue]);

  // Resolve all queued cards into suggestions
  const findSwaps = useCallback(async () => {
    if (queued.length === 0) return;
    setPhase('resolving');
    setResolveError(null);
    try {
      const alreadyCut = new Set<string>();
      const results: SwapSuggestion[] = [];
      for (const name of queued) {
        const card = await getCardByName(name, false);
        const suggestion = suggestCutForCard(card, currentCards, analysis, synergyMap, alreadyCut);
        if (suggestion) {
          results.push(suggestion);
          alreadyCut.add(suggestion.cut.name);
        }
      }
      setSuggestions(results);
      setAppliedSet(new Set());
      setPhase('results');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setResolveError(msg);
      setPhase('building');
    }
  }, [queued, currentCards, analysis, synergyMap]);

  const backToList = useCallback(() => {
    setPhase('building');
    setSuggestions([]);
    setAppliedSet(new Set());
  }, []);

  const handleApply = useCallback(async (remove: string, add: string, index: number) => {
    await onApply(remove, add);
    setAppliedSet(prev => new Set([...prev, index]));
  }, [onApply]);

  const applyAll = useCallback(async () => {
    for (let i = 0; i < suggestions.length; i++) {
      if (!appliedSet.has(i)) {
        await onApply(suggestions[i].cut.name, suggestions[i].incoming.name);
        setAppliedSet(prev => new Set([...prev, i]));
      }
    }
  }, [suggestions, appliedSet, onApply]);

  const allApplied = suggestions.length > 0 && appliedSet.size === suggestions.length;

  // ── Phase: resolving ────────────────────────────────────────────────────────
  if (phase === 'resolving') {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3">
        <Loader2 className="w-6 h-6 text-violet-300 animate-spin" />
        <p className="text-sm text-muted-foreground">Analysing {queued.length} card{queued.length > 1 ? 's' : ''}…</p>
      </div>
    );
  }

  // ── Phase: results ──────────────────────────────────────────────────────────
  if (phase === 'results') {
    return (
      <div className="space-y-3">
        {/* Toolbar */}
        <div className="flex items-center gap-2 pb-2 border-b border-border/30">
          <button
            type="button"
            onClick={backToList}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <ChevronRight className="w-3.5 h-3.5 rotate-180" />
            Edit list
          </button>
          <span className="ml-auto text-xs text-muted-foreground/60">{suggestions.length} swap{suggestions.length !== 1 ? 's' : ''}</span>
          {!allApplied && suggestions.length > 1 && (
            <Button size="sm" onClick={applyAll} className="h-7 px-3 text-xs gap-1.5">
              <CheckCheck className="w-3.5 h-3.5" /> Apply All
            </Button>
          )}
        </div>

        {/* Swap pairs */}
        {suggestions.map((s, i) => (
          <SwapPairRow
            key={`${s.incoming.name}-${s.cut.name}`}
            suggestion={s}
            index={i}
            onPreview={onPreviewCard}
            onApply={(remove, add) => handleApply(remove, add, i)}
            applied={appliedSet.has(i)}
          />
        ))}

        {allApplied && (
          <p className="text-center text-xs text-emerald-400/80 py-2">All swaps applied!</p>
        )}
      </div>
    );
  }

  // ── Phase: building ─────────────────────────────────────────────────────────
  return (
    <div className="space-y-3">
      {/* Search input */}
      <div className="relative">
        <div className="relative flex items-center">
          <Search className="absolute left-3 w-4 h-4 text-muted-foreground pointer-events-none" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => { setQuery(e.target.value); setAcOpen(true); }}
            onKeyDown={handleKeyDown}
            onFocus={() => acSuggestions.length > 0 && setAcOpen(true)}
            onBlur={() => setTimeout(() => setAcOpen(false), 150)}
            placeholder="Search for a card to add…"
            className="w-full pl-9 pr-9 py-2 text-sm bg-card/60 border border-border/60 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500/50 focus:border-violet-500/60 placeholder:text-muted-foreground/50"
            autoComplete="off"
            spellCheck={false}
          />
          {query && (
            <button
              type="button"
              onClick={() => { setQuery(''); setAcSuggestions([]); inputRef.current?.focus(); }}
              className="absolute right-3 text-muted-foreground/60 hover:text-foreground transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Autocomplete dropdown */}
        {acOpen && acSuggestions.length > 0 && (
          <div className="absolute top-full left-0 right-0 mt-1 z-50 bg-popover border border-border/60 rounded-lg shadow-xl shadow-black/40 overflow-hidden">
            {acSuggestions.map(name => (
              <button
                key={name}
                type="button"
                onMouseDown={e => { e.preventDefault(); addToQueue(name); }}
                className="w-full text-left px-3 py-2 text-sm hover:bg-accent transition-colors flex items-center gap-2"
              >
                <Plus className="w-3.5 h-3.5 text-violet-300/60 shrink-0" />
                {name}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Error */}
      {resolveError && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2 text-sm text-red-300">
          {resolveError}
        </div>
      )}

      {/* Queue */}
      {queued.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-14 text-center gap-3">
          <div className="w-10 h-10 rounded-full bg-violet-500/10 border border-violet-500/20 flex items-center justify-center">
            <ArrowLeftRight className="w-4 h-4 text-violet-300/60" />
          </div>
          <div>
            <p className="text-sm font-medium text-foreground/80">Add cards above</p>
            <p className="text-xs text-muted-foreground/70 mt-1 max-w-xs">
              Build a list of cards you want to add — then click "Find Swaps" to get cut recommendations for all of them at once.
            </p>
          </div>
        </div>
      ) : (
        <>
          <div className="space-y-1.5">
            {queued.map(name => (
              <div key={name} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-card/50 border border-border/30 text-sm">
                <span className="flex-1 truncate">{name}</span>
                <button
                  type="button"
                  onClick={() => removeFromQueue(name)}
                  className="text-muted-foreground/50 hover:text-foreground transition-colors shrink-0"
                  aria-label={`Remove ${name}`}
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>

          <Button
            onClick={findSwaps}
            className="w-full gap-2"
          >
            <ArrowLeftRight className="w-4 h-4" />
            Find Swaps for {queued.length} card{queued.length > 1 ? 's' : ''}
          </Button>
        </>
      )}
    </div>
  );
}
