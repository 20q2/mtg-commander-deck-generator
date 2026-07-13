/**
 * Procedural wrapper art for the special-route packs (Combos / Headliner / Hidden Synergy).
 * Specials don't tease a card on the front — the art is an abstract signature of the ROUTE,
 * painted once per (motif, color) on an offscreen canvas and cached as a data URL. Deterministic:
 * a seeded PRNG keyed on the same pair, so a route's pack always looks the same.
 *
 * All motifs share one language — a deep hue-tinted nebula field, luminous additive strokes with
 * white-hot cores, film grain, and an edge vignette — so the set reads as one product line:
 *   combo   → an interlocked infinity loop (the engine coming online)
 *   synergy → a constellation network (cards linked by the graph)
 *   elite   → a radiant starburst (the standout)
 *   anything else → flowing energy ribbons
 */

// Kept modest and encoded as JPEG: the art is opaque, and Chrome refuses data: URLs past ~2MB
// (a grainy PNG at this size blows through that — net::ERR_INVALID_URL).
const W = 448;
const H = 704;

const cache = new Map<string, string>();

/** mulberry32 — tiny seeded PRNG, plenty for art jitter. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

function parseHsl(hsl: string): { h: number; s: number; l: number } {
  const m = /^\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%\s*$/.exec(hsl);
  return m ? { h: +m[1], s: +m[2], l: +m[3] } : { h: 262, s: 70, l: 60 };
}

type Ctx = CanvasRenderingContext2D;
type Rand = () => number;

/** The shared deep-space base: hue-dark gradient + soft nebula blobs. */
function paintBase(ctx: Ctx, h: number, s: number, rnd: Rand): void {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, `hsl(${h} ${s * 0.5}% 11%)`);
  g.addColorStop(0.45, `hsl(${h} ${s * 0.55}% 17%)`);
  g.addColorStop(1, `hsl(${h} ${s * 0.5}% 7%)`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 6; i++) {
    const x = rnd() * W;
    const y = rnd() * H;
    const r = 130 + rnd() * 190;
    const hue = h + (rnd() - 0.5) * 40;
    const blob = ctx.createRadialGradient(x, y, 0, x, y, r);
    blob.addColorStop(0, `hsl(${hue} ${s}% ${26 + rnd() * 10}% / ${0.10 + rnd() * 0.08})`);
    blob.addColorStop(1, 'transparent');
    ctx.fillStyle = blob;
    ctx.fillRect(0, 0, W, H);
  }
  ctx.globalCompositeOperation = 'source-over';
}

/** A tiny four-point flare (bright cross + dot) — shared sparkle vocabulary. */
function flare(ctx: Ctx, x: number, y: number, size: number, h: number, alpha: number): void {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.strokeStyle = `hsl(${h} 40% 90% / ${alpha})`;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(x - size, y); ctx.lineTo(x + size, y);
  ctx.moveTo(x, y - size); ctx.lineTo(x, y + size);
  ctx.stroke();
  const dot = ctx.createRadialGradient(x, y, 0, x, y, size * 0.6);
  dot.addColorStop(0, `hsl(${h} 30% 96% / ${alpha})`);
  dot.addColorStop(1, 'transparent');
  ctx.fillStyle = dot;
  ctx.fillRect(x - size, y - size, size * 2, size * 2);
  ctx.restore();
}

