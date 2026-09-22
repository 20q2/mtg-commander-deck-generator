import { createPortal } from 'react-dom';
import { useCardSlashes } from '@/store/cardSlashStore';

/**
 * Renders every card currently being cut in half. One fixed layer at the
 * document level, like the floating text, so the slash outlives the card it
 * came from — the permanent is already in the graveyard by the time the blade
 * lands. Sits just under the floating text, so a creature's "Dies" still reads
 * over its own corpse.
 */
export function CardSlashLayer() {
  const slashes = useCardSlashes(s => s.slashes);
  if (slashes.length === 0) return null;

  return createPortal(
    <div className="fixed inset-0 z-[290] pointer-events-none overflow-hidden" aria-hidden>
      {slashes.map(s => (
        <div
          key={s.id}
          className="pt-slash absolute"
          style={{
            left: s.x,
            top: s.y,
            width: s.width,
            height: s.height,
            transform: s.rotation ? `rotate(${s.rotation}deg)` : undefined,
            ['--slash-delay' as string]: `${s.delay}ms`,
          }}
        >
          <div className="pt-slash-piece pt-slash-top">
            <img src={s.src} alt="" draggable={false} />
          </div>
          <div className="pt-slash-piece pt-slash-bottom">
            <img src={s.src} alt="" draggable={false} />
          </div>
          {/* The blade itself, along the cut line. */}
          <div className="pt-slash-streak" />
        </div>
      ))}
    </div>,
    document.body,
  );
}
