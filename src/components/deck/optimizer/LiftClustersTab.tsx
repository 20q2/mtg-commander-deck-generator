import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChartNetwork, Plus, Check, Zap, Network, List, Share2, Anchor, Search, X, Link2, Flame, Layers, Unlink, Mountain, Loader2, Package, ChevronDown } from 'lucide-react';
import type { ScryfallCard } from '@/types';
import { getCardImageUrl } from '@/services/scryfall/client';
import { useCollection } from '@/hooks/useCollection';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { CardContextMenu, type CardAction } from '@/components/deck/DeckDisplay';
import { MagnifiedPreview } from '@/components/playtest/MagnifiedPreview';
import { scryfallImg } from './constants';
import type { CardRowMenuProps } from './shared';
import { scanLiftCandidates, edgeScore, bombScore, clusterScore, LIFT_SCAN_CACHE, liftDeckKey, buildLiftScanInputs, type LiftCandidate, type DeckLink } from '@/services/optimizer/liftClusters';
import { LiftGraph } from './LiftGraph';

/**
 * Experimental "Lift Web". Reads EDHREC lift across the deck and surfaces only the two extremes worth
 * a brewer's attention, both anchored to cards you ACTUALLY run:
 *   • Bombs — a card that lifts insanely high with a SINGLE one of your cards (secret tech for it).
 *   • Clusters — a card pulled by SEVERAL of your cards at once (an emergent package).
 * No second-order / theoretical chains: every result connects directly to your real deck.
 */

interface LiftClustersTabProps {
  currentCards: ScryfallCard[];
  commander?: ScryfallCard;
  partnerCommander?: ScryfallCard;
  commanderName: string;
  partnerCommanderName?: string;
  colorIdentity?: string[];
  onAdd: (name: string) => void;
  addedCards: Set<string>;
  onPreview: (name: string) => void;
  onCardAction?: (card: ScryfallCard, action: CardAction) => void;
  menuProps: CardRowMenuProps;
  focusRequest?: { name: string; seq: number } | null;   // external "Focus on graph" (e.g. deck-building area)
  deckViewRequest?: { seq: number } | null;               // external "Explore islands" (e.g. Overview lift tile)
  deckName?: string;                                     // saved-list name — titles the share-card export
}

type ScanState =
  | { phase: 'idle' }
  | { phase: 'scanning'; done: number; total: number }
  | { phase: 'building' }   // fetch done; resolving candidates + laying out the graph
  | { phase: 'done'; candidates: LiftCandidate[]; deckLinks: DeckLink[] }
  | { phase: 'error'; message: string };

const MAX_RESULTS = 40;   // per kind → up to 80 candidate cards (bombs + clusters) plotted
const HIGH_LIFT = 5;         // "insanely high" single-card lift threshold (tunable)
const CLUSTER_MIN_CONN = 2;  // a cluster = lifted by at least this many of your cards
const CONFIDENCE_FLOOR = 50; // bestNumDecks below this = low-confidence (matches client LIFT_STRICT_FLOOR)

/** EDHREC caps lift display at 99+; mirror that so absurd values never read as e.g. ×1376. */
const liftLabel = (l: number) => (l >= 99 ? '99+' : `×${l.toFixed(1)}`);

// A "staple" is a card with a high overall play rate — strong everywhere, not deck-specific tech.
// That play rate is recoverable from any edge: lift = coPlay% ÷ baseline%, so baseline% = coPct / lift
// (mathematically identical across a card's edges — it's just P(card)). Above this baseline we flag and
// demote the card so the bombs list keeps leading with genuine, niche spice.
const STAPLE_BASELINE_PCT = 3.5;
function baselinePct(edges: LiftCandidate['edges']): number | null {
  const top = [...edges].sort((a, b) => edgeScore(b) - edgeScore(a))[0];
  if (!top || top.lift <= 0) return null;
  return top.coPct / top.lift;
}
const isStaple = (edges: LiftCandidate['edges']) => (baselinePct(edges) ?? 0) >= STAPLE_BASELINE_PCT;

// ── Filter bar ────────────────────────────────────────────────────────
type TypeFilter = 'all' | 'bomb' | 'cluster' | 'deck';
interface LiftFilters {
  anchors: Set<string>;    // show only tech pairing with these deck cards (empty = all)
  type: TypeFilter;        // bombs / clusters / both / deck
  hideStaples: boolean;    // drop broadly-played good-stuff (bombs only)
  hideThin: boolean;       // drop low-confidence "thin data" hits
  collectionOnly: boolean; // keep only cards you own in your collection
  hideIslands: boolean;    // (deck mode) drop "islands" — cards with no synergy tie to anything (default on)
  hideLands: boolean;      // (deck mode) drop lands — only offered once islands are shown
}
const EMPTY_FILTERS: LiftFilters = { anchors: new Set(), type: 'all', hideStaples: false, hideThin: false, collectionOnly: false, hideIslands: true, hideLands: false };

