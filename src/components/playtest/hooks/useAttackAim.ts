import { useCallback, useRef, useState } from 'react';
import { useOpponentStore } from '@/store/opponentStore';
import { usePlaytestStore } from '@/store/playtestStore';
import { isCreatureCard } from '@/services/playtest/opponents/stats';
import type { Point } from '@/components/playtest/TargetArrow';

/**
 * Declaring an attack by pointing at a seat.
 *
 * Dragging the card itself was the wrong gesture for this one job: the seats
 * float above your board, so the card had to be hauled up out of its own
 * position, and where it landed had nothing to do with where it lives. Combat
 * isn't a move — the creature stays exactly where it is and a copy of it turns
 * up in the seat's attack zone — so the gesture is an arrow, the same one the
 * blocker slots already pull down at your creatures.
 *
 * Not dnd-kit, deliberately. The card must not move, must not go transparent,
 * and must not be measured against every droppable on the table; all that is
 * wanted is a line, a hit test, and one store call.
 */

/** Matches the DndContext's PointerSensor, so a tap still taps. */
const SLOP = 5;

/**
 * Everything this aim is carrying: the creature you grabbed, plus the rest of
 * the marquee selection it belongs to.
 *
 * The same rule dragging already follows — one card of a selected group takes
 * the group with it — because declaring an alpha strike one creature at a time
 * is the most tedious thing in the playtest and the selection is right there
 * saying which creatures you meant.
 *
 * The followers are filtered to what can actually swing; the grabbed card is
 * not, so `declareAttacker` still gets to say why when you aim something that
 * cannot attack. Lands and tapped creatures caught in a marquee are simply not
 * part of the attack, rather than a stack of toasts explaining each one.
 */
function attackGroup(instanceId: string): string[] {
  const s = usePlaytestStore.getState();
  if (s.selectedIds.length < 2 || !s.selectedIds.includes(instanceId)) return [instanceId];
  const declared = new Set(Object.values(useOpponentStore.getState().declaration ?? {}).flat());
  const selected = new Set(s.selectedIds);
  const followers = s.battlefield
    .filter(b =>
      selected.has(b.instanceId) &&
      b.instanceId !== instanceId &&
      !b.tapped && !b.faceDown &&
      isCreatureCard(b.card) &&
      !declared.has(b.instanceId))
    .map(b => b.instanceId);
  return [instanceId, ...followers];
}

/** The centre of a card's box on the table, for the arrow's tail. */
function centreOf(instanceId: string): Point | null {
  const el = document.querySelector(`[data-bf-card="${CSS.escape(instanceId)}"]`);
  const r = el?.getBoundingClientRect();
  return r && r.width > 0 ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null;
}

/** The armed strip under the cursor, if any. */
function stripUnder(x: number, y: number): string | null {
  // The arrow layer is pointer-events:none and portalled to <body>, so the hit
  // test sees the strip underneath rather than the overlay.
  for (const el of document.elementsFromPoint(x, y)) {
    const strip = (el as HTMLElement).closest?.('[data-combat-strip]');
    const id = strip?.getAttribute('data-combat-strip');
    if (id) return id;
  }
  return null;
}

/** Where the arrow should end: snapped to the seat it's over, else the cursor. */
function tipFor(x: number, y: number, opponentId: string | null): Point {
  if (!opponentId) return { x, y };
  const strip = document.querySelector(`[data-combat-strip="${CSS.escape(opponentId)}"]`);
  if (!strip) return { x, y };
  const r = strip.getBoundingClientRect();
  // The near edge of the strip rather than its middle: the arrow should land on
  // the zone the copy appears in, not bury its head in the middle of the cards
  // already sitting there.
  return { x: Math.min(Math.max(x, r.left + 12), r.right - 12), y: r.bottom - 8 };
}

export function useAttackAim(instanceId: string, enabled: boolean) {
  /** One tail per creature in the attack, all pointing at the same seat. */
  const [aim, setAim] = useState<{ froms: Point[]; to: Point } | null>(null);
  /**
   * Set once the pointer has travelled far enough to count as an aim, and read
   * by the click handler that would otherwise tap the card on release.
   */
  const aimed = useRef(false);

  const start = useCallback((e: React.PointerEvent<HTMLElement>) => {
    if (!enabled || e.button !== 0) return;
    // The counter chips, loyalty shield and sticker buttons on the card are
    // still buttons during combat; don't swallow their clicks.
    if ((e.target as HTMLElement).closest('button')) return;
    // A previous aim that ended somewhere the click never landed would
    // otherwise leave the flag raised and swallow the next honest tap.
    aimed.current = false;
    e.preventDefault();
    e.stopPropagation();

    const node = e.currentTarget;
    // Measured once, at the press: the cards stay exactly where they are for
    // the whole gesture, which is the entire point of aiming rather than
    // dragging.
    const group = attackGroup(instanceId);
    const r = node.getBoundingClientRect();
    const froms = [
      { x: r.left + r.width / 2, y: r.top + r.height / 2 },
      ...group.slice(1).map(centreOf).filter((p): p is Point => !!p),
    ];
    const startX = e.clientX;
    const startY = e.clientY;
    let live = false;
    node.setPointerCapture(e.pointerId);

    const store = useOpponentStore.getState();

    const onMove = (ev: PointerEvent) => {
      if (!live) {
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < SLOP) return;
        live = true;
        aimed.current = true;
      }
      const over = stripUnder(ev.clientX, ev.clientY);
      setAim({ froms, to: tipFor(ev.clientX, ev.clientY, over) });
      store.setAttackAim({ instanceId, opponentId: over });
    };

    const onUp = (ev: PointerEvent) => {
      node.removeEventListener('pointermove', onMove);
      node.removeEventListener('pointerup', onUp);
      node.removeEventListener('pointercancel', onUp);
      try { node.releasePointerCapture(ev.pointerId); } catch { /* already gone */ }
      setAim(null);
      store.setAttackAim(null);
      if (!live) return;
      // Legality — creature, untapped, not already declared — lives in
      // declareAttacker, which also says why when it refuses.
      const over = ev.type === 'pointercancel' ? null : stripUnder(ev.clientX, ev.clientY);
      if (over) for (const id of group) store.declareAttacker(over, id);
    };

    node.addEventListener('pointermove', onMove);
    node.addEventListener('pointerup', onUp);
    node.addEventListener('pointercancel', onUp);
  }, [enabled, instanceId]);

  /** True exactly once per aim, so the release doesn't also tap the creature. */
  const consumeAimedClick = useCallback(() => {
    if (!aimed.current) return false;
    aimed.current = false;
    return true;
  }, []);

  return { aim, start, consumeAimedClick };
}
