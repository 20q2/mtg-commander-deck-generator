const WUBRG_ORDER = ['W', 'U', 'B', 'R', 'G'] as const;

/** Muted takes on the classic mana colors — segment backgrounds. */
const SEGMENT_BG: Record<string, string> = {
  W: 'bg-[#f0ead8]',
  U: 'bg-[#a8c4e0]',
  B: 'bg-[#a89f9b]',
  R: 'bg-[#e0a183]',
  G: 'bg-[#a7c0a8]',
  C: 'bg-[#b9b3ad]',
};

interface ColorIdentityBarProps {
  /** Scryfall color letters (any order/case). Empty/undefined = colorless. */
  colorIdentity?: string[];
  /** Cards-per-color counts — segment widths become proportional to these.
   *  Omitted/missing colors fall back to equal widths. */
  colorBreakdown?: Record<string, number>;
  className?: string;
}

/**
 * Archidekt-style segmented color-identity strip: one segment per color in
 * WUBRG order, width proportional to how much of the deck is that color, with
 * a flat Mana Font glyph set inside each segment. Colorless renders a single
 * gray segment. Doubles as an art/text separator on deck cards.
 */
export function ColorIdentityBar({ colorIdentity, colorBreakdown, className = '' }: ColorIdentityBarProps) {
  const present = new Set((colorIdentity ?? []).map(c => c.toUpperCase()));
  const colors = WUBRG_ORDER.filter(c => present.has(c));
  const segments = colors.length > 0 ? colors : (['C'] as const);

  return (
    <div className={`flex h-[18px] ${className}`} aria-hidden>
      {segments.map(c => {
        const weight = colorBreakdown?.[c] ?? 1;
        return (
          <span
            key={c}
            style={{ flexGrow: Math.max(weight, 1) }}
            className={`basis-0 min-w-6 flex items-center justify-center ${SEGMENT_BG[c]} text-[#151021]/75`}
          >
            <i className={`ms ms-${c.toLowerCase()} text-[11px]`} />
          </span>
        );
      })}
    </div>
  );
}
