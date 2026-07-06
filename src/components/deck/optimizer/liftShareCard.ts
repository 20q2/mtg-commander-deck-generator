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
      mostConnected: { name: string; ties: number } | null }
  | { mode: 'candidates'; bombCount: number; clusterCount: number };

// ── Pure helpers (unit-tested) ──────────────────────────────────────────

/** EDHREC caps lift display at 99+; mirror the list view's convention. */
export const liftLabel = (l: number) => (l >= 99 ? '×99+' : `×${l.toFixed(1)}`);

/** Footer line — short and plain-language; no jargon (playtest feedback). */
export function buildStatsLine(s: ShareStats): string {
  const parts: string[] = [];
  if (s.mode === 'deck') {
    parts.push(`${s.cardCount} cards`, `${s.tieCount} synergy ${s.tieCount === 1 ? 'tie' : 'ties'}`);
    if (s.mostConnected) parts.push(`most connected: ${s.mostConnected.name} (${s.mostConnected.ties} ${s.mostConnected.ties === 1 ? 'tie' : 'ties'})`);
  } else {
    parts.push(
      `${s.bombCount} high-lift ${s.bombCount === 1 ? 'find' : 'finds'}`,
      `${s.clusterCount} ${s.clusterCount === 1 ? 'cluster' : 'clusters'}`,
    );
  }
  return parts.join(' · ');
}

/** manafoundry-lift-web-<commander>[-<partner>].jpg — same slug rules as our EDHREC links. */
export function shareFilename(commanderName: string, partnerName?: string): string {
  const slug = (n: string) => n.split(' // ')[0].toLowerCase()
    .replace(/'/g, '').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  return `manafoundry-lift-web-${slug(commanderName)}${partnerName ? `-${slug(partnerName)}` : ''}.jpg`;
}

/** Fit the node bounds into a target rect with padding: screen = sim × k + t. Zoom capped so a
 *  compact web fills the card instead of floating small in the middle (was 2, felt too zoomed-out). */
const MAX_FIT_ZOOM = 3.4;
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
  const k = Math.min(MAX_FIT_ZOOM, (rect.w - pad * 2) / (maxX - minX || 1), (rect.h - pad * 2) / (maxY - minY || 1));
  return {
    k,
    tx: rect.x + rect.w / 2 - ((minX + maxX) / 2) * k,
    ty: rect.y + rect.h / 2 - ((minY + maxY) / 2) * k,
  };
}

// ── Canvas renderer ─────────────────────────────────────────────────────

const W = 1600, H = 1000, SCALE = 2;          // logical size; drawn at 2× → 3200×2000 px
const GRAPH_PAD = 40;   // inset from the card edge — the graph fills the whole canvas behind the corner text
const MARGIN = 30;                            // header/footer text inset — hug the corners, not float
const ART_TIMEOUT_MS = 4000;

/** Deterministic PRNG for the star grain — a fixed seed keeps every export identical. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Load one art crop with CORS so the canvas never taints; null on error/timeout → placeholder.
 *  The cache-busting param matters: the on-screen <img> loads cached these images WITHOUT CORS
 *  approval, and the browser happily serves that non-CORS cache entry to a crossOrigin request —
 *  which then fails and would leave every node a flat grey square. A distinct URL forces a fresh
 *  fetch that carries Origin, so Scryfall's Access-Control-Allow-Origin actually arrives. */
function loadArt(url: string): Promise<HTMLImageElement | null> {
  return new Promise(resolve => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    const timer = window.setTimeout(() => resolve(null), ART_TIMEOUT_MS);
    img.onload = () => { window.clearTimeout(timer); resolve(img); };
    img.onerror = () => { window.clearTimeout(timer); resolve(null); };
    img.src = url + (url.includes('?') ? '&' : '?') + 'mfshare=1';
  });
}

/** The ManaFoundry logo silhouette, tinted to a solid colour via source-in compositing
 *  (the canvas twin of LogoMark's CSS mask trick). Drawn oversized for a crisp downscale. */
function tintLogo(img: HTMLImageElement, size: number, color: string): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const s = Math.min(size / img.naturalWidth, size / img.naturalHeight);   // contain, centred
  const w = img.naturalWidth * s, h = img.naturalHeight * s;
  g.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
  g.globalCompositeOperation = 'source-in';
  g.fillStyle = color;
  g.fillRect(0, 0, size, size);
  return c;
}

/** drawImage in "object-fit: cover" — centre-crop the source to fill the destination box. */
function drawCover(ctx: CanvasRenderingContext2D, img: HTMLImageElement, dx: number, dy: number, dw: number, dh: number): void {
  const s = Math.max(dw / img.naturalWidth, dh / img.naturalHeight);
  const sw = dw / s, sh = dh / s;
  ctx.drawImage(img, (img.naturalWidth - sw) / 2, (img.naturalHeight - sh) / 2, sw, sh, dx, dy, dw, dh);
}

