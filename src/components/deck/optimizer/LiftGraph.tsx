import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { forceSimulation, forceLink, forceManyBody, forceCenter, forceCollide, forceX, forceY, forceRadial, type Simulation } from 'd3-force';
import { Check, Maximize2, HelpCircle, Expand, Shrink, Search, Camera, Loader2 } from 'lucide-react';
import type { ScryfallCard } from '@/types';
import { getCardImageUrl, isAnyLand } from '@/services/scryfall/client';
import { scryfallImg } from './constants';
import { Input } from '@/components/ui/input';
import { ManaCost } from '@/components/ui/mtg-icons';
import { InfoTooltip } from '@/components/ui/info-tooltip';
import { CardContextMenu, type CardAction } from '@/components/deck/DeckDisplay';
import type { CardRowMenuProps } from './shared';
import { edgeScore, type LiftCandidate, type DeckLink } from '@/services/optimizer/liftClusters';
import { HUE, starPath, STAR_INNER, exportLiftShareCard, type ShareStats } from './liftShareCard';

/**
 * A force-directed "star-map" of the deck's lift relationships. Your cards are bright hub-stars;
 * candidates are motes drawn into orbit; ley-line edges glow in proportion to lift×inclusion, so
 * clusters visibly constellate. SVG + d3-force — full control of the aurora aesthetic and native
 * hover/click/Add. Renders the same scanned data as the list view.
 */

interface LiftGraphProps {
  candidates: LiftCandidate[];       // bombs ∪ clusters to plot
  bombNames: Set<string>;            // which candidates are "bombs" (vs clusters)
  deckCardsByName: Map<string, ScryfallCard>; // seed name → its card (for hub art)
  commanderNames: Set<string>;       // colour these hubs gold
  confidenceFloor: number;           // bestNumDecks below this → "thin data" dashed ring
  onPreview: (name: string) => void;
  addedCards: Set<string>;
  matchedNames: Set<string>;         // candidate names passing the parent's filter bar
  focusAnchors?: Set<string>;        // selected "pairs with" deck cards — highlighted + enlarged
  displayMode: 'dim' | 'hide';       // dim non-matches in place, or rebuild to matches-only
  onCardAction?: (card: ScryfallCard, action: CardAction) => void;  // right-click context menu
  menuProps?: CardRowMenuProps;      // sideboard/maybeboard/lists/must-include/ban state for the menu
  toolbar?: ReactNode;               // extra control(s) rendered in the top-left overlay (e.g. Recheck)
  mode?: 'candidates' | 'deck';      // 'deck' plots your own cards' ties to each other instead of candidates
  deckLinks?: DeckLink[];            // deck↔deck ties (used only in 'deck' mode)
  hideIslands?: boolean;             // (deck mode) drop tie-less "island" cards entirely instead of haloing them
  hideLands?: boolean;              // (deck mode) drop land nodes — only offered while islands are shown
  onFocusCard?: (name: string) => void;  // right-click "Focus" — pin the graph to this deck card
  fullscreenRef?: { current: HTMLElement | null };  // element to full-screen (the panel incl. filter bar)
  deckName?: string;                 // saved-list name — titles the share-card export when present
}

type NodeKind = 'deck' | 'bomb' | 'cluster';

interface GNode {
  id: string;
  kind: NodeKind;
  card: ScryfallCard;
  r: number;
  commander?: boolean;
  focus?: boolean;        // a selected "pairs with" anchor — coloured + enlarged
  solo?: boolean;         // (deck mode) no synergy tie to any other card — banished to a quiet halo
  lowConf?: boolean;
  // d3 mutates these:
  x?: number; y?: number; vx?: number; vy?: number; fx?: number | null; fy?: number | null;
}
interface GLink { source: string | GNode; target: string | GNode; score: number; lift: number; coPct: number; w: number; cw: number; targetBomb: boolean; primary: boolean; }

function nodeHue(n: GNode): string {
  if (n.kind === 'deck') return n.focus ? HUE.focus : n.commander ? HUE.commander : HUE.deck;
  return n.kind === 'bomb' ? HUE.bomb : HUE.cluster;
}
function artUrl(card: ScryfallCard): string {
  return card.image_uris?.art_crop
    || card.card_faces?.[0]?.image_uris?.art_crop
    || getCardImageUrl(card, 'small')
    || scryfallImg(card.name);
}
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const NO_ANCHORS: Set<string> = new Set();   // stable empty default so the graph memo doesn't thrash
const NO_LINKS: DeckLink[] = [];             // stable empty default for the deck-mode link list

// Matching CSS clip for the art image — the same 5-point star as starPath(), expressed in % of the box.
const STAR_CLIP = 'polygon(50% 0%, 63.2% 31.8%, 97.55% 34.55%, 71.4% 56.95%, 79.4% 90.45%, 50% 72.5%, 20.6% 90.45%, 28.6% 56.95%, 2.45% 34.55%, 36.8% 31.8%)';

// Cap how many anchors a cluster ties to in the map — only its few strongest. Plotting every edge
// makes each cluster bridge half the deck, fusing everything into one cross-linked hairball; capping
// lets tightly-related cards condense into natural islands. (The tooltip still reports the true total.)
const CLUSTER_MAX_EDGES = 3;

/** Reading key for the star-map — explains the encodings a newcomer can't infer (shape, size, lines). */
const GRAPH_KEY =
  'Round = a card to consider adding · Square = a card already in your deck.\n\n' +
  'Bigger = played alongside your cards more often (higher co-play %).\n\n' +
  'Lines connect a card to the deck card(s) it pairs with — thicker and brighter means they show up together more often.\n\n' +
  'Fuchsia = high-lift · Sky = clusters · Gold = your commander.';

