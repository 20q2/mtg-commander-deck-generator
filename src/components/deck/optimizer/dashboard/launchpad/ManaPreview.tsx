// src/components/deck/optimizer/dashboard/launchpad/ManaPreview.tsx
//
// The mana base in three readings, each on its own solid ground so nothing floats over the art: how
// many lands against the suggestion, what the opening hands look like, and how much ramp backs them.
// Colour sources sit under those for decks with something to balance; Card Fit's land pick last.
import { useState, type ReactNode } from 'react';
import { Check, Hand, Sprout } from 'lucide-react';
import { cn } from '@/lib/utils';
import { addReason } from './jobs';
import { CardThumb, OpenTab, PreviewShell, SHORT_BAR, StatusChip } from './parts';
import type { LaunchPadDeps } from './types';

const TITLE: Record<string, string> = {
  'ok': 'Your mana looks right',
  'slightly-low': 'Your mana is a little light',
  'low': 'Your mana is light',
  'critically-low': 'Your deck is short on lands',
  'high': 'You\'re running heavy on lands',
};

export const MANA_META: Record<string, string> = {
  'ok': 'Looks right',
  'slightly-low': 'A little light',
  'low': 'Light',
  'critically-low': 'Short on lands',
  'high': 'Heavy',
};

const pct = (p: number) => Math.round(p * 100);

/** Hands with 0–1 lands at or above this share get flagged: roughly one opener in seven. */
const BAD_HANDS_WARN = 0.15;
/** A third of the lands entering tapped is where it starts to cost tempo. */
const TAPLAND_WARN = 0.33;

/** A reading's icon on its own small tile. The tint names the thing, not its state: warnings live in
 *  the number and the border. */
function IconTile({ tint, children }: { tint: string; children: ReactNode }) {
  return (
    <span className={cn('grid h-6 w-6 shrink-0 place-items-center rounded-md', tint)} aria-hidden="true">
      {children}
    </span>
  );
}

const WUBRG = ['W', 'U', 'B', 'R', 'G'];

/** The deck's colours as Mana Font's colour-identity pie, e.g. a blue-black half-and-half. */
function ColourPie({ colours }: { colours: string[] }) {
  const key = WUBRG.filter(c => colours.includes(c)).join('').toLowerCase();
  return <i className={`ms ms-ci ms-ci-${colours.length} ms-ci-${key} text-[15px]`} aria-hidden="true" />;
}

// Mana colours for the rings, tuned for the dark ground (checked with the dataviz palette validator:
// in-band lightness, chroma floor, neighbours apart). Red and green stay close for deutan vision, so
// each colour also wears its mana symbol in the table, and the rings keep a gap between segments.
const MANA_HEX: Record<string, string> = { W: '#ad8d24', U: '#3b87d0', B: '#a46a9c', R: '#d9572f', G: '#2f9e5f' };
/** A colour is short when its share of sources trails its share of pips by this much. Closer than
 *  that is ordinary variance, and flagging the lower of two balanced colours was a false alarm. */
const SHORT_BY = 0.08;
const RING_R = { outer: 42, inner: 29 };
const RING_W = 10;
const SEG_GAP = 2; // px of ground between segments

type RingKey = 'outer' | 'inner';
/** What the pointer is on: a colour, and the ring when it's on an arc (null from a table row). */
type Focus = { c: string; ring: RingKey | null } | null;

/** One ring: each colour's share as an arc, in WUBRG order from twelve o'clock. */
function Ring({ ring, parts, focus, hatch, onFocus }: {
  ring: RingKey;
  parts: { c: string; share: number }[];
  focus: Focus;
  /** Colours drawn hatched: short for their pips. */
  hatch?: Set<string>;
  onFocus: (f: Focus) => void;
}) {
  const r = RING_R[ring];
  const circ = 2 * Math.PI * r;
  let at = 0;
  // Pointing at one ring steps the other back, so it's plain which ring the readout is about.
  const otherRing = focus?.ring != null && focus.ring !== ring;
  return (
    <>
      {parts.map(({ c, share }) => {
        const from = at;
        at += share;
        const len = Math.max(0, share * circ - (parts.length > 1 ? SEG_GAP : 0));
        const dim = focus != null && (focus.c !== c || otherRing);
        return (
          <circle
            key={c}
            cx="50" cy="50" r={r} fill="none"
            stroke={hatch?.has(c) ? `url(#mana-hatch-${c})` : MANA_HEX[c]}
            strokeWidth={RING_W}
            strokeDasharray={`${len} ${circ}`}
            strokeDashoffset={-from * circ}
            transform="rotate(-90 50 50)"
            pointerEvents="stroke"
            onPointerEnter={() => onFocus({ c, ring })}
            onPointerLeave={() => onFocus(null)}
            className="cursor-default transition-opacity duration-200"
            opacity={dim ? 0.25 : 1}
          />
        );
      })}
    </>
  );
}

