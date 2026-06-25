import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, ExternalLink, Library } from 'lucide-react';
import { FloatingDialog } from '@/components/playtest/FloatingDialog';
import { ListDetailView } from '@/components/lists/ListDetailView';
import { ColorIdentity, CardTypeIcon } from '@/components/ui/mtg-icons';
import { useUserLists } from '@/hooks/useUserLists';
import { useStore } from '@/store';
import type { UserCardList } from '@/types';

interface FloatingListPanelProps {
  open: boolean;
  onClose: () => void;
}

type Mode = { kind: 'picker' } | { kind: 'list'; listId: string };

export function FloatingListPanel({ open, onClose }: FloatingListPanelProps) {
  const { lists } = useUserLists();
  const generatedDeck = useStore(s => s.generatedDeck);

  // Lowercased name-set of everything in the active deck (commander + partner +
  // every category) so the open list can flag cards you've already added. Stays
  // undefined when there's no active deck — marking/filter then lie dormant.
  const deckCardNames = useMemo(() => {
    if (!generatedDeck) return undefined;
    const names = new Set<string>();
    if (generatedDeck.commander) names.add(generatedDeck.commander.name.toLowerCase());
    if (generatedDeck.partnerCommander) names.add(generatedDeck.partnerCommander.name.toLowerCase());
    for (const cards of Object.values(generatedDeck.categories)) {
      for (const c of cards) names.add(c.name.toLowerCase());
    }
    return names;
  }, [generatedDeck]);

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
  const listArtUrl = selectedList?.cachedCommanderArtUrl ?? selectedList?.cachedListArtUrl;

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
      <div className="relative flex-1 min-h-0 flex flex-col">
        {/* When a list is open, its artwork washes the whole panel body — pinned
            behind the scrolling content so it reads as atmosphere, not clutter. */}
        {selectedList && listArtUrl && (
          <div className="absolute inset-0 pointer-events-none overflow-hidden">
            <img
              src={listArtUrl}
              alt=""
              className="w-full h-full object-cover opacity-40"
            />
            <div className="absolute inset-0 bg-gradient-to-b from-card/25 via-card/70 to-card" />
          </div>
        )}
        <div className="relative flex-1 min-h-0 overflow-y-auto">
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
                deckCardNames={deckCardNames}
              />
            </div>
          ) : null}
        </div>
      </div>
    </FloatingDialog>
  );
}

// ---------- Picker (splash) ----------

// Canonical card-type ordering for the chip row (mirrors ListCard).
const TYPE_ORDER = ['Creature', 'Instant', 'Sorcery', 'Artifact', 'Enchantment', 'Planeswalker', 'Battle', 'Land'];

function PickerView({ lists, onPick }: { lists: UserCardList[]; onPick: (id: string) => void }) {
  return (
    <div className="px-3 py-3">
      <p className="text-xs text-muted-foreground px-1 mb-2.5">
        {lists.length} list{lists.length === 1 ? '' : 's'} — pick one to browse beside your deck.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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

  // Ordered type-breakdown entries → the little count chips along the footer.
  const typeChips = list.cachedTypeBreakdown
    ? Object.entries(list.cachedTypeBreakdown).sort((a, b) => {
        const ai = TYPE_ORDER.indexOf(a[0]);
        const bi = TYPE_ORDER.indexOf(b[0]);
        return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
      })
    : [];

  return (
    <button
      onClick={onPick}
      // Subtle stagger on initial mount + tile lift on hover for tactile feel.
      // Cap delay so a huge list doesn't take forever to finish staggering in.
      // fillMode: backwards holds the from-state during the delay (no flicker).
      style={{ animationDelay: `${Math.min(index, 12) * 30}ms`, animationFillMode: 'backwards' }}
      className="group relative flex flex-col overflow-hidden text-left rounded-xl border border-border/50 bg-card/40 hover:border-primary/50 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-primary/5 active:translate-y-0 transition-all duration-200 ease-out animate-scale-in"
    >
      {/* Hero art banner — the selected artwork reads through clearly here, then
          fades into the card body so the name/meta stay legible on top of it. */}
      <div className="relative h-24 w-full overflow-hidden bg-accent/30">
        {artUrl ? (
          <img
            src={artUrl}
            alt=""
            loading="lazy"
            className="absolute inset-0 w-full h-full object-cover opacity-70 group-hover:opacity-90 group-hover:scale-[1.04] transition-all duration-300 ease-out"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <Library className="w-7 h-7 text-muted-foreground/25" />
          </div>
        )}
        {/* Top sheen + bottom fade into the body color. */}
        <div className="absolute inset-0 bg-gradient-to-b from-card/10 via-transparent to-card" />
        {/* Title + commander overlaid at the foot of the art for the "pop" look. */}
        <div className="absolute inset-x-0 bottom-0 px-3 pb-2">
          <p className="text-sm font-semibold leading-tight truncate drop-shadow-[0_1px_3px_rgba(0,0,0,0.9)]">
            {list.name}
          </p>
          {list.commanderName ? (
            <p className="text-[11px] text-foreground/75 truncate mt-0.5 drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]">
              {list.commanderName}
            </p>
          ) : list.description ? (
            <p className="text-[11px] text-foreground/70 truncate mt-0.5 drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]">
              {list.description}
            </p>
          ) : null}
        </div>
      </div>

      {/* Body — card count, colors, and the card-type chip row. */}
      <div className="relative flex flex-col gap-2 px-3 pt-2 pb-2.5">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-medium text-muted-foreground">
            {cardCount} card{cardCount === 1 ? '' : 's'}
          </span>
          {list.cachedColorIdentity && list.cachedColorIdentity.length > 0 && (
            <>
              <span className="text-border">·</span>
              <ColorIdentity colors={list.cachedColorIdentity} size="sm" />
            </>
          )}
        </div>
        {typeChips.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {typeChips.map(([type, count]) => (
              <span
                key={type}
                title={`${count} ${type}${count === 1 ? '' : 's'}`}
                className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] bg-accent/50 text-muted-foreground rounded border border-border/30 group-hover:border-border/50 transition-colors"
              >
                <CardTypeIcon type={type} size="sm" className="opacity-60 text-[10px]" />
                {count}
              </span>
            ))}
          </div>
        )}
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
