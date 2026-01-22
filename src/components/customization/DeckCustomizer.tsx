import { Slider } from '@/components/ui/slider';
import { useStore } from '@/store';
import type { DeckFormat } from '@/types';
import { DECK_FORMAT_CONFIGS } from '@/lib/constants/archetypes';
import { BannedCards } from './BannedCards';
import { LandIcon } from '@/components/ui/mtg-icons';

export function DeckCustomizer() {
  const { customization, updateCustomization, commander, partnerCommander } = useStore();

  if (!commander) return null;

  // Generate dynamic description based on partner status
  const getFormatDescription = (size: DeckFormat): string => {
    const commanderCount = partnerCommander ? 2 : 1;
    const cardCount = size === 99 ? (100 - commanderCount) : (size - commanderCount);
    const commanderText = partnerCommander ? 'commanders' : 'commander';
    return `${cardCount} cards + ${commanderText}`;
  };

  const formatOptions = ([40, 60, 99] as DeckFormat[]).map((size) => {
    const config = DECK_FORMAT_CONFIGS[size];
    return {
      value: size,
      label: config.label.split(' ')[0], // "Brawl (40)" -> "Brawl"
      description: getFormatDescription(size),
    };
  });

  const currentFormat = DECK_FORMAT_CONFIGS[customization.deckFormat];
  const landRange = currentFormat.landRange;

  // Handle format change - also update land counts to format defaults
  const handleFormatChange = (format: DeckFormat) => {
    const formatConfig = DECK_FORMAT_CONFIGS[format];
    // Scale non-basic count proportionally to new format
    const defaultNonBasic = Math.min(15, Math.floor(formatConfig.defaultLands * 0.4));
    updateCustomization({
      deckFormat: format,
      landCount: formatConfig.defaultLands,
      nonBasicLandCount: defaultNonBasic,
    });
  };

  // Handle land count change - ensure non-basic doesn't exceed total
  const handleLandCountChange = (newLandCount: number) => {
    const newNonBasic = Math.min(customization.nonBasicLandCount, newLandCount);
    updateCustomization({
      landCount: newLandCount,
      nonBasicLandCount: newNonBasic,
    });
  };

  return (
    <div className="space-y-6">
      {/* Deck Format */}
      <div>
        <label className="text-sm font-medium mb-3 block">Deck Format</label>
        <div className="grid grid-cols-3 gap-2">
          {formatOptions.map((option) => (
            <button
              key={option.value}
              onClick={() => handleFormatChange(option.value)}
              className={`p-3 rounded-lg border text-center transition-colors ${
                customization.deckFormat === option.value
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border hover:border-primary/50'
              }`}
            >
              <div className="font-medium text-sm">{option.label}</div>
              <div className="text-xs text-muted-foreground">{option.description}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Land Section Header */}
      <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
        <LandIcon size={16} className="text-amber-600" />
        <span>Mana Base</span>
      </div>

      {/* Land Count */}
      <div>
        <div className="flex justify-between mb-2">
          <label className="text-sm font-medium">Total Lands</label>
          <span className="text-sm font-bold">{customization.landCount}</span>
        </div>
        <Slider
          value={customization.landCount}
          min={landRange[0]}
          max={landRange[1]}
          step={1}
          onChange={handleLandCountChange}
        />
        <div className="flex justify-between text-xs text-muted-foreground mt-1">
          <span>{landRange[0]} (Aggro)</span>
          <span>{currentFormat.defaultLands} (Standard)</span>
          <span>{landRange[1]} (Control)</span>
        </div>
      </div>

      {/* Non-Basic Land Count */}
      <div>
        <div className="flex justify-between mb-2">
          <label className="text-sm font-medium">Non-Basic Lands</label>
          <span className="text-sm font-bold">
            {customization.nonBasicLandCount}
            <span className="text-muted-foreground font-normal ml-1">
              ({customization.landCount - customization.nonBasicLandCount} basics)
            </span>
          </span>
        </div>
        <Slider
          value={customization.nonBasicLandCount}
          min={0}
          max={customization.landCount}
          step={1}
          onChange={(value) => updateCustomization({ nonBasicLandCount: value })}
        />
        <div className="flex justify-between text-xs text-muted-foreground mt-1">
          <span>0 (Budget)</span>
          <span>{Math.floor(customization.landCount / 2)} (Balanced)</span>
          <span>{customization.landCount} (Optimal)</span>
        </div>
      </div>

      {/* Banned Cards */}
      <div className="pt-2 border-t border-border/50">
        <BannedCards />
      </div>
    </div>
  );
}
