// MTG color to HSL mapping - subtle/glassy for borders and outlines
const MTG_COLORS: Record<string, string> = {
  W: '45 45% 38%',    // Muted amber/bronze
  U: '210 50% 40%',   // Subtle steel blue
  B: '270 30% 30%',   // Muted violet-gray
  R: '0 50% 42%',     // Muted burgundy
  G: '150 40% 32%',   // Muted teal-green
  C: '220 10% 40%',   // Neutral slate
  GOLD: '42 50% 35%', // Muted bronze for 3+ colors
};

// Vivid aurora palette — tuned to read after the 200px blur + 0.11 opacity
// of `.aurora-bg`. The MTG_COLORS map is intentionally muted for thin
// borders; those values wash out to near-gray through the aurora.
const AURORA_COLORS: Record<string, string> = {
  W: '45 70% 65%',    // warm cream / gold-tinged white
  U: '215 75% 55%',   // open-sea blue
  B: '275 50% 40%',   // deep violet (MTG black reads as purple in atmospheric UI)
  R: '5 75% 55%',     // crimson
  G: '140 60% 45%',   // forest green
  C: '220 15% 50%',   // neutral steel
  GOLD: '38 70% 55%', // warm amber for 3+ color identities
};

// Curated border colors for each 2-color guild pair (both orderings for safety)
const GUILD_BORDER: Record<string, string> = {
  'WU': '210 50% 40%',   // Azorius - steel blue
  'UW': '210 50% 40%',
  'WB': '260 20% 35%',   // Orzhov - pale silver-violet
  'BW': '260 20% 35%',
  'WR': '25 50% 40%',    // Boros - warm bronze
  'RW': '25 50% 40%',
  'WG': '85 40% 35%',    // Selesnya - verdant gold
  'GW': '85 40% 35%',
  'UB': '235 40% 35%',   // Dimir - deep indigo
  'BU': '235 40% 35%',
  'UR': '265 45% 40%',   // Izzet - electric purple
  'RU': '265 45% 40%',
  'UG': '180 45% 35%',   // Simic - biotech teal
  'GU': '180 45% 35%',
  'BR': '350 45% 38%',   // Rakdos - blood crimson
  'RB': '350 45% 38%',
  'BG': '140 30% 30%',   // Golgari - mossy dark green
  'GB': '140 30% 30%',
  'RG': '28 50% 38%',    // Gruul - savage amber
  'GR': '28 50% 38%',
};

// WUBRG sort order for consistent color ordering
const WUBRG_ORDER = ['W', 'U', 'B', 'R', 'G'];
function sortWUBRG(colors: string[]): string[] {
  return [...colors].sort((a, b) => WUBRG_ORDER.indexOf(a) - WUBRG_ORDER.indexOf(b));
}

// Default theme values
const DEFAULT_RING = '262 83% 58%';
const DEFAULT_BORDER = '220 13% 27%';

export function applyCommanderTheme(colors: string[]) {
  const root = document.documentElement;
  const sorted = sortWUBRG(colors);

  if (sorted.length === 0) {
    // Colorless
    root.style.setProperty('--ring', MTG_COLORS['C']);
    root.style.setProperty('--border', MTG_COLORS['C']);
  } else if (sorted.length === 1) {
    // Mono-color
    root.style.setProperty('--ring', MTG_COLORS[sorted[0]]);
    root.style.setProperty('--border', MTG_COLORS[sorted[0]]);
  } else if (sorted.length === 2) {
    // 2-color: use curated guild border color
    const key = sorted.join('');
    const borderColor = GUILD_BORDER[key] || MTG_COLORS[sorted[0]];
    root.style.setProperty('--ring', borderColor);
    root.style.setProperty('--border', borderColor);
    root.style.setProperty('--gradient-start', `hsl(${MTG_COLORS[sorted[0]]})`);
    root.style.setProperty('--gradient-end', `hsl(${MTG_COLORS[sorted[1]]})`);
    root.classList.add('commander-gradient');
  } else {
    // 3+ colors: gold/multicolor
    root.style.setProperty('--ring', MTG_COLORS['GOLD']);
    root.style.setProperty('--border', MTG_COLORS['GOLD']);
  }
}

export function resetTheme() {
  const root = document.documentElement;
  root.style.setProperty('--ring', DEFAULT_RING);
  root.style.setProperty('--border', DEFAULT_BORDER);
  root.style.removeProperty('--gradient-start');
  root.style.removeProperty('--gradient-end');
  root.classList.remove('commander-gradient');
}

/**
 * Pure helper — maps a color identity array to two aurora HSL triplets
 * (without the `hsl(...)` wrapper, so they compose with `/` opacity adjusters).
 *
 *   []          → both blobs neutral steel (C)
 *   [X]         → both blobs X (animation phase difference still gives motion)
 *   [X, Y]      → blob A = first WUBRG-sorted, blob B = second
 *   3+ colors   → both blobs gold (matches existing GOLD border treatment)
 *
 * Unknown letters fall back to C.
 */
export function getAuroraColors(identity: string[]): { a: string; b: string } {
  const lookup = (letter: string) => AURORA_COLORS[letter] ?? AURORA_COLORS['C'];
  if (!identity || identity.length === 0) {
    return { a: AURORA_COLORS['C'], b: AURORA_COLORS['C'] };
  }
  if (identity.length === 1) {
    const c = lookup(identity[0]);
    return { a: c, b: c };
  }
  if (identity.length === 2) {
    const sorted = sortWUBRG(identity);
    return { a: lookup(sorted[0]), b: lookup(sorted[1]) };
  }
  // 3+ colors
  return { a: AURORA_COLORS['GOLD'], b: AURORA_COLORS['GOLD'] };
}