const NAME: Record<string, string> = { W: 'White', U: 'Blue', B: 'Black', R: 'Red', G: 'Green' };

/**
 * Where the colours come from against where they're spent: the outer ring is the spells' pips, the
 * inner ring the sources that make them. Rings that line up mean a balanced mana base; a short inner
 * arc is a colour the lands skimp on. Pointing at an arc says which ring it is and what it counts;
 * the table under the rings carries the exact figures.
 */
function ColourSources({ colours, sources, pips, className }: {
  colours: string[];
  sources: Record<string, number>;
  pips: Record<string, number>;
  className?: string;
}) {
  const [focus, setFocus] = useState<Focus>(null);
  const ordered = WUBRG.filter(c => colours.includes(c));
  const srcTotal = ordered.reduce((t, c) => t + (sources[c] ?? 0), 0);
  const pipTotal = ordered.reduce((t, c) => t + (pips[c] ?? 0), 0);
  const rows = ordered.map(c => {
    const pip = pipTotal > 0 ? (pips[c] ?? 0) / pipTotal : 0;
    const src = srcTotal > 0 ? (sources[c] ?? 0) / srcTotal : 0;
    return { c, pip, src, count: sources[c] ?? 0, pipCount: pips[c] ?? 0, short: pip - src >= SHORT_BY };
  });
  const short = rows.filter(r => r.short);
  const pctOf = (x: number) => `${Math.round(x * 100)}%`;
  const row = focus ? rows.find(r => r.c === focus.c) : undefined;
  const symbol = (c: string) => <i className={`ms ms-${c.toLowerCase()} ms-cost align-[-2px] text-[13px]`} aria-hidden="true" />;

  // The line under the rings: which ring is which, or what the pointer is on.
  const readout = !row
    ? <><span className="text-foreground/80">Outer</span> pips · <span className="text-foreground/80">Inner</span> sources</>
    : focus!.ring === 'outer'
      ? <>{symbol(row.c)} <span className="text-foreground/90">{NAME[row.c]} pips</span> {pctOf(row.pip)}</>
      : focus!.ring === 'inner'
        ? <>{symbol(row.c)} <span className="text-foreground/90">{NAME[row.c]} sources</span> {pctOf(row.src)}</>
        : <>{symbol(row.c)} <span className="text-foreground/90">{NAME[row.c]}</span> {pctOf(row.pip)} pips · {pctOf(row.src)} sources</>;

  return (
    <div className={cn('flex min-w-0 flex-col gap-2 rounded-lg border bg-background/80 px-3.5 py-3', short.length ? 'border-amber-400/40' : 'border-border/60', className)}>
      <span className="flex items-center gap-2 text-[12px] font-medium text-muted-foreground">
        <IconTile tint="bg-muted/50"><ColourPie colours={colours} /></IconTile>
        Colour sources
      </span>
      <div className="flex flex-col items-center gap-1.5">
        <svg viewBox="0 0 100 100" className="h-28 w-28" role="img"
          aria-label={rows.map(r => `${NAME[r.c]}: ${pctOf(r.pip)} of pips, ${pctOf(r.src)} of sources`).join('; ')}>
          <defs>
            {ordered.map(c => (
              <pattern key={c} id={`mana-hatch-${c}`} width="3" height="3" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <rect width="3" height="3" fill={`${MANA_HEX[c]}55`} />
                <rect width="1.5" height="3" fill={MANA_HEX[c]} />
              </pattern>
            ))}
          </defs>
          <circle cx="50" cy="50" r={RING_R.outer} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={RING_W} />
          <circle cx="50" cy="50" r={RING_R.inner} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={RING_W} />
          <Ring ring="outer" parts={rows.map(r => ({ c: r.c, share: r.pip }))} focus={focus} onFocus={setFocus} />
          <Ring ring="inner" parts={rows.map(r => ({ c: r.c, share: r.src }))} focus={focus} onFocus={setFocus} hatch={new Set(short.map(r => r.c))} />
        </svg>
        {/* One line that never wraps, so pointing at an arc doesn't push the table down. */}
        <span className="block h-[18px] max-w-full truncate whitespace-nowrap text-center text-[11.5px] leading-[18px] tabular-nums text-muted-foreground" aria-live="polite">
          {readout}
        </span>
      </div>

      {/* The figures, one row per colour; pointing at a row picks its arcs out of both rings. */}
      <table className="w-full text-[12.5px] tabular-nums">
        <thead>
          <tr className="text-[11px] text-muted-foreground">
            <th className="pb-1 text-left font-medium"><span className="sr-only">Colour</span></th>
            <th className={cn('pb-1 text-right font-medium transition-colors', focus?.ring === 'outer' && 'text-foreground')}>Pips</th>
            <th className={cn('pb-1 pl-3 text-right font-medium transition-colors', focus?.ring === 'inner' && 'text-foreground')}>Sources</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr
              key={r.c}
              onPointerEnter={() => setFocus({ c: r.c, ring: null })}
              onPointerLeave={() => setFocus(null)}
              className={cn('transition-opacity duration-200', focus && focus.c !== r.c && 'opacity-45')}
            >
              <td className="py-0.5">
                <span className="flex items-center gap-1.5 text-foreground/90">{symbol(r.c)}{NAME[r.c]}</span>
              </td>
              <td className="py-0.5 text-right text-foreground/85">{pctOf(r.pip)}</td>
              <td className={cn('py-0.5 pl-3 text-right', r.short ? 'font-semibold text-amber-300' : 'text-foreground/85')}>
                {pctOf(r.src)} <span className={r.short ? 'text-amber-300/80' : 'text-muted-foreground'}>({r.count})</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {/* Only a colour that's short earns a sentence; balanced rings and the table say the rest. */}
      {short.length > 0 && (
        <span className="text-[12px] leading-snug text-amber-300">
          {short.map(r => NAME[r.c]).join(' and ')} {short.length === 1 ? 'is' : 'are'} short for {short.length === 1 ? 'its' : 'their'} pips.
        </span>
      )}
    </div>
  );
}

