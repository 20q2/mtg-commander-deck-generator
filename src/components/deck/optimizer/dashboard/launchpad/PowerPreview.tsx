// src/components/deck/optimizer/dashboard/launchpad/PowerPreview.tsx
//
// Where the deck plays next to where the player wants it, at a glance, with the control to change
// the aim right here. The aim is the Bracket tab's own state, so the two never disagree. What sets
// the bracket sits under that, on its own ground; the full breakdown is the Bracket tab.
import { useId, useMemo, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useStore } from '@/store';
import { nextBracketLine } from '../../bracket/powerLevers';
import { BRACKET_COLORS, BRACKET_DESCRIPTIONS } from '../../constants';
import { buildBracketViewModel, isUnratedCombo } from '../../bracket/bracketViewModel';
import { BracketAimControl } from '../../bracket/BracketAimControl';
import { UnratedCombosDoor } from './doors';
import { ArtChip, OpenTab, PreviewShell, StatusChip } from './parts';
import type { LaunchPadDeps } from './types';

export function PowerPreview({ d }: { d: LaunchPadDeps }) {
  const est = d.bracketEstimation;
  const combos = useStore(s => s.generatedDeck?.detectedCombos);
  const vm = useMemo(() => (est ? buildBracketViewModel(est, combos) : null), [est, combos]);
  const [whyOpen, setWhyOpen] = useState(false);
  const whyId = useId();
  const open = <OpenTab tab="bracket" label="full bracket info" onClick={() => d.onNavigate('bracket')} />;
  if (!est || !vm) {
    return <PreviewShell tab="bracket" title="No bracket estimate yet" sub="The bracket appears once the deck's cards are tagged." actions={open} />;
  }

  const basis = d.bracketAim?.basis ?? null;
  const aim = basis && basis.source !== 'estimated' ? basis.bracket : null;
  const reads = (n: number) => n >= vm.bracket && n <= vm.bracketMax;
  const onTarget = aim != null && reads(aim);
  const off = aim == null || onTarget ? 0 : aim < vm.bracket ? vm.bracket - aim : aim - vm.bracketMax;

  const title = aim == null
    ? `Plays like ${vm.bracketLabel}`
    : onTarget
      ? `Plays at ${vm.bracketLabel}, right where you're aiming`
      : `Plays like ${vm.bracketLabel}, ${off} ${aim < vm.bracket ? 'above' : 'below'} your aim`;

  // The gate that sets the floor, and the cards behind it — for a combo, the first rated pair.
  const floorGate = vm.gates.find(g => g.status === 'present' && g.forcesBracket === vm.floor && vm.floor > 1);
  const floorCards = floorGate?.cardGroups?.find(g => !g.muted)?.cards ?? floorGate?.cards.slice(0, 3) ?? [];
  const colors = BRACKET_COLORS[est.bracket];
  const deckCards = new Map(d.cards.map(c => [c.name, c]));
  const unrated = (combos ?? []).filter(isUnratedCombo);
  const refreshing = d.bracketAim?.refreshing ?? false;

  return (
    <PreviewShell tab="bracket"
      title={title}
      sub={`${BRACKET_DESCRIPTIONS[est.bracket].replace(' — ', ': ')}.`}
      aside={
        <div className="flex flex-wrap justify-end gap-1.5">
          {aim != null && (onTarget
            ? <StatusChip tone="good"><Check className="w-3.5 h-3.5" /> On aim</StatusChip>
            : <StatusChip tone="warn">{off} {aim < vm.bracket ? 'above' : 'below'}</StatusChip>)}
          <span title={`Estimated from the decklist. ${vm.confidenceNote}.`}>
            <StatusChip tone={vm.confidence === 'high' ? 'good' : 'warn'}>
              {vm.confidence === 'high' ? 'High' : 'Medium'} confidence
            </StatusChip>
          </span>
        </div>
      }
      actions={open}
    >
      <BracketAimControl vm={vm} basis={basis} refreshing={refreshing} onChange={d.bracketAim?.onChange} />

      {/* What sets the bracket: the floor and the score that can lift it past the floor. Folded away
          until asked for; the reading above is the answer, this is the working. */}
      <div className="rounded-lg border border-border/60 bg-background/80">
        <button
          type="button"
          aria-expanded={whyOpen}
          aria-controls={whyId}
          onClick={() => setWhyOpen(o => !o)}
          className="group flex w-full cursor-pointer items-center justify-between gap-3 rounded-lg px-3.5 py-2.5 text-left text-[12.5px] font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          Why {vm.bracketLabel}
          <ChevronDown
            className={cn(
              'w-4 h-4 transition-transform duration-200 motion-reduce:transition-none',
              whyOpen && 'rotate-180 text-foreground',
            )}
            aria-hidden="true"
          />
        </button>
        <div
          id={whyId}
          className={cn(
            'grid transition-[grid-template-rows,visibility,opacity] duration-300 ease-[cubic-bezier(0.2,0.7,0.2,1)] motion-reduce:transition-none',
            whyOpen ? 'visible grid-rows-[1fr] opacity-100' : 'invisible grid-rows-[0fr] opacity-0',
          )}
        >
        <div className="min-h-0 overflow-hidden">
        <div className="flex flex-col gap-2.5 px-3.5 pb-3">
        <p className="text-[13px] leading-snug text-foreground/90">
          {floorGate ? (
            <>
              <span className={cn('font-semibold', colors.text)}>{floorGate.name}</span> set the floor at {vm.floor}
              {floorCards.length > 0 ? ':' : '.'}
            </>
          ) : 'Nothing in the deck forces the bracket on its own.'}
        </p>
        {floorCards.length > 0 && (
          <div className="flex flex-wrap gap-1.5 text-[12.5px]">
            {floorCards.map(name => (
              <ArtChip key={name} name={name} card={deckCards.get(name)} onPreview={d.onPreviewCard} />
            ))}
          </div>
        )}
        <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2.5 text-[12.5px]">
          <span className="text-muted-foreground">Power score</span>
          <div className="relative h-2 rounded-full bg-muted/70" aria-hidden="true">
            <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${vm.softScore}%`, backgroundColor: vm.accent }} />
            {vm.bumpTarget !== null && (
              <div className="absolute -top-1 -bottom-1 w-0.5 -ml-px rounded-full bg-foreground/85" style={{ left: `${vm.bumpTarget}%` }} />
            )}
          </div>
          <span className="whitespace-nowrap tabular-nums text-foreground/90">
            <span className="font-semibold">{vm.softScore}</span>/100
          </span>
        </div>
        {/* What would tip it up a bracket, in cards rather than points. Skipped when the deck already
            plays above the player's aim: that deck needs the way down, which the Bracket tab gives. */}
        {vm.bumpTarget !== null && vm.pointsToBump > 0 && est.bracket + 1 > vm.bracketMax && !(aim != null && aim < vm.bracket) && (
          <p className="text-[12.5px] text-muted-foreground">
            {(() => {
              const next = Math.min(est.bracket + 1, 5);
              const line = nextBracketLine(est.breakdown, vm.pointsToBump);
              return line
                ? <>{line} would tip it into Bracket {next}.</>
                : <>A faster, leaner build would be needed to reach Bracket {next}.</>;
            })()}
            {' '}
            <button
              type="button"
              onClick={() => d.onNavigate('bracket')}
              className="cursor-pointer text-violet-300 underline-offset-2 hover:underline"
            >
              See what counts
            </button>
          </p>
        )}
        </div>
        </div>
        </div>
      </div>

      {unrated.length > 0 && (
        <p className="rounded-lg border border-amber-400/30 bg-background/80 px-3.5 py-2.5 text-[12px] text-amber-300">
          <UnratedCombosDoor combos={unrated} onPreview={d.onPreviewCard} className="decoration-amber-300/70 hover:text-amber-200" />
          {' '}{unrated.length === 1 ? 'has' : 'have'} no community bracket rating, so the floor may be understated.
        </p>
      )}
    </PreviewShell>
  );
}
