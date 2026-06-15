import { useState } from 'react';
import { useStore } from '@/store';
import { Button } from '@/components/ui/button';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { ListChecks, Star } from 'lucide-react';
import { getCardImageUrl } from '@/services/scryfall/client';
import type { ScryfallCard } from '@/types';
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

/** A popover that lists every card brewed so far — commander first, then picks grouped by type.
 *  Hovering a row pops the full card image on the left (each pick already carries its image). */
export function BrewDeckListButton() {
  const { brewContext, brewState } = useStore();
  const [preview, setPreview] = useState<{ card: ScryfallCard; y: number } | null>(null);
  if (!brewContext || !brewState) return null;

  const picks = brewState.picks;
  const total = picks.length + 1 + (brewContext.partnerCommander ? 1 : 0);

  const groups: Record<string, BrewPick[]> = {};
  for (const p of picks) (groups[typeBucket(p.card.type_line)] ??= []).push(p);

  const show = (card: ScryfallCard) => (e: React.MouseEvent) => setPreview({ card, y: e.clientY });
  const hide = () => setPreview(null);

  const Row = ({ card, name, icon }: { card: ScryfallCard; name: string; icon?: React.ReactNode }) => (
    <div
      onMouseEnter={show(card)}
      onMouseMove={show(card)}
      onMouseLeave={hide}
      className="flex items-center justify-between gap-2 py-0.5 px-1 -mx-1 rounded text-[13px] cursor-default hover:bg-violet-500/10"
    >
      <span className="flex items-center gap-1.5 min-w-0">{icon}<span className="truncate">{name}</span></span>
      <span className="text-muted-foreground/70 tabular-nums shrink-0">{card.cmc ?? 0}</span>
    </div>
  );

  return (
    <Popover onOpenChange={(o) => !o && hide()}>
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
          <div className="text-violet-200">
            <Row card={brewContext.commander} name={brewContext.commander.name} icon={<Star className="w-3 h-3 shrink-0" />} />
            {brewContext.partnerCommander && (
              <Row card={brewContext.partnerCommander} name={brewContext.partnerCommander.name} icon={<Star className="w-3 h-3 shrink-0" />} />
            )}
          </div>
        </div>

        {picks.length === 0 ? (
          <div className="text-xs text-muted-foreground py-2">No cards yet — start drafting and they'll show up here.</div>
        ) : (
          TYPE_ORDER.filter(t => groups[t]?.length).map(t => (
            <div key={t} className="mb-2">
              <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground mb-0.5">{t} · {groups[t].length}</div>
              {groups[t].map((p, i) => <Row key={`${p.name}-${i}`} card={p.card} name={p.name} />)}
            </div>
          ))
        )}

        {/* Hover preview — full card art, pinned to the left edge and tracking the hovered row. */}
        {preview && (
          <img
            key={preview.card.id}
            src={getCardImageUrl(preview.card, 'normal')}
            alt={preview.card.name}
            className="fixed left-5 z-[60] w-[250px] rounded-[4.8%] shadow-2xl ring-1 ring-black/60 pointer-events-none animate-fade-in"
            style={{ top: `clamp(12px, ${preview.y - 175}px, calc(100vh - 360px))` }}
          />
        )}
      </PopoverContent>
    </Popover>
  );
}
