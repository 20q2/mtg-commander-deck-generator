// src/components/deck/optimizer/dashboard/OverviewBento.tsx
import { useEffect, useMemo, useState } from 'react';
import { DollarSign, ChartNetwork, ArrowRight } from 'lucide-react';
import type { ScryfallCard } from '@/types';
import type { DeckAnalysis } from '@/services/deckBuilder/deckAnalyzer';
import { getCardImageUrl } from '@/services/scryfall/client';
import { formatPrice, type SwapRow } from '@/services/deckBuilder/costAnalyzer';
import {
  scanLiftCandidates, edgeScore, selectTopLiftPicks,
  LIFT_SCAN_CACHE, liftDeckKey, buildLiftScanInputs,
  type LiftCandidate,
} from '@/services/optimizer/liftClusters';
import type { TabKey } from '../constants';
import { scryfallImg } from '../constants';
import { useCostPlan } from '../useCostPlan';

export interface OverviewBentoProps {
  commanderName: string;
  partnerCommanderName?: string;
  commander?: ScryfallCard;
  partnerCommander?: ScryfallCard;
  colorIdentity?: string[];
  currentCards: ScryfallCard[];
  analysis: DeckAnalysis;
  currency: 'USD' | 'EUR';
  mustIncludeNames: Set<string>;
  sideboardNames: string[];
  maybeboardNames: string[];
  onNavigate: (tab: TabKey) => void;
}

/** EDHREC caps lift display at 99+; mirror that so absurd values never read as e.g. ×1376. */
const liftLabel = (l: number) => (l >= 99 ? '99+' : `×${l.toFixed(1)}`);

type LiftPicks = { bomb: LiftCandidate | null; cluster: LiftCandidate | null };

/**
 * Background lift scan for the bento teaser. Reads the cache the Lift Web tab writes (and writes it
 * back), so warming here makes the tab instant and EDHREC isn't hit twice. Keyed on the decklist.
 */
