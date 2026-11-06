// src/components/deck/optimizer/dashboard/launchpad/parts.tsx
//
// Shared pieces of the launch pad's job previews: the panel shell, the "open the full tab" buttons,
// card thumbs, and the paired swap row: this card out, that card in, and why.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowRight, ArrowRightLeft, Undo2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { MagnifiedPreview } from '@/components/playtest/MagnifiedPreview';
import { getCachedCard } from '@/services/scryfall/client';
import { cn } from '@/lib/utils';
import type { ScryfallCard } from '@/types';
import { scryfallImg, TABS, type TabKey } from '../../constants';
import { useOpenCardMenu } from './cardMenu';

/** Fill for a bar still short of its target: amber stripes, so "not there yet" reads apart from a
 *  solid bar that has made it, without leaning on colour alone. */
export const SHORT_BAR = 'bg-amber-400/35 bg-[repeating-linear-gradient(135deg,theme(colors.amber.400)_0_4px,transparent_4px_8px)]';

export function PointsChip({ points }: { points: number }) {
  if (points <= 0) return null;
  return (
    <span className="inline-flex items-center rounded-full bg-violet-500/20 px-2.5 py-0.5 text-xs font-bold tabular-nums text-violet-200 whitespace-nowrap">
      +{points} pt{points === 1 ? '' : 's'}
    </span>
  );
}

export function StatusChip({ tone, children }: { tone: 'good' | 'warn'; children: ReactNode }) {
  return (
    <span className={cn(
      'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap',
      tone === 'good' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-amber-500/10 text-amber-300',
    )}>
      {children}
    </span>
  );
}

/** "Open Card Fit →" — wears the rail tab's icon so the button and the rail read as one place. Dark
 *  ground so it holds its contrast over the panel's card art. */
export function OpenTab({ tab, label, onClick }: { tab: TabKey; label: string; onClick: () => void }) {
  const Icon = TABS.find(t => t.key === tab)?.icon;
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={onClick}
      className="group gap-1.5 border-violet-500/45 bg-background/90 text-violet-200 shadow-[0_2px_8px_-2px_rgb(0_0_0/0.5)] hover:bg-background hover:text-violet-100 hover:border-violet-400/70"
    >
      {Icon && <Icon className="w-3.5 h-3.5" />}
      <span>Open {label}</span>
      <ArrowRight className="w-3.5 h-3.5 transition-transform group-hover:translate-x-0.5" />
    </Button>
  );
}

/** A panel title wearing its rail tab's icon — the same icon as its "Open …" button, so the eye can
 *  match a section to the button that opens it. */
export function SectionTitle({ tab, children }: { tab: TabKey; children: ReactNode }) {
  const Icon = TABS.find(t => t.key === tab)?.icon;
  if (!Icon) return <>{children}</>;
  return (
    <span className="flex items-start gap-2">
      <Icon className="mt-[0.2em] w-4 h-4 shrink-0 text-violet-300" aria-hidden="true" />
      <span>{children}</span>
    </span>
  );
}

export function PreviewShell({ tab, title, sub, aside, children, footNote, actions }: {
  /** The tab this panel opens: its icon leads the title. */
  tab?: TabKey;
  title: ReactNode;
  sub?: ReactNode;
  aside?: ReactNode;
  children?: ReactNode;
  footNote?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-[15px] sm:text-[17px] font-semibold leading-snug text-foreground text-balance">
            {tab ? <SectionTitle tab={tab}>{title}</SectionTitle> : title}
          </h3>
          {sub && <p className={cn('mt-1 text-[13px] text-muted-foreground max-w-prose', tab && 'pl-6')}>{sub}</p>}
        </div>
        {aside && <div className="shrink-0">{aside}</div>}
      </div>
      {children && <div className="mt-3.5 flex flex-col gap-2.5">{children}</div>}
      {(footNote || actions) && (
        <div className="mt-3.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 text-xs text-muted-foreground">
          <span>{footNote}</span>
          <div className="flex flex-wrap gap-2">{actions}</div>
        </div>
      )}
    </>
  );
}

export function PreviewSkeleton({ rows = 3, label }: { rows?: number; label?: string }) {
  return (
    <div className="flex flex-col gap-2.5" aria-busy="true">
      {/* A slow load says what it's doing instead of leaving a blank box. */}
      {label
        ? <p className="text-[13px] text-muted-foreground" role="status">{label}</p>
        : <div className="h-5 w-2/3 rounded bg-muted/60 animate-pulse" />}
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="h-[62px] rounded-lg bg-muted/40 animate-pulse" />
      ))}
    </div>
  );
}

/**
 * Mouse hover on a card image floats the full card beside it. Touch has no hover, so a tap still goes
 * to the Inspector's preview dialog. The card resolves from the cache when it can; otherwise a name
 * is enough, since Scryfall serves an image by name.
 */