/** One reading: what it measures, the number, a picture of it, and what the number means. */
function Reading({ icon, label, value, unit, warn, children, note, className }: {
  className?: string;
  icon: ReactNode;
  label: string;
  value: ReactNode;
  unit?: ReactNode;
  warn?: boolean;
  children?: ReactNode;
  note: ReactNode;
}) {
  return (
    <div className={cn(
      'flex min-w-0 flex-col gap-2 rounded-lg border bg-background/80 px-3.5 py-3',
      warn ? 'border-amber-400/40' : 'border-border/60',
      className,
    )}>
      <span className="flex items-center gap-2 text-[12px] font-medium text-muted-foreground">
        {icon}
        {label}
      </span>
      <span className="flex items-baseline gap-1.5">
        <span className={cn('text-2xl font-semibold leading-none tabular-nums', warn ? 'text-amber-300' : 'text-foreground')}>{value}</span>
        {unit && <span className="text-[12px] text-muted-foreground">{unit}</span>}
      </span>
      {children}
      <span className="text-[12px] leading-snug text-muted-foreground">{note}</span>
    </div>
  );
}

export function ManaPreview({ d }: { d: LaunchPadDeps }) {
  const mb = d.analysis.manaBase;
  const ok = mb.verdict === 'ok';
  const fixing = d.analysis.colorFixing;
  // Card Fit's land picks (flex lands, fixing): the slots, not the count, once the count is right.
  const landPick = (d.baseSwaps?.additions ?? []).find(a => (a.primaryType ?? '').toLowerCase().includes('land'));

  const over = mb.currentLands - mb.adjustedSuggestion;
  const landScale = Math.max(1, mb.currentLands, mb.adjustedSuggestion);
  const badHands = mb.probLand0 + mb.probLand1;
  const badWarn = badHands >= BAD_HANDS_WARN;
  const tapWarn = mb.taplandRatio >= TAPLAND_WARN;

  const colours = fixing && fixing.colorsNeeded.length >= 2 ? fixing.colorsNeeded : [];

  return (
    <PreviewShell tab="lands"
      title={TITLE[mb.verdict] ?? 'Your mana base'}
      sub={`Against the average ${d.reasonCtx.commanderShort} deck, adjusted for your curve and ramp.`}
      aside={<StatusChip tone={ok ? 'good' : 'warn'}>{ok && <Check className="w-3.5 h-3.5" />}{ok ? 'On target' : MANA_META[mb.verdict]}</StatusChip>}
      actions={<OpenTab tab="lands" label="Mana" onClick={() => d.onNavigate('lands')} />}
    >
      {/* A bento: with colours to balance, their tile takes the right column at full height and the
          three readings share the left two, Ramp running under Lands and Opening hands. */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <Reading
          icon={<IconTile tint="bg-violet-500/15 text-violet-300"><i className="ms ms-land text-[13px] leading-none" /></IconTile>}
          label="Lands"
          value={mb.currentLands}
          unit={`of ${mb.adjustedSuggestion} suggested`}
          warn={!ok}
          note={over > 0 ? `${over} over: room for a spell if you want it.`
            : over < 0 ? `${-over} short of what this curve wants.`
              : 'Right on the suggestion.'}
        >
          <div className="relative h-2 rounded-full bg-muted/70" aria-hidden="true">
            <div className={cn('absolute inset-y-0 left-0 rounded-full', ok ? 'bg-violet-400/70' : SHORT_BAR)}
              style={{ width: `${(mb.currentLands / landScale) * 100}%` }} />
            <div className="absolute -top-1 -bottom-1 w-0.5 -ml-px rounded-full bg-foreground/85" style={{ left: `${(mb.adjustedSuggestion / landScale) * 100}%` }} />
          </div>
        </Reading>

        <Reading
          icon={<IconTile tint="bg-sky-500/15 text-sky-300"><Hand className="h-3.5 w-3.5" /></IconTile>}
          label="Opening hands"
          value={`${pct(mb.probLand2to3)}%`}
          unit="open on 2–3 lands"
          warn={badWarn}
          note={<>
            <span className={cn('font-semibold tabular-nums', badWarn ? 'text-amber-300' : 'text-foreground/90')}>{pct(badHands)}%</span> on 0–1, the hands you'd mulligan.
          </>}
        >
          {/* The seven-card split: too few, the keepable middle, flooding. */}
          <div className="flex h-2 gap-px overflow-hidden rounded-full" role="img"
            aria-label={`${pct(badHands)}% of hands have 0 to 1 lands, ${pct(mb.probLand2to3)}% have 2 to 3, ${pct(mb.probLand4plus)}% have 4 or more`}>
            <div className="bg-amber-400/80" style={{ width: `${badHands * 100}%` }} />
            <div className="bg-violet-400/80" style={{ width: `${mb.probLand2to3 * 100}%` }} />
            <div className="bg-muted-foreground/40" style={{ width: `${mb.probLand4plus * 100}%` }} />
          </div>
        </Reading>

        {colours.length > 0 && (
          <ColourSources
            colours={colours}
            sources={fixing!.sourcesPerColor}
            pips={fixing!.pipDemand}
            className="sm:col-start-3 sm:row-span-2 sm:row-start-1"
          />
        )}

        <Reading
          className={colours.length > 0 ? 'sm:col-span-2' : undefined}
          icon={<IconTile tint="bg-emerald-500/15 text-emerald-400"><Sprout className="h-3.5 w-3.5" /></IconTile>}
          label="Ramp"
          value={mb.rampCount}
          unit="cards"
          note={<>
            {mb.manaProducerCount} rocks and dorks.{' '}
            {mb.taplandCount > 0
              ? <span className={cn(tapWarn && 'font-semibold text-amber-300')}>{mb.taplandCount} land{mb.taplandCount === 1 ? '' : 's'} enter tapped.</span>
              : 'Every land enters untapped.'}
          </>}
        />
      </div>

      {landPick && (
        <div className="flex items-center gap-3 rounded-lg border border-violet-400/30 bg-background/80 px-3 py-2.5">
          <CardThumb name={landPick.name} src={landPick.imageUrl} onPreview={d.onPreviewCard} />
          <div className="flex min-w-0 flex-col">
            <span className="text-[12px] text-muted-foreground">Card Fit's land pick</span>
            <span className="truncate text-[13px] font-semibold text-violet-200">{landPick.name}</span>
            <span className="text-[12px] leading-snug text-muted-foreground">{addReason(landPick, d.reasonCtx)}</span>
          </div>
        </div>
      )}
    </PreviewShell>
  );
}
