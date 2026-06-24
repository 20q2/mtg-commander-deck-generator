import { useState } from 'react';
import { Upload, Loader2 } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { getCardsByNames } from '@/services/scryfall/client';
import { useUserLists } from '@/hooks/useUserLists';
import type { ScryfallCard } from '@/types';

// Parse a pasted decklist: strip leading counts ("3x", "1 ", "2") and set/collector
// suffixes in parens; keep the card name. One name per line, blanks ignored.
export function parseDecklist(text: string): string[] {
  const names: string[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(/^(?:\d+x?\s+)?([^(\n]+?)(?:\s*\([^)]*\).*)?$/i);
    const name = (m?.[1] ?? line).trim();
    if (name) names.push(name);
  }
  return names;
}

export function DeckInput({ onLoad, label = 'Load a deck' }: { onLoad: (cards: ScryfallCard[], source?: string) => void; label?: string }) {
  const { lists } = useUserLists();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  const resolve = async (names: string[], source?: string) => {
    if (names.length === 0) return;
    setBusy(true);
    try {
      const map = await getCardsByNames(names);
      const cards = names.map(n => map.get(n)).filter((c): c is ScryfallCard => !!c);
      if (cards.length > 0) { onLoad(cards, source); setOpen(false); setText(''); }
    } finally {
      setBusy(false);
    }
  };

  const savedDecks = lists.filter(l => l.cards.length > 0);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
          {label}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-3 space-y-3">
        <div>
          <p className="text-xs font-semibold text-foreground mb-1.5">Paste a decklist</p>
          <textarea
            value={text}
            onChange={e => setText(e.target.value)}
            rows={5}
            placeholder={'1 Sol Ring\n1 Cultivate\nBeast Within'}
            className="w-full text-xs rounded-md bg-background border border-border/60 p-2 resize-y focus:outline-none focus:ring-1 focus:ring-primary/50"
          />
          <Button size="sm" className="w-full mt-1.5" disabled={busy || text.trim() === ''}
            onClick={() => resolve(parseDecklist(text), 'paste')}>
            {busy ? 'Loading…' : 'Load pasted list'}
          </Button>
        </div>

        {savedDecks.length > 0 && (
          <div className="border-t border-border/50 pt-2">
            <p className="text-xs font-semibold text-foreground mb-1.5">Or load a saved one</p>
            <div className="max-h-44 overflow-y-auto flex flex-col">
              {savedDecks.map(list => (
                <button key={list.id} type="button" disabled={busy}
                  onClick={() => resolve(list.cards, 'list')}
                  className="text-left px-2 py-1.5 rounded hover:bg-accent transition-colors flex items-center justify-between gap-2">
                  <span className="text-sm truncate">{list.name}</span>
                  <span className="text-[10px] text-muted-foreground shrink-0">{list.cards.length}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
