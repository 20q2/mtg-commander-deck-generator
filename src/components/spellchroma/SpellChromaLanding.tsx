import { useEffect, useMemo, useState } from 'react';
import { useAutoAnimate } from '@formkit/auto-animate/react';
import { ClipboardPaste, Layers, Library, Loader2, Compass, HelpCircle, Shuffle } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { useUserLists } from '@/hooks/useUserLists';
import { getCardsByNames } from '@/services/scryfall/client';
import { ColorIdentity } from '@/components/ui/mtg-icons';
import { loadTagDictionary, allTags } from '@/services/spellchroma/tagIndex';
import { isIgnoredTag } from '@/services/spellchroma/ignoredTags';
import { parseDecklist } from './DeckInput';
import type { ScryfallCard, UserCardList } from '@/types';

type Lane = 'paste' | 'decks' | 'lists';

// How many "jump straight in" chips to show.
const STARTER_TAG_COUNT = 8;

// Confident, common oracle-tag slugs — shown until the full dictionary loads,
// then used as a fallback if the dictionary is unavailable.
const FALLBACK_STARTER_TAGS = ['ramp', 'removal', 'card-advantage', 'counterspell', 'tutor', 'lifegain', 'sacrifice-outlet', 'draw'];

// Fisher–Yates sample — pick `n` random items without mutating the source.
function sampleTags(pool: string[], n: number): string[] {
  const a = [...pool];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, n);
}

const TABS: { key: Lane; label: string; icon: typeof ClipboardPaste }[] = [
  { key: 'paste', label: 'Paste',      icon: ClipboardPaste },
  { key: 'decks', label: 'Your Decks', icon: Layers },
  { key: 'lists', label: 'Your Lists', icon: Library },
];

interface SpellChromaLandingProps {
  onLoad: (cards: ScryfallCard[]) => void;
  onExplore: () => void;
  onStarterTag: (slug: string) => void;
}

