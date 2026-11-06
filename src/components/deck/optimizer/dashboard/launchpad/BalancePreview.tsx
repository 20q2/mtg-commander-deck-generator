// src/components/deck/optimizer/dashboard/launchpad/BalancePreview.tsx
import { Line, LineChart, ReferenceArea, ResponsiveContainer, XAxis, YAxis } from 'recharts';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { SubScoreKey } from '@/types';
import type { CurvePhaseAnalysis, CurveSlot } from '@/services/deckBuilder/deckAnalyzer';
import type { Pacing } from '@/services/deckBuilder/themeDetector';
import { ROLE_META } from '../../constants';
import { pacedCurveSlots } from '../../CurveTab';
import { CardThumb, OpenTab, PointsChip, PreviewShell, SectionTitle, SHORT_BAR, StatusChip } from './parts';
import type { LaunchPadDeps } from './types';
import { RoleCardsDoor } from './doors';

const cmcRange = ([lo, hi]: [number, number]) => (hi >= 7 ? `${lo}+` : lo === hi ? `${lo}` : `${lo}–${hi}`);

/** "+3 pts" while the area has points to win back; "All good" once it has none and nothing is short. */
function AreaChip({ points, short }: { points: number; short: boolean }) {
  if (points > 0) return <PointsChip points={points} />;
  if (short) return null;
  return <StatusChip tone="good"><Check className="w-3 h-3" aria-hidden="true" /> All good</StatusChip>;
}

/**
 * The Tempo tab's curve, cut down: your deck against the expected line, same colours, with the light
 * phase shaded. No axes to read, no toggles.
 */
