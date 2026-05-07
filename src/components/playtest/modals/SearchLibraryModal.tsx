import { useMemo, useState } from 'react';
import { Input } from '@/components/ui/input';
import { usePlaytestStore } from '@/store/playtestStore';
import { getCardImageUrl } from '@/services/scryfall/client';
import { FloatingDialog } from '@/components/playtest/FloatingDialog';

export function SearchLibraryModal() {
  const library = usePlaytestStore(s => s.zones.library);
  const closeModal = usePlaytestStore(s => s.closeModal);
  const searchLibraryTakeToHand = usePlaytestStore(s => s.searchLibraryTakeToHand);
  const [q, setQ] = useState('');

  const filtered = useMemo(() => {
    const needle = q.toLowerCase().trim();
    if (!needle) return library;
    return library.filter(c =>
      c.name.toLowerCase().includes(needle) ||
      c.type_line.toLowerCase().includes(needle),
    );
  }, [library, q]);

  const title = (
    <>
      Search Library
      <span className="text-muted-foreground font-normal ml-1.5">
        ({filtered.length}{filtered.length !== library.length ? ` of ${library.length}` : ''})
      </span>
    </>
  );

  return (
    <FloatingDialog title={title} onClose={closeModal}>
      <div className="px-5 py-3 border-b border-border/40">
        <Input
          autoFocus
          placeholder="Search by name or type…"
          value={q}
          onChange={e => setQ(e.target.value)}
        />
      </div>
      <div className="flex-1 overflow-y-auto px-5 py-4">
        {filtered.length === 0 ? (
          <div className="text-sm text-muted-foreground italic text-center py-10">
            {library.length === 0 ? 'Library is empty.' : 'No cards match the filter.'}
          </div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(92px,1fr))] gap-2.5">
            {filtered.map(card => (
              <button
                key={card.id}
                onClick={() => searchLibraryTakeToHand(card.id)}
                className="rounded-[5px] transition-all hover:ring-2 hover:ring-primary"
                title={`Take ${card.name} (and shuffle)`}
              >
                <img src={getCardImageUrl(card, 'small')} alt={card.name} className="w-full rounded-[5px] shadow" />
              </button>
            ))}
          </div>
        )}
      </div>
    </FloatingDialog>
  );
}
