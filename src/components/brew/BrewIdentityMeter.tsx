import { Lock } from 'lucide-react';
import { useStore } from '@/store';
import { topIdentity, type BrewContext, type BrewState } from '@/services/brew/engine';
import { StatPop } from './StatPop';
import { Radar, type RadarDatum } from '@/components/charts/Radar';

const VIOLET = '262 84% 72%';
const GOLD = '40 92% 60%';

/** Up to this many of the commander's themes become the identity radar's (fixed) axes. */
const IDENTITY_AXES = 5;
/** Affinity (above the shared baseline) at which a theme reads as a full pillar. ≈ a commit, or ~4 picks. */
const IDENTITY_SPREAD = 40;

/**
 * The commander's themes as radar axes (stable order, so they don't reshuffle each pick). A commander's
 * top themes share a big common core of staples, so raw affinity rises across all of them together —
 * normalizing to the leader would peg every axis near full. Instead we subtract the per-deck baseline
 * (the least-leaned axis) and scale to an absolute pillar level, so the shape stays small/round until
 * the deck genuinely leans some themes *more* than the shared core, then spikes toward them. The
 * committed theme wears gold.
 */
function identityRadarData(ctx: BrewContext, state: BrewState): RadarDatum[] {
  const slugs = Object.keys(ctx.themeNames).slice(0, IDENTITY_AXES);
  const vals = slugs.map(s => state.themeAffinity[s] ?? 0);
  const baseline = Math.min(...vals);
  return slugs.map((slug, i) => {
    const v = vals[i];
    const name = ctx.themeNames[slug];
    return {
      key: slug,
      label: name.length > 9 ? `${name.slice(0, 8)}…` : name,
      current: Math.round(v / 10),
      target: Math.max(1, Math.round(Math.max(...vals) / 10)),
      fill: Math.max(0, Math.min(1, (v - baseline) / IDENTITY_SPREAD)),
      hue: state.committedTheme === slug ? GOLD : VIOLET,
      glyph: null,
    };
  });
}

/**
 * The identity meter. Rail variant: a radar of the commander's themes that swells toward your
 * leanings (committed theme glows gold). Strip variant (narrow screens, where a radar can't fit a
 * thin row): compact bars with a "+N Theme" pop on each pick.
 */
export function BrewIdentityMeter({ variant = 'rail' }: { variant?: 'rail' | 'strip' }) {
  const { brewContext, brewState } = useStore();
  if (!brewContext || !brewState) return null;

  // ---- Rail: the radar ----
  if (variant === 'rail') {
    const data = identityRadarData(brewContext, brewState);
    if (data.length < 3) return null; // a radar needs ≥3 axes; commanders virtually always clear this
    const committed = !!brewState.committedTheme;
    return (
      <div className="flex flex-col gap-1">
        <div className="text-center text-[10px] uppercase tracking-[0.24em] text-muted-foreground/75">Identity</div>
        <Radar data={data} accent={committed ? GOLD : VIOLET} glow={committed} gradientId="radarIdentity" />
      </div>
    );
  }

  // ---- Strip: compact bars (narrow screens) ----
  const bars = topIdentity(brewContext, brewState, 3);
  if (bars.length === 0) return null;
  const max = Math.max(...bars.map(b => b.value), 1);
  return (
    <div className="flex items-center gap-3 overflow-x-auto rounded-xl border border-border/60 bg-card/60 backdrop-blur-sm px-3 py-2 text-[11px] min-[1560px]:hidden">
      <span className="shrink-0 uppercase tracking-[0.2em] text-muted-foreground/70">Identity</span>
      {bars.map(b => (
        <StatPop
          key={b.slug}
          value={b.value}
          format={d => `+${Math.round(d)} ${b.label}`}
          colorClass={b.committed ? 'text-amber-300' : 'text-violet-300'}
          className="shrink-0 items-center gap-1.5"
        >
          <span className={`inline-flex items-center gap-1 ${b.committed ? 'text-amber-200' : 'text-violet-200'}`}>
            {b.committed && <Lock className="w-3 h-3" />}{b.label}
          </span>
          <span className="relative h-1.5 w-12 overflow-hidden rounded-full bg-violet-500/15">
            <span
              className={`absolute inset-y-0 left-0 rounded-full ${b.committed ? 'bg-amber-400' : 'bg-gradient-to-r from-violet-500 to-violet-300'}`}
              style={{ width: `${Math.round((b.value / max) * 100)}%`, transition: 'width 320ms cubic-bezier(0.4,0,0.2,1)' }}
            />
          </span>
        </StatPop>
      ))}
    </div>
  );
}
