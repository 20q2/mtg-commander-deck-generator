import { useState, useRef, useEffect, useMemo } from 'react';
import { Slider } from '@/components/ui/slider';
import { useStore } from '@/store';
import type { DeckFormat, BudgetOption, GameChangerLimit, BracketLevel, MaxRarity, Pacing } from '@/types';
import { getDeckFormatConfig } from '@/lib/constants/archetypes';
import { BannedCards } from './BannedCards';
import { MustIncludeCards } from './MustIncludeCards';
import { AdvancedCustomization } from './AdvancedCustomization';
import { InfoTooltip } from '@/components/ui/info-tooltip';
import { useCollection } from '@/hooks/useCollection';
import { useNavigate } from 'react-router-dom';
import { isEuropean } from '@/lib/region';
import { CardTypeIcon } from '@/components/ui/mtg-icons';

const IS_EU = isEuropean() || location.hostname === 'localhost';

const PACING_LABELS: { value: Pacing; label: string }[] = [
  { value: 'aggressive-early', label: 'Aggressive' },
  { value: 'fast-tempo', label: 'Fast' },
  { value: 'balanced', label: 'Balanced' },
  { value: 'midrange', label: 'Midrange' },
  { value: 'late-game', label: 'Late Game' },
];


export function DeckCustomizer({ advancedOpen = false, onAdvancedClose, onToast }: { advancedOpen?: boolean; onAdvancedClose?: () => void; onToast?: (msg: string) => void } = {}) {
  const { customization, updateCustomization, commander, partnerCommander, edhrecLandSuggestion } = useStore();
  const { count: collectionCount, cards: collectionCards } = useCollection();
  const navigate = useNavigate();
  const [editingLands, setEditingLands] = useState(false);
  const [landInputValue, setLandInputValue] = useState('');
  const [budgetOpen, setBudgetOpen] = useState(() => localStorage.getItem('accordion-budget') === 'true');
  const [powerLevelOpen, setPowerLevelOpen] = useState(() => localStorage.getItem('accordion-power') === 'true');
  const [otherOpen, setOtherOpen] = useState(() => localStorage.getItem('accordion-other') === 'true');
  const [cardListsOpen, setCardListsOpen] = useState(() => localStorage.getItem('accordion-cardlists') === 'true');
  const [collectionOpen, setCollectionOpen] = useState(() => localStorage.getItem('accordion-collection') === 'true');
  const [editingPrice, setEditingPrice] = useState(false);
  const [priceInputValue, setPriceInputValue] = useState('');
  const [editingBudget, setEditingBudget] = useState(false);
  const [budgetInputValue, setBudgetInputValue] = useState('');
  const [editingGcLimit, setEditingGcLimit] = useState(false);
  const [gcLimitInputValue, setGcLimitInputValue] = useState('');
  const [editingCustomFormat, setEditingCustomFormat] = useState(false);
  const [customFormatValue, setCustomFormatValue] = useState('');
  const priceInputRef = useRef<HTMLInputElement>(null);
  const budgetInputRef = useRef<HTMLInputElement>(null);
  const landInputRef = useRef<HTMLInputElement>(null);
  const gcLimitInputRef = useRef<HTMLInputElement>(null);
  const customFormatInputRef = useRef<HTMLInputElement>(null);

  const collectionStats = useMemo(() => {
    if (!collectionCards || collectionCards.length === 0) return null;

    const typeCounts: Record<string, number> = { Creature: 0, Instant: 0, Sorcery: 0, Artifact: 0, Enchantment: 0, Land: 0, Planeswalker: 0 };
    const typeColorCounts: Record<string, Record<string, number>> = {};
    for (const type of Object.keys(typeCounts)) {
      typeColorCounts[type] = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
    }

    for (const card of collectionCards) {
      if (card.typeLine) {
        const tl = card.typeLine.split('—')[0].split('//')[0];
        for (const type of Object.keys(typeCounts)) {
          if (tl.toLowerCase().includes(type.toLowerCase())) {
            typeCounts[type] += 1;
            const ci = card.colorIdentity;
            if (!ci || ci.length === 0) {
              typeColorCounts[type].C += 1;
            } else {
              for (const c of ci) typeColorCounts[type][c] = (typeColorCounts[type][c] || 0) + 1;
            }
          }
        }
      }
    }

    return { typeCounts, typeColorCounts };
  }, [collectionCards]);

  if (!commander) return null;

  // Generate dynamic description based on partner status
  const getFormatDescription = (size: DeckFormat): string => {
    const commanderCount = partnerCommander ? 2 : 1;
    const cardCount = size === 99 ? (100 - commanderCount) : (size - commanderCount);
    const commanderText = partnerCommander ? 'commanders' : 'commander';
    return `${cardCount} cards + ${commanderText}`;
  };

  const isCustomFormat = ![60, 99].includes(customization.deckFormat);

  const startEditingCustomFormat = () => {
    setCustomFormatValue(isCustomFormat ? String(customization.deckFormat) : '40');
    setEditingCustomFormat(true);
  };

  const commitCustomFormat = () => {
    setEditingCustomFormat(false);
    const parsed = parseInt(customFormatValue, 10);
    if (!isNaN(parsed) && parsed >= 10 && parsed <= 200) {
      handleFormatChange(parsed);
    }
  };

  const currentFormat = getDeckFormatConfig(customization.deckFormat);
  const landRange = currentFormat.landRange;

  // Handle format change - also update land counts to format defaults
  const handleFormatChange = (format: DeckFormat) => {
    const formatConfig = getDeckFormatConfig(format);
    // Scale non-basic count proportionally to new format
    const defaultNonBasic = Math.min(15, Math.floor(formatConfig.defaultLands * 0.4));
    // Reset land counts to format defaults and clear userEditedLands
    // so EDHREC can suggest format-appropriate values
    useStore.setState(state => ({
      customization: {
        ...state.customization,
        deckFormat: format,
        landCount: formatConfig.defaultLands,
        nonBasicLandCount: defaultNonBasic,
      },
      userEditedLands: false,
    }));
  };

  // Handle land count change - ensure non-basic doesn't exceed total
  const handleLandCountChange = (newLandCount: number) => {
    const newNonBasic = Math.min(customization.nonBasicLandCount, newLandCount);
    // Atomic update: set landCount + userEditedLands together to prevent EDHREC race
    useStore.setState(state => ({
      customization: { ...state.customization, landCount: newLandCount, nonBasicLandCount: newNonBasic },
      userEditedLands: true,
    }));
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

  useEffect(() => {
    if (editingBudget && budgetInputRef.current) {
      budgetInputRef.current.focus();
      budgetInputRef.current.select();
    }
  }, [editingBudget]);

  useEffect(() => {
    if (editingGcLimit && gcLimitInputRef.current) {
      gcLimitInputRef.current.focus();
      gcLimitInputRef.current.select();
    }
  }, [editingGcLimit]);

  useEffect(() => {
    if (editingCustomFormat && customFormatInputRef.current) {
      customFormatInputRef.current.focus();
      customFormatInputRef.current.select();
    }
  }, [editingCustomFormat]);

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

  const startEditingBudget = () => {
    setBudgetInputValue(customization.deckBudget !== null ? String(customization.deckBudget) : '');
    setEditingBudget(true);
  };

  const commitBudgetInput = () => {
    setEditingBudget(false);
    const parsed = parseFloat(budgetInputValue);
    if (!isNaN(parsed) && parsed > 0) {
      updateCustomization({ deckBudget: parsed });
    }
  };

  const startEditingGcLimit = () => {
    setGcLimitInputValue(typeof customization.gameChangerLimit === 'number' ? String(customization.gameChangerLimit) : '');
    setEditingGcLimit(true);
  };

  const commitGcLimitInput = () => {
    setEditingGcLimit(false);
    const parsed = parseInt(gcLimitInputValue, 10);
    if (!isNaN(parsed) && parsed > 0) {
      updateCustomization({ gameChangerLimit: parsed });
    }
  };

  return (
    <div className="space-y-6">
      {/* Deck Size */}
      <div>
        <label className="text-sm font-medium mb-3 block">Deck Size</label>
        <div className="grid grid-cols-3 gap-2">
          {/* Custom size option */}
          {editingCustomFormat ? (
            <div className="p-3 rounded-lg border border-primary bg-primary/10 text-center flex flex-col items-center justify-center">
              <input
                ref={customFormatInputRef}
                type="number"
                min="10"
                max="200"
                value={customFormatValue}
                onChange={(e) => setCustomFormatValue(e.target.value)}
                onBlur={commitCustomFormat}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitCustomFormat();
                  if (e.key === 'Escape') setEditingCustomFormat(false);
                }}
                className="w-14 text-sm font-medium text-center bg-background border border-primary rounded px-1 py-0.5 outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              />
              <div className="text-xs text-muted-foreground mt-1">total cards</div>
            </div>
          ) : (
            <button
              onClick={startEditingCustomFormat}
              className={`p-3 rounded-lg border text-center transition-colors ${
                isCustomFormat
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border hover:border-primary/50'
              }`}
            >
              <div className="font-medium text-sm">Custom</div>
              <div className="text-xs text-muted-foreground">
                {isCustomFormat ? getFormatDescription(customization.deckFormat) : getFormatDescription(40)}
              </div>
            </button>
          )}
          {/* Brawl 60 */}
          <button
            onClick={() => handleFormatChange(60)}
            className={`p-3 rounded-lg border text-center transition-colors ${
              customization.deckFormat === 60
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border hover:border-primary/50'
            }`}
          >
            <div className="font-medium text-sm">Brawl</div>
            <div className="text-xs text-muted-foreground">{getFormatDescription(60)}</div>
          </button>
          {/* Commander 99 */}
          <button
            onClick={() => handleFormatChange(99)}
            className={`p-3 rounded-lg border text-center transition-colors ${
              customization.deckFormat === 99
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border hover:border-primary/50'
            }`}
          >
            <div className="font-medium text-sm">Commander</div>
            <div className="text-xs text-muted-foreground">{getFormatDescription(99)}</div>
          </button>
        </div>
      </div>


      {/* Land Count */}
      <div>
        <div className="flex justify-between mb-2">
          <label className="text-sm font-medium flex items-center gap-1.5">
            Total Lands
            {edhrecLandSuggestion && customization.landCount === edhrecLandSuggestion.landCount && (
              <span className="flex items-center gap-0.5 text-[11px] font-normal text-emerald-500">
                <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                suggested
              </span>
            )}
          </label>
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
          {customization.landCount < landRange[0] ? (
            <span className="text-primary font-medium">{customization.landCount} (Custom)</span>
          ) : (
            <span>{landRange[0]} (Aggro)</span>
          )}
          <span>{currentFormat.defaultLands} (Standard)</span>
          {customization.landCount > landRange[1] ? (
            <span className="text-primary font-medium">{customization.landCount} (Custom)</span>
          ) : (
            <span>{landRange[1]} (Control)</span>
          )}
        </div>
      </div>

      {/* Non-Basic Land Count */}
      <div>
        <div className="flex justify-between mb-2">
          <label className="text-sm font-medium flex items-center gap-1.5">
            Non-Basic Lands
            {edhrecLandSuggestion && customization.nonBasicLandCount === edhrecLandSuggestion.nonBasicLandCount && (
              <span className="flex items-center gap-0.5 text-[11px] font-normal text-emerald-500">
                <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                suggested
              </span>
            )}
          </label>
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
          onChange={(value) => {
            useStore.setState(state => ({
              customization: { ...state.customization, nonBasicLandCount: value },
              userEditedLands: true,
            }));
          }}
        />
        <div className="flex justify-between text-xs text-muted-foreground mt-1">
          <span>0 (Basic)</span>
          <span>{Math.floor(customization.landCount / 2)} (Balanced)</span>
          <span>{customization.landCount} (Varied)</span>
        </div>
      </div>

      {/* Tempo / Pacing */}
      <div>
        <div className="flex justify-between items-center mb-2">
          <label className="text-sm font-medium flex items-center gap-1.5">
            Tempo
            <InfoTooltip text="Controls the speed of the deck — aggressive decks want cheap cards and untapped lands, late-game decks prioritize haymakers." />
          </label>
          <button
            onClick={() => updateCustomization({ tempoAutoDetect: !customization.tempoAutoDetect })}
            className={`text-xs px-2 py-0.5 rounded-full border transition-colors ${
              customization.tempoAutoDetect
                ? 'bg-primary/15 border-primary/30 text-primary'
                : 'bg-muted border-border text-muted-foreground hover:text-foreground'
            }`}
          >
            Auto-detect
          </button>
        </div>
        {!customization.tempoAutoDetect && (
          <>
            <Slider
              value={PACING_LABELS.findIndex(p => p.value === customization.tempoPacing)}
              min={0}
              max={PACING_LABELS.length - 1}
              step={1}
              onChange={(value) => updateCustomization({ tempoPacing: PACING_LABELS[value].value })}
            />
            <div className="flex justify-between text-xs text-muted-foreground mt-1">
              <span>Aggressive</span>
              <span>Balanced</span>
              <span>Late Game</span>
            </div>
          </>
        )}
      </div>

      {/* Budget Options Accordion */}
      <div className={budgetOpen ? 'pt-2 border-t border-border/50' : ''}>
        <button
          onClick={() => { const v = !budgetOpen; setBudgetOpen(v); localStorage.setItem('accordion-budget', String(v)); }}
          className="flex items-center justify-between w-full text-sm text-muted-foreground hover:text-foreground transition-colors py-1"
        >
          <span className="font-medium flex items-center gap-2">
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="1" x2="12" y2="23" />
              <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
            </svg>
            Budget Options
            {!budgetOpen && (customization.budgetOption !== 'any' || customization.maxCardPrice !== null || customization.deckBudget !== null || customization.currency === 'EUR') && (
              <span className="text-[10px] font-normal text-primary bg-primary/20 px-1.5 py-0.5 rounded-full">
                {[
                  customization.budgetOption !== 'any' ? customization.budgetOption : null,
                  customization.maxCardPrice !== null ? `${customization.currency === 'EUR' ? '€' : '$'}${customization.maxCardPrice}/card` : null,
                  customization.deckBudget !== null ? `${customization.currency === 'EUR' ? '€' : '$'}${customization.deckBudget} deck` : null,
                  customization.currency === 'EUR' ? 'EUR' : null,
                ].filter(Boolean).join(' · ')}
              </span>
            )}
          </span>
          <svg
            className={`w-4 h-4 transition-transform ${budgetOpen ? 'rotate-180' : ''}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        <div className={`grid transition-[grid-template-rows] duration-300 ease-in-out ${budgetOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
          <div className="overflow-hidden">
          <div className="mt-3 space-y-6 px-3">
            {/* Total Deck Budget */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-medium flex items-center gap-1.5">
                  Total Deck Budget
                  <InfoTooltip text="Sets a target budget for the deck (excluding commander). At low budgets, some expensive but high-synergy cards may be skipped in favor of cheaper alternatives. The final total may slightly exceed the target if needed to complete the deck." />
                </label>
                <button
                  onClick={startEditingBudget}
                  className="text-sm font-bold hover:text-primary transition-colors cursor-pointer"
                >
                  {customization.deckBudget === null ? 'No limit' : `${customization.currency === 'EUR' ? '€' : '$'}${customization.deckBudget}`}
                </button>
              </div>
              <div className="flex gap-2">
                {([null, 25, 50, 100, 200] as const).map((budget) => {
                  const isSelected = customization.deckBudget === budget;
                  return (
                    <button
                      key={budget ?? 'none'}
                      onClick={() => { setEditingBudget(false); updateCustomization({ deckBudget: budget }); }}
                      className={`flex-1 py-1.5 px-1 rounded text-xs font-medium transition-colors ${
                        isSelected
                          ? budget === null
                            ? 'bg-muted border border-muted-foreground/30 text-muted-foreground'
                            : 'bg-primary/10 border border-primary text-primary'
                          : 'border border-border hover:border-primary/50'
                      }`}
                    >
                      {budget === null ? 'None' : `$${budget}`}
                    </button>
                  );
                })}
                {editingBudget ? (
                  <input
                    ref={budgetInputRef}
                    type="number"
                    placeholder="$"
                    value={budgetInputValue}
                    onChange={(e) => setBudgetInputValue(e.target.value)}
                    onBlur={commitBudgetInput}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitBudgetInput();
                      if (e.key === 'Escape') setEditingBudget(false);
                    }}
                    className="flex-1 py-1.5 px-1 rounded text-xs font-medium text-center bg-background border border-primary outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                ) : (
                  <button
                    onClick={startEditingBudget}
                    className={`flex-1 py-1.5 px-1 rounded text-xs font-medium transition-colors ${
                      customization.deckBudget !== null && ![25, 50, 100, 200].includes(customization.deckBudget)
                        ? 'bg-primary/10 border border-primary text-primary'
                        : 'border border-border hover:border-primary/50'
                    }`}
                  >
                    {customization.deckBudget !== null && ![25, 50, 100, 200].includes(customization.deckBudget)
                      ? `$${customization.deckBudget}`
                      : 'Custom'}
                  </button>
                )}
              </div>
            </div>

            {/* Max Card Price */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-medium">Max Card Price</label>
                <button
                  onClick={startEditingPrice}
                  className="text-sm font-bold hover:text-primary transition-colors cursor-pointer"
                >
                  {customization.maxCardPrice === null ? 'No limit' : `${customization.currency === 'EUR' ? '€' : '$'}${customization.maxCardPrice}`}
                </button>
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
                          ? price === null
                            ? 'bg-muted border border-muted-foreground/30 text-muted-foreground'
                            : 'bg-primary/10 border border-primary text-primary'
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

            {/* EDHREC Card Pool */}
            <div>
              <label className="text-sm font-medium mb-2 block">EDHREC Card Pool</label>
              <div className="grid grid-cols-3 gap-2">
                {([
                  { value: 'any' as BudgetOption, label: 'Any', description: 'All cards' },
                  { value: 'budget' as BudgetOption, label: 'Budget', description: 'Cheaper picks' },
                  { value: 'expensive' as BudgetOption, label: 'Expensive', description: 'Premium picks' },
                ] as const).map((option) => (
                  <button
                    key={option.value}
                    onClick={() => updateCustomization({ budgetOption: option.value })}
                    className={`p-2 rounded-lg border text-center transition-colors ${
                      customization.budgetOption === option.value
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border hover:border-primary/50'
                    }`}
                  >
                    <div className="font-medium text-xs">{option.label}</div>
                    <div className="text-[10px] text-muted-foreground">{option.description}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Region / Currency — only shown to European users */}
            {IS_EU && (
              <div>
                <div className="flex items-center gap-1.5 mb-2">
                  <label className="text-sm font-medium">Currency</label>
                  <InfoTooltip text="We've detected you might be in Europe, so we've defaulted you to Euro prices. Switch to USD if you prefer." />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {([
                    { code: 'USD', symbol: '$', label: 'US Dollar', flag: '🇺🇸' },
                    { code: 'EUR', symbol: '€', label: 'Euro', flag: '🇪🇺' },
                  ] as const).map((c) => {
                    const active = customization.currency === c.code;
                    return (
                      <button
                        key={c.code}
                        onClick={() => updateCustomization({ currency: c.code })}
                        className={`py-2 px-3 rounded-lg border text-center transition-colors flex items-center justify-center gap-2 ${
                          active ? 'border-primary bg-primary/10' : 'border-border hover:border-primary/50'
                        }`}
                      >
                        <span className={`text-lg font-bold leading-none ${active ? 'text-primary' : 'text-foreground'}`}>{c.symbol}</span>
                        <div className="text-left">
                          <div className={`font-medium text-xs leading-tight ${active ? 'text-primary' : ''}`}>{c.code}</div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
          </div>
        </div>
      </div>

      {/* Power Level Accordion */}
      <div className={powerLevelOpen ? 'pt-2 border-t border-border/50' : ''}>
        <button
          onClick={() => { const v = !powerLevelOpen; setPowerLevelOpen(v); localStorage.setItem('accordion-power', String(v)); }}
          className="flex items-center justify-between w-full text-sm text-muted-foreground hover:text-foreground transition-colors py-1"
        >
          <span className="font-medium flex items-center gap-2">
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
            </svg>
            Power Level
            {!powerLevelOpen && (customization.gameChangerLimit !== 'unlimited' || customization.bracketLevel !== 'all' || customization.comboCount > 1) && (
              <span className="text-[10px] font-normal text-primary bg-primary/20 px-1.5 py-0.5 rounded-full">
                {[
                  customization.bracketLevel !== 'all' ? `Bracket ${customization.bracketLevel}` : null,
                  customization.gameChangerLimit === 'none' ? 'No GCs' : typeof customization.gameChangerLimit === 'number' ? `${customization.gameChangerLimit} GCs` : null,
                  customization.comboCount > 1 ? `Combos: ${(['', 'Normal', 'A Few', 'Many'] as const)[customization.comboCount]}` : null,
                ].filter(Boolean).join(' · ')}
              </span>
            )}
          </span>
          <svg
            className={`w-4 h-4 transition-transform ${powerLevelOpen ? 'rotate-180' : ''}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        <div className={`grid transition-[grid-template-rows] duration-300 ease-in-out ${powerLevelOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
          <div className="overflow-hidden">
          <div className="mt-3 space-y-6 px-3">
            {/* Bracket Level */}
            <div>
              <label className="text-sm font-medium mb-2 block">Bracket Level</label>
              <p className="text-xs text-muted-foreground mb-2">
                Filter EDHREC data by power level bracket.
              </p>
              <div className="flex gap-2">
                {([
                  { value: 'all' as BracketLevel, label: 'All' },
                  { value: 1 as BracketLevel, label: '1' },
                  { value: 2 as BracketLevel, label: '2' },
                  { value: 3 as BracketLevel, label: '3' },
                  { value: 4 as BracketLevel, label: '4' },
                  { value: 5 as BracketLevel, label: '5' },
                ] as const).map((option) => (
                  <button
                    key={option.value}
                    onClick={() => {
                      const gcLimit: GameChangerLimit =
                        option.value === 'all' ? 'unlimited'
                        : option.value <= 2 ? 'none'
                        : option.value === 3 ? 3
                        : 'unlimited';
                      updateCustomization({ bracketLevel: option.value, gameChangerLimit: gcLimit });
                      onToast?.('Archetype and recommended lands updated');
                    }}
                    className={`flex-1 py-1.5 px-1 rounded text-xs font-medium transition-colors ${
                      customization.bracketLevel === option.value
                        ? option.value === 'all'
                          ? 'bg-muted border border-muted-foreground/30 text-muted-foreground'
                          : 'bg-primary/10 border border-primary text-primary'
                        : 'border border-border hover:border-primary/50'
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Game Changers */}
            <div>
              <label className="text-sm font-medium mb-2 block">Game Changers</label>
              <p className="text-xs text-muted-foreground mb-2">
                Game changers are high-impact cards from EDHREC that can swing the game.
              </p>
              <div className="grid grid-cols-3 gap-2">
                <button
                  onClick={() => { setEditingGcLimit(false); updateCustomization({ gameChangerLimit: 'none' }); }}
                  className={`p-2 rounded-lg border text-center transition-colors ${
                    customization.gameChangerLimit === 'none'
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border hover:border-primary/50'
                  }`}
                >
                  <div className="font-medium text-xs">None</div>
                  <div className="text-[10px] text-muted-foreground">No game changers</div>
                </button>
                {editingGcLimit ? (
                  <div className="p-2 rounded-lg border border-primary bg-primary/10 flex flex-col items-center justify-center">
                    <input
                      ref={gcLimitInputRef}
                      type="number"
                      min="1"
                      value={gcLimitInputValue}
                      onChange={(e) => setGcLimitInputValue(e.target.value)}
                      onBlur={commitGcLimitInput}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commitGcLimitInput();
                        if (e.key === 'Escape') setEditingGcLimit(false);
                      }}
                      className="w-12 text-xs font-medium text-center bg-background border border-primary rounded px-1 py-0.5 outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    />
                    <div className="text-[10px] text-muted-foreground mt-0.5">max count</div>
                  </div>
                ) : (
                  <button
                    onClick={startEditingGcLimit}
                    className={`p-2 rounded-lg border text-center transition-colors ${
                      typeof customization.gameChangerLimit === 'number'
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border hover:border-primary/50'
                    }`}
                  >
                    <div className="font-medium text-xs">
                      {typeof customization.gameChangerLimit === 'number' ? `Up to ${customization.gameChangerLimit}` : 'Custom'}
                    </div>
                    <div className="text-[10px] text-muted-foreground">Set a limit</div>
                  </button>
                )}
                <button
                  onClick={() => { setEditingGcLimit(false); updateCustomization({ gameChangerLimit: 'unlimited' }); }}
                  className={`p-2 rounded-lg border text-center transition-colors ${
                    customization.gameChangerLimit === 'unlimited'
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border hover:border-primary/50'
                  }`}
                >
                  <div className="font-medium text-xs">Unlimited</div>
                  <div className="text-[10px] text-muted-foreground">No restriction</div>
                </button>
              </div>
            </div>

            {/* Combos */}
            <div>
              <div className="flex justify-between mb-2">
                <label className="text-sm font-medium flex items-center gap-1.5">
                  Combos
                  <InfoTooltip text="How aggressively to include combos from EDHREC's combo database. 'None' applies no combo boosting — any combos that naturally end up in the deck are still detected. Higher values increasingly prioritize including combo piece cards, and dynamically boost remaining pieces when part of a combo is already selected." />
                </label>
                <span className="text-sm font-bold">{(['None', 'Normal', 'A Few Extra', 'Many'] as const)[customization.comboCount]}</span>
              </div>
              <Slider
                value={customization.comboCount}
                min={0}
                max={3}
                step={1}
                onChange={(value) => updateCustomization({ comboCount: value })}
              />
              <div className="flex justify-between text-xs text-muted-foreground mt-1">
                <span>None</span>
                <span>Normal</span>
                <span>A Few Extra</span>
                <span>Many</span>
              </div>
            </div>

          </div>
          </div>
        </div>
      </div>

      {/* Card Lists Accordion */}
      <div className={cardListsOpen ? 'pt-2 border-t border-border/50' : ''}>
        <button
          onClick={() => { const v = !cardListsOpen; setCardListsOpen(v); localStorage.setItem('accordion-cardlists', String(v)); }}
          className="flex items-center justify-between w-full text-sm text-muted-foreground hover:text-foreground transition-colors py-1"
        >
          <span className="font-medium flex items-center gap-2">
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <line x1="8" y1="6" x2="21" y2="6" />
              <line x1="8" y1="12" x2="21" y2="12" />
              <line x1="8" y1="18" x2="21" y2="18" />
              <line x1="3" y1="6" x2="3.01" y2="6" />
              <line x1="3" y1="12" x2="3.01" y2="12" />
              <line x1="3" y1="18" x2="3.01" y2="18" />
            </svg>
            Card Lists
            {!cardListsOpen && (customization.mustIncludeCards.length > 0 || customization.bannedCards.length > 0) && (
              <span className="text-[10px] font-normal text-primary bg-primary/20 px-1.5 py-0.5 rounded-full">
                {[
                  customization.mustIncludeCards.length > 0 ? `${customization.mustIncludeCards.length} included` : null,
                  customization.bannedCards.length > 0 ? `${customization.bannedCards.length} excluded` : null,
                ].filter(Boolean).join(' · ')}
              </span>
            )}
          </span>
          <svg
            className={`w-4 h-4 transition-transform ${cardListsOpen ? 'rotate-180' : ''}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        <div className={`grid transition-[grid-template-rows] duration-300 ease-in-out ${cardListsOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
          <div className="overflow-hidden">
          <div className="mt-3 space-y-6 px-3">
            {/* Must Include Cards */}
            <MustIncludeCards />

            {/* Excluded Cards */}
            <BannedCards />
          </div>
          </div>
        </div>
      </div>

      {/* Collection Accordion */}
      {collectionCount > 0 && (
        <div className={collectionOpen ? 'pt-2 border-t border-border/50' : ''}>
          <button
            onClick={() => { const v = !collectionOpen; setCollectionOpen(v); localStorage.setItem('accordion-collection', String(v)); }}
            className="flex items-center justify-between w-full text-sm text-muted-foreground hover:text-foreground transition-colors py-1"
          >
            <span className="font-medium flex items-center gap-2">
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
                <polyline points="17 21 17 13 7 13 7 21" />
                <polyline points="7 3 7 8 15 8" />
              </svg>
              Collection
              {!collectionOpen && customization.collectionMode && (
                <span className="text-[10px] font-normal text-primary bg-primary/20 px-1.5 py-0.5 rounded-full">
                  {customization.collectionStrategy === 'partial' ? `Prioritize (${customization.collectionOwnedPercent}%)` : 'Only'}
                </span>
              )}
            </span>
            <svg
              className={`w-4 h-4 transition-transform ${collectionOpen ? 'rotate-180' : ''}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          <div className={`grid transition-[grid-template-rows] duration-300 ease-in-out ${collectionOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
            <div className="overflow-hidden">
            <div className="mt-3 space-y-3 px-3">
              {/* Checkbox */}
              <label className="flex items-center gap-3 cursor-pointer select-none group">
                <input
                  type="checkbox"
                  checked={customization.collectionMode}
                  onChange={(e) => updateCustomization({ collectionMode: e.target.checked })}
                  className="rounded border-border accent-primary w-4 h-4"
                />
                <span className="text-sm font-medium group-hover:text-primary transition-colors">
                  Build from My Collection
                </span>
                <InfoTooltip text="Use your card collection when generating decks. Choose to build entirely from your cards, or prioritize them while filling gaps with recommendations." />
              </label>

              {/* Collection strategy toggle */}
              {customization.collectionMode && (
                <div className="space-y-3 px-2">
                  <div className="grid grid-cols-2 gap-2">
                    {([
                      { value: 'full' as const, label: 'Only My Cards', desc: 'Exclusively your collection' },
                      { value: 'partial' as const, label: 'Prioritize Mine', desc: 'Fill gaps with recommendations' },
                    ]).map((option) => (
                      <button
                        key={option.value}
                        onClick={() => updateCustomization({ collectionStrategy: option.value })}
                        className={`p-2 rounded-lg border text-center transition-colors ${
                          customization.collectionStrategy === option.value
                            ? 'border-primary bg-primary/10 text-primary'
                            : 'border-border hover:border-primary/50'
                        }`}
                      >
                        <div className="font-medium text-xs">{option.label}</div>
                        <div className="text-[10px] text-muted-foreground mt-0.5">{option.desc}</div>
                      </button>
                    ))}
                  </div>

                  {/* Owned percentage slider (partial mode only) */}
                  {customization.collectionStrategy === 'partial' && (
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-xs text-muted-foreground">Collection %</span>
                        <span className="text-xs font-medium text-foreground">{customization.collectionOwnedPercent}%</span>
                      </div>
                      <Slider
                        value={customization.collectionOwnedPercent}
                        min={25}
                        max={100}
                        step={5}
                        onChange={(v) => updateCustomization({ collectionOwnedPercent: v })}
                      />
                      <div className="flex justify-between mt-1">
                        <span className="text-[10px] text-muted-foreground">More Recs</span>
                        <span className="text-[10px] text-muted-foreground">More Owned</span>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Ignore owned cards for budget */}
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-3 select-none group cursor-pointer">
                  <input
                    type="checkbox"
                    checked={customization.ignoreOwnedBudget}
                    onChange={(e) => updateCustomization({ ignoreOwnedBudget: e.target.checked })}
                    className="rounded border-border accent-primary w-4 h-4"
                  />
                  <span className="text-sm font-medium group-hover:text-primary transition-colors">
                    Owned Cards Skip Budget
                  </span>
                </label>
                <InfoTooltip text="Owned cards won't count against your per-card price limit or total deck budget. Useful when you already own expensive staples." />
              </div>

              {/* Collection summary card */}
              <div className="rounded-lg border border-border/50 bg-accent/20 overflow-hidden">
                <div className="flex items-center justify-between px-3 py-2 border-b border-border/30">
                  <span className="text-xs font-medium text-foreground">{collectionCount.toLocaleString()} cards</span>
                  <button
                    onClick={() => navigate('/collection')}
                    className="text-[10px] text-muted-foreground hover:text-primary transition-colors px-1.5 py-0.5 rounded border border-border/40 hover:border-primary/40"
                  >
                    Manage
                  </button>
                </div>
                {collectionStats && (() => {
                  const types = ['Creature', 'Instant', 'Sorcery', 'Artifact', 'Enchantment', 'Land', 'Planeswalker'] as const;
                  const hasAny = types.some(t => collectionStats.typeCounts[t] > 0);
                  if (!hasAny) return null;
                  const maxCount = Math.max(...types.map(t => collectionStats.typeCounts[t]));
                  const colorHex: Record<string, string> = { W: '#C8C3B0', U: '#4B8BBE', B: '#9B7FBF', R: '#C75C5C', G: '#5A9A6E', C: '#6B7280' };
                  const colorOrder = ['W', 'U', 'B', 'R', 'G', 'C'];
                  return (
                    <div className="px-3 py-2 grid grid-cols-2 gap-x-3 gap-y-1">
                      {types.map(t => {
                        const count = collectionStats.typeCounts[t];
                        if (count === 0) return null;
                        const fillPct = maxCount > 0 ? (count / maxCount) * 100 : 0;
                        const cc = collectionStats.typeColorCounts[t];
                        const totalPips = colorOrder.reduce((s, c) => s + (cc[c] || 0), 0);
                        return (
                          <div key={t} className="flex items-center gap-1.5 text-[11px]">
                            <span title={t} className="shrink-0"><CardTypeIcon type={t} size="sm" className="opacity-60" /></span>
                            <div className="flex-1 h-2 bg-border/30 rounded-full overflow-hidden flex">
                              {totalPips > 0 && colorOrder.map(c => {
                                const segPct = (cc[c] || 0) / totalPips * fillPct;
                                if (segPct === 0) return null;
                                return <div key={c} className="h-full" style={{ width: `${segPct}%`, backgroundColor: colorHex[c] }} />;
                              })}
                            </div>
                            <span className="text-muted-foreground tabular-nums w-5 text-right shrink-0">{count}</span>
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}
              </div>
            </div>
            </div>
          </div>
        </div>
      )}

      {/* Other Accordion */}
      <div className={otherOpen ? 'pt-2 border-t border-border/50' : ''}>
        <button
          onClick={() => { const v = !otherOpen; setOtherOpen(v); localStorage.setItem('accordion-other', String(v)); }}
          className="flex items-center justify-between w-full text-sm text-muted-foreground hover:text-foreground transition-colors py-1"
        >
          <span className="font-medium flex items-center gap-2">
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
            Other
            {!otherOpen && (customization.maxRarity !== null || customization.tinyLeaders || customization.arenaOnly || customization.scryfallQuery) && (
              <span className="text-[10px] font-normal text-primary bg-primary/20 px-1.5 py-0.5 rounded-full">
                {[
                  customization.arenaOnly ? 'Arena' : null,
                  customization.maxRarity !== null ? `${customization.maxRarity} max` : null,
                  customization.tinyLeaders ? 'Tiny Leaders' : null,
                  customization.scryfallQuery ? 'Custom query' : null,
                ].filter(Boolean).join(' · ')}
              </span>
            )}
          </span>
          <svg
            className={`w-4 h-4 transition-transform ${otherOpen ? 'rotate-180' : ''}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        <div className={`grid transition-[grid-template-rows] duration-300 ease-in-out ${otherOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
          <div className="overflow-hidden">
          <div className="mt-3 space-y-6 px-3">
            <div>
              <label className="text-sm font-medium mb-2 block">Max Card Rarity</label>
              <p className="text-xs text-muted-foreground mb-2">
                Restrict cards to a maximum rarity level.
              </p>
              <div className="flex gap-2">
                {([
                  { value: 'common' as MaxRarity, label: 'Common' },
                  { value: 'uncommon' as MaxRarity, label: 'Uncommon' },
                  { value: 'rare' as MaxRarity, label: 'Rare' },
                  { value: null as MaxRarity, label: 'All' },
                ] as const).map((option) => (
                  <button
                    key={option.label}
                    onClick={() => updateCustomization({ maxRarity: option.value })}
                    className={`flex-1 py-1.5 px-1 rounded text-xs font-medium transition-colors ${
                      customization.maxRarity === option.value
                        ? option.value === null
                          ? 'bg-muted border border-muted-foreground/30 text-muted-foreground'
                          : 'border-primary bg-primary/10 text-primary border'
                        : 'border border-border hover:border-primary/50'
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              {customization.maxRarity !== null && collectionCount > 0 && (
                <label className="flex items-center gap-3 mt-2 ml-3 select-none group cursor-pointer">
                  <input
                    type="checkbox"
                    checked={customization.ignoreOwnedRarity}
                    onChange={(e) => updateCustomization({ ignoreOwnedRarity: e.target.checked })}
                    className="rounded border-border accent-primary w-4 h-4"
                  />
                  <span className="text-sm font-medium group-hover:text-primary transition-colors">
                    Owned Cards Skip Rarity
                  </span>
                  <InfoTooltip text="Owned cards won't be restricted by the max rarity setting. Useful when you already own rares/mythics you want to include." />
                </label>
              )}
            </div>

            {/* Tiny Leaders */}
            <label className="flex items-center gap-3 cursor-pointer select-none group">
              <input
                type="checkbox"
                checked={customization.tinyLeaders}
                onChange={(e) => updateCustomization({ tinyLeaders: e.target.checked })}
                className="rounded border-border accent-primary w-4 h-4"
              />
              <span className="text-sm font-medium group-hover:text-primary transition-colors">Tiny Leaders</span>
              <InfoTooltip text="Experimental: Restricts all non-land cards to converted mana cost (CMC) 3 or less." />
            </label>

            {/* Arena Only */}
            <label className="flex items-center gap-3 cursor-pointer select-none group">
              <input
                type="checkbox"
                checked={customization.arenaOnly}
                onChange={(e) => updateCustomization({ arenaOnly: e.target.checked })}
                className="rounded border-border accent-primary w-4 h-4"
              />
              <span className="text-sm font-medium group-hover:text-primary transition-colors">Limit to Arena cards</span>
              <InfoTooltip text="Only use cards available in MTG Arena. Searches and deck generation will be restricted to Arena's card pool." />
            </label>

            {/* Additional Scryfall Query */}
            <div>
              <label className="text-sm font-medium mb-1 flex items-center gap-1">
                Additional Scryfall Filters
                <InfoTooltip text='Appended to every card search query. Uses Scryfall search syntax — e.g. "set:mkm" to limit to a set, "is:full-art" for full-art cards, or "frame:extendedart". Multiple filters can be combined with spaces.' />
              </label>
              <p className="text-xs text-muted-foreground mb-2">
                Extra <a href="https://scryfall.com/docs/syntax" target="_blank" rel="noopener noreferrer" className="underline hover:text-primary">Scryfall search syntax</a> appended to all card queries.
              </p>
              <input
                type="text"
                value={customization.scryfallQuery}
                onChange={(e) => updateCustomization({ scryfallQuery: e.target.value })}
                placeholder='e.g. set:mkm, is:full-art, frame:extendedart, f:brawl'
                className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
              />
            </div>
          </div>
          </div>
        </div>
      </div>

      <AdvancedCustomization open={advancedOpen} onClose={() => onAdvancedClose?.()} />
    </div>
  );
}
