import { useEffect, useRef, useState } from 'react';
import { Sparkles, BookOpen, Trash2, Crown, Shuffle, Minus, Plus, Eye } from 'lucide-react';
import { useDroppable, useDraggable } from '@dnd-kit/core';
import { Button } from '@/components/ui/button';
import { usePlaytestStore } from '@/store/playtestStore';
import { usePlaytestSettings } from '@/store/playtestSettingsStore';
import { getCardImageUrl } from '@/services/scryfall/client';
import { MagnifiedPreview } from '@/components/playtest/MagnifiedPreview';
import { useMagnifyHover } from '@/components/playtest/hooks/useMagnifyHover';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { ZoneActionsContextMenu } from '@/components/playtest/PlaytestActionsBar';
import type { ZoneKey } from '@/components/playtest/types';
import type { ScryfallCard } from '@/types';

export interface PileSpec {
  zone: Exclude<ZoneKey, 'hand'>;
  label: string;
  Icon: typeof Crown;
  bgClass: string;
  faceUp: boolean; // library renders face-down
}

export const PILES: PileSpec[] = [
  { zone: 'command',   label: 'Command',   Icon: Crown,    bgClass: 'bg-purple-500/10 border-purple-400/30',  faceUp: true },
  { zone: 'library',   label: 'Library',   Icon: BookOpen, bgClass: 'bg-blue-500/10 border-blue-400/30',      faceUp: false },
  { zone: 'graveyard', label: 'Graveyard', Icon: Trash2,   bgClass: 'bg-zinc-500/15 border-zinc-400/30',      faceUp: true },
  { zone: 'exile',     label: 'Exile',     Icon: Sparkles, bgClass: 'bg-amber-500/10 border-amber-400/30',    faceUp: true },
];

// Must match the .animate-deal-out duration in index.css.
const DEAL_OUT_MS = 200;

