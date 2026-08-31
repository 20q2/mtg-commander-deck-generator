import type { DeckFuel, DeckFinisherVerdict } from '@/types';
import { bodiesOnBoard, manaCeiling, type FinisherAssumptions } from '@/services/finishers';

interface Props { fuel: DeckFuel; verdict: DeckFinisherVerdict; assumptions: FinisherAssumptions }

/** What the deck actually brings, and the one-line read on whether it can close. */
export function DeckFuelStrip({ fuel, verdict, assumptions }: Props) {
  const bodies = bodiesOnBoard(fuel, assumptions);
  const mana = manaCeiling(fuel, assumptions);
  const devotion = Object.entries(fuel.devotion)
    .filter(([, n]) => n > 0)
    .map(([c, n]) => `${c}${n}`)
    .join(' ');

  const tone = verdict.bestSingle < assumptions.liveThreshold
    ? 'border-red-500/40 bg-red-500/5 text-red-300'
    : verdict.bestSingle < 0.6
      ? 'border-amber-500/40 bg-amber-500/5 text-amber-300'
      : 'border-emerald-500/40 bg-emerald-500/5 text-emerald-300';

  return (
    <div className="space-y-2">
      <div className={`rounded-lg border px-3 py-2 text-xs flex flex-wrap items-center gap-x-4 gap-y-1 ${tone}`}>
        <span className="font-semibold uppercase">{verdict.label}</span>
        <span className="text-muted-foreground">
          best single <strong>{verdict.bestSingle.toFixed(2)}</strong> table
        </span>
        <span className="text-muted-foreground">
          combined <strong>{verdict.combined.toFixed(2)}</strong>
        </span>
        <span className="text-muted-foreground">
          <strong>{verdict.density}</strong> live finisher{verdict.density === 1 ? '' : 's'}
        </span>
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-1.5 text-xs rounded-lg border border-border/40 bg-card/30 px-3 py-2 text-muted-foreground">
        <span>{fuel.creatureCount} creatures ({fuel.avgPower.toFixed(1)} avg power)</span>
        <span>{fuel.tokenMakers} token makers</span>
        <span className="text-violet-300/90">→ {bodies} bodies at T{assumptions.turn}</span>
        <span>{fuel.landCount} lands · {fuel.rampCount} ramp</span>
        <span className="text-violet-300/90">→ {mana.toFixed(1)} mana at T{assumptions.turn}</span>
        {devotion && <span>devotion {devotion}</span>}
        <span>{fuel.trampleGranters} trample · {fuel.hasteGranters} haste · {fuel.anthems} anthems</span>
      </div>
    </div>
  );
}