function buildGraph(
  candidates: LiftCandidate[], bombNames: Set<string>, deckByName: Map<string, ScryfallCard>,
  commanders: Set<string>, confidenceFloor: number, focusAnchors: Set<string>,
): { nodes: GNode[]; links: GLink[] } {
  const nodeMap = new Map<string, GNode>();
  const links: GLink[] = [];
  const degree = new Map<string, number>();
  // Per-candidate co-play strength (max co-occurrence % across its drawn ties) → drives node size below.
  const candCoPct = new Map<string, number>();

  for (const cand of candidates) {
    const cname = cand.card.name;
    const isBomb = bombNames.has(cname);
    if (!nodeMap.has(cname)) {
      nodeMap.set(cname, {
        id: cname, kind: isBomb ? 'bomb' : 'cluster', card: cand.card, r: 12,
        lowConf: cand.bestNumDecks < confidenceFloor,
      });
    }
    // Plot only a card's STRONGEST ties, not every edge — that's what lets natural islands form
    // instead of one cross-linked hairball. A bomb hugs its single best anchor (one short, strong
    // tie → a tight package); a cluster keeps its few best anchors so its breadth still reads, but
    // capped so it doesn't bridge half the deck. The first kept edge is the `primary`.
    const ranked = [...cand.edges].filter(e => deckByName.has(e.seed)).sort((a, b) => edgeScore(b) - edgeScore(a));
    // When the player is focusing anchors ("pairs with"), plot ONLY the edges to those anchors — so the
    // focused card actually appears and links to every card around it, instead of each candidate drifting
    // to its globally-strongest anchor (which may not be the one picked, leaving the focus card unlinked).
    const kept = focusAnchors.size
      ? ranked.filter(e => focusAnchors.has(e.seed))
      : (isBomb ? ranked.slice(0, 1) : ranked.slice(0, CLUSTER_MAX_EDGES));
    kept.forEach((e, i) => {
      const seedCard = deckByName.get(e.seed)!;
      if (!nodeMap.has(e.seed)) {
        nodeMap.set(e.seed, { id: e.seed, kind: 'deck', card: seedCard, r: 18, commander: commanders.has(e.seed), focus: focusAnchors.has(e.seed) });
      }
      links.push({ source: e.seed, target: cname, score: edgeScore(e), lift: e.lift, coPct: e.coPct, w: 0, cw: 0, targetBomb: isBomb, primary: isBomb && i === 0 });
      candCoPct.set(cname, Math.max(candCoPct.get(cname) ?? 0, e.coPct));
      degree.set(e.seed, (degree.get(e.seed) ?? 0) + 1);
      degree.set(cname, (degree.get(cname) ?? 0) + 1);
    });
  }
  const maxScore = Math.max(1, ...links.map(l => l.score));
  const maxCoPct = Math.max(1, ...links.map(l => l.coPct));
  for (const l of links) {
    l.w = l.score / maxScore;     // composite score still drives the layout springs (distance/strength)
    l.cw = l.coPct / maxCoPct;    // co-play % drives the VISIBLE thickness/opacity — the intuitive "how connected"
  }

  // Deck hubs stay sized by how many candidates they anchor. Candidates are sized by their strongest
  // co-play % — so a card actually played alongside yours a lot (e.g. 73%) is a big, obvious mote, while
  // a high-lift-but-rarely-shared hit (e.g. 13%) stays small. Linear (not sqrt) so the gap reads clearly.
  const maxCandCoPct = Math.max(1, ...candCoPct.values());
  for (const n of nodeMap.values()) {
    if (n.kind === 'deck') {
      const deg = degree.get(n.id) ?? 1;
      n.r = clamp(15 + deg * 1.4, 15, 30);
      if (n.focus) n.r = clamp(n.r * 1.5, 26, 42);   // the "pairs with" anchor reads noticeably bigger
    } else {
      const norm = (candCoPct.get(n.id) ?? 0) / maxCandCoPct;  // 0..1
      n.r = clamp(9 + norm * 21, 9, 30);
    }
  }
  return { nodes: [...nodeMap.values()], links };
}

/** Deck mode: every node is a card you already run; every link is a lift tie between two of them.
 *  No focus → plot the whole deck; tie-less "island" cards are either hidden (default) or pushed to a
 *  quiet halo. Focusing a card (right-click → Focus, or the Pairs-with picker) drills in to just that
 *  card and what it ties to. */
function buildDeckGraph(
  deckLinks: DeckLink[], deckByName: Map<string, ScryfallCard>, commanders: Set<string>, focusAnchors: Set<string>, hideIslands: boolean, hideLands: boolean,
): { nodes: GNode[]; links: GLink[] } {
  const focusing = focusAnchors.size > 0;
  const nodeMap = new Map<string, GNode>();
  const links: GLink[] = [];
  const degree = new Map<string, number>();
  const nodeCoPct = new Map<string, number>();   // each card's strongest tie → drives its size

  const ensure = (name: string) => {
    if (!nodeMap.has(name)) {
      const card = deckByName.get(name);
      if (!card) return false;
      // Drop lands when asked — including MDFC spell/land backs, which scan as spells but are run as lands.
      if (hideLands && isAnyLand(card)) return false;
      nodeMap.set(name, { id: name, kind: 'deck', card, r: 14, commander: commanders.has(name), focus: focusAnchors.has(name) });
    }
    return true;
  };
  // Seed the node set: every deck card when browsing, only the focused card(s) when drilling in.
  // (ensure() handles dropping lands; a link to a dropped land is skipped below since ensure returns false.)
  if (focusing) for (const name of focusAnchors) ensure(name);
  else for (const name of deckByName.keys()) ensure(name);

  const usedLinks = focusing ? deckLinks.filter(dl => focusAnchors.has(dl.a) || focusAnchors.has(dl.b)) : deckLinks;
  for (const dl of usedLinks) {
    if (!ensure(dl.a) || !ensure(dl.b)) continue;
    links.push({ source: dl.a, target: dl.b, score: edgeScore({ seed: dl.a, lift: dl.lift, coPct: dl.coPct, numDecks: dl.numDecks }), lift: dl.lift, coPct: dl.coPct, w: 0, cw: 0, targetBomb: false, primary: false });
    degree.set(dl.a, (degree.get(dl.a) ?? 0) + 1);
    degree.set(dl.b, (degree.get(dl.b) ?? 0) + 1);
    nodeCoPct.set(dl.a, Math.max(nodeCoPct.get(dl.a) ?? 0, dl.coPct));
    nodeCoPct.set(dl.b, Math.max(nodeCoPct.get(dl.b) ?? 0, dl.coPct));
  }
  const maxScore = Math.max(1, ...links.map(l => l.score));
  const maxCoPct = Math.max(1, ...links.map(l => l.coPct));
  for (const l of links) { l.w = l.score / maxScore; l.cw = l.coPct / maxCoPct; }
  const maxNodeCoPct = Math.max(1, ...nodeCoPct.values());
  for (const n of nodeMap.values()) {
    // A card with no notable tie to any other deck card. It carries no synergy to show, so it's
    // pushed out to a dim halo (see the physics) — small and quiet so the connected core reads.
    n.solo = (degree.get(n.id) ?? 0) === 0;
    const norm = (nodeCoPct.get(n.id) ?? 0) / maxNodeCoPct;
    n.r = n.solo ? 9 : clamp(11 + norm * 17, 11, 28);
    if (n.focus) n.r = clamp(n.r * 1.5, 26, 42);
  }
  // Islands carry no link (degree 0), so dropping them never orphans an edge. Hidden by default so the
  // relationship core fills the canvas; toggle off to reveal them as a quiet halo around the clusters.
  const allNodes = [...nodeMap.values()];
  return { nodes: hideIslands ? allNodes.filter(n => !n.solo) : allNodes, links };
}

