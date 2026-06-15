import { useStore } from '@/store';
import { Button } from '@/components/ui/button';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { ListChecks, Star } from 'lucide-react';
import type { BrewPick } from '@/services/brew/engine';

const TYPE_ORDER = ['Creature', 'Planeswalker', 'Instant', 'Sorcery', 'Artifact', 'Enchantment', 'Battle', 'Other'];

/** Single-bucket card type from a type line (front face), for grouping the list like a deck list. */
function typeBucket(typeLine: string): string {
  const tl = (typeLine.split('//')[0] ?? '').toLowerCase();
  if (tl.includes('creature')) return 'Creature';
  if (tl.includes('planeswalker')) return 'Planeswalker';
  if (tl.includes('instant')) return 'Instant';
  if (tl.includes('sorcery')) return 'Sorcery';
  if (tl.includes('artifact')) return 'Artifact';
  if (tl.includes('enchantment')) return 'Enchantment';
  if (tl.includes('battle')) return 'Battle';
  return 'Other';
}

/** A popover that lists every card brewed so far — commander first, then picks grouped by type. */
export function BrewDeckListButton() {
  const { brewContext, brewState } = useStore();
  if (!brewContext || !brewState) return null;

  const picks = brewState.picks;
  const total = picks.length + 1 + (brewContext.partnerCommander ? 1 : 0);

  const groups: Record<string, BrewPick[]> = {};
  for (const p of picks) (groups[typeBucket(p.card.type_line)] ??= []).push(p);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-violet-200 hover:text-violet-100">
          <ListChecks className="w-3.5 h-3.5 mr-1" /> Deck list
        </Button>
      </PopoverTrigger>
      <PopoverContent side="bottom" align="end" className="w-72 max-h-[70vh] overflow-y-auto p-3">
        <div className="flex items-center justify-between mb-2">
          <span className="font-semibold text-sm">Your deck so far</span>
          <span className="text-xs text-muted-foreground tabular-nums">{total} {total === 1 ? 'card' : 'cards'}</span>
        </div>

        <div className="mb-2">
          <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground mb-0.5">Commander</div>
          <div className="flex items-center gap-1.5 text-[13px] text-violet-200 py-0.5">
            <Star className="w-3 h-3 shrink-0" /> <span className="truncate">{brewContext.commander.name}</span>
          </div>
          {brewContext.partnerCommander && (
            <div className="flex items-center gap-1.5 text-[13px] text-violet-200 py-0.5">
              <Star className="w-3 h-3 shrink-0" /> <span className="truncate">{brewContext.partnerCommander.name}</span>
            </div>
          )}
        </div>

        {picks.length === 0 ? (
          <div className="text-xs text-muted-foreground py-2">No cards yet — start drafting and they'll show up here.</div>
        ) : (
          TYPE_ORDER.filter(t => groups[t]?.length).map(t => (
            <div key={t} className="mb-2">
              <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground mb-0.5">{t} · {groups[t].length}</div>
              {groups[t].map((p, i) => (
                <div key={`${p.name}-${i}`} className="flex items-center justify-between gap-2 py-0.5 text-[13px]">
                  <span className="truncate">{p.name}</span>
                  <span className="text-muted-foreground/70 tabular-nums shrink-0">{p.card.cmc ?? 0}</span>
                </div>
              ))}
            </div>
          ))
        )}
      </PopoverContent>
    </Popover>
  );
}