/** combo — a glowing infinity loop with orbiting motes. */
function paintCombo(ctx: Ctx, h: number, s: number, rnd: Rand): void {
  const cx = W / 2, cy = H * 0.44;
  const sx = W * 0.34, sy = H * 0.15;
  const tilt = (rnd() - 0.5) * 0.5;
  const pt = (t: number) => {
    const x0 = Math.sin(t) * sx;
    const y0 = Math.sin(2 * t) * sy;
    return { x: cx + x0 * Math.cos(tilt) - y0 * Math.sin(tilt), y: cy + x0 * Math.sin(tilt) + y0 * Math.cos(tilt) };
  };
  ctx.globalCompositeOperation = 'lighter';
  // Halo pass → colored body → white-hot core.
  for (const [width, color, blur] of [
    [16, `hsl(${h} ${s}% 55% / 0.28)`, 34],
    [7, `hsl(${h} ${s}% 65% / 0.85)`, 18],
    [2.4, `hsl(${h} 35% 94% / 0.95)`, 8],
  ] as const) {
    ctx.beginPath();
    for (let i = 0; i <= 200; i++) {
      const { x, y } = pt((i / 200) * Math.PI * 2);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.lineWidth = width;
    ctx.strokeStyle = color;
    ctx.shadowColor = `hsl(${h} ${s}% 60%)`;
    ctx.shadowBlur = blur;
    ctx.stroke();
  }
  ctx.shadowBlur = 0;
  // Motes riding the loop.
  for (let i = 0; i < 26; i++) {
    const { x, y } = pt(rnd() * Math.PI * 2);
    const r = 1 + rnd() * 2.6;
    const dot = ctx.createRadialGradient(x, y, 0, x, y, r * 3);
    dot.addColorStop(0, `hsl(${h} 40% 92% / ${0.35 + rnd() * 0.5})`);
    dot.addColorStop(1, 'transparent');
    ctx.fillStyle = dot;
    ctx.fillRect(x - r * 3, y - r * 3, r * 6, r * 6);
  }
  ctx.globalCompositeOperation = 'source-over';
  flare(ctx, pt(Math.PI / 4).x, pt(Math.PI / 4).y, 13, h, 0.9);
}

/** synergy — a constellation: nodes linked by luminous threads, one hero spark. */
function paintSynergy(ctx: Ctx, h: number, s: number, rnd: Rand): void {
  const nodes: { x: number; y: number; r: number }[] = [];
  for (let i = 0; i < 15; i++) {
    nodes.push({ x: W * 0.12 + rnd() * W * 0.76, y: H * 0.12 + rnd() * H * 0.6, r: 1.6 + rnd() * 3.4 });
  }
  ctx.globalCompositeOperation = 'lighter';
  // Threads: each node to its two nearest neighbours.
  ctx.shadowColor = `hsl(${h} ${s}% 65%)`;
  for (const n of nodes) {
    const near = [...nodes]
      .filter(m => m !== n)
      .sort((a, b) => (a.x - n.x) ** 2 + (a.y - n.y) ** 2 - ((b.x - n.x) ** 2 + (b.y - n.y) ** 2))
      .slice(0, 2);
    for (const m of near) {
      ctx.beginPath();
      ctx.moveTo(n.x, n.y);
      // A soft bow instead of a straight wire.
      ctx.quadraticCurveTo((n.x + m.x) / 2 + (rnd() - 0.5) * 30, (n.y + m.y) / 2 + (rnd() - 0.5) * 30, m.x, m.y);
      ctx.lineWidth = 1.1;
      ctx.strokeStyle = `hsl(${h} ${s}% 70% / ${0.22 + rnd() * 0.25})`;
      ctx.shadowBlur = 8;
      ctx.stroke();
    }
  }
  ctx.shadowBlur = 0;
  // Nodes.
  for (const n of nodes) {
    const dot = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, n.r * 4);
    dot.addColorStop(0, `hsl(${h} 35% 93% / 0.9)`);
    dot.addColorStop(0.35, `hsl(${h} ${s}% 70% / 0.5)`);
    dot.addColorStop(1, 'transparent');
    ctx.fillStyle = dot;
    ctx.fillRect(n.x - n.r * 4, n.y - n.r * 4, n.r * 8, n.r * 8);
  }
  ctx.globalCompositeOperation = 'source-over';
  // The hero spark — the lift find waiting in the graph.
  const hero = nodes[Math.floor(rnd() * nodes.length)];
  flare(ctx, hero.x, hero.y, 18, h, 1);
  flare(ctx, W * (0.2 + rnd() * 0.6), H * 0.78, 8, h, 0.5);
}

