import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { usePlaytestStore } from '@/store/playtestStore';
import { getCardImageUrl } from '@/services/scryfall/client';
import type { ZoneKey } from '@/components/playtest/types';

const ZONE_LABEL: Record<string, string> = { library: 'Library', graveyard: 'Graveyard', exile: 'Exile', command: 'Command Zone' };

export function ZoneViewerModal() {
  const modal = usePlaytestStore(s => s.modal);
  const zones = usePlaytestStore(s => s.zones);
  const closeModal = usePlaytestStore(s => s.closeModal);
  const moveCard = usePlaytestStore(s => s.moveCard);

  if (!modal || modal.kind !== 'zoneViewer') return null;
  const zone = modal.zone;
  const cards = zones[zone];

  const moveTo = (idx: number, target: 'hand' | 'graveyard' | 'exile' | 'command' | 'libtop' | 'libbot') => {
    const source: { kind: 'zone'; zone: Exclude<ZoneKey, 'hand'>; index: number } = { kind: 'zone', zone, index: idx };
    if (target === 'libtop') moveCard({ source, target: { kind: 'library', position: 'top' } });
    else if (target === 'libbot') moveCard({ source, target: { kind: 'library', position: 'bottom' } });
    else moveCard({ source, target: { kind: 'zone', zone: target } });
  };

  return createPortal(
    <div className="fixed inset-0 z-[100] bg-background/90 backdrop-blur-sm flex flex-col p-6">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold">{ZONE_LABEL[zone]} ({cards.length})</h2>
        <Button variant="ghost" size="icon" onClick={closeModal}><X className="w-4 h-4" /></Button>
      </div>
      <div className="flex-1 overflow-y-auto">
        <div className="grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-2">
          {cards.map((card, i) => (
            <Popover key={`${card.id}-${i}`}>
              <PopoverTrigger asChild>
                <button className="rounded-[5px] hover:ring-2 hover:ring-primary transition-all">
                  <img src={getCardImageUrl(card, 'small')} alt={card.name} className="w-full rounded-[5px] shadow" />
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-44 p-1">
                <Button variant="ghost" size="sm" className="w-full justify-start" onClick={() => moveTo(i, 'hand')}>To Hand</Button>
                {zone !== 'library' && <Button variant="ghost" size="sm" className="w-full justify-start" onClick={() => moveTo(i, 'libtop')}>To Library Top</Button>}
                {zone !== 'library' && <Button variant="ghost" size="sm" className="w-full justify-start" onClick={() => moveTo(i, 'libbot')}>To Library Bottom</Button>}
                {zone !== 'graveyard' && <Button variant="ghost" size="sm" className="w-full justify-start" onClick={() => moveTo(i, 'graveyard')}>To Graveyard</Button>}
                {zone !== 'exile' && <Button variant="ghost" size="sm" className="w-full justify-start" onClick={() => moveTo(i, 'exile')}>To Exile</Button>}
                {zone !== 'command' && <Button variant="ghost" size="sm" className="w-full justify-start" onClick={() => moveTo(i, 'command')}>To Command Zone</Button>}
              </PopoverContent>
            </Popover>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}