function MiniCurve({ curve, pacing, light }: { curve: CurveSlot[]; pacing?: Pacing; light?: CurvePhaseAnalysis }) {
  const data = pacedCurveSlots(curve, pacing);
  if (data.length < 2) return null;
  const lo = data[0].cmc;
  const hi = data[data.length - 1].cmc;
  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-border/60 bg-background/80 px-3.5 pb-2 pt-3">
      <div className="flex items-center justify-end gap-3 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-4 rounded bg-sky-500" aria-hidden="true" /> your deck
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-4 border-t-2 border-dashed border-amber-500/60" aria-hidden="true" /> expected
        </span>
      </div>
      <div
        className="h-20"
        role="img"
        aria-label={`Mana curve by mana value${light ? `. ${light.label} at ${cmcRange(light.cmcRange)} mana: ${light.current} cards, ${light.target} expected` : ''}`}
      >
        <ResponsiveContainer width="100%" height="100%" debounce={1}>
          {/* No accessibility layer: it makes the svg focusable (a focus ring on every click), and the
              wrapper's role="img" label already carries what the chart says. */}
          <LineChart data={data} margin={{ top: 4, right: 6, bottom: 0, left: 6 }} accessibilityLayer={false}>
            <XAxis
              dataKey="cmc" type="number" domain={[lo - 0.5, hi + 0.5]} ticks={data.map(s => s.cmc)}
              tickFormatter={(v: number) => (v >= 7 ? '7+' : String(v))}
              tick={{ fontSize: 10, fill: 'hsl(220,13%,55%)' }} axisLine={false} tickLine={false} height={16}
            />
            <YAxis hide domain={[0, 'dataMax']} />
            {light && (
              <ReferenceArea
                x1={light.cmcRange[0] - 0.5} x2={Math.min(light.cmcRange[1], hi) + 0.5}
                fill="rgba(251,191,36,0.10)" stroke="rgba(251,191,36,0.25)" strokeDasharray="3 3"
              />
            )}
            <Line type="monotone" dataKey="target" stroke="rgba(245,158,11,0.6)" strokeWidth={1.5} strokeDasharray="6 4" dot={false} isAnimationActive={false} />
            <Line type="monotone" dataKey="current" stroke="#0ea5e9" strokeWidth={2} dot={{ r: 2.5, fill: '#38bdf8', strokeWidth: 0 }} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export function BalancePreview({ d }: { d: LaunchPadDeps }) {
  const roles = d.analysis.roleBreakdowns ?? [];
  const phases = d.analysis.curvePhases ?? [];
  const pointsOf = (k: SubScoreKey) => d.gains.find(g => g.key === k)?.points ?? 0;

  // Worst shortfall by ratio — the same "weakest" the Roles tile used to name.
  const short = roles
    .filter(r => r.target > 0 && r.current < r.target)
    .sort((a, b) => a.current / a.target - b.current / b.target)[0];
  const lightPhase = phases
    .filter(p => p.target > 0 && p.current < p.target)
    .sort((a, b) => a.current / a.target - b.current / b.target)[0];

  // Two sections, each titled for what sits under it: one headline for both read as a curve verdict
  // sitting over a list of roles.
  const title = short
    ? `You're ${short.target - short.current} ${short.label.toLowerCase()} short`
    : 'Ramp, removal and draw are all on target';
  const curveTitle = lightPhase
    ? `Your ${lightPhase.label.toLowerCase()} is looking a little light`
    : 'Your curve is on target';
  const curveSub = lightPhase
    ? `${lightPhase.current} card${lightPhase.current === 1 ? '' : 's'} at ${cmcRange(lightPhase.cmcRange)} mana. The average ${d.reasonCtx.commanderShort} deck runs ${lightPhase.target}.`
    : `Shaped like the average ${d.reasonCtx.commanderShort} deck's curve.`;

  // One scale for every bar so a long bar means more cards, not "closer to its own target". The
  // biggest count or target on the panel runs the full width.
  const max = Math.max(1, ...roles.map(r => Math.max(r.current, r.target)));
  const fixes = short?.suggestedReplacements.slice(0, 2).map(r => r.name) ?? [];

  return (
    <PreviewShell
      tab="roles"
      title={title}
      sub={`Minimums from the average ${d.reasonCtx.targetsBracket ? `Bracket ${d.reasonCtx.targetsBracket} ` : ''}${d.reasonCtx.commanderShort} deck.`}
      aside={<AreaChip points={pointsOf('roles')} short={!!short} />}
      footNote="Roles and curve"
      actions={<>
        <OpenTab tab="roles" label="Roles" onClick={() => d.onNavigate('roles')} />
        <OpenTab tab="curve" label="Tempo" onClick={() => d.onNavigate('curve')} />
      </>}
    >
      {/* The bars on solid ground, so nothing floats over the art; the fix closes the same box. */}
      <div className="rounded-lg border border-border/60 bg-background/80 px-3.5 py-3">
      <div className="flex flex-col gap-2.5">
        {roles.map(r => {
          const isShort = r.current < r.target;
          return (
            <div key={r.role} className="grid grid-cols-[96px_minmax(0,1fr)_56px] sm:grid-cols-[124px_minmax(0,1fr)_64px] items-center gap-2.5 text-[12.5px] text-foreground/85">
              {/* Same icon and colour as the Roles tab, so a row here is recognisable there. */}
              <span className="flex min-w-0 items-center gap-1.5">
                {(() => {
                  const meta = ROLE_META[r.role];
                  return meta ? <meta.icon className={cn('w-3.5 h-3.5 shrink-0', meta.color)} aria-hidden="true" /> : null;
                })()}
                <span className="truncate">{r.label}</span>
              </span>
              <div className="relative h-2 rounded-full bg-muted/70" aria-hidden="true">
                <div className={cn('absolute inset-y-0 left-0 rounded-full', isShort ? SHORT_BAR : 'bg-violet-400/70')}
                  style={{ width: `${(r.current / max) * 100}%` }} />
                <div className="absolute -top-1 -bottom-1 w-0.5 -ml-px rounded-full bg-foreground/85" style={{ left: `${(r.target / max) * 100}%` }} />
              </div>
              <span className={cn('text-right tabular-nums whitespace-nowrap', isShort ? 'font-semibold text-amber-300' : 'text-muted-foreground')}>
                <RoleCardsDoor label={`${r.current} of ${r.target}`} role={r.label} cards={r.cards} onPreview={d.onPreviewCard} />
              </span>
            </div>
          );
        })}
      </div>
      {fixes.length > 0 && short && (
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-border/40 pt-3 text-[12.5px]">
          <span className="text-muted-foreground">Fills the {short.label.toLowerCase()} gap</span>
          {fixes.map(name => (
            <span key={name} className="flex min-w-0 items-center gap-2">
              <CardThumb name={name} onPreview={d.onPreviewCard} size="sm" />
              <span className="truncate font-semibold text-violet-200">{name}</span>
            </span>
          ))}
        </div>
      )}
      </div>

      {d.analysis.curveAnalysis?.length > 0 && (
        <section aria-label="Tempo" className="mt-5 flex flex-col gap-2.5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="text-[15px] sm:text-[17px] font-semibold leading-snug text-foreground text-balance">
                <SectionTitle tab="curve">{curveTitle}</SectionTitle>
              </h3>
              <p className="mt-1 pl-6 text-[13px] text-muted-foreground max-w-prose tabular-nums">{curveSub}</p>
            </div>
            <div className="shrink-0"><AreaChip points={pointsOf('tempo')} short={!!lightPhase} /></div>
          </div>
          <MiniCurve curve={d.analysis.curveAnalysis} pacing={d.analysis.pacing} light={lightPhase} />
        </section>
      )}
    </PreviewShell>
  );
}