/** Searchable list of the cards currently on the map; picking one zooms the camera to it. */
function NodeFinder({ nodes, onPick }: { nodes: GNode[]; onPick: (id: string) => void }) {
  const [q, setQ] = useState('');
  const shown = useMemo(() => {
    const sorted = [...nodes].sort((a, b) => a.id.localeCompare(b.id));
    return q ? sorted.filter(n => n.id.toLowerCase().includes(q.toLowerCase())) : sorted;
  }, [nodes, q]);
  return (
    <div className="flex flex-col max-h-80">
      <div className="p-2 border-b border-border/50">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a card on the map…" className="h-8 pl-7 text-xs" autoFocus />
        </div>
      </div>
      <div className="overflow-y-auto py-1">
        {shown.length === 0 ? (
          <p className="px-3 py-4 text-center text-xs text-muted-foreground">No matching cards</p>
        ) : shown.map(n => (
          <button key={n.id} onClick={() => onPick(n.id)}
            className="flex items-center gap-2 w-full px-2.5 py-1.5 text-left hover:bg-accent/50 transition-colors">
            <img src={getCardImageUrl(n.card, 'small') || scryfallImg(n.id)} alt="" className="w-5 h-auto rounded shrink-0" loading="lazy"
              onError={(e) => { (e.target as HTMLImageElement).src = scryfallImg(n.id); }} />
            <span className="text-xs truncate">{n.id}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function LiftGraph(props: LiftGraphProps) {
  const { candidates, bombNames, deckCardsByName, commanderNames, confidenceFloor, onPreview, addedCards, matchedNames, focusAnchors = NO_ANCHORS, displayMode, onCardAction, menuProps, toolbar, mode = 'candidates', deckLinks = NO_LINKS, hideIslands = true, hideLands = false, onFocusCard, fullscreenRef, deckName } = props;
  const deckMode = mode === 'deck';
  // 'hide' rebuilds the graph to matches-only (re-lays-out); 'dim' plots everything and fades
  // non-matches in place (no resimulation — preserves the player's arrangement).
  const shownCandidates = useMemo(
    () => (displayMode === 'hide' ? candidates.filter(c => matchedNames.has(c.card.name)) : candidates),
    [candidates, displayMode, matchedNames],
  );
  const { nodes, links } = useMemo(
    () => deckMode
      ? buildDeckGraph(deckLinks, deckCardsByName, commanderNames, focusAnchors, hideIslands, hideLands)
      : buildGraph(shownCandidates, bombNames, deckCardsByName, commanderNames, confidenceFloor, focusAnchors),
    [deckMode, deckLinks, shownCandidates, bombNames, deckCardsByName, commanderNames, confidenceFloor, focusAnchors, hideIslands, hideLands],
  );
  // Deck hubs that anchor at least one matched candidate — these stay bright when dimming.
  const activeHubs = useMemo(() => {
    if (displayMode === 'hide') return null;  // everything shown is already a match
    const s = new Set<string>();
    for (const l of links) {
      const tname = typeof l.target === 'object' ? l.target.id : l.target;
      if (matchedNames.has(tname)) s.add(typeof l.source === 'object' ? l.source.id : l.source);
    }
    return s;
  }, [links, matchedNames, displayMode]);

  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const simRef = useRef<Simulation<GNode, GLink> | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [, setTick] = useState(0);
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const [hover, setHover] = useState<string | null>(null);
  // Right-click context menu: which card, where (relative to the canvas), and whether it's a deck card.
  const [menuFor, setMenuFor] = useState<{ card: ScryfallCard; x: number; y: number; isDeck: boolean } | null>(null);

  // Mirror the view into a ref so the fit tween can read the current view as its start point, and a
  // rAF handle so an in-flight tween can be cancelled when the user takes over (pan/zoom/drag).
  const viewRef = useRef(view);
  viewRef.current = view;
  const rafRef = useRef<number | null>(null);
  const stopAnim = useCallback(() => {
    if (rafRef.current != null) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
  }, []);
  useEffect(() => stopAnim, [stopAnim]);

  // Glide the view (pan + zoom) toward a target over ~450ms with an ease-out, instead of snapping —
  // so re-fitting after a "pairs with" rebuild eases in rather than popping in a single frame.
  const animateTo = useCallback((target: { x: number; y: number; k: number }) => {
    stopAnim();
    const start = viewRef.current;
    const ease = (p: number) => 1 - Math.pow(1 - p, 3);
    let t0: number | null = null;
    const step = (now: number) => {
      if (t0 == null) t0 = now;
      const p = Math.min(1, (now - t0) / 450);
      const e = ease(p);
      setView({
        x: start.x + (target.x - start.x) * e,
        y: start.y + (target.y - start.y) * e,
        k: start.k + (target.k - start.k) * e,
      });
      rafRef.current = p < 1 ? requestAnimationFrame(step) : null;
    };
    rafRef.current = requestAnimationFrame(step);
  }, [stopAnim]);

  // Measure the canvas.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([entry]) => {
      const w = Math.round(entry.contentRect.width);
      const h = Math.round(entry.contentRect.height);
      // Ignore sub-pixel / no-op resizes — otherwise every fractional layout
      // nudge re-runs the whole simulation effect and the map visibly jitters.
      setSize(prev => (prev.w === w && prev.h === h ? prev : { w, h }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Fit the laid-out graph into view (called once the sim cools, and on demand).
  const fitView = useCallback(() => {
    if (!nodes.length || !size.w) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of nodes) {
      minX = Math.min(minX, (n.x ?? 0) - n.r); maxX = Math.max(maxX, (n.x ?? 0) + n.r);
      minY = Math.min(minY, (n.y ?? 0) - n.r); maxY = Math.max(maxY, (n.y ?? 0) + n.r);
    }
    const pad = 48;
    const k = clamp(Math.min((size.w - pad) / (maxX - minX || 1), (size.h - pad) / (maxY - minY || 1)), 0.3, 1.6);
    animateTo({ k, x: size.w / 2 - ((minX + maxX) / 2) * k, y: size.h / 2 - ((minY + maxY) / 2) * k });
  }, [nodes, size, animateTo]);

  // The element we full-screen — the whole panel (filter bar + graph) if provided, else just the canvas.
  const fsTarget = () => fullscreenRef?.current ?? wrapRef.current;

  // ── Fill height: stretch the canvas down to the bottom of the viewport (measured from its own top).
  // Recomputed on resize AND full-screen change — entering full-screen moves the canvas's top (the
  // filter bar now sits above it within the full-screen panel), so it re-fills below the bar. ──
  const [fillH, setFillH] = useState<number | null>(null);
  useEffect(() => {
    const compute = () => {
      const el = wrapRef.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top;
      setFillH(Math.max(460, Math.round(window.innerHeight - top - 16)));
    };
    compute();
    const onFsChange = () => requestAnimationFrame(compute);   // let the new layout settle first
    window.addEventListener('resize', compute);
    document.addEventListener('fullscreenchange', onFsChange);
    return () => { window.removeEventListener('resize', compute); document.removeEventListener('fullscreenchange', onFsChange); };
  }, []);

  // ── Full-screen the panel, and reframe once it resizes. ──
  const [isFs, setIsFs] = useState(false);
  useEffect(() => {
    const onChange = () => setIsFs(!!document.fullscreenElement && document.fullscreenElement === fsTarget());
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const fitRef = useRef(fitView);
  fitRef.current = fitView;
  useEffect(() => {
    const t = window.setTimeout(() => fitRef.current(), 90);   // reframe after the new size settles
    return () => window.clearTimeout(t);
  }, [isFs]);
  const toggleFs = useCallback(() => {
    const el = fsTarget();
    if (!el) return;
    if (document.fullscreenElement) document.exitFullscreen?.();
    else el.requestFullscreen?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fullscreenRef]);

  // ── "Find a card": glide the camera to centre a node and ping it briefly. Pure camera move — it
  // does NOT filter the graph (that's what "Pairs with" / right-click Focus do), so you land on the
  // node and explore from there. ──
  const [located, setLocated] = useState<string | null>(null);
  const locateTimer = useRef<number | null>(null);
  useEffect(() => () => { if (locateTimer.current) window.clearTimeout(locateTimer.current); }, []);
  const [findOpen, setFindOpen] = useState(false);
  const centerOnNode = useCallback((id: string) => {
    const n = nodes.find(x => x.id === id);
    if (!n || n.x == null || n.y == null || !size.w) return;
    const k = clamp(Math.max(viewRef.current.k, 1.3), 0.3, 3);
    animateTo({ k, x: size.w / 2 - n.x * k, y: size.h / 2 - n.y * k });
    setLocated(id);
    if (locateTimer.current) window.clearTimeout(locateTimer.current);
    locateTimer.current = window.setTimeout(() => setLocated(null), 2600);
  }, [nodes, size.w, size.h, animateTo]);

  // ── Share-card export: snapshot the plotted constellation into a branded PNG download. ──
  const [exporting, setExporting] = useState(false);
  const [exportFailed, setExportFailed] = useState(false);
  const nameOf = (e: string | GNode) => (typeof e === 'object' ? e.id : e);
  const onExport = useCallback(async () => {
    if (exporting || !nodes.length) return;
    setExporting(true);
    setExportFailed(false);
    try {
      const shareNodes = nodes
        .filter(n => n.x != null && n.y != null)
        .map(n => ({
          id: n.id, kind: n.kind, x: n.x!, y: n.y!, r: n.r,
          hue: nodeHue(n), lowConf: n.lowConf, focus: n.focus, solo: n.solo,
          artUrl: artUrl(n.card),
        }));
      const shareLinks = links.flatMap(l => {
        const s = typeof l.source === 'object' ? l.source : nodes.find(n => n.id === l.source);
        const t = typeof l.target === 'object' ? l.target : nodes.find(n => n.id === l.target);
        if (!s || !t || s.x == null || t.x == null) return [];
        const hue = deckMode ? HUE.synergy : bombNames.has(nameOf(l.target)) ? HUE.bomb : HUE.cluster;
        return [{ x1: s.x!, y1: s.y!, x2: t.x!, y2: t.y!, hue, cw: l.cw }];
      });
      // The footer's headline: deck mode names the biggest hub (most ties); candidate mode names
      // the single strongest find by the same composite score the layout uses.
      let stats: ShareStats;
      if (deckMode) {
        const deg = new Map<string, number>();
        for (const l of links) {
          deg.set(nameOf(l.source), (deg.get(nameOf(l.source)) ?? 0) + 1);
          deg.set(nameOf(l.target), (deg.get(nameOf(l.target)) ?? 0) + 1);
        }
        let top: { name: string; ties: number } | null = null;
        for (const [name, ties] of deg) if (!top || ties > top.ties) top = { name, ties };
        stats = { mode: 'deck', cardCount: deckCardsByName.size, tieCount: links.length, mostConnected: top };
      } else {
        let best: GLink | null = null;
        for (const l of links) if (!best || l.score > best.score) best = l;
        stats = {
          mode: 'candidates',
          bombCount: nodes.filter(n => n.kind === 'bomb').length,
          clusterCount: nodes.filter(n => n.kind === 'cluster').length,
          topHit: best ? { name: nameOf(best.target), anchor: nameOf(best.source), lift: best.lift } : null,
        };
      }
      const cmdrs = [...commanderNames];   // Set preserves insertion order: commander first, partner second
      await exportLiftShareCard({
        nodes: shareNodes, links: shareLinks, mode, deckName,
        commanderName: cmdrs[0] ?? 'Commander', partnerCommanderName: cmdrs[1], stats,
      });
    } catch {
      setExportFailed(true);
      window.setTimeout(() => setExportFailed(false), 3000);
    } finally {
      setExporting(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exporting, nodes, links, deckMode, bombNames, deckCardsByName, commanderNames, mode, deckName]);

  // Mirror size into a ref so the physics effect can read the latest dimensions
  // without listing them as deps (which would restart the sim on every resize).
  const sizeRef = useRef(size);
  sizeRef.current = size;
  const ready = size.w > 0 && size.h > 0;
  // Remember where each node settled, plus the last node-id set, so a rebuild (e.g. Recheck refreshing
  // the data) seeds from the prior layout and updates in place instead of scattering and re-fitting.
  const posRef = useRef(new Map<string, { x: number; y: number }>());
  const prevIdsRef = useRef('');

  // The physics. Builds the simulation only when the graph DATA changes (or once,
  // when the canvas is first measured). It deliberately does NOT depend on size:
  // a scrollbar appearing — e.g. the card preview modal locking body scroll widens
  // the layout ~15px — used to retear this effect and reheat every node from alpha=1,
  // scattering the whole star-map. Now a resize leaves the settled layout untouched.
  useEffect(() => {
    if (!ready || !nodes.length) return;
    const { w, h } = sizeRef.current;
    // Seed each node from the previous layout so a data refresh (Recheck) updates in place rather than
    // scattering. A "same set" rebuild (identical card ids → a recheck) keeps the camera and barely
    // re-settles; a genuinely new set (first load, mode/filter change) lays out fresh and re-fits.
    const idKey = nodes.map(n => n.id).sort().join('');
    const sameSet = idKey === prevIdsRef.current;
    prevIdsRef.current = idKey;
    for (const n of nodes) {
      const p = posRef.current.get(n.id);
      if (p) { n.x = p.x; n.y = p.y; }
    }
    // Big decks need more shove to break the central blob into islands — scale repulsion with size.
    const spread = clamp(nodes.length / 80, 1, 1.7);
    const sim = forceSimulation<GNode>(nodes)
      // Heavier friction + faster cooling so the star-map settles quickly and
      // calmly instead of oscillating around the centre for several seconds.
      .velocityDecay(0.5)
      .alphaDecay(0.04)
      .force('link', forceLink<GNode, GLink>(links).id(d => d.id)
        // Short, strong ties make connected cards condense into TIGHT islands; the global charge then
        // shoves those islands apart so relationships read as distinct constellations, not a hairball.
        // Deck mode: every tie short+strong so each synergy cluster balls up tightly and pulls apart.
        .distance(l => deckMode ? 46 + 64 * (1 - l.w) : (l.primary ? 26 + 46 * (1 - l.w) : 44 + 96 * (1 - l.w)))
        .strength(l => deckMode ? 0.42 + 0.35 * l.w : (l.targetBomb ? (l.primary ? 0.8 : 0.02) : 0.45 + 0.4 * l.w)))
      // Deck mode: connected cards repel hard so their constellations spread out and breathe instead of
      // overlapping; solo cards barely repel (the radial halo + collision place them, no shove on the core).
      .force('charge', forceManyBody<GNode>().strength(
        deckMode ? ((n: GNode) => (n.solo ? -70 : -480)) : ((n: GNode) => (n.kind === 'deck' ? -520 : -300) * spread)))
      // Generous collision padding gives every card room to breathe; two passes resolve the
      // tightly-packed islands far more stably than one high-strength pass. Deck mode pads extra so
      // the cards in a constellation don't crowd shoulder-to-shoulder.
      .force('collide', forceCollide<GNode>(n => n.r + (deckMode ? 16 : 9)).strength(0.92).iterations(2))
      .on('tick', () => setTick(t => t + 1));
    // Containment. Candidate mode's hub-and-spoke is self-centring, so a plain forceCenter is fine.
    // Deck mode splits into two zones: connected cards are pulled gently to the middle (so the synergy
    // constellations get the room to spread and present), while tie-less "solo" cards are pulled out to
    // a ring near the canvas edge — a quiet halo that frames the relationships without crushing them.
    if (deckMode) {
      const ringR = Math.min(w, h) * 0.42;
      sim
        .force('x', forceX<GNode>(w / 2).strength(n => (n.solo ? 0 : 0.07)))
        .force('y', forceY<GNode>(h / 2).strength(n => (n.solo ? 0 : 0.07)))
        .force('halo', forceRadial<GNode>(ringR, w / 2, h / 2).strength(n => (n.solo ? 0.35 : 0)));
    } else {
      sim.force('center', forceCenter(w / 2, h / 2));
    }
    if (sameSet) sim.alpha(0.4);   // recheck: gentle re-settle from the prior layout, not a cold start
    simRef.current = sim;
    // Only auto-fit a fresh layout; on a recheck keep the player's current camera/zoom.
    const fitTimer = sameSet ? null : window.setTimeout(fitView, 900);
    return () => {
      sim.stop();
      if (fitTimer) window.clearTimeout(fitTimer);
      // Stash where everything settled, to seed the next rebuild.
      for (const n of nodes) if (n.x != null && n.y != null) posRef.current.set(n.id, { x: n.x, y: n.y });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, links, ready]);

  // Keep the centre force aligned with the canvas on resize, but WITHOUT reheating:
  // on a cooled simulation this is inert (no ticks fire), so nodes hold their place.
  useEffect(() => {
    const sim = simRef.current;
    if (!sim || !ready) return;
    sim.force('center', forceCenter(size.w / 2, size.h / 2));
  }, [size.w, size.h, ready]);

  // ── Pointer interaction (pan / node drag / zoom) ────────────────────
  const drag = useRef<{ mode: 'none' | 'pan' | 'node'; node?: GNode; moved: boolean; sx: number; sy: number; ox: number; oy: number }>(
    { mode: 'none', moved: false, sx: 0, sy: 0, ox: 0, oy: 0 },
  );
  const toSim = (clientX: number, clientY: number) => {
    const rect = svgRef.current!.getBoundingClientRect();
    return { x: (clientX - rect.left - view.x) / view.k, y: (clientY - rect.top - view.y) / view.k };
  };

  const onNodeDown = (e: React.PointerEvent, n: GNode) => {
    if (e.button === 2) return;   // let right-click open the context menu instead of starting a drag
    e.stopPropagation();
    stopAnim();                   // a grab takes over from any in-flight fit tween
    (e.target as Element).setPointerCapture?.(e.pointerId);
    drag.current = { mode: 'node', node: n, moved: false, sx: e.clientX, sy: e.clientY, ox: 0, oy: 0 };
    // Deliberately do NOT reheat the simulation here. onMove drives the grabbed node directly, so a
    // motionless click-and-hold should leave the (cooled) map perfectly still. Reheating to a sustained
    // alphaTarget on mere pointer-down kept the sim ticking with nothing pinned, so every node drifted
    // under the forces — the whole graph "spun like a galaxy" just from holding a node.
  };
  const onBgDown = (e: React.PointerEvent) => {
    if (e.button === 2) return;   // don't start a pan on right-click
    stopAnim();                   // a pan takes over from any in-flight fit tween
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    drag.current = { mode: 'pan', moved: false, sx: e.clientX, sy: e.clientY, ox: view.x, oy: view.y };
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (d.mode === 'none') return;
    if (Math.abs(e.clientX - d.sx) + Math.abs(e.clientY - d.sy) > 3) d.moved = true;
    if (d.mode === 'pan') {
      setView(v => ({ ...v, x: d.ox + (e.clientX - d.sx), y: d.oy + (e.clientY - d.sy) }));
    } else if (d.mode === 'node' && d.node) {
      const p = toSim(e.clientX, e.clientY);
      // Move ONLY the grabbed node — set x/y directly (not just fx/fy) so it tracks the cursor
      // without the simulation running, which is what kept the rest of the map drifting.
      d.node.fx = p.x; d.node.fy = p.y;
      d.node.x = p.x; d.node.y = p.y;
      setTick(t => t + 1);
    }
  };
  const onUp = (e: React.PointerEvent) => {
    const d = drag.current;
    if (d.mode === 'node' && d.node) {
      simRef.current?.alphaTarget(0);   // stop reheating → the map cools and settles
      if (!d.moved) onPreview(d.node.card.name);   // a click (not a drag) opens the card
      // leave fx/fy pinned so the player's arrangement sticks
    }
    drag.current = { mode: 'none', moved: false, sx: 0, sy: 0, ox: 0, oy: 0 };
    (e.target as Element).releasePointerCapture?.(e.pointerId);
  };
  // Zoom on wheel via a NON-passive native listener so preventDefault actually fires — that traps
  // the scroll inside the graph instead of letting it bubble up and scroll the optimizer pane.
  // (React's JSX onWheel is registered passive, where preventDefault is a no-op.)
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (rafRef.current != null) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }  // zoom overrides a fit tween
      const svg = svgRef.current;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      const mx = e.clientX - rect.left, my = e.clientY - rect.top;
      setView(v => {
        const k2 = clamp(v.k * (e.deltaY < 0 ? 1.12 : 1 / 1.12), 0.3, 3);
        return { k: k2, x: mx - (mx - v.x) * (k2 / v.k), y: my - (my - v.y) * (k2 / v.k) };
      });
    };
    wrap.addEventListener('wheel', onWheel, { passive: false });
    return () => wrap.removeEventListener('wheel', onWheel);
  }, []);

  // Neighbours of the hovered node (for the constellation spotlight).
  const neighbours = useMemo(() => {
    if (!hover) return null;
    const set = new Set<string>([hover]);
    for (const l of links) {
      const s = typeof l.source === 'object' ? l.source.id : l.source;
      const t = typeof l.target === 'object' ? l.target.id : l.target;
      if (s === hover) set.add(t);
      if (t === hover) set.add(s);
    }
    return set;
  }, [hover, links]);

  const hoverNode = hover ? nodes.find(n => n.id === hover) : null;

  return (
    <div
      ref={wrapRef}
      className="relative w-full min-h-[460px] rounded-xl overflow-hidden border border-border/60 select-none animate-brew-view-in"
      style={{
        height: fillH != null ? `${fillH}px` : '68vh',
        background:
          'radial-gradient(120% 90% at 30% 10%, hsl(262 60% 16% / 0.55), transparent 60%),' +
          'radial-gradient(100% 80% at 80% 90%, hsl(292 60% 16% / 0.45), transparent 55%),' +
          'radial-gradient(circle at 50% 50%, hsl(220 30% 9%), hsl(222 36% 6%))',
      }}
    >
      {/* faint star grain */}
      <div aria-hidden className="pointer-events-none absolute inset-0 opacity-[0.5]"
        style={{ backgroundImage: 'radial-gradient(circle, hsl(0 0% 100% / 0.10) 0.5px, transparent 0.5px)', backgroundSize: '34px 34px' }} />

      <svg
        ref={svgRef}
        className="absolute inset-0 w-full h-full touch-none cursor-grab active:cursor-grabbing"
        onPointerDown={onBgDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
      >
        <defs>
          <filter id="lg-glow" x="-80%" y="-80%" width="260%" height="260%">
            <feGaussianBlur stdDeviation="3" result="b" />
            <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>

        <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
          {/* ── ley-lines ── */}
          <g>
            {links.map((l, i) => {
              const s = typeof l.source === 'object' ? l.source : nodes.find(n => n.id === l.source)!;
              const t = typeof l.target === 'object' ? l.target : nodes.find(n => n.id === l.target)!;
              if (!s || !t) return null;
              const tname = typeof l.target === 'object' ? l.target.id : l.target;
              const focused = hover && neighbours?.has(s.id) && neighbours?.has(t.id);
              const hoverDim = hover && !focused;
              const filterDim = !!activeHubs && !matchedNames.has(tname);  // its candidate is filtered out
              const hue = deckMode ? HUE.synergy : bombNames.has(tname) ? HUE.bomb : HUE.cluster;
              return (
                <line
                  key={i}
                  x1={s.x ?? 0} y1={s.y ?? 0} x2={t.x ?? 0} y2={t.y ?? 0}
                  stroke={`hsl(${hue})`}
                  strokeWidth={(0.4 + l.cw * 2.8) / view.k * (focused ? 1.4 : 1)}
                  strokeOpacity={filterDim ? 0.03 : hoverDim ? 0.05 : (0.1 + l.cw * 0.8) * (focused ? 1.3 : 1)}
                  strokeLinecap="round"
                  style={{ transition: 'stroke-opacity 160ms' }}
                />
              );
            })}
          </g>

          {/* ── stars (nodes) ── */}
          <g>
            {nodes.map((n) => {
              const hue = nodeHue(n);
              const hoverDim = hover && !neighbours?.has(n.id);
              // Filtered-out nodes recede hard; hover-dimmed (but matching) nodes fade gently.
              const filterDim = !!activeHubs && (n.kind === 'deck' ? !activeHubs.has(n.id) : !matchedNames.has(n.id));
              // Solo halo cards sit quiet at rest so the connected core reads, but brighten when hovered
              // (themselves or as a neighbour — though solo cards have no ties, so only on direct hover).
              const soloDim = n.solo && hover !== n.id && !neighbours?.has(n.id);
              const opacity = filterDim ? 0.12 : hoverDim ? 0.28 : soloDim ? 0.4 : 1;
              const isHub = n.kind === 'deck';
              const isFocus = !!n.focus;   // selected "pairs with" anchor — gets the bright pulsing treatment
              // Emphasis swap: candidates (the cards worth adding) are the round, glowing "objects of
              // interest"; your existing deck cards are grounded rounded-squares with only a quiet halo.
              const rr = n.r * 0.32;             // corner radius for the squared deck-card nodes
              const haloPad = isHub ? 4 : 7;
              const haloR = n.r + haloPad;
              return (
                <g
                  key={n.id}
                  transform={`translate(${n.x ?? 0},${n.y ?? 0})`}
                  style={{ opacity, cursor: 'pointer', transition: 'opacity 160ms' }}
                  onPointerDown={(e) => onNodeDown(e, n)}
                  onPointerEnter={() => setHover(n.id)}
                  onPointerLeave={() => setHover(h => (h === n.id ? null : h))}
                  onContextMenu={(e) => {
                    if (!onCardAction) return;
                    e.preventDefault(); e.stopPropagation();
                    const rect = wrapRef.current?.getBoundingClientRect();
                    setMenuFor({ card: n.card, x: e.clientX - (rect?.left ?? 0), y: e.clientY - (rect?.top ?? 0), isDeck: n.kind === 'deck' });
                  }}
                >
                  {/* glow halo — candidates get the bright pulsing glow; deck cards a quiet static one */}
                  {isFocus ? (
                    <path d={starPath(haloR, haloR * STAR_INNER)} fill={`hsl(${hue})`} opacity={0.5} filter="url(#lg-glow)" className="lg-pulse" />
                  ) : isHub ? (
                    <rect x={-haloR} y={-haloR} width={haloR * 2} height={haloR * 2} rx={rr + haloPad}
                      fill={`hsl(${hue})`} opacity={0.16} filter="url(#lg-glow)" />
                  ) : (
                    <circle r={haloR} fill={`hsl(${hue})`} opacity={0.3} filter="url(#lg-glow)" className="lg-pulse" />
                  )}
                  {/* art face */}
                  {isFocus
                    ? <path d={starPath(n.r, n.r * STAR_INNER)} fill="hsl(220 30% 12%)" />
                    : isHub
                      ? <rect x={-n.r} y={-n.r} width={n.r * 2} height={n.r * 2} rx={rr} fill="hsl(220 30% 12%)" />
                      : <circle r={n.r} fill="hsl(220 30% 12%)" />}
                  <image
                    href={artUrl(n.card)} x={-n.r} y={-n.r} width={n.r * 2} height={n.r * 2}
                    preserveAspectRatio="xMidYMid slice" pointerEvents="none"
                    style={{ clipPath: isFocus ? STAR_CLIP : isHub ? `inset(0 round ${rr}px)` : 'circle(50%)' }}
                  />
                  {/* ring (dashed when low-confidence) */}
                  {isFocus
                    ? <path d={starPath(n.r, n.r * STAR_INNER)} fill="none" stroke={`hsl(${hue})`} strokeWidth={2.5} strokeLinejoin="round" opacity={1} />
                    : isHub
                      ? <rect x={-n.r} y={-n.r} width={n.r * 2} height={n.r * 2} rx={rr} fill="none" stroke={`hsl(${hue})`}
                          strokeWidth={1.8} strokeDasharray={n.lowConf ? '3 3' : undefined} opacity={0.9} />
                      : <circle r={n.r} fill="none" stroke={`hsl(${hue})`} strokeWidth={2.4}
                          strokeDasharray={n.lowConf ? '3 3' : undefined} opacity={0.95} />}
                  {/* transient "found it" ping from the Find control — a bright white pulse, no filtering */}
                  {located === n.id && (
                    <circle r={n.r + 6} fill="none" stroke="hsl(0 0% 100%)" strokeWidth={2.5} opacity={0.9} className="lg-pulse" />
                  )}
                  {/* Persistent check once a candidate has been added. Adding itself is via right-click →
                      context menu, so there's no left-click '+' affordance here. */}
                  {!isHub && addedCards.has(n.id) && (
                    <g transform={`translate(${n.r * 0.8},${-n.r * 0.8})`} pointerEvents="none">
                      <circle r={clamp(n.r * 0.5, 7, 10)} fill="hsl(152 45% 16%)" stroke="hsl(152 60% 50%)" strokeWidth={1.5} />
                      <path d="M -3 0 L -1 2.4 L 3.4 -2.8" fill="none" stroke="hsl(152 85% 82%)" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
                    </g>
                  )}
                </g>
              );
            })}
          </g>
        </g>
      </svg>

      {/* ── how-to-read key + find + toolbar (top-left) ── */}
      <div className="absolute top-3 left-3 flex items-center gap-2">
        <InfoTooltip text={GRAPH_KEY} placement="bottom">
          <span className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-background/70 backdrop-blur px-2.5 py-1 text-[10px] text-muted-foreground hover:text-foreground cursor-help">
            <HelpCircle className="w-3 h-3" /> How to read
          </span>
        </InfoTooltip>
        {toolbar}
        {nodes.length > 0 && (
          <button onClick={() => setFindOpen(o => !o)}
            className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] backdrop-blur transition-colors ${findOpen ? 'border-fuchsia-400/50 bg-fuchsia-500/15 text-fuchsia-100' : 'border-border/60 bg-background/70 text-muted-foreground hover:text-foreground'}`}
            title="Find a card and zoom the camera to it (doesn't filter)">
            <Search className="w-3 h-3" /> Find
          </button>
        )}
      </div>

      {/* Find dropdown — rendered IN the graph (not a portal) so it stays inside the full-screen element;
          a Radix Popover would portal to <body>, move focus out of fullscreen, and drop us out of it. */}
      {findOpen && nodes.length > 0 && (
        <>
          <div className="absolute inset-0 z-20" onClick={() => setFindOpen(false)} aria-hidden />
          <div className="absolute top-12 left-3 z-30 w-64 rounded-lg border border-border/70 bg-popover/95 backdrop-blur shadow-xl overflow-hidden">
            <NodeFinder nodes={nodes} onPick={(id) => { centerOnNode(id); setFindOpen(false); }} />
          </div>
        </>
      )}

      {/* ── legend + reset (top-right) ── */}
      <div className="absolute top-3 right-3 flex items-center gap-2">
        <div className="flex items-center gap-2.5 rounded-full border border-border/60 bg-background/70 backdrop-blur px-3 py-1 text-[10px] text-muted-foreground">
          <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-[2px]" style={{ background: `hsl(${HUE.deck})` }} /> your cards</span>
          <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ background: `hsl(${HUE.bomb})` }} /> high-lift</span>
          <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ background: `hsl(${HUE.cluster})` }} /> clusters</span>
        </div>
        <button onClick={onExport} disabled={exporting}
          title={exportFailed ? 'Export failed — try again' : 'Download share image'}
          className={`grid place-items-center w-7 h-7 rounded-full border backdrop-blur transition-colors disabled:opacity-60 ${exportFailed ? 'border-red-400/60 bg-red-500/10 text-red-300' : 'border-border/60 bg-background/70 text-muted-foreground hover:text-foreground'}`}>
          {exporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Camera className="w-3.5 h-3.5" />}
        </button>
        <button onClick={fitView} title="Fit to view"
          className="grid place-items-center w-7 h-7 rounded-full border border-border/60 bg-background/70 backdrop-blur text-muted-foreground hover:text-foreground transition-colors">
          <Maximize2 className="w-3.5 h-3.5" />
        </button>
        <button onClick={toggleFs} title={isFs ? 'Exit full screen' : 'Explore full screen'}
          className="grid place-items-center w-7 h-7 rounded-full border border-border/60 bg-background/70 backdrop-blur text-muted-foreground hover:text-foreground transition-colors">
          {isFs ? <Shrink className="w-3.5 h-3.5" /> : <Expand className="w-3.5 h-3.5" />}
        </button>
      </div>

      <p className="absolute bottom-2 left-1/2 -translate-x-1/2 text-[10px] text-muted-foreground/60 pointer-events-none">
        drag to pan · scroll to zoom · click to preview
      </p>

      {/* ── hover tooltip ── */}
      {hoverNode && hoverNode.x != null && (() => {
        const sx = hoverNode.x! * view.k + view.x;
        const sy = hoverNode.y! * view.k + view.y;
        const cand = candidates.find(c => c.card.name === hoverNode.id);
        const isDeck = hoverNode.kind === 'deck';
        const added = addedCards.has(hoverNode.id);
        const byScore = cand ? [...cand.edges].sort((a, b) => edgeScore(b) - edgeScore(a)) : [];
        const top = byScore[0] ?? null;
        const liftStr = (l: number) => (l >= 99 ? '99+' : `×${l.toFixed(1)}`);
        // Graph connections: a deck node's = links touching it (finds it anchors, or deck-mode ties); a
        // candidate's = your cards pulling it. Count both edge ends so deck↔deck ties tally correctly.
        const degree = isDeck
          ? links.reduce((n, l) => {
              const s = typeof l.source === 'object' ? l.source.id : l.source;
              const t = typeof l.target === 'object' ? l.target.id : l.target;
              return n + (s === hoverNode.id || t === hoverNode.id ? 1 : 0);
            }, 0)
          : (cand?.connectionCount ?? 0);
        const accent = hoverNode.kind === 'bomb' ? 'text-fuchsia-300' : hoverNode.kind === 'cluster' ? 'text-sky-300' : 'text-amber-300';
        // For a deck-card hub, estimate how many EDHREC decks back its numbers. coPct = sharedDecks /
        // cardDecks, so cardDecks = numDecks / (coPct/100); the best-supported edge to it is most accurate.
        let hubDecks: number | null = null;
        if (isDeck) {
          let bestNum = 0;
          for (const c of candidates) for (const e of c.edges) {
            if (e.seed === hoverNode.id && e.coPct > 0 && e.numDecks >= bestNum) {
              bestNum = e.numDecks;
              hubDecks = Math.round(e.numDecks / (e.coPct / 100));
            }
          }
        }
        // Drop the card below the node when it's too near the top edge, so the (taller) tooltip
        // isn't clipped by the canvas's overflow-hidden.
        const half = hoverNode.r * view.k;
        const placeBelow = sy - half < 150;
        const ttTop = placeBelow ? sy + half + 8 : sy - half - 8;
        return (
          <div
            className={`absolute z-20 -translate-x-1/2 ${placeBelow ? '' : '-translate-y-full'} pointer-events-none`}
            style={{ left: clamp(sx, 120, size.w - 120), top: clamp(ttTop, 8, size.h - 8) }}
          >
            <div className="flex gap-2.5 rounded-lg border border-border/70 bg-popover/95 backdrop-blur shadow-xl p-2 w-max max-w-[300px]">
              <img
                src={getCardImageUrl(hoverNode.card, 'small') || scryfallImg(hoverNode.id)}
                alt={hoverNode.id}
                className="w-14 h-auto self-start rounded shadow-md shrink-0"
                loading="lazy"
                onError={(e) => { (e.target as HTMLImageElement).src = scryfallImg(hoverNode.id); }}
              />
              <div className="min-w-0 flex flex-col">
                <div className="flex items-center gap-2">
                  <div className="flex-1 min-w-0 truncate text-xs font-semibold leading-tight">{hoverNode.id}</div>
                  {hoverNode.card.mana_cost && <ManaCost cost={hoverNode.card.mana_cost} className="shrink-0 text-[10px]" />}
                </div>
                <div className="mt-0.5 text-[10px] text-muted-foreground truncate">{hoverNode.card.type_line}</div>

                <div className="my-1.5 h-px bg-border/60" />

                {isDeck ? (
                  <div className="text-[11px] text-muted-foreground">
                    <span className={accent}>{hoverNode.commander ? 'Your commander' : 'In your deck'}</span>
                    {degree > 0 && <> · {deckMode ? `${degree} synergy ${degree === 1 ? 'tie' : 'ties'}` : `anchors ${degree} ${degree === 1 ? 'find' : 'finds'}`}</>}
                    {hubDecks != null && (
                      <div className="mt-0.5 text-[10px] text-muted-foreground/80">~{hubDecks.toLocaleString()} decks on EDHREC</div>
                    )}
                  </div>
                ) : hoverNode.kind === 'bomb' ? (
                  <div className="space-y-0.5">
                    {top && (
                      <>
                        <div className="text-[11px]">
                          <span className={`font-semibold ${accent}`}>{liftStr(top.lift)} lift</span> with{' '}
                          <span className="font-medium text-foreground">{top.seed}</span>
                        </div>
                        <div className="text-[10px] text-muted-foreground">
                          played in {top.coPct}% of {top.seed} decks · {top.numDecks.toLocaleString()} shared
                        </div>
                      </>
                    )}
                  </div>
                ) : (
                  <div className="space-y-1">
                    <div className="text-[11px]">
                      <span className={`font-semibold ${accent}`}>pulled by {degree}</span> of your cards
                    </div>
                    <div className="space-y-px">
                      {byScore.slice(0, 3).map(e => (
                        <div key={e.seed} className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                          <span className="tabular-nums text-sky-300/80 w-10 shrink-0">{liftStr(e.lift)}</span>
                          <span className="truncate">{e.seed}</span>
                        </div>
                      ))}
                      {byScore.length > 3 && <div className="text-[10px] text-muted-foreground/70">+{byScore.length - 3} more</div>}
                    </div>
                  </div>
                )}

                {!isDeck && (added || hoverNode.lowConf) && (
                  <div className="mt-1.5 flex items-center gap-2">
                    {added && <span className="inline-flex items-center gap-1 text-[11px] text-emerald-400"><Check className="w-3 h-3" /> Added</span>}
                    {hoverNode.lowConf && <span className="text-[10px] text-amber-300/90">thin data — few shared decks</span>}
                  </div>
                )}
                {!isDeck && !added && (
                  <div className="mt-1.5 text-[10px] text-muted-foreground/70">click to preview · right-click for options</div>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── right-click context menu, anchored at the cursor ── */}
      {menuFor && onCardAction && (
        <div
          className="absolute z-30 [&>button]:h-0 [&>button]:w-0 [&>button]:overflow-hidden [&>button]:p-0 [&>button]:opacity-0"
          style={{ left: menuFor.x, top: menuFor.y }}
        >
          <CardContextMenu
            card={menuFor.card}
            onAction={onCardAction}
            hasRemove={menuFor.isDeck}
            hasAddToDeck={!menuFor.isDeck}
            hasSideboard={!menuFor.isDeck}
            hasMaybeboard={!menuFor.isDeck}
            isInSideboard={menuProps?.sideboardNames.has(menuFor.card.name)}
            isInMaybeboard={menuProps?.maybeboardNames.has(menuFor.card.name)}
            userLists={menuProps?.userLists ?? []}
            isMustInclude={menuProps?.mustIncludeNames.has(menuFor.card.name)}
            isBanned={menuProps?.bannedNames.has(menuFor.card.name)}
            onFocus={onFocusCard && menuFor.isDeck ? () => onFocusCard(menuFor.card.name) : undefined}
            forceOpen
            onForceClose={() => setMenuFor(null)}
          />
        </div>
      )}
    </div>
  );
}
