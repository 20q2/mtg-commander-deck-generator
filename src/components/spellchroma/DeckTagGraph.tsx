import { useMemo, useState } from 'react';
import type { ScryfallCard } from '@/types';
import { getCardImageUrl } from '@/services/scryfall/client';
import { tagsForOracleId } from '@/services/spellchroma/tagIndex';
import { isIgnoredTag } from '@/services/spellchroma/ignoredTags';

interface DeckTagGraphProps {
  cards: ScryfallCard[];
  selectedTags: string[];
  onTagClick: (slug: string) => void;
}

const VB = 800;            // square viewBox
const C = 800 / 2;         // center
const TOP_EDGES = 3;       // keep each node's strongest N links (k-NN graph)

function helpfulTags(card: ScryfallCard): string[] {
  const all = tagsForOracleId(card.oracle_id ?? '');
  const helpful = all.filter(s => !isIgnoredTag(s));
  return helpful.length ? helpful : all.filter(() => false); // tagless if only trivia
}

function ciColor(ci: string[] | undefined): string {
  if (!ci || ci.length === 0) return '#71717a';            // colorless
  if (ci.length > 1) return '#d9b44a';                     // gold (multicolor)
  return ({ W: '#efe9c8', U: '#5b9bd5', B: '#8a8d93', R: '#e0625a', G: '#5fae6e' } as Record<string, string>)[ci[0]] ?? '#71717a';
}

interface GNode { name: string; card: ScryfallCard; tags: Set<string>; x: number; y: number; deg: number; color: string }
interface GEdge { a: number; b: number; w: number }

/**
 * Force-directed "web" of the deck: one node per (unique) card, an edge between
 * cards that share oracle tags (weight = shared count, pruned to each node's
 * strongest few links). Node color = color identity; nodes that share the
 * currently-selected search tags get a violet heat ring. Hover to spotlight a
 * card and its neighbors; click to add that card's top tag to the search.
 */