/** Rounded-rect Path2D (hand-rolled — Path2D.roundRect is still patchy in older Safari). */
function roundRectPath(x: number, y: number, w: number, h: number, r: number): Path2D {
  const p = new Path2D();
  p.moveTo(x + r, y);
  p.arcTo(x + w, y, x + w, y + h, r);
  p.arcTo(x + w, y + h, x, y + h, r);
  p.arcTo(x, y + h, x, y, r);
  p.arcTo(x, y, x + w, y, r);
  p.closePath();
  return p;
}

/** The node's face/halo shape at radius r, centred on the origin (matches the SVG encodings). */
function shapeFor(n: ShareNode, r: number): Path2D {
  if (n.focus) return new Path2D(starPath(r, r * STAR_INNER));
  if (n.kind === 'deck') return roundRectPath(-r, -r, r * 2, r * 2, r * 0.32 + 2);
  const p = new Path2D();
  p.arc(0, 0, r, 0, Math.PI * 2);
  return p;
}

export interface ShareCardOptions {
  nodes: ShareNode[];
  links: ShareLink[];
  mode: 'candidates' | 'deck';
  commanderName: string;
  partnerCommanderName?: string;
  deckName?: string;   // saved-list name — becomes the title when present (commander moves to the label line)
  stats: ShareStats;
}