// Hard filters — "Spice only" / "Hide thin data" / "Pairs with" REMOVE a candidate from the lab entirely
// (out of both the list and the graph, regardless of the graph's dim/hide mode). "Pairs with" is a
// focusing action — pick a deck card and the lab narrows to just the tech tied to it — so it belongs here
// rather than merely dimming everything else (which, since each bomb has one anchor, fades nearly all of them).
function passesHardFilters(c: LiftCandidate, f: LiftFilters, collectionNames?: Set<string>): boolean {
  if (f.hideThin && c.bestNumDecks < CONFIDENCE_FLOOR) return false;
  if (f.hideStaples && isStaple(c.edges)) return false;  // drop broadly-played good-stuff (any card, not just bombs)
  if (f.anchors.size && !c.edges.some(e => f.anchors.has(e.seed))) return false;
  if (f.collectionOnly && !collectionNames?.has(c.card.name)) return false;  // only cards you own
  return true;
}

// Soft filter — type only. Drives the graph's dim-or-hide highlighting and slices the list.
function candidateMatches(_c: LiftCandidate, isBomb: boolean, f: LiftFilters): boolean {
  if (f.type === 'deck') return false;   // deck mode plots deck↔deck ties, not candidate cards
  if (f.type !== 'all' && (f.type === 'bomb') !== isBomb) return false;
  return true;
}