export function DeckTagGraph({ cards, selectedTags, onTagClick }: DeckTagGraphProps) {
  const [hovered, setHovered] = useState<number | null>(null);

  // Stable signature: layout only recomputes when the card set changes.
  const sig = useMemo(() => [...new Set(cards.map(c => c.name))].sort().join('|'), [cards]);

  const { nodes, edges, neighbors, hiddenCount } = useMemo(() => {
    // Unique cards that carry at least one helpful tag.
    const seen = new Set<string>();
    const all: GNode[] = [];
    let hidden = 0;
    for (const card of cards) {
      if (seen.has(card.name)) continue;
      seen.add(card.name);
      const tags = helpfulTags(card);
      if (tags.length === 0) { hidden += 1; continue; }
      all.push({ name: card.name, card, tags: new Set(tags), x: 0, y: 0, deg: 0, color: ciColor(card.color_identity) });
    }
    const n = all.length;

    // Candidate edges by shared-tag count, then prune to each node's strongest links.
    const cand: GEdge[] = [];
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        let w = 0;
        for (const t of all[i].tags) if (all[j].tags.has(t)) w++;
        if (w > 0) cand.push({ a: i, b: j, w });
      }
    }
    const keepFor: Map<number, GEdge[]> = new Map();
    for (let i = 0; i < n; i++) keepFor.set(i, []);
    for (const e of cand) { keepFor.get(e.a)!.push(e); keepFor.get(e.b)!.push(e); }
    const edgeSet = new Set<string>();
    const edges: GEdge[] = [];
    for (let i = 0; i < n; i++) {
      const top = keepFor.get(i)!.sort((p, q) => q.w - p.w).slice(0, TOP_EDGES);
      for (const e of top) {
        const key = `${Math.min(e.a, e.b)}-${Math.max(e.a, e.b)}`;
        if (edgeSet.has(key)) continue;
        edgeSet.add(key);
        edges.push(e);
        all[e.a].deg++; all[e.b].deg++;
      }
    }

    // Fruchterman–Reingold layout from a deterministic ring start.
    for (let i = 0; i < n; i++) {
      const a = (2 * Math.PI * i) / Math.max(n, 1);
      all[i].x = C + Math.cos(a) * VB * 0.3;
      all[i].y = C + Math.sin(a) * VB * 0.3;
    }
    if (n > 1) {
      const k = 0.55 * Math.sqrt((VB * VB) / n);
      let temp = VB * 0.1;
      const ITER = 350;
      const dx = new Float64Array(n), dy = new Float64Array(n);
      for (let it = 0; it < ITER; it++) {
        dx.fill(0); dy.fill(0);
        for (let i = 0; i < n; i++) {
          for (let j = i + 1; j < n; j++) {
            let vx = all[i].x - all[j].x, vy = all[i].y - all[j].y;
            let d = Math.hypot(vx, vy) || 0.01;
            const f = (k * k) / d;
            vx = (vx / d) * f; vy = (vy / d) * f;
            dx[i] += vx; dy[i] += vy; dx[j] -= vx; dy[j] -= vy;
          }
        }
        for (const e of edges) {
          let vx = all[e.a].x - all[e.b].x, vy = all[e.a].y - all[e.b].y;
          const d = Math.hypot(vx, vy) || 0.01;
          const f = ((d * d) / k) * (1 + e.w * 0.5);
          vx = (vx / d) * f; vy = (vy / d) * f;
          dx[e.a] -= vx; dy[e.a] -= vy; dx[e.b] += vx; dy[e.b] += vy;
        }
        for (let i = 0; i < n; i++) {
          // gentle pull to center keeps disconnected nodes from drifting away
          dx[i] += (C - all[i].x) * 0.012; dy[i] += (C - all[i].y) * 0.012;
          const d = Math.hypot(dx[i], dy[i]) || 0.01;
          all[i].x += (dx[i] / d) * Math.min(d, temp);
          all[i].y += (dy[i] / d) * Math.min(d, temp);
        }
        temp *= 0.97;
      }
    }

    // Fit to viewBox with padding.
    if (n > 0) {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const p of all) { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); }
      const pad = 40;
      const sx = (VB - pad * 2) / Math.max(maxX - minX, 1);
      const sy = (VB - pad * 2) / Math.max(maxY - minY, 1);
      const s = Math.min(sx, sy);
      for (const p of all) { p.x = pad + (p.x - minX) * s; p.y = pad + (p.y - minY) * s; }
    }

    const neighbors: Set<number>[] = all.map(() => new Set<number>());
    for (const e of edges) { neighbors[e.a].add(e.b); neighbors[e.b].add(e.a); }

    return { nodes: all, edges, neighbors, hiddenCount: hidden };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);

  const sel = useMemo(() => new Set(selectedTags), [selectedTags]);
  const matchCount = (node: GNode) => { let n = 0; for (const t of node.tags) if (sel.has(t)) n++; return n; };

  if (nodes.length < 2) {
    return (
      <div className="h-full flex items-center justify-center text-center px-6">
        <p className="text-sm text-muted-foreground">Not enough tagged cards to draw a web yet.</p>
      </div>
    );
  }

  const radius = (node: GNode) => 9 + Math.min(node.deg, 6) * 1.6;
  const isDim = (i: number) => hovered !== null && hovered !== i && !neighbors[hovered].has(i);
  const hov = hovered !== null ? nodes[hovered] : null;

  return (
    <div className="relative h-full w-full">
      <svg viewBox={`0 0 ${VB} ${VB}`} preserveAspectRatio="xMidYMid meet" className="w-full h-full">
        {/* edges */}
        {edges.map((e, i) => {
          const active = hovered !== null && (e.a === hovered || e.b === hovered);
          const dim = hovered !== null && !active;
          return (
            <line
              key={i}
              x1={nodes[e.a].x} y1={nodes[e.a].y} x2={nodes[e.b].x} y2={nodes[e.b].y}
              stroke={active ? '#a78bfa' : '#ffffff'}
              strokeWidth={active ? 1.6 : 0.6 + e.w * 0.25}
              strokeOpacity={dim ? 0.04 : active ? 0.7 : 0.12 + e.w * 0.05}
            />
          );
        })}
        {/* nodes */}
        {nodes.map((node, i) => {
          const m = matchCount(node);
          const r = radius(node);
          return (
            <g key={node.name} transform={`translate(${node.x},${node.y})`}
              onMouseEnter={() => setHovered(i)} onMouseLeave={() => setHovered(null)}
              onClick={() => { const top = [...node.tags][0]; if (top) onTagClick(top); }}
              className="cursor-pointer" style={{ opacity: isDim(i) ? 0.2 : 1 }}>
              {m > 0 && <circle r={r + 3.5} fill="none" stroke="#a78bfa" strokeWidth={m >= 2 ? 2.5 : 1.5} strokeOpacity={0.9} />}
              <circle r={r} fill={node.color} stroke="#0b0b0f" strokeWidth={1.5} />
              <title>{node.name}</title>
            </g>
          );
        })}
      </svg>

      {/* hovered card preview */}
      {hov && (
        <div className="absolute top-2 left-2 w-28 pointer-events-none rounded-lg overflow-hidden border border-violet-400/40 shadow-xl bg-card">
          <img src={getCardImageUrl(hov.card, 'small') ?? ''} alt={hov.name} className="w-full block" />
          <p className="text-[10px] leading-tight p-1 text-center truncate">{hov.name}</p>
        </div>
      )}

      {/* legend */}
      <p className="absolute bottom-1 left-2 text-[10px] text-muted-foreground/70">
        {nodes.length} cards · {edges.length} links{hiddenCount > 0 ? ` · ${hiddenCount} untagged hidden` : ''}
      </p>
    </div>
  );
}
