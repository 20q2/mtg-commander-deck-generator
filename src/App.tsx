import { useState, useEffect, useRef, useCallback, lazy, Suspense } from 'react';
import { createPortal } from 'react-dom';
import { BrowserRouter, Routes, Route, useLocation, Link } from 'react-router-dom';
import { Settings, Sparkles, Wand2, ListChecks, Library, BarChart3, Microscope, MessageSquare } from 'lucide-react';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import patchNotes from '@/data/patchNotes.json';
import { HomePage } from '@/pages/HomePage';
import { BuilderPage } from '@/pages/BuilderPage';
import { OptimizePage } from '@/pages/OptimizePage';
import { AnalyzePage } from '@/pages/AnalyzePage';
import { BrewPage } from '@/pages/BrewPage';
import { BrewLandingPage } from '@/pages/BrewLandingPage';
import { SpellChromaPage } from '@/pages/SpellChromaPage';
import { CollectionPage } from '@/pages/CollectionPage';
import { ListsPage } from '@/pages/ListsPage';
import { MigratePage } from '@/pages/MigratePage';
import { PlaytestPage } from '@/pages/PlaytestPage';
import { PlaytestLandingPage } from '@/pages/PlaytestLandingPage';
import { CommunityPollPage } from '@/pages/CommunityPollPage';
import { useStore } from '@/store';
import { useCollection } from '@/hooks/useCollection';
import { loadUserLists } from '@/hooks/useUserLists';
import { trackEvent } from '@/services/analytics';
import { getBanList } from '@/services/scryfall/client';
import { AuroraThemed } from '@/components/ui/AuroraThemed';
import { BrewBackdrop } from '@/components/brew/BrewBackdrop';
import { PollNudge } from '@/components/ui/PollNudge';
import { getAuroraColors } from '@/lib/commanderTheme';
import type { ScryfallCard } from '@/types';

// Aurora palette + horizontal parallax for the four "hub" routes. AuroraThemed
// lives in Layout so a single instance persists across these navigations and
// animates the color swap; rendering it per-page would cut rather than
// transition. Detail views (e.g. /lists/:id) own their own AuroraThemed
// driven by the list's color identity, so we skip the layout aurora there.
//
// `shift` is the wrapper's translateX applied via a transformed containing
// block — the aurora-bg blobs glide left/right as you move between hubs,
// so Home → Decks → Lists feels like one continuous sweep.
type HubAurora = { identity: string[]; shift: string };

function getLayoutAurora(pathname: string): HubAurora | null {
  if (pathname === '/')                                       return { identity: [],    shift: '12vw'  };
  if (pathname === '/decks' || pathname === '/decks/')        return { identity: ['U'], shift: '0'     };
  if (pathname === '/lists' || pathname === '/lists/')        return { identity: ['G'], shift: '-12vw' };
  if (pathname === '/migrate')                                return { identity: [],    shift: '0'     };
  return null;
}

// Lazy-load MetricsPage — only imported in dev, completely excluded from prod bundle
const MetricsPage = import.meta.env.DEV
  ? lazy(() => import('@/pages/MetricsPage').then(m => ({ default: m.MetricsPage })))
  : null;

// Get art crop URL for background
function getArtCropUrl(card: ScryfallCard | null): string | null {
  if (!card) return null;

  if (card.image_uris?.art_crop) {
    return card.image_uris.art_crop;
  }

  // Double-faced card - use front face
  if (card.card_faces?.[0]?.image_uris?.art_crop) {
    return card.card_faces[0].image_uris.art_crop;
  }

  // Fallback to normal image
  if (card.image_uris?.normal) {
    return card.image_uris.normal;
  }

  return null;
}

