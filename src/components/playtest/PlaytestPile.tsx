import { useEffect, useRef, useState } from 'react';
import { Sparkles, BookOpen, Trash2, Crown } from 'lucide-react';
import { useDroppable, useDraggable } from '@dnd-kit/core';
import { usePlaytestStore } from '@/store/playtestStore';
import { getCardImageUrl } from '@/services/scryfall/client';
import { MagnifiedPreview } from '@/components/playtest/MagnifiedPreview';
import { useMagnifyKey } from '@/hooks/useMagnifyKey';
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

export function PlaytestPile({ spec }: { spec: PileSpec }) {
  const cards = usePlaytestStore(s => s.zones[spec.zone]);
  const openModal = usePlaytestStore(s => s.openModal);
  const closeModal = usePlaytestStore(s => s.closeModal);
  const currentModal = usePlaytestStore(s => s.modal);
  const moveCard = usePlaytestStore(s => s.moveCard);
  const setHoveredPile = usePlaytestStore(s => s.setHoveredPile);
  const draw = usePlaytestStore(s => s.draw);
  const shuffleTick = usePlaytestStore(s => s.shuffleTick);
  const libraryTopPushTick = usePlaytestStore(s => s.libraryTopPushTick);
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
  // While a push animates, render the base image from the frozen previous top
  // (undefined for first-card-into-empty-pile so the Icon shows behind).
  const baseTop = pushAnim ? animState.frozenTop : top;
  const Icon = spec.Icon;
  const imgRef = useRef<HTMLDivElement | null>(null);
  const [hovered, setHovered] = useState(false);
  const magnify = useMagnifyKey();
  const showPreview = magnify && hovered && spec.faceUp && top && !drag.isDragging;

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

  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    if (currentModal?.kind === 'zoneViewer' && currentModal.zone === spec.zone) {
      closeModal();
      return;
    }
    if (cards.length === 0 && spec.zone !== 'library') return;
    openModal({ kind: 'zoneViewer', zone: spec.zone });
  };

  const interactive = cards.length > 0;
  const titleText = !interactive
    ? spec.label
    : spec.zone === 'library'
      ? `Click to draw a card · right-click to search ${spec.label.toLowerCase()}`
      : `Click to play top card · right-click to view ${spec.label.toLowerCase()}`;

  return (
    <div
      ref={setDropRef}
      onClick={onClickPile}
      onContextMenu={onContextMenu}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      title={titleText}
      className={`relative rounded-lg border ${spec.bgClass} p-1.5 text-center transition-all select-none ${interactive ? 'hover:brightness-125 cursor-pointer' : 'opacity-60'} ${isOver ? 'ring-2 ring-primary' : ''}`}
    >
      <div
        ref={imgRef}
        onMouseEnter={() => { setHovered(true); setHoveredPile(spec.zone); }}
        onMouseLeave={() => { setHovered(false); setHoveredPile(null); }}
        className="aspect-[5/7] w-full rounded-[5px] overflow-hidden bg-black/20 flex items-center justify-center relative"
      >
        {!baseTop && <Icon className="w-6 h-6 opacity-60" />}
        {cards.length > 0 && (
          <>
          {drag.isDragging && cards.length > 1 && (
            <img
              src={spec.faceUp ? getCardImageUrl(cards[1], 'small') : `${import.meta.env.BASE_URL}card-back.png`}
              alt=""
              aria-hidden
              className="absolute inset-0 w-full h-full object-cover pointer-events-none rounded-[5px]"
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
                src={spec.faceUp ? getCardImageUrl(baseTop, 'small') : `${import.meta.env.BASE_URL}card-back.png`}
                alt={spec.faceUp ? baseTop.name : spec.label}
                className="w-full h-full object-cover pointer-events-none"
                draggable={false}
              />
            )}
            {pushAnim && (
              <img
                key={pushAnim.tick}
                src={spec.faceUp ? getCardImageUrl(top, 'small') : `${import.meta.env.BASE_URL}card-back.png`}
                alt=""
                aria-hidden
                className={`absolute inset-0 w-full h-full object-cover pointer-events-none rounded-[5px] shadow-lg ${pushAnim.isFirst ? 'animate-soft-in' : 'animate-deal-in'}`}
                draggable={false}
              />
            )}
          </div>
          </>
        )}
      </div>
      {showPreview && top && <MagnifiedPreview card={top} anchorRef={imgRef} />}
      <div className={`mt-1 text-[10px] flex items-center justify-between gap-1 px-0.5 ${cards.length === 0 ? 'opacity-60' : ''}`}>
        <span className="truncate">{spec.label}</span>
        <span className="font-bold tabular-nums">{cards.length}</span>
      </div>
    </div>
  );
}