export function LiftClustersTab(props: LiftClustersTabProps) {
  const { currentCards, commander, partnerCommander, commanderName, partnerCommanderName, colorIdentity } = props;
  const [state, setState] = useState<ScanState>({ phase: 'idle' });
  // Owned-card names for the "In collection" filter. Mirror getCollectionNameSet: include the
  // front-face name of DFCs too, since EDHREC-sourced candidates often carry the front face only.
  const { cards: collectionCards } = useCollection();
  const collectionNames = useMemo(() => {
    const s = new Set<string>();
    for (const c of collectionCards) {
      s.add(c.name);
      if (c.name.includes(' // ')) s.add(c.name.split(' // ')[0]);
    }
    return s;
  }, [collectionCards]);
  // A re-scan when results are already on screen: keep the graph up (don't blank to the progress bar,
  // which would unmount the canvas and drop fullscreen). Just spin the Recheck button.
  const [rechecking, setRechecking] = useState(false);
  const stateRef = useRef(state);
  stateRef.current = state;
  const cancelledRef = useRef(false);
  useEffect(() => () => { cancelledRef.current = true; }, []);

  const deckKey = useMemo(
    () => liftDeckKey(commanderName, partnerCommanderName, currentCards),
    [commanderName, partnerCommanderName, currentCards],
  );

  const runScan = useCallback(async (force = false) => {
    cancelledRef.current = false;
    const { seedNames, excludeNames: exclude, identity } = buildLiftScanInputs({
      commander, partnerCommander, commanderName, partnerCommanderName, currentCards, colorIdentity,
    });
    // If results are already showing, keep them up and just flag a recheck — don't swap to the
    // progress bar, which unmounts the graph (and drops fullscreen). The progress bar is only for
    // the very first scan, when there's nothing to show yet.
    const keepGraph = stateRef.current.phase === 'done';
    if (keepGraph) setRechecking(true);
    else setState({ phase: 'scanning', done: 0, total: seedNames.length });
    try {
      const result = await scanLiftCandidates({
        seedNames,
        identity,
        excludeNames: exclude,
        force,
        // Climb to N/N during the fetch, then flip to "building" while we resolve candidates and lay
        // out the graph — so the bar doesn't sit frozen at "66 / 66" through the (network) build step.
        onProgress: (done, total) => {
          if (cancelledRef.current || keepGraph) return;
          setState(done >= total ? { phase: 'building' } : { phase: 'scanning', done, total });
        },
        isCancelled: () => cancelledRef.current,
      });
      if (cancelledRef.current) return;
      LIFT_SCAN_CACHE.set(deckKey, result);
      setState({ phase: 'done', candidates: result.candidates, deckLinks: result.deckLinks });
      setRechecking(false);
    } catch (e) {
      if (cancelledRef.current) return;
      setRechecking(false);
      if (!keepGraph) setState({ phase: 'error', message: e instanceof Error ? e.message : 'Scan failed' });
      // On a recheck failure we keep the existing results on screen rather than tearing the graph down.
    }
  }, [currentCards, commanderName, partnerCommanderName, commander, partnerCommander, colorIdentity, deckKey]);

  // Auto-run on first open per deck; show cached results instantly; re-run when the decklist changes.
  const runScanRef = useRef(runScan);
  runScanRef.current = runScan;
  useEffect(() => {
    const cached = LIFT_SCAN_CACHE.get(deckKey);
    if (cached) { setState({ phase: 'done', candidates: cached.candidates, deckLinks: cached.deckLinks }); return; }
    if (currentCards.length === 0) return;
    runScanRef.current();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deckKey]);

  // Bombs: insane lift with a single one of your cards (one strong edge is enough — breadth not required).
  const bombs = useMemo(() => {
    if (state.phase !== 'done') return [];
    return [...state.candidates]
      .filter(c => c.bestLift >= HIGH_LIFT)
      .map(c => ({ c, s: bombScore(c) }))      // lift × inclusion × sample-confidence
      .sort((a, b) => b.s - a.s)
      .slice(0, MAX_RESULTS)
      .map(x => x.c);
  }, [state]);

  // Clusters: lifted by several of your cards at once. Bombs already shown are excluded here.
  const clusters = useMemo(() => {
    if (state.phase !== 'done') return [];
    const bombNames = new Set(bombs.map(c => c.card.name));
    return [...state.candidates]
      .filter(c => c.connectionCount >= CLUSTER_MIN_CONN && !bombNames.has(c.card.name))
      .map(c => ({ c, s: clusterScore(c) }))   // summed lift×inclusion across the cards that lift it
      .sort((a, b) => b.s - a.s)
      .slice(0, MAX_RESULTS)
      .map(x => x.c);
  }, [state, bombs]);

  // ── Graph view ──────────────────────────────────────────────────────
  const [viewMode, setViewMode] = useState<'list' | 'graph'>('graph');
  const fsRef = useRef<HTMLDivElement>(null);   // wraps filter bar + graph → the full-screen target
  const deckLinks = state.phase === 'done' ? state.deckLinks : [];
  const graphCandidates = useMemo(() => [...bombs, ...clusters], [bombs, clusters]);
  const bombNameSet = useMemo(() => new Set(bombs.map(c => c.card.name)), [bombs]);
  const graph = useMemo(() => {
    const deckCardsByName = new Map<string, ScryfallCard>();
    for (const c of currentCards) deckCardsByName.set(c.name, c);
    if (commander) deckCardsByName.set(commander.name, commander);
    if (partnerCommander) deckCardsByName.set(partnerCommander.name, partnerCommander);
    const commanderNamesSet = new Set<string>([commanderName, ...(partnerCommanderName ? [partnerCommanderName] : [])]);
    return { deckCardsByName, commanderNamesSet };
  }, [currentCards, commander, partnerCommander, commanderName, partnerCommanderName]);

  // ── Filter bar state (one source of truth; drives both list and graph) ──
  const [filters, setFilters] = useState<LiftFilters>(EMPTY_FILTERS);
  const patchFilters = useCallback((p: Partial<LiftFilters>) => setFilters(f => ({ ...f, ...p })), []);
  // Clear the filters but stay in the current mode (All/Bombs/Clusters/Deck) — only reset anchors + toggles.
  const clearFilters = useCallback(() => setFilters(f => ({ ...EMPTY_FILTERS, type: f.type })), []);

  // External "Focus on graph" (e.g. right-click in the deck-building area): jump to the deck graph
  // and drill into that card. Keyed on `seq` so re-focusing the same card re-fires.
  const focusSeq = props.focusRequest?.seq;
  useEffect(() => {
    const req = props.focusRequest;
    if (!req) return;
    setFilters(f => ({ ...f, type: 'deck', anchors: new Set([req.name]) }));
    setViewMode('graph');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusSeq]);

  // External "Explore islands" (e.g. the Overview lift tile): jump to Your deck graph with
  // islands revealed and lands hidden, so the outliers the tile flagged are front and center.
  const deckViewSeq = props.deckViewRequest?.seq;
  useEffect(() => {
    if (!props.deckViewRequest) return;
    setFilters(f => ({ ...f, type: 'deck', anchors: new Set(), hideIslands: false, hideLands: true }));
    setViewMode('graph');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deckViewSeq]);

  // Cards on the exclude list ("banned") never belong in the lab — drop them from the pool entirely
  // (graph + list) and count how many we hid, to note in the "X of Y" readout.
  const bannedNames = props.menuProps.bannedNames;
  const excludedCount = useMemo(
    () => graphCandidates.reduce((n, c) => n + (bannedNames.has(c.card.name) ? 1 : 0), 0),
    [graphCandidates, bannedNames],
  );
  const visibleCandidates = useMemo(
    () => (excludedCount ? graphCandidates.filter(c => !bannedNames.has(c.card.name)) : graphCandidates),
    [graphCandidates, bannedNames, excludedCount],
  );

  // Deck cards that anchor at least one hit — the pool for the "pairs with" picker.
  const anchorNames = useMemo(() => {
    const s = new Set<string>();
    for (const c of visibleCandidates) for (const e of c.edges) if (graph.deckCardsByName.has(e.seed)) s.add(e.seed);
    return [...s].sort((a, b) => a.localeCompare(b));
  }, [visibleCandidates, graph.deckCardsByName]);

  // Only surface the "Hide thin data" toggle when the scan actually contains low-confidence hits —
  // computed over the full candidate pool (not the filtered one) so the toggle doesn't vanish on use.
  const hasThinData = useMemo(
    () => visibleCandidates.some(c => c.bestNumDecks < CONFIDENCE_FLOOR),
    [visibleCandidates],
  );

  // Hard filters drop candidates from the lab outright, so the graph never plots them (even while dimming).
  const keptCandidates = useMemo(
    () => visibleCandidates.filter(c => passesHardFilters(c, filters, collectionNames)),
    [visibleCandidates, bombNameSet, filters, collectionNames],
  );
  // Soft-filter matches among what survives — drives the graph's dim/hide and slices the list.
  const matchedNames = useMemo(() => {
    const s = new Set<string>();
    for (const c of keptCandidates) if (candidateMatches(c, bombNameSet.has(c.card.name), filters)) s.add(c.card.name);
    return s;
  }, [keptCandidates, bombNameSet, filters]);
  // The list always HIDES non-matches (a faded-but-present row reads as clutter).
  const visibleBombs = useMemo(() => bombs.filter(c => matchedNames.has(c.card.name)), [bombs, matchedNames]);
  const visibleClusters = useMemo(() => clusters.filter(c => matchedNames.has(c.card.name)), [clusters, matchedNames]);

  // Group bombs by the deck card they pair with, so we state each anchor once (instead of repeating
  // "with X" on every row) and make it obvious when a single card is pulling a whole package.
  // `visibleBombs` is already in score order, so first-seen anchor = group order, and items stay sorted.
  const bombGroups = useMemo(() => {
    const order: string[] = [];
    const map = new Map<string, { anchor: string; anchorCard?: ScryfallCard; items: LiftCandidate[] }>();
    for (const c of visibleBombs) {
      const top = [...c.edges].sort((a, b) => edgeScore(b) - edgeScore(a))[0];
      const anchor = top?.seed ?? '—';
      let g = map.get(anchor);
      if (!g) { g = { anchor, anchorCard: graph.deckCardsByName.get(anchor), items: [] }; map.set(anchor, g); order.push(anchor); }
      g.items.push(c);
    }
    // Within each anchor, float genuine spice above staples (stable → score order kept per tier).
    for (const g of map.values()) g.items.sort((a, b) => Number(isStaple(a.edges)) - Number(isStaple(b.edges)));
    return order.map(a => map.get(a)!);
  }, [visibleBombs, graph.deckCardsByName]);

  const scanning = state.phase === 'scanning';
  const hasResults = state.phase === 'done' && (bombs.length > 0 || clusters.length > 0 || deckLinks.length > 0);

  return (
    // Once results are in, both graph and list span the full optimizer pane; only the pre-results
    // states (progress bar / messages) stay in a readable narrow column.
    <div className={`space-y-4 ${state.phase === 'done' ? '' : 'max-w-3xl'}`}>
      {scanning && (
        <div>
          <div className="h-1.5 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-fuchsia-500 rounded-full"
              style={{ width: `${state.total ? Math.round((state.done / state.total) * 100) : 0}%`, transition: 'width 200ms linear' }}
            />
          </div>
          <p className="text-[11px] text-muted-foreground mt-1 tabular-nums">
            Reading lift data… {state.done} / {state.total} cards
          </p>
        </div>
      )}

      {state.phase === 'building' && (
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <Loader2 className="w-3.5 h-3.5 animate-spin text-fuchsia-400 shrink-0" />
          Building lift graph…
        </div>
      )}

      {state.phase === 'error' && (
        <p className="text-sm text-destructive">Couldn’t finish the scan: {state.message}</p>
      )}

      {state.phase === 'done' && (
        !hasResults ? (
          <p className="text-sm text-muted-foreground max-w-3xl">
            No strong hits — nothing lifts above {HIGH_LIFT}× with a single card, and nothing clusters across two or more.
          </p>
        ) : (
          <div ref={fsRef} className="space-y-4 [&:fullscreen]:bg-background [&:fullscreen]:p-4 [&:fullscreen]:overflow-hidden">
            <LiftFilterBar
              filters={filters}
              patch={patchFilters}
              anchorNames={anchorNames}
              deckCardsByName={graph.deckCardsByName}
              matched={matchedNames.size}
              total={visibleCandidates.length}
              excluded={excludedCount}
              showThin={hasThinData}
              hasCollection={collectionNames.size > 0}
              viewMode={viewMode}
              setViewMode={setViewMode}
            />
            {viewMode === 'graph' ? (
              <LiftGraph
                mode={filters.type === 'deck' ? 'deck' : 'candidates'}
                candidates={keptCandidates}
                deckLinks={deckLinks}
                hideIslands={filters.hideIslands}
                hideLands={filters.hideLands}
                bombNames={bombNameSet}
                deckCardsByName={graph.deckCardsByName}
                commanderNames={graph.commanderNamesSet}
                confidenceFloor={CONFIDENCE_FLOOR}
                onPreview={props.onPreview}
                addedCards={props.addedCards}
                matchedNames={matchedNames}
                focusAnchors={filters.anchors}
                displayMode="hide"
                onCardAction={props.onCardAction}
                menuProps={props.menuProps}
                onFocusCard={(name) => patchFilters({ anchors: new Set([name]) })}
                fullscreenRef={fsRef}
                deckName={props.deckName}
                toolbar={
                  <button
                    onClick={() => runScan(true)}
                    disabled={scanning || rechecking}
                    title="Recheck deck for new lift data"
                    className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-background/70 backdrop-blur px-2.5 py-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors disabled:opacity-60"
                  >
                    {rechecking ? <Loader2 className="w-3 h-3 animate-spin" /> : <ChartNetwork className="w-3 h-3" />}
                    {rechecking ? 'Rechecking…' : 'Recheck'}
                  </button>
                }
              />
            ) : filters.type === 'deck' ? (
              <p className="text-sm text-muted-foreground max-w-3xl">
                Your deck's internal synergies are shown in the{' '}
                <button onClick={() => setViewMode('graph')} className="text-fuchsia-300 hover:underline">Graph view</button>.
              </p>
            ) : (visibleBombs.length === 0 && visibleClusters.length === 0) ? (
              <p className="text-sm text-muted-foreground max-w-3xl">
                No cards match these filters.{' '}
                <button onClick={clearFilters} className="text-fuchsia-300 hover:underline">Clear filters</button>
              </p>
            ) : (
            <>
            {visibleBombs.length > 0 && (
              <section className="space-y-2.5">
                <SectionHeading Icon={Zap} tone="fuchsia" title="High-lift hits"
                  hint="cards that spike in play rate beside a single one of yours" />
                <div className="space-y-2.5">
                  {bombGroups.map(g => <BombGroup key={g.anchor} group={g} tabProps={props} />)}
                </div>
              </section>
            )}

            {visibleClusters.length > 0 && (
              <section className="space-y-2.5">
                <SectionHeading Icon={Network} tone="sky" title="Clusters"
                  hint="cards pulled by several of your cards at once" />
                <div className="grid gap-2.5 [grid-template-columns:repeat(auto-fill,minmax(170px,1fr))]">
                  {visibleClusters.map(c => <LiftCandidateTile key={c.card.name} candidate={c} mode="cluster" {...props} />)}
                </div>
              </section>
            )}
            </>
            )}
          </div>
        )
      )}
    </div>
  );
}

