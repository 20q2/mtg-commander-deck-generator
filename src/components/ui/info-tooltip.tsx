import { type ReactNode, useState, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';

interface InfoTooltipProps {
  text: string;
  children?: ReactNode;
}

export function InfoTooltip({ text, children }: InfoTooltipProps) {
  const [visible, setVisible] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const ref = useRef<HTMLSpanElement>(null);

  const show = useCallback(() => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    setPos({
      top: rect.top - 8,
      left: rect.left + rect.width / 2,
    });
    setVisible(true);
  }, []);

  return (
    <span
      ref={ref}
      className="inline-flex cursor-help text-muted-foreground hover:text-foreground transition-colors"
      onMouseEnter={show}
      onMouseLeave={() => setVisible(false)}
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
          className="pointer-events-none fixed w-56 rounded-lg bg-popover border border-border px-3 py-2 text-xs text-popover-foreground leading-relaxed shadow-lg z-[100] animate-fade-in"
          style={{
            top: pos.top,
            left: pos.left,
            transform: 'translate(-50%, -100%)',
          }}
        >
          {text}
          <span className="absolute top-full left-1/2 -translate-x-1/2 -mt-px border-4 border-transparent border-t-border" />
          <span className="absolute top-full left-1/2 -translate-x-1/2 -mt-[5px] border-4 border-transparent border-t-popover" />
        </span>,
        document.body
      )}
    </span>
  );
}
