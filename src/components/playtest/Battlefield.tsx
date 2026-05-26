import React, { useEffect, useRef, useState } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { usePlaytestStore } from '@/store/playtestStore';
import { usePlaytestSettings, BG_STYLES, CARD_SIZES } from '@/store/playtestSettingsStore';
import { BattlefieldCard } from '@/components/playtest/BattlefieldCard';
import { FreeCounter } from '@/components/playtest/FreeCounter';
import { FreeDie } from '@/components/playtest/FreeDie';
import { BattlefieldContextMenu, type BattlefieldMenuTarget } from '@/components/playtest/BattlefieldContextMenu';
import { PlaytestPile, PILES } from '@/components/playtest/PlaytestPile';
import { useMediaQuery } from '@/hooks/useMediaQuery';

export function Battlefield() {
  const cards = usePlaytestStore(s => s.battlefield);
  const freeCounters = usePlaytestStore(s => s.freeCounters);
  const freeDice = usePlaytestStore(s => s.freeDice);
  const setRect = usePlaytestStore(s => s.setBattlefieldRect);
  const setMarqueeSelection = usePlaytestStore(s => s.setMarqueeSelection);
  const clearSelection = usePlaytestStore(s => s.clearSelection);
  const bg = usePlaytestSettings(s => s.bg);
  const dotGrid = usePlaytestSettings(s => s.dotGrid);
  // Tailwind's md breakpoint is 768px. Keep the floating piles to mobile so
  // the desktop hand-row piles don't share dnd-kit IDs with floating ones.
  const isDesktop = useMediaQuery('(min-width: 768px)');
  const containerRef = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<BattlefieldMenuTarget | null>(null);
  const [marquee, setMarquee] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const cardsRef = useRef(cards);
  cardsRef.current = cards;
  const countersRef = useRef(freeCounters);
  countersRef.current = freeCounters;
  const diceRef = useRef(freeDice);
  diceRef.current = freeDice;

  // Track size for arrival snap
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => {
      const r = el.getBoundingClientRect();
      setRect(r.width, r.height);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [setRect]);

  const { setNodeRef } = useDroppable({ id: 'battlefield', data: { kind: 'battlefield' } });
  const composedRef = (node: HTMLDivElement | null) => {
    (containerRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
    setNodeRef(node);
  };

  // Render parents first, attached children after parents (z-order)
  const sorted = [...cards].sort((a, b) => {
    if (!a.attachedTo && b.attachedTo) return -1;
    if (a.attachedTo && !b.attachedTo) return 1;
    return 0;
  });

  const onContextMenu = (e: React.MouseEvent<HTMLDivElement>) => {
    // Only fire when right-clicking the empty battlefield, not a card / counter.
    if (e.target !== e.currentTarget) return;
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    setMenu({
      screenX: e.clientX,
      screenY: e.clientY,
      bfX: e.clientX - rect.left,
      bfY: e.clientY - rect.top,
    });
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    if (e.target !== e.currentTarget) return; // only on empty battlefield
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const startX = x;
    const startY = y;
    let movedFar = false;

    const containerEl = e.currentTarget;
    containerEl.setPointerCapture(e.pointerId);

    const onMove = (ev: PointerEvent) => {
      const cx = ev.clientX - rect.left;
      const cy = ev.clientY - rect.top;
      if (!movedFar && Math.hypot(cx - startX, cy - startY) > 3) movedFar = true;
      if (movedFar) {
        setMarquee({ x0: startX, y0: startY, x1: cx, y1: cy });
      }
    };
    const onUp = (ev: PointerEvent) => {
      containerEl.removeEventListener('pointermove', onMove);
      containerEl.removeEventListener('pointerup', onUp);
      containerEl.removeEventListener('pointercancel', onUp);
      try { containerEl.releasePointerCapture(ev.pointerId); } catch { /* noop */ }

      if (!movedFar) {
        // Plain click on empty battlefield → clear selection.
        clearSelection();
        setMarquee(null);
        return;
      }

      const cx = ev.clientX - rect.left;
      const cy = ev.clientY - rect.top;
      const l = Math.min(startX, cx);
      const r = Math.max(startX, cx);
      const t = Math.min(startY, cy);
      const b = Math.max(startY, cy);
      const { width: cw, height: ch } = CARD_SIZES[usePlaytestSettings.getState().cardSize];
      const cardHits: string[] = [];
      for (const c of cardsRef.current) {
        const cl = c.x;
        const ct = c.y;
        const cr = cl + cw;
        const cb = ct + ch;
        if (l < cr && r > cl && t < cb && b > ct) cardHits.push(c.instanceId);
      }
      // Counters are 34×34 squares; dice are 44×44.
      const counterHits: string[] = [];
      for (const fc of countersRef.current) {
        if (l < fc.x + 34 && r > fc.x && t < fc.y + 34 && b > fc.y) counterHits.push(fc.id);
      }
      const dieHits: string[] = [];
      for (const fd of diceRef.current) {
        if (l < fd.x + 44 && r > fd.x && t < fd.y + 44 && b > fd.y) dieHits.push(fd.id);
      }
      setMarqueeSelection({ cards: cardHits, counters: counterHits, dice: dieHits });
      setMarquee(null);
    };
    containerEl.addEventListener('pointermove', onMove);
    containerEl.addEventListener('pointerup', onUp);
    containerEl.addEventListener('pointercancel', onUp);
  };

  return (
    <div
      ref={composedRef}
      data-battlefield
      onContextMenu={onContextMenu}
      onPointerDown={onPointerDown}
      className="flex-1 relative border-b border-border/50 overflow-hidden"
      style={{ background: BG_STYLES[bg].background }}
    >
      {dotGrid && (
        <div
          aria-hidden
          className="absolute inset-0 pointer-events-none"
          style={{
            backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.10) 1px, transparent 1.4px)',
            backgroundSize: '24px 24px',
            backgroundPosition: '0 0',
            zIndex: 0,
          }}
        />
      )}
      {sorted.map(b => <BattlefieldCard key={b.instanceId} card={b} />)}
      {freeCounters.map(c => <FreeCounter key={c.id} counter={c} />)}
      {freeDice.map(d => <FreeDie key={d.id} die={d} />)}

      {/* Mobile-only: zones float at the edges of the battlefield. On desktop
          they live in the hand row below. We conditionally RENDER (not just
          hide) so dnd-kit doesn't see duplicate droppable/draggable IDs. */}
      {!isDesktop && <FloatingPilesCluster />}

      {marquee && (
        <div
          className="absolute pointer-events-none border border-primary/80 bg-primary/15"
          style={{
            left: Math.min(marquee.x0, marquee.x1),
            top: Math.min(marquee.y0, marquee.y1),
            width: Math.abs(marquee.x1 - marquee.x0),
            height: Math.abs(marquee.y1 - marquee.y0),
            zIndex: 65,
          }}
        />
      )}
      <BattlefieldContextMenu target={menu} onClose={() => setMenu(null)} />
    </div>
  );
}

