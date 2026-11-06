import { useState } from 'react';
import { scryfallImg } from '../constants';
import { useCommanderArt } from '@/hooks/useCommanderArt';

/** The card's art crop, not a crop of the framed card. Blank until it resolves. */
function Art({ name }: { name: string }) {
  const art = useCommanderArt(name);
  if (!art) return null;
  return <img src={art} alt="" className="w-full h-full object-cover" loading="lazy" />;
}

// ─── Hover preview ───────────────────────────────────────────────────
// Local copy of the app's established floating-preview pattern (see
// FloatingPreview in DeckDisplay and FloatingCardPreview in OverviewBento).
// All three affordances below share this one implementation rather than
// carrying three copies of it.

/** Matches the w-64 image and the ~360px it renders at, per the house recipe. */
const PREVIEW_W = 256;

function FloatingCard({ name, rect }: { name: string; rect: DOMRect }) {
  // Flip to the left of the anchor when there isn't room on the right.
  const overflowsRight = rect.right + 12 + PREVIEW_W > window.innerWidth;
  const left = overflowsRight ? rect.left - PREVIEW_W - 12 : rect.right + 12;
  const top = Math.min(
    Math.max(8, rect.top + rect.height / 2 - 180),
    window.innerHeight - 380,
  );

  return (
    <div className="fixed z-[100] pointer-events-none hidden lg:block" style={{ left, top }}>
      <img
        src={scryfallImg(name, 'normal')}
        alt=""
        className="w-64 rounded-lg shadow-2xl border border-border/50"
      />
    </div>
  );
}

/**
 * Tracks the anchor rect while hovered. Each card owns its own state — only
 * one can be hovered at a time, and leaving clears it before the next enters.
 */
function useHoverPreview() {
  const [rect, setRect] = useState<DOMRect | null>(null);
  return {
    rect,
    handlers: {
      onMouseEnter: (e: React.MouseEvent<HTMLElement>) => setRect(e.currentTarget.getBoundingClientRect()),
      onMouseLeave: () => setRect(null),
    },
  };
}

// ─── Affordances ─────────────────────────────────────────────────────

/** Art tile + name, as used in the prototype bracket views' disclosures. */
export function CardTile({ name, onPreview }: { name: string; onPreview: (name: string) => void }) {
  const { rect, handlers } = useHoverPreview();
  return (
    <>
      <button
        onClick={() => onPreview(name)}
        {...handlers}
        className="w-[104px] text-left group"
        title={name}
      >
        <div className="h-[76px] rounded-md border border-border/40 bg-accent/20 overflow-hidden group-hover:border-primary/50 transition-colors">
          <Art name={name} />
        </div>
        <p className="text-[11px] leading-snug text-foreground/75 group-hover:text-primary transition-colors mt-1.5 line-clamp-2">
          {name}
        </p>
      </button>
      {rect && <FloatingCard name={name} rect={rect} />}
    </>
  );
}

/** Inline chip — art + name in a rounded pill. */
export function CardPill({ name, onPreview }: { name: string; onPreview: (name: string) => void }) {
  const { rect, handlers } = useHoverPreview();
  return (
    <>
      <button
        onClick={() => onPreview(name)}
        {...handlers}
        className="flex items-center gap-2 pl-1 pr-2.5 py-1 rounded-md bg-card border border-border/40 hover:border-primary/50 transition-colors group"
        title={name}
      >
        <span className="w-7 h-5 rounded-sm bg-accent/20 overflow-hidden shrink-0">
          <Art name={name} />
        </span>
        <span className="text-[11.5px] text-foreground/75 group-hover:text-primary transition-colors">
          {name}
        </span>
      </button>
      {rect && <FloatingCard name={name} rect={rect} />}
    </>
  );
}
