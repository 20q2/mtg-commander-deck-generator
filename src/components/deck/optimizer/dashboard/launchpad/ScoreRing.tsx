// src/components/deck/optimizer/dashboard/launchpad/ScoreRing.tsx
//
// The hero's score ring, carrying the path to 100. Solid is earned: the score arc. Striped is still
// missing: the gap, split by area in each area's colour. Each area's arc opens the job that works on
// it. What the swaps on screen would win back is said in words beside the ring, not drawn on it.
import type { CSSProperties, ReactNode, SVGProps } from 'react';
import { Portal as TooltipPortal } from '@radix-ui/react-tooltip';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import type { SubScoreKey } from '@/types';
import type { PointsToGain } from '@/services/deckBuilder/planScore';
import { AREA_META, AREA_ORDER, WELL_TUNED_AT } from './PathTo100';

/** What the launch pad hands the ring. Absent, the ring is a plain score arc. */
export interface RingWiring {
  gains: PointsToGain[];
  activeAreas: SubScoreKey[];
  onSelectArea: (area: SubScoreKey) => void;
}

const R = 44;
const STROKE = 10;
const C = 2 * Math.PI * R;
const GAP = 0.9; // units of arc left between areas

/** One arc from `from`% to `to`% of the way round, starting at twelve o'clock. */
function Arc({ from, to, stroke, opacity = 1, gap = 0, children, ...rest }: {
  from: number;
  to: number;
  stroke: string;
  opacity?: number;
  gap?: number;
  children?: ReactNode;
} & SVGProps<SVGCircleElement>) {
  const len = Math.max(0, ((to - from) / 100) * C - gap);
  return (
    <circle
      cx="50" cy="50" r={R} fill="none" stroke={stroke} strokeWidth={STROKE}
      strokeDasharray={`${len} ${C}`} strokeDashoffset={-(from / 100) * C}
      transform="rotate(-90 50 50)" opacity={opacity}
      {...rest}
    >
      {children}
    </circle>
  );
}

const stripes = (hex: string): CSSProperties => ({
  backgroundColor: `${hex}38`,
  backgroundImage: `repeating-linear-gradient(45deg, ${hex} 0 2px, transparent 2px 4px)`,
});

/**
 * Says what one stretch of the ring is. Portalled: the content is HTML and the trigger sits inside
 * the SVG. Opens on the side of the ring the arc is on, so it never covers the number.
 */
function ArcTip({ mid, swatch, title, children, tip }: {
  /** The arc's midpoint, in % of the way round. */
  mid: number;
  swatch: CSSProperties;
  title: ReactNode;
  tip: ReactNode;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipPortal>
        <TooltipContent
          side={mid < 50 ? 'right' : 'left'}
          sideOffset={8}
          className="max-w-64 border border-border/70 bg-popover px-3 py-2 text-popover-foreground shadow-[0_8px_24px_-8px_rgb(0_0_0/0.6)]"
        >
          <div className="flex items-center gap-2 text-[13px] font-semibold text-foreground">
            <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={swatch} aria-hidden="true" />
            {title}
          </div>
          <p className="mt-1 text-xs leading-snug text-muted-foreground">{tip}</p>
        </TooltipContent>
      </TooltipPortal>
    </Tooltip>
  );
}

export function ScoreRing({ score, displayed, ring, children }: {
  score: number;
  /** The counting-up value while the ring animates in. */
  displayed: number;
  ring?: RingWiring;
  /** The centre: number and band label. */
  children: ReactNode;
}) {
  const pointsOf = (k: SubScoreKey) => ring?.gains.find(g => g.key === k)?.points ?? 0;
  const focus = (ring?.activeAreas.length ?? 0) > 0;

  let at = score;
  // A well-tuned deck's last few points are plain track: no coloured stretch inviting a race to 100.
  const segs = ring && score < WELL_TUNED_AT
    ? AREA_ORDER.filter(k => pointsOf(k) > 0).map(k => {
      const from = at;
      at += pointsOf(k);
      return { k, from, to: at, pts: pointsOf(k) };
    })
    : [];

  return (
    <div
      className="relative w-24 h-24 sm:w-40 sm:h-40 shrink-0"
      role="img"
      aria-label={`Plan score ${score} out of 100`}
    >
      <TooltipProvider delayDuration={120} skipDelayDuration={300}>
      <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full overflow-visible outline-none">
        <defs>
          {AREA_ORDER.map(k => (
            <pattern key={k} id={`score-ring-stripe-${k}`} width="3" height="3" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="1.6" height="3" fill={AREA_META[k].hex} />
            </pattern>
          ))}
        </defs>
        <Arc from={0} to={100} stroke="rgba(255,255,255,0.14)" />
        {ring ? (
          <ArcTip
            mid={score / 2}
            swatch={{ backgroundColor: 'hsl(var(--primary))' }}
            title={<>Your score <span className="tabular-nums">{score}</span></>}
            tip="The points this deck already earns, out of 100."
          >
            <g className="outline-none"><Arc from={0} to={displayed} stroke="hsl(var(--primary))" pointerEvents="stroke" /></g>
          </ArcTip>
        ) : (
          <Arc from={0} to={displayed} stroke="hsl(var(--primary))" />
        )}
        {segs.map(({ k, from, to, pts }) => {
          const meta = AREA_META[k];
          const opacity = !focus ? 0.95 : ring!.activeAreas.includes(k) ? 1 : 0.35;
          return (
            <ArcTip
              key={k}
              mid={(from + to) / 2}
              swatch={stripes(meta.hex)}
              title={<>{meta.label} <span className={`tabular-nums ${meta.text}`}>+{pts}</span></>}
              tip={<>{meta.blurb.charAt(0).toUpperCase()}{meta.blurb.slice(1)}. Click to work on it.</>}
            >
              <g
                role="button"
                tabIndex={-1}
                aria-label={`${meta.label}: ${pts} points to gain`}
                onClick={() => ring!.onSelectArea(k)}
                style={{ opacity }}
                className="cursor-pointer outline-none transition-opacity duration-300 hover:!opacity-100"
              >
                {/* A faint wash under the stripes keeps a one-point slice readable as a slice. */}
                <Arc from={from} to={to} stroke={meta.hex} strokeOpacity={0.22} gap={GAP} pointerEvents="stroke" />
                <Arc from={from} to={to} stroke={`url(#score-ring-stripe-${k})`} gap={GAP} pointerEvents="stroke" />
              </g>
            </ArcTip>
          );
        })}
      </svg>
      </TooltipProvider>
      <div className="absolute inset-[11%] rounded-full bg-card flex flex-col items-center justify-center">
        {children}
      </div>
    </div>
  );
}
