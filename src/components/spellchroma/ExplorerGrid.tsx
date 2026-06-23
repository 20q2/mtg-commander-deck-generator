import { useMemo, useState } from 'react';
import type { ScryfallCard } from '@/types';
import { getCardImageUrl } from '@/services/scryfall/client';
import { CardPreviewModal } from '@/components/ui/CardPreviewModal';
import { Button } from '@/components/ui/button';

interface ExplorerGridProps {
  cards: ScryfallCard[];
  total: number;
  hasMore: boolean;
  loading: boolean;
  loadingAll: boolean;
  error: boolean;
  hasTags: boolean;       // any tags selected?
  textFilter: string;
  onLoadAll: () => void;
  onTagClick?: (slug: string) => void;
}

export function ExplorerGrid({
  cards, total, hasMore, loading, loadingAll, error, hasTags, textFilter, onLoadAll, onTagClick,
}: ExplorerGridProps) {
  const [preview, setPreview] = useState<ScryfallCard | null>(null);

  const filtered = useMemo(() => {
    const q = textFilter.trim().toLowerCase();
    if (!q) return cards;
    return cards.filter(c =>
      c.name.toLowerCase().includes(q) ||
      c.oracle_text?.toLowerCase().includes(q) ||
      c.card_faces?.some(f => f.name?.toLowerCase().includes(q) || f.oracle_text?.toLowerCase().includes(q)),
    );
  }, [cards, textFilter]);

  // States that pre-empt the grid.
  if (!hasTags) {
    return <Empty title="Pick a tag to start exploring" sub="Add an oracle tag above — try “ramp”, “sacrifice-outlet”, or “treasure”." />;
  }
  if (error) {
    return <Empty title="Search failed" sub="Scryfall didn’t respond. Try again or change tags." />;
  }
  if (loading && cards.length === 0) {
    return <Empty title="Searching…" sub="Pulling matching cards from Scryfall." />;
  }
  if (cards.length === 0) {
    return <Empty title="No cards match those tags" sub="Try fewer tags or a wider color identity." />;
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between text-xs text-muted-foreground px-1">
        <span>
          {filtered.length === cards.length
            ? `Showing ${cards.length} of ${total}`
            : `Showing ${filtered.length} of ${cards.length} loaded (${total} total)`}
        </span>
        {hasMore && (
          <Button variant="outline" size="sm" onClick={onLoadAll} disabled={loadingAll}>
            {loadingAll ? 'Loading…' : `Load all ${total}`}
          </Button>
        )}
      </div>

      <div className="grid gap-2 grid-cols-[repeat(auto-fill,minmax(7.5rem,1fr))]">
        {filtered.map(card => (
          <button key={card.id} type="button" onClick={() => setPreview(card)}
            className="group relative aspect-[5/7] rounded-lg overflow-hidden focus:outline-none focus-visible:ring-2 focus-visible:ring-primary">
            <img
              src={getCardImageUrl(card, 'normal') ?? ''}
              alt={card.name}
              loading="lazy"
              className="absolute inset-0 w-full h-full object-cover transition-transform duration-200 group-hover:scale-105"
            />
          </button>
        ))}
      </div>

      <CardPreviewModal
        card={preview}
        onClose={() => setPreview(null)}
        showOracleTags
        onTagClick={onTagClick}
      />
    </div>
  );
}

function Empty({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-20 px-6 gap-1">
      <p className="text-foreground/90 font-medium">{title}</p>
      <p className="text-sm text-muted-foreground max-w-sm">{sub}</p>
    </div>
  );
}
