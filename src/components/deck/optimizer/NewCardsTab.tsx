import { useEffect, useMemo, useState } from 'react';
import { Newspaper, Plus, Check, CalendarDays, Crown, Tags, List, LayoutGrid, ArrowUpRight } from 'lucide-react';
import type { ScryfallCard } from '@/types';
import { getCardsByNames, getCardImageUrl } from '@/services/scryfall/client';
import { Button } from '@/components/ui/button';
import { getUpgradeDetails, type UpgradeDetail } from '@/services/deckUpgrades/getRelevantCards';
import type { PairReceipt } from '@/services/deckUpgrades/upgradePairing';

/**
 * "New Cards" inspector tab — what got printed that matters for THIS deck.
 *
 * Organized for the returning player: a user-adjustable "since when" baseline
 * (defaults to the saved list's last edit), then four meaning-based sections —
 * possible upgrades of cards you run (with receipts), cards that slot into your
 * build, the commander's broader new hits, and recent-set long shots. Every row
 * still shows its reasoning (sources, lift edges), never a black-box ranking.
 */

interface NewCardsTabProps {
  currentCards: ScryfallCard[];
  commanderName: string;
  partnerCommanderName?: string;
  colorIdentity?: string[];
  /** Intended EDHREC theme names (from the saved list / generated deck). */
  intendedThemes?: string[];
  /** The Inspector's LIVE theme selection. Preferred over intendedThemes when present: it is what
   *  the user currently has picked, and it carries slugs, so off-list themes survive. */
  themeRefs?: { slug: string; name: string }[];
  /** Saved-list id backing this deck — persists the baseline choice per deck. */
  listId?: string;
  /** The saved list's last-edit time (ms) — the default "since when" baseline. */
  lastEditedAt?: number;
  onAdd: (name: string) => void;
  addedCards: Set<string>;
  onPreview: (name: string) => void;
}

type LoadState =
  | { phase: 'loading' }
  | { phase: 'done'; details: UpgradeDetail[] }
  | { phase: 'error' };

/** EDHREC caps lift display at 99+; mirror that so absurd values never read as ×1376. */
const liftLabel = (l: number) => (l >= 99 ? '99+' : `×${l.toFixed(1)}`);

/** Below this many shared decks a lift edge is thin evidence — shown, but dimmed. */
const EDGE_CONFIDENCE_FLOOR = 50;

/** Upgrade pairs shown in the hero section; overflow falls into "Slots into your build". */
const MAX_PAIRS_SHOWN = 8;

// ── Baseline ("since when") ──────────────────────────────────────────────

type BaselineKey = 'last-edit' | '1y' | '2y' | '5y' | '10y' | 'recent';
const YEAR_MS = 365 * 86400000;

const BASELINE_OPTIONS: { key: BaselineKey; label: string }[] = [
  { key: 'last-edit', label: 'your last edit' },
  { key: '1y', label: '1 year back' },
  { key: '2y', label: '2 years back' },
  { key: '5y', label: '5 years back' },
  { key: '10y', label: '10 years back' },
  { key: 'recent', label: 'recent sets only' },
];

function baselineMs(key: BaselineKey, lastEditedAt?: number): number | undefined {
  switch (key) {
    case 'last-edit': return lastEditedAt;
    case '1y': return Date.now() - YEAR_MS;
    case '2y': return Date.now() - 2 * YEAR_MS;
    case '5y': return Date.now() - 5 * YEAR_MS;
    case '10y': return Date.now() - 10 * YEAR_MS;
    case 'recent': return undefined;
  }
}

function baselineNarrative(key: BaselineKey, lastEditedAt?: number): string {
  if (key === 'recent') return 'the last few sets';
  if (key === 'last-edit' && lastEditedAt) {
    return `your last edit (${new Date(lastEditedAt).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })})`;
  }
  return BASELINE_OPTIONS.find(o => o.key === key)?.label ?? key;
}

