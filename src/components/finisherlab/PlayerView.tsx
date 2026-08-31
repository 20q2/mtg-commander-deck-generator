import type { KillEstimate, DeckFuel, DeckFinisherVerdict, DetectedCombo } from '@/types';
import type { BracketEstimation } from '@/services/deckBuilder/bracketEstimator';
import { bracketLabelFor } from '@/services/deckBuilder/bracketEstimator';
import { describeDeck, describeEstimate, type FinisherAssumptions } from '@/services/finishers';

interface Props {
  estimates: KillEstimate[];
  fuel: DeckFuel;
  verdict: DeckFinisherVerdict;
  combos: DetectedCombo[];
  assumptions: FinisherAssumptions;
  bracket: BracketEstimation | null;
}

/**
 * What a player would actually be shown — no table fractions, no shape slugs, no jargon.
 *
 * The two dev views answer "is the model right". This one answers "how does my deck win", which
 * is the question the whole thing exists to serve. Every sentence is derived from the same
 * numbers the Kill math view prints, so the two can never disagree.
 */
export function PlayerView({ estimates, fuel, verdict, combos, assumptions, bracket }: Props) {
  const narrative = describeDeck(estimates, fuel, verdict, combos, assumptions);

  // Rank, drop what a player gains nothing from, then GROUP identical sentences. An aristocrats
  // deck otherwise prints "drains every opponent out once the sacrifice loop is running" three
  // times in a row, which reads like a bug rather than like redundancy.
  const grouped = new Map<string, string[]>();
  for (const e of estimates) {
    if (e.kind === 'unknown') continue;
    const line = describeEstimate(e, fuel, assumptions);
    const names = grouped.get(line) ?? [];
    names.push(e.cardName);
    grouped.set(line, names);
  }
  const shown = [...grouped.entries()].slice(0, 6);

  const tone = verdict.bestSingle >= 0.6
    ? 'border-emerald-500/40 bg-emerald-500/[0.07]'
    : verdict.bestSingle >= assumptions.liveThreshold
      ? 'border-amber-500/40 bg-amber-500/[0.07]'
      : 'border-red-500/40 bg-red-500/[0.07]';

  return (
    <div className="space-y-4">
      <div className={`rounded-xl border px-5 py-4 ${tone}`}>
        <p className="text-base font-semibold leading-snug">{narrative.headline}</p>
        {narrative.condition && (
          <p className="text-sm text-muted-foreground mt-1">{narrative.condition}</p>
        )}
        {bracket && (
          <div className="mt-3 pt-3 border-t border-border/30 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="text-sm font-medium">
              {bracketLabelFor(bracket.bracket, bracket.bracketMax)}
            </span>
            <span className="text-xs text-muted-foreground">{bracket.label}</span>
            {/* The bracket is what makes "can it close" mean anything — a turn-8 kill is slow at
                bracket 4 and oppressive at bracket 2. Same deck, opposite reading. */}
            <span className="text-xs text-muted-foreground">
              {bracket.hardFloors.length > 0
                ? bracket.hardFloors.map(f => f.reason).join(' · ')
                : 'nothing here forces a higher bracket'}
            </span>
          </div>
        )}
      </div>

      {shown.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold mb-2">How it closes</h3>
          <ul className="space-y-1.5">
            {shown.map(([line, names]) => (
              <li
                key={line}
                className="flex flex-wrap items-baseline gap-x-2 text-sm rounded-lg border border-border/40 bg-card/30 px-3 py-2"
              >
                <span className="font-medium">
                  {names.length > 1
                    ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
                    : names[0]}
                </span>
                <span className="text-muted-foreground">{line}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {narrative.caveats.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold mb-2">Worth knowing</h3>
          <ul className="space-y-1">
            {narrative.caveats.map(c => (
              <li key={c} className="text-xs text-muted-foreground flex gap-2">
                <span aria-hidden className="text-muted-foreground/60">·</span>{c}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