export function useCardHover(name: string, card?: ScryfallCard) {
  const ref = useRef<HTMLButtonElement>(null);
  const [hovered, setHovered] = useState(false);
  const openMenu = useOpenCardMenu();
  const known = card ?? getCachedCard(name);
  const preview = hovered ? (
    <MagnifiedPreview
      card={known ?? ({ name } as ScryfallCard)}
      src={known ? undefined : scryfallImg(name, 'normal')}
      anchorRef={ref}
      side="right"
      width={300}
    />
  ) : null;
  return {
    ref,
    preview,
    handlers: {
      onPointerEnter: (e: React.PointerEvent) => { if (e.pointerType === 'mouse') setHovered(true); },
      onPointerLeave: () => setHovered(false),
      onPointerDown: () => setHovered(false),
      // Right-click opens the app's card menu, the same one every other card surface has.
      onContextMenu: (e: React.MouseEvent) => {
        if (!openMenu) return;
        e.preventDefault();
        setHovered(false);
        openMenu(name, known, e.clientX, e.clientY);
      },
    },
  };
}

const artCrop = (c?: ScryfallCard) => c?.image_uris?.art_crop ?? c?.card_faces?.[0]?.image_uris?.art_crop;

/** A card named in a sentence: a sliver of its art before the name, the full card on hover. */
export function ArtChip({ name, card, onPreview, tone }: {
  name: string;
  card?: ScryfallCard;
  onPreview: (name: string) => void;
  /** 'add' marks the card a suggestion brings in. */
  tone?: 'add';
}) {
  const hover = useCardHover(name, card);
  const src = artCrop(card ?? getCachedCard(name))
    ?? `https://api.scryfall.com/cards/named?exact=${encodeURIComponent(name)}&format=image&version=art_crop`;
  return (
    <>
      <button
        ref={hover.ref}
        {...hover.handlers}
        type="button"
        onClick={() => onPreview(name)}
        className={cn(
          'inline-flex max-w-full cursor-pointer items-center gap-1.5 rounded-md border py-0.5 pl-0.5 pr-2 align-middle font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
          tone === 'add'
            ? 'border-violet-400/50 bg-violet-500/15 text-violet-100 hover:border-violet-300/70'
            : 'border-border/60 bg-card/80 text-foreground hover:border-foreground/40 hover:bg-card',
        )}
      >
        <img src={src} alt="" loading="lazy" className="h-5 w-7 shrink-0 rounded-[3px] object-cover" />
        <span className="truncate">{name}</span>
      </button>
      {hover.preview}
    </>
  );
}

/**
 * A claim that opens what it claims: "Completes 3 combos" shows the combos, "6 of 9" shows the six.
 * The dotted underline says there's more. Mouse hover peeks and a click pins it open; touch and
 * keyboard open it with a tap or Enter, since they have no hover.
 */
export function Peek({ label, children, className, contentClassName }: {
  label: ReactNode;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const timer = useRef<number>();
  // Opened by hovering (so a click pins it rather than closing it), and pinned (so leaving won't close it).
  const byHover = useRef(false);
  const pinned = useRef(false);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const later = (next: boolean, ms: number) => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => { if (next) byHover.current = true; setOpen(next); }, ms);
  };
  const enter = (e: React.PointerEvent) => { if (e.pointerType === 'mouse') later(true, 120); };
  const leave = (e: React.PointerEvent) => { if (e.pointerType === 'mouse' && !pinned.current) later(false, 180); };
  const change = (next: boolean) => {
    window.clearTimeout(timer.current);
    if (!next) { byHover.current = false; pinned.current = false; }
    setOpen(next);
  };
  return (
    <Popover open={open} onOpenChange={change}>
      <PopoverTrigger asChild>
        <button
          type="button"
          onPointerEnter={enter}
          onPointerLeave={leave}
          onClick={e => {
            // Radix would toggle it shut; a click on a hover-opened peek keeps it instead.
            if (open && byHover.current) { e.preventDefault(); byHover.current = false; pinned.current = true; }
          }}
          className={cn(
            'cursor-pointer rounded-sm text-left underline decoration-dotted decoration-from-font underline-offset-[3px] transition-colors',
            'decoration-muted-foreground/70 hover:text-foreground hover:decoration-foreground/80 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
            open && 'text-foreground',
            className,
          )}
        >
          {label}
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        collisionPadding={12}
        onOpenAutoFocus={e => e.preventDefault()}
        onPointerEnter={() => window.clearTimeout(timer.current)}
        onPointerLeave={leave}
        className={cn('w-80 max-w-[calc(100vw-24px)] p-3 text-[12.5px] leading-snug', contentClassName)}
      >
        {children}
      </PopoverContent>
    </Popover>
  );
}

/** Small card image: hover magnifies it, a click opens the Inspector's card preview. */
export function CardThumb({ name, src, onPreview, size = 'md' }: {
  name: string;
  src?: string | null;
  onPreview: (name: string) => void;
  size?: 'sm' | 'md';
}) {
  const hover = useCardHover(name);
  return (
    <>
    <Button
      ref={hover.ref}
      {...hover.handlers}
      type="button"
      variant="ghost"
      onClick={() => onPreview(name)}
      aria-label={`Preview ${name}`}
      className={cn(
        'shrink-0 h-auto p-0 rounded overflow-hidden shadow-md hover:opacity-90 hover:bg-transparent',
        size === 'md' ? 'w-[30px] sm:w-[38px]' : 'w-[30px]',
      )}
    >
      <img src={src || scryfallImg(name)} alt={name} loading="lazy" className="w-full aspect-[5/7] object-cover" />
    </Button>
    {hover.preview}
    </>
  );
}