/** elite — a radiant starburst with drifting sparkles. */
function paintElite(ctx: Ctx, h: number, s: number, rnd: Rand): void {
  const cx = W / 2, cy = H * 0.42;
  ctx.globalCompositeOperation = 'lighter';
  // Rays — alternating long/short, gradient to transparent.
  const rays = 26;
  const off = rnd() * Math.PI;
  for (let i = 0; i < rays; i++) {
    const a = off + (i / rays) * Math.PI * 2;
    const len = (i % 2 === 0 ? 0.42 : 0.2) * H * (0.75 + rnd() * 0.5);
    const ex = cx + Math.cos(a) * len, ey = cy + Math.sin(a) * len;
    const ray = ctx.createLinearGradient(cx, cy, ex, ey);
    ray.addColorStop(0, `hsl(${h} ${s}% 78% / 0.5)`);
    ray.addColorStop(1, 'transparent');
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(ex, ey);
    ctx.lineWidth = 1.6 + rnd() * 1.6;
    ctx.strokeStyle = ray;
    ctx.stroke();
  }
  // Concentric bloom + white core.
  for (const [r, a] of [[150, 0.16], [86, 0.3], [40, 0.6], [16, 1]] as const) {
    const orb = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    orb.addColorStop(0, `hsl(${h} 30% 96% / ${a})`);
    orb.addColorStop(0.5, `hsl(${h} ${s}% 70% / ${a * 0.45})`);
    orb.addColorStop(1, 'transparent');
    ctx.fillStyle = orb;
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
  }
  ctx.globalCompositeOperation = 'source-over';
  // Drifting sparkles below the burst.
  for (let i = 0; i < 7; i++) {
    flare(ctx, W * (0.15 + rnd() * 0.7), H * (0.6 + rnd() * 0.3), 4 + rnd() * 9, h, 0.35 + rnd() * 0.45);
  }
}

/** fallback — flowing energy ribbons. */
function paintRibbons(ctx: Ctx, h: number, s: number, rnd: Rand): void {
  ctx.globalCompositeOperation = 'lighter';
  for (let k = 0; k < 3; k++) {
    const baseY = H * (0.25 + k * 0.18) + rnd() * 40;
    const amp = 40 + rnd() * 60;
    const freq = 1.5 + rnd() * 1.5;
    const phase = rnd() * Math.PI * 2;
    for (const [width, color, blur] of [
      [12, `hsl(${h} ${s}% 55% / 0.25)`, 26],
      [4, `hsl(${h} ${s}% 68% / 0.8)`, 12],
      [1.6, `hsl(${h} 30% 94% / 0.9)`, 5],
    ] as const) {
      ctx.beginPath();
      for (let x = -10; x <= W + 10; x += 6) {
        const y = baseY + Math.sin((x / W) * Math.PI * freq + phase) * amp;
        if (x === -10) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.lineWidth = width;
      ctx.strokeStyle = color;
      ctx.shadowColor = `hsl(${h} ${s}% 60%)`;
      ctx.shadowBlur = blur;
      ctx.stroke();
    }
  }
  ctx.shadowBlur = 0;
  ctx.globalCompositeOperation = 'source-over';
  flare(ctx, W * 0.7, H * 0.3, 12, h, 0.8);
}

/** Film grain + vignette — the finishing pass that makes it read as print, not vectors. */
function paintFinish(ctx: Ctx, rnd: Rand): void {
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 420; i++) {
    ctx.fillStyle = `hsl(0 0% 100% / ${0.015 + rnd() * 0.03})`;
    ctx.fillRect(rnd() * W, rnd() * H, 1, 1);
  }
  ctx.globalCompositeOperation = 'source-over';
  const vig = ctx.createRadialGradient(W / 2, H / 2, H * 0.28, W / 2, H / 2, H * 0.72);
  vig.addColorStop(0, 'transparent');
  vig.addColorStop(1, 'rgb(0 0 0 / 0.42)');
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, W, H);
}

/**
 * The abstract wrapper art for a special pack, as a data URL. `motif` is the route key
 * ('combo' | 'synergy' | 'elite' | anything); `hsl` is the route's bare color triplet.
 */
export function specialPackArt(motif: string, hsl: string): string | undefined {
  const key = `${motif}|${hsl}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return undefined;

  const { h, s } = parseHsl(hsl);
  const rnd = prng(hashStr(key));
  paintBase(ctx, h, s, rnd);
  if (motif === 'combo') paintCombo(ctx, h, s, rnd);
  else if (motif === 'synergy') paintSynergy(ctx, h, s, rnd);
  else if (motif === 'elite') paintElite(ctx, h, s, rnd);
  else paintRibbons(ctx, h, s, rnd);
  paintFinish(ctx, rnd);

  const url = canvas.toDataURL('image/jpeg', 0.88);
  cache.set(key, url);
  return url;
}
