import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Loader2, AlertTriangle, ChevronLeft, ChevronRight, Repeat } from 'lucide-react';
import type { ScryfallCard } from '@/types';
import type { SwapInPlan, AlternateCut } from '@/services/deckBuilder/swapFinder';
import { getCardImageUrl } from '@/services/scryfall/client';
import { ManaText } from '@/components/ui/mtg-icons';
import { MagnifiedPreview } from '@/components/playtest/MagnifiedPreview';

/**
 * The thumbnail doubles as the hover target for a full-size preview — at 28px
 * the art is an identifier, not something you can read, so the card itself has
 * to be reachable without leaving the panel.
 */
function CardThumb({ card }: { card: ScryfallCard }) {
  const imgRef = useRef<HTMLImageElement>(null);
  const [hovered, setHovered] = useState(false);
  return (
    <>
      <img
        ref={imgRef}
        src={getCardImageUrl(card, 'small')}
        alt={card.name}
        loading="lazy"
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        className="w-7 shrink-0 rounded-[3px] shadow-sm shadow-black/50 ring-1 ring-black/40 transition-shadow hover:ring-violet-400/60"
        style={{ aspectRatio: '5 / 7', objectFit: 'cover', objectPosition: 'top' }}
      />
      {/* 'right' so the preview lands beside the panel rather than over the
          options the player is comparing. */}
      {hovered && <MagnifiedPreview card={card} anchorRef={imgRef} side="right" z={1300} />}
    </>
  );
}

const FLYOUT_WIDTH = 248;

/**
 * Rigidly beside the anchor row, flipping to its left when the right has no
 * room and aligning to its bottom when the list would run past the viewport.
 * Deliberately NOT clamped to the viewport: a clamp lets the flyout drift
 * independently of the row while scrolling, which reads as it following you
 * around rather than belonging to the thing you opened it from.
 */
function place(el: HTMLElement, height: number) {
  const r = el.getBoundingClientRect();
  const roomRight = window.innerWidth - r.right - 8 >= FLYOUT_WIDTH;
  const alignedTop = r.top - 8;
  return {
    left: roomRight ? r.right + 6 : Math.max(8, r.left - FLYOUT_WIDTH - 6),
    top: alignedTop + height <= window.innerHeight - 8 ? alignedTop : r.bottom + 8 - height,
  };
}

/**
 * The rest of one category, floated beside the row that owns it. A side flyout
 * rather than an inline accordion: expanding in place would shove the rows the
 * user is comparing out from under the cursor.
 */
