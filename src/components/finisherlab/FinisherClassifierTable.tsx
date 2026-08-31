import type { ScryfallCard, ShapeMatch, KillEstimate } from '@/types';

export interface ClassifiedCard {
  card: ScryfallCard;
  matches: ShapeMatch[];
  estimates: KillEstimate[];
}

const TIER_TONE: Record<string, string> = {
  LIVE: 'text-emerald-300',
  WEAK: 'text-amber-300',
  DEAD: 'text-muted-foreground',
  UNKNOWN: 'text-violet-300/80',
};

/** Which cards carry a shape at all, and whether this deck turns them on. */
export function FinisherClassifierTable({ rows }: { rows: ClassifiedCard[] }) {
  const matched = rows.filter(r => r.matches.length > 0);

  if (matched.length === 0) {
    return (
      <p className="text-xs text-muted-foreground rounded-lg border border-border/40 bg-card/30 px-3 py-4">
        No card in this deck matched any finisher shape. If that looks wrong, check the tag sizes in
        the vocabulary panel — a tag at 0 cards means the query is bad.
      </p>
    );
  }

  return (
    <div className="rounded-lg border border-border/40 overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="bg-card/50 text-muted-foreground">
          <tr>
            <th className="text-left font-medium px-3 py-2">Card</th>
            <th className="text-left font-medium px-3 py-2">Shape</th>
            <th className="text-left font-medium px-3 py-2">Tier</th>
            <th className="text-left font-medium px-3 py-2">Reason</th>
          </tr>
        </thead>
        <tbody>
          {matched.flatMap(r => r.estimates.map((est, i) => (
            <tr key={`${r.card.name}-${est.shape}`} className="border-t border-border/30">
              <td className="px-3 py-1.5">{i === 0 ? r.card.name : ''}</td>
              <td className="px-3 py-1.5 font-mono text-[11px]">{est.shape}</td>
              <td className={`px-3 py-1.5 font-semibold ${TIER_TONE[est.tier]}`}>{est.tier}</td>
              <td className="px-3 py-1.5 text-muted-foreground">
                {r.matches[i]?.basis} · {est.workings}
              </td>
            </tr>
          )))}
        </tbody>
      </table>
    </div>
  );
}
