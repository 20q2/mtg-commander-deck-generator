const COLORS = ['W', 'U', 'B', 'R', 'G', 'C'] as const;

export interface ColorFilterChipsProps {
  value: Set<string>;
  onChange: (next: Set<string>) => void;
  /** Layout for the row; defaults to centered (how the commander tabs use it). */
  className?: string;
}

/**
 * The WUBRG(+C) mana-pip toggle row, shared by commander discovery and card-group search.
 * Colorless is mutually exclusive with the five colors — picking C clears them and vice versa.
 * Selection semantics are the caller's business: commander discovery treats it as "show me
 * these colors", card-group search treats it as a ceiling on the commander's identity.
 */
export function ColorFilterChips({ value, onChange, className }: ColorFilterChipsProps) {
  const toggle = (color: string) => {
    const next = new Set(value);
    if (next.has(color)) {
      next.delete(color);
    } else {
      next.add(color);
      if (color === 'C') {
        next.forEach(c => { if (c !== 'C') next.delete(c); });
      } else {
        next.delete('C');
      }
    }
    onChange(next);
  };

  return (
    <div className={className ?? 'flex justify-center gap-1.5 mb-1.5'}>
      {COLORS.map(color => (
        <button
          key={color}
          onClick={() => toggle(color)}
          className={`w-8 h-8 rounded-full flex items-center justify-center transition-all ${
            value.has(color)
              ? 'ring-2 ring-primary ring-offset-2 ring-offset-background scale-110'
              : 'opacity-50 hover:opacity-80'
          }`}
          title={color === 'C' ? 'Colorless' : color}
        >
          <i className={`ms ms-${color.toLowerCase()} ms-cost text-lg`} />
        </button>
      ))}
      <button
        onClick={() => onChange(new Set())}
        className={`text-xs text-muted-foreground hover:text-foreground transition-all duration-200 self-center overflow-hidden whitespace-nowrap ${value.size > 0 ? 'opacity-100 max-w-[3rem] ml-1' : 'opacity-0 max-w-0 ml-0'}`}
      >
        Clear
      </button>
    </div>
  );
}
