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
  className?: string;
}

/**
 * Archidekt-style segmented color-identity strip: one equal segment per color
 * in WUBRG order with a Mana Font pip centered in each. Colorless renders a
 * single gray segment. Doubles as an art/text separator on deck cards.
 */
export function ColorIdentityBar({ colorIdentity, className = '' }: ColorIdentityBarProps) {
  const present = new Set((colorIdentity ?? []).map(c => c.toUpperCase()));
  const colors = WUBRG_ORDER.filter(c => present.has(c));
  const segments = colors.length > 0 ? colors : (['C'] as const);

  return (
    <div className={`flex h-[18px] ${className}`} aria-hidden>
      {segments.map(c => (
        <span key={c} className={`flex-1 flex items-center justify-center ${SEGMENT_BG[c]}`}>
          <i className={`ms ms-${c.toLowerCase()} ms-cost text-[11px] opacity-90`} />
        </span>
      ))}
    </div>
  );
}
