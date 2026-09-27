/**
 * TCGplayer affiliate links.
 *
 * Every outbound purchase link on the site is built here so the partner code lives in exactly
 * one place. The code is a plain public identifier, not a secret — it has to ship in the client
 * bundle to work at all — so it is committed rather than kept in an env var.
 *
 * Shape: the Impact short link forwards to whatever `?u=` holds, preserving the destination's own
 * query string. Verified against the live redirector; a 100-card mass-entry destination encodes to
 * roughly 2.6k characters and round-trips intact.
 *
 * Note that Impact rewrites `utm_campaign` on the landing URL to the partner account's display
 * name, overwriting any value we set. That parameter is therefore not ours to control from here.
 */

import { BASIC_LAND_NAMES } from '@/services/scryfall/client';
import type { ScryfallCard } from '@/types';

const PARTNER_URL = 'https://partner.tcgplayer.com/AgMO6R';

/** Cards Mass Entry can't price: tokens, emblems, and other non-purchasable filler. */
const UNBUYABLE_LAYOUTS = new Set(['token', 'double_faced_token', 'emblem', 'art_series']);

/**
 * Layouts TCGplayer catalogues under the full "A // B" name. Everything else two-faced is listed
 * under the front face alone — checked against their search API: "Fire // Ice" and
 * "Budoka Gardener // Dokai, Weaver of Life" are real product names, while the adventure
 * "Bonecrusher Giant // Stomp" returns nothing and only "Bonecrusher Giant" matches. Getting this
 * backwards is quietly expensive: a bare "Wear" matches "Wear Down", so the buyer carts the wrong card.
 */
const FULL_NAME_LAYOUTS = new Set(['split', 'flip']);

function tcgProductName(card: Pick<ScryfallCard, 'name'> & { layout?: string }): string {
  if (card.layout && FULL_NAME_LAYOUTS.has(card.layout)) return card.name.trim();
  return card.name.split(' // ')[0].trim();
}

/** Wrap any tcgplayer.com destination in the affiliate redirect. */
export function affiliateUrl(destination: string): string {
  return `${PARTNER_URL}?u=${encodeURIComponent(destination)}`;
}

/**
 * Buy one card. Prefers the exact printing when Scryfall gave us a TCGplayer product id, since
 * that lands on the product page directly; otherwise falls back to a name search, which is a
 * worse landing but still attributed.
 */
export function buyCardUrl(card: Pick<ScryfallCard, 'name'> & { layout?: string; tcgplayer_id?: number }): string {
  const destination = card.tcgplayer_id
    ? `https://www.tcgplayer.com/product/${card.tcgplayer_id}`
    : `https://www.tcgplayer.com/search/magic/product?productLineName=magic&q=${encodeURIComponent(tcgProductName(card))}`;
  return affiliateUrl(destination);
}

export interface DeckBuyEntry {
  name: string;
  quantity: number;
}

/**
 * Entries Mass Entry can actually act on. Basics are dropped because nobody orders singles of
 * them — thirty-odd $0.05 lines bury the cards the buyer came for, and they own them already.
 */
export function buyableDeckEntries(
  cards: Array<{ card: ScryfallCard; quantity: number }>,
  /** When given, cards the player already owns are left out of the cart. */
  isOwned?: (card: ScryfallCard) => boolean,
): DeckBuyEntry[] {
  const merged = new Map<string, number>();
  for (const { card, quantity } of cards) {
    if (BASIC_LAND_NAMES.has(card.name)) continue;
    if (isOwned?.(card)) continue;
    if (card.layout && UNBUYABLE_LAYOUTS.has(card.layout)) continue;
    if (quantity <= 0) continue;
    const name = tcgProductName(card);
    if (!name) continue;
    merged.set(name, (merged.get(name) ?? 0) + quantity);
  }
  return [...merged].map(([name, quantity]) => ({ name, quantity }));
}

/**
 * Buy a whole deck through Mass Entry, which prefills its box from `c` using one
 * "<qty> <name>" entry per `||`-separated segment.
 */
export function buyDeckUrl(entries: DeckBuyEntry[]): string {
  const list = entries.map(e => `${e.quantity} ${e.name}`).join('||');
  return affiliateUrl(`https://www.tcgplayer.com/massentry?productline=Magic&c=${list}`);
}