export function PlaytestPile({ spec }: { spec: PileSpec }) {
  const isDesktop = useMediaQuery('(min-width: 768px)');
  const cards = usePlaytestStore(s => s.zones[spec.zone]);
  const openModal = usePlaytestStore(s => s.openModal);
  const closeModal = usePlaytestStore(s => s.closeModal);
  const currentModal = usePlaytestStore(s => s.modal);
  const moveCard = usePlaytestStore(s => s.moveCard);
  const setHoveredPile = usePlaytestStore(s => s.setHoveredPile);
  // The number you're part-way through typing, if it's aimed at this pile.
  const pendingDraw = usePlaytestStore(s => (s.pileDrawPending?.zone === spec.zone ? s.pileDrawPending.n : null));
  const draw = usePlaytestStore(s => s.draw);
  const shuffle = usePlaytestStore(s => s.shuffle);
  const shuffleTick = usePlaytestStore(s => s.shuffleTick);
  const libraryRevealed = usePlaytestStore(s => s.libraryRevealed);
  const toggleLibraryRevealed = usePlaytestStore(s => s.toggleLibraryRevealed);
  const libraryTopPushTick = usePlaytestStore(s => s.libraryTopPushTick);
  const libraryDrawTick = usePlaytestStore(s => s.libraryDrawTick);
  const animations = usePlaytestSettings(s => s.animations);
  const graveyardPushTick = usePlaytestStore(s => s.graveyardPushTick);
  const exilePushTick = usePlaytestStore(s => s.exilePushTick);
  const pushTick =
    spec.zone === 'library'   ? libraryTopPushTick :
    spec.zone === 'graveyard' ? graveyardPushTick :
    spec.zone === 'exile'     ? exilePushTick :
    0;
  const [jiggle, setJiggle] = useState(false);
  // During a push animation the *base* image freezes at the previous top while
  // the overlay slides in showing the new card. Once the animation ends,
  // frozenTop clears and the base image picks up the new top naturally.
  const [animState, setAnimState] = useState<{
    pushAnim: { tick: number; isFirst: boolean } | null;
    frozenTop: ScryfallCard | undefined;
  }>({ pushAnim: null, frozenTop: undefined });
  const seenTickRef = useRef(pushTick);
  useEffect(() => {
    if (spec.zone !== 'library' || shuffleTick === 0) return;
    setJiggle(true);
    const t = setTimeout(() => setJiggle(false), 500);
    return () => clearTimeout(t);
  }, [shuffleTick, spec.zone]);
  useEffect(() => {
    if (pushTick === 0 || pushTick === seenTickRef.current) return;
    seenTickRef.current = pushTick;
    const isFirst = cards.length === 1;
    // unshift means cards[1] is the card that was on top before this push.
    const prevTop = cards.length > 1 ? cards[1] : undefined;
    setAnimState({ pushAnim: { tick: pushTick, isFirst }, frozenTop: prevTop });
    const t = setTimeout(() => setAnimState({ pushAnim: null, frozenTop: undefined }), 380);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pushTick]);
  // Draw animation: a card back peels off the top of the library and slides
  // down out of the pile, timed to land with the drawn card's deal-in in the
  // hand. Purely decorative — the store has already moved the card, so this
  // overlay renders even when the draw emptied the library.
  const [drawAnim, setDrawAnim] = useState(0);
  const seenDrawTickRef = useRef(libraryDrawTick);
  useEffect(() => {
    if (spec.zone !== 'library' || libraryDrawTick === seenDrawTickRef.current) return;
    seenDrawTickRef.current = libraryDrawTick;
    if (!animations) return;
    setDrawAnim(libraryDrawTick);
    const t = setTimeout(() => setDrawAnim(0), DEAL_OUT_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [libraryDrawTick]);

  const pushAnim = animState.pushAnim;
  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: `pile:${spec.zone}`,
    data: { kind: 'pile', zone: spec.zone },
  });
  const drag = useDraggable({
    id: `pile-top:${spec.zone}`,
    data: { source: { kind: 'zone', zone: spec.zone, index: 0 } },
    disabled: cards.length === 0,
  });
  const top = cards[0];
  // Future Sight mode turns the library's top card over. Every image on this
  // pile reads `faceUp` rather than `spec.faceUp` so the card under a drag and
  // the card sliding in on a push turn over with it — whatever ends up on top
  // is the card that's revealed.
  const faceUp = spec.faceUp || (spec.zone === 'library' && libraryRevealed);
  // While a push animates, render the base image from the frozen previous top
  // (undefined for first-card-into-empty-pile so the Icon shows behind).
  const baseTop = pushAnim ? animState.frozenTop : top;
  const Icon = spec.Icon;
  const imgRef = useRef<HTMLDivElement | null>(null);
  const [hovered, setHovered] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const magnified = useMagnifyHover(hovered);
  const showPreview = magnified && faceUp && top && !drag.isDragging;

  const onClickPile = () => {
    if (cards.length === 0) return;
    if (spec.zone === 'library') {
      draw(1);
      return;
    }
    moveCard({
      source: { kind: 'zone', zone: spec.zone, index: 0 },
      target: { kind: 'battlefield', x: 50, y: 0, arrived: true },
    });
  };

  /**
   * Right-click opens that zone's actions at the cursor.
   *
   * It used to open the zone viewer, with the actions on a button above the
   * pile — which had the two the wrong way round. A right-click is the gesture
   * this playtest already uses for "what can I do to this thing" everywhere
   * else (a card in hand, a permanent on the table), and the pile is the thing
   * those actions act on. Looking inside a zone is the steady, repeated job, so
   * it took the permanent button instead: see `<ZoneSearch />`.
   *
   * The command zone keeps opening its viewer, because it has no actions menu —
   * there is nothing you do to the command zone as a whole.
   */
  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    if (spec.zone === 'command') {
      if (currentModal?.kind === 'zoneViewer' && currentModal.zone === 'command') {
        closeModal();
        return;
      }
      if (cards.length === 0) return;
      openModal({ kind: 'zoneViewer', zone: 'command' });
      return;
    }
    setMenu({ x: e.clientX, y: e.clientY });
  };

  const interactive = cards.length > 0;
  // There is no right-click on a phone, and no number to type either. The zone
  // menus that clause pointed at are reachable from the Deck / Grave / Exile
  // buttons in the hand toolbar below 768px, so the hint drops rather than
  // sending touch users after a gesture their device doesn't have.
  const actionHint = spec.zone === 'command'
    ? `right-click to view ${spec.label.toLowerCase()}`
    : `right-click for ${spec.label.toLowerCase()} actions`;
  const titleText = !interactive
    ? spec.label
    : spec.zone === 'library'
      ? isDesktop
        ? `Click to draw a card · type a number to draw that many · ${actionHint}`
        : 'Tap to draw a card'
      : isDesktop
        ? `Click to play top card · type a number to take that many to hand · ${actionHint}`
        : 'Tap to play the top card';

  return (
    <>
    <div
      ref={setDropRef}
      onClick={onClickPile}
      onContextMenu={onContextMenu}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      title={titleText}
      // Flights measure their destination off this rather than assuming a
      // size, so the piles can be resized or moved without touching them.
      data-pile={spec.zone}
      className={`relative rounded border ${spec.bgClass} p-1.5 text-center transition-all select-none ${interactive ? 'hover:brightness-125 cursor-pointer' : 'opacity-60'} ${isOver ? 'ring-2 ring-primary' : ''}`}
    >
      <div
        ref={imgRef}
        onMouseEnter={() => { setHovered(true); setHoveredPile(spec.zone); }}
        onMouseLeave={() => { setHovered(false); setHoveredPile(null); }}
        className="aspect-[5/7] w-full rounded-[6px] overflow-hidden bg-black/20 flex items-center justify-center relative"
      >
        {!baseTop && <Icon className="w-6 h-6 opacity-60" />}
        {cards.length > 0 && (
          <>
          {drag.isDragging && cards.length > 1 && (
            <img
              src={faceUp ? getCardImageUrl(cards[1], 'small') : `${import.meta.env.BASE_URL}card-back.png`}
              alt=""
              aria-hidden
              className="absolute inset-0 w-full h-full object-cover pointer-events-none rounded-[6px]"
              draggable={false}
            />
          )}
          <div
            ref={drag.setNodeRef}
            {...drag.attributes}
            {...drag.listeners}
            className={`absolute inset-0 cursor-grab touch-none select-none ${drag.isDragging ? 'opacity-0' : ''} ${jiggle ? 'animate-jiggle' : ''}`}
          >
            {baseTop && (
              <img
                src={faceUp ? getCardImageUrl(baseTop, 'small') : `${import.meta.env.BASE_URL}card-back.png`}
                alt={faceUp ? baseTop.name : spec.label}
                className="w-full h-full object-cover pointer-events-none"
                draggable={false}
              />
            )}
            {pushAnim && (
              <img
                key={pushAnim.tick}
                src={faceUp ? getCardImageUrl(top, 'small') : `${import.meta.env.BASE_URL}card-back.png`}
                alt=""
                aria-hidden
                className={`absolute inset-0 w-full h-full object-cover pointer-events-none rounded-[6px] shadow-lg ${pushAnim.isFirst ? 'animate-soft-in' : 'animate-deal-in'}`}
                draggable={false}
              />
            )}
          </div>
          </>
        )}
        {/* A typed number waits ~half a second for a second digit. Showing it
            building up is what makes that pause read as "still listening"
            rather than as a keystroke that went nowhere. */}
        {pendingDraw !== null && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/55 pointer-events-none rounded-[6px]">
            <span className="text-2xl font-bold tabular-nums text-white drop-shadow">{pendingDraw}</span>
          </div>
        )}
        {drawAnim > 0 && (
          <img
            key={drawAnim}
            src={`${import.meta.env.BASE_URL}card-back.png`}
            alt=""
            aria-hidden
            className="absolute inset-0 w-full h-full object-cover pointer-events-none rounded-[6px] shadow-lg animate-deal-out"
            draggable={false}
          />
        )}
      </div>
      {/* Shuffle lives on the library itself rather than in the actions bar —
          it's a library-only action, so it belongs next to the library. Sits
          above the drag layer, and swallows the click so the pile doesn't
          also draw a card. */}
      {spec.zone === 'library' && cards.length > 1 && (
        <Button
          variant="secondary"
          size="icon"
          title="Shuffle library (S)"
          aria-label="Shuffle library"
          // 28px on phones: the pile under it is draggable, so a missed tap
          // starts a drag instead of shuffling. Desktop keeps its 20px chip.
          className="absolute top-0.5 right-0.5 z-10 h-7 w-7 md:h-5 md:w-5 rounded-md bg-blue-950/70 hover:bg-blue-900/90 text-blue-100/80 hover:text-blue-50 border border-blue-400/30 shadow-none [&_svg]:size-4 md:[&_svg]:size-3"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); shuffle(); }}
        >
          <Shuffle />
        </Button>
      )}
      {/* A face-up library is unusual enough that it needs saying why: the eye
          marks it as the deliberate mode it is rather than a card someone
          left turned over, and doubles as the way back out of it. Opposite
          corner from Shuffle so neither is a mis-tap for the other. */}
      {spec.zone === 'library' && libraryRevealed && (
        <Button
          variant="secondary"
          size="icon"
          title="Top card of your library is revealed — click to turn it back down"
          aria-label="Stop playing with the top card revealed"
          aria-pressed
          className="absolute top-0.5 left-0.5 z-10 h-7 w-7 md:h-5 md:w-5 rounded-md bg-blue-950/70 hover:bg-blue-900/90 text-blue-200 hover:text-blue-50 border border-blue-400/40 shadow-none [&_svg]:size-4 md:[&_svg]:size-3"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); toggleLibraryRevealed(); }}
        >
          <Eye />
        </Button>
      )}
      {showPreview && top && <MagnifiedPreview card={top} anchorRef={imgRef} />}
      {spec.zone === 'command' ? (
        <CommanderTax />
      ) : (
        <div className={`mt-1 text-[10px] flex items-center justify-between gap-1 px-0.5 ${cards.length === 0 ? 'opacity-60' : ''}`}>
          <span className="truncate">{spec.label}</span>
          <span className="font-bold tabular-nums">{cards.length}</span>
        </div>
      )}
    </div>
    {/* A SIBLING of the pile, not a child of it, and the distinction is not
        cosmetic: a React portal bubbles its events through the React tree
        rather than the DOM one, so a menu mounted inside that div would fire
        the pile's own onClick — every action you picked would also draw a card
        or play the top of the graveyard. Rendering it out here is what stops
        that; the portal itself occupies no space in the flex column. */}
    {menu && spec.zone !== 'command' && (
      <ZoneActionsContextMenu
        zone={spec.zone}
        x={menu.x}
        y={menu.y}
        onClose={() => setMenu(null)}
      />
    )}
    </>
  );
}