// ── Sections ─────────────────────────────────────────────────────────────

type SectionKey = 'upgrades' | 'build' | 'broad' | 'longshots';

interface Section {
  key: SectionKey;
  title: string;
  blurb: string;
  /** Section marker color (small square, mirrors the deck view's group dots). */
  pole: string;
  details: UpgradeDetail[];
}

function partitionSections(details: UpgradeDetail[], commanderShortName: string): Section[] {
  const maxFit = Math.max(0, ...details.map(d => d.liftFit));
  const upgrades: UpgradeDetail[] = [];
  const build: UpgradeDetail[] = [];
  const broad: UpgradeDetail[] = [];
  const longshots: UpgradeDetail[] = [];
  for (const d of details) {
    if (d.pairedWith && upgrades.length < MAX_PAIRS_SHOWN) upgrades.push(d);
    else if (d.matchedThemes.length > 0 || (maxFit > 0 && d.liftFit >= 0.6 * maxFit)) build.push(d);
    else if (d.sources.includes('commander')) broad.push(d);
    else longshots.push(d);
  }
  return [
    {
      key: 'upgrades', details: upgrades, pole: 'bg-emerald-400',
      title: 'Upgrades for cards you run',
      blurb: 'Modern takes on jobs your deck already does — each pair shows its receipts.',
    },
    {
      key: 'build', details: build, pole: 'bg-violet-400',
      title: 'Slots into your build',
      blurb: 'Matches your themes or plays strongly with cards you already run.',
    },
    {
      key: 'broad', details: broad, pole: 'bg-muted-foreground/60',
      title: `New for ${commanderShortName} broadly`,
      blurb: 'Popular with the commander at large — not especially your build\'s plan.',
    },
    {
      key: 'longshots', details: longshots, pole: 'bg-amber-400',
      title: 'Recent-set long shots',
      blurb: 'Fresh printings with a thread of evidence — speculative by nature.',
    },
  ];
}

const fmtPrice = (p: number) => (p >= 10 ? `$${Math.round(p)}` : `$${p.toFixed(2)}`);
const fmtSynergy = (s: number) => `${s >= 0 ? '+' : ''}${Math.round(s * 100)}%`;

/** The pairing receipts line: what vouches for the pair, shared job, price/synergy compares. */
function PairBanner({ pair, onNameClick, onNameHover }: {
  pair: PairReceipt;
  onNameClick: (name: string) => void;
  /** rect = show the floating card preview for this deck card; null = hide it. */
  onNameHover: (name: string, rect: DOMRect | null) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-md bg-emerald-500/10 border border-emerald-500/25 px-2 py-1 text-[11px]">
      <span className="inline-flex items-center gap-1 font-medium text-emerald-300">
        <ArrowUpRight className="w-3 h-3" /> Possible upgrade of your{' '}
        <button
          type="button"
          className="underline decoration-dotted underline-offset-2 hover:text-emerald-200 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/70 rounded-sm"
          onClick={() => onNameClick(pair.deckCard)}
          onMouseEnter={e => onNameHover(pair.deckCard, e.currentTarget.getBoundingClientRect())}
          onMouseLeave={() => onNameHover(pair.deckCard, null)}
        >
          {pair.deckCard}
        </button>
      </span>
      <span className="text-muted-foreground/80" title={pair.basis === 'similar'
        ? 'EDHREC\'s own similar-cards list for this card names yours'
        : 'How much more often the pair appears together than chance'}>
        {pair.basis === 'similar'
          ? 'EDHREC lists them as similar'
          : `played together ${liftLabel(pair.mutualLift ?? 0)}`}
      </span>
      {pair.sharedLabel && <span className="text-muted-foreground/80">both: {pair.sharedLabel}</span>}
      {pair.candidatePrice !== undefined && pair.incumbentPrice !== undefined && (
        <span className={pair.axis === 'cheaper' ? 'text-emerald-300 font-medium' : 'text-muted-foreground/80'}>
          {fmtPrice(pair.candidatePrice)} vs {fmtPrice(pair.incumbentPrice)}
        </span>
      )}
      {typeof pair.candidateSynergy === 'number' && typeof pair.incumbentSynergy === 'number' && (
        <span className="text-violet-300/80" title="EDHREC synergy, this card vs yours">
          {fmtSynergy(pair.candidateSynergy)} vs {fmtSynergy(pair.incumbentSynergy)} synergy
        </span>
      )}
      {pair.basis === 'similar' && pair.mutualLift !== undefined && (
        <span className="text-muted-foreground/80" title="How much more often the pair appears together than chance">
          played together {liftLabel(pair.mutualLift)}
        </span>
      )}
    </div>
  );
}

