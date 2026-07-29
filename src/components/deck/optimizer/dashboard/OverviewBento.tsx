// src/components/deck/optimizer/dashboard/OverviewBento.tsx
import { useEffect, useMemo, useState } from 'react';
import { DollarSign, ChartNetwork, ArrowRight } from 'lucide-react';
import type { ScryfallCard } from '@/types';
import type { DeckAnalysis } from '@/services/deckBuilder/deckAnalyzer';
import { getCardImageUrl, useScryfallImage } from '@/services/scryfall/client';
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
  // Similar-card swaps only — the looser role-based budget suggestions stay in the Cost Explorer.
  const costRows = useMemo(() => (plan ? [...plan.similarRows] : []), [plan]);
  const potentialSavings = useMemo(() => costRows.reduce((s, r) => s + r.savings, 0), [costRows]);
  const topSavers = useMemo(
    () => [...costRows].sort((a, b) => b.savings - a.savings).slice(0, 2),
    [costRows],
  );
  const costHasData = potentialSavings > 0;

  const { picks, loading: liftLoading } = useLiftPicks(props);
  const liftHasData = !!(picks && (picks.bomb || picks.cluster));

  // Full-card hover preview for the lift finds and swap thumbs (desktop only; anchored to the
  // hovered element). `card` when the full Scryfall object is on hand, else resolved from `name`.
  const [hoverPreview, setHoverPreview] = useState<{ card?: ScryfallCard; name: string; rect: DOMRect } | null>(null);

  // Don't show an empty box: once both tools have settled with nothing to surface, render nothing.
  const settled = !costLoading && !liftLoading;
  if (settled && !costHasData && !liftHasData) return null;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 animate-fade-in">
      {/* ── Cheaper swaps → Cost Explorer ── */}
      <ToolTile
        Icon={DollarSign}
        iconClass="text-emerald-400"
        label="Build it cheaper"
        cta="Cost Explorer"
        onClick={() => onNavigate('cost')}
        headerRight={costHasData ? (
          <span className="flex items-baseline gap-1.5 whitespace-nowrap">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground/70">save up to</span>
            <span className="text-2xl font-black tabular-nums leading-none text-emerald-400">{formatPrice(potentialSavings, currency)}</span>
          </span>
        ) : undefined}
      >
        {costLoading ? (
          <SkeletonLines lines={2} />
        ) : costHasData ? (
          <div className="flex flex-col gap-1.5">
            {topSavers.map(row => (
              <SwapPreview key={`${row.current.name}→${row.suggestion.name}`} row={row} currency={currency} onHover={setHoverPreview} />
            ))}
            {costRows.length > topSavers.length && (
              <span className="text-[10px] text-muted-foreground/60">
                +{costRows.length - topSavers.length} more swap{costRows.length - topSavers.length === 1 ? '' : 's'}
              </span>
            )}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground/80 leading-snug">Already lean — no cheaper stand-ins do the same job.</p>
        )}
      </ToolTile>

      {/* ── Cards you're missing → Lift Web ── */}
      <ToolTile Icon={ChartNetwork} iconClass="text-fuchsia-400" label="Cards your deck wants" cta="Lift Web" onClick={() => onNavigate('lift')}>
        {liftLoading ? (
          <SkeletonLines lines={2} withThumb />
        ) : liftHasData ? (
          <div className="grid grid-cols-2 gap-2 flex-1 min-h-[104px]">
            {picks!.bomb && (
              <LiftFind
                candidate={picks!.bomb}
                stat={`${liftLabel(picks!.bomb.bestLift)} lift`}
                statClass="text-fuchsia-300 bg-fuchsia-500/15 ring-fuchsia-400/30"
                tooltip={bombTooltip(picks!.bomb)}
                onHover={setHoverPreview}
              />
            )}
            {picks!.cluster && (
              <LiftFind
                candidate={picks!.cluster}
                stat={`${picks!.cluster.connectionCount}-card cluster`}
                statClass="text-sky-300 bg-sky-500/15 ring-sky-400/30"
                tooltip={`${picks!.cluster.connectionCount} cards you already run are commonly played with ${picks!.cluster.card.name} — and it's not in your list.`}
                onHover={setHoverPreview}
              />
            )}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground/80 leading-snug">Nothing the data says you're missing — this list covers its pairings.</p>
        )}
      </ToolTile>

      {hoverPreview && <FloatingCardPreview card={hoverPreview.card} name={hoverPreview.name} anchor={hoverPreview.rect} />}
    </div>
  );
}

/** Shared chrome: a tile in the same family as the score tiles below — neutral surface, accent only
 *  in the icon and the data, and a muted "{tool} →" footer that brightens on hover. */
function ToolTile({
  Icon, iconClass, label, cta, onClick, headerRight, children,
}: {
  Icon: typeof DollarSign;
  iconClass: string;
  label: string;
  cta: string;
  onClick: () => void;
  headerRight?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group relative flex flex-col items-stretch justify-start bg-card/40 border border-border/30 rounded-lg p-3 pb-7 text-left hover:bg-accent/30 hover:border-border/60 transition-all w-full"
    >
      <div className="flex items-center gap-2 mb-2">
        <Icon className={`w-4 h-4 ${iconClass} opacity-80`} />
        <span className="text-sm font-semibold uppercase tracking-wider text-foreground/90">{label}</span>
        {headerRight && <span className="ml-auto">{headerRight}</span>}
      </div>
      {children}
      <span className="absolute bottom-2 right-3 flex items-center text-[10px] text-muted-foreground/60 group-hover:text-foreground/80 transition-colors">
        {cta} <ArrowRight className="w-2.5 h-2.5 ml-0.5 group-hover:translate-x-0.5 transition-transform" />
      </span>
    </button>
  );
}

