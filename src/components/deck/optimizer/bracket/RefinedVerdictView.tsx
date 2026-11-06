import { Fragment, useState, type ReactNode } from 'react';
import { useAutoAnimate } from '@formkit/auto-animate/react';
import { ChevronDown, ChevronsUp, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { IntendedBracket } from '@/types';
import type { BracketViewModel, Gate, GateCardGroup, SoftCriterion, SoftKey } from './bracketViewModel';
import type { ClimbCard } from './climbSuggestions';
import { BRACKET_HEX } from './bracketViewModel';
import { StatusChip } from '../dashboard/launchpad/parts';
import { CardTile, CardPill } from './CardTile';
import { GateBracketChip, gateTint } from './GateMarker';
import { GATE_ICON, CRITERION_ICON } from './bracketIcons';
import { SOFT } from '@/services/deckBuilder/bracketEstimator';
import type { BracketBreakdown } from '@/services/deckBuilder/bracketEstimator';
import { nextBracketLine } from './powerLevers';

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
export function RefinedVerdictView({
  vm,
  onPreview,
  aim,
  aimIsSet = false,
  aimRefreshing = false,
  onAimChange,
  aimSection,
  climb,
  breakdown,
}: {
  vm: BracketViewModel;
  onPreview: (name: string) => void;
  /** The bracket the player is aiming at — marked on the ladder beside the reading. */
  aim?: number | null;
  /** The aim is the player's own pick (not the bracket it was built at), so clicking it clears it. */
  aimIsSet?: boolean;
  /** True while suggestions are being re-read for a new aim. */
  aimRefreshing?: boolean;
  /** Present → the ladder is the aim picker: click a rung to aim there. */
  onAimChange?: (bracket: IntendedBracket | null) => void;
  /** Rendered between the verdict and the evidence: what the player is aiming for, and the gap. */
  aimSection?: ReactNode;
  /** Cards that would raise each tuning row. Null when climbing isn't the direction: the deck is at
   *  the top of the scale, or already above the player's aim. */
  climb?: Record<SoftKey, ClimbCard[]> | null;
  /** The estimate's counts, for saying the gap to the next bracket in cards. */
  breakdown?: BracketBreakdown;
}) {
  const present = vm.gates.filter(g => g.status === 'present').length;
  // An element can be present without requiring anything — an unrated combo is
  // in the deck but names no bracket — so the headline counts what actually set
  // the floor, not everything the deck contains.
  const setting = vm.gates.filter(g => g.forcesBracket > 0).length;
  const forcing = vm.gates.filter(g => g.status !== 'measured').length;
  const bumpsTo = vm.floor >= 4 ? 5 : Math.min(vm.floor + 1, 4);
  // A range reading ("1 or 2") counts as on aim when the aim is either rung.
  const aimOnReading = aim != null && vm.ladder.some(l => l.active && l.n === aim);

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
              <span className="self-center" title={`Estimated from the decklist. ${vm.confidenceNote}.`}>
                <StatusChip tone={vm.confidence === 'high' ? 'good' : 'warn'}>
                  {vm.confidence === 'high' ? 'High' : 'Medium'} confidence
                </StatusChip>
              </span>
            </div>
            <p className="text-[17px] leading-relaxed text-foreground/80 mt-3.5">{vm.headline}</p>
            {vm.isRange && (
              <p className="text-[13px] leading-relaxed text-muted-foreground mt-2.5">
                The two are told apart by intent, not cards, so this is as far as a list can narrow it.
              </p>
            )}
          </div>

          {/* The scale reads as a vertical list so the deck's own rung sits on
              its label — and so a 1-or-2 range can highlight two adjacent rows.
              It is also the aim picker: the reading is the filled rung, the aim
              the outlined one. */}
          <div className="w-full lg:w-[220px] shrink-0">
            {onAimChange && (
              <p className="mb-1.5 flex items-center gap-1.5 px-2 text-[11px] text-muted-foreground" role="status">
                {aimRefreshing
                  ? <><Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" /> Re-aiming suggestions</>
                  : aim ? (aimIsSet ? 'Click another to change your aim, or yours to clear it' : 'Click to change your aim') : "Click the one you're building for"}
              </p>
            )}
            <div
              className="space-y-0.5"
              role={onAimChange ? 'radiogroup' : undefined}
              aria-label={onAimChange ? "Bracket you're aiming for" : undefined}
            >
            {vm.ladder.map(l => {
              const isAim = aim === l.n;
              const Row = onAimChange ? 'button' : 'div';
              return (
              <Row
                key={l.n}
                {...(onAimChange && {
                  type: 'button' as const,
                  role: 'radio',
                  'aria-checked': isAim,
                  disabled: aimRefreshing,
                  // Clicking the aim you set clears it; any other rung becomes the aim.
                  onClick: () => onAimChange(isAim && aimIsSet ? null : l.n as IntendedBracket),
                })}
                className={cn(
                  'flex w-full items-center gap-2.5 px-2 py-1 rounded-md border text-left',
                  isAim ? '' : 'border-transparent',
                  onAimChange && 'cursor-pointer transition-colors hover:bg-white/5 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-wait',
                )}
                style={{
                  ...(l.active ? { backgroundColor: `${vm.accent}1f` } : {}),
                  ...(isAim ? { borderColor: `${BRACKET_HEX[l.n]}99` } : {}),
                }}
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
                {/* Only when the two differ: on its own aim, the highlighted row says it all. */}
                {!aimOnReading && (l.active || aim === l.n) && (
                  <span className="ml-auto flex gap-1">
                    {l.active && (
                      <span
                        className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-px rounded border"
                        style={{ color: vm.accent, borderColor: `${vm.accent}66` }}
                      >
                        Estimated
                      </span>
                    )}
                    {isAim && (
                      <span
                        className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-px rounded border"
                        style={{ color: BRACKET_HEX[l.n], borderColor: `${BRACKET_HEX[l.n]}66` }}
                      >
                        Your aim
                      </span>
                    )}
                  </span>
                )}
              </Row>
              );
            })}
            </div>
          </div>
        </div>
      </div>

      {aimSection}

      {/* ── Tier one: the checks that set the floor, folded to one line ── */}
      <FloorRules vm={vm} setting={setting} present={present} forcing={forcing} onPreview={onPreview} />

      {/* ── Tier two: how tuned it is inside that floor ── */}
      <div className="px-7 pt-6 pb-7">
        <h4 className="text-[15px] font-semibold text-foreground">
          How tuned it is, inside Bracket {vm.floor}
        </h4>
        {/* The gap to the next bracket, up top in cards; the total stays under the table as its sum. */}
        {climb && breakdown && vm.pointsToBump > 0 && (() => {
          const line = nextBracketLine(breakdown, vm.pointsToBump);
          return (
            <p className="text-[13px] leading-relaxed text-muted-foreground mt-1.5 max-w-[72ch]">
              {line
                ? <>{line} would tip it into <span className="font-semibold" style={{ color: BRACKET_HEX[bumpsTo] }}>Bracket {bumpsTo}</span>. Open a row to see which.</>
                : <>Reaching <span className="font-semibold" style={{ color: BRACKET_HEX[bumpsTo] }}>Bracket {bumpsTo}</span> takes gains across several rows. Open one to see what raises it.</>}
            </p>
          );
        })()}
        <div className="mt-3.5 rounded-[11px] border border-border/30 overflow-hidden">
          {vm.criteria.map((c, i) => (
            <CriterionRow
              key={c.key}
              criterion={c}
              onPreview={onPreview}
              divider={i < vm.criteria.length - 1}
              climb={climb && !c.maxed ? climb[c.key] : undefined}
              nextBracket={bumpsTo}
            />
          ))}
        </div>
        <BottomLine vm={vm} bumpsTo={bumpsTo} />
      </div>
    </div>
  );
}

