import { useMemo } from 'react';
import { Badge } from '@/components/ui/badge';
import type { ThemeScore } from '@/services/themes';

interface Props {
  scores: ThemeScore[];
}

/**
 * The inverse view: for each card, which themes claim it. A card matching an implausible number of
 * themes is a bug signal invisible from the theme-side table — it means some definition is far too
 * loose, and you can only see it by looking down this axis.
 */
export function CardThemeTable({ scores }: Props) {
  const rows = useMemo(() => {
    const byCard = new Map<string, { theme: string; kind: string; matched: string[] }[]>();
    for (const s of scores) {
      if (s.members === 0) continue;
      for (const m of s.memberCards) {
        const list = byCard.get(m.name) ?? [];
        list.push({ theme: s.model.name, kind: s.model.kind.kind, matched: m.matched });
        byCard.set(m.name, list);
      }
    }
    return [...byCard.entries()]
      .map(([name, themes]) => ({ name, themes }))
      .sort((a, b) => b.themes.length - a.themes.length);
  }, [scores]);

  const median = rows.length > 0 ? rows[Math.floor(rows.length / 2)].themes.length : 0;
  // Well past typical is where a loose definition shows up. Relative to the deck's own median so
  // this stays meaningful whether the deck matches 5 themes or 50.
  const suspicious = Math.max(median * 3, 12);

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Sorted by how many themes claim each card. Median is <strong>{median}</strong>; anything over{' '}
        <strong>{suspicious}</strong> is flagged — that usually means one theme's definition is too loose,
        not that the card is genuinely versatile.
      </p>
      <div className="overflow-x-auto rounded-lg border border-border/40">
        <table className="w-full text-xs">
          <thead className="bg-card/50 text-muted-foreground">
            <tr className="text-left">
              <th className="p-2">Card</th>
              <th className="p-2 w-16 text-right">Themes</th>
              <th className="p-2">Claimed by</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.name} className="border-t border-border/30 align-top hover:bg-accent/20">
                <td className="p-2 font-medium whitespace-nowrap">{r.name}</td>
                <td className="p-2 text-right">
                  <Badge
                    variant="outline"
                    className={`text-[10px] px-1.5 py-0 ${
                      r.themes.length > suspicious
                        ? 'bg-amber-500/15 text-amber-300 border-amber-500/30'
                        : 'border-border/50 text-muted-foreground'
                    }`}
                  >
                    {r.themes.length}
                  </Badge>
                </td>
                <td className="p-2">
                  <div className="flex flex-wrap gap-x-2 gap-y-0.5">
                    {r.themes.map(t => (
                      <span
                        key={t.theme}
                        className={t.kind === 'archetype' ? 'text-violet-300/70' : 'text-emerald-400/70'}
                        title={`${t.kind}: ${t.matched.join(', ')}`}
                      >
                        {t.theme}
                      </span>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={3} className="p-6 text-center text-muted-foreground">No cards matched any theme.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
