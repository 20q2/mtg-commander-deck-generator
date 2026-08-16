import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import type { BracketViewModel } from './bracketViewModel';
import { CardTile } from './CardTile';

const TONE_STYLES = {
  good: 'bg-emerald-400 text-emerald-950',
  warn: 'bg-amber-400 text-amber-950',
  neutral: 'bg-foreground/15 text-foreground',
} as const;

/**
 * Design 1a — verdict first.
 * The bracket and a plain-English reason for it lead; the scoring
 * criteria fold away underneath for anyone who wants the arithmetic.
 */
export function VerdictFirstView({ vm, onPreview }: { vm: BracketViewModel; onPreview: (name: string) => void }) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const toggle = (k: string) => setOpen(o => ({ ...o, [k]: !o[k] }));

  return (
    <div className="rounded-xl border border-border/30 bg-card/60 overflow-hidden">

      {/* ── Header strip ── */}
      <div className="flex items-center justify-between gap-3 px-5 py-3 border-b border-border/30 bg-background/40">
        <div className="flex items-center gap-2.5">
          <span className={`w-[7px] h-[7px] rounded-full ${vm.colors.dot}`} />
          <span className="text-[11.5px] font-semibold tracking-[0.14em] text-foreground/70 font-mono">
            BRACKET ESTIMATE
          </span>
        </div>
        <span className="text-xs text-muted-foreground">Estimate — worth talking over at Rule 0</span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr,300px]">

        {/* ── Verdict + reasons ── */}
        <div className="p-6 border-b lg:border-b-0 lg:border-r border-border/30">
          <div className="flex items-start gap-5">
            <div className={`shrink-0 w-[88px] h-[88px] rounded-2xl border ${vm.colors.border} ${vm.colors.bg} flex flex-col items-center justify-center`}>
              <span className={`${vm.isRange ? 'text-[30px]' : 'text-[44px]'} leading-none font-bold ${vm.colors.text}`}>
                {vm.bracketDisplay}
              </span>
              <span className={`text-[9px] font-mono tracking-[0.12em] mt-1 ${vm.colors.text} opacity-70`}>OF 5</span>
            </div>
            <div className="pt-0.5 min-w-0">
              <h3 className={`${vm.isRange ? 'text-[22px]' : 'text-[27px]'} leading-tight font-bold text-foreground`}>{vm.label}</h3>
              <p className="text-[15px] leading-relaxed text-foreground/70 mt-2 max-w-[46ch]">{vm.headline}</p>
              <div className="flex flex-wrap gap-2 mt-3">
                <span
                  title={vm.confidenceNote}
                  className={`px-2.5 py-1 rounded-md text-[11px] font-mono font-medium ${
                    vm.confidence === 'high' ? 'bg-emerald-500/15 text-emerald-400' : 'bg-amber-500/15 text-amber-400'
                  }`}
                >
                  {vm.confidence === 'high' ? 'HIGH CONFIDENCE' : 'MEDIUM CONFIDENCE'}
                </span>
                <span className="px-2.5 py-1 rounded-md text-[11px] font-mono bg-accent/40 text-muted-foreground">
                  FLOOR {vm.floor} · SOFT {vm.softScore}
                </span>
              </div>
            </div>
          </div>

          <div className="mt-6 space-y-2.5">
            <p className="text-[10.5px] font-mono font-semibold tracking-[0.14em] text-muted-foreground/80">
              WHY {vm.bracketLabel.toUpperCase()}
            </p>
            {vm.reasons.map(r => (
              <div key={r.key} className="flex gap-3 items-start p-3 rounded-lg bg-background/40 border border-border/30">
                <span className={`shrink-0 w-5 h-5 rounded-md flex items-center justify-center text-[12px] font-mono font-semibold ${TONE_STYLES[r.tone]}`}>
                  {r.mark}
                </span>
                <div className="min-w-0">
                  <p className="text-[13.5px] font-semibold leading-snug text-foreground">{r.title}</p>
                  <p className="text-[12.5px] leading-relaxed text-muted-foreground mt-1">{r.body}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ── Ladder rail ── */}
        <div className="p-5">
          <p className="text-[10.5px] font-mono font-semibold tracking-[0.14em] text-muted-foreground/80 mb-3">
            THE FIVE BRACKETS
          </p>
          <div className="space-y-1">
            {vm.ladder.map(l => (
              <div
                key={l.n}
                className={`flex gap-3 px-3 py-2 rounded-lg border ${
                  l.active ? `${vm.colors.bg} ${vm.colors.border}` : 'border-transparent'
                }`}
              >
                <span className={`shrink-0 text-[15px] font-bold leading-snug ${l.active ? vm.colors.text : 'text-muted-foreground/50'}`}>
                  {l.n}
                </span>
                <div>
                  <p className={`text-[12.5px] font-semibold leading-snug ${l.active ? 'text-foreground' : 'text-muted-foreground'}`}>
                    {l.name}
                  </p>
                  <p className="text-[11.5px] leading-snug text-muted-foreground/70 mt-0.5">{l.desc}</p>
                </div>
              </div>
            ))}
          </div>

          {vm.bumpTarget !== null && vm.pointsToBump > 0 && (
            <div className="mt-3.5 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30">
              <p className="text-xs font-semibold text-amber-400">
                {vm.pointsToBump} {vm.pointsToBump === 1 ? 'point' : 'points'} from Bracket {vm.floor >= 4 ? 5 : Math.min(vm.floor + 1, 4)}
              </p>
              <p className="text-[11.5px] leading-relaxed text-amber-200/70 mt-1">
                Soft score {vm.softScore}/100. At {vm.bumpTarget} the estimate bumps up one bracket.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* ── What we measured ── */}
      <div className="border-t border-border/30 p-5 pt-4">
        <div className="flex items-baseline justify-between gap-3 flex-wrap mb-3">
          <p className="text-[10.5px] font-mono font-semibold tracking-[0.14em] text-muted-foreground/80">
            WHAT WE MEASURED
          </p>
          <p className="text-xs text-muted-foreground">
            Soft score <span className="font-semibold text-foreground/80">{vm.softScore} / 100</span> — open a row for the rule and the cards behind it
          </p>
        </div>

        <div className="space-y-2">
          {vm.criteria.map(c => (
            <div key={c.key} className="rounded-lg border border-border/30 bg-background/40 overflow-hidden">
              <button
                onClick={() => toggle(c.key)}
                className="w-full grid grid-cols-[22px_1fr_auto_18px] md:grid-cols-[22px_1fr_190px_92px_18px] gap-3.5 items-center px-4 py-3 text-left hover:bg-accent/20 transition-colors"
              >
                <span className={`w-[22px] h-[22px] rounded-md flex items-center justify-center text-[11px] font-mono font-semibold ${
                  c.maxed ? 'bg-foreground/15 text-foreground' : 'bg-accent/40 text-muted-foreground'
                }`}>
                  {c.maxed ? '▲' : '·'}
                </span>
                <div className="min-w-0">
                  <p className="text-[13.5px] font-semibold text-foreground">{c.name}</p>
                  <p className="text-xs leading-snug text-muted-foreground mt-0.5">{c.plain}</p>
                </div>
                <div className="hidden md:block h-1.5 rounded-full bg-accent/40 overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${c.pct}%`, backgroundColor: c.color }} />
                </div>
                <span className="text-right text-xs font-mono text-foreground/75 tabular-nums">
                  {c.score} / {c.max}
                </span>
                <ChevronDown className={`w-3.5 h-3.5 text-muted-foreground transition-transform ${open[c.key] ? 'rotate-180' : ''}`} />
              </button>

              {open[c.key] && (
                <div className="px-4 pb-4 pt-3 md:pl-[51px] border-t border-border/20">
                  <p className="text-[12.5px] leading-relaxed text-foreground/70 max-w-[68ch]">{c.rule}</p>
                  {c.cards.length > 0 ? (
                    <div className="flex flex-wrap gap-2.5 mt-3">
                      {c.cards.map(n => <CardTile key={n} name={n} onPreview={onPreview} />)}
                    </div>
                  ) : (
                    <p className="text-[11.5px] text-muted-foreground/70 mt-2.5">
                      No individual cards — this one measures the deck as a whole.
                    </p>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