// Commander artwork background component
function CommanderBackground({ commander, deckGenerated }: { commander: ScryfallCard | null; deckGenerated: boolean }) {
  const [imageLoaded, setImageLoaded] = useState(false);
  const [currentUrl, setCurrentUrl] = useState<string | null>(null);
  const isModifyMode = useStore(s => s.isModifyMode);

  const artUrl = getArtCropUrl(commander);

  useEffect(() => {
    if (artUrl !== currentUrl) {
      setImageLoaded(false);
      setCurrentUrl(artUrl);
    }
  }, [artUrl, currentUrl]);

  if (!artUrl) return null;

  // Use less blur when deck is generated to bring the art more into focus
  const blurClass = deckGenerated ? 'blur-md' : 'blur-xl';

  return (
    <div className="fixed inset-0 z-0 overflow-hidden pointer-events-none">
      {/* Art image with blur — fades out while modify mode is on */}
      <div
        className="absolute inset-0"
        style={{
          opacity: imageLoaded ? (isModifyMode ? 0 : 1) : 0,
          transition: 'opacity 2200ms ease',
        }}
      >
        <img
          src={artUrl}
          alt=""
          className={`w-full h-[70vh] object-cover object-top ${blurClass} scale-110`}
          onLoad={() => setImageLoaded(true)}
        />
      </div>

      {/* Gradient overlays for fade effect */}
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-background/70 to-background" />
      <div className="absolute inset-0 bg-gradient-to-t from-background via-transparent to-background/30" />
      <div className="absolute inset-0 bg-background/15" />

      {/* Vignette effect */}
      <div
        className="absolute inset-0"
        style={{
          background: 'radial-gradient(ellipse at center top, transparent 0%, hsl(var(--background)) 70%)',
        }}
      />

      {/* Blueprint overlay — subtle blue wash + grid, fades in/out with modify mode */}
      <div
        className="absolute inset-0 ease-out"
        style={{
          opacity: isModifyMode ? 1 : 0,
          transition: 'opacity 2200ms ease',
          background:
            'linear-gradient(rgba(56, 109, 183, 0.18), rgba(20, 40, 80, 0.28)),' +
            'repeating-linear-gradient(0deg, transparent 0 17px, rgba(140, 180, 255, 0.08) 17px 18px),' +
            'repeating-linear-gradient(90deg, transparent 0 17px, rgba(140, 180, 255, 0.08) 17px 18px)',
        }}
      />
    </div>
  );
}

// Preferences gear dropdown (currently unused — will be wired into header later)
export function PreferencesDropdown() {
  const [open, setOpen] = useState(false);
  const [showCollectionChecks, setShowCollectionChecks] = useState(
    () => localStorage.getItem('mtg-deck-builder-show-collection-checks') !== 'false'
  );
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: 0, right: 0 });

  const handleOpen = useCallback(() => {
    if (open) { setOpen(false); return; }
    if (btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      setPos({ top: rect.bottom + 8, right: window.innerWidth - rect.right });
    }
    setOpen(true);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handle = (e: MouseEvent) => {
      if (!panelRef.current?.contains(e.target as Node) && !btnRef.current?.contains(e.target as Node))
        setOpen(false);
    };
    window.addEventListener('mousedown', handle);
    return () => window.removeEventListener('mousedown', handle);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handle = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', handle);
    return () => window.removeEventListener('keydown', handle);
  }, [open]);

  const handleToggle = () => {
    const next = !showCollectionChecks;
    setShowCollectionChecks(next);
    localStorage.setItem('mtg-deck-builder-show-collection-checks', String(next));
    window.dispatchEvent(new CustomEvent('prefs-changed', { detail: { showCollectionChecks: next } }));
  };

  return (
    <>
      <button
        ref={btnRef}
        onClick={handleOpen}
        className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded-md hover:bg-accent"
        title="Preferences"
      >
        <Settings className="w-4 h-4" />
      </button>
      {open && createPortal(
        <div
          ref={panelRef}
          className="fixed z-[100] w-64 rounded-lg bg-popover border border-border px-4 py-3 shadow-lg animate-fade-in"
          style={{ top: pos.top, right: pos.right }}
        >
          <div className="text-xs font-semibold text-foreground mb-2">Preferences</div>
          <label className="flex items-center gap-2.5 cursor-pointer text-sm text-foreground/90 hover:text-foreground transition-colors">
            <input
              type="checkbox"
              checked={showCollectionChecks}
              onChange={handleToggle}
              className="w-3.5 h-3.5 rounded border-border accent-primary cursor-pointer"
            />
            Show collection checkmarks
          </label>
          <p className="text-[10px] text-muted-foreground mt-1.5 leading-relaxed">
            Display green checkmarks next to cards you own in deck lists.
          </p>
        </div>,
        document.body
      )}
    </>
  );
}

