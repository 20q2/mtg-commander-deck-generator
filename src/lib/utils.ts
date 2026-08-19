import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import type { ScryfallCard } from '../types'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

const BASIC_LAND_NAMES = new Set(['Plains', 'Island', 'Swamp', 'Mountain', 'Forest', 'Wastes']);

/**
 * Returns the max copies allowed for a card in a singleton deck.
 * Basic lands → 99, multi-copy cards → their cap or 99, everything else → 1.
 */
export function getMaxCopies(card: ScryfallCard): number {
  if (BASIC_LAND_NAMES.has(card.name)) return 99;
  const typeLine = card.type_line || card.card_faces?.[0]?.type_line || '';
  if (typeLine.startsWith('Basic')) return 99;
  const oracle = (card.oracle_text || card.card_faces?.[0]?.oracle_text || '').toLowerCase();
  if (oracle.includes('a deck can have any number of cards named')) return 99;
  const capMatch = oracle.match(/a deck can have up to (\w+) cards named/);
  if (capMatch) {
    const WORD_TO_NUMBER: Record<string, number> = {
      one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
      eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
      fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
      nineteen: 19, twenty: 20,
    };
    const num = WORD_TO_NUMBER[capMatch[1]] ?? parseInt(capMatch[1], 10);
    if (!isNaN(num)) return num;
  }
  return 1;
}

/**
 * Names that can't take another copy — what an "add a card" surface should keep
 * out of its suggestions.
 *
 * Not the same thing as "names already in the deck". Singleton is the rule for
 * almost everything, but basics and the cards that say so in their own text
 * (Nazgûl, Relentless Rats, Dragon's Approach, Shadowborn Apostle …) stay
 * addable until they reach their personal cap, which {@link getMaxCopies} reads
 * off the oracle text rather than a hardcoded list.
 */
export function namesAtCopyLimit(cards: ScryfallCard[]): Set<string> {
  const counts = new Map<string, number>();
  for (const card of cards) counts.set(card.name, (counts.get(card.name) ?? 0) + 1);
  const atLimit = new Set<string>();
  for (const card of cards) {
    if ((counts.get(card.name) ?? 0) >= getMaxCopies(card)) atLimit.add(card.name);
  }
  return atLimit;
}

/** Format a timestamp as a relative time string (e.g., "just now", "3m ago") */
export function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

/** Strip markdown formatting for plain-text display */
export function stripMarkdown(text: string): string {
  return text
    .replace(/#{1,6}\s+/g, '')       // headings
    .replace(/\*\*(.+?)\*\*/g, '$1') // bold
    .replace(/\*(.+?)\*/g, '$1')     // italic
    .replace(/__(.+?)__/g, '$1')     // bold alt
    .replace(/_(.+?)_/g, '$1')       // italic alt
    .replace(/~~(.+?)~~/g, '$1')     // strikethrough
    .replace(/`(.+?)`/g, '$1')       // inline code
    .replace(/^\s*[-*+]\s+/gm, '')   // list bullets
    .replace(/^\s*\d+\.\s+/gm, '')   // numbered lists
    .replace(/\[(.+?)\]\(.+?\)/g, '$1') // links
    .replace(/\n{2,}/g, ' ')         // collapse blank lines
    .replace(/\n/g, ' ')             // newlines to spaces
    .trim();
}
