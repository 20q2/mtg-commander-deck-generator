import { ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { BracketBasis } from '@/services/deckBuilder/bracketBlend';
import type { BracketGap } from './bracketGap';
import { BRACKET_HEX, type BracketViewModel } from './bracketViewModel';
import { CardPill } from './CardTile';

/**
 * What stands between the deck and the bracket the player is aiming for. Sits between the verdict
 * and the evidence; the aim itself is picked on the verdict's ladder, which re-aims Card Fit and
 * every suggestion in the Inspector.
 */
export function BracketAimSection({
  vm,
  basis,
  gap,
  commanderName,
  onPreview,
  onOpenSwaps,
}: {
  vm: BracketViewModel;
  basis: BracketBasis | null;
  /** Null while there's no aim to compare against. */
  gap: BracketGap | null;
  commanderName: string;
  onPreview: (name: string) => void;
  /** Opens Card Fit on the swaps that bring the deck down to the aim. */
  onOpenSwaps?: () => void;
}) {
  const aim = basis && basis.source !== 'estimated' ? basis.bracket : null;
  const accent = aim ? BRACKET_HEX[aim] : vm.accent;

  // Nothing to compare yet: the ladder's own hint ("Click the one you're building for") covers it.
  if (!gap) return null;

  // States with nothing to act on take one line, not a block.
  const quiet = gap.kind === 'none' ? `On your aim. Suggestions across the Inspector lean toward Bracket ${aim} ${commanderName} decks.`
    : gap.kind === 'intent'
      ? gap.aim > gap.reads
        ? `Aiming for Bracket ${gap.aim}. What separates it from 4 is how tuned the deck is, shown below.`
        : `Aiming for Bracket ${gap.aim}. This reads as 5 on power alone, so trimming fast mana and tutors brings it down.`
      : gap.kind === 'under' && (gap.rising === null || gap.rising.length === 0)
        ? (gap.rising === null
          ? `Aiming for Bracket ${gap.aim}. ${gap.bracketDecks > 0 ? `Only ${gap.bracketDecks} ${commanderName} ${gap.bracketDecks === 1 ? 'deck is' : 'decks are'}` : `Too few ${commanderName} decks are`} logged there to compare against. How tuned it is, below, shows what raises the power.`
          : `Aiming for Bracket ${gap.aim}. You already run what those ${commanderName} decks play more than the rest.`)
        : null;

  if (quiet) {
    return (
      <div className="px-7 py-3 border-b border-border/30" style={{ background: `linear-gradient(180deg, ${accent}0d, transparent)` }}>
        <p className="text-[13px] leading-relaxed text-muted-foreground max-w-[80ch]">{quiet}</p>
      </div>
    );
  }

  // Only the two states with cards to act on reach here: over the aim, or under it with a list.
  if (gap.kind !== 'over' && gap.kind !== 'under') return null;

  return (
    <div
      className="px-7 pt-6 pb-6 border-b border-border/30"
      style={{ background: `linear-gradient(180deg, ${accent}10, transparent)` }}
    >
      <h4 className="text-[15px] font-semibold text-foreground">Aiming for Bracket {gap.aim}, this plays like a {gap.reads}</h4>
      <div className="mt-3">
        <GapBody gap={gap} commanderName={commanderName} onPreview={onPreview} onOpenSwaps={onOpenSwaps} />
      </div>
    </div>
  );
}

function GapBody({ gap, commanderName, onPreview, onOpenSwaps }: {
  gap: Extract<BracketGap, { kind: 'over' | 'under' }>;
  commanderName: string;
  onPreview: (name: string) => void;
  onOpenSwaps?: () => void;
}) {
  if (gap.kind === 'over') {
    return (
      <>
        <p className="text-[13px] leading-relaxed text-muted-foreground max-w-[72ch]">
          {gap.reasons.length > 0
            ? `These hold it above Bracket ${gap.aim}.`
            : `Nothing in the deck forces it above Bracket ${gap.aim} on its own; the overall power score does.`}
        </p>
        <div className="mt-3.5 space-y-3">
          {gap.reasons.map(r => (
            <div key={r.key}>
              <div className="flex items-baseline gap-x-2 flex-wrap">
                <span className="text-[13px] font-semibold text-foreground">{r.name}</span>
                <span className="text-[12px] text-muted-foreground">{r.note}</span>
              </div>
              <div className="flex flex-wrap gap-1.5 mt-1.5">
                {r.cards.map(name => <CardPill key={name} name={name} onPreview={onPreview} />)}
              </div>
            </div>
          ))}
        </div>
        {onOpenSwaps && gap.reasons.length > 0 && (
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button type="button" size="sm" onClick={onOpenSwaps} className="gap-1.5">
              Swap them for Bracket {gap.aim} picks <ArrowRight className="w-3.5 h-3.5" />
            </Button>
            <span className="text-[12px] text-muted-foreground">
              Card Fit pairs each one with a card Bracket {gap.aim} {commanderName} decks play.
            </span>
          </div>
        )}
      </>
    );
  }

  // Under the aim with nothing to list is said in one line above; this is the list.
  const rising = gap.rising ?? [];

  return (
    <>
      <p className="text-[13px] leading-relaxed text-muted-foreground max-w-[72ch]">
        Bracket {gap.aim} {commanderName} decks play these far more than the rest:
      </p>
      <div className="flex flex-wrap gap-1.5 mt-3">
        {rising.map(r => (
          <div key={r.name} className="flex items-center gap-1.5">
            <CardPill name={r.name} onPreview={onPreview} />
            <span className="text-[11px] tabular-nums text-muted-foreground pr-1.5">
              {Math.round(r.bracketInclusion)}% vs {Math.round(r.allInclusion)}%
            </span>
          </div>
        ))}
      </div>
    </>
  );
}