function useLiftPicks(opts: OverviewBentoProps): { picks: LiftPicks | null; loading: boolean } {
  const { commander, partnerCommander, commanderName, partnerCommanderName, currentCards, colorIdentity } = opts;
  const deckKey = useMemo(
    () => liftDeckKey(commanderName, partnerCommanderName, currentCards),
    [commanderName, partnerCommanderName, currentCards],
  );
  const [state, setState] = useState<{ picks: LiftPicks | null; loading: boolean }>({ picks: null, loading: true });

  useEffect(() => {
    let cancelled = false;
    const cached = LIFT_SCAN_CACHE.get(deckKey);
    if (cached) {
      setState({ picks: selectTopLiftPicks(cached.candidates), loading: false });
      return;
    }
    if (currentCards.length === 0) {
      setState({ picks: null, loading: false });
      return;
    }
    setState({ picks: null, loading: true });
    const inputs = buildLiftScanInputs({
      commander, partnerCommander, commanderName, partnerCommanderName, currentCards, colorIdentity,
    });
    scanLiftCandidates({ ...inputs, isCancelled: () => cancelled })
      .then(result => {
        if (cancelled) return;
        LIFT_SCAN_CACHE.set(deckKey, result);
        setState({ picks: selectTopLiftPicks(result.candidates), loading: false });
      })
      .catch(() => { if (!cancelled) setState({ picks: null, loading: false }); });
    return () => { cancelled = true; };
    // deckKey captures commander/partner/cards; the rest are stable for a given key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deckKey]);

  return state;
}

/**
 * Overview tools row — shown in the next-steps slot when a deck has no structural next steps left.
 * Two tiles in the same family as the score tiles below: each reads its tool's actual signature
 * (a real swap from the Cost Explorer, a real lift edge from the Lift Web) rather than a teaser
 * blurb. Renders nothing if neither tool has anything to surface.
 */
export function OverviewBento(props: OverviewBentoProps) {
  const {
    commanderName, partnerCommanderName, currentCards, analysis, currency,
    mustIncludeNames, sideboardNames, maybeboardNames, onNavigate,
  } = props;

  const excludeFromSuggestions = useMemo(
    () => new Set([...sideboardNames, ...maybeboardNames]),
    [sideboardNames, maybeboardNames],
  );

  const { plan, loading: costLoading } = useCostPlan({
    commanderName, partnerCommanderName, currentCards, analysis,
    mustIncludeNames, excludeFromSuggestions, currency,
  });
  const costRows = useMemo(() => (plan ? [...plan.similarRows, ...plan.roleRows] : []), [plan]);
  const potentialSavings = useMemo(() => costRows.reduce((s, r) => s + r.savings, 0), [costRows]);
  const topSaver = useMemo(
    () => (costRows.length ? [...costRows].sort((a, b) => b.savings - a.savings)[0] : null),
    [costRows],
  );
  const costHasData = potentialSavings > 0;

  const { picks, loading: liftLoading } = useLiftPicks(props);
  const liftHasData = !!(picks && (picks.bomb || picks.cluster));

  // Don't show an empty box: once both tools have settled with nothing to surface, render nothing.
  const settled = !costLoading && !liftLoading;
  if (settled && !costHasData && !liftHasData) return null;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 animate-fade-in">
      {/* ── Cheaper swaps → Cost Explorer ── */}
      <ToolTile Icon={DollarSign} iconClass="text-emerald-400" label="Cheaper swaps" cta="Cost Explorer" onClick={() => onNavigate('cost')}>
        {costLoading ? (
          <SkeletonLines lines={2} />
        ) : costHasData ? (
          <div className="flex flex-col gap-2">
            <div className="flex items-baseline gap-1.5 flex-wrap">
              <span className="text-2xl font-black tabular-nums text-emerald-400 leading-none">
                {formatPrice(potentialSavings, currency)}
              </span>
              <span className="text-[11px] text-muted-foreground">
                off · {costRows.length} swap{costRows.length === 1 ? '' : 's'}
              </span>
            </div>
            {topSaver && <SwapPreview row={topSaver} currency={currency} />}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground/80 leading-snug">Already lean — no cheaper printings to swap in.</p>
        )}
      </ToolTile>

      {/* ── Hidden synergy → Lift Web ── */}
      <ToolTile Icon={ChartNetwork} iconClass="text-fuchsia-400" label="Hidden synergy" cta="Lift Web" onClick={() => onNavigate('lift')}>
        {liftLoading ? (
          <SkeletonLines lines={2} withThumb />
        ) : liftHasData ? (
          <div className="flex flex-col gap-2">
            {picks!.bomb && <BombRow candidate={picks!.bomb} />}
            {picks!.cluster && <ClusterRow candidate={picks!.cluster} />}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground/80 leading-snug">No standout lift edges in this list.</p>
        )}
      </ToolTile>
    </div>
  );
}

/** Shared chrome: a tile in the same family as the score tiles below — neutral surface, accent only
 *  in the icon and the data, and a muted "{tool} →" footer that brightens on hover. */
function ToolTile({
  Icon, iconClass, label, cta, onClick, children,
}: {
  Icon: typeof DollarSign;
  iconClass: string;
  label: string;
  cta: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group relative bg-card/40 border border-border/30 rounded-lg p-3 pb-7 text-left hover:bg-accent/30 hover:border-border/60 transition-all w-full"
    >
      <div className="flex items-center gap-2 mb-2">
        <Icon className={`w-4 h-4 ${iconClass} opacity-80`} />
        <span className="text-[11px] font-semibold uppercase tracking-wider text-foreground/70">{label}</span>
      </div>
      {children}
      <span className="absolute bottom-2 right-3 flex items-center text-[10px] text-muted-foreground/60 group-hover:text-foreground/80 transition-colors">
        {cta} <ArrowRight className="w-2.5 h-2.5 ml-0.5 group-hover:translate-x-0.5 transition-transform" />
      </span>
    </button>
  );
}

/** A condensed cost-tab swap: current → suggestion thumbnails with the saving, in the tab's grammar. */
function SwapPreview({ row, currency }: { row: SwapRow; currency: 'USD' | 'EUR' }) {
  const curImg = getCardImageUrl(row.current, 'small') || scryfallImg(row.current.name);
  const sugImg = row.suggestion.imageUrl || scryfallImg(row.suggestion.name);
  return (
    <div className="flex items-center gap-1.5 min-w-0">
      <Thumb src={curImg} name={row.current.name} />
      <ArrowRight className="w-3 h-3 text-muted-foreground/50 shrink-0" />
      <Thumb src={sugImg} name={row.suggestion.name} />
      <span className="text-[11px] text-muted-foreground truncate min-w-0">{row.suggestion.name}</span>
      <span className="ml-auto text-[11px] font-semibold tabular-nums text-emerald-400/90 shrink-0">
        −{formatPrice(row.savings, currency)}
      </span>
    </div>
  );
}

/** A high-lift hit, in the Lift Web tab's grammar: "X% play it too · ×8 lift". */
function BombRow({ candidate }: { candidate: LiftCandidate }) {
  const top = useMemo(() => [...candidate.edges].sort((a, b) => edgeScore(b) - edgeScore(a))[0], [candidate]);
  return (
    <div className="flex items-center gap-2 min-w-0">
      <Thumb src={getCardImageUrl(candidate.card, 'small') || scryfallImg(candidate.card.name)} name={candidate.card.name} />
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-foreground truncate">{candidate.card.name}</p>
        <p className="text-[11px] text-muted-foreground/80 truncate">
          with {top?.seed ?? 'your deck'} · <span className="text-fuchsia-300/90 tabular-nums">{liftLabel(candidate.bestLift)} lift</span>
        </p>
      </div>
    </div>
  );
}

/** A cluster pulled by several deck cards, in the Lift Web tab's sky accent. */
function ClusterRow({ candidate }: { candidate: LiftCandidate }) {
  return (
    <div className="flex items-center gap-2 min-w-0">
      <Thumb src={getCardImageUrl(candidate.card, 'small') || scryfallImg(candidate.card.name)} name={candidate.card.name} />
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-foreground truncate">{candidate.card.name}</p>
        <p className="text-[11px] text-muted-foreground/80 truncate">
          pulled by <span className="text-sky-300/90 tabular-nums">{candidate.connectionCount}</span> of your cards
        </p>
      </div>
    </div>
  );
}

function Thumb({ src, name }: { src: string; name: string }) {
  return (
    <img
      src={src}
      alt={name}
      className="w-6 h-[34px] rounded object-cover ring-1 ring-black/40 shrink-0"
      loading="lazy"
      onError={(e) => { (e.target as HTMLImageElement).src = scryfallImg(name); }}
    />
  );
}

function SkeletonLines({ lines, withThumb }: { lines: number; withThumb?: boolean }) {
  return (
    <div className="flex flex-col gap-2 pt-0.5">
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className="flex items-center gap-2">
          {withThumb && <div className="w-6 h-[34px] rounded bg-foreground/10 animate-pulse shrink-0" />}
          <div className="flex-1 h-3 rounded bg-foreground/10 animate-pulse" style={{ maxWidth: i === 0 ? '60%' : '85%' }} />
        </div>
      ))}
    </div>
  );
}
