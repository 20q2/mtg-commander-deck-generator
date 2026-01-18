// MTG color to HSL mapping - subtle/glassy with 3:1+ contrast for white text
const MTG_COLORS: Record<string, string> = {
  W: '45 45% 38%',    // Muted amber/bronze
  U: '210 50% 40%',   // Subtle steel blue
  B: '270 30% 30%',   // Muted violet-gray
  R: '0 50% 42%',     // Muted burgundy
  G: '150 40% 32%',   // Muted teal-green
  C: '220 10% 40%',   // Neutral slate
  GOLD: '42 50% 35%', // Muted bronze for 3+ colors
};

// Default theme values
const DEFAULT_RING = '262 83% 58%';
const DEFAULT_BORDER = '220 13% 20%';

export function applyCommanderTheme(colors: string[]) {
  const root = document.documentElement;

  if (colors.length === 0) {
    // Colorless - use gray for outlines only
    root.style.setProperty('--ring', MTG_COLORS['C']);
    root.style.setProperty('--border', MTG_COLORS['C']);
  } else if (colors.length === 1) {
    // Mono-color - use that color for outlines
    root.style.setProperty('--ring', MTG_COLORS[colors[0]]);
    root.style.setProperty('--border', MTG_COLORS[colors[0]]);
  } else if (colors.length === 2) {
    // 2-color: set gradient for outlines
    root.style.setProperty('--ring', MTG_COLORS[colors[0]]);
    root.style.setProperty('--border', MTG_COLORS[colors[0]]);
    root.style.setProperty('--gradient-start', `hsl(${MTG_COLORS[colors[0]]})`);
    root.style.setProperty('--gradient-end', `hsl(${MTG_COLORS[colors[1]]})`);
    root.classList.add('commander-gradient');
  } else {
    // 3+ colors: gold/multicolor for outlines
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