export function NewCardsTab({
  currentCards, commanderName, partnerCommanderName, colorIdentity, intendedThemes, themeRefs,
  listId, lastEditedAt,
  onAdd, addedCards, onPreview,
}: NewCardsTabProps) {
  const [state, setState] = useState<LoadState>({ phase: 'loading' });
  const [images, setImages] = useState<Map<string, ScryfallCard>>(new Map());
  const [viewMode, _setViewMode] = useState<'list' | 'grid'>(
    () => (localStorage.getItem('mtg-newcards-view-mode') as 'list' | 'grid') || 'list'
  );
  const setViewMode = (v: 'list' | 'grid') => {
    localStorage.setItem('mtg-newcards-view-mode', v);
    _setViewMode(v);
  };

  const baselineStoreKey = `mtg-newcards-baseline-${listId ?? 'adhoc'}`;
  const [baselineKey, _setBaselineKey] = useState<BaselineKey>(() => {
    const stored = localStorage.getItem(baselineStoreKey) as BaselineKey | null;
    const valid = stored && BASELINE_OPTIONS.some(o => o.key === stored) && (stored !== 'last-edit' || lastEditedAt);
    if (valid) return stored;
    return lastEditedAt ? 'last-edit' : 'recent';
  });
  const setBaselineKey = (k: BaselineKey) => {
    localStorage.setItem(baselineStoreKey, k);
    _setBaselineKey(k);
  };
  // Memoized: baselineMs reads Date.now(), so computing it inline would mint a new
  // value every render — and as an effect dep that meant an infinite refetch loop.
  const baselineDate = useMemo(() => baselineMs(baselineKey, lastEditedAt), [baselineKey, lastEditedAt]);

  const deckCardNames = useMemo(
    () => [...new Set([commanderName, partnerCommanderName, ...currentCards.map(c => c.name)].filter(Boolean) as string[])],
    [commanderName, partnerCommanderName, currentCards],
  );

  // Floating full-card preview for the pair banner's incumbent name (deck cards
  // arrive with card data on currentCards, so no extra fetch is needed).
  const deckCardByName = useMemo(() => {
    const m = new Map<string, ScryfallCard>();
    for (const c of currentCards) m.set(c.name, c);
    return m;
  }, [currentCards]);
  const [hoverPreview, setHoverPreview] = useState<{ card: ScryfallCard; rect: DOMRect } | null>(null);
  const handlePairNameHover = (name: string, rect: DOMRect | null) => {
    if (!rect) { setHoverPreview(null); return; }
    const card = deckCardByName.get(name);
    if (card) setHoverPreview({ card, rect });
  };

  // Content key, not identity: themeRefs is rebuilt every render by the parent, and as an effect
  // dep that would refetch the whole pipeline forever.
  const themesKey = [
    ...(themeRefs ?? []).map(t => t.slug),
    ...(intendedThemes ?? []),
  ].join('|');
  useEffect(() => {
    let cancelled = false;
    setState({ phase: 'loading' });
    getUpgradeDetails({
      commanderName,
      partnerName: partnerCommanderName,
      deckCardNames,
      themes: intendedThemes,
      themeRefs,
      colorIdentity,
      baselineDate,
    }).then(async details => {
      if (cancelled) return;
      setState({ phase: 'done', details });
      // Hydrate art after the list is up — rows render with a pulse placeholder until then.
      const map = await getCardsByNames(details.map(d => d.name));
      if (!cancelled) setImages(map);
    }).catch(() => { if (!cancelled) setState({ phase: 'error' }); });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [commanderName, partnerCommanderName, themesKey, baselineDate]);

  const commanderShortName = commanderName.split(',')[0];
  const sections = useMemo(
    () => (state.phase === 'done' ? partitionSections(state.details, commanderShortName) : []),
    [state, commanderShortName],
  );
  const total = state.phase === 'done' ? state.details.length : 0;
  const maxFit = state.phase === 'done' ? Math.max(0, ...state.details.map(d => d.liftFit)) : 0;

  const renderListRow = (d: UpgradeDetail) => {
    const card = images.get(d.name);
    const img = card ? getCardImageUrl(card, 'small') : null;
    const added = addedCards.has(d.name);
    const fitPct = maxFit > 0 ? Math.round((d.liftFit / maxFit) * 100) : 0;
    return (
      <div key={d.name} className="bg-card/60 border border-border/30 rounded-lg p-3 sm:p-4 flex gap-3">
        {/* Art */}
        <button
          type="button"
          onClick={() => onPreview(d.name)}
          title={d.name}
          className="relative w-14 sm:w-16 shrink-0 aspect-[5/7] rounded-md overflow-hidden bg-violet-500/10 border border-border/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/70 self-start"
        >
          {img
            ? <img src={img} alt={d.name} loading="lazy" className="absolute inset-0 w-full h-full object-cover" />
            : <div className="absolute inset-0 animate-pulse bg-violet-500/10" />}
        </button>

        {/* Body */}
        <div className="flex-1 min-w-0 space-y-1.5">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <button
                type="button"
                onClick={() => onPreview(d.name)}
                className="text-sm font-medium text-foreground hover:text-violet-300 transition-colors truncate block max-w-full text-left"
              >
                {d.name}
              </button>
              {/* Source badges — where this recommendation came from */}
              <div className="flex flex-wrap items-center gap-1 mt-1">
                {d.sources.includes('commander') && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-violet-500/15 border border-violet-500/30 px-2 py-0.5 text-[10px] font-medium text-violet-300/90">
                    <Crown className="w-2.5 h-2.5" /> New for {commanderShortName}
                  </span>
                )}
                {d.matchedThemes.map(t => (
                  <span
                    key={t}
                    className="inline-flex items-center gap-1 rounded-full border border-violet-500/30 px-2 py-0.5 text-[10px] font-medium text-violet-300/80"
                    title={d.classifierThemes.includes(t)
                      ? (d.themeBasis === 'literal'
                        ? `The card itself carries your ${t} theme`
                        : `Plays like ${t} — inferred from how the card is tagged`)
                      : `EDHREC's ${t} page lists this as a new card`}
                  >
                    <Tags className="w-2.5 h-2.5" /> {t}
                  </span>
                ))}
                {(d.sources.includes('recent-set') || d.sources.includes('since-baseline')) && d.releasedAt && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 border border-amber-500/30 px-2 py-0.5 text-[10px] font-medium text-amber-300/90">
                    <CalendarDays className="w-2.5 h-2.5" /> Printed {d.releasedAt.slice(0, 4)}
                  </span>
                )}
              </div>
            </div>
            <Button
              variant={added ? 'ghost' : 'outline'}
              size="sm"
              disabled={added}
              className="shrink-0"
              onClick={() => onAdd(d.name)}
            >
              {added ? <><Check className="w-3.5 h-3.5 mr-1 text-emerald-400" /> Added</> : <><Plus className="w-3.5 h-3.5 mr-1" /> Add</>}
            </Button>
          </div>

          {/* The pairing receipts — why this reads as an upgrade of a card you run */}
          {d.pairedWith && (
            <PairBanner pair={d.pairedWith} onNameClick={onPreview} onNameHover={handlePairNameHover} />
          )}

          {/* Signals: fit meter + synergy + inclusion */}
          <div className="flex items-center gap-3 text-[11px]">
            <div className="flex items-center gap-1.5 flex-1 min-w-0 max-w-56" title="Summed lift between this card and the cards in your deck, scaled to the strongest candidate">
              <span className="text-muted-foreground/80 shrink-0">Deck fit</span>
              <div className="h-1.5 flex-1 rounded-full bg-border/40 overflow-hidden">
                <div className="h-full rounded-full bg-gradient-to-r from-violet-500/60 to-violet-400" style={{ width: `${fitPct}%` }} />
              </div>
            </div>
            {typeof d.synergy === 'number' && (
              <span className="text-violet-300/80 shrink-0" title="EDHREC synergy: how much more this commander plays it than the average deck">
                {d.synergy >= 0 ? '+' : ''}{Math.round(d.synergy * 100)}% synergy
              </span>
            )}
            {d.inclusion > 0 && (
              <span className="text-muted-foreground/80 shrink-0">in {Math.round(d.inclusion)}% of decks</span>
            )}
          </div>

          {/* Evidence: which of YOUR cards back it */}
          {d.topEdges.length > 0 ? (
            <div className="flex flex-wrap items-center gap-1 text-[11px]">
              <span className="text-muted-foreground/70">Plays with your</span>
              {d.topEdges.map(e => (
                <button
                  key={e.deckCard}
                  type="button"
                  onClick={() => onPreview(e.deckCard)}
                  title={`Lift ${liftLabel(e.lift)} · together in ${e.numDecks.toLocaleString()} decks${e.numDecks < EDGE_CONFIDENCE_FLOOR ? ' (thin data)' : ''}`}
                  className={`inline-flex items-center gap-1 rounded-full bg-accent/40 hover:bg-accent/70 border border-border/40 px-2 py-0.5 transition-colors ${e.numDecks < EDGE_CONFIDENCE_FLOOR ? 'text-foreground/60' : 'text-foreground/85'}`}
                >
                  {e.deckCard}
                  <span className="text-violet-300/80 font-medium">{liftLabel(e.lift)}</span>
                </button>
              ))}
            </div>
          ) : (
            <p className="text-[11px] text-muted-foreground/70">No lift data against your cards yet — too new for co-occurrence stats.</p>
          )}
        </div>
      </div>
    );
  };

  const renderGridTile = (d: UpgradeDetail) => {
    const card = images.get(d.name);
    const img = card ? getCardImageUrl(card, 'normal') : null;
    const added = addedCards.has(d.name);
    const fitPct = maxFit > 0 ? Math.round((d.liftFit / maxFit) * 100) : 0;
    return (
      <div key={d.name} className="bg-card/60 border border-border/30 rounded-lg p-2 flex flex-col gap-2 group">
        <button
          type="button"
          onClick={() => onPreview(d.name)}
          title={d.name}
          className="relative w-full aspect-[5/7] rounded-md overflow-hidden bg-violet-500/10 border border-border/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/70"
        >
          {img
            ? <img src={img} alt={d.name} loading="lazy" className="absolute inset-0 w-full h-full object-cover" />
            : <div className="absolute inset-0 animate-pulse bg-violet-500/10" />}
          {/* Source badges, icon-only */}
          <span className="absolute top-1 left-1 flex gap-1">
            {d.sources.includes('commander') && (
              <span className="bg-violet-500/80 text-white rounded-full w-5 h-5 flex items-center justify-center" title={`New for ${commanderShortName}`}>
                <Crown className="w-2.5 h-2.5" />
              </span>
            )}
            {d.matchedThemes.length > 0 && (
              <span className="bg-violet-500/60 text-white rounded-full w-5 h-5 flex items-center justify-center" title={d.matchedThemes.join(' + ')}>
                <Tags className="w-2.5 h-2.5" />
              </span>
            )}
            {(d.sources.includes('recent-set') || d.sources.includes('since-baseline')) && d.releasedAt && (
              <span className="bg-amber-500/80 text-white rounded-full w-5 h-5 flex items-center justify-center" title={`Printed ${d.releasedAt.slice(0, 4)}`}>
                <CalendarDays className="w-2.5 h-2.5" />
              </span>
            )}
          </span>
        </button>
        {d.pairedWith && (() => {
          const pair = d.pairedWith;
          return (
            <button
              type="button"
              className="text-[10px] leading-tight text-emerald-300/90 truncate text-left hover:text-emerald-200 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/70 rounded-sm"
              title={`Possible upgrade of your ${pair.deckCard}`}
              onClick={() => onPreview(pair.deckCard)}
              onMouseEnter={e => handlePairNameHover(pair.deckCard, e.currentTarget.getBoundingClientRect())}
              onMouseLeave={() => handlePairNameHover(pair.deckCard, null)}
            >
              <ArrowUpRight className="w-2.5 h-2.5 inline mr-0.5" />upgrade of {pair.deckCard}
            </button>
          );
        })()}
        <div
          className="flex items-center gap-1.5"
          title={`Deck fit ${fitPct}%${typeof d.synergy === 'number' ? ` · ${d.synergy >= 0 ? '+' : ''}${Math.round(d.synergy * 100)}% synergy` : ''}${d.inclusion > 0 ? ` · in ${Math.round(d.inclusion)}% of decks` : ''}${d.topEdges.length > 0 ? ` · plays with ${d.topEdges.map(e => e.deckCard).join(', ')}` : ''}`}
        >
          <div className="h-1.5 flex-1 rounded-full bg-border/40 overflow-hidden">
            <div className="h-full rounded-full bg-gradient-to-r from-violet-500/60 to-violet-400" style={{ width: `${fitPct}%` }} />
          </div>
        </div>
        <Button
          variant={added ? 'ghost' : 'outline'}
          size="sm"
          disabled={added}
          className="w-full h-7"
          onClick={() => onAdd(d.name)}
        >
          {added ? <><Check className="w-3.5 h-3.5 mr-1 text-emerald-400" /> Added</> : <><Plus className="w-3.5 h-3.5 mr-1" /> Add</>}
        </Button>
      </div>
    );
  };

  return (
    <div className="space-y-3">
      {/* Header — full-bleed strip, matching the other Inspector tabs' top bars */}
      <div className="-mx-3 sm:-mx-4 -mt-3 sm:-mt-4 px-3 sm:px-4 pt-4 pb-4 border-b border-border/30 bg-background/80 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-violet-500/15 text-violet-300 border border-violet-500/25 shrink-0">
            <Newspaper className="w-5 h-5" />
          </span>
          <div className="leading-tight min-w-0 flex-1">
            <h3 className="text-base font-semibold text-foreground">New cards for this deck</h3>
            <p className="text-xs text-muted-foreground/80">
              {state.phase === 'done'
                ? <>Since <span className="text-foreground/90">{baselineNarrative(baselineKey, lastEditedAt)}</span>, {total === 0 ? 'nothing new has shown up for this deck.' : <>{total} card{total === 1 ? '' : 's'} worth a look — from EDHREC's data for {commanderName}{intendedThemes && intendedThemes.length > 0 ? ` and your ${intendedThemes.join(' + ')} theme${intendedThemes.length > 1 ? 's' : ''}` : ''}, ranked by fit with your cards.</>}</>
                : <>EDHREC's new-card data for {commanderName}, ranked by how strongly it plays alongside the cards already in your deck.</>}
            </p>
          </div>
          <div className="flex items-center gap-1.5 shrink-0 self-start">
            <label className="sr-only" htmlFor="newcards-baseline">Show cards printed since</label>
            <select
              id="newcards-baseline"
              value={baselineKey}
              onChange={e => setBaselineKey(e.target.value as BaselineKey)}
              title="Show cards printed since…"
              className="h-8 rounded-lg border border-border/40 bg-card text-xs text-foreground/90 px-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/70"
            >
              {BASELINE_OPTIONS.filter(o => o.key !== 'last-edit' || lastEditedAt).map(o => (
                <option key={o.key} value={o.key}>since {o.label}</option>
              ))}
            </select>
            <div className="flex items-center gap-0.5 rounded-lg border border-border/40 p-0.5">
              <Button
                variant={viewMode === 'list' ? 'secondary' : 'ghost'}
                size="icon"
                className="h-7 w-7"
                title="List view"
                onClick={() => setViewMode('list')}
              >
                <List className="w-3.5 h-3.5" />
              </Button>
              <Button
                variant={viewMode === 'grid' ? 'secondary' : 'ghost'}
                size="icon"
                className="h-7 w-7"
                title="Grid view"
                onClick={() => setViewMode('grid')}
              >
                <LayoutGrid className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>
        </div>
      </div>

      {state.phase === 'loading' && (
        <div className="space-y-2">
          {[0, 1, 2, 3].map(i => (
            <div key={i} className="h-24 rounded-lg bg-card/40 border border-border/20 animate-pulse" />
          ))}
        </div>
      )}

      {state.phase === 'error' && (
        <div className="bg-card/60 border border-border/30 rounded-lg p-6 text-sm text-muted-foreground">
          Couldn't load new-card data right now — EDHREC may be unreachable. Try again in a bit.
        </div>
      )}

      {state.phase === 'done' && total === 0 && (
        <div className="bg-card/60 border border-border/30 rounded-lg p-6 text-center">
          <Newspaper className="w-6 h-6 text-violet-300/60 mx-auto mb-2" />
          <p className="text-sm text-foreground/90">Nothing new for this deck right now.</p>
          <p className="text-xs text-muted-foreground/80 mt-1">Try a wider "since" window above, or check back after the next set drops.</p>
        </div>
      )}

      {state.phase === 'done' && sections.filter(s => s.details.length > 0).map(section => (
        <div key={section.key} className="space-y-2">
          <div className="flex items-baseline gap-2 pt-1">
            <span className={`w-2 h-2 rounded-[3px] ${section.pole} shrink-0 self-center`} />
            <h4 className="text-xs font-semibold uppercase tracking-wider text-foreground/80">{section.title}</h4>
            <span className="text-xs text-muted-foreground/60">{section.details.length}</span>
            <span className="text-[11px] text-muted-foreground/70 truncate">{section.blurb}</span>
          </div>
          {viewMode === 'grid'
            ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
                {section.details.map(renderGridTile)}
              </div>
            )
            : section.details.map(renderListRow)}
        </div>
      ))}

      {/* Floating full-card preview (desktop only) — anchored to the hovered pair name,
          flipping left when it would overflow the right viewport edge. */}
      {hoverPreview && (() => {
        const W = 256, PAD = 12;
        let left = hoverPreview.rect.right + PAD;
        if (left + W > window.innerWidth) left = hoverPreview.rect.left - W - PAD;
        const top = Math.min(Math.max(hoverPreview.rect.top + hoverPreview.rect.height / 2 - 180, 8), window.innerHeight - 380);
        const img = getCardImageUrl(hoverPreview.card, 'normal');
        return img ? (
          <div className="fixed z-[100] pointer-events-none hidden lg:block" style={{ left, top }}>
            <img src={img} alt={hoverPreview.card.name} className="w-64 rounded-lg shadow-2xl border border-border/50" />
          </div>
        ) : null;
      })()}
    </div>
  );
}