function FloatingPilesCluster() {
  // PILES[0] = command, PILES[2] = graveyard, PILES[3] = exile
  return (
    <>
      {/* Command zone — anchored to the top-right, where it's been. */}
      <div className="absolute top-2 right-2 z-20 flex flex-col gap-1.5 items-end">
        <FloatingPile spec={PILES[0]} />
      </div>
      {/* Library + Graveyard + Exile — bottom-aligned to the playtest area
          so the deck (most-touched pile) is closest to the hand. */}
      <div className="absolute bottom-2 right-2 z-20 flex flex-col gap-1.5 items-end">
        <FloatingPile spec={PILES[3]} />
        <FloatingPile spec={PILES[2]} />
        <FloatingPile spec={PILES[1]} />
      </div>
    </>
  );
}

function FloatingPile({ spec }: { spec: typeof PILES[number] }) {
  const cards = usePlaytestStore(s => s.zones[spec.zone]);
  const hasCards = cards.length > 0;
  // Desktop: collapsed 56px, expands to 110px on hover / focus.
  // Mobile: stays at a fixed compact size with no expand animation
  //         (the user can tap to play / right-click for the dialog as usual).
  return (
    <div
      className={`w-[56px] md:hover:w-[110px] md:focus-within:w-[110px] md:transition-all md:duration-200 ${!hasCards ? 'opacity-70' : ''}`}
    >
      <PlaytestPile spec={spec} />
    </div>
  );
}
