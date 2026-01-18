import { Slider } from '@/components/ui/slider';
import { useStore } from '@/store';
import type { DeckFormat } from '@/types';
import { DECK_FORMAT_CONFIGS } from '@/lib/constants/archetypes';
import { BannedCards } from './BannedCards';

export function DeckCustomizer() {
  const { customization, updateCustomization, commander } = useStore();

  if (!commander) return null;

  const formatOptions = ([40, 60, 99] as DeckFormat[]).map((size) => {
    const config = DECK_FORMAT_CONFIGS[size];
    return {
      value: size,
      label: config.label.split(' ')[0], // "Brawl (40)" -> "Brawl"
      description: config.description,
    };
  });

  const currentFormat = DECK_FORMAT_CONFIGS[customization.deckFormat];
  const landRange = currentFormat.landRange;

  // Handle format change - also update land count to format default
  const handleFormatChange = (format: DeckFormat) => {
    const formatConfig = DECK_FORMAT_CONFIGS[format];
    updateCustomization({
      deckFormat: format,
      landCount: formatConfig.defaultLands,
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

      {/* Singleton Toggle */}
      <div className="flex items-center justify-between">
        <div>
          <label className="text-sm font-medium">Singleton</label>
          <p className="text-xs text-muted-foreground">One copy of each card</p>
        </div>
        <button
          onClick={() => updateCustomization({ singleton: !customization.singleton })}
          className={`relative w-12 h-6 rounded-full transition-colors ${
            customization.singleton ? 'bg-primary' : 'bg-muted'
          }`}
        >
          <span
            className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${
              customization.singleton ? 'left-7' : 'left-1'
            }`}
          />
        </button>
      </div>

      {/* Land Count */}
      <div>
        <div className="flex justify-between mb-2">
          <label className="text-sm font-medium">Land Count</label>
          <span className="text-sm font-bold">{customization.landCount}</span>
        </div>
        <Slider
          value={customization.landCount}
          min={landRange[0]}
          max={landRange[1]}
          step={1}
          onChange={(value) => updateCustomization({ landCount: value })}
        />
        <div className="flex justify-between text-xs text-muted-foreground mt-1">
          <span>{landRange[0]} (Aggro)</span>
          <span>{currentFormat.defaultLands} (Standard)</span>
          <span>{landRange[1]} (Control)</span>
        </div>
      </div>

      {/* Banned Cards */}
      <div className="pt-2 border-t border-border/50">
        <BannedCards />
      </div>
    </div>
  );
}