/**
 * The command pile's footer counts commander tax rather than cards. A count of
 * "1" under a pile that shows your commander's face was the least useful number
 * on the table; the +2 per cast is the one you actually have to hold in your
 * head, and nothing else here was tracking it.
 *
 * Stepped by hand on purpose. The store can see a card leave the command zone
 * but not whether that was a cast — putting it into play with Elesh Norn's
 * ability, say, taxes nothing — so an automatic count would be wrong exactly
 * when you were relying on it.
 */
function CommanderTax() {
  const tax = usePlaytestStore(s => s.commanderTax);
  const adjust = usePlaytestStore(s => s.adjustCommanderTax);
  // The pile itself plays its top card on click and opens the zone on
  // right-click. Neither should fire from the stepper.
  const hit = (delta: number) => (e: React.MouseEvent) => { e.stopPropagation(); adjust(delta); };

  return (
    // The negative margin cancels the pile's own horizontal padding: the
    // floating phone pile is 56px wide and a label, two buttons and the number
    // do not fit inside it otherwise.
    <div
      className="mt-1 -mx-1 flex items-center gap-0 md:gap-0.5 text-[10px]"
      onContextMenu={e => e.stopPropagation()}
    >
      {/* The word only fits on the hand-row pile; the floating phone pile is
          56px wide and the stepper needs all of it. */}
      <span className="hidden md:inline min-w-0 truncate text-muted-foreground">Tax</span>
      <Button
        variant="ghost"
        size="icon"
        title="Commander tax down 2"
        aria-label="Commander tax down 2"
        disabled={tax === 0}
        className="ml-auto h-4 w-4 rounded shrink-0 text-purple-200/70 hover:text-purple-50 hover:bg-purple-500/25 disabled:opacity-30 [&_svg]:size-3"
        onPointerDown={e => e.stopPropagation()}
        onClick={hit(-2)}
      >
        <Minus />
      </Button>
      <span
        className={`font-bold tabular-nums leading-none ${tax === 0 ? 'text-muted-foreground' : 'text-purple-100'}`}
        title={`Commander tax: +${tax} to cast from the command zone`}
      >
        +{tax}
      </span>
      <Button
        variant="ghost"
        size="icon"
        title="Commander tax up 2"
        aria-label="Commander tax up 2"
        className="h-4 w-4 rounded shrink-0 text-purple-200/70 hover:text-purple-50 hover:bg-purple-500/25 [&_svg]:size-3"
        onPointerDown={e => e.stopPropagation()}
        onClick={hit(2)}
      >
        <Plus />
      </Button>
    </div>
  );
}
