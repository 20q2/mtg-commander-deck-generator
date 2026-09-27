import { useState } from 'react';
import { ShoppingCart, ExternalLink, X, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { buyCardUrl, buyDeckUrl, buyableDeckEntries } from '@/services/affiliate/tcgplayer';
import { getCardPrice } from '@/services/scryfall/client';
import { trackEvent } from '@/services/analytics';
import type { ScryfallCard } from '@/types';

/**
 * Purchase links name TCGplayer where the user can actually read it — in a chip label, or in the
 * dialog below. Not in a tooltip: those never open on touch, and the footer disclosure is hidden on
 * the Inspector once a deck loads, so a hover-only notice reaches nobody on a phone.
 */

interface BuyCardChipProps {
  card: ScryfallCard;
  /** Reported to analytics only — the price already renders above this row, so the chip
   *  repeating it would be the same number twice within 40px. */
  price?: string | null;
}

/**
 * Sits in the card preview's existing Scryfall/EDHREC row and matches those chips. Deliberately the
 * only per-card purchase affordance: the price labels in deck rows stay inert text, because a
 * commercial link disguised as body text is both undiscoverable and the kind of thing players
 * resent finding out about later.
 */
export function BuyCardChip({ card, price }: BuyCardChipProps) {
  return (
    <a
      href={buyCardUrl(card)}
      target="_blank"
      rel="noopener noreferrer sponsored"
      onClick={() => trackEvent('affiliate_buy_clicked', {
        surface: 'card_preview',
        cardCount: 1,
        totalPrice: price ? Number(price.replace(/[^0-9.]/g, '')) || null : null,
      })}
      title="Buy on TCGplayer — affiliate link, opens in a new tab"
      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/10 hover:bg-white/20 text-white/80 hover:text-white text-xs font-medium transition-colors"
    >
      <ShoppingCart className="w-3.5 h-3.5" />
      TCGplayer
      <ExternalLink className="w-3 h-3 text-white/50" />
    </a>
  );
}

type DeckCards = Array<{ card: ScryfallCard; quantity: number }>;

/** Front-face key, matching how buyableDeckEntries names a card. */
function entryKey(card: ScryfallCard): string {
  return card.name.split(' // ')[0].trim();
}

function estimateTotal(
  cards: DeckCards,
  currency: 'USD' | 'EUR',
  include: (card: ScryfallCard) => boolean,
): number {
  return cards.reduce((sum, { card, quantity }) => {
    if (!include(card)) return sum;
    const n = parseFloat(getCardPrice(card, currency) || '0');
    return sum + (Number.isNaN(n) ? 0 : n * quantity);
  }, 0);
}

interface BuyDeckButtonProps {
  cards: DeckCards;
  /** When supplied, the dialog offers a "cards you don't own" cart alongside the full one. */
  isOwned?: (card: ScryfallCard) => boolean;
  currency?: 'USD' | 'EUR';
  className?: string;
}

/**
 * The label stays one word so it survives a crowded toolbar. Everything that would have bloated it —
 * vendor, card count, what is excluded, the affiliate relationship — moves into the dialog, which is
 * the better home for it anyway: it is read at the moment of the decision, and nothing leaves the
 * site until the user clicks through it.
 */
export function BuyDeckButton({ cards, isOwned, currency = 'USD', className = '' }: BuyDeckButtonProps) {
  const [open, setOpen] = useState(false);
  if (buyableDeckEntries(cards).length === 0) return null;

  return (
    <>
      <Button variant="outline" className={className} onClick={() => setOpen(true)}>
        <ShoppingCart className="w-4 h-4 mr-2" />
        Buy
      </Button>
      {open && (
        <BuyDeckModal cards={cards} isOwned={isOwned} currency={currency} onClose={() => setOpen(false)} />
      )}
    </>
  );
}

function BuyDeckModal({ cards, isOwned, currency, onClose }: {
  cards: DeckCards;
  isOwned?: (card: ScryfallCard) => boolean;
  currency: 'USD' | 'EUR';
  onClose: () => void;
}) {
  const full = buyableDeckEntries(cards);
  const missing = isOwned ? buyableDeckEntries(cards, isOwned) : [];
  // Without a collection there is nothing to subtract, and if you own none of the deck the two carts
  // are the same list — either way the choice is noise, so the dialog drops to a single option.
  const hasChoice = missing.length > 0 && missing.length < full.length;

  const [scope, setScope] = useState<'full' | 'missing'>(hasChoice ? 'missing' : 'full');
  const entries = scope === 'missing' && hasChoice ? missing : full;

  const inFullCart = (c: ScryfallCard) => full.some(e => e.name === entryKey(c));
  const sym = currency === 'EUR' ? '€' : '$';
  const fullTotal = estimateTotal(cards, currency, inFullCart);
  const missingTotal = estimateTotal(cards, currency, c => inFullCart(c) && !isOwned?.(c));

  const qty = (list: typeof full) => list.reduce((n, e) => n + e.quantity, 0);
  const basicsSkipped = cards.reduce((n, c) => n + c.quantity, 0) - qty(full);
  const shownTotal = scope === 'missing' && hasChoice ? missingTotal : fullTotal;

  const options = [
    ...(hasChoice
      ? [{ key: 'missing' as const, label: "Only cards you don't own", count: qty(missing), total: missingTotal }]
      : []),
    { key: 'full' as const, label: 'Every card in the deck', count: qty(full), total: fullTotal },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm animate-fade-in p-4"
      onClick={onClose}
    >
      <div
        className="bg-card rounded-xl shadow-2xl w-full max-w-md animate-scale-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h2 className="text-lg font-bold">Buy on TCGplayer</h2>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close">
            <X className="w-5 h-5" />
          </Button>
        </div>

        <div className="p-4 space-y-4">
          <div className="space-y-2">
            {options.map(opt => {
              const active = scope === opt.key;
              return (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => setScope(opt.key)}
                  className={`w-full flex items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors ${
                    active ? 'border-primary bg-primary/10' : 'border-border hover:bg-accent/50'
                  }`}
                >
                  <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                    active ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/60'
                  }`}>
                    {active && <Check className="h-3 w-3" />}
                  </span>
                  <span className="min-w-0 flex-1 text-sm">{opt.label}</span>
                  <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                    {opt.count} · ~{sym}{opt.total.toFixed(2)}
                  </span>
                </button>
              );
            })}
          </div>

          <p className="text-xs text-muted-foreground">
            {basicsSkipped > 0 && `Basic lands are left out — ${basicsSkipped} of them. `}
            Opens TCGplayer Mass Entry with the list filled in. The estimate comes from Scryfall;
            TCGplayer sets its own prices in USD, across multiple sellers, before shipping.
          </p>

          <p className="text-xs text-muted-foreground">
            Affiliate link — we may earn a commission at no extra cost to you.
          </p>

          <Button
            className="w-full btn-shimmer"
            onClick={() => {
              trackEvent('affiliate_buy_clicked', {
                surface: 'deck', cardCount: entries.length, totalPrice: shownTotal,
              });
              window.open(buyDeckUrl(entries), '_blank', 'noopener,noreferrer');
              onClose();
            }}
          >
            <ShoppingCart className="w-4 h-4 mr-2" />
            Buy {qty(entries)} cards
            <ExternalLink className="w-3.5 h-3.5 ml-2 opacity-70" />
          </Button>
        </div>
      </div>
    </div>
  );
}
