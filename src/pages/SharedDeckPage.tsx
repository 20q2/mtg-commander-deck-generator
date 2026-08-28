import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bookmark, Loader2 } from 'lucide-react';
import { InspectorIcon } from '@/components/analyze/InspectorIcon';
import { Button } from '@/components/ui/button';
import { ListDeckView } from '@/components/lists/ListDeckView';
import { useUserLists } from '@/hooks/useUserLists';
import { usePageTitle } from '@/hooks/usePageTitle';
import { readDeckHash, decodeDeckPayload, shareLinkErrorMessage, type SharedDeckPayload } from '@/services/share/deckLink';
import { trackEvent } from '@/services/analytics';
import type { UserCardList } from '@/types';

/**
 * Reserved list id for the shared-deck preview. Saved decks are `list-<timestamp>`,
 * so this can never collide with one.
 *
 * The enrichment cache is primary-keyed on list id, so every shared deck reuses this
 * one row — but a read is only trusted after `cacheMatchesCommander` + `cacheMatchesContent`
 * pass, so the worst a collision costs is a rebuild, never another deck's cards.
 */
const SHARED_LIST_ID = '__shared';

/**
 * Read-only landing for `#d=` share links: `/decks/shared#d=<payload>`.
 *
 * The recipient sees the actual deck rather than a form to fill in. Nothing is written
 * to storage until they choose to save, which is what keeps this a preview — see
 * `docs/share-links.md` for the payload format and the other two consumers.
 */
