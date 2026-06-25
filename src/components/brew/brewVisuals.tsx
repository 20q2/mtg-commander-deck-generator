import {
  Infinity as InfinityIcon, Zap, Dices, Sprout, Swords, Bomb, BookOpen, Package, Layers,
  Search, Shield, Sparkles, Star,
  type LucideIcon,
} from 'lucide-react';

/**
 * Shared "what does this operation look like" layer for interactive brewing.
 *
 * Every move the brewer makes — adding ramp, completing a combo, building the mana base —
 * has a consistent visual identity: a symbol, an accent colour, and a name. The fork, the
 * node screen, and the reactive backdrop all pull from here so a "ramp" step feels green and
 * growth-y everywhere, a "removal" step burns red, and so on.
 */

// Official MTG card-type glyphs (mana-font) — the right symbols for card-type routes.
export const CARD_TYPE_MS: Record<string, string> = {
  creature: 'ms-creature', instant: 'ms-instant', sorcery: 'ms-sorcery', artifact: 'ms-artifact',
  enchantment: 'ms-enchantment', planeswalker: 'ms-planeswalker', battle: 'ms-battle', land: 'ms-land',
};
// Functional roles aren't card types, so they get meaningful Lucide icons.
// Ramp is a Sprout — growth, lands, mana coming online.
export const ROLE_LUCIDE: Record<string, LucideIcon> = {
  ramp: Sprout, removal: Swords, boardwipe: Bomb, cardDraw: BookOpen,
};

/**
 * The six "Your deck so far" radar axes — the single source of truth for both the radar
 * (BrewStatsPanel) and the per-card role badges (RoleBadges). Sharing this list is what keeps a
 * card's corner badge icon/colour identical to its spoke on the chart. Ordered to match the radar's
 * spoke order. `hue` is a bare HSL triplet so it composes with `/ opacity`.
 */
export interface RoleAxis { key: string; label: string; hue: string; Icon: LucideIcon; }
export const ROLE_AXES: RoleAxis[] = [
  { key: 'ramp', label: 'Ramp', hue: '142 68% 52%', Icon: Sprout },
  { key: 'removal', label: 'Removal', hue: '2 80% 62%', Icon: Swords },
  { key: 'boardwipe', label: 'Wipes', hue: '22 90% 58%', Icon: Bomb },
  { key: 'cardDraw', label: 'Draw', hue: '205 82% 62%', Icon: BookOpen },
  { key: 'tutor', label: 'Tutors', hue: '275 78% 70%', Icon: Search },
  { key: 'protection', label: 'Protection', hue: '45 88% 64%', Icon: Shield },
];

/** One section-title look for the whole stats rail — Identity, role coverage, card types, curve all
 *  share it so the rail reads as one rhythm (centered cap above each chart, no per-section drift). */
export const RAIL_TITLE_CLASS =
  'text-center text-[10px] font-medium uppercase tracking-[0.24em] text-muted-foreground/75';

/** One shrink factor for the rail's three radars — keeps them identical and pulls the whole stack
 *  (identity + role + types + curve) back inside one screen so it fits neatly without scrolling. */
export const RAIL_RADAR_SCALE = 0.85;

export type RouteSymbol = { ms?: string; Icon?: LucideIcon };

/** The at-a-glance symbol for a route/operation: mana-font glyph for card types, Lucide otherwise. */
export function symbolFor(type: string, key: string | null): RouteSymbol {
  if (type === 'combo') return { Icon: InfinityIcon };
  if (type === 'lightning') return { Icon: Zap };
  if (type === 'gamble') return { Icon: Dices };
  if (type === 'manabase') return { ms: 'ms-land' };
  if (key === 'synergy') return { Icon: Sparkles };   // Hidden Synergy (lift) route
  if (key === 'elite') return { Icon: Star };          // Headliner (pick 1 of 4) route
  if (key && CARD_TYPE_MS[key]) return { ms: CARD_TYPE_MS[key] };
  if (key && ROLE_LUCIDE[key]) return { Icon: ROLE_LUCIDE[key] };
  return { Icon: type === 'bundle' ? Package : Layers };
}

/** Route/node ids look like "draft:ramp" or "combo:xyz"; pull the descriptive key, if any. */
export function routeKey(routeId: string): string | null {
  return routeId.includes(':') ? routeId.split(':')[1] : null;
}

/** A glyph at a fixed UI scale (trail dot vs. medallion). */
export function SymbolGlyph({ sym, size }: { sym: RouteSymbol; size: 'sm' | 'lg' }) {
  if (sym.ms) return <i className={`ms ${sym.ms} ${size === 'lg' ? 'text-[26px]' : 'text-[11px]'} leading-none`} />;
  if (sym.Icon) return <sym.Icon className={size === 'lg' ? 'w-7 h-7' : 'w-3 h-3'} />;
  return null;
}

/** A glyph at an arbitrary size — used for chips and the giant background watermark. */
export function BrewGlyph({ sym, className }: { sym: RouteSymbol; className?: string }) {
  if (sym.ms) return <i aria-hidden className={`ms ${sym.ms} leading-none ${className ?? ''}`} />;
  if (sym.Icon) { const Icon = sym.Icon; return <Icon aria-hidden className={className} strokeWidth={1.25} />; }
  return null;
}

export interface OperationTheme {
  key: string;
  glyph: RouteSymbol;
  /** Bare HSL triplet (no `hsl()` wrapper) so it composes with `/ opacity`. */
  color: string;
  label: string;
}

// Special route types own the whole mood regardless of their key.
const SPECIAL_THEME: Record<string, [string, string]> = {
  combo: ['172 70% 50%', 'Combo'],
  lightning: ['47 95% 60%', 'Lightning Round'],
  gamble: ['38 88% 58%', 'Gamble'],
  manabase: ['95 45% 48%', 'Mana Base'],
};

// Otherwise the role / card type sets the complexion.
const KEY_THEME: Record<string, [string, string]> = {
  ramp: ['142 68% 50%', 'Ramp'],            // green growth
  removal: ['2 78% 60%', 'Removal'],        // burning red
  boardwipe: ['22 88% 56%', 'Board Wipe'],  // ember orange
  cardDraw: ['205 82% 60%', 'Card Draw'],   // clear azure
  synergy: ['292 76% 64%', 'Hidden Synergy'], // fuchsia lift — matches the in-pack discovery flavor
  elite: ['275 78% 70%', 'Headliner'],       // royal violet — the standout pick
  creature: ['108 52% 52%', 'Creatures'],   // leaf green
  instant: ['190 78% 58%', 'Instants'],     // cyan
  sorcery: ['338 70% 60%', 'Sorceries'],    // magenta
  artifact: ['210 16% 66%', 'Artifacts'],   // steel
  enchantment: ['45 80% 66%', 'Enchantments'], // gold
  planeswalker: ['265 76% 66%', 'Planeswalkers'], // violet
  battle: ['15 74% 55%', 'Battles'],        // rust
  land: ['95 45% 48%', 'Lands'],            // earthy green
};

/** Resolve the operation theme for a route/node from its type + key. */
export function operationTheme(routeType: string, key: string | null): OperationTheme {
  const special = SPECIAL_THEME[routeType];
  if (special) return { key: routeType, glyph: symbolFor(routeType, key), color: special[0], label: special[1] };
  const k = key ?? '';
  const byKey = KEY_THEME[k];
  const [color, label] = byKey ?? ['262 80% 68%', 'Your Deck'];
  return { key: k || routeType, glyph: symbolFor(routeType, key), color, label };
}
