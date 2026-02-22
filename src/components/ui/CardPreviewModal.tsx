import { useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { getCardImageUrl, isDoubleFacedCard, getCardBackFaceUrl, getCardPrice } from '@/services/scryfall/client';
import type { ScryfallCard } from '@/types';

interface CardPreviewModalProps {
  card: ScryfallCard | null;
  onClose: () => void;
  onBuildDeck?: (cardName: string) => void;
}

export function CardPreviewModal({ card, onClose, onBuildDeck }: CardPreviewModalProps) {
  const [showBack, setShowBack] = useState(false);

  // Reset flip state when card changes
  const cardId = card?.id;
  const [prevCardId, setPrevCardId] = useState(cardId);
  if (cardId !== prevCardId) {
    setPrevCardId(cardId);
    setShowBack(false);
  }

  if (!card) return null;

  const isDfc = isDoubleFacedCard(card);
  const backUrl = isDfc ? getCardBackFaceUrl(card, 'large') : null;
  const imgUrl = showBack && backUrl ? backUrl : getCardImageUrl(card, 'large');
  const faceName = showBack && card.card_faces?.[1]
    ? card.card_faces[1].name
    : card.card_faces?.[0]?.name ?? card.name;
  const faceType = showBack && card.card_faces?.[1]
    ? card.card_faces[1].type_line
    : card.type_line;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm animate-fade-in"
      onClick={onClose}
    >
      <div className="relative animate-scale-in" onClick={(e) => e.stopPropagation()}>
        <button
          onClick={onClose}
          className="absolute -top-10 right-0 text-white/70 hover:text-white transition-colors"
        >
          <X className="w-6 h-6" />
        </button>
        <div className="relative">
          <img
            src={imgUrl}
            alt={faceName}
            className="max-h-[80vh] rounded-xl shadow-2xl transition-all duration-200"
          />
          {isDfc && (
            <button
              onClick={() => setShowBack(!showBack)}
              className="absolute bottom-4 right-4 bg-white/90 hover:bg-white text-black rounded-full px-4 py-2 flex items-center gap-2 text-sm font-semibold shadow-lg transition-colors"
              title={showBack ? 'Show front face' : 'Show back face'}
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
                <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                <path d="M3 3v5h5" />
              </svg>
              Flip
            </button>
          )}
        </div>
        <div className="mt-4 text-center">
          <h3 className="text-white font-bold text-lg">{faceName}</h3>
          <p className="text-white/70 text-sm">{faceType}</p>
          {getCardPrice(card) && (
            <p className="text-white/50 text-xs mt-1">${getCardPrice(card)}</p>
          )}
          <div className="flex items-center justify-center gap-3 mt-3 flex-wrap">
            {onBuildDeck && card.type_line && /legendary/i.test(card.type_line) && /creature/i.test(card.type_line) && (
              <button
                onClick={() => { onBuildDeck(card.name); onClose(); }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-primary hover:bg-primary/80 text-primary-foreground text-xs font-medium transition-colors"
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect width="7" height="9" x="3" y="3" rx="1" />
                  <rect width="7" height="5" x="14" y="3" rx="1" />
                  <rect width="7" height="9" x="14" y="12" rx="1" />
                  <rect width="7" height="5" x="3" y="16" rx="1" />
                </svg>
                Build Deck
              </button>
            )}
            <a
              href={`https://scryfall.com/search?q=!%22${encodeURIComponent(card.name)}%22`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/10 hover:bg-white/20 text-white/80 hover:text-white text-xs font-medium transition-colors"
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8" />
                <path d="m21 21-4.3-4.3" />
              </svg>
              Scryfall
            </a>
            <a
              href={`https://edhrec.com/cards/${card.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/10 hover:bg-white/20 text-white/80 hover:text-white text-xs font-medium transition-colors"
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                <polyline points="15 3 21 3 21 9" />
                <line x1="10" y1="14" x2="21" y2="3" />
              </svg>
              EDHREC
            </a>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