export interface RowSide {
  name: string;
  img?: string | null;
  /** One line of plain-English evidence under the name. */
  why: ReactNode;
}

/** "+3 pts" beside a row: what this one swap is projected to add. */
export function RowGain({ points }: { points?: number }) {
  if (points == null || points <= 0) return null;
  return <span className="text-xs font-semibold tabular-nums text-violet-300 whitespace-nowrap">+{points} pt{points === 1 ? '' : 's'}</span>;
}

/**
 * One card out, one card in, its action. On a phone the pair stacks with the actions to the right;
 * from `sm` up it reads left to right across the arrow. `onKeep` adds a quiet "Keep" under the
 * action, for a card the player wants to keep whatever the numbers say.
 */
export function SwapRow({ out, into, done, actionLabel = 'Swap', onApply, onUndo, onKeep, onPreview, gain, aside }: {
  out: RowSide;
  into: RowSide;
  done: boolean;
  actionLabel?: string;
  onApply: () => void;
  onUndo: () => void;
  onKeep?: () => void;
  onPreview: (name: string) => void;
  /** Projected points for this swap alone. */
  gain?: number;
  /** Replaces the action column when the row is informational (e.g. a saving amount). */
  aside?: ReactNode;
}) {
  const side = (s: RowSide, kind: 'out' | 'in') => (
    <div className={cn('flex items-center gap-2.5 min-w-0', kind === 'out' && done && 'opacity-60')}>
      <CardThumb name={s.name} src={s.img} onPreview={onPreview} />
      <div className="min-w-0 flex flex-col">
        <span className={cn(
          'text-[13px] font-semibold truncate',
          kind === 'out' ? 'text-rose-300' : 'text-violet-200',
          kind === 'out' && done && 'line-through',
        )}>
          {s.name}
        </span>
        <span className="text-[11.5px] leading-snug text-muted-foreground">{s.why}</span>
      </div>
    </div>
  );
  return (
    <div className={cn(
      'grid grid-cols-[minmax(0,1fr)_auto] gap-x-2 gap-y-2 rounded-md px-1.5 py-2.5 transition-colors',
      // Fixed action column: sized to its content, a long "Keep …" label pushed that row's card
      // columns out of line with the rows above and below.
      'sm:grid-cols-[minmax(0,1fr)_16px_minmax(0,1fr)_10.5rem] sm:items-center sm:gap-x-2.5',
      done && 'bg-emerald-500/[0.07]',
    )}>
      <div className="col-start-1 row-start-1">{side(out, 'out')}</div>
      <ArrowRight className="hidden sm:block w-4 h-4 text-muted-foreground/70" aria-hidden="true" />
      <div className="col-start-1 row-start-2 sm:col-start-auto sm:row-start-auto">{side(into, 'in')}</div>
      <div className="col-start-2 row-span-2 row-start-1 self-center justify-self-end min-w-0 max-w-full flex flex-col items-end gap-1 sm:col-start-auto sm:row-span-1 sm:row-start-auto">
        {aside ?? (done ? (
          <Button type="button" size="sm" variant="outline" onClick={onUndo}
            className="gap-1.5 border-emerald-500/40 bg-transparent text-emerald-400 hover:bg-emerald-500/10 hover:text-emerald-300">
            <Undo2 className="w-3.5 h-3.5" /> Undo
          </Button>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <RowGain points={gain} />
              <Button type="button" size="sm" onClick={onApply} className="gap-1.5">
                <ArrowRightLeft className="w-3.5 h-3.5" /> {actionLabel}
              </Button>
            </div>
            {onKeep && (
              <Button type="button" size="sm" variant="ghost" onClick={onKeep}
                title={`Keep ${out.name} and stop suggesting it here`}
                className="h-6 max-w-full px-2 text-xs font-normal text-muted-foreground hover:text-foreground">
                <span className="truncate">Keep {out.name.length > 18 ? 'it' : out.name.split(',')[0]}</span>
              </Button>
            )}
          </>
        ))}
      </div>
    </div>
  );
}

/** Hairline-divided list on the panel's own ground — rows are lines, not cards inside a card. */
export function Rows({ children }: { children: ReactNode }) {
  return <div className="-mx-1.5 flex flex-col divide-y divide-border/40">{children}</div>;
}

/**
 * Rows that hold still once the player acts on one. The suggestion lists are recomputed from the
 * live deck, so without this an applied swap would vanish from under its Undo button the moment the
 * deck changed. Whether a row is done lives in the launch pad's change log, not here; this only
 * decides which rows are on screen. `release` lets go, so the next batch from the live list shows.
 */
export function useHeldRows<T>(live: T[]) {
  const [held, setHeld] = useState<T[] | null>(null);
  const rows = held ?? live;
  return {
    rows,
    hold: () => { if (!held) setHeld(rows); },
    release: () => setHeld(null),
  };
}
