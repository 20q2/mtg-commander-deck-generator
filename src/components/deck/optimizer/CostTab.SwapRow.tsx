import { useState } from 'react';
import { ArrowRight, ChevronDown, Check } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { CardTypeIcon, ManaCost } from '@/components/ui/mtg-icons';
import type { ScryfallCard } from '@/types';
import type { SwapRow as SwapRowData, SwapSuggestion } from '@/services/deckBuilder/costAnalyzer';
import { formatPrice } from '@/services/deckBuilder/costAnalyzer';
import { getCardImageUrl, CARD_BACK_URL } from '@/services/scryfall/client';
import { primaryType } from '@/services/deckBuilder/cardSimilarity';
import { scryfallImg } from './constants';

/** Preview the exact card object (so the modal matches this row's printing/price),
 *  falling back to a by-name lookup when we don't hold the card. */
type PreviewFn = (name: string, card?: ScryfallCard) => void;

/**
 * Savings color scaled to the biggest saver in the plan: low savings read red,
 * high savings green — so the magnitude is legible at a glance.
 */
function savingsColor(savings: number, maxSavings: number): string {
  const r = maxSavings > 0 ? Math.min(Math.max(savings / maxSavings, 0), 1) : 0;
  const hue = Math.round(r * 130); // 0 = red → 130 = green
  return `hsl(${hue} 70% 55%)`;
}

/** Small hover-to-enlarge card image used in both the main cells and alt list. */
function CardThumb({ name, img, size, onClick }: {
  name: string; img: string; size: 'sm' | 'lg'; onClick: () => void;
}) {
  const dims = size === 'lg' ? 'h-[60px] w-[43px]' : 'h-9 w-[26px]';
  return (
    <Tooltip delayDuration={150}>
      <TooltipTrigger asChild>
        <button type="button" onClick={(e) => { e.stopPropagation(); onClick(); }} className="flex-shrink-0">
          <img
            src={img}
            alt=""
            loading="lazy"
            className={`${dims} rounded object-cover ring-1 ring-black/40 hover:ring-violet-400/60 transition-shadow`}
          />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="p-0 border-0 bg-transparent shadow-none pointer-events-none">
        <img src={img} alt={name} className="w-[244px] rounded-xl shadow-2xl shadow-black/60" />
      </TooltipContent>
    </Tooltip>
  );
}

interface CardCellProps {
  name: string;
  price: number;
  cmc?: number;
  manaCost?: string;
  typeLine?: string;
  img: string;
  card?: ScryfallCard;
  onPreview: PreviewFn;
  currency: 'USD' | 'EUR';
}