/** Render the share card and trigger the JPEG download. Rejects on render failure (no file). */
export async function exportLiftShareCard(opts: ShareCardOptions): Promise<void> {
  const { nodes, links, mode, commanderName, partnerCommanderName, deckName, stats } = opts;

  // Fonts first (already loaded app-wide via Google Fonts; this just guarantees readiness),
  // then the art — usually instant, the browser HTTP cache already holds every visible crop.
  await document.fonts.ready;
  await Promise.all(
    ['700 40px Cinzel', '700 20px Cinzel', '500 15px Saira', '600 14px "Saira Condensed"']
      .map(f => document.fonts.load(f)),
  ).catch(() => { /* a missing font falls back to sans-serif — not fatal */ });
  const arts = new Map<string, HTMLImageElement>();
  let logo: HTMLImageElement | null = null;
  await Promise.all([
    ...nodes.map(async n => {
      const img = await loadArt(n.artUrl);
      if (img) arts.set(n.id, img);
    }),
    // Same-origin logo PNG (the LogoMark mask source) — tinted below; skipped silently if it fails.
    loadArt(`${import.meta.env.BASE_URL}logo.png`).then(img => { logo = img; }),
  ]);

  const canvas = document.createElement('canvas');
  canvas.width = W * SCALE;
  canvas.height = H * SCALE;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D unavailable');
  ctx.scale(SCALE, SCALE);

  // ── Background: the live canvas's deep-space gradients, then deterministic star grain. ──
  ctx.fillStyle = 'hsl(222 36% 6%)';
  ctx.fillRect(0, 0, W, H);
  const base = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H) * 0.6);
  base.addColorStop(0, 'hsl(220 30% 9%)');
  base.addColorStop(1, 'hsl(222 36% 6%)');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, W, H);
  const glowA = ctx.createRadialGradient(W * 0.3, H * 0.1, 0, W * 0.3, H * 0.1, Math.max(W, H) * 0.55);
  glowA.addColorStop(0, 'hsl(262 60% 16% / 0.55)');
  glowA.addColorStop(1, 'hsl(262 60% 16% / 0)');
  ctx.fillStyle = glowA;
  ctx.fillRect(0, 0, W, H);
  const glowB = ctx.createRadialGradient(W * 0.8, H * 0.9, 0, W * 0.8, H * 0.9, Math.max(W, H) * 0.5);
  glowB.addColorStop(0, 'hsl(292 60% 16% / 0.45)');
  glowB.addColorStop(1, 'hsl(292 60% 16% / 0)');
  ctx.fillStyle = glowB;
  ctx.fillRect(0, 0, W, H);
  const rand = mulberry32(42);
  for (let i = 0; i < 1200; i++) {
    ctx.fillStyle = `hsl(0 0% 100% / ${(0.03 + rand() * 0.07).toFixed(3)})`;
    ctx.fillRect(rand() * W, rand() * H, 1, 1);
  }

  // ── Header: deck name (when saved) or commander in Cinzel; the label line carries the mode
  // and — if the deck name took the title — the commander, so the image never loses either. ──
  const cmdrTitle = partnerCommanderName ? `${commanderName} & ${partnerCommanderName}` : commanderName;
  const title = deckName?.trim() || cmdrTitle;
  const label = (mode === 'deck' ? 'SYNERGY WEB' : 'LIFT WEB')
    + (deckName?.trim() ? ` · ${cmdrTitle.toUpperCase()}` : '');
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = 'hsl(212 22% 92%)';
  ctx.font = '700 40px Cinzel, serif';
  ctx.fillText(title, MARGIN, 52, W - MARGIN * 2);   // maxWidth squeezes long names instead of clipping
  ctx.font = '600 14px "Saira Condensed", sans-serif';
  ctx.fillStyle = mode === 'deck' ? 'hsl(262 83% 74% / 0.9)' : 'hsl(300 88% 70% / 0.9)';
  (ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = '4px';
  ctx.fillText(label, MARGIN, 78, W - MARGIN * 2);
  (ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = '0px';

  // ── Graph: auto-fit over the WHOLE canvas, not the band between header and footer — the title
  // and footer are just text in the corners, so the constellation floats behind them and fills the
  // card instead of being squished into the middle third. Points are transformed by hand
  // (screen = sim×k + t) so line widths and glow sizes stay screen-constant like the live SVG. ──
  const rect = { x: 0, y: 0, w: W, h: H };
  const { k, tx, ty } = fitTransform(nodes, rect, GRAPH_PAD);
  const px = (x: number) => x * k + tx;
  const py = (y: number) => y * k + ty;

  ctx.lineCap = 'round';
  for (const l of links) {
    ctx.strokeStyle = `hsl(${l.hue} / ${(0.12 + l.cw * 0.75).toFixed(3)})`;
    ctx.lineWidth = 0.5 + l.cw * 3;
    ctx.beginPath();
    ctx.moveTo(px(l.x1), py(l.y1));
    ctx.lineTo(px(l.x2), py(l.y2));
    ctx.stroke();
  }

  for (const n of nodes) {
    const r = n.r * k;
    ctx.save();
    ctx.translate(px(n.x), py(n.y));
    ctx.globalAlpha = n.solo ? 0.45 : 1;   // islands stay quiet, like on screen
    // halo — hue-tinted glow behind the face (shadowBlur stands in for feGaussianBlur)
    const isHub = n.kind === 'deck' && !n.focus;
    const halo = shapeFor(n, r + (isHub ? 4 : 7));
    ctx.shadowColor = `hsl(${n.hue})`;
    ctx.shadowBlur = 16;
    ctx.fillStyle = `hsl(${n.hue} / ${isHub ? 0.16 : 0.3})`;
    ctx.fill(halo);
    ctx.shadowBlur = 0;
    // face — dark disc under the art (shows through transparent PNG corners)
    const face = shapeFor(n, r);
    ctx.fillStyle = 'hsl(220 30% 12%)';
    ctx.fill(face);
    const img = arts.get(n.id);
    if (img) {
      ctx.save();
      ctx.clip(face);
      drawCover(ctx, img, -r, -r, r * 2, r * 2);
      ctx.restore();
    } else {
      ctx.fillStyle = `hsl(${n.hue} / 0.35)`;   // CORS/timeout fallback: flat hue-tinted shape
      ctx.fill(face);
    }
    // ring — dashed when the data is thin
    ctx.strokeStyle = `hsl(${n.hue})`;
    ctx.lineWidth = isHub ? 1.8 : 2.4;
    if (n.lowConf) ctx.setLineDash([3, 3]);
    ctx.stroke(face);
    ctx.setLineDash([]);
    ctx.restore();
  }

  // ── Footer: stats line left; logo mark + wordmark right. Both hug their corners. ──
  ctx.fillStyle = 'hsl(215 20% 68%)';
  ctx.font = '500 15px Saira, sans-serif';
  ctx.fillText(buildStatsLine(stats), MARGIN, H - 26, W - MARGIN * 2 - 220);
  ctx.textAlign = 'right';
  ctx.fillStyle = 'hsl(212 22% 86% / 0.55)';
  ctx.font = '700 20px Cinzel, serif';
  ctx.fillText('ManaFoundry', W - MARGIN, H - 24);
  if (logo) {
    const markSize = 26;
    const textW = ctx.measureText('ManaFoundry').width;
    // Tint at 4× then downscale for a crisp silhouette; sit it just left of the wordmark.
    ctx.drawImage(tintLogo(logo, markSize * 4, 'hsl(212 22% 86% / 0.55)'),
      W - MARGIN - textW - markSize - 10, H - 24 - markSize + 5, markSize, markSize);
  }
  ctx.textAlign = 'left';

  // ── Encode + download. JPEG keeps the file a few hundred KB instead of multi-MB PNG. ──
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.92));
  if (!blob) throw new Error('JPEG encoding failed');
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = shareFilename(commanderName, partnerCommanderName);
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 5000);
}
