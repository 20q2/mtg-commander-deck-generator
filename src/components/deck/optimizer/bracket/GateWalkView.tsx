import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import type { BracketViewModel } from './bracketViewModel';
import { CardRow, CardPill } from './CardTile';
import { GateBracketChip, gateTint } from './GateMarker';

const RADIUS = 86;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/**
 * Design 1b — gate walk.
 * The deck passes through the five hard-floor checks first, then a dial
 * shows how tuned it is inside the bracket those checks left it in.
 */
export function GateWalkView({ vm, onPreview }: { vm: BracketViewModel; onPreview: (name: string) => void }) {
  const [gatesOpen, setGatesOpen] = useState<Record<string, boolean>>({});
  const [critOpen, setCritOpen] = useState<Record<string, boolean>>({});

  // Fill to the top of the range so a 1-or-2 reading doesn't under-report.
  const dash = (CIRCUMFERENCE * vm.bracketMax) / 5;
  const unused = Math.max(0, 100 - vm.softScore);

  return (
    <div className="rounded-xl border border-border/30 bg-card/60 overflow-hidden">

      {/* ── Dial + hard-floor checks ── */}
      <div className="grid grid-cols-1 md:grid-cols-[238px,1fr] gap-7 p-6 border-b border-border/30">

        <div className="flex flex-col items-center gap-1.5">
          <div className="relative w-[200px] h-[200px]">
            <svg width="200" height="200" viewBox="0 0 200 200">
              <circle cx="100" cy="100" r={RADIUS} fill="none" stroke="currentColor" strokeWidth="14" className="text-accent/50" />
              <circle
                cx="100" cy="100" r={RADIUS}
                fill="none" stroke={vm.accent} strokeWidth="14" strokeLinecap="round"
                strokeDasharray={`${dash} ${CIRCUMFERENCE - dash}`}
                transform="rotate(-90 100 100)"
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-[9.5px] font-mono font-medium tracking-[0.16em] text-muted-foreground">BRACKET</span>
              <span className={`${vm.isRange ? 'text-[42px]' : 'text-[62px]'} leading-none font-bold ${vm.colors.text}`}>
                {vm.bracketDisplay}
              </span>
              <span className="text-sm font-semibold text-foreground mt-1 text-center px-2">{vm.label}</span>
            </div>
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground text-center max-w-[200px] mt-1.5">
            {vm.description}
          </p>
        </div>

        <div>
          <p className="text-[10.5px] font-mono font-semibold tracking-[0.14em] text-muted-foreground/80">
            FIVE CHECKS THAT SET THE FLOOR
          </p>
          <p className="text-[12.5px] leading-relaxed text-muted-foreground mt-1.5 max-w-[62ch]">
            A few elements set a floor on their own, whatever the rest of the deck looks like. Each one
            present shows the bracket it requires — the floor is the highest of them.{' '}
            {vm.floor === 1
              ? 'This deck contains none, so its floor is Bracket 1.'
              : `This deck contains ${vm.gates.filter(g => g.status === 'present').length}, putting the floor at Bracket ${vm.floor}.`}
          </p>

          <div className="grid gap-1.5 mt-4">
            {vm.gates.map(g => {
              const tint = gateTint(g);
              const isOpen = !!gatesOpen[g.key];
              return (
                <div
                  key={g.key}
                  className={`rounded-lg border overflow-hidden ${tint.className}`}
                  style={tint.style}
                >
                  <button
                    onClick={() => setGatesOpen(o => ({ ...o, [g.key]: !o[g.key] }))}
                    className="w-full grid grid-cols-[1fr_auto_auto] gap-3 items-center px-3.5 py-2.5 text-left hover:bg-accent/20 transition-colors"
                  >
                    <span className="flex items-center gap-2 min-w-0">
                      <span className={`text-[13px] truncate ${g.status === 'present' ? 'font-semibold text-foreground' : 'text-foreground/75'}`}>
                        {g.name}
                      </span>
                      <GateBracketChip gate={g} />
                    </span>
                    <span className="text-[11.5px] font-mono text-muted-foreground">{g.countLabel}</span>
                    <ChevronDown className={`w-3.5 h-3.5 text-muted-foreground transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                  </button>
                  {isOpen && (
                    <div className="px-3.5 pb-3.5">
                      <p className="text-[12.5px] leading-relaxed text-foreground/70 max-w-[62ch]">{g.detail}</p>
                      {g.cards.length > 0 && (
                        <div className="flex flex-wrap gap-2 mt-2.5">
                          {g.cards.map(n => <CardPill key={n} name={n} onPreview={onPreview} />)}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── Soft score ── */}
      <div className="p-6 pt-5">
        <div className="flex items-baseline gap-3 flex-wrap">
          <p className="text-[10.5px] font-mono font-semibold tracking-[0.14em] text-muted-foreground/80">
            HOW TUNED IT IS INSIDE BRACKET {vm.floor}
          </p>
          <p className="text-xs font-mono font-medium text-foreground/75">{vm.softScore} / 100</p>
        </div>
        <p className="text-[12.5px] leading-relaxed text-muted-foreground max-w-[70ch] mt-1">
          Four things speed a deck up. They add to one score;{' '}
          {vm.bumpTarget === null
            ? 'the deck is already at the top of the scale.'
            : `cross ${vm.bumpTarget} and the estimate moves you up a bracket.`}
        </p>

        {/* Stacked contribution bar */}
        <div className="flex h-[34px] rounded-lg overflow-hidden mt-4 bg-accent/40 border border-border/30">
          {vm.criteria.filter(c => c.shareOfTotal > 0).map(c => (
            <div
              key={c.key}
              className="flex items-center pl-2.5 min-w-0"
              style={{ width: `${c.shareOfTotal}%`, backgroundColor: c.color }}
              title={`${c.name} — ${c.score} pts`}
            >
              <span className="text-[10.5px] font-mono font-semibold text-background truncate">
                {c.name.toUpperCase()} {c.score}
              </span>
            </div>
          ))}
          {unused > 0 && (
            <div className="flex-1 flex items-center justify-end pr-3">
              <span className="text-[10.5px] font-mono font-medium text-muted-foreground">{unused} unused</span>
            </div>
          )}
        </div>

        {vm.bumpTarget !== null && (
          <div className="relative h-[22px] mt-0.5">
            <div
              className="absolute top-0 h-full border-l border-dashed border-amber-500/60 pl-2"
              style={{ left: `${vm.bumpTarget}%` }}
            >
              <span className="text-[10.5px] font-mono font-medium text-amber-400 whitespace-nowrap">
                {vm.bumpTarget} → Bracket {vm.floor >= 4 ? 5 : Math.min(vm.floor + 1, 4)}
              </span>
            </div>
          </div>
        )}

        {/* Criteria cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-2.5 mt-3">
          {vm.criteria.map(c => {
            const isOpen = !!critOpen[c.key];
            return (
              <div
                key={c.key}
                className="rounded-lg border border-border/30 bg-background/40 self-start overflow-hidden"
              >
                <button
                  onClick={() => setCritOpen(o => ({ ...o, [c.key]: !o[c.key] }))}
                  className="w-full p-3.5 text-left hover:bg-accent/20 transition-colors"
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-[12.5px] font-semibold text-foreground">{c.name}</span>
                    <span className="text-[11px] font-mono text-muted-foreground tabular-nums">{c.score} / {c.max}</span>
                  </div>
                  <div className="h-1 rounded-full bg-accent/40 mt-2.5 overflow-hidden">
                    <div className="h-full" style={{ width: `${c.pct}%`, backgroundColor: c.color }} />
                  </div>
                  <p className="text-[11.5px] leading-snug text-muted-foreground mt-2">{c.plain}</p>
                </button>

                {isOpen && (
                  <div className="px-3.5 pb-3.5 pt-2.5 border-t border-border/30">
                    <p className="text-[11.5px] leading-relaxed text-foreground/70">{c.rule}</p>
                    {c.cards.length > 0 && (
                      <div className="grid gap-1.5 mt-2.5">
                        {c.cards.map(n => <CardRow key={n} name={n} onPreview={onPreview} />)}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
