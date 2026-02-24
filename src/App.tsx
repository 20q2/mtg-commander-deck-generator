import { useState, useEffect, lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import { HomePage } from '@/pages/HomePage';
import { BuilderPage } from '@/pages/BuilderPage';
import { CollectionPage } from '@/pages/CollectionPage';
import { useStore } from '@/store';
import { useCollection } from '@/hooks/useCollection';
import { trackEvent } from '@/services/analytics';
import type { ScryfallCard } from '@/types';

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
      {/* Art image with blur */}
      <div
        className={`absolute inset-0 transition-all duration-1000 ${
          imageLoaded ? 'opacity-100' : 'opacity-0'
        }`}
      >
        <img
          src={artUrl}
          alt=""
          className={`w-full h-[70vh] object-cover object-top ${blurClass} scale-110 transition-all duration-700`}
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
    </div>
  );
}

// Layout wrapper with header/footer
function Layout({ children }: { children: React.ReactNode }) {
  const { commander, generatedDeck, reset } = useStore();
  const { count: collectionCount } = useCollection();
  const navigate = useNavigate();
  const location = useLocation();
  const isCollectionPage = location.pathname === '/collection';

  // Track page views
  useEffect(() => {
    trackEvent('page_viewed', {
      page: location.pathname.split('/')[1] || 'home',
      path: location.pathname,
    });
  }, [location.pathname]);

  const handleLogoClick = () => {
    reset();
    navigate('/');
  };

  return (
    <div className="min-h-screen bg-background flex flex-col relative">
      {/* Commander Art Background (hidden on collection page) */}
      {!isCollectionPage && <CommanderBackground commander={commander} deckGenerated={!!generatedDeck} />}

      {/* Content wrapper with relative positioning */}
      <div className="relative z-10 flex flex-col min-h-screen">
        {/* Header */}
        <header className="border-b border-border/50 bg-card/70 backdrop-blur-md sticky top-0 z-40">
          <div className="container mx-auto px-4 py-4">
            <div className="flex items-center justify-between">
              <button
                onClick={handleLogoClick}
                className="flex items-center gap-3 hover:opacity-80 transition-opacity text-left"
              >
                <img
                  src={`${import.meta.env.BASE_URL}logo.png`}
                  alt="EDH Deck Builder"
                  className="w-10 h-10 rounded-xl shadow-lg"
                />
                <div>
                  <h1 className="text-xl font-bold">EDH Deck Builder</h1>
                  <p className="text-xs text-muted-foreground">
                    Generate Commander decks instantly
                  </p>
                </div>
              </button>
              <div className="flex items-center gap-3">
                {import.meta.env.DEV && (
                  <button
                    onClick={() => navigate('/metrics')}
                    className="text-xs text-amber-500/80 hover:text-amber-400 transition-colors px-2 py-1 rounded-md hover:bg-accent flex items-center gap-1.5"
                  >
                    Metrics
                  </button>
                )}
                <button
                  onClick={() => navigate('/collection')}
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded-md hover:bg-accent flex items-center gap-1.5"
                >
                  My Collection
                  {collectionCount > 0 && (
                    <span className="text-[10px] font-medium bg-primary/20 text-primary px-1.5 py-0.5 rounded-full min-w-[1.25rem] text-center">
                      {collectionCount.toLocaleString()}
                    </span>
                  )}
                </button>
                <span className="text-xs text-muted-foreground/50">v{__APP_VERSION__}</span>
              </div>
            </div>
          </div>
        </header>

        {children}

        {/* Footer */}
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
            </p>
          </div>
        </footer>
      </div>
    </div>
  );
}

function App() {
  return (
    <BrowserRouter basename="/mtg-commander-deck-generator">
      <Routes>
        <Route path="/" element={<Layout><HomePage /></Layout>} />
        <Route path="/build/:commanderName/:partnerName?" element={<Layout><BuilderPage /></Layout>} />
        <Route path="/collection" element={<Layout><CollectionPage /></Layout>} />
        {import.meta.env.DEV && MetricsPage && (
          <Route path="/metrics" element={<Layout><Suspense fallback={null}><MetricsPage /></Suspense></Layout>} />
        )}
      </Routes>
    </BrowserRouter>
  );
}

export default App;