export function SharedDeckPage() {
  const navigate = useNavigate();
  const { createList } = useUserLists();

  // Read at first render, not in the effect: deferring it would paint the "no link"
  // empty state for a frame before the loader, which reads as the link having failed.
  const [sharedHash, setSharedHash] = useState(() => readDeckHash(window.location.hash));
  const [payload, setPayload] = useState<SharedDeckPayload | null>(null);
  const [shareError, setShareError] = useState<string | null>(null);
  const loadedShareHash = useRef<string | null>(null);

  // Opening a second share link while already on this page changes only the fragment.
  // The browser treats that as a same-document navigation — no reload, no remount — and
  // React Router's location doesn't update for an address-bar hash edit either, so
  // without this the page would keep showing the first deck. Nothing in the app
  // navigates between two /decks/shared URLs, so the `hashchange` event covers it.
  useEffect(() => {
    const sync = () => setSharedHash(readDeckHash(window.location.hash));
    window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync);
  }, []);

  usePageTitle(payload?.commanderName ? [payload.commanderName, 'Shared deck'] : 'Shared deck');

  useEffect(() => {
    if (!sharedHash || loadedShareHash.current === sharedHash) return;
    // Ref-guarded rather than cancelled on cleanup: StrictMode mounts effects twice,
    // and cancelling would throw away the only real attempt.
    loadedShareHash.current = sharedHash;
    // Drop the previous deck so a newly-arrived link shows the loader rather than the
    // deck it is replacing.
    setPayload(null);
    setShareError(null);
    decodeDeckPayload(sharedHash)
      .then(decoded => {
        setPayload(decoded);
        trackEvent('shared_deck_opened', {
          cardCount: decoded.cardNames.length,
          hasCommander: !!decoded.commanderName,
        });
      })
      .catch(e => {
        console.error('[SharedDeckPage] shared-link decode failed', e);
        setShareError(shareLinkErrorMessage(e, 'Could not load this deck. Check the card names and try again.'));
      });
  }, [sharedHash]);

  /** The payload as a deck ListDeckView can render. Never persisted — saving goes
   *  through createList below, which mints a real id. */
  const sharedList = useMemo<UserCardList | null>(() => {
    if (!payload) return null;
    return {
      id: SHARED_LIST_ID,
      type: 'deck',
      name: payload.commanderName ?? 'Shared deck',
      description: '',
      cards: payload.cardNames,
      commanderName: payload.commanderName,
      partnerCommanderName: payload.partnerCommanderName,
      deckSize: payload.cardNames.length,
      createdAt: 0,
      updatedAt: 0,
    };
  }, [payload]);

  const handleSave = useCallback(() => {
    if (!payload) return;
    const today = new Date().toISOString().slice(0, 10);
    const name = `${payload.commanderName ?? 'Untitled'} — Shared ${today}`;
    const newList = createList(name, payload.cardNames, '', {
      type: 'deck',
      commanderName: payload.commanderName,
      partnerCommanderName: payload.partnerCommanderName,
      deckSize: payload.cardNames.length,
    });
    trackEvent('shared_deck_saved', { cardCount: payload.cardNames.length });
    // Replace: Back should leave for wherever the link was clicked, not return to the
    // fragment URL and re-hydrate a preview of the deck they just saved.
    navigate(`/decks/${newList.id}`, { replace: true });
  }, [payload, createList, navigate]);

  // Hand the Inspector the same fragment verbatim rather than re-encoding the payload.
  const handleOpenInInspector = useCallback(() => {
    navigate(`/analyze/overview${window.location.hash}`);
  }, [navigate]);

  // ── No link ──
  if (!sharedHash) {
    return (
      <main className="flex-1 container mx-auto px-4 py-16 max-w-lg text-center">
        <div className="aurora-bg" />
        {/* relative z-10 for the same reason as the banner below — .aurora-bg is positioned
            and would otherwise paint over this static content. */}
        <div className="relative z-10">
          <h1 className="text-xl font-semibold mb-2">No deck in this link</h1>
          <p className="text-sm text-muted-foreground mb-6">
            A shared deck link carries the whole decklist after the <code className="text-foreground/80">#</code>.
            This one arrived without it.
          </p>
          <Button variant="outline" onClick={() => navigate('/decks')}>Go to My Decks</Button>
        </div>
      </main>
    );
  }

  // ── Damaged link ──
  if (shareError) {
    return (
      <main className="flex-1 container mx-auto px-4 py-16 max-w-lg text-center">
        <div className="aurora-bg" />
        <div className="relative z-10">
          <h1 className="text-xl font-semibold mb-2">Couldn't open this deck</h1>
          <p className="text-sm text-red-400 mb-6">{shareError}</p>
          <Button variant="outline" onClick={() => navigate('/decks')}>Go to My Decks</Button>
        </div>
      </main>
    );
  }

  // ── Decoding ──
  if (!sharedList) {
    return (
      <main className="flex-1 flex items-center justify-center px-4 py-16">
        <div className="flex flex-col items-center gap-4 text-center animate-fade-in">
          <Loader2 className="h-10 w-10 text-violet-300/80 animate-spin" />
          <div className="text-base font-medium">Loading shared deck…</div>
        </div>
      </main>
    );
  }

  // ── The deck ──
  return (
    <main className="flex-1 container mx-auto px-4 py-8">
      <div className="aurora-bg" />

      {/* `relative z-10` is load-bearing: .aurora-bg is fixed/inset-0 with z-index 0, and a
          positioned element paints above static siblings regardless of DOM order. Without
          this the aurora's 1.5s fade-in washes straight over the banner — which reads as the
          banner fading out just as the deck arrives. The deck below is unaffected only
          because ListDeckView's own containers are already positioned. */}
      <div className="relative z-10 mb-4 flex flex-wrap items-center gap-3 px-3 py-2.5 rounded-lg border border-violet-500/30 bg-violet-500/5">
        <span className="text-sm text-foreground/80">
          You're viewing a shared deck — it isn't saved to your decks yet.
        </span>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleOpenInInspector} className="gap-1.5">
            <InspectorIcon className="w-4 h-4" />
            <span className="hidden sm:inline">Inspect</span>
          </Button>
          <Button size="sm" onClick={handleSave} className="gap-1.5">
            <Bookmark className="w-4 h-4" />
            Save to My Decks
          </Button>
        </div>
      </div>

      {/* Every mutation callback is deliberately omitted: ListDeckView gates each edit
          affordance on its verb existing, so the preview is read-only by construction.
          `unsaved` additionally hides the tools that navigate by a saved list id.
          Keyed on the payload so a second share link remounts instead of showing stale cards. */}
      <ListDeckView
        key={sharedHash}
        list={sharedList}
        unsaved
        onBack={() => navigate('/decks')}
      />
    </main>
  );
}
