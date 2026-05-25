// src/components/deck/optimizer/dashboard/StandoutCards.tsx
import type { ScryfallCard } from '@/types';

export interface StandoutCardsProps {
  cards: ScryfallCard[];
  cardSynergyMap?: Record<string, number>;
  commanderName: string;
  sampleSize?: number | null;
  onPreview: (cardName: string) => void;
}

function getCardImageUrl(card: ScryfallCard): string | null {
  if (card.image_uris?.small) return card.image_uris.small;
  if (card.card_faces?.[0]?.image_uris?.small) return card.card_faces[0].image_uris.small;
  return null;
}

export function StandoutCards({
  cards,
  cardSynergyMap,
  commanderName,
  sampleSize,
  onPreview,
}: StandoutCardsProps) {
  if (cards.length === 0) return null;

  const synergyEntries = cardSynergyMap ? Object.entries(cardSynergyMap) : [];
  const positiveEntries = synergyEntries.filter(([, v]) => v > 0);

  if (positiveEntries.length < 5) {
    return (
      <div className="space-y-1.5">
        <p className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground/60">
          Standout in your build
        </p>
        <p className="text-xs text-muted-foreground/60">Synergy data not available for this commander.</p>
      </div>
    );
  }

  const top5 = positiveEntries
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5);

  const cardsByName = new Map<string, ScryfallCard>(cards.map(c => [c.name, c]));

  const subtitle = sampleSize != null
    ? `Highest synergy with ${commanderName} across ${sampleSize.toLocaleString()} decklists.`
    : `Highest synergy with ${commanderName}.`;

  return (
    <div className="space-y-2">
      <div>
        <p className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground/60">
          Standout in your build
        </p>
        <p className="mt-0.5 text-[11px] text-muted-foreground/60">{subtitle}</p>
      </div>
      <div className="flex gap-2.5 overflow-x-auto pb-1">
        {top5.map(([name, synergy]) => {
          const card = cardsByName.get(name);
          const imgUrl = card ? getCardImageUrl(card) : null;
          return (
            <button
              key={name}
              onClick={() => onPreview(name)}
              className="flex flex-col items-center gap-1.5 shrink-0 group focus:outline-none"
              title={`${name} — synergy +${synergy.toFixed(2)}`}
            >
              <div className="w-[60px] h-[84px] rounded overflow-hidden bg-muted border border-border/40 group-hover:border-violet-400/60 transition-colors">
                {imgUrl ? (
                  <img
                    src={imgUrl}
                    alt={name}
                    className="w-full h-full object-cover"
                    loading="lazy"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-[9px] text-muted-foreground/60 text-center px-1 leading-tight">
                    {name}
                  </div>
                )}
              </div>
              <div className="w-[60px] flex flex-col items-center gap-0.5">
                <span className="text-[10px] text-foreground/80 truncate w-full text-center leading-tight">
                  {name.split(' // ')[0]}
                </span>
                <span className="text-[10px] font-semibold text-violet-300/80 tabular-nums">
                  +{synergy.toFixed(2)}
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