export function SpellChromaLanding({ onLoad, onExplore, onStarterTag }: SpellChromaLandingProps) {
  const { lists } = useUserLists();
  const [lane, setLane] = useState<Lane>('paste');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [loadingId, setLoadingId] = useState<string | null>(null);

  // Random starter chips, sampled from the de-noised tag dictionary so each
  // visit can surface something unexpected. `seed` re-rolls on the shuffle
  // button. Falls back to the curated list until the dictionary loads.
  const [dictReady, setDictReady] = useState(() => allTags().length > 0);
  const [seed, setSeed] = useState(0);
  // Starter chips swap with a springy pop when shuffled / when the dictionary loads.
  const [chipsRef] = useAutoAnimate<HTMLDivElement>({ duration: 260, easing: 'cubic-bezier(0.34, 1.5, 0.5, 1)' });
  useEffect(() => { void loadTagDictionary().then(() => setDictReady(true)); }, []);
  const starterTags = useMemo(() => {
    void seed; // re-sample when the shuffle button bumps the seed
    const pool = allTags().map(t => t.s).filter(s => !isIgnoredTag(s));
    return pool.length >= STARTER_TAG_COUNT ? sampleTags(pool, STARTER_TAG_COUNT) : FALLBACK_STARTER_TAGS;
  }, [dictReady, seed]);

  // Decks = commander decks or anything explicitly typed 'deck'. Lists = the rest.
  const decks = useMemo(
    () => lists.filter(l => l.cards.length > 0 && (l.type === 'deck' || !!l.commanderName)).sort((a, b) => b.updatedAt - a.updatedAt),
    [lists],
  );
  const plainLists = useMemo(
    () => lists.filter(l => l.cards.length > 0 && l.type !== 'deck' && !l.commanderName).sort((a, b) => b.updatedAt - a.updatedAt),
    [lists],
  );

  const resolve = async (names: string[], id?: string) => {
    if (names.length === 0) return;
    setBusy(true);
    if (id) setLoadingId(id);
    try {
      const map = await getCardsByNames(names);
      const cards = names.map(n => map.get(n)).filter((c): c is ScryfallCard => !!c);
      if (cards.length > 0) onLoad(cards);
    } finally {
      setBusy(false);
      setLoadingId(null);
    }
  };

  return (
    <main className="relative px-4 py-8">
      <div className="absolute top-4 right-4 z-20">
        <Popover>
          <PopoverTrigger asChild>
            <button className="inline-flex items-center gap-1.5 text-xs text-muted-foreground/80 hover:text-foreground transition-colors px-2.5 py-1 rounded-md hover:bg-accent">
              <HelpCircle className="w-3.5 h-3.5" />
              What is this?
            </button>
          </PopoverTrigger>
          <PopoverContent side="bottom" align="end" className="w-80 p-4 text-xs text-left">
            <p className="font-semibold text-sm text-foreground mb-2">What is SpellChroma?</p>
            <p className="text-muted-foreground leading-relaxed mb-2">
              Find cards by <span className="text-foreground/90">what they do</span> — pick oracle tags
              like <em>ramp</em> or <em>removal</em> (plus a color identity) and browse every
              commander-legal match. Load a deck to see its tags and explore outward.
            </p>
            <p className="text-[11px] text-muted-foreground/80 leading-relaxed">
              Originally a standalone app — now ported in to live inside ManaFoundry.
            </p>
          </PopoverContent>
        </Popover>
      </div>
      <div className="text-center py-6 max-w-2xl mx-auto animate-slide-up" style={{ animationFillMode: 'backwards' }}>
        <img
          src={`${import.meta.env.BASE_URL}spellchroma-logo.png`}
          alt="SpellChroma"
          className="w-24 h-24 mx-auto mb-4 drop-shadow-[0_0_24px_rgba(139,92,246,0.35)]"
        />
        <h2 className="text-4xl font-bold mb-3">
          Card search <span className="gradient-text">simplified</span>
        </h2>
        <p className="text-base text-muted-foreground">
          Load a deck to see its tags — or just start hunting cards by tag.
        </p>
      </div>

      {/* Lane tabs */}
      <div role="tablist" aria-label="Choose how to load a deck" className="flex items-center gap-1.5 justify-center mb-6 animate-slide-up" style={{ animationDelay: '80ms', animationFillMode: 'backwards' }}>
        {TABS.map(tab => {
          const active = lane === tab.key;
          return (
            <button
              key={tab.key}
              role="tab"
              aria-selected={active}
              onClick={() => setLane(tab.key)}
              className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-full transition-all duration-200 border ${
                active
                  ? 'bg-primary/20 text-violet-200 border-primary/50'
                  : 'bg-card/40 border-border/40 text-muted-foreground hover:text-foreground hover:bg-accent/40'
              }`}
            >
              <tab.icon className="w-4 h-4" />
              {tab.label}
            </button>
          );
        })}
        <div className="w-px h-5 bg-border/40 mx-1" aria-hidden />
        <button
          type="button"
          onClick={onExplore}
          className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-full transition-all duration-200 border bg-card/40 border-border/40 text-muted-foreground hover:text-foreground hover:bg-accent/40"
        >
          <Compass className="w-4 h-4" />
          Explore without a deck
        </button>
      </div>

      <div className="max-w-3xl mx-auto rounded-xl border border-border/40 bg-card/30 backdrop-blur-sm p-3 sm:p-6 min-h-[260px] animate-slide-up" style={{ animationDelay: '160ms', animationFillMode: 'backwards' }}>
        {lane === 'paste' && (
          <div className="flex flex-col gap-3">
            <textarea
              value={text}
              onChange={e => setText(e.target.value)}
              rows={8}
              placeholder={'Paste a decklist…\n\n1 Sol Ring\n1 Cultivate\nBeast Within'}
              className="w-full text-sm rounded-md bg-background border border-border/60 p-3 resize-y focus:outline-none focus:ring-1 focus:ring-primary/50"
            />
            <Button className="self-end" disabled={busy || text.trim() === ''} onClick={() => resolve(parseDecklist(text))}>
              {busy ? <><Loader2 className="w-4 h-4 animate-spin mr-1.5" />Loading…</> : 'Load deck'}
            </Button>
          </div>
        )}
        {lane === 'decks' && (
          <PickGrid lists={decks} emptyLabel="No saved decks yet. Paste one, or build a deck and come back." busy={busy} loadingId={loadingId} onPick={l => resolve(l.cards, l.id)} />
        )}
        {lane === 'lists' && (
          <PickGrid lists={plainLists} emptyLabel="No saved lists yet." busy={busy} loadingId={loadingId} onPick={l => resolve(l.cards, l.id)} />
        )}
      </div>

      {/* Starter tags — jump straight into tag-first browsing */}
      <div className="max-w-3xl mx-auto mt-6 text-center animate-slide-up" style={{ animationDelay: '240ms', animationFillMode: 'backwards' }}>
        <div className="flex items-center gap-3 mb-3">
          <div className="flex-1 h-px bg-border/40" />
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            or jump straight in with a tag
            <button
              type="button"
              onClick={() => setSeed(s => s + 1)}
              title="Shuffle tags"
              aria-label="Shuffle tags"
              className="inline-flex items-center justify-center w-5 h-5 rounded-full text-muted-foreground/70 hover:text-violet-200 hover:bg-violet-500/15 transition-colors hover:scale-110 active:scale-95"
            >
              <Shuffle key={seed} className={`w-3 h-3 ${seed > 0 ? 'animate-sc-spin' : ''}`} />
            </button>
          </span>
          <div className="flex-1 h-px bg-border/40" />
        </div>
        <div ref={chipsRef} className="flex flex-wrap justify-center gap-1.5">
          {starterTags.map(slug => (
            <button
              key={slug}
              onClick={() => onStarterTag(slug)}
              className="px-2.5 py-1 rounded-full text-xs bg-violet-500/12 text-violet-200 border border-violet-500/25 hover:bg-violet-500/25 hover:scale-105 transition-[transform,background-color]"
            >
              {slug}
            </button>
          ))}
        </div>
      </div>
    </main>
  );
}

function PickGrid({ lists, emptyLabel, busy, loadingId, onPick }: {
  lists: UserCardList[];
  emptyLabel: string;
  busy: boolean;
  loadingId: string | null;
  onPick: (l: UserCardList) => void;
}) {
  if (lists.length === 0) {
    return <div className="text-center py-12 text-sm text-muted-foreground">{emptyLabel}</div>;
  }
  return (
    <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {lists.map(list => {
        const isLoading = busy && loadingId === list.id;
        return (
          <button
            key={list.id}
            onClick={() => onPick(list)}
            disabled={busy}
            className={`relative overflow-hidden flex items-center gap-3 min-w-0 text-left rounded-lg border border-border/50 bg-card/40 hover:bg-card/70 hover:border-primary/40 transition-colors p-2.5 ${busy && !isLoading ? 'opacity-50' : ''}`}
          >
            {list.cachedCommanderArtUrl && (
              <div className="absolute inset-0 pointer-events-none">
                <img src={list.cachedCommanderArtUrl} alt="" className="w-full h-full object-cover opacity-[0.18]" />
                <div className="absolute inset-0 bg-gradient-to-r from-card/80 via-card/60 to-card/80" />
              </div>
            )}
            <div className="relative flex-1 min-w-0">
              <p className="text-sm font-semibold truncate">{list.name}</p>
              <p className="text-xs text-muted-foreground truncate">{list.commanderName ?? `${list.cards.length} cards`}</p>
              {list.cachedColorIdentity && list.cachedColorIdentity.length > 0 && (
                <div className="mt-1"><ColorIdentity colors={list.cachedColorIdentity} size="sm" /></div>
              )}
            </div>
            {isLoading && <Loader2 className="relative w-4 h-4 animate-spin text-primary shrink-0" />}
          </button>
        );
      })}
    </div>
  );
}
