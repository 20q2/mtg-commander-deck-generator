/**
 * Lift Web share card — renders the settled constellation to a branded PNG and downloads it.
 * Pure module: plain node/link data in (no d3/React), canvas out. LiftGraph is the only caller.
 * Spec: docs/superpowers/specs/2026-07-02-lift-share-card-design.md
 */

// Bare HSL triplets so they compose with `/ alpha`. Four maximally-separable families: your cards are
// a neutral pale silver (the hub-stars everything orbits — so the coloured candidates pop against them),
// commanders gold, bombs vivid fuchsia and clusters vivid sky (matching the list view's accents). Keeping
// "your cards" out of the purple range is what stops them blurring into the fuchsia bombs.
export const HUE = {
  deck: '212 22% 86%',
  commander: '43 96% 60%',
  bomb: '300 88% 64%',
  cluster: '195 94% 56%',
  focus: '152 72% 50%',  // the "pairs with" anchor — a vivid emerald, distinct from the gold commander
  synergy: '262 83% 74%',// deck-mode edges — lavender, our synergy accent (deck↔deck ties)
};

/** SVG path for a 5-pointed star centred at the origin, first point up. Also feeds Path2D on canvas. */
export function starPath(rOuter: number, rInner: number): string {
  let d = '';
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? rOuter : rInner;
    const a = (Math.PI / 5) * i - Math.PI / 2;
    d += `${i === 0 ? 'M' : 'L'}${(r * Math.cos(a)).toFixed(2)},${(r * Math.sin(a)).toFixed(2)}`;
  }
  return d + 'Z';
}
export const STAR_INNER = 0.45;   // inner/outer radius ratio — must match LiftGraph's STAR_CLIP polygon

// ── Export data shapes (plain values — LiftGraph maps its GNode/GLink into these) ──
export interface ShareNode {
  id: string;
  kind: 'deck' | 'bomb' | 'cluster';
  x: number; y: number; r: number;   // settled sim coords + radius
  hue: string;                       // precomputed via LiftGraph's nodeHue()
  lowConf?: boolean;                 // dashed ring
  focus?: boolean;                   // star shape
  solo?: boolean;                    // deck-mode island — drawn faded, like on screen
  artUrl: string;
}
export interface ShareLink {
  x1: number; y1: number; x2: number; y2: number;
  hue: string;
  cw: number;   // co-play weight 0..1 → thickness/opacity (mirrors the SVG's l.cw)
}
export type ShareStats =
  | { mode: 'deck'; cardCount: number; tieCount: number;
      strongestPair: { a: string; b: string; lift: number } | null }
  | { mode: 'candidates'; bombCount: number; clusterCount: number;
      topHit: { name: string; anchor: string; lift: number } | null };

// ── Pure helpers (unit-tested) ──────────────────────────────────────────

/** EDHREC caps lift display at 99+; mirror the list view's convention. */
export const liftLabel = (l: number) => (l >= 99 ? '×99+' : `×${l.toFixed(1)}`);

/** Footer line — the whole story in one row, ending with the data-lineage note. */
export function buildStatsLine(s: ShareStats): string {
  const parts: string[] = [];
  if (s.mode === 'deck') {
    parts.push(`${s.cardCount} cards`, `${s.tieCount} synergy ${s.tieCount === 1 ? 'tie' : 'ties'}`);
    if (s.strongestPair) parts.push(`strongest pair: ${s.strongestPair.a} + ${s.strongestPair.b} ${liftLabel(s.strongestPair.lift)}`);
  } else {
    parts.push(
      `${s.bombCount} high-lift ${s.bombCount === 1 ? 'find' : 'finds'}`,
      `${s.clusterCount} ${s.clusterCount === 1 ? 'cluster' : 'clusters'}`,
    );
    if (s.topHit) parts.push(`top: ${s.topHit.name} ${liftLabel(s.topHit.lift)} with ${s.topHit.anchor}`);
  }
  parts.push('lift from EDHREC co-play data');
  return parts.join(' · ');
}

/** manafoundry-lift-web-<commander>[-<partner>].png — same slug rules as our EDHREC links. */
export function shareFilename(commanderName: string, partnerName?: string): string {
  const slug = (n: string) => n.split(' // ')[0].toLowerCase()
    .replace(/'/g, '').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  return `manafoundry-lift-web-${slug(commanderName)}${partnerName ? `-${slug(partnerName)}` : ''}.png`;
}

/** Fit the node bounds into a target rect with padding: screen = sim × k + t. Zoom capped at 2. */
export function fitTransform(
  pts: { x: number; y: number; r: number }[],
  rect: { x: number; y: number; w: number; h: number },
  pad: number,
): { k: number; tx: number; ty: number } {
  if (!pts.length) return { k: 1, tx: rect.x + rect.w / 2, ty: rect.y + rect.h / 2 };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p.x - p.r); maxX = Math.max(maxX, p.x + p.r);
    minY = Math.min(minY, p.y - p.r); maxY = Math.max(maxY, p.y + p.r);
  }
  const k = Math.min(2, (rect.w - pad * 2) / (maxX - minX || 1), (rect.h - pad * 2) / (maxY - minY || 1));
  return {
    k,
    tx: rect.x + rect.w / 2 - ((minX + maxX) / 2) * k,
    ty: rect.y + rect.h / 2 - ((minY + maxY) / 2) * k,
  };
}
