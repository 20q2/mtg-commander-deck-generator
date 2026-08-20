import { useState, useMemo } from 'react';
import { ChevronRight, ChevronDown } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { describeThemeTest, type ThemeScore } from '@/services/themes';

const KIND_COLORS: Record<string, string> = {
  tribal: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  mechanic: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
  subtype: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30',
  cardType: 'bg-teal-500/15 text-teal-300 border-teal-500/30',
  curated: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  counterType: 'bg-lime-500/15 text-lime-300 border-lime-500/30',
  archetype: 'bg-violet-500/15 text-violet-300 border-violet-500/30',
  role: 'bg-muted text-muted-foreground border-border/50',
};

const KINDS = ['tribal', 'mechanic', 'subtype', 'cardType', 'curated', 'counterType', 'archetype', 'role'] as const;

interface Props {
  scores: ThemeScore[];
}

/**
 * The ranked theme table. Every score component is shown separately rather than rolled up, because
 * the whole point of this page is deciding which term is misbehaving.
 */
export function ThemeScoreTable({ scores }: Props) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [kindFilter, setKindFilter] = useState<string | null>(null);
  const [onlySurviving, setOnlySurviving] = useState(true);

  const rows = useMemo(() => {
    let r = scores.filter(s => s.members > 0);
    if (kindFilter) r = r.filter(s => s.model.kind.kind === kindFilter);
    // Mirrors survivingThemes exactly, anchors included — the filter should show what could
    // actually be declared, not merely what cleared the numeric guards.
    if (onlySurviving) r = r.filter(s => s.passedFloor && !s.suppressedBy && !s.anchorMissing);
    return r.slice(0, 200);
  }, [scores, kindFilter, onlySurviving]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const s of scores) {
      if (s.members === 0) continue;
      c[s.model.kind.kind] = (c[s.model.kind.kind] ?? 0) + 1;
    }
    return c;
  }, [scores]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => setKindFilter(null)}
          className={`text-xs px-2.5 py-1 rounded-md border transition-colors ${
            kindFilter === null ? 'bg-accent border-primary/50' : 'border-border/50 hover:bg-accent/50'
          }`}
        >
          All ({scores.filter(s => s.members > 0).length})
        </button>
        {KINDS.filter(k => counts[k]).map(k => (
          <button
            key={k}
            onClick={() => setKindFilter(kindFilter === k ? null : k)}
            className={`text-xs px-2.5 py-1 rounded-md border transition-colors ${
              kindFilter === k ? 'bg-accent border-primary/50' : 'border-border/50 hover:bg-accent/50'
            }`}
          >
            {k} ({counts[k]})
          </button>
        ))}
        <label className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
          <input
            type="checkbox"
            checked={onlySurviving}
            onChange={e => setOnlySurviving(e.target.checked)}
            className="accent-primary"
          />
          survivors only
        </label>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border/40">
        <table className="w-full text-xs">
          <thead className="bg-card/50 text-muted-foreground">
            <tr className="text-left">
              <th className="p-2 w-6" />
              <th className="p-2">Theme</th>
              <th className="p-2">Kind</th>
              <th className="p-2 text-right" title="Final Phase A score, after the prior">Score</th>
              <th className="p-2 text-right" title="Cards in the deck belonging to this theme">Members</th>
              <th className="p-2 text-right" title="members / non-land cards">Ratio</th>
              <th className="p-2 text-right" title="Share of the playable pool in this theme">Base</th>
              <th className="p-2 text-right" title="ratio ÷ base rate, capped">Lift</th>
              <th className="p-2 text-right" title="Commander-list prior">Prior</th>
              <th className="p-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(s => {
              const open = expanded === s.model.slug;
              return (
                <tr key={s.model.slug} className="border-t border-border/30 align-top">
                  <td colSpan={10} className="p-0">
                    <div
                      onClick={() => setExpanded(open ? null : s.model.slug)}
                      className="grid grid-cols-[24px_minmax(120px,1fr)_90px_60px_70px_60px_60px_55px_55px_90px] gap-0 cursor-pointer hover:bg-accent/30 transition-colors items-center"
                    >
                      <div className="p-2 text-muted-foreground">
                        {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                      </div>
                      <div className="p-2 font-medium truncate" title={s.model.name}>{s.model.name}</div>
                      <div className="p-2">
                        <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${KIND_COLORS[s.model.kind.kind]}`}>
                          {s.model.kind.kind}
                        </Badge>
                      </div>
                      <div className="p-2 text-right font-semibold text-violet-300/90">{s.membershipScore.toFixed(1)}</div>
                      <div className="p-2 text-right">{s.members}</div>
                      <div className="p-2 text-right">{(s.ratio * 100).toFixed(0)}%</div>
                      <div className="p-2 text-right text-muted-foreground">{(s.model.baseRate * 100).toFixed(1)}%</div>
                      <div className="p-2 text-right">{s.observedOverExpected.toFixed(1)}×</div>
                      <div className="p-2 text-right text-muted-foreground">{s.prior.toFixed(2)}</div>
                      <div className="p-2">
                        {s.anchorMissing ? (
                          <span className="text-sky-400/80" title={`needs ${s.anchorMissing} in the deck`}>
                            needs {s.anchorMissing.split(',')[0]}
                          </span>
                        ) : s.suppressedBy ? (
                          <span className="text-amber-400/80" title={`absorbed by ${s.suppressedBy}`}>
                            ⊂ {s.suppressedBy}
                          </span>
                        ) : !s.passedFloor ? (
                          <span className="text-muted-foreground">below floor</span>
                        ) : (
                          <span className="text-emerald-400/80">{s.onCommanderList ? 'on list' : 'off list'}</span>
                        )}
                      </div>
                    </div>

                    {open && (
                      <div className="px-9 pb-3 pt-1 bg-card/20 space-y-2">
                        {/* Always say how membership was decided. Deterministic kinds test the card
                            itself, so name the literal test; archetypes have only the tag list. */}
                        {/* Show EVERY test a theme uses, not just the first. Rendering only the
                            literal one hid the fact that Battles was also matching cantrips through
                            `hand-neutral` — the breakdown claimed 'card type "battle"' while the
                            matched cards told a different story. */}
                        <div className="text-[11px] text-muted-foreground space-x-1">
                          <span>Definition:</span>
                          {describeThemeTest(s.model.kind) && (
                            <code className="px-1 rounded bg-emerald-500/10 text-emerald-300/90">
                              {describeThemeTest(s.model.kind)}
                            </code>
                          )}
                          {describeThemeTest(s.model.kind) && s.model.charTags.length > 0 && <span>+</span>}
                          {s.model.charTags.map(t => (
                            <code key={t} className="px-1 rounded bg-violet-500/10 text-violet-300/90">{t}</code>
                          ))}
                          {!describeThemeTest(s.model.kind) && s.model.charTags.length === 0 && (
                            <span className="text-amber-400/70">nothing — run npm run build:theme-tags</span>
                          )}
                        </div>
                        <div className="text-[11px] text-muted-foreground">
                          {s.memberCards.length} matching card{s.memberCards.length === 1 ? '' : 's'}:
                        </div>
                        <div className="grid gap-x-4 gap-y-0.5 sm:grid-cols-2 lg:grid-cols-3 text-[11px]">
                          {s.memberCards.map(m => (
                            <div key={m.name} className="flex gap-1.5 min-w-0">
                              <span className="truncate">{m.name}</span>
                              <span className={m.basis === 'literal' ? 'text-emerald-400/70' : 'text-violet-300/70'}>
                                {m.matched.join(', ')}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr><td colSpan={10} className="p-6 text-center text-muted-foreground">No themes matched.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
