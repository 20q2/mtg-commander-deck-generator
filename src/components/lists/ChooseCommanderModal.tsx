import { useState, useMemo, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { getCardImageUrl } from '@/services/scryfall/client';
import { getPartnerType, canHavePartner, areValidPartners, getPartnerTypeLabel } from '@/lib/partnerUtils';
import { CommanderIcon } from '@/components/ui/mtg-icons';
import { Button } from '@/components/ui/button';
import { X, ArrowLeft } from 'lucide-react';
import type { ScryfallCard } from '@/types';

interface ChooseCommanderModalProps {
  open: boolean;
  onClose: () => void;
  onSelect: (commanderName: string, partnerName?: string) => void;
  scryfallMap: Map<string, ScryfallCard>;
  cardNames: string[];
}

function isCommanderEligible(card: ScryfallCard): boolean {
  const frontType = (card.type_line || '').split(' // ')[0].toLowerCase();
  // Legendary creatures
  if (frontType.includes('legendary') && frontType.includes('creature')) return true;
  // Legendary planeswalkers that can be commanders
  if (frontType.includes('legendary') && frontType.includes('planeswalker')) {
    const oracle = card.oracle_text || card.card_faces?.[0]?.oracle_text || '';
    if (oracle.toLowerCase().includes('can be your commander')) return true;
  }
  return false;
}

export function ChooseCommanderModal({ open, onClose, onSelect, scryfallMap, cardNames }: ChooseCommanderModalProps) {
  const [selectedCommander, setSelectedCommander] = useState<ScryfallCard | null>(null);
  const [step, setStep] = useState<'pick-commander' | 'pick-partner'>('pick-commander');

  // Reset state when modal opens/closes
  useEffect(() => {
    if (open) {
      setSelectedCommander(null);
      setStep('pick-commander');
    }
  }, [open]);

  // Escape key + body scroll lock
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  // Filter legendary creatures from the list
  const legendaryCreatures = useMemo(() => {
    return cardNames
      .map(name => scryfallMap.get(name))
      .filter((card): card is ScryfallCard => !!card && isCommanderEligible(card));
  }, [cardNames, scryfallMap]);

  // Valid partner candidates for the selected commander
  const partnerCandidates = useMemo(() => {
    if (!selectedCommander) return [];
    const partnerType = getPartnerType(selectedCommander);

    // For "Choose a Background" commanders, scan ALL list cards for Backgrounds
    if (partnerType === 'choose-background') {
      return cardNames
        .map(name => scryfallMap.get(name))
        .filter((card): card is ScryfallCard =>
          !!card && card.name !== selectedCommander.name && areValidPartners(selectedCommander, card)
        );
    }

    // For other partner types, filter from legendary creatures
    return legendaryCreatures.filter(card =>
      card.name !== selectedCommander.name && areValidPartners(selectedCommander, card)
    );
  }, [selectedCommander, legendaryCreatures, cardNames, scryfallMap]);

  const handlePickCommander = (card: ScryfallCard) => {
    if (canHavePartner(card)) {
      // Check if there are valid partners in the list before going to step 2
      setSelectedCommander(card);
      const partnerType = getPartnerType(card);
      const hasPartners = partnerType === 'choose-background'
        ? cardNames.some(name => {
            const c = scryfallMap.get(name);
            return c && c.name !== card.name && areValidPartners(card, c);
          })
        : legendaryCreatures.some(c => c.name !== card.name && areValidPartners(card, c));

      if (hasPartners) {
        setStep('pick-partner');
        return;
      }
    }
    onSelect(card.name);
  };

  const handlePickPartner = (card: ScryfallCard) => {
    if (selectedCommander) {
      onSelect(selectedCommander.name, card.name);
    }
  };

  const handleSkipPartner = () => {
    if (selectedCommander) {
      onSelect(selectedCommander.name);
    }
  };

  const handleBack = () => {
    setSelectedCommander(null);
    setStep('pick-commander');
  };

  if (!open) return null;

  const candidates = step === 'pick-commander' ? legendaryCreatures : partnerCandidates;
  const partnerLabel = selectedCommander ? getPartnerTypeLabel(getPartnerType(selectedCommander)) : '';

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm animate-fade-in"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-3xl max-h-[80vh] mx-4 bg-card rounded-xl border border-border/50 shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border/50">
          <div className="flex items-center gap-2">
            {step === 'pick-partner' && (
              <Button variant="ghost" size="icon" className="h-7 w-7 mr-1" onClick={handleBack}>
                <ArrowLeft className="w-4 h-4" />
              </Button>
            )}
            <CommanderIcon size={18} className="text-primary" />
            <h3 className="text-lg font-bold">
              {step === 'pick-commander' ? 'Choose Commander' : `Choose ${partnerLabel}`}
            </h3>
          </div>
          <div className="flex items-center gap-2">
            {step === 'pick-partner' && (
              <Button variant="outline" size="sm" onClick={handleSkipPartner}>
                Skip
              </Button>
            )}
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onClose}>
              <X className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {/* Selected commander indicator */}
        {step === 'pick-partner' && selectedCommander && (
          <div className="px-5 py-2 bg-primary/5 border-b border-border/30 flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Commander:</span>
            <span className="font-medium">{selectedCommander.name}</span>
          </div>
        )}

        {/* Body */}
        <div className="p-5 overflow-y-auto max-h-[calc(80vh-72px)]">
          {candidates.length > 0 ? (
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-3">
              {candidates.map(card => (
                <button
                  key={card.id}
                  onClick={() => step === 'pick-commander' ? handlePickCommander(card) : handlePickPartner(card)}
                  className="group relative rounded-lg overflow-hidden border-2 border-transparent hover:border-primary transition-all focus:outline-none focus:border-primary"
                  title={card.name}
                >
                  <img
                    src={getCardImageUrl(card, 'normal')}
                    alt={card.name}
                    className="w-full rounded-lg shadow-md group-hover:shadow-lg group-hover:scale-[1.02] transition-all"
                  />
                </button>
              ))}
            </div>
          ) : (
            <div className="text-center py-12 space-y-3">
              <CommanderIcon size={40} className="text-muted-foreground/30 mx-auto" />
              <p className="text-muted-foreground">
                {step === 'pick-commander'
                  ? 'No legendary creatures found in this list'
                  : `No valid ${partnerLabel.toLowerCase()} candidates found in this list`}
              </p>
              {step === 'pick-commander' && (
                <p className="text-xs text-muted-foreground/70">
                  Add legendary creatures to your list first
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
