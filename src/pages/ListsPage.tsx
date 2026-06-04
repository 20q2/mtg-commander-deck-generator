import { useState, useMemo, useEffect, useCallback } from 'react';
import { useNavigate, useParams, useSearchParams, useLocation } from 'react-router-dom';
import { useUserLists } from '@/hooks/useUserLists';
import { useStore } from '@/store';
import { getBanList } from '@/services/scryfall/client';
import { ListCard } from '@/components/lists/ListCard';
import { ListDetailView } from '@/components/lists/ListDetailView';
import { ListDeckView } from '@/components/lists/ListDeckView';
import { ListCreateEditForm } from '@/components/lists/ListCreateEditForm';
import { PRESET_BAN_LISTS } from '@/components/lists/UserListChips';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { ArrowLeft, ChevronLeft, ChevronRight, Plus, Search, X, Grid3X3, List, BookOpen, Shield, Loader2, Info, Pin, Ban } from 'lucide-react';
import { trackEvent } from '@/services/analytics';
import type { BanList, UserCardList } from '@/types';

type SortKey = 'updatedAt' | 'name' | 'size';
type SortDir = 'asc' | 'desc';

// Reserved IDs for pseudo-lists backed by Zustand customization (not useUserLists).
const PSEUDO_MUST_INCLUDE_ID = '__must-include';
const PSEUDO_EXCLUDED_ID = '__excluded';
const PSEUDO_IDS = new Set<string>([PSEUDO_MUST_INCLUDE_ID, PSEUDO_EXCLUDED_ID]);

function buildPseudoList(id: string, cards: string[]): UserCardList {
  const isInclude = id === PSEUDO_MUST_INCLUDE_ID;
  return {
    id,
    name: isInclude ? 'Must Include' : 'Excluded',
    description: isInclude
      ? 'Cards forced into every generated deck.'
      : 'Cards excluded from every generated deck.',
    cards,
    createdAt: 0,
    updatedAt: Date.now(),
  };
}