function CardCell({ name, price, cmc, manaCost, typeLine, img, card, onPreview, currency }: CardCellProps) {
  const type = primaryType(typeLine);
  return (
    <div className="flex items-center gap-2.5 min-w-0 flex-1">
      <CardThumb name={name} img={img} size="lg" onClick={() => onPreview(name, card)} />
      <div className="min-w-0">
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onPreview(name, card); }}
          className="block w-full truncate text-sm text-zinc-200 hover:text-violet-300 text-left"
        >
          {name}
        </button>
        <div className="flex items-center gap-2 text-xs">
          <span className="text-zinc-300 tabular-nums font-medium">{formatPrice(price, currency)}</span>
          {manaCost
            ? <ManaCost cost={manaCost} className="text-[0.8em] opacity-90" />
            : cmc != null && <span className="text-zinc-500 tabular-nums">{cmc} MV</span>}
          {type && (
            <span title={typeLine} className="inline-flex text-zinc-400 leading-none">
              <CardTypeIcon type={type} size="sm" />
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

/** One row in the expandable alternatives list. */
function AltOption({ alt, currentPrice, maxSavings, active, onSelect, onPreview, currency }: {
  alt: SwapSuggestion;
  currentPrice: number;
  maxSavings: number;
  active: boolean;
  onSelect: () => void;
  onPreview: PreviewFn;
  currency: 'USD' | 'EUR';
}) {
  const type = primaryType(alt.typeLine);
  const img = alt.imageUrl || scryfallImg(alt.name, 'normal');
  const save = currentPrice - alt.price;
  return (
    <div
      className={[
        'flex items-center gap-2.5 px-2 py-1.5 rounded transition-colors',
        active ? 'bg-violet-500/10 ring-1 ring-violet-500/40' : 'hover:bg-zinc-800/60',
      ].join(' ')}
    >
      <CardThumb name={alt.name} img={img} size="sm" onClick={() => onPreview(alt.name, alt.card)} />
      <button
        type="button"
        onClick={() => onPreview(alt.name, alt.card)}
        className={`truncate text-sm text-left min-w-0 flex-1 hover:text-violet-300 ${active ? 'text-zinc-100 font-medium' : 'text-zinc-300'}`}
      >
        {alt.name}
      </button>
      {alt.manaCost && <ManaCost cost={alt.manaCost} className="text-[0.7em] opacity-80 flex-shrink-0" />}
      {type && (
        <span title={alt.typeLine} className="inline-flex text-zinc-500 leading-none flex-shrink-0">
          <CardTypeIcon type={type} size="sm" />
        </span>
      )}
      <span className="text-xs text-zinc-400 tabular-nums w-16 text-right flex-shrink-0">{formatPrice(alt.price, currency)}</span>
      <span className="text-xs tabular-nums w-20 text-right flex-shrink-0 text-zinc-500">
        save{' '}
        <span className="font-semibold" style={{ color: savingsColor(save, maxSavings) }}>
          {formatPrice(save, currency)}
        </span>
      </span>
      <button
        type="button"
        onClick={onSelect}
        disabled={active}
        className={[
          'text-xs px-2 py-1 rounded border flex-shrink-0 w-16 text-center transition-colors',
          active
            ? 'border-violet-500/40 text-violet-300 cursor-default'
            : 'border-zinc-700 text-zinc-400 hover:text-zinc-100 hover:border-zinc-500',
        ].join(' ')}
      >
        {active ? <span className="inline-flex items-center gap-1 justify-center"><Check className="h-3 w-3" /> Using</span> : 'Use'}
      </button>
    </div>
  );
}

interface Props {
  row: SwapRowData;
  checked: boolean;
  /** Biggest savings across the plan — anchors the dynamic savings color. */
  maxSavings: number;
  onToggle: (id: string) => void;
  onChoose: (id: string, name: string) => void;
  onPreview: PreviewFn;
  currency: 'USD' | 'EUR';
}

export function SwapRow({
  row, checked, maxSavings, onToggle, onChoose, onPreview, currency,
}: Props) {
  const [open, setOpen] = useState(false);

  const currentImg = getCardImageUrl(row.current, 'normal') || CARD_BACK_URL;
  const suggestionImg = row.suggestion.imageUrl || scryfallImg(row.suggestion.name, 'normal');
  const otherCount = row.alternatives.length - 1;

  return (
    <div
      className={[
        'rounded border bg-zinc-900/40 transition-colors',
        checked ? 'border-violet-500/50 bg-violet-500/5' : 'border-zinc-800',
      ].join(' ')}
    >
      <div
        className="flex flex-col gap-2.5 px-3 py-3 sm:flex-row sm:items-center sm:gap-3 sm:py-2.5 hover:bg-zinc-900/40 rounded cursor-pointer"
        onClick={() => onToggle(row.id)}
      >
        {/* Checkbox + the two cards: stacked on mobile, inline on desktop. */}
        <div className="flex items-start gap-3 flex-1 min-w-0 sm:items-center">
          <input
            type="checkbox"
            checked={checked}
            onChange={() => onToggle(row.id)}
            onClick={(e) => e.stopPropagation()}
            className="h-4 w-4 mt-1 sm:mt-0 accent-violet-500 flex-shrink-0 cursor-pointer"
            aria-label={`Swap ${row.current.name} for ${row.suggestion.name}`}
          />

          <div className="flex flex-col gap-2 flex-1 min-w-0 sm:flex-row sm:items-center sm:gap-3">
            <CardCell
              name={row.current.name}
              price={row.currentPrice}
              cmc={row.current.cmc}
              manaCost={row.current.mana_cost}
              typeLine={row.current.type_line}
              img={currentImg}
              card={row.current}
              onPreview={onPreview}
              currency={currency}
            />

            <ArrowRight className="h-4 w-4 text-zinc-500 flex-shrink-0 self-center rotate-90 sm:rotate-0 sm:self-auto" />

            <CardCell
              name={row.suggestion.name}
              price={row.suggestion.price}
              cmc={row.suggestion.cmc}
              manaCost={row.suggestion.manaCost}
              typeLine={row.suggestion.typeLine}
              img={suggestionImg}
              card={row.suggestion.card}
              onPreview={onPreview}
              currency={currency}
            />
          </div>
        </div>

        {/* Savings + alternatives toggle: own line on mobile (indented past the checkbox). */}
        <div className="flex items-center justify-end gap-3 pl-7 sm:pl-0 sm:flex-shrink-0">
          <div className="flex flex-col items-end gap-1 flex-shrink-0 pl-1 w-24">
            <span className="text-sm tabular-nums text-zinc-400">
              Save{' '}
              <span className="font-semibold" style={{ color: savingsColor(row.savings, maxSavings) }}>
                {formatPrice(row.savings, currency)}
              </span>
            </span>
          </div>

          {otherCount > 0 ? (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setOpen(o => !o); }}
              className="flex items-center gap-0.5 text-xs text-zinc-400 hover:text-zinc-100 flex-shrink-0 w-16"
              aria-expanded={open}
            >
              <ChevronDown className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} />
              <span className="tabular-nums">{otherCount} more</span>
            </button>
          ) : (
            <span className="w-16 flex-shrink-0" />
          )}
        </div>
      </div>

      {open && otherCount > 0 && (
        <div className="border-t border-zinc-800/80 bg-zinc-950/40 py-2 pr-3 pl-10">
          <div className="border-l-2 border-violet-500/30 pl-3 flex flex-col gap-1">
            <p className="text-[11px] uppercase tracking-wide text-zinc-500 mb-1">
              Other replacements for <span className="text-zinc-300 normal-case tracking-normal">{row.current.name}</span>
            </p>
            {row.alternatives.map(alt => (
              <AltOption
                key={alt.name}
                alt={alt}
                currentPrice={row.currentPrice}
                maxSavings={maxSavings}
                active={alt.name === row.suggestion.name}
                onSelect={() => onChoose(row.id, alt.name)}
                onPreview={onPreview}
                currency={currency}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
