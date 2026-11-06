// src/components/deck/optimizer/dashboard/launchpad/NewCardsPreview.tsx
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { ScryfallCard } from '@/types';
import { getCardsByNames, getCardImageUrl } from '@/services/scryfall/client';
import { getUpgradeDetails, type UpgradeDetail } from '@/services/deckUpgrades/getRelevantCards';
import { ChevronLeft, ChevronRight, Plus, Undo2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { newCardsBaseline } from '../../NewCardsTab';
import { OpenTab, PreviewShell, PreviewSkeleton, useCardHover } from './parts';
import { useLiftPicks } from './useLiftPicks';
import type { LaunchPadDeps } from './types';

/** Tiles in one view of the carousel on desktop. */
const SHOWN = 3;

export type NewCardsState =
  | { phase: 'idle' }
  | { phase: 'loading' }
  | { phase: 'done'; details: UpgradeDetail[]; art: Map<string, ScryfallCard>; narrative: string }
  | { phase: 'error' };

/**
 * The New Cards tab's pipeline, run on demand. Same inputs and baseline as the tab, so the two agree
 * and share EDHREC's 14-day cache — opening this job warms the tab. Owned by the launch pad (not the
 * preview) so the count survives switching jobs and can label the choice.
 */
export function useNewCards(d: Pick<LaunchPadDeps, 'commanderName' | 'partnerCommanderName' | 'cards' | 'colorIdentity' | 'newCards'>, enabled: boolean): NewCardsState {
  const [state, setState] = useState<NewCardsState>({ phase: 'idle' });
  const { listId, lastEditedAt, intendedThemes, themeRefs } = d.newCards;
  const baseline = useMemo(() => newCardsBaseline(listId, lastEditedAt), [listId, lastEditedAt]);
  const deckNames = useMemo(
    () => [...new Set([d.commanderName, d.partnerCommanderName, ...d.cards.map(c => c.name)].filter(Boolean) as string[])],
    [d.commanderName, d.partnerCommanderName, d.cards],
  );
  // Content keys, not identities: the parent rebuilds these arrays every render.
  const themesKey = [...(themeRefs ?? []).map(t => t.slug), ...(intendedThemes ?? [])].join('|');

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setState({ phase: 'loading' });
    getUpgradeDetails({
      commanderName: d.commanderName,
      partnerName: d.partnerCommanderName,
      deckCardNames: deckNames,
      themes: intendedThemes,
      themeRefs,
      colorIdentity: d.colorIdentity,
      baselineDate: baseline.date,
    }).then(async details => {
      if (cancelled) return;
      const art = await getCardsByNames(details.map(x => x.name));
      if (!cancelled) setState({ phase: 'done', details, art, narrative: baseline.narrative });
    }).catch(() => { if (!cancelled) setState({ phase: 'error' }); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, d.commanderName, d.partnerCommanderName, themesKey, baseline]);

  return state;
}

const pct = (n: number) => `${Math.round(n)}%`;
const synergyLabel = (s: number) => `${s >= 0 ? '+' : ''}${Math.round(s * 100)}% synergy`;

function ArtTile({ detail, card, added, onAdd, onUndo, onPreview }: {
  detail: UpgradeDetail;
  card?: ScryfallCard;
  added: boolean;
  onAdd: () => void;
  onUndo: () => void;
  onPreview: (n: string) => void;
}) {
  const art = card?.image_uris?.art_crop ?? card?.card_faces?.[0]?.image_uris?.art_crop ?? (card ? getCardImageUrl(card, 'normal') : null);
  const hover = useCardHover(detail.name, card);
  return (
    <div className="group relative aspect-[4/3] w-full overflow-hidden rounded-lg border border-border/50 bg-violet-500/10">
      {/* The whole tile previews the card; the Add button sits on top as its own control. */}
      <Button
        ref={hover.ref}
        {...hover.handlers}
        type="button"
        variant="ghost"
        onClick={() => onPreview(detail.name)}
        aria-label={`Preview ${detail.name}`}
        className="absolute inset-0 h-full w-full p-0 rounded-none hover:bg-transparent"
      >
        {art ? (
          <img src={art} alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.04]" />
        ) : <span className="absolute inset-0 animate-pulse bg-violet-500/10" />}
        <span className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-black/85" aria-hidden="true" />
        <span className="absolute inset-x-2 bottom-2 flex flex-col items-start gap-1 text-left">
          <span className="text-[12.5px] font-bold leading-tight text-white drop-shadow whitespace-normal">{detail.name}</span>
          <span className="flex flex-wrap gap-1.5 text-[10.5px] font-normal text-white/80">
            {typeof detail.synergy === 'number' && (
              <span className="rounded-full bg-violet-500/35 px-1.5 font-semibold text-violet-100"
                title="How much more often decks with this commander play it than decks in general">{synergyLabel(detail.synergy)}</span>
            )}
            {detail.inclusion > 0 && <span>in {pct(detail.inclusion)} of decks</span>}
          </span>
        </span>
      </Button>
      <Button
        type="button"
        size="sm"
        variant={added ? 'outline' : 'default'}
        onClick={added ? onUndo : onAdd}
        className={`absolute right-1.5 top-1.5 h-7 gap-1 px-2 text-xs ${added ? 'border-emerald-500/50 bg-black/60 text-emerald-300 hover:bg-black/70' : 'shadow-md'}`}
      >
        {added ? <><Undo2 className="w-3 h-3" /> Added</> : <><Plus className="w-3 h-3" /> Add</>}
      </Button>
      {hover.preview}
    </div>
  );
}

