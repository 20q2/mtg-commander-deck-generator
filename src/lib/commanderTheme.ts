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

// Vibrant versions for --primary (buttons, toggles, selected states)
const MTG_PRIMARY: Record<string, string> = {
  W: '45 65% 50%',    // Bright amber/gold
  U: '210 70% 50%',   // Bright blue
  B: '270 50% 45%',   // Bright violet
  R: '0 70% 48%',     // Bright red
  G: '150 55% 38%',   // Bright green
  C: '220 15% 48%',   // Bright slate
  GOLD: '42 65% 48%', // Bright gold
};

// Curated primary colors for each 2-color guild pair (WUBRG order keys)
const GUILD_PRIMARY: Record<string, string> = {
  'WU': '210 60% 52%',   // Azorius - cool blue with white brightness
  'WB': '260 20% 50%',   // Orzhov - pale silver-violet
  'WR': '25 70% 50%',    // Boros - warm sunfire gold
  'WG': '85 50% 42%',    // Selesnya - verdant gold
  'UB': '235 50% 48%',   // Dimir - deep indigo
  'UR': '265 65% 52%',   // Izzet - electric purple
  'UG': '180 55% 40%',   // Simic - biotech teal
  'BR': '350 60% 44%',   // Rakdos - blood crimson
  'BG': '140 35% 36%',   // Golgari - mossy dark green
  'RG': '28 65% 46%',    // Gruul - savage amber
};

// Default theme values
const DEFAULT_PRIMARY = '262 83% 58%';
const DEFAULT_RING = '262 83% 58%';
const DEFAULT_BORDER = '220 13% 20%';

export function applyCommanderTheme(colors: string[]) {
  const root = document.documentElement;

  if (colors.length === 0) {
    // Colorless
    root.style.setProperty('--primary', MTG_PRIMARY['C']);
    root.style.setProperty('--ring', MTG_COLORS['C']);
    root.style.setProperty('--border', MTG_COLORS['C']);
  } else if (colors.length === 1) {
    // Mono-color
    root.style.setProperty('--primary', MTG_PRIMARY[colors[0]]);
    root.style.setProperty('--ring', MTG_COLORS[colors[0]]);
    root.style.setProperty('--border', MTG_COLORS[colors[0]]);
  } else if (colors.length === 2) {
    // 2-color: use curated guild color for primary
    const key = colors.join('');
    root.style.setProperty('--primary', GUILD_PRIMARY[key] || MTG_PRIMARY[colors[0]]);
    root.style.setProperty('--ring', MTG_COLORS[colors[0]]);
    root.style.setProperty('--border', MTG_COLORS[colors[0]]);
    root.style.setProperty('--gradient-start', `hsl(${MTG_COLORS[colors[0]]})`);
    root.style.setProperty('--gradient-end', `hsl(${MTG_COLORS[colors[1]]})`);
    root.classList.add('commander-gradient');
  } else {
    // 3+ colors: gold/multicolor
    root.style.setProperty('--primary', MTG_PRIMARY['GOLD']);
    root.style.setProperty('--ring', MTG_COLORS['GOLD']);
    root.style.setProperty('--border', MTG_COLORS['GOLD']);
  }
}

export function resetTheme() {
  const root = document.documentElement;
  root.style.setProperty('--primary', DEFAULT_PRIMARY);
  root.style.setProperty('--ring', DEFAULT_RING);
  root.style.setProperty('--border', DEFAULT_BORDER);
  root.style.removeProperty('--gradient-start');
  root.style.removeProperty('--gradient-end');
  root.classList.remove('commander-gradient');
}
