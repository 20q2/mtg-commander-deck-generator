import { useRef, useState } from 'react';
import { useDraggable, useDroppable } from '@dnd-kit/core';
import { Grab, Hand as HandIcon, Shuffle, Sparkles, Trash2 } from 'lucide-react';
import { usePlaytestStore } from '@/store/playtestStore';
import { useOpponentStore } from '@/store/opponentStore';
import { getCardImageUrl } from '@/services/scryfall/client';
import { FloatingDialog } from '@/components/playtest/FloatingDialog';
import { MagnifiedPreview } from '@/components/playtest/MagnifiedPreview';
import { useMagnifyHover } from '@/components/playtest/hooks/useMagnifyHover';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { OpponentZone } from '@/components/playtest/opponentTypes';
import type { ScryfallCard } from '@/types';

const TITLE: Record<OpponentZone, string> = {
  graveyard: 'Graveyard',
  exile: 'Exile',
  hand: 'Hand',
  library: 'Library',
};

/**
 * Viewer for a bot's graveyard, exile, hand, or library.
 *
 * Every card in here can be dragged onto your own battlefield or into your own
 * hand, whichever zone you are looking at. That used to be true of the library
 * only, and the graveyard and exile were hard read-only on the argument that
 * "pulling cards out of a bot's graveyard is a rules argument, not a goldfish
 * feature" — which is simply wrong. Reanimate, Animate Dead, Sepulchral
 * Primordial, Extract from Darkness, Geth and Rise of the Dark Realms all reach
 * into an opponent's graveyard, and black does it in Commander constantly.
 *
 * The buttons that remain on a card are the ones that are NOT you taking it —
 * making them pitch a card from hand, exiling their library, milling one off
 * the top. Taking is the drag, in both directions: this is the same gesture as
 * stealing a permanent off their battlefield, and it lands through the same
 * `opponentZoneSource` branch in the page's drag handler.
 */
export function OpponentZoneModal({ opponentId, zone }: { opponentId: string; zone: OpponentZone }) {
  const closeModal = usePlaytestStore(s => s.closeModal);
  const opponent = useOpponentStore(s => s.opponents.find(o => o.id === opponentId));
  const discardFromHand = useOpponentStore(s => s.discardFromHand);
  const takeFromZone = useOpponentStore(s => s.takeFromZone);
  const libraryCardToZone = useOpponentStore(s => s.libraryCardToZone);
  const shuffleLibrary = useOpponentStore(s => s.shuffleLibrary);
  const addToHand = usePlaytestStore(s => s.addToHand);
  const addPermanent = usePlaytestStore(s => s.addPermanent);
  const [q, setQ] = useState('');

  /**
   * The dialog catches its own drops.
   *
   * `floating: true` wins the collision test over anything beneath the pointer,
   * and this dialog sits directly over your battlefield — so without it, letting
   * go of a card anywhere inside the viewer would register as a drop on the
   * battlefield and steal the card to a coordinate under the dialog. Releasing
   * over the viewer now means what it looks like it means: you changed your
   * mind, and the card stays where it was.
   */
  const viewer = useDroppable({
    id: 'opponent-zone-viewer',
    data: { kind: 'opponentZoneViewer', floating: true },
  });

  if (!opponent) return null;
  const cards = opponent[zone];

  /** Out of their zone and onto your side, wherever the effect puts it. */
  const takeTo = (index: number, where: 'hand' | 'battlefield') => {
    const card = takeFromZone(opponentId, zone, index);
    if (!card) return;
    const line = `You took ${card.name} from ${opponent.name}'s ${zone}`;
    if (where === 'hand') addToHand(card, line);
    else addPermanent(card, undefined, line);
  };

  // Indices travel with the cards: a card's actions address it by its position
  // in the real zone, and filtering must not renumber them.
  const entries = cards.map((card, index) => ({ card, index }));
  const filtered = q
    ? entries.filter(({ card }) =>
        card.name.toLowerCase().includes(q.toLowerCase()) ||
        card.type_line.toLowerCase().includes(q.toLowerCase()))
    : entries;

  return (
    <FloatingDialog
      title={`${opponent.name} · ${TITLE[zone]} (${cards.length})`}
      onClose={closeModal}
      width={560}
      height={520}
      resizable
      storageKey={`playtest-opponent-zone-pos`}
      sizeStorageKey={`playtest-opponent-zone-size`}
      outerRef={viewer.setNodeRef}
      // Next to the X, exactly where your own zone viewer puts it. It used to
      // sit in the body next to a sentence, which made a one-off control out of
      // something every other pile already has a home for.
      headerActions={zone === 'library' && cards.length > 1 ? (
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          title={`Shuffle ${opponent.name}'s library — what you'd do after searching it`}
          aria-label="Shuffle their library"
          // The header bar is the dialog's drag handle — don't let the press
          // start a move.
          onPointerDown={e => e.stopPropagation()}
          onClick={() => shuffleLibrary(opponentId)}
        >
          <Shuffle className="w-4 h-4" />
        </Button>
      ) : undefined}
    >
      {/* Two bands: the filter stays put, the cards scroll under it. A 47-card
          library used to run straight out of the bottom of the dialog and over
          the table — the zone this viewer was written for was a graveyard with
          four cards in it, which never reached the edge. */}
      {cards.length > 0 && (
        <div className="shrink-0 p-3 pb-2">
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Filter by name or type…"
            className="h-8 text-xs"
          />
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto px-3 pb-3">
        {filtered.length === 0 ? (
          <div className="py-8 text-center text-xs text-muted-foreground">
            {cards.length === 0 ? `Nothing in ${zone === 'hand' ? 'hand' : zone}.` : 'No matches.'}
          </div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(88px,1fr))] gap-2">
            {filtered.map(({ card, index }) => (
              <ZoneCard
                key={`${card.id}-${index}`}
                card={card}
                opponentId={opponentId}
                zone={zone}
                index={index}
                top={zone === 'library' && index === 0}
                actions={
                  zone === 'hand' ? [
                    { icon: <Trash2 className="w-3 h-3" />, title: `Discard ${card.name}`,
                      hover: 'hover:bg-red-600/90',
                      run: () => discardFromHand(opponentId, index, 'graveyard') },
                    { icon: <Sparkles className="w-3 h-3" />, title: `Exile ${card.name} from their hand`,
                      hover: 'hover:bg-amber-600/90',
                      run: () => discardFromHand(opponentId, index, 'exile') },
                  ]
                  : zone === 'library' ? [
                    { icon: <HandIcon className="w-3 h-3" />, title: `Take ${card.name} to your hand`,
                      hover: 'hover:bg-violet-600/90',
                      run: () => takeTo(index, 'hand') },
                    { icon: <Grab className="w-3 h-3" />, title: `Put ${card.name} onto your battlefield`,
                      hover: 'hover:bg-emerald-600/90',
                      run: () => takeTo(index, 'battlefield') },
                    { icon: <Sparkles className="w-3 h-3" />, title: `Exile ${card.name} from their library`,
                      hover: 'hover:bg-amber-600/90',
                      run: () => libraryCardToZone(opponentId, index, 'exile') },
                    { icon: <Trash2 className="w-3 h-3" />, title: `Put ${card.name} in their graveyard`,
                      hover: 'hover:bg-red-600/90',
                      run: () => libraryCardToZone(opponentId, index, 'graveyard') },
                  ]
                  : undefined
                }
              />
            ))}
          </div>
        )}
      </div>
    </FloatingDialog>
  );
}

