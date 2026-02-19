import { type ReactNode } from 'react';

interface InfoTooltipProps {
  text: string;
  children?: ReactNode;
}

export function InfoTooltip({ text, children }: InfoTooltipProps) {
  return (
    <span className="relative group/tip inline-flex cursor-help text-muted-foreground hover:text-foreground transition-colors">
      {children ?? (
        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <path d="M12 16v-4" />
          <path d="M12 8h.01" />
        </svg>
      )}
      <span className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-56 rounded-lg bg-popover border border-border px-3 py-2 text-xs text-popover-foreground leading-relaxed shadow-lg opacity-0 scale-95 transition-all duration-150 group-hover/tip:opacity-100 group-hover/tip:scale-100 z-50">
        {text}
        <span className="absolute top-full left-1/2 -translate-x-1/2 -mt-px border-4 border-transparent border-t-border" />
        <span className="absolute top-full left-1/2 -translate-x-1/2 -mt-[5px] border-4 border-transparent border-t-popover" />
      </span>
    </span>
  );
}
