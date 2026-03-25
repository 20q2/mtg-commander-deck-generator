import { useState, useMemo, useEffect, useCallback } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
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
import { ArrowLeft, ChevronRight, Plus, Search, X, Grid3X3, List, BookOpen, Shield, Loader2, Info } from 'lucide-react';
import { trackEvent } from '@/services/analytics';
import type { BanList, UserCardList } from '@/types';

type SortKey = 'updatedAt' | 'name' | 'size';
type SortDir = 'asc' | 'desc';
type TypeFilter = 'all' | 'deck' | 'list';

export function ListsPage() {
  const navigate = useNavigate();
  const { '*': splat } = useParams();
  const [searchParams] = useSearchParams();
  const { lists, createList, updateList, deleteList, duplicateList, convertToList, exportList } = useUserLists();

  // Derive current view from URL segments
  const currentView = useMemo(() => {
    const segments = (splat || '').split('/').filter(Boolean);
    if (segments.length === 0) return { view: 'browse' as const };
    if (segments[0] === 'create') return { view: 'create' as const };
    if (segments[0] === 'banlists') {
      if (segments[1]) return { view: 'banlist-detail' as const, banListId: segments[1] };
      return { view: 'banlist-browse' as const };
    }
    // segments[0] is a listId
    const listId = segments[0];
    if (segments[1] === 'edit') return { view: 'edit' as const, listId };
    if (segments[1] === 'deck-view') return { view: 'deck-view' as const, listId };
    return { view: 'detail' as const, listId };
  }, [splat]);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>(() => (localStorage.getItem('mtg-lists-view-mode') as 'grid' | 'list') || 'grid');
  const setViewModePersisted = useCallback((mode: 'grid' | 'list') => { setViewMode(mode); localStorage.setItem('mtg-lists-view-mode', mode); }, []);
  const [sortKey, setSortKey] = useState<SortKey>('updatedAt');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
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
    let filtered = lists;
    if (typeFilter === 'deck') filtered = filtered.filter(l => l.type === 'deck');
    else if (typeFilter === 'list') filtered = filtered.filter(l => l.type !== 'deck');
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
  }, [lists, searchQuery, typeFilter, sortKey, sortDir]);

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
    deleteList(listId);
    if (currentView.view === 'detail' && currentView.listId === listId) {
      navigate('/lists', { replace: true });
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

  // Redirect invalid list/banlist IDs
  useEffect(() => {
    if (currentView.view === 'detail' || currentView.view === 'edit' || currentView.view === 'deck-view') {
      if (!lists.find(l => l.id === currentView.listId)) {
        navigate('/lists', { replace: true });
      }
    }
    if (currentView.view === 'banlist-detail') {
      if (!banLists.find(l => l.id === currentView.banListId && l.cards.length > 0)) {
        navigate('/lists/banlists', { replace: true });
      }
    }
  }, [currentView, lists, banLists, navigate]);

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
          onDuplicate={() => { duplicateList(list.id); navigate('/lists'); }}
          onExport={() => handleExport(list.id)}
          onDelete={() => handleDelete(list.id)}
          onRemoveCard={(name) => handleRemoveCard(list.id, name)}
          onViewAsDeck={() => navigate(`/lists/${list.id}/deck-view`)}
          onConvertToDeck={(commanderName, partnerName) => {
            updateList(list.id, { type: 'deck', commanderName, partnerCommanderName: partnerName });
            navigate(`/lists/${list.id}/deck-view`);
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
        {toasts}
        <ListDeckView
          list={list}
          onBack={() => navigate(list.type === 'deck' ? '/lists' : `/lists/${list.id}`)}
          onViewAsList={() => navigate(`/lists/${list.id}`)}
          onEdit={() => navigate(`/lists/${list.id}/edit`)}
          onDuplicate={() => { duplicateList(list.id); navigate('/lists'); }}
          onRemoveCards={(names) => {
            const updated = list.cards.filter(c => !names.includes(c));
            updateList(list.id, { cards: updated });
          }}
          onAddCards={(names, destination) => {
            if (destination === 'deck') {
              const existing = new Set(list.cards);
              updateList(list.id, { cards: [...list.cards, ...names.filter(n => !existing.has(n))] });
            } else if (destination === 'sideboard') {
              const existing = new Set(list.sideboard || []);
              updateList(list.id, { sideboard: [...(list.sideboard || []), ...names.filter(n => !existing.has(n))] });
            } else {
              const existing = new Set(list.maybeboard || []);
              updateList(list.id, { maybeboard: [...(list.maybeboard || []), ...names.filter(n => !existing.has(n))] });
            }
          }}
          onMoveToSideboard={(names) => {
            const updatedCards = list.cards.filter(c => !names.includes(c));
            const existingSb = new Set(list.sideboard || []);
            updateList(list.id, { cards: updatedCards, sideboard: [...(list.sideboard || []), ...names.filter(n => !existingSb.has(n))] });
          }}
          onMoveToMaybeboard={(names) => {
            const updatedCards = list.cards.filter(c => !names.includes(c));
            const existingMb = new Set(list.maybeboard || []);
            updateList(list.id, { cards: updatedCards, maybeboard: [...(list.maybeboard || []), ...names.filter(n => !existingMb.has(n))] });
          }}
          onMoveToDeck={(names, source) => {
            const existing = new Set(list.cards);
            const newCards = [...list.cards, ...names.filter(n => !existing.has(n))];
            if (source === 'sideboard') {
              updateList(list.id, { cards: newCards, sideboard: (list.sideboard || []).filter(c => !names.includes(c)) });
            } else {
              updateList(list.id, { cards: newCards, maybeboard: (list.maybeboard || []).filter(c => !names.includes(c)) });
            }
          }}
          onRemoveFromBoard={(name, source) => {
            if (source === 'sideboard') {
              updateList(list.id, { sideboard: (list.sideboard || []).filter(c => c !== name) });
            } else {
              updateList(list.id, { maybeboard: (list.maybeboard || []).filter(c => c !== name) });
            }
          }}
          onMoveBetweenBoards={(name, from) => {
            if (from === 'sideboard') {
              const newSb = (list.sideboard || []).filter(c => c !== name);
              const existingMb = new Set(list.maybeboard || []);
              updateList(list.id, { sideboard: newSb, maybeboard: existingMb.has(name) ? [...(list.maybeboard || [])] : [...(list.maybeboard || []), name] });
            } else {
              const newMb = (list.maybeboard || []).filter(c => c !== name);
              const existingSb = new Set(list.sideboard || []);
              updateList(list.id, { maybeboard: newMb, sideboard: existingSb.has(name) ? [...(list.sideboard || [])] : [...(list.sideboard || []), name] });
            }
          }}
          onUpdatePrimer={(primer) => updateList(list.id, { primer })}
          onRename={(newName) => updateList(list.id, { name: newName })}
          onUpdateDeckSize={(newSize) => updateList(list.id, { deckSize: newSize })}
          onSetSideboard={(names) => updateList(list.id, { sideboard: names })}
          onSetMaybeboard={(names) => updateList(list.id, { maybeboard: names })}
          onChangeQuantity={(cardName, newQuantity) => {
            const currentCount = list.cards.filter(c => c === cardName).length;
            if (newQuantity === currentCount) return;
            if (newQuantity === 0) {
              // Remove all copies
              updateList(list.id, { cards: list.cards.filter(c => c !== cardName) });
            } else if (newQuantity > currentCount) {
              // Add copies
              const toAdd = Array(newQuantity - currentCount).fill(cardName);
              updateList(list.id, { cards: [...list.cards, ...toAdd] });
            } else {
              // Remove some copies
              let toRemove = currentCount - newQuantity;
              const updated = list.cards.filter(c => {
                if (c === cardName && toRemove > 0) { toRemove--; return false; }
                return true;
              });
              updateList(list.id, { cards: updated });
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
    const createMode = searchParams.get('type') === 'deck' ? 'deck' : 'list';
    return (
      <main className="flex-1 container mx-auto px-4 py-8 max-w-3xl">
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
            navigate(`/lists/${newList.id}${isDeck ? '/deck-view' : ''}`, { replace: true });
          }}
          onCancel={() => navigate('/lists')}
        />
      </main>
    );
  }

  // Edit view
  if (currentView.view === 'edit') {
    const list = lists.find(l => l.id === currentView.listId);
    if (!list) return null; // useEffect will redirect
    return (
      <main className="flex-1 container mx-auto px-4 py-8 max-w-3xl">
        <div className="aurora-bg" />
        <ListCreateEditForm
          existingList={list}
          onSave={(name, cards, description, commanderOptions) => {
            updateList(list.id, {
              name,
              cards,
              description,
              commanderName: commanderOptions?.commanderName,
              partnerCommanderName: commanderOptions?.partnerCommanderName,
              deckSize: commanderOptions?.deckSize,
              primer: commanderOptions?.primer,
              type: commanderOptions?.commanderName ? 'deck' : list.type,
            });
            const isDeck = list.type === 'deck' || !!commanderOptions?.commanderName;
            navigate(`/lists/${list.id}${isDeck ? '/deck-view' : ''}`, { replace: true });
          }}
          onCancel={() => navigate(`/lists/${list.id}`)}
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
        <button
          onClick={() => navigate('/lists/banlists')}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <Shield className="w-3.5 h-3.5" />
          Ban Lists
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="flex items-start justify-between mb-8">
        <div className="space-y-2">
          <h2 className="text-2xl font-bold">My Lists</h2>
          <p className="text-sm text-muted-foreground">
            Save card lists for exclusions, must-includes, or full decks. Set a commander to unlock deck features.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => navigate('/lists/create?type=deck')}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground text-sm rounded-lg hover:bg-primary/90 transition-colors"
          >
            <Plus className="w-4 h-4" />
            New Deck
          </button>
          <button
            onClick={() => navigate('/lists/create?type=list')}
            className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg border border-primary text-primary hover:bg-primary/10 transition-colors"
          >
            <Plus className="w-4 h-4" />
            New List
          </button>
        </div>
      </div>

      {/* Toolbar */}
      {lists.length > 0 && (
        <div className="flex items-center gap-3 mb-6">
          <div className="relative flex-1 max-w-sm">
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
          <div className="flex items-center gap-1 border border-border/50 rounded-lg p-0.5">
            {(['all', 'deck', 'list'] as const).map(t => (
              <button
                key={t}
                onClick={() => setTypeFilter(t)}
                className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${typeFilter === t ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
              >
                {t === 'all' ? 'All' : t === 'deck' ? 'Decks' : 'Lists'}
              </button>
            ))}
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
                onClick={() => navigate(list.type === 'deck' ? `/lists/${list.id}/deck-view` : `/lists/${list.id}`)}
                onEdit={() => navigate(`/lists/${list.id}/edit`)}
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
                onClick={() => navigate(list.type === 'deck' ? `/lists/${list.id}/deck-view` : `/lists/${list.id}`)}
                onEdit={() => navigate(`/lists/${list.id}/edit`)}
                onDuplicate={() => duplicateList(list.id)}
                onExport={() => handleExport(list.id)}
                onDelete={() => handleDelete(list.id)}
              />
            ))}
          </div>
        )
      ) : lists.length > 0 ? (
        <div className="text-center py-12">
          <p className="text-sm text-muted-foreground">No lists match your search</p>
        </div>
      ) : (
        <div className="text-center py-16 space-y-4">
          <BookOpen className="w-12 h-12 text-muted-foreground/30 mx-auto" />
          <div className="space-y-2">
            <p className="text-lg font-medium text-muted-foreground">No lists yet</p>
            <p className="text-sm text-muted-foreground/80">
              Create your first list to save cards you want to quickly exclude or include in decks.
            </p>
          </div>
          <button
            onClick={() => navigate('/lists/create')}
            className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground text-sm rounded-lg hover:bg-primary/90 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Create your first list
          </button>
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
