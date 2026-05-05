import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { usePlaytestStore } from '@/store/playtestStore';
import { getCardImageUrl } from '@/services/scryfall/client';

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

  return createPortal(
    <div className="fixed inset-0 z-[100] bg-background/90 backdrop-blur-sm flex flex-col p-6">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold">Search Library ({filtered.length} of {library.length})</h2>
        <Button variant="ghost" size="icon" onClick={closeModal}><X className="w-4 h-4" /></Button>
      </div>
      <Input autoFocus placeholder="Search by name or type…" value={q} onChange={e => setQ(e.target.value)} className="mb-4" />
      <div className="flex-1 overflow-y-auto">
        <div className="grid grid-cols-[repeat(auto-fill,minmax(110px,1fr))] gap-2">
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
      </div>
    </div>,
    document.body,
  );
}