const TYPE_OPTS: { key: TypeFilter; label: string; Icon?: typeof Zap }[] = [
  { key: 'all', label: 'All' },
  { key: 'bomb', label: 'High-lift', Icon: Zap },
  { key: 'cluster', label: 'Clusters', Icon: Network },
];

/** The Lift Web filter bar — type/deck view picker, pairs-with anchors, quality toggles, graph/list. */
function LiftFilterBar({
  filters, patch, anchorNames, deckCardsByName, matched, total, excluded,
  showThin, hasCollection, viewMode, setViewMode,
}: {
  filters: LiftFilters;
  patch: (p: Partial<LiftFilters>) => void;
  anchorNames: string[];
  deckCardsByName: Map<string, ScryfallCard>;
  matched: number;
  total: number;
  excluded: number;        // cards hidden because they're on the exclude list — noted beside the count
  showThin: boolean;       // only render "Hide thin data" when the scan actually has thin hits
  hasCollection: boolean;  // only render "In collection" when the user has a collection imported
  viewMode: 'list' | 'graph';
  setViewMode: (m: 'list' | 'graph') => void;
}) {
  const seg = (active: boolean) =>
    `inline-flex items-center gap-1 px-2.5 py-1 rounded-full transition-colors ${active ? 'bg-fuchsia-500/20 text-fuchsia-100' : 'text-muted-foreground hover:text-foreground'}`;
  // Deck is the odd one out (your own cards, not discovery) — give it the violet synergy accent, even
  // idle, so it reads as a different category within the same picker.
  const segDeck = (active: boolean) =>
    `inline-flex items-center gap-1 px-2.5 py-1 rounded-full transition-colors ${active ? 'bg-violet-500/25 text-violet-100' : 'text-violet-300/70 hover:text-violet-200'}`;
  const chip = (active: boolean) =>
    `inline-flex items-center gap-1 h-7 px-2.5 rounded-full border text-[11px] transition-colors ${active ? 'border-fuchsia-400/50 bg-fuchsia-500/15 text-fuchsia-100' : 'border-border/60 bg-card/40 text-muted-foreground hover:text-foreground'}`;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* ── Tier 1: the view picker (one choice). All/Bombs/Clusters discover cards to add; Deck — set
          off by a divider + violet accent — maps your own cards' synergy. ── */}
      <div className="inline-flex items-center rounded-full border border-border/60 bg-card/40 p-0.5 text-[11px] shrink-0">
        {TYPE_OPTS.map(({ key, label, Icon }) => (
          <button key={key} onClick={() => patch({ type: key })} className={seg(filters.type === key)}
            title="Cards not in your deck yet, surfaced by lift">
            {Icon && <Icon className="w-3 h-3" />}{label}
          </button>
        ))}
        <span className="mx-1 h-4 w-px bg-border/70" aria-hidden />
        <button
          onClick={() => { patch({ type: 'deck' }); setViewMode('graph'); }}
          className={segDeck(filters.type === 'deck')}
          title="Map how the cards already in your deck synergise with each other"
        >
          <Layers className="w-3 h-3" /> Your deck
        </button>
      </div>

      {/* ── Tier 2: refinements (modify the current view) — visually subordinate, after a divider. ── */}
      <span className="h-5 w-px bg-border/50 shrink-0" aria-hidden />

      {/* pairs-with anchor picker (+ its own clear ✕, so you can drop the focus without touching other filters) */}
      <div className="inline-flex items-center gap-1">
        <Popover>
          <PopoverTrigger asChild>
            <button className={chip(filters.anchors.size > 0)}>
              <Link2 className="w-3 h-3" /> Pairs with
              {filters.anchors.size > 0 && (
                <span className="ml-0.5 inline-grid place-items-center min-w-4 h-4 px-1 rounded-full bg-fuchsia-500/30 text-fuchsia-100 text-[10px] font-bold tabular-nums">
                  {filters.anchors.size}
                </span>
              )}
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-64 p-0">
            <AnchorPicker
              selected={filters.anchors}
              options={anchorNames}
              deckCardsByName={deckCardsByName}
              onChange={(anchors) => patch({ anchors })}
            />
          </PopoverContent>
        </Popover>
        {filters.anchors.size > 0 && (
          <button
            onClick={() => patch({ anchors: new Set() })}
            title="Clear pairs-with"
            aria-label="Clear pairs-with"
            className="inline-flex items-center justify-center w-6 h-7 rounded-full border border-fuchsia-400/40 bg-fuchsia-500/10 text-fuchsia-200/80 hover:bg-fuchsia-500/20 hover:text-fuchsia-100 transition-colors"
          >
            <X className="w-3 h-3" />
          </button>
        )}
      </div>

      {/* quality toggles — candidate modes get spice/thin; deck mode gets hide-lands */}
      {filters.type !== 'deck' ? (
        <>
          <button onClick={() => patch({ hideStaples: !filters.hideStaples })} className={chip(filters.hideStaples)}
            title="Hide broadly-played staples — keep deck-specific spice">
            <Flame className="w-3 h-3" /> Spice only
          </button>
          {showThin && (
            <button onClick={() => patch({ hideThin: !filters.hideThin })} className={chip(filters.hideThin)}
              title="Hide low-confidence hits based on only a few shared decks">
              Hide thin data
            </button>
          )}
          {hasCollection && (
            <button onClick={() => patch({ collectionOnly: !filters.collectionOnly })} className={chip(filters.collectionOnly)}
              title="Show only cards you own in your collection">
              <Package className="w-3 h-3" /> In collection
            </button>
          )}
        </>
      ) : (
        <>
          <button onClick={() => patch({ hideIslands: !filters.hideIslands })} className={chip(filters.hideIslands)}
            title="Hide islands — cards with no notable synergy tie to anything else, so the relationships have room to breathe">
            <Unlink className="w-3 h-3" /> Hide islands
          </button>
          {/* Lands rarely lift like spells, so once you reveal the islands you can still drop them. */}
          {!filters.hideIslands && (
            <button onClick={() => patch({ hideLands: !filters.hideLands })} className={chip(filters.hideLands)}
              title="Hide lands — they're widely played and rarely lift the way spells do">
              <Mountain className="w-3 h-3" /> Hide lands
            </button>
          )}
        </>
      )}

      {/* right side: count + graph/list toggle. Deck mode is inherently a synergy map (no list
          equivalent), so it drops the count and the toggle rather than offering a dead-end List view. */}
      {filters.type !== 'deck' && (
        <div className="ml-auto flex items-center gap-2 shrink-0">
          <span className="text-[11px] text-muted-foreground tabular-nums">
            {matched} of {total}
            {excluded > 0 && <span className="text-muted-foreground/70"> · {excluded} excluded</span>}
          </span>
          <div className="inline-flex items-center rounded-full border border-border/60 bg-card/40 p-0.5 text-[11px]">
            <button onClick={() => setViewMode('graph')} className={seg(viewMode === 'graph')} title="Star-map view">
              <Share2 className="w-3 h-3" /> Graph
            </button>
            <button onClick={() => setViewMode('list')} className={seg(viewMode === 'list')} title="List view">
              <List className="w-3 h-3" /> List
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Searchable checklist of your deck cards that anchor hits, for the "pairs with" filter. */
function AnchorPicker({ selected, options, deckCardsByName, onChange }: {
  selected: Set<string>;
  options: string[];
  deckCardsByName: Map<string, ScryfallCard>;
  onChange: (s: Set<string>) => void;
}) {
  const [q, setQ] = useState('');
  const shown = useMemo(
    () => (q ? options.filter(n => n.toLowerCase().includes(q.toLowerCase())) : options),
    [q, options],
  );
  const toggle = (name: string) => {
    const next = new Set(selected);
    if (next.has(name)) next.delete(name); else next.add(name);
    onChange(next);
  };
  return (
    <div className="flex flex-col max-h-80">
      <div className="p-2 border-b border-border/50">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search your cards…" className="h-8 pl-7 text-xs" autoFocus />
        </div>
      </div>
      <div className="overflow-y-auto py-1">
        {shown.length === 0 ? (
          <p className="px-3 py-4 text-center text-xs text-muted-foreground">No matching cards</p>
        ) : shown.map(name => {
          const on = selected.has(name);
          const card = deckCardsByName.get(name);
          return (
            <button key={name} onClick={() => toggle(name)}
              className="flex items-center gap-2 w-full px-2.5 py-1.5 text-left hover:bg-accent/50 transition-colors">
              <span className={`grid place-items-center w-4 h-4 rounded border shrink-0 ${on ? 'bg-fuchsia-500 border-fuchsia-500 text-white' : 'border-border'}`}>
                {on && <Check className="w-3 h-3" />}
              </span>
              <img src={(card && getCardImageUrl(card, 'small')) || scryfallImg(name)} alt="" className="w-5 h-auto rounded shrink-0" loading="lazy"
                onError={(e) => { (e.target as HTMLImageElement).src = scryfallImg(name); }} />
              <span className="text-xs truncate">{name}</span>
            </button>
          );
        })}
      </div>
      {selected.size > 0 && (
        <div className="p-2 border-t border-border/50">
          <button onClick={() => onChange(new Set())} className="text-[11px] text-muted-foreground hover:text-foreground">Clear selection</button>
        </div>
      )}
    </div>
  );
}

/** Section heading: coloured icon + uppercase title + a plain-language hint. */
function SectionHeading({ Icon, tone, title, hint }:
  { Icon: typeof Zap; tone: 'fuchsia' | 'sky'; title: string; hint: string }) {
  const text = tone === 'fuchsia' ? 'text-fuchsia-300' : 'text-sky-300';
  const icon = tone === 'fuchsia' ? 'text-fuchsia-400' : 'text-sky-400';
  return (
    <div className="flex items-center gap-2">
      <Icon className={`w-3.5 h-3.5 shrink-0 ${icon}`} />
      <h4 className={`text-xs font-semibold uppercase tracking-wider ${text}`}>{title}</h4>
      <span className="text-[11px] text-muted-foreground truncate">— {hint}</span>
    </div>
  );
}

interface BombGroupData { anchor: string; anchorCard?: ScryfallCard; items: LiftCandidate[]; }

/** A "pairs with <anchor>" group — a collapsible header over the grid of hits tied to that card,
 *  so you can fold a whole anchor away and skim past it. */
function BombGroup({ group, tabProps }: { group: BombGroupData; tabProps: LiftClustersTabProps }) {
  const [collapsed, setCollapsed] = useState(false);
  // Hover the anchor thumbnail → magnified preview of the card you're pairing against.
  const anchorImgRef = useRef<HTMLImageElement | null>(null);
  const [anchorHovered, setAnchorHovered] = useState(false);
  return (
    <div className="rounded-xl border border-border/50 bg-card/20 overflow-hidden">
      <button
        type="button"
        onClick={() => setCollapsed(c => !c)}
        aria-expanded={!collapsed}
        className={`flex items-center gap-2 w-full px-2.5 py-1.5 text-left bg-fuchsia-500/[0.05] hover:bg-fuchsia-500/[0.1] transition-colors ${collapsed ? '' : 'border-b border-border/40'}`}
      >
        <ChevronDown className={`w-3.5 h-3.5 shrink-0 text-muted-foreground transition-transform ${collapsed ? '-rotate-90' : ''}`} />
        <img
          ref={anchorImgRef}
          src={(group.anchorCard && getCardImageUrl(group.anchorCard, 'small')) || scryfallImg(group.anchor)}
          alt={group.anchor}
          className="w-6 h-auto rounded shadow-sm shrink-0"
          loading="lazy"
          onMouseEnter={() => setAnchorHovered(true)}
          onMouseLeave={() => setAnchorHovered(false)}
          onError={(e) => { (e.target as HTMLImageElement).src = scryfallImg(group.anchor); }}
        />
        <span className="text-xs text-muted-foreground truncate">
          pairs with <span className="font-semibold text-foreground">{group.anchor}</span>
        </span>
        <span className="ml-auto shrink-0 text-[10px] font-medium text-fuchsia-300/80 tabular-nums">
          {group.items.length} {group.items.length === 1 ? 'hit' : 'hits'}
        </span>
      </button>
      {anchorHovered && group.anchorCard && <MagnifiedPreview card={group.anchorCard} anchorRef={anchorImgRef} />}
      {!collapsed && (
        <div className="grid gap-2.5 p-2.5 [grid-template-columns:repeat(auto-fill,minmax(170px,1fr))]">
          {group.items.map(c => <LiftCandidateTile key={c.card.name} candidate={c} mode="bomb" {...tabProps} />)}
        </div>
      )}
    </div>
  );
}

/** A grid tile: the full card image (readable text, big enough to scan the rules), with the lift
 *  info — co-play %, lift, and staple/thin/cluster chips — laid out below it. */
function LiftCandidateTile({
  candidate, mode, onAdd, addedCards, onPreview, onCardAction, menuProps,
}: { candidate: LiftCandidate; mode: 'bomb' | 'cluster' } & LiftClustersTabProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  // Hover → an even larger magnified preview, anchored to the tile's image. Fires immediately —
  // the tile already shows the full card, so there's nothing to protect against with a delay.
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [hovered, setHovered] = useState(false);
  const { card, connectionCount, bestNumDecks, edges } = candidate;
  const added = addedCards.has(card.name);
  const lowConf = bestNumDecks < CONFIDENCE_FLOOR;
  // Strongest edge drives the ranking; for bombs the anchor lives in the group header, so the tile
  // need only carry the relationship's strength (co-play % leads — it's the trustworthy number).
  const byScore = [...edges].sort((a, b) => edgeScore(b) - edgeScore(a));
  const top = byScore[0];
  // Flag broadly-played good-stuff so it reads as "staple, not spice" (bombs only — clusters are
  // expected to skew staple-y). Gently dimmed and demoted, but still one click to add.
  const base = mode === 'bomb' ? baselinePct(edges) : null;
  const staple = base != null && base >= STAPLE_BASELINE_PCT;

  return (
    <div
      className={`group relative flex flex-col rounded-xl border border-border/50 bg-card/20 overflow-hidden transition-all hover:border-fuchsia-400/40 ${staple ? 'opacity-60 hover:opacity-100' : ''}`}
      onContextMenu={(e) => { if (onCardAction) { e.preventDefault(); setMenuOpen(true); } }}
    >
      {/* full card image — click to preview, hover to magnify for a proper read of the rules text */}
      <button
        type="button"
        className="relative block cursor-pointer"
        onClick={() => onPreview(card.name)}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        title={card.name}
      >
        <img
          ref={imgRef}
          src={getCardImageUrl(card, 'normal') || scryfallImg(card.name, 'normal')}
          alt={card.name}
          className="w-full h-auto"
          loading="lazy"
          onError={(e) => { (e.target as HTMLImageElement).src = scryfallImg(card.name, 'normal'); }}
        />
      </button>
      {hovered && <MagnifiedPreview card={card} anchorRef={imgRef} />}

      {/* add / added — top-left overlay that fades in on hover, matching the other inspector grids */}
      {!added ? (
        <button
          onClick={(e) => { e.stopPropagation(); onAdd(card.name); }}
          className="absolute top-0 left-0 rounded-tl-xl rounded-br-lg bg-black/60 hover:bg-black/80 text-white p-2 transition-colors opacity-0 group-hover:opacity-100 cursor-pointer"
          title="Add to deck"
        >
          <Plus className="w-5 h-5" />
        </button>
      ) : (
        <span className="absolute top-0 left-0 rounded-tl-xl rounded-br-lg bg-black/60 text-white p-2 animate-pop-in" title="Added">
          <Check className="w-5 h-5" />
        </span>
      )}

      {/* footer: name + lift stats + flag chips */}
      <div className="flex flex-col gap-1 p-2 border-t border-border/40">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-medium truncate flex-1" title={card.name}>{card.name}</span>
          {mode === 'cluster' && (
            <span className="inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-px rounded-full shrink-0 bg-sky-500/15 text-sky-300"
              title={`Pulled by ${connectionCount} of your cards`}>
              <Network className="w-2.5 h-2.5" /> {connectionCount}
            </span>
          )}
          {onCardAction && (
            <span className={`shrink-0 transition-opacity ${menuOpen ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`} onClick={(e) => e.stopPropagation()}>
              <CardContextMenu
                card={card}
                onAction={onCardAction}
                hasAddToDeck
                hasSideboard
                hasMaybeboard
                isInSideboard={menuProps.sideboardNames.has(card.name)}
                isInMaybeboard={menuProps.maybeboardNames.has(card.name)}
                userLists={menuProps.userLists}
                isMustInclude={menuProps.mustIncludeNames.has(card.name)}
                isBanned={menuProps.bannedNames.has(card.name)}
                forceOpen={menuOpen}
                onForceClose={() => setMenuOpen(false)}
              />
            </span>
          )}
        </div>
        <p className="text-[11px] text-muted-foreground"
          title={byScore.map(e => `${e.seed}: ${e.coPct}% play it too, ${liftLabel(e.lift)} lift`).join(' · ')}>
          {mode === 'bomb'
            ? <><span className="font-medium text-foreground/80 tabular-nums">{top?.coPct ?? 0}%</span> play it too · <span className={staple ? 'text-muted-foreground' : 'text-fuchsia-300/80'}>{top ? liftLabel(top.lift) : ''} lift</span></>
            : <span className="line-clamp-2">pulled by {byScore.slice(0, 2).map(e => e.seed).join(', ')}{connectionCount > 2 ? ` +${connectionCount - 2}` : ''} · <span className="text-sky-300/80">best {top ? liftLabel(top.lift) : ''}</span></span>}
        </p>
        {(staple || lowConf) && (
          <div className="flex items-center gap-1 flex-wrap">
            {staple && (
              <span className="inline-flex items-center gap-0.5 text-[10px] font-medium px-1.5 py-px rounded-full bg-foreground/[0.06] text-muted-foreground border border-border/50"
                title={`A broadly-played staple — in roughly ${base!.toFixed(1)}% of all decks. Strong, but good-stuff rather than deck-specific tech.`}>
                <Anchor className="w-2.5 h-2.5" /> staple
              </span>
            )}
            {lowConf && (
              <span className="inline-flex items-center text-[10px] font-medium px-1.5 py-px rounded-full bg-amber-500/15 text-amber-300/90"
                title={`Based on only ${bestNumDecks} shared decks — treat as a hunch, not a stat.`}>
                thin data
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