// Layout wrapper with header/footer
function Layout({ children }: { children: React.ReactNode }) {
  const { commander, generatedDeck, reset } = useStore();
  const { count: collectionCount } = useCollection();
  const allUserLists = loadUserLists();
  const deckCount = allUserLists.filter(l => l.type === 'deck').length;
  const listCount = allUserLists.filter(l => l.type !== 'deck').length;
  const location = useLocation();
  const isCollectionPage = location.pathname === '/collection';
  const isListsPage = location.pathname.startsWith('/lists') || location.pathname.startsWith('/decks');
  const isAnalyzePage = location.pathname.startsWith('/analyze');
  // The bare /analyze route is the selection hub. AnalyzePage keeps a prior
  // generatedDeck in the store across a back-navigation here (to preserve a
  // build session), so we must explicitly suppress the commander-art backdrop
  // on the hub rather than keying off generatedDeck.
  const isAnalyzeHub = location.pathname === '/analyze' || location.pathname === '/analyze/';
  const isCreatePage = location.pathname === '/' || location.pathname.startsWith('/build/') || location.pathname.startsWith('/build-from-deck/') || location.pathname === '/brew' || location.pathname.startsWith('/brew/');
  const isSpellChromaPage = location.pathname === '/spellchroma';

  // True while the one-time Community-Poll nudge is visible — drives a gentle
  // ring on the version button it points at, so the nudge's arrow has a target.
  const [pollNudgeActive, setPollNudgeActive] = useState(false);

  const [eaEnabled, setEaEnabled] = useState(() => localStorage.getItem('ea-features-enabled') === 'true');
  const toggleEaFeatures = useCallback(() => {
    setEaEnabled(prev => {
      const next = !prev;
      localStorage.setItem('ea-features-enabled', String(next));
      window.dispatchEvent(new CustomEvent('ea-features-changed', { detail: { enabled: next } }));
      return next;
    });
  }, []);

  // Track page views
  useEffect(() => {
    trackEvent('page_viewed', {
      page: location.pathname.split('/')[1] || 'home',
      path: location.pathname,
    });
  }, [location.pathname]);

  // Refresh ALL preset ban lists on app load (skip Commander — always applied via EDHREC)
  useEffect(() => {
    const PRESET_FORMATS: Record<string, string> = {
      'brawl-banlist': 'brawl',
      'standardbrawl-banlist': 'standard',
      'pedh-banlist': 'paupercommander',
    };
    const { customization, updateCustomization } = useStore.getState();
    const banLists = customization.banLists || [];
    const toRefresh = banLists.filter(l => l.isPreset && PRESET_FORMATS[l.id]);
    if (toRefresh.length === 0) return;

    Promise.all(
      toRefresh.map(list =>
        getBanList(PRESET_FORMATS[list.id])
          .then(cards => ({ id: list.id, cards }))
          .catch(() => null)
      )
    ).then(results => {
      const { customization: current } = useStore.getState();
      let updated = [...(current.banLists || [])];
      let changed = false;
      for (const result of results) {
        if (!result) continue;
        const idx = updated.findIndex(l => l.id === result.id);
        if (idx !== -1 && (updated[idx].cards.length !== result.cards.length ||
            !result.cards.every(c => updated[idx].cards.includes(c)))) {
          updated[idx] = { ...updated[idx], cards: result.cards };
          changed = true;
        }
      }
      if (changed) updateCustomization({ banLists: updated });
    });
  }, []);

  const isLegacyHost = typeof window !== 'undefined' && (
    window.location.hostname === '20q2.github.io' ||
    window.location.hostname === 'localhost'
  );

  const layoutAurora = getLayoutAurora(location.pathname);

  return (
    <div className="min-h-screen bg-background flex flex-col relative">
      {/* Hub-route aurora — Home / Decks browse / Lists browse / Migrate. A
          single AuroraThemed instance lives here so the color swap animates
          across navigations. The outer wrapper extends past the viewport
          on both sides and applies a translateX so the aurora-bg blobs
          (whose containing block is the transformed wrapper) glide left/
          right as you move between hubs. `aurora-tabbed` pulls the blob
          positions inward to compensate for the wider wrapper. */}
      {layoutAurora !== null && (
        <div
          className="aurora-tabbed fixed z-0 pointer-events-none"
          style={{
            top: 0,
            bottom: 0,
            left: '-25vw',
            right: '-25vw',
            transform: `translateX(${layoutAurora.shift})`,
            transition: 'transform 800ms cubic-bezier(0.4, 0, 0.2, 1)',
          }}
        >
          <AuroraThemed colors={getAuroraColors(layoutAurora.identity)} />
        </div>
      )}
      {/* Commander Art Background (hidden on collection page) */}
      {!isCollectionPage && !isAnalyzeHub && (!isAnalyzePage || !!generatedDeck) && (!isListsPage || !!generatedDeck) && <CommanderBackground commander={commander} deckGenerated={!!generatedDeck} />}

      {/* Brew-reactive aurora — shifts with the game plan (over the commander art, under content). */}
      {location.pathname.startsWith('/brew/') && <BrewBackdrop />}

      {/* Content wrapper with relative positioning */}
      <div className="relative z-10 flex flex-col min-h-screen pb-16 sm:pb-0">
        {isLegacyHost && (
          <div className="bg-amber-500/15 border-b border-amber-500/30 text-amber-100 backdrop-blur-md relative z-50">
            <div className="container mx-auto px-4 py-2 text-sm flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-center">
              <span className="text-amber-200/90">This site has an official page!</span>
              <a
                href={`https://manafoundry.gg${location.pathname}${location.search}${location.hash}`}
                className="font-semibold underline underline-offset-2 hover:text-white transition-colors"
              >
                Continue at manafoundry.gg →
              </a>
              <Link
                to="/migrate"
                className="font-semibold underline underline-offset-2 hover:text-white transition-colors"
              >
                Bring my decks to the new site →
              </Link>
            </div>
          </div>
        )}
        {/* Header */}
        <header className="border-b border-border/50 bg-card/80 backdrop-blur-md sm:sticky sm:top-0 z-40">
          <div className="container mx-auto px-4 py-4">
            <div className="flex items-center justify-between">
              <Link
                to="/"
                onClick={() => reset()}
                className="flex items-center gap-3 hover:opacity-80 transition-opacity text-left"
              >
                <img
                  src={`${import.meta.env.BASE_URL}logo.png`}
                  alt="ManaFoundry - EDH Deck Builder"
                  className="w-10 h-10 rounded-xl shadow-lg"
                />
                <div>
                  <h1 className="text-lg sm:text-xl font-bold">ManaFoundry</h1>
                  <p className="hidden sm:block text-xs text-muted-foreground">
                    Forging smarter Commander decks
                  </p>
                </div>
              </Link>
              <div className="flex items-center gap-3">
                <nav className="hidden sm:flex items-center gap-3">
                  {import.meta.env.DEV && (
                    <Link
                      to="/metrics"
                      className="text-xs text-amber-500/80 hover:text-amber-400 transition-colors px-2 py-1 rounded-md hover:bg-accent flex items-center gap-1.5"
                    >
                      Metrics
                    </Link>
                  )}
                  <Link
                    to="/"
                    onClick={() => reset()}
                    aria-current={isCreatePage ? 'page' : undefined}
                    className={`text-sm transition-colors px-2 py-1 rounded-md flex items-center gap-1.5 ${
                      isCreatePage ? 'text-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-accent'
                    }`}
                  >
                    Foundry
                  </Link>
                  <Link
                    to="/analyze"
                    aria-current={isAnalyzePage ? 'page' : undefined}
                    className={`text-sm transition-colors px-2 py-1 rounded-md flex items-center ${
                      isAnalyzePage ? 'text-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-accent'
                    }`}
                  >
                    <span className="relative inline-block">
                      Inspector
                      <span className="absolute -top-0.5 -right-4 text-[7px] font-medium tracking-wider text-muted-foreground/60 uppercase leading-none">
                        Beta
                      </span>
                    </span>
                  </Link>
                  <Link
                    to="/spellchroma"
                    aria-current={isSpellChromaPage ? 'page' : undefined}
                    className={`text-sm transition-colors px-2 py-1 rounded-md flex items-center gap-1.5 ${
                      isSpellChromaPage ? 'text-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-accent'
                    }`}
                  >
                    SpellChroma
                  </Link>
                  <Link
                    to="/decks"
                    aria-current={location.pathname.startsWith('/decks') ? 'page' : undefined}
                    className={`text-sm transition-colors px-2 py-1 rounded-md flex items-center gap-1.5 ${
                      location.pathname.startsWith('/decks') ? 'text-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-accent'
                    }`}
                  >
                    Decks
                    {deckCount > 0 && (
                      <span className="text-[10px] font-medium bg-primary/20 text-violet-200 px-1.5 py-0.5 rounded-full min-w-[1.25rem] text-center">
                        {deckCount}
                      </span>
                    )}
                  </Link>
                  <Link
                    to="/lists"
                    aria-current={location.pathname.startsWith('/lists') ? 'page' : undefined}
                    className={`text-sm transition-colors px-2 py-1 rounded-md flex items-center gap-1.5 ${
                      location.pathname.startsWith('/lists') ? 'text-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-accent'
                    }`}
                  >
                    Lists
                    {listCount > 0 && (
                      <span className="text-[10px] font-medium bg-primary/20 text-violet-200 px-1.5 py-0.5 rounded-full min-w-[1.25rem] text-center">
                        {listCount}
                      </span>
                    )}
                  </Link>
                  <Link
                    to="/collection"
                    aria-current={location.pathname === '/collection' ? 'page' : undefined}
                    className={`text-sm transition-colors px-2 py-1 rounded-md flex items-center gap-1.5 ${
                      location.pathname === '/collection' ? 'text-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-accent'
                    }`}
                  >
                    My Collection
                    {collectionCount > 0 && (
                      <span className="text-[10px] font-medium bg-primary/20 text-violet-200 px-1.5 py-0.5 rounded-full min-w-[1.25rem] text-center">
                        {collectionCount.toLocaleString()}
                      </span>
                    )}
                  </Link>
                </nav>
                <Popover>
                  <PopoverTrigger asChild>
                    <button
                      data-poll-nudge-anchor=""
                      className={`text-xs transition-colors cursor-pointer px-1.5 py-0.5 rounded-md ${
                        pollNudgeActive
                          ? 'text-violet-300 ring-1 ring-violet-400/60 bg-violet-400/10 animate-pulse'
                          : 'text-muted-foreground/50 hover:text-muted-foreground'
                      }`}
                    >
                      v{__APP_VERSION__}
                    </button>
                  </PopoverTrigger>
                  <PopoverContent side="bottom" align="end" className="w-72 max-h-80 overflow-y-auto p-3 text-xs">
                    {import.meta.env.DEV && (
                      <Link
                        to="/metrics"
                        className="sm:hidden w-full text-left flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-accent transition-colors mb-1 text-amber-500/90"
                      >
                        <BarChart3 className="w-3.5 h-3.5" />
                        <span className="text-sm">Metrics</span>
                      </Link>
                    )}
                    <Link
                      to="/community-poll"
                      className="w-full text-left flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-accent transition-colors mb-1"
                    >
                      <MessageSquare className="w-3.5 h-3.5 text-violet-300/90" />
                      <span className="text-sm">Community Poll</span>
                    </Link>
                    <Link
                      to="/spellchroma"
                      className="w-full text-left flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-accent transition-colors mb-1"
                    >
                      <Sparkles className="w-3.5 h-3.5 text-violet-300/90" />
                      <span className="text-sm">SpellChroma</span>
                    </Link>
                    <button
                      onClick={toggleEaFeatures}
                      className="w-full text-left flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-accent transition-colors mb-2"
                    >
                      <Sparkles className={`w-3.5 h-3.5 ${eaEnabled ? 'text-purple-400' : 'text-muted-foreground'}`} />
                      <span className={`text-sm ${eaEnabled ? 'text-purple-400' : ''}`}>EA Features</span>
                      {eaEnabled && <span className="ml-auto text-[10px] text-purple-400/70 font-medium">ON</span>}
                    </button>
                    <div className="border-t border-border/50 pt-3">
                      <p className="font-semibold text-sm text-foreground mb-2">Patch Notes</p>
                      {patchNotes.map((entry, i) => (
                        <div key={entry.version} className={i > 0 ? 'mt-3 pt-3 border-t border-border/50' : ''}>
                          <p className="font-medium text-foreground/80 mb-1">v{entry.version}</p>
                          <ul className="list-disc list-inside space-y-0.5 text-muted-foreground">
                            {entry.notes.map((note, j) => (
                              <li key={j}>{note}</li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </div>
                  </PopoverContent>
                </Popover>
              </div>
            </div>
          </div>
        </header>

        {/* Grow the page region so the footer is pushed to the bottom on short pages
            (e.g. the brew fork/node) instead of floating mid-screen. Keep this a plain block
            (just flex-1) — making it `flex flex-col` turns page roots into flex items, and a
            `max-w-… mx-auto` root then shrink-wraps to content (its width swaps with content). */}
        <div className="flex-1">
          {children}
        </div>

        {/* Footer — hidden on /analyze once a deck is loaded to give the optimizer more vertical room */}
        {(!isAnalyzePage || !generatedDeck) && (
        <footer className="border-t border-border/50 bg-card/50 backdrop-blur-sm">
          <div className="container mx-auto px-4 py-6 text-center text-sm text-muted-foreground">
            <p>
              Card data from{' '}
              <a
                href="https://scryfall.com"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline"
              >
                Scryfall
              </a>
              {' · '}
              Inspired by{' '}
              <a
                href="https://edhrec.com"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline"
              >
                EDHREC
              </a>
              {' · '}
              <a
                href="https://github.com/20q2/mtg-commander-deck-generator"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline"
              >
                GitHub
              </a>
              {' · '}
              Support me on{' '}
              <a
                href="https://www.patreon.com/c/ShadowMonk598"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline"
              >
                Patreon
              </a>
              {' · '}
              Send{' '}
              <a
                href="https://forms.gle/H3eKtDh52muFm7d56"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline"
              >
                Feedback
              </a>
            </p>
          </div>
        </footer>
        )}
      </div>

      {/* One-time Community-Poll nudge after 5 sessions (portals itself to body) */}
      <PollNudge onVisibilityChange={setPollNudgeActive} />

      {/* Mobile bottom tab bar — portaled to body so it's never trapped in a containing block */}
      {createPortal(
      <nav
        className="sm:hidden fixed bottom-0 inset-x-0 z-50 border-t border-border/50 bg-card/95 backdrop-blur-md"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div className="flex items-stretch justify-around h-16">
          <Link
            to="/"
            onClick={() => { reset(); window.scrollTo(0, 0); }}
            aria-current={isCreatePage ? 'page' : undefined}
            className={`flex-1 flex flex-col items-center justify-center gap-0.5 transition-colors ${
              isCreatePage ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
            }`}
            aria-label="Generate"
          >
            <Wand2 className={`w-5 h-5 ${isCreatePage ? 'text-primary' : ''}`} />
            <span className="text-[10px] font-medium">Generate</span>
          </Link>
          <Link
            to="/analyze"
            onClick={() => window.scrollTo(0, 0)}
            aria-current={isAnalyzePage ? 'page' : undefined}
            className={`flex-1 flex flex-col items-center justify-center gap-0.5 transition-colors ${
              isAnalyzePage ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
            }`}
            aria-label="Inspector"
          >
            <div className="relative">
              <Microscope className={`w-5 h-5 ${isAnalyzePage ? 'text-primary' : ''}`} />
              <span className="absolute -top-0 -right-3.5 text-[6px] font-medium tracking-wider text-muted-foreground/60 uppercase leading-[1.1]">
                Beta
              </span>
            </div>
            <span className="text-[10px] font-medium">Inspector</span>
          </Link>
          <Link
            to="/decks"
            onClick={() => window.scrollTo(0, 0)}
            aria-current={location.pathname.startsWith('/decks') || location.pathname.startsWith('/lists') ? 'page' : undefined}
            className={`flex-1 flex flex-col items-center justify-center gap-0.5 transition-colors relative ${
              location.pathname.startsWith('/decks') || location.pathname.startsWith('/lists') ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
            }`}
            aria-label="Decks"
          >
            <div className="relative">
              <ListChecks className={`w-5 h-5 ${location.pathname.startsWith('/decks') || location.pathname.startsWith('/lists') ? 'text-primary' : ''}`} />
              {deckCount > 0 && (
                <span className="absolute -top-1.5 -right-2 text-[9px] font-semibold bg-primary/90 text-primary-foreground px-1 py-px rounded-full min-w-[1rem] text-center leading-tight">
                  {deckCount}
                </span>
              )}
            </div>
            <span className="text-[10px] font-medium">Decks</span>
          </Link>
          <Link
            to="/collection"
            onClick={() => window.scrollTo(0, 0)}
            aria-current={location.pathname === '/collection' ? 'page' : undefined}
            className={`flex-1 flex flex-col items-center justify-center gap-0.5 transition-colors ${
              location.pathname === '/collection' ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
            }`}
            aria-label="My Collection"
          >
            <div className="relative">
              <Library className={`w-5 h-5 ${location.pathname === '/collection' ? 'text-primary' : ''}`} />
              {collectionCount > 0 && (
                <span className="absolute -top-1.5 -right-2 text-[9px] font-semibold bg-primary/90 text-primary-foreground px-1 py-px rounded-full min-w-[1rem] text-center leading-tight">
                  {collectionCount > 999 ? `${Math.floor(collectionCount / 1000)}k` : collectionCount}
                </span>
              )}
            </div>
            <span className="text-[10px] font-medium">Collection</span>
          </Link>
        </div>
      </nav>,
      document.body
      )}
    </div>
  );
}

function App() {
  return (
    <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '') || undefined}>
      <Routes>
        <Route path="/" element={<Layout><HomePage /></Layout>} />
        <Route path="/build/:commanderName/:partnerName?" element={<Layout><BuilderPage /></Layout>} />
        <Route path="/brew" element={<Layout><BrewLandingPage /></Layout>} />
        <Route path="/brew/:commanderName/:partnerName?" element={<Layout><BrewPage /></Layout>} />
        <Route path="/build-from-deck/:listId" element={<Layout><OptimizePage /></Layout>} />
        <Route path="/analyze" element={<Layout><AnalyzePage /></Layout>} />
        <Route path="/analyze/:param1" element={<Layout><AnalyzePage /></Layout>} />
        <Route path="/analyze/:param1/:param2" element={<Layout><AnalyzePage /></Layout>} />
        <Route path="/spellchroma" element={<Layout><SpellChromaPage /></Layout>} />
        <Route path="/collection" element={<Layout><CollectionPage /></Layout>} />
        <Route path="/decks/*" element={<Layout><ListsPage /></Layout>} />
        <Route path="/lists/*" element={<Layout><ListsPage /></Layout>} />
        <Route path="/migrate" element={<Layout><MigratePage /></Layout>} />
        <Route path="/community-poll" element={<Layout><CommunityPollPage /></Layout>} />
        <Route path="/community-poll/admin" element={<Layout><CommunityPollPage admin /></Layout>} />
        <Route path="/playtest" element={<Layout><PlaytestLandingPage /></Layout>} />
        <Route path="/playtest/list/:listId" element={<PlaytestPage kind="list" />} />
        <Route path="/playtest/generated" element={<PlaytestPage kind="generated" />} />
        {import.meta.env.DEV && MetricsPage && (
          <Route path="/metrics" element={<Layout><Suspense fallback={null}><MetricsPage /></Suspense></Layout>} />
        )}
      </Routes>
    </BrowserRouter>
  );
}

export default App;