interface CardAction {
  icon: React.ReactNode;
  title: string;
  /** Tailwind hover background — the colour says what kind of action it is. */
  hover: string;
  run: () => void;
}

function ZoneCard({
  card, actions, top, opponentId, zone, index,
}: {
  card: ScryfallCard;
  actions?: CardAction[];
  /** Marks the next card they would draw, in the library view. */
  top?: boolean;
  opponentId: string;
  zone: OpponentZone;
  index: number;
}) {
  const [hovered, setHovered] = useState(false);
  const magnified = useMagnifyHover(hovered, 'opponent');
  const ref = useRef<HTMLDivElement | null>(null);

  // Drag it out to take it. The page's handler decides what landing on your
  // battlefield versus your hand means; all this has to say is which card in
  // which zone left.
  const { attributes, listeners, setNodeRef: setDragRef, isDragging } = useDraggable({
    id: `oppzone:${opponentId}:${zone}:${index}:${card.id}`,
    data: { opponentZoneSource: { opponentId, zone, index }, card },
  });
  const composedRef = (node: HTMLDivElement | null) => {
    setDragRef(node);
    ref.current = node;
  };

  return (
    <div
      ref={composedRef}
      {...attributes}
      {...listeners}
      className={`relative touch-none select-none cursor-grab active:cursor-grabbing ${
        isDragging ? 'opacity-0' : ''
      }`}
      title={`${card.name} · drag onto your battlefield or into your hand to take it`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <img
        src={getCardImageUrl(card, 'small')}
        alt={card.name}
        className={`w-full rounded-[4px] shadow pointer-events-none ${top ? 'ring-1 ring-blue-400/70' : ''}`}
        draggable={false}
      />
      {top && (
        <span className="absolute top-0 inset-x-0 text-[9px] font-bold text-center bg-blue-500/80 text-white rounded-t-[4px] pointer-events-none">
          TOP
        </span>
      )}
      {/* Only on hover, and over the bottom of the art: a strip of buttons under
          every card turned a grid of cards into a grid of toolbars.

          These are the actions that are NOT you taking the card — taking is the
          drag. `onPointerDown` stops here so pressing a button cannot also
          start one. */}
      {actions && hovered && !isDragging && (
        <div className="absolute inset-x-0 bottom-0 flex rounded-b-[4px] overflow-hidden">
          {actions.map(a => (
            <button
              key={a.title}
              onPointerDown={e => e.stopPropagation()}
              onClick={a.run}
              title={a.title}
              className={`flex-1 flex items-center justify-center py-1 bg-black/80 text-white transition-colors ${a.hover}`}
            >
              {a.icon}
            </button>
          ))}
        </div>
      )}
      {magnified && !isDragging && <MagnifiedPreview card={card} anchorRef={ref} />}
    </div>
  );
}
