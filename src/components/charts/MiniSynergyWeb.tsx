import { useMemo } from 'react';
import {
  forceSimulation, forceLink, forceManyBody, forceCenter, forceCollide,
  type SimulationNodeDatum,
} from 'd3-force';
import type { ScryfallCard } from '@/types';
import { isAnyLand } from '@/services/scryfall/client';
import type { DeckLink } from '@/services/optimizer/liftClusters';

/**
 * A distilled, static "synergy web" of the deck's internal lift ties — the miniature cousin of the
 * Lift Web deck-mode graph, built for a dashboard tile. Connected cards form an organic violet core
 * (a frozen d3-force layout, computed once); non-land outliers ("islands") float as amber motes on
 * the rim. No card art — same glanceable language as Radar / MiniCurve.
 */

const CORE_CAP = 18;        // most-connected nodes plotted in the core — keeps a 99-card deck legible
const ISLAND_DOTS = 6;      // max amber motes drawn; the count is the source of truth beyond this
const VIOLET = 'hsl(262 84% 72%)';
const GOLD = 'hsl(45 93% 63%)';
const AMBER = 'hsl(43 96% 56%)';

export interface MiniSynergyGraph {
  nodes: { id: string; commander: boolean }[];
  links: { a: string; b: string; w: number }[];
  islandCount: number;
}

/**
 * Derive the mini graph from the deck cards + scanned deck links. An island is a non-land,
 * non-commander card in NO deckLink (degree 0) — matching LiftGraph's `solo`. The core keeps the
 * CORE_CAP highest-degree linked nodes and the links among them.
 */
export function buildMiniSynergyGraph(
  cards: ScryfallCard[],
  deckLinks: DeckLink[],
  commanderNames: Set<string>,
): MiniSynergyGraph {
  const linked = new Set<string>();
  const degree = new Map<string, number>();
  for (const dl of deckLinks) {
    linked.add(dl.a); linked.add(dl.b);
    degree.set(dl.a, (degree.get(dl.a) ?? 0) + 1);
    degree.set(dl.b, (degree.get(dl.b) ?? 0) + 1);
  }

  const nonLandNames = cards.filter(c => !isAnyLand(c)).map(c => c.name);
  const islandCount = nonLandNames.filter(n => !linked.has(n) && !commanderNames.has(n)).length;

  // Core = top CORE_CAP linked names by degree, then the links whose endpoints both survive.
  const keep = new Set(
    [...linked].sort((a, b) => (degree.get(b) ?? 0) - (degree.get(a) ?? 0)).slice(0, CORE_CAP),
  );
  const nodes = [...keep].map(id => ({ id, commander: commanderNames.has(id) }));
  const links = deckLinks
    .filter(dl => keep.has(dl.a) && keep.has(dl.b))
    .map(dl => ({ a: dl.a, b: dl.b, w: dl.lift }));

  return { nodes, links, islandCount };
}

interface SimNode extends SimulationNodeDatum { id: string; commander: boolean; }

export function MiniSynergyWeb({
  graph, width = 168, height = 86,
}: {
  graph: MiniSynergyGraph;
  width?: number;
  height?: number;
}) {
  // Freeze a small force layout once per deck signature — no animation, no per-render cost.
  const sig = useMemo(
    () => `${width}x${height}|${graph.nodes.map(n => n.id).join(',')}|${graph.links.map(l => `${l.a}-${l.b}`).join(',')}`,
    [graph, width, height],
  );
  const laid = useMemo(() => {
    const pad = 10;
    const nodes: SimNode[] = graph.nodes.map(n => ({ id: n.id, commander: n.commander }));
    const byId = new Map(nodes.map(n => [n.id, n]));
    const links = graph.links
      .map(l => ({ source: byId.get(l.a)!, target: byId.get(l.b)!, w: l.w }))
      .filter(l => l.source && l.target);

    const sim = forceSimulation(nodes)
      .force('link', forceLink(links).id(d => (d as SimNode).id).distance(20).strength(0.5))
      .force('charge', forceManyBody().strength(-55))
      .force('center', forceCenter(width / 2, height / 2))
      .force('collide', forceCollide(5))
      .stop();
    for (let i = 0; i < 220; i++) sim.tick();

    // Fit the frozen layout into the box: uniform scale, then centre the scaled content.
    const pos = new Map<string, { x: number; y: number; commander: boolean }>();
    if (nodes.length === 1) {
      pos.set(nodes[0].id, { x: width / 2, y: height / 2, commander: nodes[0].commander });
    } else if (nodes.length > 1) {
      const xs = nodes.map(n => n.x ?? 0);
      const ys = nodes.map(n => n.y ?? 0);
      const minX = Math.min(...xs), maxX = Math.max(...xs);
      const minY = Math.min(...ys), maxY = Math.max(...ys);
      const spanX = maxX - minX || 1;
      const spanY = maxY - minY || 1;
      const s = Math.min((width - 2 * pad) / spanX, (height - 2 * pad) / spanY);
      const offX = (width - s * spanX) / 2;
      const offY = (height - s * spanY) / 2;
      for (const n of nodes) {
        pos.set(n.id, {
          x: offX + ((n.x ?? 0) - minX) * s,
          y: offY + ((n.y ?? 0) - minY) * s,
          commander: n.commander,
        });
      }
    }
    return { pos };
    // sig captures every input; recompute only when the deck's web changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);

  const maxW = Math.max(1, ...graph.links.map(l => l.w));
  // Deterministic rim positions for the island motes (top toward bottom-right arc).
  const shown = Math.min(graph.islandCount, ISLAND_DOTS);
  const islandPts = Array.from({ length: shown }, (_, i) => {
    const t = (i + 0.5) / ISLAND_DOTS;                 // 0..1 along the arc
    const ang = -Math.PI / 2.4 + t * (Math.PI * 0.9);  // from top toward bottom-right
    return { x: width / 2 + Math.cos(ang) * (width / 2 - 6), y: height / 2 + Math.sin(ang) * (height / 2 - 6) };
  });

  return (
    <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} className="overflow-visible">
      {/* ties */}
      <g stroke={VIOLET}>
        {graph.links.map((l, i) => {
          const a = laid.pos.get(l.a), b = laid.pos.get(l.b);
          if (!a || !b) return null;
          return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y}
            strokeOpacity={0.2 + 0.35 * (l.w / maxW)} strokeWidth={0.75 + (l.w / maxW)} />;
        })}
      </g>
      {/* connected nodes */}
      <g>
        {[...laid.pos.entries()].map(([id, p]) => (
          <circle key={id} cx={p.x} cy={p.y} r={p.commander ? 4 : 2.75}
            fill={p.commander ? GOLD : VIOLET} />
        ))}
      </g>
      {/* islands */}
      <g fill={AMBER}>
        {islandPts.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r={4}>
            <title>Non-land outlier — no synergy tie to the rest of the deck</title>
          </circle>
        ))}
      </g>
    </svg>
  );
}