export function ListsPage() {
  const navigate = useNavigate();
  const { '*': splat } = useParams();
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const { lists, createList, updateList, deleteList, duplicateList, convertToList, exportList, getListById } = useUserLists();

  // Derive `kind` from URL prefix and `view` from remaining segments
  const currentView = useMemo(() => {
    const kind: 'deck' | 'list' = location.pathname.startsWith('/decks') ? 'deck' : 'list';
    const segments = (splat || '').split('/').filter(Boolean);
    if (segments.length === 0) return { view: 'browse' as const, kind };
    if (segments[0] === 'create') return { view: 'create' as const, kind };
    if (segments[0] === 'banlists') {
      // Banlists only exist under /lists; treat as list kind regardless of prefix
      if (segments[1]) return { view: 'banlist-detail' as const, kind: 'list' as const, banListId: segments[1] };
      return { view: 'banlist-browse' as const, kind: 'list' as const };
    }
    // segments[0] is a listId
    const listId = segments[0];
    if (segments[1] === 'edit') return { view: 'edit' as const, kind, listId };
    if (segments[1] === 'deck-view') return { view: 'deck-view' as const, kind, listId };
    // Default: under /decks → deck-view, under /lists → detail
    if (kind === 'deck') return { view: 'deck-view' as const, kind, listId };
    return { view: 'detail' as const, kind, listId };
  }, [splat, location.pathname]);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>(() => (localStorage.getItem('mtg-lists-view-mode') as 'grid' | 'list') || 'grid');
  const setViewModePersisted = useCallback((mode: 'grid' | 'list') => { setViewMode(mode); localStorage.setItem('mtg-lists-view-mode', mode); }, []);
  const [sortKey, setSortKey] = useState<SortKey>('updatedAt');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [searchQuery, setSearchQuery] = useState('');
  const [copiedCount, setCopiedCount] = useState<number | null>(null);

  // Ban lists from store
  const { customization, updateCustomization } = useStore();
  const banLists = customization.banLists || [];
  const [banListsLoading, setBanListsLoading] = useState(false);

  // Auto-fetch all preset ban lists on mount (always refresh for latest data)
  useEffect(() => {
    setBanListsLoading(true);
    Promise.all(
      PRESET_BAN_LISTS.map(preset =>
        getBanList(preset.scryfallFormat)
          .then(cards => ({ id: preset.id, name: preset.name, cards, isPreset: true, enabled: false } as BanList))
          .catch(() => null)
      )
    ).then(results => {
      const { customization: current } = useStore.getState();
      const updated = [...(current.banLists || [])];
      for (const result of results) {
        if (!result || result.cards.length === 0) continue;
        const idx = updated.findIndex(l => l.id === result.id);
        if (idx !== -1) {
          updated[idx] = { ...updated[idx], cards: result.cards, name: result.name };
        } else {
          updated.push(result);
        }
      }
      updateCustomization({ banLists: updated });
    }).finally(() => setBanListsLoading(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const populatedBanLists = banLists.filter(l => l.isPreset && l.cards.length > 0);

  const filteredAndSortedLists = useMemo(() => {
    let filtered = currentView.kind === 'deck'
      ? lists.filter(l => l.type === 'deck')
      : lists.filter(l => l.type !== 'deck');
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(l =>
        l.name.toLowerCase().includes(q) ||
        l.description.toLowerCase().includes(q) ||
        l.cards.some(c => c.toLowerCase().includes(q))
      );
    }
    return [...filtered].sort((a, b) => {
      let cmp = 0;
      if (sortKey === 'name') cmp = a.name.localeCompare(b.name);
      else if (sortKey === 'size') cmp = a.cards.length - b.cards.length;
      else cmp = a.updatedAt - b.updatedAt;
      return sortDir === 'desc' ? -cmp : cmp;
    });
  }, [lists, searchQuery, currentView.kind, sortKey, sortDir]);

  const matchingCardsMap = useMemo(() => {
    const map: Record<string, string[]> = {};
    const q = searchQuery.trim().toLowerCase();
    if (!q) return map;
    for (const list of filteredAndSortedLists) {
      const matches = list.cards.filter(c => c.toLowerCase().includes(q));
      if (matches.length > 0) map[list.id] = matches;
    }
    return map;
  }, [filteredAndSortedLists, searchQuery]);

  const handleExport = (listId: string) => {
    const list = lists.find(l => l.id === listId);
    const text = exportList(listId);
    if (text) {
      const count = text.split('\n').filter(l => l.trim()).length;
      navigator.clipboard.writeText(text).then(() => {
        setCopiedCount(count);
        setTimeout(() => setCopiedCount(null), 2000);
      });
      if (list) trackEvent('list_exported', { listName: list.name, cardCount: count });
    }
  };

  const handleDelete = (listId: string) => {
    const list = lists.find(l => l.id === listId);
    if (list) trackEvent('list_deleted', { listName: list.name, cardCount: list.cards.length });
    const wasDeck = list?.type === 'deck';
    deleteList(listId);
    if (
      (currentView.view === 'detail' || currentView.view === 'deck-view') &&
      currentView.listId === listId
    ) {
      navigate(wasDeck ? '/decks' : '/lists', { replace: true });
    }
  };

  const handleRemoveCard = (listId: string, cardName: string) => {
    const list = lists.find(l => l.id === listId);
    if (list) {
      updateList(listId, { cards: list.cards.filter(c => c !== cardName) });
    }
  };

  // Global toasts (rendered in all views)
  const toasts = (
    <>
      {copiedCount !== null && (
        <div className="fixed bottom-6 right-6 z-50 px-4 py-2 bg-emerald-500/90 text-white text-sm rounded-lg shadow-lg animate-fade-in">
          Copied {copiedCount} cards to clipboard!
        </div>
      )}
    </>
  );

  // Redirect invalid IDs, legacy URLs, and kind mismatches.
  useEffect(() => {
    // Legacy: /lists/:id/deck-view → /decks/:id
    if (
      currentView.view === 'deck-view' &&
      currentView.kind === 'list' &&
      currentView.listId
    ) {
      navigate(`/decks/${currentView.listId}`, { replace: true });
      return;
    }

    // Legacy: /lists/create?type=deck → /decks/create
    if (currentView.view === 'create' && currentView.kind === 'list' && searchParams.get('type') === 'deck') {
      navigate('/decks/create', { replace: true });
      return;
    }

    // Legacy: /lists/create?type=list → /lists/create (strip the query)
    if (currentView.view === 'create' && currentView.kind === 'list' && searchParams.get('type') === 'list') {
      navigate('/lists/create', { replace: true });
      return;
    }

    // Invalid list ID (skip pseudo-list IDs; they don't live in `lists`)
    if (
      (currentView.view === 'detail' ||
        currentView.view === 'edit' ||
        currentView.view === 'deck-view') &&
      currentView.listId &&
      !PSEUDO_IDS.has(currentView.listId)
    ) {
      const list = lists.find(l => l.id === currentView.listId);
      if (!list) {
        navigate(currentView.kind === 'deck' ? '/decks' : '/lists', { replace: true });
        return;
      }
      // Kind mismatch: /decks/:id where the list isn't a deck → /lists/:id
      // (We intentionally do NOT redirect the reverse direction — `/lists/:id` for a deck
      // is the "view as list" feature on ListDeckView.)
      if (currentView.kind === 'deck' && list.type !== 'deck') {
        const tail = currentView.view === 'edit' ? '/edit' : '';
        navigate(`/lists/${list.id}${tail}`, { replace: true });
        return;
      }
    }

    // Invalid banlist ID
    if (currentView.view === 'banlist-detail') {
      if (!banLists.find(l => l.id === currentView.banListId && l.cards.length > 0)) {
        navigate('/lists/banlists', { replace: true });
      }
    }
  }, [currentView, lists, banLists, navigate, searchParams]);

  // Pseudo-list detail view (Must Include / Excluded — backed by Zustand customization)
  if (currentView.view === 'detail' && currentView.listId && PSEUDO_IDS.has(currentView.listId)) {
    const pseudoId = currentView.listId;
    const sourceCards = pseudoId === PSEUDO_MUST_INCLUDE_ID
      ? (customization.mustIncludeCards || [])
      : (customization.bannedCards || []);
    const list = buildPseudoList(pseudoId, sourceCards);
    const updateCards = (next: string[]) => {
      if (pseudoId === PSEUDO_MUST_INCLUDE_ID) {
        updateCustomization({ mustIncludeCards: next });
      } else {
        updateCustomization({ bannedCards: next });
      }
    };
    return (
      <main className="flex-1 container mx-auto px-4 py-8 max-w-5xl">
        <div className="aurora-bg" />
        {toasts}
        <ListDetailView
          list={list}
          onBack={() => navigate('/lists')}
          onExport={() => {
            const text = sourceCards.map(c => `1 ${c}`).join('\n');
            navigator.clipboard.writeText(text).then(() => {
              setCopiedCount(sourceCards.length);
              setTimeout(() => setCopiedCount(null), 2000);
            });
          }}
          onRemoveCard={(name) => updateCards(sourceCards.filter(c => c !== name))}
          onSwapCard={(oldName, newName) => {
            if (sourceCards.includes(newName)) {
              updateCards(sourceCards.filter(c => c !== oldName));
            } else {
              updateCards(sourceCards.map(c => c === oldName ? newName : c));
            }
          }}
        />
      </main>
    );
  }

  // Detail view
  if (currentView.view === 'detail') {
    const list = lists.find(l => l.id === currentView.listId);
    if (!list) return null; // useEffect will redirect
    return (
      <main className="flex-1 container mx-auto px-4 py-8 max-w-5xl">
        <div className="aurora-bg" />
        {toasts}
        <ListDetailView
          list={list}
          onBack={() => navigate('/lists')}
          onEdit={() => navigate(`/lists/${list.id}/edit`)}
          onDuplicate={() => { duplicateList(list.id); navigate(list.type === 'deck' ? '/decks' : '/lists'); }}
          onExport={() => handleExport(list.id)}
          onDelete={() => handleDelete(list.id)}
          onRemoveCard={(name) => handleRemoveCard(list.id, name)}
          onSwapCard={(oldName, newName) => {
            const current = lists.find(l => l.id === list.id);
            if (!current) return;
            if (current.cards.includes(newName)) {
              updateList(list.id, { cards: current.cards.filter(c => c !== oldName) });
            } else {
              updateList(list.id, { cards: current.cards.map(c => c === oldName ? newName : c) });
            }
          }}
          onViewAsDeck={() => navigate(`/decks/${list.id}`)}
          onConvertToDeck={() => {
            navigate(`/lists/${list.id}/edit?mode=deck`);
          }}
          onConvertToList={() => {
            convertToList(list.id);
          }}
        />
      </main>
    );
  }

  // Deck view (full DeckDisplay for a list)
  if (currentView.view === 'deck-view') {
    const list = lists.find(l => l.id === currentView.listId);
    if (!list) return null; // useEffect will redirect
    return (
      <main className="flex-1 container mx-auto px-4 py-8">
        <div className="aurora-bg" />
        {toasts}
        <ListDeckView
          list={list}
          onBack={() => navigate(list.type === 'deck' ? '/decks' : `/lists/${list.id}`)}
          onViewAsList={() => navigate(`/lists/${list.id}`)}
          onEdit={() => navigate(list.type === 'deck' ? `/decks/${list.id}/edit` : `/lists/${list.id}/edit`)}
          onDuplicate={() => { duplicateList(list.id); navigate(list.type === 'deck' ? '/decks' : '/lists'); }}
          onRemoveCards={(names) => {
            const current = getListById(list.id) ?? list;
            const updated = current.cards.filter(c => !names.includes(c));
            updateList(list.id, { cards: updated, generationSummary: undefined });
          }}
          onAddCards={(names, destination) => {
            const current = getListById(list.id) ?? list;
            if (destination === 'deck') {
              const existing = new Set(current.cards);
              updateList(list.id, { cards: [...current.cards, ...names.filter(n => !existing.has(n))], generationSummary: undefined });
            } else if (destination === 'sideboard') {
              const existing = new Set(current.sideboard || []);
              updateList(list.id, { sideboard: [...(current.sideboard || []), ...names.filter(n => !existing.has(n))] });
            } else {
              const existing = new Set(current.maybeboard || []);
              updateList(list.id, { maybeboard: [...(current.maybeboard || []), ...names.filter(n => !existing.has(n))] });
            }
          }}
          onMoveToSideboard={(names) => {
            const current = getListById(list.id) ?? list;
            const updatedCards = current.cards.filter(c => !names.includes(c));
            const existingSb = new Set(current.sideboard || []);
            updateList(list.id, { cards: updatedCards, sideboard: [...(current.sideboard || []), ...names.filter(n => !existingSb.has(n))], generationSummary: undefined });
          }}
          onMoveToMaybeboard={(names) => {
            const current = getListById(list.id) ?? list;
            const updatedCards = current.cards.filter(c => !names.includes(c));
            const existingMb = new Set(current.maybeboard || []);
            updateList(list.id, { cards: updatedCards, maybeboard: [...(current.maybeboard || []), ...names.filter(n => !existingMb.has(n))], generationSummary: undefined });
          }}
          onMoveToDeck={(names, source) => {
            const current = getListById(list.id) ?? list;
            const existing = new Set(current.cards);
            const newCards = [...current.cards, ...names.filter(n => !existing.has(n))];
            if (source === 'sideboard') {
              updateList(list.id, { cards: newCards, sideboard: (current.sideboard || []).filter(c => !names.includes(c)), generationSummary: undefined });
            } else {
              updateList(list.id, { cards: newCards, maybeboard: (current.maybeboard || []).filter(c => !names.includes(c)), generationSummary: undefined });
            }
          }}
          onRemoveFromBoard={(name, source) => {
            const current = getListById(list.id) ?? list;
            if (source === 'sideboard') {
              updateList(list.id, { sideboard: (current.sideboard || []).filter(c => c !== name) });
            } else {
              updateList(list.id, { maybeboard: (current.maybeboard || []).filter(c => c !== name) });
            }
          }}
          onMoveBetweenBoards={(name, from) => {
            const current = getListById(list.id) ?? list;
            if (from === 'sideboard') {
              const newSb = (current.sideboard || []).filter(c => c !== name);
              const existingMb = new Set(current.maybeboard || []);
              updateList(list.id, { sideboard: newSb, maybeboard: existingMb.has(name) ? [...(current.maybeboard || [])] : [...(current.maybeboard || []), name] });
            } else {
              const newMb = (current.maybeboard || []).filter(c => c !== name);
              const existingSb = new Set(current.sideboard || []);
              updateList(list.id, { maybeboard: newMb, sideboard: existingSb.has(name) ? [...(current.sideboard || [])] : [...(current.sideboard || []), name] });
            }
          }}
          onUpdatePrimer={(primer) => updateList(list.id, { primer })}
          onRename={(newName) => updateList(list.id, { name: newName })}
          onUpdateDeckSize={(newSize) => updateList(list.id, { deckSize: newSize })}
          onSetSideboard={(names) => updateList(list.id, { sideboard: names })}
          onSetMaybeboard={(names) => updateList(list.id, { maybeboard: names })}
          onChangeQuantity={(cardName, newQuantity) => {
            const current = getListById(list.id) ?? list;
            const currentCount = current.cards.filter(c => c === cardName).length;
            if (newQuantity === currentCount) return;
            if (newQuantity === 0) {
              updateList(list.id, { cards: current.cards.filter(c => c !== cardName), generationSummary: undefined });
            } else if (newQuantity > currentCount) {
              const toAdd = Array(newQuantity - currentCount).fill(cardName);
              updateList(list.id, { cards: [...current.cards, ...toAdd], generationSummary: undefined });
            } else {
              let toRemove = currentCount - newQuantity;
              const updated = current.cards.filter(c => {
                if (c === cardName && toRemove > 0) { toRemove--; return false; }
                return true;
              });
              updateList(list.id, { cards: updated, generationSummary: undefined });
            }
          }}
        />
      </main>
    );
  }

  // Ban list browse view
  if (currentView.view === 'banlist-browse') {
    return (
      <main className="flex-1 container mx-auto px-4 py-8 max-w-5xl">
        <div className="aurora-bg" />
        <button
          onClick={() => navigate('/lists')}
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors mb-6"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to lists
        </button>

        <div className="space-y-2 mb-8">
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <Shield className="w-5 h-5 text-amber-500" />
            Format Ban Lists
          </h2>
          <p className="text-sm text-muted-foreground">
            Cards banned in each format. These are automatically fetched from Scryfall.
          </p>
        </div>

        {banListsLoading && populatedBanLists.length === 0 ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
            <Loader2 className="w-4 h-4 animate-spin" />
            Loading ban lists...
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 gap-3">
            {populatedBanLists.map(banList => (
              <button
                key={banList.id}
                onClick={() => navigate(`/lists/banlists/${banList.id}`)}
                className="flex items-center gap-3 px-4 py-3 rounded-lg border border-amber-500/30 bg-amber-500/5 hover:bg-amber-500/10 transition-colors text-left group"
              >
                <Shield className="w-5 h-5 text-amber-500 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{banList.name}</p>
                  <p className="text-xs text-muted-foreground">{banList.cards.length} cards</p>
                </div>
                <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-foreground transition-colors shrink-0" />
              </button>
            ))}
          </div>
        )}
        {toasts}
      </main>
    );
  }

  // Ban list detail view
  if (currentView.view === 'banlist-detail') {
    const banList = banLists.find(l => l.id === currentView.banListId);
    if (!banList || banList.cards.length === 0) return null; // useEffect will redirect
    const asList: UserCardList = {
      id: banList.id,
      name: banList.name,
      description: `${banList.cards.length} cards banned in this format`,
      cards: banList.cards,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    return (
      <main className="flex-1 container mx-auto px-4 py-8 max-w-5xl">
        <div className="aurora-bg" />
        {toasts}
        <ListDetailView
          list={asList}
          readOnly
          onBack={() => navigate('/lists/banlists')}
          onExport={() => {
            const text = banList.cards.map(c => `1 ${c}`).join('\n');
            navigator.clipboard.writeText(text).then(() => {
              setCopiedCount(banList.cards.length);
              setTimeout(() => setCopiedCount(null), 2000);
            });
          }}
        />
      </main>
    );
  }

  // Create view
  if (currentView.view === 'create') {
    const createMode = currentView.kind === 'deck' ? 'deck' : 'list';
    return (
      <main className="flex-1 container mx-auto px-4 py-8 max-w-3xl lg:max-w-5xl">
        <div className="aurora-bg" />
        <ListCreateEditForm
          mode={createMode}
          onSave={(name, cards, description, commanderOptions) => {
            const newList = createList(name, cards, description, {
              type: createMode === 'deck' || commanderOptions?.commanderName ? 'deck' : 'list',
              commanderName: commanderOptions?.commanderName,
              partnerCommanderName: commanderOptions?.partnerCommanderName,
              deckSize: commanderOptions?.deckSize,
              primer: commanderOptions?.primer,
            });
            trackEvent('list_created', { listName: name, cardCount: cards.length });
            const isDeck = createMode === 'deck' || !!commanderOptions?.commanderName;
            navigate(isDeck ? `/decks/${newList.id}` : `/lists/${newList.id}`, { replace: true });
          }}
          onCancel={() => navigate(createMode === 'deck' ? '/decks' : '/lists')}
        />
      </main>
    );
  }

  // Edit view
  if (currentView.view === 'edit') {
    const list = lists.find(l => l.id === currentView.listId);
    if (!list) return null; // useEffect will redirect
    const editMode = searchParams.get('mode') === 'deck' ? 'deck' : undefined;
    return (
      <main className="flex-1 container mx-auto px-4 py-8 max-w-3xl lg:max-w-5xl">
        <div className="aurora-bg" />
        <ListCreateEditForm
          existingList={list}
          mode={editMode}
          onSave={(name, cards, description, commanderOptions) => {
            const convertingToDeck = editMode === 'deck';
            const nextType = convertingToDeck || commanderOptions?.commanderName ? 'deck' : list.type;
            updateList(list.id, {
              name,
              cards,
              description,
              commanderName: commanderOptions?.commanderName,
              partnerCommanderName: commanderOptions?.partnerCommanderName,
              deckSize: commanderOptions?.deckSize,
              primer: commanderOptions?.primer,
              type: nextType,
            });
            const isDeck = nextType === 'deck';
            navigate(isDeck ? `/decks/${list.id}` : `/lists/${list.id}`, { replace: true });
          }}
          onCancel={() => navigate(list.type === 'deck' ? `/decks/${list.id}` : `/lists/${list.id}`)}
        />
      </main>
    );
  }

  // Browse view
  return (
    <main className="flex-1 container mx-auto px-4 py-8 max-w-5xl">
      <div className="aurora-bg" />
      <div className="flex items-center justify-between mb-6">
        <button
          onClick={() => navigate('/')}
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Home
        </button>
        <div className="flex items-center gap-4">
          {currentView.kind === 'deck' ? (
            <button
              onClick={() => navigate('/lists')}
              className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              My Lists
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          ) : (
            <>
              <button
                onClick={() => navigate('/decks')}
                className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
                My Decks
              </button>
              <button
                onClick={() => navigate('/lists/banlists')}
                className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                <Shield className="w-3.5 h-3.5" />
                Ban Lists
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </>
          )}
        </div>
      </div>

      <div className="flex items-start justify-between mb-8">
        <div className="space-y-2">
          <h2 className="text-2xl font-bold">
            {currentView.kind === 'deck' ? 'My Decks' : 'My Lists'}
          </h2>
          <p className="text-sm text-muted-foreground">
            {currentView.kind === 'deck'
              ? 'Your saved Commander decks.'
              : 'Card lists for include/exclude across the site.'}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {currentView.kind === 'deck' ? (
            <button
              onClick={() => navigate('/decks/create')}
              className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground text-sm rounded-lg hover:bg-primary/90 transition-colors"
            >
              <Plus className="w-4 h-4" />
              New Deck
            </button>
          ) : (
            <button
              onClick={() => navigate('/lists/create')}
              className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground text-sm rounded-lg hover:bg-primary/90 transition-colors"
            >
              <Plus className="w-4 h-4" />
              New List
            </button>
          )}
        </div>
      </div>

      {/* Toolbar */}
      {lists.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 sm:gap-3 mb-6">
          <div className="relative flex-1 min-w-[180px] sm:max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              type="text"
              placeholder="Search lists or cards..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 pr-8 h-9 text-sm"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <Select
            value={`${sortKey}-${sortDir}`}
            onChange={(e) => {
              const [key, dir] = e.target.value.split('-') as [SortKey, SortDir];
              setSortKey(key);
              setSortDir(dir);
            }}
            className="h-9 text-sm w-44"
            options={[
              { value: 'updatedAt-desc', label: 'Newest first' },
              { value: 'updatedAt-asc', label: 'Oldest first' },
              { value: 'name-asc', label: 'Name A-Z' },
              { value: 'name-desc', label: 'Name Z-A' },
              { value: 'size-desc', label: 'Most cards' },
              { value: 'size-asc', label: 'Fewest cards' },
            ]}
          />
          <div className="flex items-center gap-1 border border-border/50 rounded-lg p-0.5">
            <button
              onClick={() => setViewModePersisted('grid')}
              className={`p-1.5 rounded transition-colors ${viewMode === 'grid' ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
              title="Grid view"
            >
              <Grid3X3 className="w-4 h-4" />
            </button>
            <button
              onClick={() => setViewModePersisted('list')}
              className={`p-1.5 rounded transition-colors ${viewMode === 'list' ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
              title="List view"
            >
              <List className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {toasts}

      {/* Pinned customization pseudo-lists (lists side only) */}
      {currentView.kind === 'list' && !searchQuery.trim() && (
        <div className="grid sm:grid-cols-2 gap-3 mb-4">
          <button
            onClick={() => navigate(`/lists/${PSEUDO_MUST_INCLUDE_ID}`)}
            className="rounded-xl border border-border/50 bg-card/50 backdrop-blur-sm p-4 text-left hover:border-emerald-500/40 transition-colors flex items-start gap-3 relative overflow-hidden"
            style={{ borderLeftWidth: 3, borderLeftColor: 'rgb(16 185 129 / 0.7)' }}
          >
            <Pin className="w-5 h-5 text-emerald-400/90 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-medium">Must Include</h3>
                <span className="text-[10px] uppercase tracking-wider text-emerald-400/70 font-medium">Pinned</span>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                {(customization.mustIncludeCards?.length ?? 0)} card{(customization.mustIncludeCards?.length ?? 0) === 1 ? '' : 's'} forced into every generated deck
              </p>
            </div>
          </button>
          <button
            onClick={() => navigate(`/lists/${PSEUDO_EXCLUDED_ID}`)}
            className="rounded-xl border border-border/50 bg-card/50 backdrop-blur-sm p-4 text-left hover:border-rose-500/40 transition-colors flex items-start gap-3 relative overflow-hidden"
            style={{ borderLeftWidth: 3, borderLeftColor: 'rgb(244 63 94 / 0.7)' }}
          >
            <Ban className="w-5 h-5 text-rose-400/90 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-medium">Excluded</h3>
                <span className="text-[10px] uppercase tracking-wider text-rose-400/70 font-medium">Pinned</span>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                {(customization.bannedCards?.length ?? 0)} card{(customization.bannedCards?.length ?? 0) === 1 ? '' : 's'} excluded from every generated deck
              </p>
            </div>
          </button>
        </div>
      )}

      {/* Lists grid/list */}
      {filteredAndSortedLists.length > 0 ? (
        viewMode === 'grid' ? (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredAndSortedLists.map(list => (
              <ListCard
                key={list.id}
                list={list}
                viewMode="grid"
                typeBreakdown={list.cachedTypeBreakdown}
                colorIdentity={list.cachedColorIdentity}
                commanderArtUrl={list.cachedCommanderArtUrl}
                matchingCards={matchingCardsMap[list.id]}
                onClick={() => navigate(list.type === 'deck' ? `/decks/${list.id}` : `/lists/${list.id}`)}
                onEdit={() => navigate(list.type === 'deck' ? `/decks/${list.id}/edit` : `/lists/${list.id}/edit`)}
                onDuplicate={() => duplicateList(list.id)}
                onExport={() => handleExport(list.id)}
                onDelete={() => handleDelete(list.id)}
              />
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-border/50 bg-card/50 backdrop-blur-sm divide-y divide-border/30">
            {filteredAndSortedLists.map(list => (
              <ListCard
                key={list.id}
                list={list}
                viewMode="list"
                typeBreakdown={list.cachedTypeBreakdown}
                colorIdentity={list.cachedColorIdentity}
                commanderArtUrl={list.cachedCommanderArtUrl}
                matchingCards={matchingCardsMap[list.id]}
                onClick={() => navigate(list.type === 'deck' ? `/decks/${list.id}` : `/lists/${list.id}`)}
                onEdit={() => navigate(list.type === 'deck' ? `/decks/${list.id}/edit` : `/lists/${list.id}/edit`)}
                onDuplicate={() => duplicateList(list.id)}
                onExport={() => handleExport(list.id)}
                onDelete={() => handleDelete(list.id)}
              />
            ))}
          </div>
        )
      ) : searchQuery.trim() ? (
        <div className="text-center py-12">
          <p className="text-sm text-muted-foreground">
            {currentView.kind === 'deck' ? 'No decks match your search' : 'No lists match your search'}
          </p>
        </div>
      ) : (
        <div className="text-center py-16 space-y-4">
          <BookOpen className="w-12 h-12 text-muted-foreground/30 mx-auto" />
          <div className="space-y-2">
            <p className="text-lg font-medium text-muted-foreground">
              {currentView.kind === 'deck' ? 'No decks yet' : 'No lists yet'}
            </p>
            <p className="text-sm text-muted-foreground/80">
              {currentView.kind === 'deck'
                ? 'Build a deck to save and tune a Commander pile.'
                : 'Create a card list to quickly exclude or include cards across the site.'}
            </p>
          </div>
          <div className="flex items-center justify-center gap-2 flex-wrap">
            {currentView.kind === 'deck' ? (
              <button
                onClick={() => navigate('/decks/create')}
                className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground text-sm rounded-lg hover:bg-primary/90 transition-colors"
              >
                <Plus className="w-4 h-4" />
                Build your first deck
              </button>
            ) : (
              <button
                onClick={() => navigate('/lists/create')}
                className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground text-sm rounded-lg hover:bg-primary/90 transition-colors"
              >
                <Plus className="w-4 h-4" />
                Create a list
              </button>
            )}
          </div>
        </div>
      )}

      {/* Info notice */}
      <aside className="mt-10 p-4 rounded-xl border border-border/50 bg-card/50 backdrop-blur-sm max-w-md space-y-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Info className="w-4 h-4 text-muted-foreground" />
          Good to know
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed">
          Your lists are stored locally in your browser and may be cleared if you clear site data.
          You can export lists to clipboard and re-import them anytime.
        </p>
      </aside>

    </main>
  );
}