function AlternatesFlyout({ anchorEl, label, items, onPick, onEnter, onLeave }: {
  anchorEl: HTMLElement;
  label: string;
  items: AlternateCut[];
  onPick: (alt: AlternateCut) => void;
  onEnter: () => void;
  onLeave: () => void;
}) {
  // Positioned from the LIVE anchor rather than a rect captured on hover: it is
  // fixed to the viewport, so a stale rect leaves it hanging in place while the
  // row it belongs to scrolls away underneath.
  const boxRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const update = () => setPos(place(anchorEl, boxRef.current?.offsetHeight ?? 0));
    update();
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [anchorEl, items.length]);

  return createPortal(
    <div
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      ref={boxRef}
      data-swap-flyout
      className="fixed z-[1200] rounded-lg border border-border bg-card shadow-2xl shadow-black/60 overflow-hidden"
      // Hidden for the first frame only, while its height is measured.
      style={{ left: pos?.left ?? 0, top: pos?.top ?? 0, width: FLYOUT_WIDTH, visibility: pos ? 'visible' : 'hidden' }}
    >
      <p className="px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground border-b border-border/60 bg-background/70">
        More {label.toLowerCase()}
      </p>
      {items.length === 0 ? (
        <p className="px-2.5 py-3 text-[11px] text-muted-foreground">Nothing else in this category.</p>
      ) : (
        <div className="max-h-64 overflow-y-auto divide-y divide-border/30">
          {items.map(alt => (
            <button
              key={alt.card.name}
              type="button"
              onClick={() => onPick(alt)}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left hover:bg-violet-500/10 transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-violet-400/70"
            >
              <CardThumb card={alt.card} />
              <span className="min-w-0 flex-1">
                <span className="block text-[12px] text-foreground/90 truncate">{alt.card.name}</span>
                <span className="mt-0.5 inline-flex items-center rounded px-1 py-px text-[9px] font-semibold tabular-nums border border-violet-400/25 bg-violet-500/10 text-violet-200/90">
                  {alt.evidence}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>,
    document.body,
  );
}

export interface SwapInPanelProps {
  incoming: ScryfallCard;
  plan: SwapInPlan;
  onSwap: (cutName: string) => void | Promise<void>;
  onAddAnyway: () => void;
  /**
   * Shown as a "back" affordance when the panel replaced something the user can
   * return to — the Inspector expands its add-a-card popover in place, so there
   * the search is still behind this. Omit when there is nothing to go back to.
   */
  onBack?: () => void;
}

/**
 * The cut recommendation itself, with no chrome or positioning of its own, so it
 * can be floated in a portal (the deck view) or expanded inline inside an
 * existing popover (the Inspector) without the two drifting apart.
 */
export function SwapInPanel({ incoming, plan, onSwap, onAddAnyway, onBack }: SwapInPanelProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  // The name currently being applied, so only that row shows a spinner.
  const [applying, setApplying] = useState<string | null>(null);
  const [openAlts, setOpenAlts] = useState<{ row: number; el: HTMLElement } | null>(null);
  // Submenu grace period, so the cursor can travel from the chevron to the flyout.
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holdOpen = useCallback(() => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
  }, []);
  const scheduleClose = useCallback(() => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setOpenAlts(null), 160);
  }, []);
  useEffect(() => () => { if (closeTimer.current) clearTimeout(closeTimer.current); }, []);

  const { block, candidates } = plan;
  const hasChoices = !block && candidates.length > 0;

  // Every card here is a one-click action: nothing is pre-chosen, and clicking
  // one applies it. No selection to make, nothing to confirm afterwards — which
  // is also why the arrow/Enter handling and the auto-focus are gone: each row
  // is a real button, so Tab and Enter already do the right thing.
  const commit = useCallback(async (cutName: string) => {
    if (applying) return;
    setApplying(cutName);
    try { await onSwap(cutName); }
    finally { setApplying(null); }
  }, [applying, onSwap]);

  return (
    <div ref={rootRef} data-preview-avoid="2">
      {/* Incoming card. It and the action row keep the panel's own surface;
          the options sit in a darker well between them, which separates the
          subject from the choices without tinting three different ways. */}
      <div className="flex items-start gap-2.5 px-3 pt-3 pb-2.5 border-b border-border/60">
        <CardThumb card={incoming} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-1.5">
            <h2 className="text-sm font-semibold text-foreground truncate leading-tight">{incoming.name}</h2>
            {incoming.mana_cost && <ManaText text={incoming.mana_cost} className="text-[11px] leading-none shrink-0" />}
          </div>
          <p className="text-[11px] text-muted-foreground mt-1 leading-snug">
            {block?.kind === 'already-in-deck' && 'Already in this deck.'}
            {block?.kind === 'off-identity' && `Outside your commander's color identity (${block.colors.join('')}).`}
            {!block && candidates.length === 0 && 'Nothing in the deck stands out as the cut.'}
            {hasChoices && 'Pick what it replaces.'}
          </p>
        </div>
      </div>

      {block && (
        <div className="flex items-start gap-2 mx-3 mb-3 px-2.5 py-2 rounded-md bg-rose-500/10 border border-rose-500/25 text-rose-200">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
          <p className="text-[11px] leading-snug">
            {block.kind === 'already-in-deck'
              ? 'Singleton decks run one copy, so there is no swap to make here.'
              : 'Cards outside the commander’s identity are not legal in this deck.'}
          </p>
        </div>
      )}

      {hasChoices && (
        <div className="bg-black/35 divide-y divide-border/40">
          {candidates.map((candidate, i) => {
            const busy = applying === candidate.card.name;
            const altCount = candidate.alternates.length;
            return (
              <div
                key={candidate.rationale}
                className={`group flex items-stretch transition-colors duration-150 ${
                  busy ? 'bg-violet-500/15' : 'hover:bg-violet-500/10'
                } ${applying && !busy ? 'opacity-50' : ''}`}
              >
                <button
                  type="button"
                  disabled={!!applying}
                  onClick={() => void commit(candidate.card.name)}
                  title={`Cut ${candidate.card.name} for ${incoming.name}`}
                  className="flex-1 min-w-0 flex items-start gap-2.5 pl-3 pr-2 py-2 text-left disabled:cursor-default focus:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-violet-400/70"
                >
                  <CardThumb card={candidate.card} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-medium truncate text-foreground/90 group-hover:text-violet-100">
                      {candidate.card.name}
                    </span>
                    <span className="block text-[11px] text-muted-foreground leading-snug mt-0.5">
                      {candidate.reason}
                    </span>
                    <span className="mt-1.5 inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold tabular-nums border border-violet-400/25 bg-violet-500/10 text-violet-200/90">
                      {candidate.evidence}
                    </span>
                  </span>
                  {/* The row IS the action, so say so on hover rather than
                      leaving a bare list that looks like it needs confirming. */}
                  {busy
                    ? <Loader2 className="w-3.5 h-3.5 shrink-0 mt-0.5 text-violet-300 animate-spin" />
                    : <Repeat className="w-3.5 h-3.5 shrink-0 mt-0.5 text-violet-300 opacity-0 group-hover:opacity-100 transition-opacity duration-150" />}
                </button>

                {/* Agreeing with the reason but not the card is the ordinary
                    case, so every category stays browsable from its own row. */}
                {altCount > 0 && (
                  <button
                    type="button"
                    aria-label={`More ${candidate.categoryLabel.toLowerCase()} to cut`}
                    aria-expanded={openAlts?.row === i}
                    disabled={!!applying}
                    onMouseEnter={(e) => { holdOpen(); setOpenAlts({ row: i, el: e.currentTarget }); }}
                    onMouseLeave={scheduleClose}
                    onFocus={(e) => setOpenAlts({ row: i, el: e.currentTarget })}
                    onClick={(e) => { holdOpen(); setOpenAlts({ row: i, el: e.currentTarget }); }}
                    className={`shrink-0 w-6 flex items-center justify-center border-l transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-violet-400/70 ${
                      openAlts?.row === i
                        ? 'border-violet-400/30 bg-violet-500/15 text-violet-200'
                        : 'border-border/30 text-muted-foreground/60 hover:text-foreground hover:bg-accent/60'
                    }`}
                  >
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {openAlts && candidates[openAlts.row] && (
        <AlternatesFlyout
          anchorEl={openAlts.el}
          label={candidates[openAlts.row].categoryLabel}
          items={candidates[openAlts.row].alternates}
          onEnter={holdOpen}
          onLeave={scheduleClose}
          onPick={(alt) => { setOpenAlts(null); void commit(alt.card.name); }}
        />
      )}

      <div className="flex items-center gap-2 px-3 py-2.5 border-t border-border/60">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            disabled={!!applying}
            aria-label="Back to search"
            className="shrink-0 p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent/60 transition-colors disabled:opacity-60 focus:outline-none focus-visible:ring-1 focus-visible:ring-violet-400"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>
        )}
        {hasChoices ? (
          <>
            <button
              type="button"
              onClick={onAddAnyway}
              disabled={!!applying}
              className="ml-auto px-2 py-1 rounded-md text-[11px] font-medium text-muted-foreground border border-transparent hover:text-foreground hover:bg-accent/60 hover:border-border/60 transition-colors disabled:opacity-60 focus:outline-none focus-visible:ring-1 focus-visible:ring-violet-400"
            >
              Add without cutting
            </button>
          </>
        ) : !block ? (
          <>
            <button
              type="button"
              onClick={onAddAnyway}
              className="inline-flex items-center px-3 py-1.5 rounded-md text-xs font-semibold bg-violet-500/20 hover:bg-violet-500/30 text-violet-100 border border-violet-400/40 transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-violet-400"
            >
              Add it anyway
            </button>
            <span className="text-[11px] text-muted-foreground">You’ll be one over target.</span>
          </>
        ) : (
          <span className="text-[11px] text-muted-foreground">
            {onBack ? 'Try another card.' : 'Nothing to do here.'}
          </span>
        )}
      </div>
    </div>
  );
}
