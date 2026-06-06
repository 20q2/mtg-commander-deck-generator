import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ExternalLink, Library } from 'lucide-react';
import { FloatingDialog } from '@/components/playtest/FloatingDialog';
import { ListDetailView } from '@/components/lists/ListDetailView';
import { useUserLists } from '@/hooks/useUserLists';

interface FloatingListPanelProps {
  open: boolean;
  onClose: () => void;
}

const LAST_LIST_ID_KEY = 'floating-list-panel-list-id';

export function FloatingListPanel({ open, onClose }: FloatingListPanelProps) {
  const { lists } = useUserLists();

  // Only show non-deck lists — matches how MustIncludeCards and BannedCards
  // filter (deck-typed entries are full decks, not browseable reference lists).
  const browseableLists = useMemo(
    () => lists.filter(l => l.type !== 'deck').sort((a, b) => b.updatedAt - a.updatedAt),
    [lists],
  );

  // Persisted last-selected list id. Defaults to the most recently updated
  // browseable list on first open.
  const [selectedListId, setSelectedListId] = useState<string>(() => {
    if (typeof window === 'undefined') return '';
    try {
      return window.localStorage.getItem(LAST_LIST_ID_KEY) ?? '';
    } catch {
      return '';
    }
  });

  // If the persisted id no longer matches any browseable list, fall back to
  // the most recent one. Runs whenever the available lists change.
  useEffect(() => {
    if (browseableLists.length === 0) return;
    const exists = browseableLists.some(l => l.id === selectedListId);
    if (!exists) {
      setSelectedListId(browseableLists[0].id);
    }
  }, [browseableLists, selectedListId]);

  // Persist whenever it changes.
  useEffect(() => {
    if (!selectedListId) return;
    try {
      window.localStorage.setItem(LAST_LIST_ID_KEY, selectedListId);
    } catch {
      /* swallow */
    }
  }, [selectedListId]);

  const selectedList = useMemo(
    () => browseableLists.find(l => l.id === selectedListId),
    [browseableLists, selectedListId],
  );

  if (!open) return null;

  const title = (
    <span className="flex items-center gap-2">
      <Library className="w-4 h-4 opacity-70" />
      <span>Lists</span>
    </span>
  );

  // Header extra: list picker + link to full list page.
  const headerExtra = browseableLists.length > 0 ? (
    <div className="flex items-center gap-2 min-w-0">
      <select
        value={selectedListId}
        onChange={(e) => setSelectedListId(e.target.value)}
        className="text-xs bg-background border border-border rounded-md px-2 py-1 focus:outline-none focus:ring-1 focus:ring-primary max-w-[200px] truncate"
      >
        {browseableLists.map(l => (
          <option key={l.id} value={l.id}>{l.name}</option>
        ))}
      </select>
      {selectedList && (
        <Link
          to={`/lists/${selectedList.id}`}
          className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
          title="Open list page"
        >
          <ExternalLink className="w-3.5 h-3.5" />
        </Link>
      )}
    </div>
  ) : null;

  return (
    <FloatingDialog
      title={title}
      headerExtra={headerExtra}
      onClose={onClose}
      width={520}
      height={600}
      minWidth={380}
      minHeight={360}
      resizable
      storageKey="floating-list-panel-pos"
      sizeStorageKey="floating-list-panel-size"
    >
      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3">
        {browseableLists.length === 0 ? (
          <EmptyState />
        ) : selectedList ? (
          <ListDetailView
            list={selectedList}
            compact
            readOnly
          />
        ) : null}
      </div>
    </FloatingDialog>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center gap-2 px-4 py-8">
      <Library className="w-8 h-8 text-muted-foreground/50" />
      <p className="text-sm text-muted-foreground">No lists yet.</p>
      <Link
        to="/lists"
        className="text-xs text-primary hover:underline"
      >
        Create a list →
      </Link>
    </div>
  );
}
