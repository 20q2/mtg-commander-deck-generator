import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  forceSimulation, forceLink, forceManyBody, forceX, forceY, forceCollide, type Simulation,
} from 'd3-force';
import { Maximize2, Expand, Shrink } from 'lucide-react';
import type { ScryfallCard } from '@/types';
import { getCardImageUrl } from '@/services/scryfall/client';
import { tagsForOracleId } from '@/services/spellchroma/tagIndex';
import { isIgnoredTag } from '@/services/spellchroma/ignoredTags';

interface DeckTagGraphProps {
  cards: ScryfallCard[];
  selectedTags: string[];
  onTagClick: (slug: string) => void;
}

const TOP_EDGES = 4;            // keep each node's strongest N links
const MAX_THEMES = 7;           // distinct coloured theme clusters; rest are "other"
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

// Distinct, vivid hues for theme clusters (bare HSL triplets → compose with /alpha).
const THEME_HUES = ['262 83% 70%', '199 90% 62%', '152 64% 52%', '32 95% 60%', '340 82% 66%', '188 70% 55%', '50 90% 60%'];
const OTHER_HUE = '220 9% 58%';
const MATCH_HUE = '262 90% 75%';   // violet — synergy with the current search

function helpfulTags(card: ScryfallCard): string[] {
  return tagsForOracleId(card.oracle_id ?? '').filter(s => !isIgnoredTag(s));
}
function artUrl(card: ScryfallCard): string {
  return card.image_uris?.art_crop || card.card_faces?.[0]?.image_uris?.art_crop || getCardImageUrl(card, 'small') || '';
}

interface GNode {
  id: string; card: ScryfallCard; tags: string[]; tagSet: Set<string>;
  theme: string; hue: string; r: number;
  x?: number; y?: number; vx?: number; vy?: number; fx?: number | null; fy?: number | null;
}
interface GLink { source: string | GNode; target: string | GNode; w: number; sameTheme: boolean }
const nid = (e: string | GNode) => (typeof e === 'object' ? e.id : e);

interface ThemeInfo { slug: string; hue: string; count: number; angle: number }

/**
 * The deck as a synergy constellation (d3-force + SVG). One node per unique
 * tagged card; cards are grouped into colour-coded *theme clusters* by their
 * dominant shared tag, and a per-theme gravity pulls each cluster into its own
 * petal so the deck's mechanics constellate visibly. Edges = shared tags. Cards
 * sharing the active search tags glow violet. Drag nodes, scroll to zoom, drag
 * to pan, click a node to add its theme tag, click a legend chip to focus a
 * theme, and expand to full-screen for room.
 */
