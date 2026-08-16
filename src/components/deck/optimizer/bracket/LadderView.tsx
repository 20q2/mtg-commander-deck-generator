import { useState } from 'react';
import type { BracketViewModel } from './bracketViewModel';
import { CardPill } from './CardTile';

const MOVE_STYLES = {
  up:   { wrap: 'bg-amber-500/10 border-amber-500/30', title: 'text-amber-400', body: 'text-amber-200/70' },
  jump: { wrap: 'bg-rose-500/10 border-rose-500/30',   title: 'text-rose-400',  body: 'text-rose-200/70' },
} as const;

/**
 * Design 1c — ladder view.
 * Puts the deck on the 1–5 scale first, then walks the reading in order
 * and says exactly what would move it in either direction.
 */
export function LadderView({ vm, onPreview }: { vm: BracketViewModel; onPreview: (name: string) => void }) {
  const [showMath, setShowMath] = useState(false);

  return (
    <div className="rounded-xl border border-border/30 bg-card/60 overflow-hidden">

      {/* ── Headline ── */}
      <div className="px-6 pt-6">
        <div className="flex items-end justify-between gap-6 flex-wrap">
          <div>
            <p className="text-[10.5px] font-mono font-medium tracking-[0.16em] text-muted-foreground">
              ESTIMATED BRACKET
            </p>
            <div className="flex items-baseline gap-3.5 mt-1.5 flex-wrap">
              <span className={`${vm.isRange ? 'text-[48px]' : 'text-[68px]'} leading-[0.9] font-bold text-foreground`}>
                {vm.bracketDisplay}
              </span>
              <span className={`${vm.isRange ? 'text-[22px]' : 'text-[30px]'} font-semibold ${vm.colors.text}`}>
                {vm.label}
              </span>
            </div>
          </div>
          <p className="text-[12.5px] leading-relaxed text-muted-foreground max-w-[42ch] sm:text-right">
            {vm.headline}
          </p>
        </div>
      </div>

      {/* ── The 1–5 ladder ── */}
      <div className="px-6 pt-6 pb-1.5">
        <div className="grid grid-cols-5 gap-1.5">
          {vm.ladder.map(l => (
            <div
              key={l.n}
              className={`border-t-[3px] pt-2.5 px-0.5 ${l.active ? '' : 'border-t-border/50 opacity-50'}`}
              style={l.active ? { borderTopColor: vm.accent } : undefined}
            >
              <div className="flex items-baseline gap-1.5 flex-wrap">
                <span
                  className={`text-[17px] font-bold ${l.active ? '' : 'text-muted-foreground/60'}`}
                  style={l.active ? { color: vm.accent } : undefined}
                >
                  {l.n}
                </span>
                <span className={`text-[12.5px] font-semibold ${l.active ? 'text-foreground' : 'text-muted-foreground'}`}>
                  {l.name}
                </span>
              </div>
              <p className="text-[11.5px] leading-snug text-muted-foreground/70 mt-1">{l.desc}</p>
            </div>
          ))}
        </div>
        <div className="relative h-[30px] mt-2">
          <div
            className="absolute top-0 flex justify-center"
            style={{
              left: `${(vm.bracket - 1) * 20}%`,
              width: `${(vm.bracketMax - vm.bracket + 1) * 20}%`,
            }}
          >
            <span className={`text-[10.5px] font-mono font-semibold px-2.5 py-1 rounded-full ${vm.colors.bg} ${vm.colors.text}`}>
              YOUR DECK
            </span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr,320px] border-t border-border/30">

        {/* ── The reading, in order ── */}
        <div className="p-6 pt-5 border-b lg:border-b-0 lg:border-r border-border/30">
          <p className="text-[10.5px] font-mono font-semibold tracking-[0.14em] text-muted-foreground/80">
            THE READING, IN ORDER
          </p>
          <div className="mt-3.5">
            {vm.steps.map((s, i) => (
              <div key={s.n} className="grid grid-cols-[26px,1fr] gap-3.5">
                <div className="flex flex-col items-center">
                  <span className={`w-[26px] h-[26px] rounded-full border flex items-center justify-center text-[11.5px] font-mono font-semibold ${
                    i === 0 ? `${vm.colors.border} ${vm.colors.bg} ${vm.colors.text}` : 'border-border/50 bg-accent/30 text-foreground/70'
                  }`}>
                    {s.n}
                  </span>
                  {i < vm.steps.length - 1 && <span className="flex-1 w-px bg-border/50" />}
                </div>
                <div className="pb-5">
                  <p className="text-[13.5px] font-semibold text-foreground">{s.title}</p>
                  <p className="text-[12.5px] leading-relaxed text-muted-foreground mt-1 max-w-[62ch]">{s.body}</p>
                  {s.chips.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-2.5">
                      {s.chips.map(n => <CardPill key={n} name={n} onPreview={onPreview} />)}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ── What would move it ── */}
        <div className="p-5 pt-5">
          <p className="text-[10.5px] font-mono font-semibold tracking-[0.14em] text-muted-foreground/80">
            WHAT WOULD MOVE IT
          </p>
          <div className="space-y-2 mt-3.5">
            {vm.nextMoves.length === 0 && (
              <p className="text-xs leading-relaxed text-muted-foreground">
                Nothing left to climb — this is the top of the scale.
              </p>
            )}
            {vm.nextMoves.map(m => {
              const s = MOVE_STYLES[m.tone];
              return (
                <div key={m.label} className={`p-3.5 rounded-lg border ${s.wrap}`}>
                  <p className={`text-[12.5px] font-semibold ${s.title}`}>{m.label}</p>
                  <p className={`text-xs leading-relaxed mt-1.5 ${s.body}`}>{m.body}</p>
                </div>
              );
            })}
          </div>

          <div className="mt-5 pt-4 border-t border-border/30">
            <div className="flex items-baseline justify-between">
              <span className="text-[10.5px] font-mono font-semibold tracking-[0.14em] text-muted-foreground/80">
                SOFT SCORE
              </span>
              <span className="text-[15px] font-semibold text-foreground/80 tabular-nums">
                {vm.softScore}<span className="text-[11px] text-muted-foreground">/100</span>
              </span>
            </div>
            <div className="space-y-2 mt-3">
              {vm.criteria.map(c => (
                <div key={c.key}>
                  <div className="flex justify-between text-[11.5px] font-medium text-foreground/75">
                    <span>{c.name}</span>
                    <span className="font-mono text-muted-foreground tabular-nums">{c.score} / {c.max}</span>
                  </div>
                  <div className="h-1 rounded-full bg-accent/40 mt-1.5 overflow-hidden">
                    <div className="h-full" style={{ width: `${c.pct}%`, backgroundColor: c.color }} />
                  </div>
                </div>
              ))}
            </div>

            <button
              onClick={() => setShowMath(m => !m)}
              className="mt-3.5 text-[11.5px] font-medium text-sky-400 hover:text-sky-300 transition-colors"
            >
              {showMath ? 'Hide the math' : 'Show the math'}
            </button>
            {showMath && (
              <div className="mt-2.5 rounded-lg border border-border/30 bg-background/40 p-3">
                {vm.mathLines.map((line, i) => (
                  <p
                    key={line}
                    className={`text-[11.5px] leading-relaxed font-mono ${
                      i === vm.mathLines.length - 1 ? 'text-foreground/80' : 'text-muted-foreground'
                    }`}
                  >
                    {line}
                  </p>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
