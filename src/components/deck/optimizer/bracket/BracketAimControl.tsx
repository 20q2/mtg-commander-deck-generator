// src/components/deck/optimizer/bracket/BracketAimControl.tsx
//
// The two readings side by side: where the deck plays, and where the player is aiming it. The aim
// box is a dropdown that opens the bracket picker underneath. The Overview's bracket panel uses it;
// the Bracket tab picks the aim on its verdict ladder instead.
import { useId, useState, type ReactNode } from 'react';
import { ChevronDown, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { IntendedBracket } from '@/types';
import type { BracketBasis } from '@/services/deckBuilder/bracketBlend';
import { BRACKET_COLORS, BRACKET_DESCRIPTIONS, BRACKET_LABELS } from '../constants';
import { BRACKET_HEX, type BracketViewModel } from './bracketViewModel';

const BRACKETS = [1, 2, 3, 4, 5] as const;

/** One of the two readings: a bracket, its name, and where the reading comes from. */
function Reading({ label, value, name, hex, note }: {
  label: string;
  value: string;
  name?: string;
  hex?: string;
  note: ReactNode;
}) {
  return (
    <div
      className="flex min-w-0 flex-col gap-1 rounded-lg border bg-background/80 px-3.5 py-3"
      style={{ borderColor: hex ? `${hex}66` : undefined }}
    >
      <span className="text-[12px] font-medium text-muted-foreground">{label}</span>
      <span className="flex flex-wrap items-baseline gap-x-2">
        <span className="text-xl font-semibold leading-tight tabular-nums" style={{ color: hex ?? undefined }}>{value}</span>
        {name && <span className="text-[13px] font-medium text-foreground/85">{name}</span>}
      </span>
      <span className="text-[12px] leading-snug text-muted-foreground">{note}</span>
    </div>
  );
}

export function BracketAimControl({ vm, basis, refreshing, onChange, className }: {
  vm: BracketViewModel;
  basis: BracketBasis | null;
  /** True while suggestions are being re-read for a new aim. */
  refreshing: boolean;
  /** Absent where the aim can't be changed: the aim box is then a plain reading. */
  onChange?: (bracket: IntendedBracket | null) => void;
  className?: string;
}) {
  const [picking, setPicking] = useState(false);
  const pickerId = useId();
  const aim = basis && basis.source !== 'estimated' ? basis.bracket : null;
  const reads = (n: number) => n >= vm.bracket && n <= vm.bracketMax;
  const aimHex = aim ? BRACKET_HEX[aim] : undefined;
  const aimNote = refreshing
    ? <span className="flex items-center gap-1.5" role="status"><Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" /> Re-aiming suggestions</span>
    : basis?.source === 'set' ? 'Set by you. Suggestions across the Inspector aim here.'
      : basis?.source === 'generated' ? 'The bracket it was built at.'
        : onChange ? 'Pick one and the suggestions aim there.' : 'Set it on the Bracket tab.';

  return (
    <div className={cn('flex flex-col gap-2.5', className)}>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Reading label="Plays like" value={vm.bracketLabel} name={vm.label} hex={vm.accent} note="Read from the cards in the deck." />
        {onChange ? (
          <button
            type="button"
            aria-expanded={picking}
            aria-controls={pickerId}
            onClick={() => setPicking(p => !p)}
            // Dashed and darker than the reading beside it: the one box here you can change.
            className={cn(
              'group relative flex min-w-0 cursor-pointer flex-col gap-1 rounded-lg border border-dashed bg-black/45 px-3.5 py-3 pr-10 text-left transition-colors',
              'hover:bg-black/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
              !aimHex && 'border-foreground/30 hover:border-foreground/55',
            )}
            style={{ borderColor: aimHex ? `${aimHex}${picking ? 'e6' : '99'}` : undefined }}
          >
            <ChevronDown
              className={cn(
                'absolute right-3 top-1/2 w-5 h-5 -translate-y-1/2 text-muted-foreground transition-[transform,color] duration-200 group-hover:text-foreground motion-reduce:transition-none',
                picking && 'rotate-180 text-foreground',
              )}
              aria-hidden="true"
            />
            <span className="text-[12px] font-medium text-muted-foreground">You're aiming for</span>
            <span className="flex flex-wrap items-baseline gap-x-2">
              <span className="text-xl font-semibold leading-tight tabular-nums" style={{ color: aimHex }}>{aim ? `Bracket ${aim}` : 'Not set'}</span>
              {aim && <span className="text-[13px] font-medium text-foreground/85">{BRACKET_LABELS[aim]}</span>}
            </span>
            <span className="text-[12px] leading-snug text-muted-foreground">{aimNote}</span>
          </button>
        ) : (
          <Reading
            label="You're aiming for"
            value={aim ? `Bracket ${aim}` : 'Not set'}
            name={aim ? BRACKET_LABELS[aim] : undefined}
            hex={aimHex}
            note={aimNote}
          />
        )}
      </div>

      {onChange && (
        // Opens under the two readings. Collapsed it is invisible, so its buttons leave the tab order.
        <div
          id={pickerId}
          className={cn(
            'grid transition-[grid-template-rows,margin,visibility,opacity] duration-300 ease-[cubic-bezier(0.2,0.7,0.2,1)] motion-reduce:transition-none',
            picking ? 'visible grid-rows-[1fr] opacity-100' : 'invisible -mt-2.5 grid-rows-[0fr] opacity-0',
          )}
        >
        <div className="min-h-0 overflow-hidden">
        <div className="rounded-lg border border-border/60 bg-background/80 px-3.5 py-3">
          <span className="mb-2.5 block text-[13px] font-semibold text-foreground">Which bracket are you building for?</span>
          <div className="grid grid-cols-5 gap-1" role="radiogroup" aria-label="Bracket you're aiming for">
            {BRACKETS.map(b => {
              const isAim = aim === b;
              const c = BRACKET_COLORS[b];
              return (
                <button
                  key={b}
                  type="button"
                  role="radio"
                  aria-checked={isAim}
                  disabled={refreshing}
                  // Clicking the aim you set clears it.
                  onClick={() => { onChange(isAim && basis?.source === 'set' ? null : b as IntendedBracket); setPicking(false); }}
                  title={`${BRACKET_LABELS[b]}: ${BRACKET_DESCRIPTIONS[b]}`}
                  className={cn(
                    'relative flex cursor-pointer flex-col items-center rounded-md border px-1 py-2 leading-tight shadow-sm transition-[background-color,border-color,transform] duration-200',
                    'hover:-translate-y-px motion-reduce:hover:translate-y-0',
                    'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-wait',
                    isAim ? `${c.bg} ${c.border} border-2` : 'border-border/70 bg-card hover:border-foreground/40 hover:bg-accent/50',
                  )}
                >
                  <span className={cn('text-base font-bold tabular-nums', isAim ? c.text : 'text-foreground/80')}>{b}</span>
                  <span className={cn('max-w-full truncate text-[10px] sm:text-[10.5px]', isAim ? c.text : 'text-muted-foreground')}>{BRACKET_LABELS[b]}</span>
                  {/* Where the deck plays now, so the aim reads against it. */}
                  {reads(b) && (
                    <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full" style={{ backgroundColor: BRACKET_HEX[b] }}
                      title="Where the deck plays now" aria-label="plays here now" />
                  )}
                </button>
              );
            })}
          </div>
          <p className="mt-2.5 flex items-center gap-1.5 text-[11.5px] leading-snug text-muted-foreground">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: vm.accent }} aria-hidden="true" />
            Where it plays now. Card Fit and the suggestions aim at the one you pick; pick it again to clear.
          </p>
        </div>
        </div>
        </div>
      )}
    </div>
  );
}
