import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, ExternalLink, Library } from 'lucide-react';
import { FloatingDialog } from '@/components/playtest/FloatingDialog';
import { ListDetailView } from '@/components/lists/ListDetailView';
import { ColorIdentity } from '@/components/ui/mtg-icons';
import { useUserLists } from '@/hooks/useUserLists';
import type { UserCardList } from '@/types';

interface FloatingListPanelProps {
  open: boolean;
  onClose: () => void;
}

type Mode = { kind: 'picker' } | { kind: 'list'; listId: string };

export function FloatingListPanel({ open, onClose }: FloatingListPanelProps) {
  const { lists } = useUserLists();

  // Only show non-deck lists — matches how MustIncludeCards and BannedCards
  // filter (deck-typed entries are full decks, not browseable reference lists).
  const browseableLists = useMemo(
    () => lists.filter(l => l.type !== 'deck').sort((a, b) => b.updatedAt - a.updatedAt),
    [lists],
  );

  // Always start at the picker — the user explicitly chose this over auto-
  // opening the last-viewed list, so the panel feels like a deliberate launchpad
  // rather than restoring stale state.
  const [mode, setMode] = useState<Mode>({ kind: 'picker' });

  // If the panel is reopened, reset to the picker. Also reset if the selected
  // list disappears from underneath us (deleted from another tab/window).
  useEffect(() => {
    if (open) setMode({ kind: 'picker' });
  }, [open]);
  useEffect(() => {
    if (mode.kind === 'list' && !browseableLists.some(l => l.id === mode.listId)) {
      setMode({ kind: 'picker' });
    }
  }, [browseableLists, mode]);

  const selectedList = mode.kind === 'list'
    ? browseableLists.find(l => l.id === mode.listId)
    : undefined;

  if (!open) return null;

  // Interactive controls inside the dialog header need onPointerDown stopped —
  // FloatingDialog's header div listens for pointerdown to start a drag, and
  // without this, clicks on these controls would get swallowed by the drag init.
  const title = selectedList ? (
    <span className="flex items-center gap-2 min-w-0">
      <button
        onClick={() => setMode({ kind: 'picker' })}
        onPointerDown={(e) => e.stopPropagation()}
        className="flex items-center gap-1 text-xs font-normal text-muted-foreground hover:text-foreground transition-colors px-2 py-0.5 rounded-md hover:bg-accent shrink-0"
        title="Back to list picker"
      >
        <ArrowLeft className="w-3.5 h-3.5" />
        <span>Lists</span>
      </button>
      <span className="truncate">{selectedList.name}</span>
    </span>
  ) : (
    <span className="flex items-center gap-2">
      <Library className="w-4 h-4 opacity-70" />
      <span>Lists</span>
    </span>
  );

  const headerExtra = selectedList ? (
    <div
      className="flex items-center gap-2 shrink-0"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <Link
        to={`/lists/${selectedList.id}`}
        className="text-muted-foreground hover:text-foreground transition-colors"
        title="Open list page"
      >
        <ExternalLink className="w-3.5 h-3.5" />
      </Link>
    </div>
  ) : null;

  return (
    <FloatingDialog
      title={title}
      headerExtra={headerExtra}
      onClose={onClose}
      width={640}
      height={600}
      minWidth={380}
      minHeight={360}
      resizable
      hideGrip
      storageKey="floating-list-panel-pos"
      sizeStorageKey="floating-list-panel-size-v2"
    >
      <div className="flex-1 min-h-0 overflow-y-auto">
        {browseableLists.length === 0 ? (
          <EmptyState />
        ) : mode.kind === 'picker' ? (
          // key forces remount on mode change so animate-fade-in re-runs
          <div key="picker" className="animate-fade-in">
            <PickerView
              lists={browseableLists}
              onPick={(id) => setMode({ kind: 'list', listId: id })}
            />
          </div>
        ) : selectedList ? (
          <div key={`list-${selectedList.id}`} className="px-4 py-3 animate-fade-in">
            <ListDetailView
              list={selectedList}
              compact
              readOnly
              draggableCards
            />
          </div>
        ) : null}
      </div>
    </FloatingDialog>
  );
}

// ---------- Picker (splash) ----------

function PickerView({ lists, onPick }: { lists: UserCardList[]; onPick: (id: string) => void }) {
  return (
    <div className="px-3 py-3">
      <p className="text-xs text-muted-foreground px-1 mb-2">
        {lists.length} list{lists.length === 1 ? '' : 's'} — pick one to browse beside your deck.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {lists.map((list, i) => (
          <PickerTile key={list.id} list={list} onPick={() => onPick(list.id)} index={i} />
        ))}
      </div>
    </div>
  );
}

function PickerTile({ list, onPick, index }: { list: UserCardList; onPick: () => void; index: number }) {
  const artUrl = list.cachedCommanderArtUrl ?? list.cachedListArtUrl;
  const cardCount = list.cards.length;

  return (
    <button
      onClick={onPick}
      // Subtle stagger on initial mount + tile lift on hover for tactile feel.
      // Cap delay so a huge list doesn't take forever to finish staggering in.
      // fillMode: backwards holds the from-state during the delay (no flicker).
      style={{ animationDelay: `${Math.min(index, 12) * 30}ms`, animationFillMode: 'backwards' }}
      className="relative overflow-hidden text-left rounded-lg border border-border/50 bg-card/40 hover:bg-card/70 hover:border-primary/40 hover:scale-[1.02] hover:-translate-y-0.5 active:scale-[0.99] transition-all duration-150 ease-out p-2.5 min-h-[64px] animate-scale-in"
    >
      {artUrl && (
        <div className="absolute inset-0 pointer-events-none">
          <img
            src={artUrl}
            alt=""
            loading="lazy"
            className="w-full h-full object-cover opacity-[0.18]"
          />
          <div className="absolute inset-0 bg-gradient-to-r from-card/80 via-card/60 to-card/80" />
        </div>
      )}
      <div className="relative min-w-0">
        <p className="text-sm font-semibold truncate">{list.name}</p>
        {list.commanderName && (
          <p className="text-xs text-muted-foreground truncate mt-0.5">
            {list.commanderName}
          </p>
        )}
        {list.description && !list.commanderName && (
          <p className="text-xs text-muted-foreground truncate mt-0.5">
            {list.description}
          </p>
        )}
        <div className="flex items-center gap-2 mt-1.5">
          <span className="text-[11px] text-muted-foreground">
            {cardCount} card{cardCount === 1 ? '' : 's'}
          </span>
          {list.cachedColorIdentity && list.cachedColorIdentity.length > 0 && (
            <ColorIdentity colors={list.cachedColorIdentity} size="sm" />
          )}
        </div>
      </div>
    </button>
  );
}

// ---------- Empty state ----------

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
