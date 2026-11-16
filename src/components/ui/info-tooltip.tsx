import { type ReactNode, useState, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';

interface InfoTooltipProps {
  text: string;
  children?: ReactNode;
  placement?: 'top' | 'bottom';
}

const BUBBLE_W = 224; // w-56
const EDGE = 8;       // keep this far from the viewport edge

export function InfoTooltip({ text, children, placement = 'top' }: InfoTooltipProps) {
  const [visible, setVisible] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0, arrow: BUBBLE_W / 2 });
  const ref = useRef<HTMLSpanElement>(null);
  const below = placement === 'bottom';

  const show = useCallback(() => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const anchor = rect.left + rect.width / 2;
    // Center on the anchor, but slide the bubble back inside the viewport near an edge (phones),
    // keeping the arrow pointed at the anchor.
    const half = BUBBLE_W / 2;
    const left = Math.min(Math.max(anchor, EDGE + half), window.innerWidth - EDGE - half);
    setPos({
      top: below ? rect.bottom + 8 : rect.top - 8,
      left,
      arrow: Math.min(Math.max(anchor - (left - half), 10), BUBBLE_W - 10),
    });
    setVisible(true);
  }, [below]);

  return (
    <span
      ref={ref}
      className="inline-flex cursor-help text-muted-foreground hover:text-foreground transition-colors"
      onMouseEnter={show}
      onMouseLeave={() => setVisible(false)}
      // Touch has no hover: a tap toggles the bubble.
      onClick={() => (visible ? setVisible(false) : show())}
    >
      {children ?? (
        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <path d="M12 16v-4" />
          <path d="M12 8h.01" />
        </svg>
      )}
      {visible && createPortal(
        <span
          className="pointer-events-none fixed w-56 rounded-lg bg-popover border border-border px-3 py-2 text-xs text-popover-foreground leading-relaxed shadow-lg z-[100] animate-fade-in whitespace-pre-line"
          style={{
            top: pos.top,
            left: pos.left,
            transform: `translate(-50%, ${below ? '0' : '-100%'})`,
          }}
        >
          {text}
          {below ? (
            <>
              <span className="absolute bottom-full -translate-x-1/2 -mb-px border-4 border-transparent border-b-border" style={{ left: pos.arrow }} />
              <span className="absolute bottom-full -translate-x-1/2 -mb-[5px] border-4 border-transparent border-b-popover" style={{ left: pos.arrow }} />
            </>
          ) : (
            <>
              <span className="absolute top-full -translate-x-1/2 -mt-px border-4 border-transparent border-t-border" style={{ left: pos.arrow }} />
              <span className="absolute top-full -translate-x-1/2 -mt-[5px] border-4 border-transparent border-t-popover" style={{ left: pos.arrow }} />
            </>
          )}
        </span>,
        document.body
      )}
    </span>
  );
}
