import { Fragment, useState } from 'react';
import { useAutoAnimate } from '@formkit/auto-animate/react';
import { ChevronDown, ChevronsUp } from 'lucide-react';
import type { BracketViewModel, Gate, GateCardGroup, SoftCriterion } from './bracketViewModel';
import { BRACKET_HEX } from './bracketViewModel';
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
  // An element can be present without requiring anything — an unrated combo is
  // in the deck but names no bracket — so the headline counts what actually set
  // the floor, not everything the deck contains.
  const setting = vm.gates.filter(g => g.forcesBracket > 0).length;
  const forcing = vm.gates.filter(g => g.status !== 'measured').length;
  const bumpsTo = vm.floor >= 4 ? 5 : Math.min(vm.floor + 1, 4);

  return (
    // Full-bleed: no card border or radius of its own, and the tab strips its
    // padding for this tab. The panel *is* the page, so the section gutters
    // below are the page's gutters — a card frame inside them read as a box
    // floating in a box.
    <div className="bg-card/60">

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

          {/* The scale reads as a vertical list so the deck's own rung sits on
              its label — and so a 1-or-2 range can highlight two adjacent rows. */}
          <div className="w-full lg:w-[190px] shrink-0 space-y-0.5">
            {vm.ladder.map(l => (
              <div
                key={l.n}
                className="flex items-center gap-2.5 px-2 py-1 rounded-md"
                style={l.active ? { backgroundColor: `${vm.accent}1f` } : undefined}
              >
                <span
                  className={`w-3 text-center text-xs font-bold ${l.active ? '' : 'text-muted-foreground'}`}
                  style={l.active ? { color: vm.accent } : undefined}
                >
                  {l.n}
                </span>
                <span className={`text-[12.5px] ${l.active ? 'text-foreground font-semibold' : 'text-muted-foreground'}`}>
                  {l.name}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Tier one: the checks that set the floor ── */}
      <div className="px-7 pt-6 pb-2">
        <div className="flex items-baseline gap-3 flex-wrap">
          <h4 className="text-[15px] font-semibold text-foreground">
            {setting === 0
              ? 'Nothing in the deck sets a floor'
              : `${setting === 1 ? 'One element sets' : `${setting} elements set`} the floor at Bracket ${vm.floor}`}
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
        <h4 className="text-[15px] font-semibold text-foreground">
          How tuned it is, inside Bracket {vm.floor}
        </h4>
        <div className="mt-3.5 rounded-[11px] border border-border/30 overflow-hidden">
          {vm.criteria.map((c, i) => (
            <CriterionRow
              key={c.key}
              criterion={c}
              onPreview={onPreview}
              divider={i < vm.criteria.length - 1}
            />
          ))}
        </div>
        <BottomLine vm={vm} bumpsTo={bumpsTo} />
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
          {gate.cardGroups?.length ? (
            <div className="flex flex-wrap gap-2 mt-2.5">
              {gate.cardGroups.map((g, i) => <CardGroupBox key={i} group={g} onPreview={onPreview} />)}
            </div>
          ) : gate.cards.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-2.5">
              {gate.cards.map(n => <CardPill key={n} name={n} onPreview={onPreview} />)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Cards that only mean something together, boxed as one unit.
 *
 * A flat row of pills can't say which card pairs with which — with two combos
 * sharing Sol Ring it read as three loose findings. So each combo gets its own
 * container, its halves joined by the same "+" the Card Fit combo list uses, and
 * a note saying what bracket it asks for. A group that didn't move the floor is
 * outlined dashed rather than hidden: it's in the deck, it just isn't evidence.
 */
function CardGroupBox({ group, onPreview }: { group: GateCardGroup; onPreview: (name: string) => void }) {
  return (
    <div
      className={`rounded-[9px] border bg-background/50 px-2 pt-2 pb-1.5 ${
        group.muted ? 'border-dashed border-border/50' : 'border-border/40'
      }`}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        {group.cards.map((n, i) => (
          <Fragment key={n}>
            {i > 0 && <span className="text-[11px] text-muted-foreground/70">+</span>}
            <CardPill name={n} onPreview={onPreview} />
          </Fragment>
        ))}
      </div>
      {group.note && (
        <p className={`text-[10.5px] mt-1.5 ${group.muted ? 'text-muted-foreground/70 italic' : 'text-muted-foreground'}`}>
          {group.note}
        </p>
      )}
    </div>
  );
}

/**
 * The bottom line under the tuning table — the total, and what it would buy.
 *
 * Deliberately not a fifth row: no border, no fill, no card background, so it
 * reads as the sum of the table rather than another thing being measured. It
 * keeps the rows' column grid so the total lands under the four scores and the
 * climb lands under the four "Why this matters" links — read down either column
 * and the last line answers it.
 */
function BottomLine({ vm, bumpsTo }: { vm: BracketViewModel; bumpsTo: number }) {
  const reaching = vm.bumpTarget !== null && vm.pointsToBump > 0;
  const atCeiling = vm.bumpTarget === null;
  const hex = BRACKET_HEX[reaching ? bumpsTo : vm.bracket];

  const climb = reaching
    ? `${vm.pointsToBump} more for Bracket ${bumpsTo}`
    : atCeiling
      ? 'Top of the scale'
      : `Enough for Bracket ${vm.bracket}`;

  const Climb = (
    <span
      className="text-[12.5px] font-semibold whitespace-nowrap"
      style={{ color: atCeiling ? undefined : hex }}
    >
      {!atCeiling && (
        <ChevronsUp className="inline w-3.5 h-3.5 -mt-0.5 mr-1" strokeWidth={2.25} />
      )}
      {climb}
    </span>
  );

  return (
    // mx-px absorbs the table's 1px border so the columns still line up.
    <div className="mx-px mt-3 grid grid-cols-[1fr_auto] md:grid-cols-[170px_1fr_74px_auto_14px] gap-x-4 gap-y-1.5 items-baseline px-4">
      <span className="hidden md:block" />
      <span className="text-[13px] text-muted-foreground">Tuning score</span>
      <span className="text-right text-sm font-semibold text-foreground tabular-nums">
        {vm.softScore} / 100
      </span>
      {/* Spans the links column and the chevron gutter, so it ends flush with
          the rows' right edge rather than stopping short of it. */}
      <span className={`hidden md:block md:col-span-2 text-right ${atCeiling ? 'text-muted-foreground' : ''}`}>{Climb}</span>
      <span className={`md:hidden col-span-2 text-right ${atCeiling ? 'text-muted-foreground' : ''}`}>{Climb}</span>
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