/** A condensed cost-tab swap: current → suggestion thumbnails with the saving, in the tab's grammar. */
function SwapPreview({ row, currency, onHover }: {
  row: SwapRow;
  currency: 'USD' | 'EUR';
  onHover: (h: { card?: ScryfallCard; name: string; rect: DOMRect } | null) => void;
}) {
  const curImg = getCardImageUrl(row.current, 'small') || scryfallImg(row.current.name);
  const sugImg = row.suggestion.imageUrl || scryfallImg(row.suggestion.name);
  return (
    <div
      className="flex items-center gap-1.5 min-w-0"
      title={`Swap ${row.current.name} for ${row.suggestion.name} and keep ${formatPrice(row.savings, currency)}.`}
    >
      <Thumb
        src={curImg}
        name={row.current.name}
        onHover={(rect) => onHover(rect ? { card: row.current, name: row.current.name, rect } : null)}
      />
      <ArrowRight className="w-3 h-3 text-muted-foreground/50 shrink-0" />
      <Thumb
        src={sugImg}
        name={row.suggestion.name}
        onHover={(rect) => onHover(rect ? { card: row.suggestion.card, name: row.suggestion.name, rect } : null)}
      />
      <span className="text-[11px] text-muted-foreground truncate min-w-0">{row.suggestion.name}</span>
      <span className="ml-auto text-[11px] font-semibold tabular-nums text-emerald-400/90 shrink-0">
        saves {formatPrice(row.savings, currency)}
      </span>
    </div>
  );
}

/** The full evidence sentence for the bomb pick — face copy stays terse, this feeds the tooltip. */
function bombTooltip(candidate: LiftCandidate): string {
  const top = [...candidate.edges].sort((a, b) => edgeScore(b) - edgeScore(a))[0];
  const seed = top?.seed ?? 'your deck';
  return `Decks running ${seed} play ${candidate.card.name} ${liftLabel(candidate.bestLift)} more often than average — and it's not in your list.`;
}

/** Art-crop of a card, falling back through faces to the small full-card image. */
function artCropUrl(card: ScryfallCard): string {
  return card.image_uris?.art_crop
    ?? card.card_faces?.[0]?.image_uris?.art_crop
    ?? getCardImageUrl(card, 'small')
    ?? scryfallImg(card.name);
}

/** One lift find as an art-backed panel that fills its column: card art behind a bottom
 *  gradient, name + stat chip overlaid. Hovering floats the full card next to the tile. */
function LiftFind({ candidate, stat, statClass, tooltip, onHover }: {
  candidate: LiftCandidate;
  stat: string;
  statClass: string;
  tooltip: string;
  onHover: (h: { card?: ScryfallCard; name: string; rect: DOMRect } | null) => void;
}) {
  return (
    <div
      className="relative rounded-md overflow-hidden ring-1 ring-border/40 min-h-[104px] h-full"
      title={tooltip}
      onMouseEnter={(e) => onHover({ card: candidate.card, name: candidate.card.name, rect: e.currentTarget.getBoundingClientRect() })}
      onMouseLeave={() => onHover(null)}
    >
      <img
        src={artCropUrl(candidate.card)}
        alt={candidate.card.name}
        className="absolute inset-0 w-full h-full object-cover"
        loading="lazy"
        onError={(e) => { (e.target as HTMLImageElement).src = scryfallImg(candidate.card.name); }}
      />
      <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/35 to-black/10" />
      <div className="absolute inset-x-0 bottom-0 p-2 flex flex-col gap-1">
        <p className="text-xs font-semibold text-white truncate drop-shadow">{candidate.card.name}</p>
        <span className={`self-start text-[10px] font-medium tabular-nums px-1.5 py-0.5 rounded-full ring-1 ${statClass}`}>
          {stat}
        </span>
      </div>
    </div>
  );
}

/** Floating full-card image next to the hovered element (desktop only, matches DeckDisplay's).
 *  Uses the card object when provided; otherwise resolves the image by name. */
function FloatingCardPreview({ card, name, anchor }: { card?: ScryfallCard; name: string; anchor: DOMRect }) {
  const { url: byName } = useScryfallImage(card ? null : name, 'normal');
  const src = card ? (getCardImageUrl(card, 'normal') || scryfallImg(card.name)) : byName;
  const width = 256;
  const flipLeft = anchor.right + 12 + width > window.innerWidth;
  const left = flipLeft ? Math.max(8, anchor.left - width - 12) : anchor.right + 12;
  const top = Math.min(Math.max(8, anchor.top + anchor.height / 2 - 180), window.innerHeight - 380);
  return (
    <div className="fixed z-[100] pointer-events-none hidden lg:block" style={{ left, top }}>
      <img src={src} alt={name} className="w-64 rounded-lg shadow-2xl border border-border/50" />
    </div>
  );
}

function Thumb({ src, name, onHover }: {
  src: string;
  name: string;
  onHover?: (rect: DOMRect | null) => void;
}) {
  return (
    <img
      src={src}
      alt={name}
      className="w-6 h-[34px] rounded object-cover ring-1 ring-black/40 shrink-0"
      loading="lazy"
      onMouseEnter={onHover ? (e) => onHover(e.currentTarget.getBoundingClientRect()) : undefined}
      onMouseLeave={onHover ? () => onHover(null) : undefined}
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
