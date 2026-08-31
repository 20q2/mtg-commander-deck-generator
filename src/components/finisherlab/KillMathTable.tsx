import type { KillEstimate } from '@/types';

/** Sorted by table fraction. Raw damage sits alongside as the sanity check on the model. */
export function KillMathTable({ estimates }: { estimates: KillEstimate[] }) {
  if (estimates.length === 0) {
    return (
      <p className="text-xs text-muted-foreground rounded-lg border border-border/40 bg-card/30 px-3 py-4">
        Nothing to score.
      </p>
    );
  }

  return (
    <div className="rounded-lg border border-border/40 overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="bg-card/50 text-muted-foreground">
          <tr>
            <th className="text-left font-medium px-3 py-2">Card</th>
            <th className="text-left font-medium px-3 py-2">Workings</th>
            <th className="text-right font-medium px-3 py-2">Damage</th>
            <th className="text-right font-medium px-3 py-2" title="Damage discarded by the single-target cap">
              Wasted
            </th>
            <th className="text-right font-medium px-3 py-2">Table</th>
          </tr>
        </thead>
        <tbody>
          {estimates.map(e => (
            <tr key={`${e.cardName}-${e.shape}`} className="border-t border-border/30">
              <td className="px-3 py-1.5">{e.cardName}</td>
              <td className="px-3 py-1.5 text-muted-foreground">{e.workings}</td>
              <td className="px-3 py-1.5 text-right tabular-nums">{e.damage ?? '—'}</td>
              <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">
                {e.overkill > 0 ? e.overkill : '—'}
              </td>
              <td className="px-3 py-1.5 text-right tabular-nums text-violet-300/90 font-semibold">
                {e.tableFraction === null
                  ? (e.kind === 'modifier' ? 'mult' : '?')
                  : e.tableFraction.toFixed(3)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