export function DeckTagGraph({ cards, selectedTags, onTagClick }: DeckTagGraphProps) {
  const sig = useMemo(() => [...new Set(cards.map(c => c.name))].sort().join('|'), [cards]);

  const { nodes, links, neighbors, themes, hiddenCount } = useMemo(() => {
    // Unique, tagged cards.
    const seen = new Set<string>();
    const base: { id: string; card: ScryfallCard; tags: string[]; tagSet: Set<string> }[] = [];
    let hidden = 0;
    for (const card of cards) {
      if (seen.has(card.name)) continue;
      seen.add(card.name);
      const tags = helpfulTags(card);
      if (tags.length === 0) { hidden += 1; continue; }
      base.push({ id: card.name, card, tags, tagSet: new Set(tags) });
    }

    // Tag frequency across the deck → each card's dominant tag is its theme.
    const freq = new Map<string, number>();
    for (const b of base) for (const t of b.tags) freq.set(t, (freq.get(t) ?? 0) + 1);
    const domOf = (b: { tags: string[] }) =>
      [...b.tags].sort((a, c) => (freq.get(c)! - freq.get(a)!) || a.localeCompare(c))[0];

    // Rank candidate themes by how many cards they'd lead → keep the top few.
    const themeCount = new Map<string, number>();
    for (const b of base) themeCount.set(domOf(b), (themeCount.get(domOf(b)) ?? 0) + 1);
    const topThemes = [...themeCount.entries()]
      .filter(([, c]) => c >= 2)
      .sort((a, c) => c[1] - a[1])
      .slice(0, MAX_THEMES)
      .map(([slug], i) => ({ slug, hue: THEME_HUES[i], count: themeCount.get(slug)!, angle: 0 }) as ThemeInfo);
    topThemes.forEach((t, i) => { t.angle = (2 * Math.PI * i) / Math.max(topThemes.length, 1); });
    const themeBySlug = new Map(topThemes.map(t => [t.slug, t]));

    const nodes: GNode[] = base.map(b => {
      const dom = domOf(b);
      const theme = themeBySlug.has(dom) ? dom : '__other';
      return { ...b, theme, hue: themeBySlug.get(theme)?.hue ?? OTHER_HUE, r: 16 };
    });

    // Edges: shared-tag count, pruned to each node's strongest few.
    const byId = new Map(nodes.map(n => [n.id, n]));
    const cand: GLink[] = [];
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        let w = 0;
        for (const t of nodes[i].tagSet) if (nodes[j].tagSet.has(t)) w++;
        if (w > 0) cand.push({ source: nodes[i].id, target: nodes[j].id, w, sameTheme: nodes[i].theme === nodes[j].theme && nodes[i].theme !== '__other' });
      }
    }
    const perNode = new Map<string, GLink[]>(nodes.map(n => [n.id, []]));
    for (const e of cand) { perNode.get(nid(e.source))!.push(e); perNode.get(nid(e.target))!.push(e); }
    const seenEdge = new Set<string>();
    const links: GLink[] = [];
    const deg = new Map<string, number>();
    for (const n of nodes) {
      for (const e of perNode.get(n.id)!.sort((p, q) => q.w - p.w).slice(0, TOP_EDGES)) {
        const k = [nid(e.source), nid(e.target)].sort().join('—');
        if (seenEdge.has(k)) continue;
        seenEdge.add(k);
        links.push({ ...e });
        deg.set(nid(e.source), (deg.get(nid(e.source)) ?? 0) + 1);
        deg.set(nid(e.target), (deg.get(nid(e.target)) ?? 0) + 1);
      }
    }
    for (const n of nodes) n.r = clamp(13 + (deg.get(n.id) ?? 0) * 1.7, 13, 32);
    const neighbors = new Map<string, Set<string>>(nodes.map(n => [n.id, new Set<string>()]));
    for (const e of links) { neighbors.get(nid(e.source))!.add(nid(e.target)); neighbors.get(nid(e.target))!.add(nid(e.source)); }
    void byId;
    return { nodes, links, neighbors, themes: topThemes, hiddenCount: hidden };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);

  const sel = useMemo(() => new Set(selectedTags), [selectedTags]);
  const matchCount = useCallback((n: GNode) => { let c = 0; for (const t of n.tagSet) if (sel.has(t)) c++; return c; }, [sel]);

  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const simRef = useRef<Simulation<GNode, GLink> | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [, setTick] = useState(0);
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const [hover, setHover] = useState<string | null>(null);
  const [focusTheme, setFocusTheme] = useState<string | null>(null);
  const sizeRef = useRef(size); sizeRef.current = size;
  const viewRef = useRef(view); viewRef.current = view;
  const ready = size.w > 0 && size.h > 0;

  // ── Smooth camera tween (fit / focus) ──
  const rafRef = useRef<number | null>(null);
  const stopAnim = useCallback(() => { if (rafRef.current != null) { cancelAnimationFrame(rafRef.current); rafRef.current = null; } }, []);
  useEffect(() => stopAnim, [stopAnim]);
  const animateTo = useCallback((target: { x: number; y: number; k: number }) => {
    stopAnim();
    const start = viewRef.current;
    const ease = (p: number) => 1 - Math.pow(1 - p, 3);
    let t0: number | null = null;
    const step = (now: number) => {
      if (t0 == null) t0 = now;
      const p = Math.min(1, (now - t0) / 480);
      const e = ease(p);
      setView({ x: start.x + (target.x - start.x) * e, y: start.y + (target.y - start.y) * e, k: start.k + (target.k - start.k) * e });
      rafRef.current = p < 1 ? requestAnimationFrame(step) : null;
    };
    rafRef.current = requestAnimationFrame(step);
  }, [stopAnim]);

  // Measure the canvas.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([entry]) => {
      const w = Math.round(entry.contentRect.width), h = Math.round(entry.contentRect.height);
      setSize(prev => (prev.w === w && prev.h === h ? prev : { w, h }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const fitView = useCallback((subset?: Set<string>) => {
    const pts = subset ? nodes.filter(n => subset.has(n.id)) : nodes;
    if (!pts.length || !sizeRef.current.w) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of pts) {
      minX = Math.min(minX, (n.x ?? 0) - n.r); maxX = Math.max(maxX, (n.x ?? 0) + n.r);
      minY = Math.min(minY, (n.y ?? 0) - n.r); maxY = Math.max(maxY, (n.y ?? 0) + n.r);
    }
    const { w, h } = sizeRef.current;
    const pad = 56;
    const k = clamp(Math.min((w - pad) / (maxX - minX || 1), (h - pad) / (maxY - minY || 1)), 0.25, 2.2);
    animateTo({ k, x: w / 2 - ((minX + maxX) / 2) * k, y: h / 2 - ((minY + maxY) / 2) * k });
  }, [nodes, animateTo]);
  const fitRef = useRef(fitView); fitRef.current = fitView;

  // ── Physics — rebuild only when the graph data changes or the canvas appears. ──
  useEffect(() => {
    if (!ready || !nodes.length) return;
    const { w, h } = sizeRef.current;
    const cx = w / 2, cy = h / 2;
    const spread = Math.min(w, h) * 0.32;
    const anchor = (theme: string): { x: number; y: number } => {
      const t = themes.find(x => x.slug === theme);
      if (!t) return { x: cx, y: cy };
      return { x: cx + Math.cos(t.angle) * spread, y: cy + Math.sin(t.angle) * spread };
    };
    const sim = forceSimulation<GNode>(nodes)
      .velocityDecay(0.55)
      .alphaDecay(0.04)
      .force('link', forceLink<GNode, GLink>(links).id(d => d.id)
        .distance(l => 30 + 55 * (1 / (1 + l.w)))
        .strength(l => (l.sameTheme ? 0.5 : 0.18) + 0.1 * l.w))
      .force('charge', forceManyBody<GNode>().strength(-340))
      .force('x', forceX<GNode>(n => anchor(n.theme).x).strength(n => (n.theme === '__other' ? 0.02 : 0.09)))
      .force('y', forceY<GNode>(n => anchor(n.theme).y).strength(n => (n.theme === '__other' ? 0.02 : 0.09)))
      .force('collide', forceCollide<GNode>(n => n.r + 6).strength(0.9).iterations(2))
      .on('tick', () => setTick(t => t + 1));
    simRef.current = sim;
    const fitTimer = window.setTimeout(() => fitRef.current(), 750);
    return () => { sim.stop(); window.clearTimeout(fitTimer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, ready]);

  // ── Pointer interaction (pan / drag / zoom) ──
  const drag = useRef<{ mode: 'none' | 'pan' | 'node'; node?: GNode; moved: boolean; sx: number; sy: number; ox: number; oy: number }>(
    { mode: 'none', moved: false, sx: 0, sy: 0, ox: 0, oy: 0 });
  const toSim = (cx: number, cy: number) => {
    const rect = svgRef.current!.getBoundingClientRect();
    return { x: (cx - rect.left - view.x) / view.k, y: (cy - rect.top - view.y) / view.k };
  };
  const onNodeDown = (e: React.PointerEvent, n: GNode) => {
    e.stopPropagation(); stopAnim();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    drag.current = { mode: 'node', node: n, moved: false, sx: e.clientX, sy: e.clientY, ox: 0, oy: 0 };
    simRef.current?.alphaTarget(0.1).restart();
  };
  const onBgDown = (e: React.PointerEvent) => {
    stopAnim();
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    drag.current = { mode: 'pan', moved: false, sx: e.clientX, sy: e.clientY, ox: view.x, oy: view.y };
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (d.mode === 'none') return;
    if (Math.abs(e.clientX - d.sx) + Math.abs(e.clientY - d.sy) > 3) d.moved = true;
    if (d.mode === 'pan') setView(v => ({ ...v, x: d.ox + (e.clientX - d.sx), y: d.oy + (e.clientY - d.sy) }));
    else if (d.mode === 'node' && d.node) {
      const p = toSim(e.clientX, e.clientY);
      d.node.fx = p.x; d.node.fy = p.y; d.node.x = p.x; d.node.y = p.y; setTick(t => t + 1);
    }
  };
  const onUp = (e: React.PointerEvent) => {
    const d = drag.current;
    if (d.mode === 'node' && d.node) {
      simRef.current?.alphaTarget(0);
      if (!d.moved) onTagClick(d.node.theme !== '__other' ? d.node.theme : d.node.tags[0]);
    }
    drag.current = { mode: 'none', moved: false, sx: 0, sy: 0, ox: 0, oy: 0 };
    (e.target as Element).releasePointerCapture?.(e.pointerId);
  };
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault(); stopAnim();
      const svg = svgRef.current;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      const mx = e.clientX - rect.left, my = e.clientY - rect.top;
      setView(v => {
        const k2 = clamp(v.k * (e.deltaY < 0 ? 1.12 : 1 / 1.12), 0.25, 3.5);
        return { k: k2, x: mx - (mx - v.x) * (k2 / v.k), y: my - (my - v.y) * (k2 / v.k) };
      });
    };
    wrap.addEventListener('wheel', onWheel, { passive: false });
    return () => wrap.removeEventListener('wheel', onWheel);
  }, [stopAnim]);

  // ── Full-screen ──
  const [isFs, setIsFs] = useState(false);
  useEffect(() => {
    const onChange = () => setIsFs(!!document.fullscreenElement && document.fullscreenElement === wrapRef.current);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);
  const toggleFs = useCallback(() => {
    const el = wrapRef.current;
    if (!el) return;
    if (document.fullscreenElement) document.exitFullscreen?.(); else el.requestFullscreen?.();
  }, []);
  // Re-frame after the big size change settles when entering/leaving full-screen.
  useEffect(() => {
    const t = window.setTimeout(() => fitRef.current(), 120);
    return () => window.clearTimeout(t);
  }, [isFs]);

  const hoverSet = hover ? neighbors.get(hover) : null;
  const hoverNode = hover ? nodes.find(n => n.id === hover) : null;
  const dimFor = (n: GNode) =>
    (hover ? (!hoverSet?.has(n.id) && n.id !== hover) : false) ||
    (focusTheme ? n.theme !== focusTheme : false);

  if (nodes.length < 2) {
    return (
      <div ref={wrapRef} className="h-full flex items-center justify-center text-center px-6">
        <p className="text-sm text-muted-foreground">Not enough tagged cards to draw a web yet.</p>
      </div>
    );
  }

  return (
    <div ref={wrapRef}
      className="relative h-full w-full rounded-lg overflow-hidden border border-border/50 select-none"
      style={{
        background:
          'radial-gradient(120% 90% at 28% 8%, hsl(262 60% 18% / 0.55), transparent 60%),' +
          'radial-gradient(100% 80% at 82% 92%, hsl(292 60% 16% / 0.4), transparent 55%),' +
          'radial-gradient(circle at 50% 50%, hsl(222 32% 9%), hsl(224 38% 6%))',
      }}>
      {/* star grain */}
      <div aria-hidden className="pointer-events-none absolute inset-0 opacity-50"
        style={{ backgroundImage: 'radial-gradient(circle, hsl(0 0% 100% / 0.09) 0.5px, transparent 0.5px)', backgroundSize: '32px 32px' }} />

      <svg ref={svgRef} className="absolute inset-0 w-full h-full touch-none cursor-grab active:cursor-grabbing"
        onPointerDown={onBgDown} onPointerMove={onMove} onPointerUp={onUp}>
        <defs>
          <filter id="dtg-glow" x="-80%" y="-80%" width="260%" height="260%">
            <feGaussianBlur stdDeviation="3" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>
        <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
          {/* edges */}
          {links.map((l, i) => {
            const s = typeof l.source === 'object' ? l.source : nodes.find(n => n.id === l.source);
            const t = typeof l.target === 'object' ? l.target : nodes.find(n => n.id === l.target);
            if (!s || !t) return null;
            const active = !!hover && (s.id === hover || t.id === hover);
            const dim = (!!hover && !active) || (!!focusTheme && !(s.theme === focusTheme && t.theme === focusTheme));
            const hue = active ? MATCH_HUE : l.sameTheme ? s.hue : '0 0% 100%';
            return (
              <line key={i} x1={s.x ?? 0} y1={s.y ?? 0} x2={t.x ?? 0} y2={t.y ?? 0}
                stroke={`hsl(${hue})`} strokeLinecap="round"
                strokeWidth={(active ? 2 : 0.7 + l.w * 0.4) / view.k}
                strokeOpacity={dim ? 0.03 : active ? 0.85 : (l.sameTheme ? 0.28 : 0.12) + l.w * 0.04}
                style={{ transition: 'stroke-opacity 140ms' }} />
            );
          })}
          {/* nodes */}
          {nodes.map((n) => {
            const m = matchCount(n);
            const dim = dimFor(n);
            const focused = hover === n.id;
            return (
              <g key={n.id} transform={`translate(${n.x ?? 0},${n.y ?? 0})`}
                style={{ opacity: dim ? 0.18 : 1, cursor: 'pointer', transition: 'opacity 140ms' }}
                onPointerDown={(e) => onNodeDown(e, n)}
                onPointerEnter={() => setHover(n.id)}
                onPointerLeave={() => setHover(h => (h === n.id ? null : h))}>
                {/* theme glow halo */}
                <circle r={n.r + (focused ? 7 : 4)} fill={`hsl(${m > 0 ? MATCH_HUE : n.hue})`} opacity={focused ? 0.5 : 0.26} filter="url(#dtg-glow)" />
                <circle r={n.r} fill="hsl(220 30% 12%)" />
                <image href={artUrl(n.card)} x={-n.r} y={-n.r} width={n.r * 2} height={n.r * 2}
                  preserveAspectRatio="xMidYMid slice" pointerEvents="none" style={{ clipPath: 'circle(50%)' }} />
                {/* search-match ring (violet) over the theme ring */}
                {m > 0 && <circle r={n.r + 2.5} fill="none" stroke={`hsl(${MATCH_HUE})`} strokeWidth={m >= 2 ? 3 : 2} opacity={0.95} />}
                <circle r={n.r} fill="none" stroke={`hsl(${n.hue})`} strokeWidth={2.4} opacity={0.95} />
              </g>
            );
          })}
        </g>
      </svg>

      {/* theme legend (top-left) — click to focus a cluster + add its tag */}
      {themes.length > 0 && (
        <div className="absolute top-2 left-2 flex flex-wrap gap-1 max-w-[70%]">
          {themes.map(t => {
            const on = focusTheme === t.slug;
            return (
              <button key={t.slug} type="button"
                onMouseEnter={() => setFocusTheme(t.slug)} onMouseLeave={() => setFocusTheme(f => (f === t.slug ? null : f))}
                onClick={() => onTagClick(t.slug)}
                title={`Focus “${t.slug}” (${t.count}) · click to add to search`}
                className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] backdrop-blur transition-colors ${on ? 'bg-background/80 text-foreground border-border' : 'bg-background/55 text-muted-foreground border-border/50 hover:text-foreground'}`}>
                <span className="w-2 h-2 rounded-full" style={{ background: `hsl(${t.hue})` }} />
                {t.slug}
                <span className="opacity-60 tabular-nums">{t.count}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* controls (top-right) */}
      <div className="absolute top-2 right-2 flex items-center gap-1.5">
        <button onClick={() => fitView()} title="Fit to view"
          className="grid place-items-center w-7 h-7 rounded-full border border-border/60 bg-background/70 backdrop-blur text-muted-foreground hover:text-foreground transition-colors">
          <Maximize2 className="w-3.5 h-3.5" />
        </button>
        <button onClick={toggleFs} title={isFs ? 'Exit full screen' : 'Explore full screen'}
          className="grid place-items-center w-7 h-7 rounded-full border border-border/60 bg-background/70 backdrop-blur text-muted-foreground hover:text-foreground transition-colors">
          {isFs ? <Shrink className="w-3.5 h-3.5" /> : <Expand className="w-3.5 h-3.5" />}
        </button>
      </div>

      {/* rich hover tooltip */}
      {hoverNode && hoverNode.x != null && (() => {
        const sx = hoverNode.x! * view.k + view.x;
        const sy = hoverNode.y! * view.k + view.y;
        const half = hoverNode.r * view.k;
        const below = sy - half < 160;
        const top = below ? sy + half + 8 : sy - half - 8;
        const deg = neighbors.get(hoverNode.id)?.size ?? 0;
        return (
          <div className={`absolute z-20 -translate-x-1/2 ${below ? '' : '-translate-y-full'} pointer-events-none`}
            style={{ left: clamp(sx, 110, size.w - 110), top: clamp(top, 6, size.h - 6) }}>
            <div className="flex gap-2.5 rounded-lg border border-border/70 bg-popover/95 backdrop-blur shadow-xl p-2 w-max max-w-[280px]">
              <img src={getCardImageUrl(hoverNode.card, 'small') ?? ''} alt={hoverNode.id} loading="lazy"
                className="w-14 h-auto self-start rounded shadow-md shrink-0" />
              <div className="min-w-0 flex flex-col">
                <div className="truncate text-xs font-semibold leading-tight">{hoverNode.id}</div>
                <div className="mt-0.5 text-[10px] text-muted-foreground truncate">{hoverNode.card.type_line}</div>
                <div className="my-1.5 h-px bg-border/60" />
                <div className="text-[10px] text-muted-foreground mb-1">{deg} synergy {deg === 1 ? 'link' : 'links'}</div>
                <div className="flex flex-wrap gap-1">
                  {hoverNode.tags.slice(0, 6).map(tg => (
                    <span key={tg} className="px-1.5 py-px rounded-full text-[9px] border"
                      style={{
                        background: `hsl(${tg === hoverNode.theme ? hoverNode.hue : OTHER_HUE} / 0.18)`,
                        borderColor: `hsl(${tg === hoverNode.theme ? hoverNode.hue : OTHER_HUE} / 0.4)`,
                        color: sel.has(tg) ? `hsl(${MATCH_HUE})` : undefined,
                      }}>
                      {tg}
                    </span>
                  ))}
                  {hoverNode.tags.length > 6 && <span className="text-[9px] text-muted-foreground/70">+{hoverNode.tags.length - 6}</span>}
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      <p className="absolute bottom-1 left-2 text-[10px] text-muted-foreground/70 pointer-events-none">
        {nodes.length} cards · {links.length} links{hiddenCount > 0 ? ` · ${hiddenCount} untagged` : ''} · drag · scroll to zoom · click to add tag
      </p>
    </div>
  );
}
