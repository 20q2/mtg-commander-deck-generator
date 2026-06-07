import { useState } from 'react';
import { AlertCircle, X } from 'lucide-react';
import { getCardsByNames } from '@/services/scryfall/client';
import { CardPreviewModal } from '@/components/ui/CardPreviewModal';
import { CommanderIcon } from '@/components/ui/mtg-icons';
import type { ScryfallCard } from '@/types';
import type { CardMeta } from './ListCreateEditForm';

export type ListViewMode = 'medium' | 'small' | 'list';

interface ListCardGridProps {
  cards: string[];
  cardData: Map<string, CardMeta>;
  commanderName?: string;
  partnerCommanderName?: string;
  viewMode: ListViewMode;
  onRemove: (name: string) => void;
}

export function ListCardGrid({ cards, cardData, commanderName, partnerCommanderName, viewMode, onRemove }: ListCardGridProps) {
  const [previewCard, setPreviewCard] = useState<ScryfallCard | null>(null);

  const handlePreview = async (name: string) => {
    const cardMap = await getCardsByNames([name]);
    const card = cardMap.get(name);
    if (card) setPreviewCard(card);
  };

  // Commanders always sort to the front. List view sorts the rest A→Z; grid views preserve insertion order.
  const rest = cards.filter(n => n !== commanderName && n !== partnerCommanderName);
  const orderedRest = viewMode === 'list'
    ? [...rest].sort((a, b) => a.localeCompare(b))
    : rest;
  const orderedCards = [
    ...cards.filter(n => n === commanderName),
    ...cards.filter(n => n === partnerCommanderName && n !== commanderName),
    ...orderedRest,
  ];

  if (viewMode === 'list') {
    return (
      <>
        <div className="max-h-60 lg:max-h-80 overflow-y-auto overflow-x-hidden p-3 bg-background rounded-lg border border-border/30 grid grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-0 content-start">
          {orderedCards.map((name) => {
            const isCommander = name === commanderName || name === partnerCommanderName;
            return (
              <ListTextRow
                key={name}
                name={name}
                isCommander={isCommander}
                onRemove={() => onRemove(name)}
                onPreview={() => handlePreview(name)}
              />
            );
          })}
        </div>
        <CardPreviewModal card={previewCard} onClose={() => setPreviewCard(null)} hideMustInclude />
      </>
    );
  }

  const minWidth = viewMode === 'small' ? 40 : 60;

  return (
    <>
      <div
        className="grid gap-2 max-h-60 lg:max-h-80 overflow-auto p-2 bg-background rounded-lg border border-border/30"
        style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${minWidth}px, 1fr))` }}
      >
        {orderedCards.map((name) => {
          const meta = cardData.get(name);
          const isCommander = name === commanderName || name === partnerCommanderName;
          const status: 'loaded' | 'loading' | 'not-found' =
            !meta ? 'loading' : meta.imageUrl ? 'loaded' : 'not-found';
          return (
            <ListCardTile
              key={name}
              name={name}
              imageUrl={meta?.imageUrl ?? null}
              status={status}
              isCommander={isCommander}
              onRemove={() => onRemove(name)}
              onPreview={() => handlePreview(name)}
            />
          );
        })}
      </div>
      <CardPreviewModal card={previewCard} onClose={() => setPreviewCard(null)} hideMustInclude />
    </>
  );
}

interface ListTextRowProps {
  name: string;
  isCommander: boolean;
  onRemove: () => void;
  onPreview: () => void;
}

function ListTextRow({ name, isCommander, onRemove, onPreview }: ListTextRowProps) {
  return (
    <div className="group flex items-center gap-1 py-0.5">
      {isCommander && <CommanderIcon size={10} className="text-amber-400 shrink-0" />}
      <button
        type="button"
        onClick={onPreview}
        className={`flex-1 min-w-0 text-left text-xs truncate hover:text-primary transition-colors ${
          isCommander ? 'text-amber-200 font-medium' : 'text-foreground/90'
        }`}
      >
        {name}
      </button>
      <button
        onClick={onRemove}
        aria-label={`Remove ${name}`}
        className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive p-0.5"
      >
        <X className="w-3 h-3" />
      </button>
    </div>
  );
}

interface ListCardTileProps {
  name: string;
  imageUrl: string | null;
  status: 'loaded' | 'loading' | 'not-found';
  isCommander: boolean;
  onRemove: () => void;
  onPreview: () => void;
}

function ListCardTile({ name, imageUrl, status, isCommander, onRemove, onPreview }: ListCardTileProps) {
  return (
    <div
      className={`group relative aspect-[5/7] rounded-md overflow-hidden shadow-md bg-accent/40 border ${
        isCommander ? 'border-amber-500/60 ring-2 ring-amber-500/50' : 'border-border/30'
      }`}
    >
      <button
        type="button"
        onClick={onPreview}
        aria-label={`Preview ${name}`}
        className="absolute inset-0 w-full h-full text-left"
      >
        {status === 'loaded' && imageUrl ? (
          <img src={imageUrl} alt={name} className="w-full h-full object-cover" loading="lazy" />
        ) : status === 'loading' ? (
          <div className="w-full h-full bg-gradient-to-br from-accent/30 via-accent/60 to-accent/30 animate-pulse flex items-center justify-center p-1 text-[10px] text-muted-foreground/60 text-center">
            {name}
          </div>
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center gap-1 p-1 text-[10px] text-muted-foreground text-center">
            <AlertCircle className="w-4 h-4 text-amber-500/80" />
            <span>{name}</span>
          </div>
        )}
      </button>
      {isCommander && (
        <div className="absolute top-1 left-1 w-5 h-5 rounded-full bg-amber-500/90 text-white flex items-center justify-center shadow z-10">
          <CommanderIcon size={10} />
        </div>
      )}
      <button
        onClick={onRemove}
        aria-label={`Remove ${name}`}
        className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/70 text-white flex items-center justify-center opacity-60 md:opacity-0 md:group-hover:opacity-100 transition-opacity hover:bg-destructive z-10"
      >
        <X className="w-3 h-3" />
      </button>
    </div>
  );
}
