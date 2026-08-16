import { useState } from 'react';
import { useAutoAnimate } from '@formkit/auto-animate/react';
import { ChevronDown } from 'lucide-react';
import type { BracketViewModel, Gate, SoftCriterion } from './bracketViewModel';
import { CardTile, CardPill } from './CardTile';
import { GateBracketChip, gateTint } from './GateMarker';
import { GATE_ICON, CRITERION_ICON } from './bracketIcons';

/**
 * Disclosure timing. Deliberately not the springy cubic-bezier SpellChroma uses
 * — an overshoot on height visibly clips against these rows' borders, and this
 * panel reads as analytical rather than playful.
 */
const REVEAL = { duration: 200, easing: 'ease-out' } as const;

/**
 * Design 2a — one bracket statement, then the evidence in two tiers.
 *
 * The bracket is said once. Underneath it sit the two things that actually
 * decided it: the five hard checks (which set the floor) and the tuning score
 * (which decides whether the deck plays above that floor). The score is a
 * single line rather than the headline.
 */
export function RefinedVerdictView({ vm, onPreview }: { vm: BracketViewModel; onPreview: (name: string) => void }) {
  const present = vm.gates.filter(g => g.status === 'present').length;
  const forcing = vm.gates.filter(g => g.status !== 'measured').length;
  const bumpsTo = vm.floor >= 4 ? 5 : Math.min(vm.floor + 1, 4);

  return (
    <div className="rounded-xl border border-border/30 bg-card/60 overflow-hidden">

      {/* ── One statement of the bracket ── */}
      <div
        className="px-7 pt-7 pb-6 border-b border-border/30"
        style={{ background: `linear-gradient(180deg, ${vm.accent}17, transparent)` }}
      >
        <div className="flex flex-col lg:flex-row items-start justify-between gap-8">

          <div className="max-w-[62ch]">
            <div className="flex items-baseline gap-3.5 flex-wrap">
              <span className={`${vm.isRange ? 'text-[46px]' : 'text-[56px]'} leading-[0.95] font-bold ${vm.colors.text}`}>
                {vm.bracketLabel}
              </span>
              <span className={`${vm.isRange ? 'text-[21px]' : 'text-[25px]'} font-semibold text-foreground`}>
                {vm.label}
              </span>
            </div>
            <p className="text-[17px] leading-relaxed text-foreground/80 mt-3.5">{vm.headline}</p>
            <p className="text-[13px] leading-relaxed text-muted-foreground mt-2.5">
              An estimate from the deck list. Confidence is {vm.confidence} —{' '}
              {vm.confidenceNote.charAt(0).toLowerCase() + vm.confidenceNote.slice(1)}.
              {vm.isRange && ' The two are told apart by intent, not cards, so this is as far as a list can narrow it.'}
            </p>
          </div>

          <div className="w-full lg:w-[250px] shrink-0 lg:pt-1.5">
            <div className="flex gap-1">
              {vm.ladder.map(l => (
                <div key={l.n} className="flex-1 min-w-0">
                  <div
                    className={`h-[5px] rounded-sm ${l.active ? '' : 'bg-muted-foreground/30'}`}
                    style={l.active ? { backgroundColor: vm.accent } : undefined}
                  />
                  <div className={`text-xs font-semibold mt-1.5 ${l.active ? '' : 'text-muted-foreground'}`}
                       style={l.active ? { color: vm.accent } : undefined}>
                    {l.n}
                  </div>
                </div>
              ))}
            </div>
            <p className="text-[12.5px] leading-relaxed text-muted-foreground mt-2">
              {vm.ladder.map(l => `${l.n} ${l.name}`).join(' · ')}
            </p>
          </div>
        </div>
      </div>

      {/* ── Tier one: the checks that set the floor ── */}
      <div className="px-7 pt-6 pb-2">
        <div className="flex items-baseline gap-3 flex-wrap">
          <h4 className="text-[15px] font-semibold text-foreground">
            {present === 0
              ? 'Nothing in the deck sets a floor'
              : `${present === 1 ? 'One element sets' : `${present} elements set`} the floor at Bracket ${vm.floor}`}
          </h4>
          <span className="text-[13px] text-muted-foreground">
            {present} of {forcing} present
          </span>
        </div>
        <p className="text-[13px] leading-relaxed text-muted-foreground mt-1.5 max-w-[72ch]">
          These are the only things that can set a floor on their own. Each one the deck contains shows
          the bracket it requires — the floor is the highest of them. Open one to see what it looks for.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-4">
          {vm.gates.map(g => <GateCard key={g.key} gate={g} onPreview={onPreview} />)}
        </div>
      </div>

      {/* ── Tier two: how tuned it is inside that floor ── */}
      <div className="px-7 pt-6 pb-7">
        <div className="flex items-baseline gap-3 flex-wrap">
          <h4 className="text-[15px] font-semibold text-foreground">
            How tuned it is, inside Bracket {vm.floor}
          </h4>
          <span className="text-[13px] text-muted-foreground tabular-nums">{vm.softScore} / 100</span>
        </div>
        <p className="text-[13px] leading-relaxed text-muted-foreground mt-1.5 max-w-[72ch]">
          Four measures of speed and consistency. The filled part of each row is how much of that
          measure your deck uses.
          {vm.bumpTarget !== null && vm.pointsToBump > 0 && (
            <> <span className="text-amber-400">{vm.pointsToBump} more</span> would read as a Bracket {bumpsTo} deck.</>
          )}
          {vm.wasElevated && <> That was enough to lift this deck above its floor of {vm.floor}.</>}
        </p>

        <div className="mt-4 rounded-[11px] border border-border/30 overflow-hidden">
          {vm.criteria.map((c, i) => (
            <CriterionRow
              key={c.key}
              criterion={c}
              onPreview={onPreview}
              divider={i < vm.criteria.length - 1}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Rows ────────────────────────────────────────────────────────────
// Each disclosure owns its own open state and auto-animate ref, because
// hooks can't be called from inside a .map().

function GateCard({ gate, onPreview }: { gate: Gate; onPreview: (name: string) => void }) {
  const [open, setOpen] = useState(false);
  const [ref] = useAutoAnimate<HTMLDivElement>(REVEAL);
  const tint = gateTint(gate);
  const Icon = GATE_ICON[gate.key];

  return (
    <div
      ref={ref}
      className={`rounded-[10px] border self-start overflow-hidden ${tint.className}`}
      style={tint.style}
    >
      <button
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
        className="group w-full grid grid-cols-[16px_1fr_auto_14px] gap-x-2.5 items-center px-3.5 py-3 text-left hover:bg-accent/30 transition-colors"
      >
        {Icon && (
          <Icon
            className={`w-4 h-4 shrink-0 ${gate.status === 'present' ? 'text-foreground/80' : 'text-muted-foreground/70'}`}
            strokeWidth={gate.status === 'present' ? 2 : 1.75}
          />
        )}
        <span className="flex items-center gap-2 min-w-0">
          <span className={`text-[13.5px] truncate ${gate.status === 'present' ? 'font-semibold text-foreground' : 'text-foreground/75'} group-hover:text-primary transition-colors`}>
            {gate.name}
          </span>
          <GateBracketChip gate={gate} />
        </span>
        <span className="text-[12.5px] text-muted-foreground">{gate.countLabel}</span>
        <ChevronDown
          className={`w-3.5 h-3.5 text-muted-foreground group-hover:text-primary transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && (
        <div className="px-3.5 pb-3.5 pl-[40px]">
          <p className="text-[13px] leading-relaxed text-foreground/75">{gate.detail}</p>
          {gate.cards.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-2.5">
              {gate.cards.map(n => <CardPill key={n} name={n} onPreview={onPreview} />)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function CriterionRow({
  criterion: c,
  onPreview,
  divider,
}: {
  criterion: SoftCriterion;
  onPreview: (name: string) => void;
  divider: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [ref] = useAutoAnimate<HTMLDivElement>(REVEAL);
  const Icon = CRITERION_ICON[c.key];

  return (
    <div ref={ref} className={divider ? 'border-b border-border/30' : ''}>
      <button
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
        className="group relative w-full text-left bg-background/40 hover:bg-accent/30 transition-colors"
      >
        {/* The row's own background is the bar. */}
        <div
          className="absolute left-0 top-0 bottom-0 opacity-[0.13] pointer-events-none"
          style={{ width: `${c.pct}%`, backgroundColor: c.color }}
        />
        <div className="relative grid grid-cols-[1fr_auto_14px] md:grid-cols-[170px_1fr_74px_auto_14px] gap-x-4 gap-y-1 items-center px-4 py-3.5">
          <span className="flex items-center gap-2 min-w-0">
            {Icon && (
              <Icon className="w-[15px] h-[15px] shrink-0" style={{ color: c.color }} strokeWidth={2} />
            )}
            <span className="text-sm font-semibold text-foreground truncate group-hover:text-primary transition-colors">
              {c.name}
            </span>
          </span>
          <span className="hidden md:block text-[13px] leading-snug text-foreground/70">{c.plain}</span>
          <span className="text-right text-sm font-semibold text-foreground tabular-nums">
            {c.score} / {c.max}
          </span>
          <span className="hidden md:block text-right text-[12.5px] font-medium text-sky-400 whitespace-nowrap">
            {open ? 'Hide' : 'Why this matters'}
          </span>
          <ChevronDown
            className={`w-3.5 h-3.5 text-muted-foreground group-hover:text-primary transition-transform ${open ? 'rotate-180' : ''}`}
          />
          <span className="md:hidden col-span-3 text-[13px] leading-snug text-foreground/70">{c.plain}</span>
        </div>
      </button>

      {open && (
        <div className="px-4 pt-3.5 pb-4 bg-card/40">
          <p className="text-[13.5px] leading-relaxed text-foreground/75 max-w-[76ch]">{c.rule}</p>
          {c.cards.length > 0 ? (
            <div className="flex flex-wrap gap-2.5 mt-3.5">
              {c.cards.map(n => <CardTile key={n} name={n} onPreview={onPreview} />)}
            </div>
          ) : (
            <p className="text-[12.5px] text-muted-foreground mt-2.5">
              No individual cards — this one measures the deck as a whole.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
