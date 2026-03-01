import { useState, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, Sparkles, Star, Pin } from 'lucide-react';
import { getCardImageUrl, isDoubleFacedCard, getCardBackFaceUrl, getCardPrice, getCardByName } from '@/services/scryfall/client';
import type { ScryfallCard, DetectedCombo } from '@/types';
import { useStore } from '@/store';
import { CardTypeIcon } from '@/components/ui/mtg-icons';

type CardType = 'Commander' | 'Creature' | 'Planeswalker' | 'Battle' | 'Instant' | 'Sorcery' | 'Artifact' | 'Enchantment' | 'Land';

function getScryfallImageUrl(cardName: string): string {
  return `https://api.scryfall.com/cards/named?exact=${encodeURIComponent(cardName)}&format=image&version=normal`;
}

interface CardPreviewModalProps {
  card: ScryfallCard | null;
  onClose: () => void;
  onBuildDeck?: (cardName: string) => void;
  isOwned?: boolean;
  combos?: DetectedCombo[];
  cardTypeMap?: Map<string, CardType>;
  cardComboMap?: Map<string, DetectedCombo[]>;
  /** When true, only show complete (in-deck) combos. When false, show both sections. */
  deckOnly?: boolean;
}

function renderComboEntry(
  combo: DetectedCombo,
  currentCardName: string,
  cardTypeMap: Map<string, CardType> | undefined,
  handlePillHover: (name: string, e: React.MouseEvent) => void,
  setHoverPreview: (v: null) => void,
  handlePillClick: (name: string) => void,
  isKnown?: boolean,
) {
  return (
    <div key={combo.comboId} className="rounded-lg bg-white/5 border border-white/10 px-3 py-2.5">
      <div className={`flex items-center gap-1.5 text-[11px] font-semibold mb-1.5 ${isKnown ? 'text-amber-400' : 'text-violet-400'}`}>
        <Sparkles className="w-3 h-3" />
        Combo
        <span className="ml-auto text-white/30 text-[10px] font-normal">
          {combo.deckCount.toLocaleString()} decks · Bracket {combo.bracket}
        </span>
      </div>
      <div className="flex flex-wrap gap-1.5 mb-1.5">
        {combo.cards.map((name) => {
          const isMissing = isKnown && combo.missingCards.includes(name);
          return (
            <span
              key={name}
              className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs cursor-pointer transition-colors ${
                name === currentCardName
                  ? 'bg-violet-500/25 text-violet-300 font-semibold hover:bg-violet-500/35'
                  : isMissing
                    ? 'bg-white/5 text-white/40 hover:bg-white/10'
                    : 'bg-white/10 text-white/80 hover:bg-white/20'
              }`}
              onMouseEnter={(e) => handlePillHover(name, e)}
              onMouseLeave={() => setHoverPreview(null)}
              onClick={() => handlePillClick(name)}
            >
              {cardTypeMap?.get(name) && (
                <CardTypeIcon type={cardTypeMap.get(name)!} size="sm" className="opacity-60" />
              )}
              {name}
            </span>
          );
        })}
      </div>
      {combo.results.length > 0 && (
        <p className="text-white/50 text-[11px] leading-relaxed">
          {combo.results.join('. ')}
        </p>
      )}
    </div>
  );
}

export function CardPreviewModal({ card, onClose, onBuildDeck, isOwned, combos, cardTypeMap, cardComboMap, deckOnly }: CardPreviewModalProps) {
  const currency = useStore((s) => s.customization.currency);
  const mustIncludeCards = useStore((s) => s.customization.mustIncludeCards);
  const updateCustomization = useStore((s) => s.updateCustomization);
  const sym = currency === 'EUR' ? '€' : '$';
  const [showBack, setShowBack] = useState(false);
  const [cardOverride, setCardOverride] = useState<ScryfallCard | null>(null);
  const [hoverPreview, setHoverPreview] = useState<{ name: string; top: number; left: number; below: boolean } | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Reset flip state and override when prop card changes
  const cardId = card?.id;
  const [prevCardId, setPrevCardId] = useState(cardId);
  if (cardId !== prevCardId) {
    setPrevCardId(cardId);
    setShowBack(false);
    setCardOverride(null);
  }

  // Lock body scroll while modal is open
  useEffect(() => {
    if (!card) return;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, [card]);

  const handlePillHover = useCallback((name: string, e: React.MouseEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const isDesktop = window.innerWidth >= 768;
    setHoverPreview({
      name,
      top: isDesktop ? rect.bottom + 8 : rect.top - 8,
      left: rect.left + rect.width / 2,
      below: isDesktop,
    });
  }, []);

  const handlePillClick = useCallback(async (name: string) => {
    try {
      const fetched = await getCardByName(name);
      if (fetched) {
        setCardOverride(fetched);
        setShowBack(false);
        setHoverPreview(null);
      }
    } catch {
      // ignore fetch errors
    }
  }, []);

  const handleAddMustInclude = useCallback((name: string) => {
    if (mustIncludeCards.includes(name)) return;
    updateCustomization({ mustIncludeCards: [...mustIncludeCards, name] });
    setToastMessage(`Added "${name}" to Must Include — regenerate to see changes`);
  }, [mustIncludeCards, updateCustomization]);

  const handleRemoveMustInclude = useCallback((name: string) => {
    updateCustomization({ mustIncludeCards: mustIncludeCards.filter(n => n !== name) });
    setToastMessage(`Removed "${name}" from Must Include — regenerate to see changes`);
  }, [mustIncludeCards, updateCustomization]);

  useEffect(() => {
    if (!toastMessage) return;
    const timer = setTimeout(() => setToastMessage(null), 4000);
    return () => clearTimeout(timer);
  }, [toastMessage]);

  if (!card) return null;

  const displayCard = cardOverride ?? card;
  const isDfc = isDoubleFacedCard(displayCard);
  const backUrl = isDfc ? getCardBackFaceUrl(displayCard, 'large') : null;
  const imgUrl = showBack && backUrl ? backUrl : getCardImageUrl(displayCard, 'large');
  const faceName = showBack && displayCard.card_faces?.[1]
    ? displayCard.card_faces[1].name
    : displayCard.card_faces?.[0]?.name ?? displayCard.name;
  const faceType = showBack && displayCard.card_faces?.[1]
    ? displayCard.card_faces[1].type_line
    : displayCard.type_line;
  const currentCardName = displayCard.name.includes(' // ') ? displayCard.name.split(' // ')[0] : displayCard.name;
  const allCombosForCard = cardOverride && cardComboMap
    ? cardComboMap.get(currentCardName)
    : combos;
  const deckCombos = allCombosForCard?.filter(c => c.isComplete) ?? [];
  const knownCombos = allCombosForCard?.filter(c => !c.isComplete) ?? [];
  const hasCombos = deckCombos.length > 0 || (!deckOnly && knownCombos.length > 0);
  // Check if this card is missing from the deck (appears in its own combos' missingCards)
  const isMissingComboCard = allCombosForCard?.some(c => c.missingCards.includes(currentCardName)) ?? false;
  const isInMustInclude = mustIncludeCards.includes(currentCardName);
  const canMustInclude = isMissingComboCard && !isInMustInclude;
  const alreadyMustIncluded = isInMustInclude;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm animate-fade-in overflow-y-auto"
      onClick={onClose}
    >
      <div className="relative animate-scale-in max-w-[90vw] sm:max-w-none card-preview-content my-4 sm:my-8 md:my-12" onClick={(e) => e.stopPropagation()}>
        <button
          onClick={onClose}
          className="absolute -top-10 right-0 text-white/70 hover:text-white transition-colors z-10 hidden sm:block"
        >
          <X className="w-6 h-6" />
        </button>
        <button
          onClick={onClose}
          className="absolute top-2 right-2 bg-black/60 rounded-full p-1.5 text-white/70 hover:text-white transition-colors z-10 sm:hidden"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Top area: image + combos side-by-side on desktop */}
        <div className={`${hasCombos ? 'md:flex md:items-start md:gap-5' : ''}`}>
          {/* Card image */}
          <div className="relative card-preview-image shrink-0 flex justify-center md:block">
            <img
              src={imgUrl}
              alt={faceName}
              className={`max-w-full w-auto rounded-xl shadow-2xl transition-all duration-200 ${hasCombos ? 'max-h-[40vh] sm:max-h-[55vh] md:max-h-[70vh]' : 'max-h-[75vh]'}`}
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

          {/* Combo panel — below image on mobile, beside it on desktop */}
          {hasCombos && (
            <div className="mt-3 md:mt-0 w-full md:w-72 shrink-0 max-h-[30vh] sm:max-h-[35vh] md:max-h-[70vh] overflow-y-auto pr-1.5">
              {deckCombos.length > 0 && (
                <>
                  <div className="flex items-center gap-1.5 mb-2.5 py-1.5 border-b border-white/10">
                    <Sparkles className="w-3.5 h-3.5 text-violet-400" />
                    <span className="text-[11px] font-bold text-violet-300 tracking-wide uppercase">In Your Deck</span>
                    <span className="ml-auto text-[10px] font-medium text-violet-400/60 bg-violet-500/10 px-1.5 py-0.5 rounded-full">{deckCombos.length}</span>
                  </div>
                  <div className="space-y-2">
                    {deckCombos.map((combo) => renderComboEntry(combo, currentCardName, cardTypeMap, handlePillHover, setHoverPreview, handlePillClick))}
                  </div>
                </>
              )}
              {!deckOnly && knownCombos.length > 0 && (
                <>
                  <div className={`flex items-center gap-1.5 mb-2.5 py-1.5 border-b border-white/10 ${deckCombos.length > 0 ? 'mt-4' : ''}`}>
                    <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                    <span className="text-[11px] font-bold text-amber-300 tracking-wide uppercase">Known Combos</span>
                    <span className="ml-auto text-[10px] font-medium text-amber-400/60 bg-amber-500/10 px-1.5 py-0.5 rounded-full">{knownCombos.length}</span>
                  </div>
                  <div className="space-y-2">
                    {knownCombos.map((combo) => renderComboEntry(combo, currentCardName, cardTypeMap, handlePillHover, setHoverPreview, handlePillClick, true))}
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* Card info — always below */}
        <div className="mt-4 text-center card-preview-info">
          <h3 className="text-white font-bold text-lg">{faceName}</h3>
          {(displayCard.isGameChanger || isInMustInclude) && (
            <div className="flex items-center justify-center gap-2 mt-1">
              {displayCard.isGameChanger && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-400 text-[11px] font-medium">
                  <Star className="w-3 h-3" />
                  Game Changer
                </span>
              )}
              {isInMustInclude && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 text-[11px] font-medium">
                  <Pin className="w-3 h-3" />
                  Must Include
                </span>
              )}
            </div>
          )}
          <p className="text-white/70 text-sm">{faceType}</p>
          {getCardPrice(displayCard, currency) && (
            <p className="text-white/50 text-xs mt-1">{sym}{getCardPrice(displayCard, currency)}</p>
          )}
          {isOwned && !cardOverride && (
            <p className="text-emerald-400 text-xs mt-1.5 flex items-center justify-center gap-1">
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 6 9 17l-5-5" />
              </svg>
              In your collection
            </p>
          )}
          <div className="flex items-center justify-center gap-3 mt-3 flex-wrap">
            {onBuildDeck && displayCard.type_line && /legendary/i.test(displayCard.type_line) && /creature/i.test(displayCard.type_line) && (
              <button
                onClick={() => { onBuildDeck(displayCard.name); onClose(); }}
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
              href={`https://scryfall.com/search?q=!%22${encodeURIComponent(displayCard.name)}%22`}
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
              href={`https://edhrec.com/cards/${displayCard.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')}`}
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
            {canMustInclude && (
              <button
                onClick={() => handleAddMustInclude(currentCardName)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-600/80 hover:bg-emerald-500 text-white text-xs font-medium transition-colors"
              >
                <Pin className="w-3.5 h-3.5" />
                Must Include
              </button>
            )}
            {alreadyMustIncluded && (
              <button
                onClick={() => handleRemoveMustInclude(currentCardName)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/10 hover:bg-red-500/20 text-white/60 hover:text-red-400 text-xs font-medium transition-colors"
              >
                <X className="w-3.5 h-3.5" />
                Remove Must Include
              </button>
            )}
          </div>
        </div>
        {/* Hover card preview for combo pills */}
        {hoverPreview && (
          <div
            className="pointer-events-none fixed z-[110] animate-fade-in"
            style={{
              top: hoverPreview.top,
              left: hoverPreview.left,
              transform: hoverPreview.below ? 'translate(-50%, 0)' : 'translate(-50%, -100%)',
            }}
          >
            <img
              src={getScryfallImageUrl(hoverPreview.name)}
              alt={hoverPreview.name}
              className="w-48 rounded-lg shadow-2xl border border-white/10"
            />
          </div>
        )}
      </div>
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-[60] px-4 py-3 bg-emerald-600/90 text-white text-sm rounded-lg shadow-lg animate-fade-in max-w-sm flex items-center gap-2">
          <Pin className="w-4 h-4 shrink-0" />
          {toastMessage}
        </div>
      )}
    </div>,
    document.body
  );
}
