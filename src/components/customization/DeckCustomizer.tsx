import { useState, useRef, useEffect } from 'react';
import { Slider } from '@/components/ui/slider';
import { useStore } from '@/store';
import type { DeckFormat } from '@/types';
import { DECK_FORMAT_CONFIGS } from '@/lib/constants/archetypes';
import { BannedCards } from './BannedCards';
import { MustIncludeCards } from './MustIncludeCards';
import { LandIcon } from '@/components/ui/mtg-icons';

export function DeckCustomizer() {
  const { customization, updateCustomization, commander, partnerCommander } = useStore();
  const [editingLands, setEditingLands] = useState(false);
  const [landInputValue, setLandInputValue] = useState('');
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [editingPrice, setEditingPrice] = useState(false);
  const [priceInputValue, setPriceInputValue] = useState('');
  const priceInputRef = useRef<HTMLInputElement>(null);
  const landInputRef = useRef<HTMLInputElement>(null);

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

  // Focus inputs when entering edit mode
  useEffect(() => {
    if (editingLands && landInputRef.current) {
      landInputRef.current.focus();
      landInputRef.current.select();
    }
  }, [editingLands]);

  useEffect(() => {
    if (editingPrice && priceInputRef.current) {
      priceInputRef.current.focus();
      priceInputRef.current.select();
    }
  }, [editingPrice]);

  const startEditingLands = () => {
    setLandInputValue(String(customization.landCount));
    setEditingLands(true);
  };

  const commitLandInput = () => {
    setEditingLands(false);
    const parsed = parseInt(landInputValue, 10);
    if (!isNaN(parsed) && parsed > 0) {
      handleLandCountChange(parsed);
    }
  };

  const startEditingPrice = () => {
    setPriceInputValue(customization.maxCardPrice !== null ? String(customization.maxCardPrice) : '');
    setEditingPrice(true);
  };

  const commitPriceInput = () => {
    setEditingPrice(false);
    const parsed = parseFloat(priceInputValue);
    if (!isNaN(parsed) && parsed > 0) {
      updateCustomization({ maxCardPrice: parsed });
    }
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
        <LandIcon size={16} className="text-muted-foreground" />
        <span>Mana Base</span>
      </div>

      {/* Land Count */}
      <div>
        <div className="flex justify-between mb-2">
          <label className="text-sm font-medium">Total Lands</label>
          {editingLands ? (
            <input
              ref={landInputRef}
              type="number"
              value={landInputValue}
              onChange={(e) => setLandInputValue(e.target.value)}
              onBlur={commitLandInput}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitLandInput();
                if (e.key === 'Escape') setEditingLands(false);
              }}
              className="w-14 text-sm font-bold text-right bg-background border border-primary rounded px-1 py-0 outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            />
          ) : (
            <span
              className="text-sm font-bold cursor-pointer hover:text-primary border border-transparent hover:border-primary/50 rounded px-1 transition-colors"
              onClick={startEditingLands}
              title="Click to set manually"
            >
              {customization.landCount}
            </span>
          )}
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
          <span>0 (Basic)</span>
          <span>{Math.floor(customization.landCount / 2)} (Balanced)</span>
          <span>{customization.landCount} (Varied)</span>
        </div>
      </div>

      {/* Advanced Options */}
      <div className="pt-2 border-t border-border/50">
        <button
          onClick={() => setAdvancedOpen(!advancedOpen)}
          className="flex items-center justify-between w-full text-sm text-muted-foreground hover:text-foreground transition-colors py-1"
        >
          <span className="font-medium flex items-center gap-2">
            Advanced Options
            {!advancedOpen && (customization.maxCardPrice !== null || customization.mustIncludeCards.length > 0 || customization.bannedCards.length > 0) && (
              <span className="text-[10px] font-normal text-primary/70 bg-primary/10 px-1.5 py-0.5 rounded-full">
                {[
                  customization.maxCardPrice !== null ? `$${customization.maxCardPrice}` : null,
                  customization.mustIncludeCards.length > 0 ? `${customization.mustIncludeCards.length} included` : null,
                  customization.bannedCards.length > 0 ? `${customization.bannedCards.length} excluded` : null,
                ].filter(Boolean).join(' · ')}
              </span>
            )}
          </span>
          <svg
            className={`w-4 h-4 transition-transform ${advancedOpen ? 'rotate-180' : ''}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {advancedOpen && (
          <div className="mt-3 space-y-4">
            {/* Max Card Price */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-medium flex items-center gap-1.5">
                  <svg className="w-4 h-4 text-muted-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                    <line x1="12" y1="1" x2="12" y2="23" />
                    <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
                  </svg>
                  Max Card Price
                </label>
                <span className="text-sm font-bold">
                  {customization.maxCardPrice === null ? 'No limit' : `$${customization.maxCardPrice}`}
                </span>
              </div>
              <div className="flex gap-2">
                {([null, 1, 5, 10, 25] as const).map((price) => {
                  const isSelected = customization.maxCardPrice === price;
                  return (
                    <button
                      key={price ?? 'none'}
                      onClick={() => { setEditingPrice(false); updateCustomization({ maxCardPrice: price }); }}
                      className={`flex-1 py-1.5 px-1 rounded text-xs font-medium transition-colors ${
                        isSelected
                          ? 'bg-primary/10 border border-primary text-primary'
                          : 'border border-border hover:border-primary/50'
                      }`}
                    >
                      {price === null ? 'None' : `$${price}`}
                    </button>
                  );
                })}
                {editingPrice ? (
                  <input
                    ref={priceInputRef}
                    type="number"
                    placeholder="$"
                    value={priceInputValue}
                    onChange={(e) => setPriceInputValue(e.target.value)}
                    onBlur={commitPriceInput}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitPriceInput();
                      if (e.key === 'Escape') setEditingPrice(false);
                    }}
                    className="flex-1 py-1.5 px-1 rounded text-xs font-medium text-center bg-background border border-primary outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                ) : (
                  <button
                    onClick={startEditingPrice}
                    className={`flex-1 py-1.5 px-1 rounded text-xs font-medium transition-colors ${
                      customization.maxCardPrice !== null && ![1, 5, 10, 25].includes(customization.maxCardPrice)
                        ? 'bg-primary/10 border border-primary text-primary'
                        : 'border border-border hover:border-primary/50'
                    }`}
                  >
                    {customization.maxCardPrice !== null && ![1, 5, 10, 25].includes(customization.maxCardPrice)
                      ? `$${customization.maxCardPrice}`
                      : 'Custom'}
                  </button>
                )}
              </div>
            </div>

            {/* Must Include Cards */}
            <MustIncludeCards />

            {/* Excluded Cards */}
            <BannedCards />
          </div>
        )}
      </div>
    </div>
  );
}
