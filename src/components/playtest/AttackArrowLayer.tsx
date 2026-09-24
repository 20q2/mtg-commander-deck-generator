import { useEffect, useMemo, useState } from 'react';
import { useOpponentStore } from '@/store/opponentStore';
import { usePlaytestStore } from '@/store/playtestStore';
import { ArrowLayer, ArrowMark, ARROW_ATTACK, type Point } from '@/components/playtest/TargetArrow';

/**
 * The standing arrows of your attack.
 *
 * Declaring an attack leaves the creature on your board and puts a small copy
 * of it in the seat's attack zone, which means the one thing you most want to
 * know — who is swinging at whom — is spread across two places that don't look
 * connected. So the arrow you drew to declare the attack stays: from the
 * creature, to its copy, for as long as the attack is live.
 *
 * Drawn from measured geometry every frame rather than from stored
 * coordinates. Both ends move constantly — seats are dragged and resized, the
 * copy flies in, the creature taps, the board scrolls — and a stored position
 * would be wrong within a frame of being written.
 */

/**
 * Past this many attackers the arrows stop being information and become a ball
 * of yarn — a goblin swarm declares fifty-two of them. The copies in the strip
 * still say who is attacking; the lines just stop being drawn.
 */
const MAX_ARROWS = 12;

interface Line { id: string; from: Point; to: Point }

const centre = (r: DOMRect): Point => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 });

/** Cheap change test, rounded to the pixel, so a still table doesn't re-render. */
const signature = (lines: Line[]) =>
  lines.map(l => `${l.id}:${l.from.x | 0},${l.from.y | 0},${l.to.x | 0},${l.to.y | 0}`).join('|');

export function AttackArrowLayer() {
  const declaration = useOpponentStore(s => s.declaration);
  const playerCombat = useOpponentStore(s => s.playerCombat);
  // The layer is portalled to <body> and sits above the table, so it would
  // also sit above anything the table opens on top of itself.
  const modalOpen = usePlaytestStore(s => s.modal !== null);

  // Every attacker of yours that is currently committed, declared or confirmed.
  // Both shapes are opponentId → instanceIds, and only one of them is ever set.
  const attackers = useMemo(() => {
    const ids = declaration
      ? Object.values(declaration).flat()
      : Object.values(playerCombat?.perOpponent ?? {}).flatMap(side => side.attackers);
    return [...new Set(ids)].slice(0, MAX_ARROWS);
  }, [declaration, playerCombat]);

  const [lines, setLines] = useState<Line[]>([]);
  const key = attackers.join('|');

  useEffect(() => {
    if (attackers.length === 0) { setLines([]); return; }
    let frame = 0;
    let last = '';
    const tick = () => {
      const next: Line[] = [];
      for (const id of attackers) {
        const card = document.querySelector(`[data-bf-card="${CSS.escape(id)}"]`);
        const copy = document.querySelector(`[data-attack-copy="${CSS.escape(id)}"]`);
        if (!card || !copy) continue;
        const a = card.getBoundingClientRect();
        const b = copy.getBoundingClientRect();
        if (a.width === 0 || b.width === 0) continue;
        next.push({ id, from: centre(a), to: centre(b) });
      }
      const sig = signature(next);
      if (sig !== last) { last = sig; setLines(next); }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
    // `key` stands in for the array, which is rebuilt on every store change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (lines.length === 0 || modalOpen) return null;

  return (
    // Thinner and dimmer than the arrow you dragged: this one is a fact on the
    // table you glance at, not a gesture you are in the middle of making.
    <ArrowLayer zIndex={150}>
      {lines.map(l => (
        <ArrowMark key={l.id} from={l.from} to={l.to} color={ARROW_ATTACK} width={2.5} opacity={0.55} head={10} />
      ))}
    </ArrowLayer>
  );
}