/**
 * Every card the title counts, in a row that scrolls sideways: three to a view on desktop, one and a
 * peek of the next on a phone, which swipes. The arrows page by a view and grey out at the ends.
 */
function Carousel({ children, count }: { children: ReactNode; count: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [edge, setEdge] = useState({ start: true, end: count <= SHOWN });
  const read = () => {
    const el = ref.current;
    if (!el) return;
    setEdge({ start: el.scrollLeft <= 2, end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 2 });
  };
  useEffect(read, [count]);
  const page = (dir: 1 | -1) => {
    const el = ref.current;
    if (!el) return;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    el.scrollBy({ left: dir * el.clientWidth, behavior: reduce ? 'auto' : 'smooth' });
  };
  const arrow = (dir: 1 | -1) => {
    const off = dir < 0 ? edge.start : edge.end;
    const Icon = dir < 0 ? ChevronLeft : ChevronRight;
    return (
      <Button
        type="button"
        variant="outline"
        size="icon"
        onClick={() => page(dir)}
        disabled={off}
        aria-label={dir < 0 ? 'Previous cards' : 'More cards'}
        className={cn(
          'absolute top-1/2 z-10 hidden h-8 w-8 -translate-y-1/2 rounded-full border-border/70 bg-background/90 shadow-[0_2px_8px_-2px_rgb(0_0_0/0.6)] hover:bg-background sm:inline-flex',
          'transition-opacity disabled:opacity-0',
          dir < 0 ? '-left-2' : '-right-2',
        )}
      >
        <Icon className="w-4 h-4" />
      </Button>
    );
  };
  return (
    <div className="relative">
      <div
        ref={ref}
        onScroll={read}
        className="-mx-0.5 flex snap-x snap-mandatory gap-2 overflow-x-auto scroll-smooth px-0.5 pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden motion-reduce:scroll-auto"
      >
        {children}
      </div>
      {count > SHOWN && <>{arrow(-1)}{arrow(1)}</>}
    </div>
  );
}

export function NewCardsPreview({ d, state }: { d: LaunchPadDeps; state: NewCardsState }) {
  // The Lift Web's strongest "goes with what you run" card — not new, but the other half of the job.
  const { picks } = useLiftPicks({
    commanderName: d.commanderName, partnerCommanderName: d.partnerCommanderName,
    commander: d.commander, partnerCommander: d.partnerCommander,
    colorIdentity: d.colorIdentity, currentCards: d.cards,
  });
  const cluster = picks?.cluster ?? null;
  const actions = <>
    <OpenTab tab="newCards" label="New Cards" onClick={() => d.onNavigate('newCards')} />
    <OpenTab tab="lift" label="Lift Web" onClick={() => d.onNavigate('lift')} />
  </>;

  if (state.phase === 'idle' || state.phase === 'loading') return <PreviewSkeleton rows={2} label="Looking through recent sets for cards that fit this deck…" />;
  if (state.phase === 'error') {
    return <PreviewShell tab="newCards" title="New cards didn't load" sub="EDHREC didn't respond. Try the New Cards tab." actions={actions} />;
  }

  const { details, art, narrative } = state;
  const n = details.length;
  // "the last few sets" is a span ("printed in"); every other baseline is a point in time ("since").
  const when = narrative.startsWith('the last') ? `in ${narrative}` : `since ${narrative}`;
  return (
    <PreviewShell tab="newCards"
      title={n > 0 ? `${n} new card${n === 1 ? '' : 's'} worth a look` : 'Nothing new fits this deck yet'}
      sub={n > 0
        ? `Printed ${when}, ranked by how well they fit the cards you already run.`
        : `Nothing printed ${when} plays with this deck's cards. Widen the window in the New Cards tab.`}
      actions={actions}
    >
      {n > 0 && (
        <Carousel count={n}>
          {details.map(x => {
            const id = `add:${x.name}`;
            return (
              <div key={x.name} className="w-[78%] shrink-0 snap-start sm:w-[calc((100%-1rem)/3)]">
                <ArtTile detail={x} card={art.get(x.name)} onPreview={d.onPreviewCard}
                  added={d.isApplied(id)}
                  onAdd={() => d.apply({ id, label: `Add ${x.name}`, removals: [], additions: [x.name] })}
                  onUndo={() => d.undo(id)} />
              </div>
            );
          })}
        </Carousel>
      )}
      {cluster && (
        <div className="flex items-center gap-2.5 rounded-lg border border-dashed border-fuchsia-300/35 bg-fuchsia-400/[0.05] px-2.5 py-2 text-[12.5px] text-foreground/85">
          <Button type="button" variant="link" onClick={() => d.onPreviewCard(cluster.card.name)}
            className="h-auto p-0 text-[12.5px] font-semibold text-fuchsia-300 underline-offset-2">{cluster.card.name}</Button>
          <span className="text-muted-foreground">
            isn't new, but it shows up with {cluster.connectionCount} of your cards.
          </span>
        </div>
      )}
    </PreviewShell>
  );
}
