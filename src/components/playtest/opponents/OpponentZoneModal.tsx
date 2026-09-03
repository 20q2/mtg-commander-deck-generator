import { useRef, useState } from 'react';
import { usePlaytestStore } from '@/store/playtestStore';
import { useOpponentStore } from '@/store/opponentStore';
import { getCardImageUrl } from '@/services/scryfall/client';
import { FloatingDialog } from '@/components/playtest/FloatingDialog';
import { MagnifiedPreview } from '@/components/playtest/MagnifiedPreview';
import { useMagnifyKey } from '@/hooks/useMagnifyKey';
import { Input } from '@/components/ui/input';
import type { ScryfallCard } from '@/types';

/**
 * Read-only viewer for a bot's graveyard or exile, matching the player's own
 * zone viewer in shape. Read-only on purpose: pulling cards out of a bot's
 * graveyard is a rules argument, not a goldfish feature — use the card menu on
 * their battlefield for the things you actually need.
 */
export function OpponentZoneModal({ opponentId, zone }: { opponentId: string; zone: 'graveyard' | 'exile' }) {
  const closeModal = usePlaytestStore(s => s.closeModal);
  const opponent = useOpponentStore(s => s.opponents.find(o => o.id === opponentId));
  const [q, setQ] = useState('');

  if (!opponent) return null;
  const cards = zone === 'graveyard' ? opponent.graveyard : opponent.exile;
  const filtered = q
    ? cards.filter(c =>
        c.name.toLowerCase().includes(q.toLowerCase()) ||
        c.type_line.toLowerCase().includes(q.toLowerCase()))
    : cards;

  return (
    <FloatingDialog
      title={`${opponent.name} · ${zone === 'graveyard' ? 'Graveyard' : 'Exile'} (${cards.length})`}
      onClose={closeModal}
      width={560}
      resizable
      storageKey={`playtest-opponent-zone-pos`}
      sizeStorageKey={`playtest-opponent-zone-size`}
    >
      <div className="p-3 space-y-3">
        {cards.length > 0 && (
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Filter by name or type…"
            className="h-8 text-xs"
          />
        )}
        {filtered.length === 0 ? (
          <div className="py-8 text-center text-xs text-muted-foreground">
            {cards.length === 0 ? `Nothing in ${zone}.` : 'No matches.'}
          </div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(88px,1fr))] gap-2">
            {filtered.map((card, i) => <ZoneCard key={`${card.id}-${i}`} card={card} />)}
          </div>
        )}
      </div>
    </FloatingDialog>
  );
}

function ZoneCard({ card }: { card: ScryfallCard }) {
  const [hovered, setHovered] = useState(false);
  const magnify = useMagnifyKey();
  const ref = useRef<HTMLDivElement | null>(null);

  return (
    <div
      ref={ref}
      className="relative"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <img
        src={getCardImageUrl(card, 'small')}
        alt={card.name}
        title={`${card.name} · hold Ctrl to magnify`}
        className="w-full rounded-[4px] shadow"
        draggable={false}
      />
      {magnify && hovered && <MagnifiedPreview card={card} anchorRef={ref} />}
    </div>
  );
}