/**
 * The official checks, as one line that opens. Closed, it still answers "what put me here": the
 * elements that set the floor, by name. Open, it is the full rule set with every check's cards.
 */
function FloorRules({ vm, setting, present, forcing, onPreview }: {
  vm: BracketViewModel;
  setting: number;
  present: number;
  forcing: number;
  onPreview: (name: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [ref] = useAutoAnimate<HTMLDivElement>(REVEAL);
  const setters = vm.gates.filter(g => g.forcesBracket > 0 && g.forcesBracket === vm.floor);
  const names = setters.map(g => g.name);
  const summary = setting === 0
    ? 'Nothing in the deck sets a floor'
    : `${names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0] ?? `${setting} elements`} set the floor at Bracket ${vm.floor}`;

  return (
    <div ref={ref} className="px-7 pt-5 pb-1">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
        className="group flex w-full items-center gap-3 rounded-[10px] border border-border/40 bg-background/40 px-4 py-3 text-left transition-colors hover:bg-accent/30"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-[14px] font-semibold text-foreground group-hover:text-primary transition-colors">{summary}</span>
          <span className="block text-[12.5px] text-muted-foreground mt-0.5">
            The official bracket rules · {present} of {forcing} present in this deck
          </span>
        </span>
        <span className="hidden sm:inline text-[12.5px] font-medium text-sky-400 whitespace-nowrap">{open ? 'Hide' : 'Show the rules'}</span>
        <ChevronDown className={`w-4 h-4 shrink-0 text-muted-foreground group-hover:text-primary transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="pt-3">
          <p className="text-[13px] leading-relaxed text-muted-foreground max-w-[72ch]">
            These are the only things that can set a floor on their own. Each one the deck contains shows
            the bracket it requires, and the floor is the highest of them. Open one to see what it looks for.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-3.5">
            {vm.gates.map(g => <GateCard key={g.key} gate={g} onPreview={onPreview} />)}
          </div>
        </div>
      )}
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
      <span className="text-[13px] text-muted-foreground">Power score</span>
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

/** `hsl(38, 80%, 55%)` → `hsl(38 80% 55% / a)`: the row's bar colour at a wash strength. */
const wash = (hsl: string, alpha: number) => hsl.replace(/hsl\((\d+),\s*([\d.]+%),\s*([\d.]+%)\)/, `hsl($1 $2 $3 / ${alpha})`);

function CriterionRow({
  criterion: c,
  onPreview,
  divider,
  climb,
  nextBracket,
}: {
  criterion: SoftCriterion;
  onPreview: (name: string) => void;
  divider: boolean;
  climb?: ClimbCard[];
  nextBracket: number;
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
        style={open ? { backgroundColor: wash(c.color, 0.07), boxShadow: `inset 3px 0 0 ${wash(c.color, 0.55)}` } : undefined}
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

      {/* The open row takes a wash of its own bar colour, so it reads apart from its neighbours. */}
      {open && (
        <div className="px-4 pt-3.5 pb-4" style={{ backgroundColor: wash(c.color, 0.07), boxShadow: `inset 3px 0 0 ${wash(c.color, 0.55)}` }}>
          <p className="text-[13.5px] leading-relaxed text-foreground/75 max-w-[76ch]">{c.rule}</p>
          {c.cards.length > 0 && (
            <div className="flex flex-wrap gap-2.5 mt-3.5">
              {c.cards.map(n => <CardTile key={n} name={n} onPreview={onPreview} />)}
            </div>
          )}
          {climb && climb.length > 0 && <ClimbList criterion={c} cards={climb} nextBracket={nextBracket} onPreview={onPreview} />}
          {c.maxed && (
            <p className="text-[12.5px] text-muted-foreground mt-3">At the most this row can add. More of these won&apos;t raise the power score.</p>
          )}
        </div>
      )}
    </div>
  );
}

const CLIMB_LEAD: Record<SoftKey, string> = {
  fastMana: 'Fast mana these decks run that yours doesn\'t',
  tutors: 'Tutors these decks run that yours doesn\'t',
  interaction: 'Interaction these decks run that yours doesn\'t',
  cmc: 'Your most expensive spells. Swapping one for a cheaper card lowers the average',
};

/** What would raise this row, under its explanation: the learning first, then what to do about it. */
function ClimbList({ criterion: c, cards, nextBracket, onPreview }: {
  criterion: SoftCriterion;
  cards: ClimbCard[];
  nextBracket: number;
  onPreview: (name: string) => void;
}) {
  return (
    <div className="mt-4 border-t pt-3.5" style={{ borderColor: wash(c.color, 0.25) }}>
      <p className="text-[12.5px] font-semibold text-foreground/90">
        Toward Bracket {nextBracket}
        <span className="font-normal text-muted-foreground">
          {' '}· {CLIMB_LEAD[c.key]}
          {c.key !== 'cmc' && `, +${SOFT[c.key].per} each`}
        </span>
      </p>
      <div className="flex flex-wrap gap-2 mt-2.5">
        {cards.map(card => (
          <div key={card.name} className="flex items-center gap-1.5">
            <CardPill name={card.name} onPreview={onPreview} />
            <span className="text-[11px] tabular-nums text-muted-foreground pr-1">
              {card.note}
              {card.gameChanger && <span className="ml-1 text-amber-300/90">· Game Changer</span>}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
